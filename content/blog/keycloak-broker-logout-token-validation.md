---
title: "Keycloak 身份代理登出验签：CVE-2026-18569 与 26.8 升级准备"
description: "Keycloak 作为 IAM 身份代理时，上游 OIDC IdP 的 backchannel logout 令牌会跟着 Validate Signatures 开关一起被跳过验签（CVE-2026-18569）：26.7.4 及更早版本接受 alg=none 的伪造登出令牌，可强制登出 brokered 用户并撤销其离线会话。本文给出令牌校验链路与源码依据、受影响配置的盘点命令、现在可用的加固方式、验证步骤，以及 26.8 起强制验签后必须提前准备的密钥与回滚顺序。"
summary: "把 OIDC IdP 的「Validate Signatures」关掉，会连带放过身份代理方向的登出令牌：26.7.4 及更早接受 alg=none 的伪造登出令牌（CVE-2026-18569）。修复 PR #52171 尚未合入，登记在 26.8.0 升级说明里——升级前必须补上公钥或 JWKS，否则上游登出传播会在升级后失效。"
date: 2026-09-25T21:00:00+08:00
lastmod: 2026-09-25T21:00:00+08:00
draft: false
weight: 38
images: []
categories: ["Keycloak", "IAM"]
tags: ["Keycloak", "identity-brokering", "backchannel-logout", "validateSignature", "CVE-2026-18569", "IAM", "troubleshooting"]
contributors: []
pinned: false
homepage: false
seo:
  title: "IAM 身份代理登出验签：CVE-2026-18569 与 Keycloak 26.8 升级准备"
  description: "Keycloak 代理 OIDC IdP 时，Validate Signatures 关闭会连带跳过 backchannel logout 令牌验签（CVE-2026-18569）：受影响配置盘点、加固配置、验证步骤与 26.8 强制验签的升级准备。"
  canonical: ""
  noindex: false
---

## 场景

三个条件同时成立，才落在这条风险里：

1. realm 里配了 OIDC 身份代理（企业 IdP，或上游是另一个 Keycloak），用户是经上游登录进来的 brokered 用户；
2. 这个 IdP 的 **Validate Signatures** 处于关闭状态（`config.validateSignature` 缺失或为 `false`）；
3. 上游会把 backchannel logout 令牌发给 Keycloak，用来通知「这个用户在上游 IdP 侧已经登出」。

满足这三条时，Keycloak 的登出端点会接受**没有签名**的登出令牌。一个知道上游 issuer、broker 的 client ID，以及目标用户上游 `sub`（或上游会话 `sid`）的人，可以把该用户在 Keycloak 里的全部会话强制登出，并撤销其离线会话。这就是 **CVE-2026-18569**。

