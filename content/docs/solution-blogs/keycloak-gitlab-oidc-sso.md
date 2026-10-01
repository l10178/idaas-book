---
title: "GitLab 接入 Keycloak OIDC：IAM 单点登录、组权限映射与排错 | IDaaS Book"
description: "GitLab 用 Keycloak 做 IAM 单点登录：OmniAuth openid_connect 最小配置、uid_field 一次性决策带来的重复账号、组映射的 Premium/Ultimate 版本边界与 full.path 精确匹配、Realm 用 HS256 时的 JSON::JWS::VerificationFailed、discovery/issuer 与 userinfo 401 的定位顺序、验证与回滚。"
summary: "自建 GitLab 接 Keycloak 的配置量不大，但有三处只能选一次的决定：uid_field、签名算法、组 claim 的形状。本文给出可复制的最小配置、CE 与 EE 的能力边界、以及重复账号这类不可逆后果的规避方式。"
date: 2026-10-01T23:05:00+08:00
lastmod: 2026-10-01T23:05:00+08:00
draft: false
weight: 98
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-gitlab-oidc-sso"
toc: true
---

## 场景

- 自建 GitLab 要接公司 Keycloak，登录页出现了按钮，点下去却报 `invalid_client`、或者回调回来提示认证失败；换一套凭据重试仍然一样。
- 登录能成功，但**所有人都能进**（`required_groups` 没起作用），或者反过来**所有人都进不来**；也可能是同一批人登录后全被标成外部用户。
- 更麻烦的一类：接入后 GitLab 里开始出现"重复的人"——同一个员工既有原来的本地账号，又多了一个 SSO 账号，且必须人工逐个处理。

GitLab 是 OmniAuth 体系里配置项最杂的一个客户端：`gitlab.rb` 里的字段名、Keycloak 客户端的形态、以及 GitLab 版本（CE/EE）共同决定行为。本文只写这三层之间的对应关系与出错时的定位点；Keycloak 客户端本身的通用配置（client、Protocol Mapper、redirect URI 组织方式）见 [Keycloak IAM 第三方软件集成指南]({{< relref "../keycloak/integrations/index" >}})。

配置与语义核对自 GitLab 官方文档 `doc/administration/auth/oidc.md` 与 `doc/integration/omniauth.md`（main 分支，核对时 gitlabhq 仓库最新稳定标签为 v19.4.1）、omniauth_openid_connect 的 README 与策略源码，以及 Keycloak 26.8.0 源码；核查日期 2026-10-01。GitLab 的 OIDC 文档仍在演进（Azure 相关章节近两个大版本内被多次重写），升级后建议按第 6 节重跑一次验证。

## 适用 / 不适用

| 场景 | 是否适用 |
|------|----------|
| 自建 GitLab（Omnibus 或源码）用 Keycloak 做员工单点登录 | ✅ |
| 需要按 Keycloak 的组限制"谁能登录 GitLab"、标记外部用户或授予管理员 | ⚠️ 仅 Premium / Ultimate，见第 4 节 |
| 想让 Keycloak 的组自动变成 GitLab 的群组和项目成员 | ❌ GitLab 明确说明该功能做不到，组只影响登录准入与用户属性 |
| 用 GitLab.com（SaaS）接自建 Keycloak | ❌ 该配置只在 Self-Managed 生效；SaaS 侧只有 Group SAML/SCIM 路线 |
| 需要把 GitLab 当作 OIDC 提供方（别的系统接 GitLab） | ❌ 这是反向配置，见 GitLab 的 OpenID Connect identity provider 文档 |
| 目标是 SCIM 自动开通/回收 GitLab 账号 | ❌ 与本篇无关：GitLab 的 SCIM 面向群组（且为 EE），OmniAuth 侧只有登录时即时建号 |

## 两条先决约束

这两条不满足，后面怎么调都是白费。

**1. Keycloak 必须对 GitLab 以 HTTPS 暴露。** GitLab 官方在 Keycloak 章节写明：GitLab 只与使用 HTTPS 的 OpenID 提供方协作。内网用例外的 HTTP issuer 在这里走不通，必须先把证书和域名处理好（hostname 与 issuer 的关系见 [Keycloak Hostname v2 配置与 v1 选项迁移]({{< relref "keycloak-hostname-v2-config" >}})）。

