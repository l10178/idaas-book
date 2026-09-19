---
title: "Grafana 接入 Keycloak OIDC：IAM 单点登录与角色映射 | IDaaS Book"
description: "Grafana 用 Keycloak OIDC 做 IAM 单点登录：client 与 redirect URI 最小配置、realm_access.roles 与 groups 的 JMESPath 角色映射、validate_id_token 验签、无角色与无邮箱登录失败的排查顺序与回滚。"
date: 2026-09-19T00:00:00+08:00
lastmod: 2026-09-19T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "solution-blogs"
    identifier: "grafana-keycloak-oidc-sso"
toc: true
---

Grafana 通常是内部监控栈里第一个被要求「接公司账号」的入口。它的 OIDC 接入有个特点：**认证部分照着官方文档抄能一次跑通，角色映射几乎总会错一次**——因为 Grafana 的 `role_attribute_path` 是 JMESPath 表达式，而 Keycloak 输出的角色 claim 是嵌套结构，官方示例里的写法在实际 realm 上求值不到。

本文给出一份可复制的最小配置，重点解释三种角色映射（realm 角色 / 组 / GrafanaAdmin）在 claim 形状上的差异，以及「登录成功但所有人都是 Viewer」「登录直接报 email 为空」这两类问题的定位顺序。

配置核对自 Grafana 官方 Generic OAuth 与 Keycloak 配置文档、`conf/defaults.ini`（`main` 分支）与 Keycloak 官方文档；核查日期 2026-09-19。核对时的 Grafana 最新发布版本为 **13.2.2**（2026-09-15），官方文档站对应 13.2.x 分支。

## 适用 / 不适用

| 场景 | 是否适用 |
|------|----------|
| 自建 Grafana（OSS 或 Enterprise）用 Keycloak 做员工单点登录 | ✅ |
| 需要把 Keycloak 的 realm 角色或组同步成 Grafana 的 Admin / Editor / Viewer | ✅ 见第 3 节 |
| 能修改 `grafana.ini`（Helm values、ConfigMap、配置文件任一方式） | ✅ |
| 需要对 Grafana Teams 做同步（Team Sync） | ⚠️ 仅 Grafana Enterprise / Cloud 支持，OSS 配了不生效，见 3.4 |
| Grafana Cloud 且用 Grafana.com 账号体系托管登录 | ❌ 云端没有本地配置文件，配置入口不同 |
| 要求 SAML 而非 OIDC | ❌ Grafana OSS 的 Generic OAuth 只覆盖 OAuth2/OIDC |
| 只是想让 Grafana 匿名只读 | ❌ 与 SSO 是两件事，不要混在一个变更里 |

## 1. Keycloak 端：client 与 claim

在目标 realm 建一个 confidential client：

| 字段 | 值 |
|------|-----|
| Client ID | `grafana` |
| Client authentication | `ON`（confidential，Grafana 在服务端换 token） |
| Standard flow | `ON` |
| Implicit flow | `OFF` |
| Direct access grants | `OFF` |
| Valid redirect URIs | `https://grafana.example.com/login/generic_oauth` |
| Web origins | `https://grafana.example.com` |
| Proof Key for Code Exchange Code Challenge Method | `S256`（与 Grafana 的 `use_pkce = true` 配套，见第 7 节） |

Default client scopes 至少保留 `email`、`profile`、`roles`；需要 refresh token 时加上 `offline_access`。

两处与 Grafana 官方示例的差异，都是本书建议：

- 官方 Keycloak 示例把 **Direct Access Grants** 设为 `ON`。SSO 接入不需要密码模式，OAuth 2.1 也已移除 Resource Owner Password Credentials，建议保持 `OFF`（背景见 [OAuth 2.1 变化解读]({{< relref "../protocols/oauth2.1-changes.md" >}})）。
- `roles` client scope 会给 ID Token 加上 **`realm_access.roles`** 与 **`resource_access.<client-id>.roles`** 两个嵌套 claim，不会产生扁平的 `roles` claim。Grafana 官方 Keycloak 示例里的 `contains(roles[*], 'admin')` 依赖扁平结构，照抄通常求值不到——正确的写法见第 3 节。角色 claim 的嵌套形状在本站资源服务器章节有同一份记录：[Spring Boot 3 资源服务器接入]({{< relref "keycloak-spring-boot-3-resource-server" >}})。