**版本现状（核对日期 2026-09-25）**：当前稳定版 **26.7.4**（2026-09-16 发布）仍然受影响；修复 PR [#52171](https://github.com/keycloak/keycloak/pull/52171) 在 `main` 上仍为 open，没有进入任何已发布版本，修复内容登记在升级说明 `changes-26_8_0.adoc`，也就是随 **26.8.0** 发布。上游 `main` 的 `pom.xml` 仍是 `999.0.0-SNAPSHOT`，仓库里不存在 26.8 的 tag 或 release。

**适用**：Keycloak 26.x，realm 中启用了 OIDC 身份代理；需要在升级前确认自己是否受影响，或正在判断「到底要不要给上游 IdP 配公钥」。

**不适用**：客户端方向的登出（RP-Initiated Logout、客户端侧的 Back-Channel Logout）——那是反方向的另一条链路，见 [IAM 单点登出排错]({{< relref "blog/keycloak-single-logout" >}})；SAML 身份代理（SAML SLO 走 Redirect/POST binding，不经过这个端点）；realm 里没有 OIDC 身份代理的部署。

## 登出令牌从哪个端点进来，谁在验签

入口与客户端方向共用同一个端点，区别在于令牌的 `iss` 指向谁：

```text
POST /realms/{realm}/protocol/openid-connect/logout/backchannel-logout
Content-Type: application/x-www-form-urlencoded
body: logout_token=<JWT>
```

`LogoutEndpoint.backchannelLogout()` 拿到表单里的 `logout_token` 后，调用链是：

```text
TokenManager.verifyLogoutToken()
  └─ getOIDCIdentityProviders()          按令牌 iss 在 realm 里找候选 OIDC IdP
      └─ validateLogoutTokenAgainstIdpProvider()
          └─ OIDCIdentityProvider.validateToken()      ← aud / iss / 时间窗口
              └─ parseTokenInput(encoded, shouldBeSigned=true)
                  └─ verify(jws)                       ← 签名校验在这里
```

候选 IdP 的筛选条件就是令牌的 `iss` 等于 IdP 配置的 Issuer（`IdentityProviderQuery.userAuthentication().with(ISSUER, ...)`）。命中之后，Keycloak 用 `alias + "." + sub`（broker user id）或 `alias + "." + sid`（broker session id）去查该用户在这个 realm 里的会话：

- 令牌带 `sid`：只处理对应的那一个 broker 会话；令牌带 `revoke_offline_access` 事件时，另外按 broker user id + broker session id 撤销离线会话；
- 令牌只有 `sub`：遍历该用户在该 IdP 下的全部会话逐个登出，并可按 broker user id 撤销其全部离线会话。

校验失败一律是 400 `invalid_request`，`error_description` 就是错误文本本身（`LogoutEndpoint` 直接把 `LogoutTokenValidationCode.getErrorMessage()` 返回）。完整枚举如下，排错时可以直接拿文本反查根因：

| 返回的 error_description | 判定位置 |
|--------------------------|---------|
| `The decode of the logoutToken failed` | 令牌无法解码 |
| `No Identity Provider has been found` | 没有启用中的 OIDC IdP 的 Issuer 与该令牌 `iss` 匹配 |
| `LogoutToken verification with identity provider failed` | 与 IdP 的校验整体失败（含签名、`aud`、`azp`、issuer 列表、时间窗口） |
| `Missing sid or sub claim` | `sid` 与 `sub` 都不存在 |
| `The LogoutToken event claim is not as expected` | `events` 缺少 backchannel-logout 事件成员 |
| `The LogoutToken contains a nonce claim which is not allowed` | 出现规范明令禁止的 `nonce` |
| `The logoutToken jti is missing` | 缺少 `jti` |
| `The LogoutToken doesn't contain an iat claim` | 缺少 `iat` |

`validateToken()` 内部还有几条更细的异常文本，只会出现在服务端日志里：`Token is no longer valid`（超出有效窗口）、`Wrong audience from token.`（`aud` 不含 IdP 配置的 client ID）、`Token issued for does not match client id`（`azp` 不一致）、`Wrong issuer from token. Got: ... expected: ...`（`iss` 不在配置的 issuer 列表内）。

### 这条路径为什么会跟着 Validate Signatures 一起被放过

修复前的 `main` 上，签名校验的判断是这一行：

```java
// OIDCIdentityProvider（26.7.4 及更早）
protected boolean verify(JWSInput jws) {
    if (!getConfig().isValidateSignature()) return true;   // 早退，不区分令牌类型
    return verifySignature(jws);
}
```

这个早退**不区分令牌类型**。ID token / access token 保留这条旁路是历史设计（代理场景下上游不一定方便提供公钥），但登出令牌被同一行捎带放过了：只要 IdP 关着验签，一个 header 为 `alg=none`、签名段为空的伪造登出令牌就能走完校验。而 OIDC Back-Channel Logout 1.0 要求 Logout Token 必须签名，并明确禁止 `alg=none`——Keycloak 自己的升级说明也是这么写的。

26.8 的改法是给这条路径单独加参数，不再共用那个早退：

```java
// TokenManager.validateLogoutTokenAgainstIdpProvider()（26.8）
oidcIdp.validateToken(encodedLogoutToken, false, true);   // enforceSignatureValidation = true
```

```java
// OIDCIdentityProvider（26.8）
protected boolean verify(JWSInput jws, boolean shouldBeSigned) {
    if (!getConfig().isValidateSignature() && !shouldBeSigned) return true;
    return verifySignature(jws);
}
```

同一个 PR 还同步改了三处：代理侧入口 `KeycloakOIDCIdentityProvider.backchannelLogout()` 改为 `verify(token, true)`；Server Admin 文档里 Validate Signatures 的说明补上「登出令牌无论该开关如何都会被校验」，并明确 `Use JWKS URL` 在强制验签时同样适用；Admin UI 的开关提示文案（`validateSignatureHelp`）同步更新。**ID token / access token 的行为不变**，仍然受这个开关控制。

## 影响面：能做什么、不能做什么

| 维度 | 结论 |
|------|------|
| 攻击者需要知道 | 上游 issuer（通常就写在对方 discovery 文档里）、broker 的 client ID（用于 `aud`）、目标用户的**上游 `sub`** 或上游会话 `sid`，以及一个落在有效窗口内的时间 |
| 能达成 | 该 brokered 用户在 Keycloak 里的全部会话被登出；令牌带 `revoke_offline_access` 时离线会话一并撤销 |
| 不能达成 | 拿到令牌、拿到权限或改数据。影响面是可用性（把指定用户反复踢下线），不是账号接管 |
| 严重度口径 | GHSA `GHSA-pcf4-9g97-7cpf` 给的是 low（前置条件里含「需要知道用户的上游标识」）；Keycloak 自身的标签是 `priority/important`，并打了 `backport/26.6`、`backport/26.7`，说明上游认为要进补丁版本。两个口径都要看，不要只挑一个 |
| 谁必须处理 | 判断依据是「realm 里有没有一个启用中的 OIDC 代理」，而不是「上游有没有真的发过登出令牌」——端点只按 `iss` 找候选 IdP，再用 broker id 找会话，不校验上游是否在用这个能力 |

| 你的情况 | 是否受影响 | 处理 |
|---------|-----------|------|
| 有启用中的 OIDC 代理 + 验签关闭 | 是 | 打开验签并配好密钥（下一节），或确保 26.8 升级前补齐 |
| 有 OIDC 代理 + 验签开启（JWKS 或公钥已配） | 否，这条路径本来就验签 | 只需按 26.8 说明确认配置仍有效 |
| 代理的 IdP 已停用，但配置还留着 | 否（禁用后不会被选为候选） | 清理废弃 IdP，缩小候选面 |
| 没有任何 OIDC 身份代理 | 否 | 无需处理 |

## 现在能做的三件事

### 1. 盘点哪些 IdP 关着验签

```bash
KC=https://idp.example.com
REALM=corp

curl -s -H "Authorization: Bearer $TOKEN" \
  "$KC/admin/realms/$REALM/identity-provider/instances" \
| jq -r '.[] | select(.providerId | test("oidc"))
         | [.alias, .providerId,
            (.config.validateSignature // "(未设置 = false)"),
            (.config.useJwksUrl // "-"),
            (.config.jwksUrl // "-"),
            (.config.issuer // "-")] | @tsv'
```

判断口径来自源码而不是界面印象：`OIDCIdentityProviderConfig.isValidateSignature()` 就是 `Boolean.parseBoolean(getConfig().get("validateSignature"))`，**配置里没有这个键时解析结果就是 false**。也就是说「界面上没动过这个开关」并不等于它是开着的。

### 2. 打开验签并配好密钥

三条可选的密钥来源：

- `Use JWKS URL` = ON，`JWKS URL` 填上游的 `jwks_uri`；
- 或直接在 `Validating Public Key` 填上游公钥（必要时填 `Validating Public Key Id`）；
- 上游是 Keycloak 时，`jwks_uri` 通常是 `<issuer>/protocol/openid-connect/certs`。

最容易卡住的前置条件是：**Keycloak 自己必须能访问那个 JWKS**。容器出网受限或需要走代理的环境，要先把这条链路打通，否则打开开关的结果是登录侧立刻开始失败、或者登出侧静默失效。

同时要清楚改动的波及范围：ID token 与 access token 的验签在 26.8 前后都受这个开关控制，所以打开它之后必须回归**上游登录**这条主链路，而不只是测登出。

### 3. 为 26.8 做升级预演（最容易漏的一步）

26.8 起登出令牌**无条件验签**。于是「开关关着、又没有公钥材料」的部署在升级后会看到：上游发来的合法登出令牌也过不了校验，代理方向的登出传播直接停摆，端点返回 400 `LogoutToken verification with identity provider failed`，服务端日志里出现 `Failed to verify logout request` 之类的告警。

这不是「升级变严」造成的故障，而是原来的宽松配置本来就缺密钥材料，升级只是把这个欠账暴露出来。所以升级前应该在预发环境跑一遍真实的 brokered 登出链路：上游登出 → Keycloak 侧会话消失 → 对应客户端收到通知。升级说明给的两条补齐路径就是上一节的两个选项。

## 验证

```bash
# 1) 端点与 issuer 对齐（以 discovery 为准，不凭版本猜路径）
curl -s https://idp.example.com/realms/upstream/.well-known/openid-configuration \
  | jq '{issuer, jwks_uri, end_session_endpoint}'
```

`issuer` 必须与 IdP 配置里的 Issuer 逐字符一致（末尾斜杠也算字符），否则令牌会在 `No Identity Provider has been found` 处就断掉，根本走不到验签。

```bash
# 2) 盘点验签配置，把结果记进变更单（用上一节的 jq 脚本）

# 3) 从 Keycloak 所在网络验证 JWKS 可达——在 Keycloak Pod 内执行最接近真实路径
kubectl -n iam exec deploy/keycloak -- sh -c \
  'curl -s -o /dev/null -w "%{http_code}\n" https://idp.example.com/realms/upstream/protocol/openid-connect/certs'
```

```text
# 4) 行为自查（只在自有测试 realm 上做）
把一次真实 brokered 登录中上游签发的登出令牌的签名段清空、header 的 alg 改成 none，
以 logout_token=<...> POST 到 backchannel-logout 端点，观察两件事：
  - 修复前：该令牌会被当作合法登出处理，返回 200，对应用户会话被清除；
  - 修复后：应为 400，error_description 落在上面枚举的文本里。
```

第 4 步的价值在于区分「你因为开了验签而免疫」和「你以为自己免疫」——只做配置盘点看不出后者。

观测点：Keycloak 的 LOGOUT 事件（`Details.REASON` 会写具体原因）、broker 前缀的会话（`alias.sub` / `alias.sid`）数量变化、客户端侧是否收到 logout token。审计与事件字段见 [Keycloak 审计日志与合规]({{< relref "docs/solution-blogs/keycloak-audit-logging-compliance" >}})。

## 常见错误对照表

| 症状 | 证据 | 根因 | 处理 |
|------|------|------|------|
| 400 `No Identity Provider has been found` | 响应体与 LOGOUT 事件 | 令牌 `iss` 与任何启用中的 OIDC IdP 的 Issuer 都不相等：末尾斜杠、上游换了域名、IdP 被禁用 | 对齐 Issuer；不再使用的代理直接删掉，别留在配置里 |
| 400 `LogoutToken verification with identity provider failed` | 响应体；日志里才有细分文本 | 验签开启但校验失败；或 `aud` 不含 broker client ID、`azp` 不一致、`iss` 不在 issuer 列表、超出有效窗口 | 先分清是「缺公钥」还是「`aud`/`iss` 不匹配」——26.8 之后两类表现一样，必须看服务端日志里的 broker 异常文本 |
| 26.8 升级后上游登出不再生效 | 日志 `Failed to verify logout request`、端点 400 | 登出令牌改为无条件验签，而 IdP 没有公钥材料 | 补 `Use JWKS URL` + JWKS URL，或 `Validating Public Key`（+`Id`） |
| 400 `Missing sid or sub claim` | 响应体 | `sid` 与 `sub` 都没有 | 合法上游至少会带一个；两者都缺说明上游实现不符合规范 |
| 400 `The LogoutToken event claim is not as expected` | 响应体 | `events` 缺少 `http://schemas.openid.net/event/backchannel-logout` | 上游实现问题，不要为此放宽校验 |
| 400 `The LogoutToken contains a nonce claim which is not allowed` | 响应体 | 上游把 ID token 当登出令牌发（cross-JWT confusion） | 规范明令禁止 `nonce`，按上游缺陷处理 |
| 400 `The logoutToken jti is missing` / `The LogoutToken doesn't contain an iat claim` | 响应体 | 缺少必填声明 | 上游实现问题 |
| 501 `There was an error during the local logout` | 响应体 | 本地登出过程出错（含离线会话撤销路径） | 看服务端日志里的具体异常，响应码只说明方向 |
| 504 Gateway Timeout | 响应体 | 下游某个客户端的 back-channel 登出失败 | 按客户端逐个排查，见 [IAM 单点登出排错]({{< relref "blog/keycloak-single-logout" >}}) |

## 与既有登出排错的交界

- **方向相反**：单点登出排错那一页解决的是「Keycloak 通知客户端」；本文解决的是「上游 IdP 通知 Keycloak」。两条链路共用同一份断言语义（`iss`/`aud`/`sub`/`sid`/`events`/`nonce` 规则相同），但入口、作用对象和错误文本完全不同——排错时先定方向，再看端点。
- 被强制登出的会话与离线会话撤销并不等于「已签发令牌立即作废」，两者的范围差异见 [IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management" >}})。
- 代理侧的账号关联、属性映射与整体配置见 [身份联邦与身份代理]({{< relref "docs/core-capabilities/identity-federation-brokering" >}})。

## 回滚

1. 改动前先导出 IdP 实例 JSON（`GET /admin/realms/{realm}/identity-provider/instances/{alias}`）。回滚就是把这份 JSON 交回 `.../instances`（`POST` 到集合、或在实例上 `PUT`），不要指望手改界面能一致复原。
2. 如果打开验签后上游登录或登出异常，按这个顺序回退：`validateSignature` → `useJwksUrl` / `jwksUrl` / `publicKey` / `publicKeyId`。回到改动前快照后，重跑验证清单第 4 步确认状态。
3. **回退等于回到受 CVE 影响的状态**，不是修好。要把这条残余风险写进记录，并把「补密钥」列为独立任务——26.8 之后无法再靠关开关绕过，那条旁路已经不存在了。
4. 灰度顺序：先在预发 realm 验证密钥可达性与登出传播，再动生产 realm；生产按 IdP 逐个改，改完立刻跑一次真实的上游登出验证，不要攒着一起验。

## 常见问题（IAM 身份代理登出）

### Keycloak 的 Validate Signatures 到底管哪些令牌？

26.7.4 及更早：管 ID token / access token，并且顺带放过了登出令牌（同一个 `verify()` 早退）。26.8 起：登出令牌固定验签，ID token / access token 的行为不变。也就是说升级后这个开关仍然是关闭状态时，影响只落在登录侧，不再波及登出侧。

### 我们并没有在用 brokered logout，能靠关闭这个功能规避吗？

不能。端点不检查上游是否真的发过登出令牌：它按令牌 `iss` 找到候选 IdP，再用 `alias.sub` / `alias.sid` 去找会话。真正的开关是验签配置与公钥材料，不是「用不用」。

### 这个漏洞会导致账号被接管吗？

不会。影响是强制登出与离线会话撤销，属于可用性问题。但要留意下游反应：被强制登出的客户端如果带「登出后自动重新登录」的逻辑，用户可能完全无感，只剩日志里多出来的 LOGOUT 事件——所以异常登出告警比用户投诉更可靠。

### 修复什么时候可用，怎么跟踪？

截至 2026-09-25：GHSA 已公开（2026-08-04），issue [#51381](https://github.com/keycloak/keycloak/issues/51381) 与 PR #52171 均为 open，`main` 上仍是不含修复的代码；修复登记在 26.8.0 的升级说明里。跟踪方式：盯 26.8.0 的 release notes 与 `changes-26_8_0.adoc`，升级后按本文验证第 4 步复测一次。

## 关键来源

- [GHSA-pcf4-9g97-7cpf / CVE-2026-18569](https://github.com/advisories/GHSA-pcf4-9g97-7cpf)（公告，2026-08-04，severity low）
- [keycloak#51381：CVE-2026-18569 原始描述](https://github.com/keycloak/keycloak/issues/51381)（endpoint、前置条件；标签 `priority/important`、`backport/26.6`、`backport/26.7`）
- [PR #52171 Fix for CVE-2026-18569](https://github.com/keycloak/keycloak/pull/52171)（截至 2026-09-25 open；含 `OIDCIdentityProvider`、`TokenManager`、`KeycloakOIDCIdentityProvider`、Admin UI 文案与 `changes-26_8_0.adoc` 的完整 diff）
- Keycloak `main` 源码：[`LogoutEndpoint.backchannelLogout()`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/protocol/oidc/endpoints/LogoutEndpoint.java)、[`TokenManager.verifyLogoutToken()` / `validateLogoutTokenAgainstIdpProvider()`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/protocol/oidc/TokenManager.java)、[`OIDCIdentityProvider.verify()` / `validateToken()`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/broker/oidc/OIDCIdentityProvider.java)、[`LogoutTokenValidationCode`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/protocol/oidc/LogoutTokenValidationCode.java)、[`OIDCIdentityProviderConfig.isValidateSignature()`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/broker/oidc/OIDCIdentityProviderConfig.java)
- [OpenID Connect Back-Channel Logout 1.0](https://openid.net/specs/openid-connect-backchannel-1_0.html)：Logout Token 必须签名、禁止 `alg=none`
- [Keycloak 26.7.4 Release Notes](https://github.com/keycloak/keycloak/releases/tag/26.7.4)（当前稳定版，2026-09-16）

相关章节：[IAM 单点登出排错]({{< relref "blog/keycloak-single-logout" >}})、[身份联邦与身份代理]({{< relref "docs/core-capabilities/identity-federation-brokering" >}})、[IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management" >}})、[Keycloak 26.7.4 安全补丁解读]({{< relref "docs/solution-blogs/keycloak-26-7-4-security-patch" >}})