**2. Realm 的签名算法不能是 HS256。** GitLab 通过 JWKS 验签 ID Token，共享密钥签名（HS256/HS384）它无从校验，症状是 `JSON::JWS::VerificationFailed`。首选做法是保持非对称签名：

> Realm Settings → Tokens → Default Signature Algorithm

设为 `RS256`（或 `RS512`）。如果因为历史原因必须用对称密钥，GitLab 官方给出的绕法是 `jwt_secret_base64`：从 Keycloak 数据库的 `hmac-generated` component 里取出签名密钥（界面上看到的 client secret 不是它），把 URL-safe base64 转成标准 base64 后填进去。这条路要连数据库、要在升级时重新取值，工程上不如直接切 RSA——而且 RS256 本来就是 Keycloak 新 Realm 的默认值，改回 HS256 只会把风险转移到自己身上。

## Keycloak 侧最小配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| Client ID | `gitlab` | 与 GitLab 侧 `client_options.identifier` 一致 |
| Client authentication | **On**（confidential） | GitLab 会用 client secret 认证；配成 public 会导致取 userinfo/Token 阶段失败 |
| Standard flow | On | GitLab 走授权码流程 |
| Valid redirect URIs | `https://gitlab.example.com/users/auth/openid_connect/callback` | 逐字符匹配：路径是 OmniAuth 的固定回调路径，不是 `/users/auth/openid_connect` |
| Web Origins | 留空 | GitLab 是服务端 OIDC 客户端，浏览器不直连 Keycloak；配了只会扩大允许来源，原因见 [Keycloak Web Origins 与 CORS 排错](/blog/keycloak-cors-web-origins/) |
| Proof Key for Code Exchange Code Challenge Method | 保持默认（可留空） | Keycloak 接受带 PKCE 的请求；若这里设成 `S256`，则该客户端所有授权码请求都必须带 PKCE——GitLab 开 `pkce: true` 正好满足，其它客户端不一定 |

`client_id` 建议与 GitLab 实例名一致（例如 `gitlab`），不要复用给别的应用——后续要把 `uid_field` 或组映射当作一次性决策来管理，多应用共用一个 client 会让这件事没法做。

## GitLab 侧配置

### 最小可用块

```ruby
# /etc/gitlab/gitlab.rb
gitlab_rails['omniauth_providers'] = [
  {
    name: "openid_connect",          # 不要改，OmniAuth 的路由名
    label: "Keycloak",               # 登录页按钮文案
    args: {
      name: "openid_connect",
      scope: ["openid", "profile", "email"],
      response_type: "code",
      issuer: "https://keycloak.example.com/realms/myrealm",
      discovery: true,
      client_auth_method: "query",
      uid_field: "preferred_username",
      pkce: true,
      client_options: {
        identifier: "gitlab",
        secret: "<CLIENT_SECRET>",
        redirect_uri: "https://gitlab.example.com/users/auth/openid_connect/callback"
      }
    }
  }
]

gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_auto_link_user'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
```

改完必须 `gitlab-ctl reconfigure` 才生效；只 `restart` 不会重读 `gitlab.rb`。

### 每个字段各自的取舍

| 字段 | 作用 | 容易踩的地方 |
|------|------|-------------|
| `discovery: true` | 从 `<issuer>/.well-known/openid-configuration` 取各端点与 `jwks_uri` | 关掉它就必须手填 authorization/token/userinfo/jwks 四个地址，维护量更大且容易只改一半 |
| `issuer` | 发现地址的 base URL，同时用于校验 ID Token 的 `iss` | 必须与 discovery 文档里的 `issuer` 完全一致。Keycloak 侧 `hostname` 决定这个值，内网/公网双域名下极易不一致，报错只会显示 issuer 不匹配 |
| `uid_field` | 作为 GitLab 身份唯一标识的 claim | 见下节，这是本篇唯一不可逆的字段 |
| `client_auth_method` | Token 端点用哪种客户端认证 | GitLab 官方 Keycloak 示例写的是 `query`；官方排错文档说明该字段未设置或设为 `basic` 时走 HTTP Basic 发送凭据。保留官方示例的值，不要照搬其它 IdP 示例，改完要重跑一次登录验证 |
| `pkce: true` | 授权码流程加 PKCE | gem 默认是 `false`。GitLab 官方 Keycloak 示例显式开了它，建议保持 |
| `send_scope_to_token_endpoint` | 是否把 `scope` 也发给 token 端点 | gem 默认为 `true`。有提供方不接受这个参数才需要关；Keycloak 接受，官方示例也没关，不要多此一举 |
| `auto_link_user` | 同邮箱的既有 GitLab 账号自动绑定 SSO 身份 | 不配就只会走引导绑定流程，结果就是"一个人两个账号"。**它把 GitLab 账号的控制权交给了邮箱：** 先确认 Keycloak 侧邮箱是已验证的，否则等于允许用邮箱占位建号 |
| `block_auto_created_users` | 新用户创建后是否需要管理员批准 | 首次上线的稳妥做法是设 `true`，先放行几个人验证通过后再放开 |