如果要用「组」驱动 Grafana 角色，再加一个 mapper：

| 字段 | 值 |
|------|-----|
| Mapper type | `Group Membership` |
| Token Claim Name | `groups` |
| Full group path | `OFF` |
| Add to ID token | `ON` |
| Add to userinfo | `ON` |

`Full group path = OFF` 的作用是把 `/grafana/admins` 写成 `grafana/admins`；Grafana 侧的表达式要与你选择的形式完全一致，差一个前导斜杠就匹配不上。这是组映射最常见的失败点。

## 2. Grafana 端最小配置

```ini
[auth.generic_oauth]
enabled = true
name = Keycloak
allow_sign_up = true

client_id = grafana
client_secret = ${KC_GRAFANA_CLIENT_SECRET}

scopes = openid profile email offline_access
auth_url = https://auth.example.com/realms/example/protocol/openid-connect/auth
token_url = https://auth.example.com/realms/example/protocol/openid-connect/token
api_url = https://auth.example.com/realms/example/protocol/openid-connect/userinfo

email_attribute_path = email
login_attribute_path = preferred_username
name_attribute_path = name

role_attribute_path = contains(realm_access.roles[*], 'grafana-admin') && 'Admin' || 'Viewer'

use_pkce = true
use_refresh_token = true
validate_id_token = true
jwk_set_url = https://auth.example.com/realms/example/protocol/openid-connect/certs
```

改完重启 Grafana，登录页会出现 `Keycloak` 登录按钮。几个被忽略的默认值值得单独说明：

- **`validate_id_token` 默认为 `false`**，即 Grafana 默认不校验 ID Token 的签名。要打开签名校验必须同时配 `jwk_set_url`，否则认证直接失败（官方明确写了这条前置条件）。
- **`use_pkce` 默认为 `false`**。打开后 Grafana 用 S256 挑战方法；Keycloak 端的 client 需要把 PKCE 方法设为 `S256`，否则授权请求会被拒绝。
- **`api_url` 不是必需的**。ID Token 已包含所需信息时它会额外增加一次登录期请求；官方建议把它当作 fallback 保留，因为**组数量较多的用户**（官方给出的量级是超过 150 个组成员关系）需要从 UserInfo 端点取组。
- `email_attribute_path` 建议显式写出来。Grafana 强依赖 email：即使你把 login 映射成 `sub`，**没有 email 仍然无法登录或建号**。

## 3. 角色映射：先搞清 claim 形状，再写表达式

Grafana 的求值顺序是固定的：**先对 ID Token 求值，取不到再对 UserInfo 求值，仍取不到再对 Access Token 求值**。这条顺序解释了为什么「mapper 只加了 userinfo」也能工作，但登录会多一跳；也是排查时应该先确认 ID Token 内容的理由。

### 3.1 按 realm 角色映射

```ini
role_attribute_path = contains(realm_access.roles[*], 'grafana-admin') && 'Admin' ||
                      contains(realm_access.roles[*], 'grafana-editor') && 'Editor' || 'Viewer'
```

注意表达式求值的对象是 `realm_access.roles`，不是 `roles`。如果 realm 里角色是通过组继承来的，记得用户的实际角色列表里已经包含继承结果。若某类用户完全没有 realm 角色（例如只有客户端角色），`realm_access` 可能整段缺失，表达式会求值失败——此时把组作为兜底条件并列进同一条表达式，比依赖默认角色更可控。

### 3.2 按组映射（推荐的组织方式）

组的好处是它对应组织结构而不是零散角色名，离职/转岗时改组即可。

```ini
role_attribute_path = contains(groups[*], 'grafana-admins') && 'Admin' ||
                      contains(groups[*], 'grafana-editors') && 'Editor' || 'Viewer'
groups_attribute_path = groups
```

