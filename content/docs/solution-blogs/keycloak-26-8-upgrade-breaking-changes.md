---
title: "Keycloak 26.8.0 升级：IAM 破坏性变更排查 | IDaaS Book"
description: "Keycloak 26.8.0 升级说明逐条解读：IdP mapper 默认不再授予管理角色（CVE-2026-12388）、X.509 用户认证强制 CA Subject DN、禁用客户端退出 aud、Full Scope Allowed 弃用迁移、token exchange 委派改走 FGAP v2，附升级前检查清单与回滚。"
date: 2026-10-01T21:30:00+08:00
lastmod: 2026-10-01T21:30:00+08:00
draft: false
weight: 7
contributors: []
toc: true
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-26-8-upgrade-breaking-changes"
tags:
  - keycloak
  - upgrade
  - iam
  - breaking-changes
  - fgap
  - security
---

## 场景与边界

26.8.0 于 2026-10-01 发布。官方升级说明（`changes-26_8_0.adoc`）列出 **6 条破坏性变更、34 条行为与非破坏性变更、14 条弃用项**。逐条翻译没有价值，本文按「会不会打破你现有部署、要不要在升级窗口前动手」排序。

适用：从 26.7.x 升到 26.8.0 的生产集群，尤其是用了 IdP 联邦、X.509 登录、audience 校验网关、Authorization Services、多集群/蓝绿发布的部署。不适用：26.4 之前版本直接跳 26.8 —— 中间版本的变更必须逐版补读，本文只覆盖 26.7 → 26.8 这一段。

本文事实基线：`keycloak/keycloak` 的 `26.8.0` 标签源码（`Profile.java`、`keycloak-default-client-profiles.json`）与官方 Upgrading Guide，核对日期 2026-10-01。标注为「官方建议」的部分与「本书建议」的部分分开写。

## 先确定目标版本：26.7.5 还是 26.8.0

升级计划的第一步不是读 26.8.0 的变更清单，而是决定这个窗口推哪个版本。26.7.4 之后上游发了两个版本，性质不同：

| 版本 | 发布日期 | 性质 | 适合谁 |
|---|---|---|---|
| **26.7.5** | 2026-09-30 | **纯安全修复补丁**，14 项安全修复 + 2 项弱点修复 | 只想关风险、不想承担行为变更的存量 26.7.x 集群 |
| **26.8.0** | 2026-10-01 | 功能版本，含 6 条破坏性变更与 14 条弃用 | 有计划做功能演进、能安排回归窗口的团队 |

26.7.5 的修复里有三条直接落在**客户端策略与组策略的条件求值**上，值得单独点名，因为它们的利用条件是「配置看起来正确」：