### `uid_field`：唯一必须一次选对的字段

omniauth_openid_connect 默认用 `sub` 作为唯一标识；GitLab 官方文档给出的 Keycloak 示例用的是 `preferred_username`。两者后果不同：

| 取值 | 稳定性 | 可读性 | 风险 |
|------|--------|--------|------|
| `sub`（默认） | 高。Keycloak 侧是用户 UUID，改名不影响 | 差。GitLab 里看到的是 UUID | 运维查问题时认不出人 |
| `preferred_username` | 中。等于用户名，**在 Keycloak 里改用户名就会变** | 好 | 改名会被 GitLab 当成新身份，生成一个新账号 |

官方对这件事的措辞很直接：**没有设置（或改动）`uid_field` 会导致 GitLab 中产生额外的身份记录，并且需要人工处理**。所以顺序是：先决定用 `sub` 还是 `preferred_username`，写进配置并固定下来；如果一定要从一种切到另一种，就当一次数据迁移来做——先盘点存量身份、选好合并窗口，而不是在业务时间直接改配置。

## 组映射：先看版本，再看 claim 形状

**版本边界先行：** GitLab 官方把 "Configure users based on OIDC group membership" 标注为 **Premium / Ultimate**。社区版（Free）配了 `required_groups`、`admin_groups`、`external_groups` 一律不生效，也不会有报错——这是最容易浪费一整天的地方。CE 想按组限制准入，只能靠 Keycloak 侧（例如给 GitLab 专用的 client 单独做认证流程/条件判断）或改用 SAML/Group 方案。

EE 上的语义如下（官方文档原文口径）：

| 设置 | 含义 | 边界 |
|------|------|------|
| `groups_attribute` | 从哪个 claim 里取组列表 | IdP 必须真的把组放进 OIDC 响应 |
| `required_groups` | 只有命中其中任意一个组才能登录 | **不设或留空 = 任何 IdP 用户都能进**。配错时会表现为"所有人都进不来" |
| `external_groups` | 命中即把用户标记为外部用户 | 外部用户的可见范围受限，批量误标会引发大量工单 |
| `admin_groups` | 命中即授予管理员 | 每次登录重新判定 |
| `auditor_groups` | 命中即授予审计员 | 同上 |

三条官方明确的行为：GitLab **在每次登录时检查这些组并更新用户属性**；该功能**不会**把用户自动加入 GitLab 群组；组的值必须与 IdP 返回值一致（官方举的 Entra 例子是 GroupID，不是组名）。

最后一条落到 Keycloak 上就是 `groups` claim 的**形状**问题。Keycloak 的 Group Membership mapper（`oidc-group-membership-mapper`）由 `full.path` 决定输出：

- `full.path = true`：claim 形如 `/gitlab-users`（完整路径）
- `full.path = false`：claim 形如 `gitlab-users`（只有组名）

GitLab 侧是拿 claim 原值做比较，所以 `required_groups` 必须写成与 claim 完全一致的形式。推荐 `full.path = true` 并在配置里写 `/gitlab-users`——关闭它会带来同名层级组的歧义：`/platform/ops` 和 `/legacy/platform/ops` 会退化成同一个值 `ops`（这一点与 [Argo CD 接入 Keycloak OIDC]({{< relref "keycloak-argocd-oidc-sso" >}}) 里 Casbin policy 遇到的是同一个 claim）。