`groups_attribute_path` 本身只用于「取出组列表」；真正决定 Grafana 组织角色的是 `role_attribute_path`。两者不要混为一谈——这也是很多配置里 `groups_attribute_path` 配了却看不到任何效果的原因。

如果只想让某个组的人能登录（其余人直接拒绝），用门禁而不是角色：

```ini
groups_attribute_path = groups
allowed_groups = grafana-viewers,grafana-editors,grafana-admins
```

`allowed_groups` 的官方语义是「用户必须至少属于列出的一个组才能登录」，并且**必须同时配置 `groups_attribute_path`**，否则它没有可比较的数据。

### 3.3 严格模式：没有角色就不放进来

默认情况下，表达式取不到有效角色时，Grafana 会按 `auto_assign_org_role` 的默认值给用户一个角色——通常就是 Viewer。对只想让特定人群看到监控数据的团队，这是「悄悄放行」：

```ini
role_attribute_strict = true
```

打开后，`role_attribute_path` 与 `org_mapping` 都取不到有效角色时，用户**无法登录**（官方语义：deny user access）。把它当作组映射上线时的安全默认值，比事后再审计用户列表省事。

### 3.4 GrafanaAdmin、多组织与 Team Sync 的边界

```ini
allow_assign_grafana_admin = true
role_attribute_path = contains(realm_access.roles[*], 'grafana-admin') && 'GrafanaAdmin' || 'Viewer'
```

`allow_assign_grafana_admin` 的语义容易误读：**只有它为 `true` 时**，表达式返回 `GrafanaAdmin` 才会授予 Grafana 服务器管理员权限；为 `false`（默认）时，同一个返回值只会给到组织管理员。也就是说，想用 SSO 分发服务器管理员权限，这两个配置必须成对出现。

需要按部门落到不同组织时，用 `org_attribute_path` + `org_mapping`（表达式返回值必须是数组，不能是字符串）；同时配置 `role_attribute_path` 时，用户拿到两者中更高的角色。

**Team Sync（把 IdP 组映射成 Grafana Teams）只存在于 Grafana Enterprise 与 Grafana Cloud。** OSS 版本配置 `groups_attribute_path` 不会带来 Team 同步——OSS 侧要按组授权，就落到 `role_attribute_path` 或 `allowed_groups` 上。

## 4. 验证顺序：不要靠「登录试试看」

按下面的顺序验证，每一步都能单独定位问题，不需要在浏览器里反复试：

**第一步：在 Keycloak 里预览 claim，而不是猜。** 管理控制台 → Clients → `grafana` → Client scopes → 选一个 scope → **Evaluate**，选一个测试用户，直接查看生成的 ID Token / UserInfo claims。这一步能看到 `realm_access.roles`、`groups` 的真实层级和取值，也决定了第 3 节该用哪条表达式。