- `CVE-2026-18206`：client policy 的 source-host 通配域名会匹配非子域后缀（本不该匹配的域名被判为匹配）。
- `CVE-2026-18207`：source-group 条件在同名组存在时会匹配到重复组名，并且**可能跳过 negative logic 的判定**——而 negative logic 正是 [Full Scope Allowed 收敛](#full-scope-allowed-弃用本次升级最该排期的一条) 那类策略用来排除内置客户端的机制。
- `CVE-2026-18211`：`secure-client-uris` 的 localhost 例外会接受以 `localhost` 开头的攻击者域名（例如 `localhost.evil.example`）。

另外两个 CVE 与本文要讲的 26.8.0 破坏性变更**是同一件事**：`CVE-2026-93999`（禁用客户端仍能通过 token-exchange refresh 拿到令牌）和 `CVE-2026-89298`（通过 Client Registration GET 把 client secret 泄露给 `view-clients` 角色）都已在 26.7.5 修复。这解释了一个容易困惑的现象——26.8.0 把「禁用客户端不再进入 `aud`」和「`view-clients` 不再返回 secret」列为**破坏性变更**，本质上是把两个安全修复也一并给了 26.7 分支，两个版本都会出现同样的行为变化，只在 26.8.0 的升级说明里被写成了兼容性注意事项。

**结论**：如果你的窗口来不及做功能回归，先上 26.7.5；如果直接上 26.8.0，下面这些破坏性变更一条都不能跳过。26.7.5 的安全修复清单见 [Release 26.7.5](https://github.com/keycloak/keycloak/releases/tag/26.7.5)。

## 升级影响判断表

| 变更 | 打在谁身上 | 升级前必做 | 会直接报错吗 |
|---|---|---|---|
| IdP mapper 默认不再授予管理角色（CVE-2026-12388） | 用 broker mapper 授 realm-admin 或加管理组的部署 | 逐个 IdP 打开 *Allow granting admin roles via mappers* | 否，静默失效 |
| X.509 **用户**认证强制 CA Subject DN | 浏览器证书登录 | 为认证器配置 CA Subject DN，确认信任库 | 是，认证不可用 |
| 禁用客户端不再进入 `aud` / `resource_access`（CVE-2026-93999） | 用 audience 校验的下游网关（oauth2-proxy 等） | 清点「已禁用但仍被校验」的 client | 否，401 |
| `view-clients` 不再返回 client secret（#49220） | 读 secret 的自动化脚本 | 改授 `manage-clients` 或换成专用凭据通道 | 否，拿到 `**********` |
| Token introspection `act.sub` 改成用户 ID | 解析 `act.sub` 当用户名的资源服务器 | 改读 `act.preferred_username` | 否 |
| 组策略裸组名只匹配顶层组（CVE-2026-19608） | 关闭 *Full group path* 的 GroupMapper + 组策略 | 打开 *Full group path* 或改用完整路径 | 否，授权判定变化 |
| Authorization Services 资源 URI 归一化 | 依赖 `;jsessionid`、`/../`、`%2F`、尾斜杠、query 区分的 resource 定义 | 复核 resource URI | 否 |
| `initiating_idp` 默认被忽略 | 依赖该参数抑制上游登出的部署 | 改用 back-channel / front-channel logout | 否 |
| 刷新令牌 `exp` 受会话空闲超时压制 | 依赖 `refresh_expires_in` 做预刷新的客户端 | 调整预刷新策略 | 否 |
| 登录失败计数写入数据库（`login-failures:v2`） | 大集群、DB 连接与 CPU 敏感的部署 | 评估 DB 余量 | 否，DB 压力上升 |
| `stateless` / jdbc-ping 集群名校验 | 多集群、蓝绿有重叠窗口 | 设 `--cache-embedded-cluster-name` | 是，拒绝启动或上报 unhealthy |

## 最容易被忽略的一条：IdP mapper 不再能授予管理角色

这条排第一，因为它**不报错**。升级前能用 broker mapper 把外部用户提成 Keycloak 管理员的部署，升级后会「登录成功但没权限」。

机制（CVE-2026-12388）：身份提供者新增 `allowAdminRoleMapping` 开关，**默认 `false`，且对升级前已存在的 IdP 也默认 `false`**。在该开关关闭期间，mapper 只要会授予 realm 管理角色、或把用户加进「携带管理角色的组」，就会在两个位置被拦：mapper 创建/更新时，以及用户通过 broker 登录时。只有持有 `manage-realm` 的管理员能打开它。

两个容易误判的点：

1. **升级不会回收已有的角色/组授予**。所以「升级后管理员还能用」不代表配置合规；下一次有人改这个 mapper，或者走一次重新登录授角色的路径，就会失败。判断标准应该是对照 `allowAdminRoleMapping` 的当前值，而不是当下能不能登录。
2. 需要 `manage-realm` 才能打开这个开关，意味着把管理角色授予外部用户这件事，**配置权从 `manage-identity-providers` 收回到 realm 管理员**。如果原来由联邦管理员自助维护 IdP，这条会改变你们的职责划分。

动作：升级前枚举所有 IdP 的 mapper，找出会给 realm 管理角色或管理组的那些；对确实需要的 IdP 显式打开开关，其余保持关闭。企业侧映射细节见 [Keycloak 与 Microsoft Entra ID 联邦]({{< relref "keycloak-entra-id-federation" >}})。

## X.509 用户认证强制 CA Subject DN

26.7.0 要求的是**客户端**认证器 `client-x509`（服务间 mTLS）；26.8.0 轮到**用户侧**认证器：*Certificate Authority subject DN* 成为控制台必填项，而且是多值字段（可指定多个可信锚 CA）。

同时 *Revalidate Client Certificate* 被弃用——未来总是重新校验证书链，信任库必须始终配置正确。官方特别提示：在 TLS 终止代理 + 证书头转发的拓扑下，Keycloak 的信任库仍要能验证整条链，不能只信任一个未经验证的请求头。这与本书 [Keycloak X.509 客户端证书登录]({{< relref "keycloak-x509-client-certificate-auth" >}}) 里「代理与 Keycloak 的责任划分」是同一件事的延续：升级后这份划分从「配置建议」变成「启动前提」。

动作：升级前给每个 X.509 用户认证器填上 CA Subject DN，并在预发环境用一张真实员工证书跑通登录，别只验证「服务能起来」。

## Full Scope Allowed 弃用：本次升级最该排期的一条

26.8.0 把客户端上的 *Full Scope Allowed* 开关标记为弃用，并将在未来版本移除。新增两项行为：

- 服务端在**每次签发令牌**时，对仍然开启该开关的客户端打 `WARN`。日志类别为 `org.keycloak.protocol.oidc.endpoints.TokenEndpoint.full-scope-allowed`，可以按它静音，但官方建议保留告警、去改客户端。
- 内置客户端 `security-admin-console` 和 `admin-cli` 的告警被刻意抑制，**不要去手动关它们的 Full Scope Allowed**——官方写明了这会立刻打断 Admin Console 登录，并可能在未来升级时引入额外迁移步骤。

为什么值得现在处理：开关开启时，该客户端的 access token 会带上用户在**所有** client 和 realm 上的角色，令牌一旦泄露，爆炸半径是整租户。这与 [Keycloak 26.7.3 安全补丁解读]({{< relref "keycloak-26-7-3-security-patch" >}}) 里记录的 CVE-2026-18570（省略 `fullScopeAllowed` 可绕过 full-scope-disabled 的策略校验）是同一块配置面——上游正在把「靠开关兜底」逐步换成「显式 role scope mapping」。

先清点存量（分页拉取，`max` 受服务端上限约束，按 `first` 翻页）：

```bash
TOKEN=$(curl -s -X POST \
  "https://$KC/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" -d "client_id=admin-cli" \
  -d "username=$ADMIN" -d "password=$PASSWORD" | jq -r .access_token)

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://$KC/admin/realms/$REALM/clients?first=0&max=200" \
  | jq -r '.[] | select(.fullScopeAllowed==true) | .clientId'
```

官方给出的迁移路径是三步（本书补充了第 4 步的顺序提醒）：

1. 对每个告警客户端，进入 *Client scopes* → 该客户端的专用 client scope → *Scope*，关闭 *Full Scope Allowed*。
2. 在同一个位置补齐它真正需要的 role scope mappings。
3. 用 *Client scopes* → *Evaluate* 工具确认最终令牌里的角色正好是需要的那些。
4. **先补映射再关开关**。反过来做，中间会有一段时间令牌缺少角色，下游 403，而且这类故障在网关层通常只表现为「有 token 但没权限」，排查成本高。

要让新建/更新的客户端自动收敛，用 client policy 的 `full-scope-disabled` executor：

| 配置 | 行为 | 什么时候用 |
|---|---|---|
| Auto-configure = On（默认） | 创建/更新客户端时直接把 `fullScopeAllowed` 改写为 `false`，忽略调用方传入值 | 期望「新客户端一律从紧」 |
| Auto-configure = Off | 不改写，改为校验：发现开启就拒绝这次创建/更新 | 期望「写错了要报错」，而不是被静默改写 |

两个必须先知道的边界：

- **executor 只在 create / update 事件上触发，存量客户端不会被追溯**。它解决的是「不再产生新的坏客户端」，存量仍要靠上面的第 1–3 步。
- **`Any Client` 条件会连带打到内置客户端**，把 Admin Console 锁死。官方的缓解方式是：保留 *Any Client* 条件，再加一个 *Client Role* 条件并把 *Negative logic* 打开，用一个标记角色（例如 `fsa-permitted-marker-role`）把内置客户端排除。保留 *Any Client* 的原因很实际——客户端注册时还没有「已存在的客户端」，*Client Role* 条件只会 abstain，靠 *Any Client* 才能命中。这一套的语义细节在 [Keycloak 细粒度权限与授权策略]({{< relref "keycloak-fine-grained-authz" >}}) 里有更完整的条件求值背景。

顺带说明一个版本边界：`full-scope-disabled` **不是 26.8.0 新引入的 executor**，它在 26.7 的 FAPI 全局 profile（`fapi-1-baseline`、`fapi-2-security-profile`、`fapi-2-dpop-*` 等）里已经存在。26.8.0 的新增点是开关弃用、令牌签发告警、以及官方第一次给出完整的控制台操作流程。

## 默认值与特性状态的静默变化

这类变化不报错，但会让行为和你记忆里的不一样：

- **转正并默认开启**：`client-secret-rotation`、`scim-api`（`26.8.0` 的 `Profile.java` 中两者均为 `Type.DEFAULT`）。原先靠 `--features=preview` 或显式开关打开的部署，**要确认启动参数里不再依赖 `preview`**——`--features=preview` 不会再激活已转正特性，同时也别指望它还能顺手打开别的预览功能。
- **`stateless` 转正但不默认开**：类型是 `DISABLED_BY_DEFAULT`，仍要显式 `--features=stateless`。它是多集群 v2 的基础，取代已弃用的 `multi-site`（多集群 v1）；`clusterless` 明确将在未来移除。多集群 v1 → v2 的路径与站内既有内容衔接见 [Keycloak 多集群高可用与跨机房部署]({{< relref "keycloak-multi-cluster-ha" >}})。
- **登录失败计数入库**：`login-failures:v2` 成为默认，临时锁定的用户在集群重启后仍然是锁定的；代价是数据库连接与 CPU 上升。`login-failures:v1`（纯内存）弃用，且**与 `stateless` 互斥**。v2 下 `spi-brute-force-protector-default-brute-force-detector-allow-concurrent-requests` 失效——同一用户的并发登录改为按节点串行。
- **Token exchange 委派改授权模型**：不再使用 `realm-management` 的 `impersonation` 角色，改为 FGAP v2 的 `delegate`（Users 资源）/ `delegate-members`（Groups 资源）权限，FGAP v1 不支持委派。同时参数化 client scope 从 `delegation` 改名为 `delegation:user`，请求里的 scope 从 `delegation:<admin>` 变成 `delegation:user:<admin>`；升级时 `delegation:user` 与 `delegation:client` 会自动建成 Optional client scope，旧的 `delegation` 可以在迁移后删除。逐版本行为对照见 [Keycloak Token Exchange 实战]({{< relref "keycloak-token-exchange" >}})。
- **邮件不再被其他流程标记为已验证**：只有走完邮箱验证流程才会置为已验证。受影响的是「按邮箱做 broker 账户关联」、「不含 *Verify Email* 动作的管理员邮件」和 OID4VCI 邮件。IdP 与 LDAP 的 *Trust Email* 不受影响——它本来就是管理员的显式信任决定。
- **IdP 与 Organization 改为多对多**：新增 `ORG_IDENTITY_PROVIDER` 关联表，`IDENTITY_PROVIDER` 表移除 `ORGANIZATION_ID`，`ORG_DOMAIN` 增加域路由列（`REALM_ID` / `IDP_ID` / `AUTO_REDIRECT`），并从 IdP 配置项迁移后删除 `kc.org.domain`、`kc.org.broker.redirect.mode.email-matches`、`kc.org.excluded.domains`。Admin REST 侧 `IdentityProviderRepresentation.organizationId` 被替换成组织 IdP 端点下的关联列表——**用 API 管组织 IdP 的集成必须改**。
- **客户端会话列表按用户可见性过滤**：只有 `view-clients` 的调用者，在 `user-sessions` / `offline-sessions` 端点会看到更少结果。用这些端点做告警或对账的脚本要复核。
- **能 map 就能 view**：可以给用户映射某角色的管理员，现在也能读取该角色；没有 `view` 权限时，客户端级 role-mapping 端点返回空列表而不是 `403`。依赖「403 表示无权限」做判断的脚本会失效。

## 一条没进 26.8.0 的预期修复

**CVE-2026-18569（OIDC 身份代理 backchannel logout 令牌被跳过验签）不在 26.8.0 中。** 修复 PR [#52171](https://github.com/keycloak/keycloak/pull/52171) 在 26.8.0 发布时仍是 open，核对 `26.8.0` 标签源码，`TokenManager.validateLogoutTokenAgainstIdpProvider()` 依旧直接调用 `oidcIdp.validateToken(encodedLogoutToken)`（未传强制验签参数），升级说明与发布说明里也没有这个 CVE 的条目。

这条要写进升级判断的原因很直接：**受影响范围是「26.8.0 及更早」，升级到 26.8.0 不会修复它**。如果你们的升级计划里把这条 CVE 当成「跟版本一起解决」，那计划是错的；缓解手段仍是在上游 IdP 上打开 *Validate Signatures* 并配置公钥/JWKS，且要一并回归上游登录链路。受影响的判定条件、盘点命令、加固配置与验证步骤见 [Keycloak 身份代理登出验签：CVE-2026-18569 与 26.8 现状核对]({{< relref "blog/keycloak-broker-logout-token-validation" >}})。

顺带说明同一条链路上 26.8.0 **确实**改了什么：`initiating_idp` 参数默认被忽略，浏览器登出时**总是**执行上游 IdP 登出，不再由该参数抑制；需要临时恢复旧行为可以打开 `allow-initiating-idp-logout-param`，但官方已将其标记为弃用、未来移除。正确做法是改用标准的 back-channel / front-channel logout。这两条一起看，26.8.0 在登出链路上做的是**行为标准化**，而不是修掉那个验签旁路。

## 数据库与滚动升级

- **离线会话索引重建**：`OFFLINE_USER_SESSION` 新增列并重建相关索引。若该表超过 300000 行，默认**跳过**自动建索引，只在控制台打印 SQL 让你手工执行；阈值可配置。表大的部署请把「手工建索引」写进升级步骤，不要以为迁移跑完就没事了。
- **启动后自动非阻塞建索引**：被跳过的索引会在启动后按数据库能力自动补建（PostgreSQL `CREATE INDEX CONCURRENTLY`、Oracle `ONLINE`、MySQL/MariaDB 在线 DDL、MSSQL 企业版 `WITH (ONLINE = ON)`）。PostgreSQL 上如果存在上一次失败留下的 invalid 索引，会自动 drop 再建。
- **jdbc-ping 集群名校验**：使用 `jdbc-ping` 的节点会周期检查同一数据库上是否有**不同 cluster name** 的其他 Keycloak 部署。检测到、且未启用 `stateless` 时，节点会报错并通过健康端点上报 unhealthy。蓝绿升级只要「同一时刻只有一个集群在跑」就不会触发；如果你们的流程里两套集群会短暂并存（例如预热缓存）且用了不同集群名，那这段 unhealthy 是**预期行为**，不是故障——要么接受窗口，要么不并存，要么上 `stateless`。
- **`stateless` 需要显式集群名**：必须设置 `--cache-embedded-cluster-name`（环境变量 `KC_CACHE_EMBEDDED_CLUSTER_NAME`）且不能是默认的 `ISPN`，否则拒绝启动。共享同一数据库的多个部署必须用不同名字，跨集群缓存失效才成立。
- **MySQL/MariaDB + `stateless`**：事务隔离级别改为 `READ COMMITTED`；如果开了二进制日志且 `binlog_format = STATEMENT`，写操作会失败，服务端启动时会检测并报错。
- **MSSQL / Oracle 异步提交**：只写临时表的事务改用延迟提交以提升吞吐，登出仍强制同步提交。MSSQL 需要 DBA 先执行 `ALTER DATABASE ... SET DELAYED_DURABILITY = ALLOWED`；Oracle 无需数据库级配置；XA 数据源（`--transaction-xa-enabled=true`）下自动关闭。不想要可以用 `--spi-connections-jpa--quarkus--async-commit=false` 关掉。
- **`kcadm` / `kcreg` 权限收紧**：每次写入凭据都会把配置文件设为 `0600`（以前只在首次创建时设置）。这是修复，但如果你们的自动化依赖「其他进程读同一份 kcadm 配置」，需要改成各自的凭据文件。
- **证书 CN 截断到 64 字符**：Keycloak 生成的自签证书（例如创建 SAML 客户端时）遵循 RFC 5280 的 `ub-common-name` 上限。如果工具链用 CN 去匹配长 client ID，匹配会失效。

## 升级前检查清单

- [ ] IdP 逐个确认 `allowAdminRoleMapping` 的取值，与「谁应该持有管理角色」的实际意图对齐
- [ ] X.509 用户认证器补全 CA Subject DN；预发用真实证书验证登录与信任库
- [ ] 清点仍开启 *Full Scope Allowed* 的客户端（上面的一段命令），排期按「先补映射、再关开关」执行
- [ ] 若用 audience 校验网关，确认没有依赖「已禁用客户端」出现在 `aud` / `resource_access` 中（CVE-2026-93999 的语义变化，相关排错参见 [Keycloak + oauth2-proxy 集成]({{< relref "keycloak-oauth2-proxy" >}})）
- [ ] 解析 introspection `act.sub` 的服务改为读 `act.preferred_username`
- [ ] 组策略 + 关闭 *Full group path* 的组合改为完整路径判断
- [ ] Authorization Services 里靠矩阵参数、点段、编码斜杠、尾斜杠、query 区分的 resource URI 复核
- [ ] 启动参数清理：`--features=preview` 不再激活已转正特性；`multi-site`、`login-failures:v1`、`clusterless` 都在退场路径上
- [ ] 未启用 `stateless` 的多集群/蓝绿重叠窗口，确认能接受 unhealthy 告警或调整流程
- [ ] `OFFLINE_USER_SESSION` 行数评估；超阈值时准备手工建索引
- [ ] 读 secret 的自动化改用 `manage-clients`；kcadm 配置文件权限变更通知相关脚本
- [ ] 数据库备份与恢复演练（迁移不可默认回退，参考 [Keycloak 升级与滚动更新]({{< relref "keycloak-upgrade-rolling-update" >}})）

## 验证

```bash
# 1. 版本
curl -fsS https://$KC/realms/master/.well-known/openid-configuration | jq -r .issuer
# 首页也会打印版本：Keycloak 26.8.0

# 2. 迁移与新索引状态（升级后第一次启动）
kubectl -n keycloak logs deploy/keycloak --since=30m | grep -iE "liquibase|index|cluster name"

# 3. Full Scope Allowed 告警是否仍在出现（说明存量还没清完）
kubectl -n keycloak logs deploy/keycloak --since=30m \
  | grep -c "full-scope-allowed"

# 4. 健康端点
curl -fsS https://$KC/health/ready

# 5. IdP 管理角色映射是否被拦（用 broker 用户登录后检查其角色）
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://$KC/admin/realms/$REALM/users/$USER_ID/role-mappings" | jq '.realmMappings[].name'
```

回归面（缺一项都不算验证完成）：管理员登录 Admin Console、OIDC/SAML 登录、broker 登录、令牌刷新、LDAP/SCIM 同步、Authorization Services 评估、反向代理后的 issuer、以及升级前清单里那几条行为变化。

## 回滚方式

和以往版本一样，分两层：**镜像可以回退，数据库迁移不能默认当作可逆**。26.8.0 涉及表结构变化（离线会话索引与列、`ORG_IDENTITY_PROVIDER` 新表、`IDENTITY_PROVIDER` 删列、IdP 配置项迁移到 `ORG_DOMAIN`），一旦迁移执行，直接把旧镜像指向已迁移的库启动不是受支持的降级路径。

推荐顺序：先备份数据库并做一次恢复演练 → 在预发升级并跑完上面的回归面 → 生产先停流量、保留现场 → 若必须回滚，恢复到升级前的完整快照再切旧镜像，并确认旧版本确实支持该 schema。不要在生产库上试降级。可执行步骤与命令示例见 [Keycloak 升级与滚动更新]({{< relref "keycloak-upgrade-rolling-update" >}})。

## 参考来源

- [Keycloak 26.8.0 Release Notes](https://github.com/keycloak/keycloak/releases/tag/26.8.0)（2026-10-01 发布）
- [Keycloak Upgrading Guide](https://www.keycloak.org/docs/latest/upgrading/index.html)
- [`changes-26_8_0.adoc` @ 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/docs/documentation/upgrading/topics/changes/changes-26_8_0.adoc)（6 / 34 / 14 的分组即出自本文件）
- [`Profile.java` @ 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/common/src/main/java/org/keycloak/common/Profile.java)（`DPOP`、`CLIENT_SECRET_ROTATION`、`SCIM_API` 为 `Type.DEFAULT`；`STATELESS` 为 `DISABLED_BY_DEFAULT`；`LOGIN_FAILURES_V1`、`MULTI_SITE` 为 `DEPRECATED`）
- [Server Administration Guide — Client Policies](https://www.keycloak.org/docs/latest/server_admin/index.html#_client_policies)（`full-scope-disabled` executor 与内置客户端排除流程）
- [Keycloak 26.7.3 安全补丁解读]({{< relref "keycloak-26-7-3-security-patch" >}})、[Keycloak 26.7.4 安全补丁解读]({{< relref "keycloak-26-7-4-security-patch" >}})（同一配置面上的既有缺陷）