还有一个只在声明式导入时出现的坑：Keycloak 源码的 `useFullPath()` 判定是 `"true".equals(config.get("full.path"))`——**配置里没有这个键就等于 `false`**。Admin Console 里新建 mapper 时界面默认值是 `true`，但用 `kcadm`、partial import、Terraform 之类的方式创建 mapper 时如果漏掉 `"full.path": "true"`，claim 会静默变成不带斜杠的形式，登录一切正常、组限制全部落空。

```ruby
# 在 provider 的 args 内追加；gitlab: 块挂在 client_options 下
client_options: {
  identifier: "gitlab",
  secret: "<CLIENT_SECRET>",
  redirect_uri: "https://gitlab.example.com/users/auth/openid_connect/callback",
  gitlab: {
    groups_attribute: "groups",
    required_groups: ["/gitlab-users"],
    external_groups: ["/contractors"],
    admin_groups: ["/gitlab-admins"]
  }
}
```

Keycloak 侧对应地给该 client 加一个 Group Membership mapper，claim 名用 `groups`，并勾选写入 ID Token（GitLab 读的是 OIDC 响应，只写 access token 不会生效）。

## 常见错误对照表

| 症状 | 根因 | 处理 |
|------|------|------|
| 点登录按钮后报 `invalid_client` / `Could not authenticate you from OpenIDConnect` | client secret 与 Keycloak 端不一致；或 `identifier` 写错；或 Keycloak 客户端被配成了 public | 核对 Keycloak 客户端 Credentials 页与 `client_options`；确认 Client authentication 为 On |
| Keycloak 返回 `Invalid parameter: redirect_uri` | `Valid redirect URIs` 与 GitLab 的 `redirect_uri` 不是同一字符串（漏了 `/users/auth/openid_connect/callback` 或用了 http） | 两边逐字符比对，包含 scheme 与端口 |
| `JSON::JWS::VerificationFailed` | Realm 用 HS256/HS384 签名，GitLab 用 JWKS 验不了 | Realm Settings → Tokens → Default Signature Algorithm 改 `RS256`；确需对称密钥则按官方方式配 `jwt_secret_base64` |
| discovery 失败 / issuer 不匹配 | `issuer` 与 discovery 的 base URL 不一致；或 Keycloak 前面有代理导致对外域名与 Pod 内域名不同 | 先用第 6 节第 1 步读回 discovery，再对齐 Keycloak `hostname` 配置 |
| 登录时报时间相关错误、间歇性失败 | 主机时钟不同步导致 ID Token 的 `iat`/`exp` 校验失败（GitLab 排错文档的第一条就是这个） | 两侧都接 NTP，检查容器与宿主机时间 |
| 调用 userinfo 返回 401 | `client_auth_method` 与提供方期望不一致；或链路上的代理吞掉了 Basic 认证头 | 显式设置该字段并重跑登录；检查前置代理是否透传 `Authorization` |
| 能登录，"组限制/管理员授权"完全没生效 | 版本是 CE；或 mapper 没勾 ID Token；或 `full.path` 形式与 `required_groups` 不一致 | 先确认 EE，再解码 ID Token 看 `groups` 实际形状，然后让配置逐字符对齐 |
| 出现重复账号（同人多号） | `uid_field` 被改动；或 `auto_link_user` 未开 | 固定 `uid_field`；需要自动绑定则配 `auto_link_user`；已产生的重复身份需人工合并，不能靠再改一次配置回滚 |
| 所有人都被标成外部用户 | `external_groups` 命中了过宽的组名 | 收紧组名；先在预发验证标记结果 |
| 登录正常但登出后立刻自动登回 | 这是 `auto_sign_in_with_provider` 的已知行为（用户必须先登出 IdP） | 需要严格登出时见 [IAM 单点登出排错](/blog/keycloak-single-logout/) |
| `reconfigure` 后配置没生效 | 只执行了 `gitlab-ctl restart` | OmniAuth 配置在 `gitlab.rb`，必须 `gitlab-ctl reconfigure` |

## 验证

按顺序做，前三步能在接触业务流量之前把绝大多数问题挡住：