**第二步：离线验证 JMESPath。** 把第一步里的 ID Token payload 拿到 Grafana 官方推荐的 [JMESPath 测试页](http://jmespath.org/)（或本地 JMESPath 工具）上，用目标用户的实际 payload 求值，确认返回的是 `Admin` / `Editor` / `Viewer` 之一，而不是 `null`。这一步能一次性排除「表达式写错」和「claim 形状不一致」两类问题。

```bash
# 如果手头只有一份 ID Token（测试 realm 用），可以直接看 payload
jq -R 'split(".") | .[1] | @base64d | fromjson' <<< "$ID_TOKEN"

# 关注三个位置：realm_access.roles / resource_access.<client-id>.roles / groups
```

**第三步：看 Grafana 里用户的真实角色。** 登录后到 Administration → Users，查看该用户所在组织与组织角色；服务器管理员身份在用户列表的 Grafana Admin 列。**注意用户角色是登录时同步的**，配置改完之后要用新会话重新登录（或让用户重新登录）才会生效——「改了配置但角色没变」的相当一部分案例，其实是旧会话还没过期。

## 5. 常见错误对照表

| 症状 | 根因 | 修复 |
|------|------|------|
| 回调到 Grafana 报 invalid redirect URI / Keycloak 返回 `Invalid parameter: redirect_uri` | Valid redirect URIs 与浏览器实际访问地址不一致（反向代理域名、`root_url` 未配） | 配好 `[server] root_url`，并把 `https://<root_url>/login/generic_oauth` 精确加进 Valid redirect URIs |
| 登录报用户邮箱为空、无法建号 | 未请求 `email` scope，或 email 不在顶层 claim | scopes 加 `email`，必要时配 `email_attribute_path` |
| 登录成功，但所有人都是 Viewer | `role_attribute_path` 与真实 claim 形状不匹配（照抄了扁平的 `roles[*]`） | 按第 3 节改用 `realm_access.roles[*]` 或 `groups[*]` |
| 组里有人是 Admin，但拿不到 Admin | 组 claim 没进 ID Token，或 `Full group path` 与表达式的斜杠形式不一致 | mapper 勾选 Add to ID token；统一 `Full group path` 与表达式写法 |
| `groups_attribute_path` 配了，权限没变化 | 混淆了「取组」与「定角色」 | 角色仍由 `role_attribute_path` 决定，见 3.2 |
| Team Sync 无任何效果 | OSS 不支持 | 用 `role_attribute_path` / `allowed_groups` 替代 |
| 组成员多的人拿不到正确角色 | ID Token 的组声明不完整 | 保留 `api_url`，走 UserInfo 兜底 |
| 打开 `validate_id_token` 后登录失败 | `jwk_set_url` 指向了 discovery 文档 | 改为 `https://<keycloak>/realms/<realm>/protocol/openid-connect/certs` |
| 开启 `use_pkce` 后授权请求被拒 | Keycloak client 未设 PKCE 方法 | 客户端 Advanced → `S256` |
| access token 过期后被登出 | 未启用 refresh token | scopes 加 `offline_access` + `use_refresh_token = true` |

## 6. 单点登出

Grafana 检测到登录方式为 OAuth 时会**自动在登出请求里附加 `id_token_hint`**，你只需要配好回跳地址：

```ini
[auth.generic_oauth]
signout_redirect_url = https://auth.example.com/realms/example/protocol/openid-connect/logout?post_logout_redirect_uri=https%3A%2F%2Fgrafana.example.com%2Flogin
```

`post_logout_redirect_uri` 必须做 URL 编码，且**不能携带 `state`、`code`、`session_state` 这类 OIDC 保留参数**——Keycloak 的 forbidden-parameter 检查会直接拒绝这类回跳地址（26.7.3 起对 redirect URI 中的 OIDC 参数校验更严格）。登出相关配置与故障对照见 [Keycloak 单点登出不彻底排查](/blog/keycloak-single-logout/)。

## 7. 安全加固清单

- [ ] `validate_id_token = true` + 正确的 `jwk_set_url`（默认不校验签名）。
- [ ] `use_pkce = true`，并在 Keycloak client 上启用 `S256`。
- [ ] `role_attribute_strict = true`，避免无角色用户按默认角色进入。
- [ ] `allow_sign_up` 按需：`true` 表示首次登录自动建号；受控场景可设为 `false`，只允许已存在的 Grafana 用户登录。
- [ ] client secret 走 Secret 管理（Helm secret / K8s Secret / 环境变量），不要写进 ConfigMap 或版本库。
- [ ] 不要打开 `tls_skip_verify_insecure`；内部 CA 签发的 Keycloak 证书应把 CA 装进 Grafana 信任链。
- [ ] 多副本 Grafana 的 `grafana.ini` 分发必须一致；用 UI 改的 SSO 配置在 HA 集群里不会立即同步到所有实例（官方对此有明确提示）。

## 8. 回滚

Grafana 侧的 SSO 回滚比 Keycloak 侧轻，但仍要留一条后路：

1. **始终保留一个能用的本地管理员账号**。只留 SSO 登录路径的部署，在 Keycloak 故障时会同时失去 Grafana 的运维入口。
2. 回滚配置：把 `[auth.generic_oauth] enabled` 改为 `false`（或注释整段）后重启 Grafana，登录页回到本地账号；已通过 SSO 创建的用户记录不会消失，但需要用本地账号或重新启用 SSO 后才能登录。
3. 多副本 HA 部署要确认所有实例都改到并完成滚动重启，否则会出现「部分实例仍在 SSO」的混合状态。
4. Keycloak 侧若要彻底撤销：删除 client 与对应 mapper；如果组映射已经用于授权，先确认没有其他应用复用同一组名，避免连带影响。

## 常见问题（IAM 单点登录）

**Q1：Grafana 的 IAM 角色应该由 Keycloak 的 realm 角色还是组驱动？**

看授权变更由谁发起。角色由集中管理 IAM 平台维护、变更走审批的团队用 realm 角色；权限跟着组织架构走、经常需要按部门/分子公司批量调整的团队用组。两者在 Grafana 侧的写法不同但机制一致（第 3 节），不建议同时用两套来源，否则角色冲突时难以解释。

**Q2：`role_attribute_path` 和 `groups_attribute_path` 到底哪个决定权限？**

`role_attribute_path` 决定 Grafana 的组织角色（Admin/Editor/Viewer），`groups_attribute_path` 只是把组列表取出来，供 Team Sync（Enterprise/Cloud）或 `allowed_groups` 使用。OSS 部署里只配 `groups_attribute_path` 不会改变任何权限。

**Q3：为什么 Keycloak 用户明明有邮箱，Grafana 还是说 email 为空？**

常见原因是邮箱不在 ID Token 顶层（例如只放在 UserInfo、或被自定义 mapper 映射到了别的路径），或者 scope 里没有 `email`。Grafana 建号与登录**强依赖 email**：先按第 4 节第一步确认 ID Token 里 `email` 的实际位置，再用 `email_attribute_path` 指过去。

**Q4：这套配置在 Grafana Enterprise / Grafana Cloud 上有何区别？**

认证配置项本身一致（Cloud 通过 UI/API 配置，没有本地 `grafana.ini`）；差异在 Team Sync：只有 Enterprise 与 Cloud 支持把 IdP 组同步成 Grafana Teams。OSS 用组驱动授权时，必须落在 `role_attribute_path` 或 `allowed_groups` 上。

**Q5：改完配置后用户角色没变化？**

角色在**登录时**同步，已登录会话不会立刻更新。先让用户重新登录再判断；确认仍不对时，按第 4 节的顺序从 claim 预览 → JMESPath 离线求值 → 用户实际角色逐层回查，不要直接在 Grafana 里手改角色掩盖问题。

## 参考来源

- [Grafana：Configure Keycloak OAuth2 authentication](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/keycloak/)（client 设置、client scopes、组 mapper、单点登出、refresh token）
- [Grafana：Configure Generic OAuth authentication](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/generic-oauth/)（登录名/邮箱/显示名解析顺序、角色映射求值顺序、`role_attribute_strict`、`validate_id_token`、PKCE）
- [Grafana：Configure Grafana 配置项参考](https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/#authgeneric_oauth)（`auth.generic_oauth` 各选项默认值与语义）
- [Grafana `conf/defaults.ini`（`main` 分支，选项默认值）](https://github.com/grafana/grafana/blob/main/conf/defaults.ini)
- [Grafana v13.2.2 发布](https://github.com/grafana/grafana/releases/tag/v13.2.2)（本文核对时的最新发布版本）
- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html)（client scope、Group Membership mapper、角色 claim 结构）

相关章节：[Keycloak 细粒度权限与授权策略实战]({{< relref "keycloak-fine-grained-authz" >}})、[Spring Boot 3 资源服务器接入 Keycloak]({{< relref "keycloak-spring-boot-3-resource-server" >}})、[OAuth 2.1 变化解读]({{< relref "../protocols/oauth2.1-changes.md" >}})、[Keycloak 单点登出不彻底排查](/blog/keycloak-single-logout/)。