```bash
# 1. discovery：issuer 必须与 gitlab.rb 里的 issuer 逐字符一致，
#    同时确认签名算法不是 HS256
curl -s https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration \
  | jq '{issuer, authorization_endpoint, token_endpoint, userinfo_endpoint, jwks_uri, id_token_signing_alg_values_supported}'

# 2. 授权入口可用：应 302 到 Keycloak 的授权端点，并且带上 client_id 与 redirect_uri
curl -sS -o /dev/null -D - https://gitlab.example.com/users/auth/openid_connect \
  | grep -i '^location'

# 3. 回调路径与 Keycloak 白名单一致：把第 2 步 Location 里的 redirect_uri 与
#    Keycloak 客户端的 Valid redirect URIs 对比（不要凭记忆）

# 4. 落地后核对身份与组是否按预期写入
gitlab-rails console
> u = User.find_by_username('someone')
> u.identities.map { |i| [i.provider, i.extern_uid] }   # extern_uid = uid_field 的取值
> u.external                                            # external_groups 命中时为 true
> u.admin                                               # admin_groups 命中时为 true
```

第 4 步是判定组映射是否真的生效的唯一可靠方式：组限制出错时登录页面不会给任何提示，"能登录"和"组生效"是两件事。另外，`required_groups` 配错会让**所有** SSO 用户被拒（含管理员），所以改这一项前先确认还有一个本地管理员账号可以登录。

## 回滚

改动集中在一个文件加一个 Keycloak 客户端，回滚路径清晰，但顺序要对：

1. **先停止产生新账号**：`gitlab_rails['omniauth_allow_single_sign_on'] = false`，再 `gitlab-ctl reconfigure`。这一步比拆 provider 更紧急——回滚窗口里继续自动建号，就是继续产生需要人工合并的身份。
2. **移除 provider**：注释掉 `omniauth_providers` 中该块（或整块移除）后 `gitlab-ctl reconfigure`。登录页按钮消失，本地账号密码登录不受影响，这是最低风险的回退姿态。
3. **恢复组限制**：如果只是组配置出错，把 `required_groups` 清空（官方语义：空 = 不限制）即可恢复登录；`admin_groups`/`external_groups` 的标记会在下次登录时按组重新计算，因此**不要**在回滚时手改用户属性，否则与登录后的重算结果冲突。
4. **处理已产生的身份**：`identities` 记录可以逐个删除，但删除不等于恢复——用户下次 SSO 登录还会按当前 `uid_field` 重新绑定。真正的"回滚"是把 `uid_field` 改回原值；只有在确认原值是错的、且做好账号合并方案时才动它。
5. **Keycloak 侧 client 保留**：不要顺手删掉客户端。客户端删了，用户 ID 与 `sub` 的对应关系也随之失去参照，下次重接会重新产生一批身份。

风险提示：这套配置的失败模式有两类，一类是"登录直接失败"（容易发现），另一类是"登录成功但身份或组不对"（不容易发现）。上线时至少安排一次针对后者的检查：随机抽 2-3 个不同组的人，按第 4 节核对 `extern_uid`、`external`、`admin` 三个值。

## 参考来源

- GitLab 官方文档 [Use OpenID Connect as an authentication provider](https://docs.gitlab.com/administration/auth/oidc/)（`doc/administration/auth/oidc.md`）：Keycloak 示例配置、签名算法要求与 `jwt_secret_base64`、`uid_field` 变更后果、Group membership（Tier: Premium, Ultimate）、Troubleshooting
- GitLab 官方文档 [OmniAuth](https://docs.gitlab.com/integration/omniauth/)（`doc/integration/omniauth.md`）：`allow_single_sign_on`、`auto_link_user`、`block_auto_created_users`、`auto_sign_in_with_provider` 的语义
- [omniauth_openid_connect README](https://github.com/omniauth/omniauth_openid_connect)：`client_auth_method`、`uid_field`、`pkce`、`send_scope_to_token_endpoint` 的默认值；策略源码中 `client_auth_method` 随 token 请求下发
- Keycloak 26.8.0 源码 [`GroupMembershipMapper.java`](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/protocol/oidc/mappers/GroupMembershipMapper.java)：`full.path` 默认值、帮助文本与 `useFullPath()` 的字面判定
