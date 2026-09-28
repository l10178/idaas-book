---
title: "IAM 签名密钥轮换排错：Keycloak 的 kid、JWKS 缓存与切换顺序"
description: "IAM 密钥轮换排错：Keycloak Realm 签名密钥的 active/passive/disabled 三态与 provider priority 真实语义、JWKS 为何仍发布被动公钥、Spring Security 5 分钟 / Envoy 10 分钟 / nginx 默认不缓存 / go-oidc 按 kid 重取 / PyJWT 300 秒与 30 秒冷却等验签方默认值、先发布公钥再切签名最后下线公钥的三段式顺序、等待时间计算、验证命令与回滚方式。"
summary: "轮换后 401 大概率不是「Keycloak 没生效」，而是三段时间没对齐：新 kid 进入验签方缓存的时间、旧 kid 仍在签发令牌的时间、旧公钥被下线的时间。按组件给出可核对的默认值与切换顺序。"
date: 2026-09-28T00:00:00+08:00
lastmod: 2026-09-28T23:00:00+08:00
draft: false
weight: 39
images: []
categories: ["Keycloak"]
tags: ["keycloak", "key-rotation", "kid", "jwks", "oidc", "iam", "troubleshooting"]
contributors: []
pinned: false
homepage: false
seo:
  title: "Keycloak 签名密钥轮换排错：kid 未命中与 JWKS 缓存 TTL"
  description: "Keycloak 签名密钥轮换后的验签失败排错：active/passive/disabled 的真实语义与 provider priority、JWKS 发布规则、各验签方 JWKS 缓存默认值（Spring Security 5 分钟、Envoy 10 分钟、PyJWT 300 秒 + 30 秒冷却）、三段式轮换顺序、验证命令与回滚。"
  canonical: ""
  noindex: false
---

## 场景

轮换 Realm 签名密钥后的症状通常不是「全站打不开」，而是三件看起来无关的事同时出现：

1. **只有一部分请求 401**。新旧实例混跑时只有某些 Pod 失败，或者只有某几个服务失败——取决于各自 JWKS 缓存什么时候过期。
2. **报错文本各不相同**。Java 侧是一串 `An error occurred while attempting to decode the Jwt: ...`，Python 侧是 `PyJWKClientError: Unable to find a signing key that matches: "<kid>"`，Go 网关侧是 `failed to verify id token signature`。文本不同，但都指向同一个 JOSE header 字段：`kid`。
3. **换个操作顺序就"好了"**：把刚禁用的旧密钥重新启用，服务立刻恢复。这不是玄学，是 JWKS 文档里少了一个公钥。

**适用**：Keycloak 作为 IdP、下游用 JWT 本地验签的链路（Spring Security、oauth2-proxy、Envoy / Gateway API、Istio、自研 JWT 中间件）；正在轮换或准备轮换 Realm 签名密钥；需要判断「客户端为什么还没拿到新公钥」或「公钥是不是下得太早」。

**不适用**：单纯 `exp`/`nbf` 造成的 401（那是时钟偏移，不是密钥）；SAML 客户端的证书轮换走 IdP metadata 与 `saml.signing.certificate`，见 [Keycloak 作为 SAML IdP 接入应用]({{< relref "docs/solution-blogs/keycloak-saml-idp-integration" >}})；Keycloak 自身的 HTTPS 与 JGroups 证书与 Realm 签名密钥无关。

常规轮换流程在 [Keycloak 生产巡检与运维清单]({{< relref "docs/solution-blogs/keycloak-operations-checklist" >}}) 里已经写过。本文只回答一个问题：**公钥明明已经在 Keycloak 里了，验签方为什么还失败，以及每一段等待时间的真实来源。**

## 先纠正三个常见误解

Realm 的密钥不是"一对"，而是一组 provider；每个 provider 分别有 `Active`（是否可用于签名）与 `Enabled`（是否启用）两个开关，外加 `Priority`。

| 常见说法 | 文档与源码里的实际语义 |
|---|---|
| 「新增的新密钥应该先设为被动，用来验证旧令牌」 | 被动密钥的含义是：**公钥仍在 JWKS 中发布，但不用于签名**。新密钥先设为被动，是为了让它开始签发**之前**就被验签方拿到，而不是为了验证旧令牌 |
| 「把新密钥设成 Active，它就是当前签名密钥了」 | 官方文档明确写了反例：一个密钥对可以是 `Active`，但仍然不是当前签名密钥。当前签名密钥取自**按优先级排序后第一个能提供 active 密钥的 provider**，优先级数值越大越先被选中 |
| 「旧密钥用完了就 Disable 掉」 | `Active=Off` 是被动，公钥继续发布；`Enabled=Off` 是禁用，公钥从 JWKS 中消失 |

第三条可以在源码里核对。Keycloak 生成 Realm JWKS 时只做两个过滤：密钥处于 enabled 状态、且持有公钥（`JWKSServerUtils.getRealmJwks` 中的 `k.getStatus().isEnabled() && k.getPublicKey() != null`），**并不检查该密钥是不是当前签名密钥**。于是：

- 被动密钥（`Active=Off`、`Enabled=On`）→ 公钥仍在 JWKS 里，用它签发的存量令牌继续可验签。
- 禁用密钥（`Enabled=Off`）→ 公钥从 JWKS 消失，由它签发的、仍在流通的令牌立即全部失败。

把"下线旧密钥"直接做成 Disable，是绝大多数「轮换后一部分请求 401」事故的第一现场。

## 先看事实：三条命令

```bash
# 1) 当前 JWKS 发布了哪些签名公钥
curl -s "https://kc.example.com/realms/demo/protocol/openid-connect/certs" \
  | jq -r '.keys[] | select(.use=="sig") | "\(.kid)  \(.alg)"'

# 2) 手上的令牌用的是哪个 kid（base64url 解 JOSE header）
TOKEN='eyJhbGciOi...'
python3 -c 'import base64,json,sys
s=sys.argv[1].split(".")[0]
print(json.loads(base64.urlsafe_b64decode(s+"="*(-len(s)%4))))' "$TOKEN"

# 3) Realm 侧密钥元数据：active 映射 + 每个密钥的 status / priority / validTo
curl -s -H "Authorization: Bearer $KC_ADMIN_TOKEN" \
  "https://kc.example.com/admin/realms/demo/keys" \
  | jq '{active, keys: [.keys[] | {providerId, providerPriority, kid, status, algorithm, use}]}'
```

第 3 条对应 Admin REST 的 `GET /admin/realms/{realm}/keys`，响应包含 `active`（算法 → 当前签名密钥的 kid）以及每个密钥的 `status`、`providerPriority`、`validTo`。用它比在控制台点 Keys 标签页更可靠：控制台默认展示 Active 视图，被动密钥要在筛选框里切过去才看得到，很容易漏掉"其实旧密钥已经被禁用"这一事实。

拿到三份输出后，问题会立刻收敛成两种：

- 令牌的 `kid` **不在** JWKS 里 → 公钥被下线（禁用/删除）了，或验签方读的是另一个 Realm / 另一套 Keycloak 环境。
- 令牌的 `kid` **在** JWKS 里，但仍然有请求失败 → 验签方的缓存还是旧的。

## 验签方缓存多久：可核对的默认值

轮换的失败窗口，本质上是这些默认值相加。下表每个数字都来自对应项目自身的文档或源码；升级组件后请以该版本为准。

| 验签方 | 缓存与刷新行为 | 默认值 |
|---|---|---|
| Spring Security（`NimbusJwtDecoder`，`issuer-uri` / `jwk-set-uri`） | 进程内缓存 JWK Set，可注入 `Cache` 替换实现 | **5 分钟**（参考文档：caches in-memory the JWK set for 5 minutes） |
| Envoy `jwt_authn`（`remote_jwks`） | 只在「未持有 JWKS」或「缓存已过期」时拉取，**不会**因为 kid 未命中而重新拉取 | **10 分钟**（proto 注释：If not specified, default cache duration is 10 minutes）；启用 `async_fetch` 时失败重取间隔默认 **1 秒** |
| nginx `ngx_http_auth_jwt_module` | 从文件或子请求获得的密钥可缓存也可不缓存 | `auth_jwt_key_cache` 默认 **0**（不缓存），1.21.4 起提供 |
| oauth2-proxy（内部用 coreos/go-oidc） | keyset 在内存中长期缓存；**kid 未命中时按 OIDC Core §10.1.1 的建议重新拉取远端**，请求带 `Cache-Control: no-cache`；仍不匹配则报 `failed to verify id token signature` | 无时间型 TTL（依赖 kid 未命中触发）——对"新增 kid"友好，对"kid 被删"不友好 |
| PyJWT `PyJWKClient` | 两级缓存：JWK Set 缓存（Tier 1，默认开）与按 kid 的 LRU（Tier 2，默认关、无时间过期） | Tier 1 `lifespan` 默认 **300 秒**；未知 kid 会触发一次强制刷新，但受 `cooldown_duration`（默认 **30 秒**，自上次成功拉取起算）限制 |
| Istio / istiod | 由控制面拉取 JWKS 后下发，拉取失败 fail-closed | 见 [Istio + Keycloak JWT 认证与 IAM 授权落地]({{< relref "docs/solution-blogs/istio-keycloak-jwt-authz" >}}) |

两个容易被忽略的推论：

1. **「新增 kid」与「删除 kid」的风险不对称**。go-oidc 会在 kid 未命中时重取，PyJWT 也会（30 秒冷却是唯一的延迟）；Envoy 和 Spring Security 只按缓存过期刷新。所以"新密钥开始签发"造成的失败，最长约等于缓存 TTL；而"旧公钥被下线"造成的失败，要等验签方下一次刷新才会好转，期间由旧密钥签发的令牌全部失败。
2. **冷却与缓存会叠加**。PyJWT 在刚成功拉取过 JWKS 的 30 秒内不会再次强制刷新；Envoy 在 10 分钟缓存期内不会重取。如果验签方是滚动升级的多个 Pod，实际等待时间要按"最慢的那个实例"算，而不是按文档默认值算。

## 三段式轮换：先发布公钥，再切签名，最后下线公钥

官方推荐顺序是「新建更高优先级的密钥」或「同优先级并把旧密钥设为被动」。这个顺序在 Keycloak 侧是对的（新密钥开始签发、旧公钥仍在发布、无停机），但它默认**验签方会及时看到新 kid**。上面的默认值表明这个假设并不总成立。把顺序拆成三段，每一段都留出可观测的等待时间：

**第 1 段：只发布公钥，不改变签名密钥**

- 新增一个同算法 provider（如 `rsa-generated`），优先级设成**低于**当前签名密钥，`Active` 保持 Off。
- 此时签名密钥没变，但新公钥已经随 JWKS 发布出去——因为 JWKS 只按 enabled + 有公钥过滤，与是否 active 无关。
- 等待时间要覆盖所有验签方的缓存上界并留余量（Spring Security 5 分钟、Envoy 10 分钟 → 等 15 分钟级别），并用各实例日志里第一次出现新 kid 的时间来确认，而不是凭感觉。
- 验证：`curl .../certs` 能看到新 kid，同时新签发的令牌 header 里仍是旧 kid。

**第 2 段：切换签名密钥**

- 把新 provider 的优先级提到最高（或把旧密钥的 `Active` 关掉）。
- 新签发的令牌开始带新 kid。因为验签方已持有新公钥，正常情况这一步不应产生 401。**如果这一段出现失败，说明第 1 段没等够**：把优先级改回去，旧密钥重新成为签名密钥即可回到起点。
- 验证：重新登录或刷新拿到的令牌 header 里是新 kid，且所有下游验签通过。

**第 3 段：下线旧公钥（最慢的一段）**

- 先把旧 provider 的 `Active` 关掉（变成被动），这一步**不改变任何验签结果**，只是防止它再被选为签名密钥。
- 等待时间取三者的最大值：
  - Access Token 寿命（Realm Settings → Tokens 里你自己 Realm 的实际配置）；
  - 浏览器侧 SSO 会话（SSO Session Idle / Max）——官方文档指出，在新建密钥到删除旧密钥之间没有活跃过的用户，届时需要重新认证；
  - Refresh / Offline Token 的存活与刷新周期——官方文档明确要求应用必须在旧密钥被删除**之前**完成刷新，离线令牌尤其如此。
- 最后才 `Enabled=Off` 或删除 provider。官方给的节奏是 3–6 个月新建一次、新建后 1–2 个月再删旧密钥，这个跨度本身就说明第 3 段不该按分钟算。

```bash
# 第 3 段前的自检：JWKS 里应同时存在新旧两个 sig 公钥
curl -s "$KC/realms/demo/protocol/openid-connect/certs" | jq -r '.keys[].kid'

# 待下线的旧 kid 是否还有新令牌签发？解令牌 iat 与 kid 逐批抽样确认
```

## 常见错误与判定

| 症状 | 证据 | 根因 | 处理 |
|---|---|---|---|
| 轮换后部分实例 401，另一部分正常 | 失败实例日志里的 kid 与 JWKS 当前 kid 不一致 | 验签方 JWKS 缓存未过期（Spring Security 5 分钟、Envoy 10 分钟等） | 等缓存过期。这类"部分失败"是预期行为，不要回滚密钥 |
| 同一时刻全部失败，新旧令牌都失败 | JWKS 里查不到令牌的 kid | 旧密钥被 `Enabled=Off` 或删除 | 立即重新 Enable 旧密钥（`Active` 保持 Off），公钥马上回到 JWKS，验签方下次刷新即恢复 |
| 只有旧客户端或旧版本服务失败 | 失败方持有 `refresh_token` 或缓存的 ID Token | 旧公钥下线早于令牌/离线令牌寿命 | 恢复旧公钥，等超过最大令牌寿命与离线令牌刷新周期后再下线 |
| Java 侧报 `An error occurred while attempting to decode the Jwt: ...` | 该模板来自 `NimbusJwtDecoder`；把 cause 一并打日志 | 既可能是验签密钥未命中，也可能是 JWKS 拉取失败（DNS/网络/超时） | 先看 cause：拉取失败与密钥未命中的处理方式完全不同，不要一律归因于轮换 |
| PyJWT 报 `Unable to find a signing key that matches: "<kid>"`，但 JWKS 里确实有 | 报错发生在轮换后 30 秒内 | `PyJWKClient` 的强制刷新受 `cooldown_duration`（默认 30 秒）限制 | 稍后重试；或显式设 `cooldown_duration=0` |
| 网关 401 但 Keycloak 登录正常 | Envoy JWT filter 拒绝，JWKS 尚未过期 | Envoy 不会因未知 kid 重新拉取 JWKS | 调小 `remote_jwks.cache_duration` 或滚动重启网关刷新缓存 |
| Keycloak 里加了新密钥，令牌里的 kid 没变 | `GET /admin/realms/{realm}/keys` 的 `active` 仍是旧 kid | 新 provider 优先级没有高于当前签名密钥 | 提高优先级（数值越大越优先）；`Active=On` 不等于"当前签名密钥" |
| 轮换后所有令牌都报签名错误，但密钥没删 | `iss` 与验签方配置不一致（另一 Realm / 另一个域名） | 不是轮换问题，是 issuer 混淆 | 用第 2 条命令解 header 与 payload，先比 `iss`/`aud`，最后才怀疑公钥 |

**不要把「关闭验签」当作止血手段。** 应急时能改的只有公钥可用性与缓存，不是验签开关：关掉验签等于允许任何人伪造身份，而且事后无法确认哪些请求被错误放行。Keycloak 侧唯一的强制失效能力是 not-before 推送，它只用于密钥泄露，见下一节。

## 回滚

按影响面从小到大：

1. **误禁用/误删旧密钥（最常见）**：把旧 provider 重新 `Enabled=On`、`Active=Off`。公钥立刻回到 JWKS，验签方在各自缓存过期后恢复；已签发的令牌不需要重签。这是唯一一条能"一键恢复"的路径，所以轮换期间绝不要提前删除旧密钥。
2. **切换过急（第 2 段失败）**：把优先级改回原值，让旧密钥重新成为签名密钥。已经出现的、带新 kid 的令牌仍可验签（新公钥已发布），代价是又签回旧密钥并多观察一轮。
3. **验签方缓存过长（Envoy 等）**：临时调小 `cache_duration` 并滚动重启网关。把这当成恢复手段而不是长期配置——重启会引发一次 JWKS 拉取，节点多时要在低峰做。
4. **密钥泄露（没有反向操作的一段）**：
   - 先生成新密钥对，再立即删除被泄露的密钥；
   - 通过客户端的 `Admin URL` 推送 not-before（控制台：Clients → 选择客户端 → Access settings 的 Admin URL → Advanced → Revocation → Set to now → Push），让下游拒绝旧令牌并强制重新拉取 JWKS；
   - 这件事**不可撤销**：被推送失效的令牌不会因为"取消推送"而复活，受影响的用户只能重新登录。因此它不能作为常规轮换的"加速清理"手段。

## 常见问题（IAM 密钥轮换）

### IAM 里的密钥轮换为什么不能"删旧建新"一步完成？

因为签名公钥的传播是异步的，而令牌是"过去签发的、现在还在用"。轮换实际涉及三段时间：公钥写入所有验签方缓存的时间（不同组件默认 5–10 分钟不等）、新旧签名密钥并存的时间、存量令牌与离线令牌的寿命（分钟到月）。删旧建新把这三点压缩成 0，等于把传播延迟直接暴露给用户。

### JWKS 缓存 TTL 应该设多长？

它是在"IdP 压力"和"轮换/止血的传播速度"之间的权衡，没有统一答案：TTL 越长，拉取越少、但公钥变更传播越慢；TTL 越短，传播越快、但每次过期都会重新拉取，节点多时要注意对 Keycloak 的瞬时压力。可以按"能接受多久的轮换传播延迟"来定，不必照抄其他组件的默认值。

### Keycloak 有自动轮换 Realm 签名密钥的能力吗？

Server Administration Guide 描述的 Realm 密钥轮换是手工过程：新建 provider、调整优先级、把旧密钥设为被动、过一段时间再删除。文档里的自动化机制（rotation policy / executor）出现在**客户端 secret 轮换**章节，两者不要混为一谈。

### kid 未命中时最常见的三种误判？

一是把所有 401 都归因于轮换，实际可能是 `iss` 不一致（另一个 Realm 或另一个域名）或 `aud` 不匹配；二是以为"JWKS 里有这个 kid 就一定能验通"，忽略了验签方读的是缓存副本；三是把时钟偏移造成的 `exp`/`nbf` 失败当成密钥问题。先用解 header 的命令确认 kid，再看 `iss`/`aud`/`exp`，最后才怀疑公钥。

### 轮换期间可以临时关闭验签吗？

不可以。验签是资源服务确认调用者身份的唯一依据，关掉它既不能定位问题，又会把身份故障变成越权事件。需要加速恢复时应改缓存或恢复旧公钥，这些都是可逆的；not-before 推送与删密钥则不可逆。

## 关键来源

- [Keycloak Server Administration Guide — Configuring realm keys / Rotating keys](https://www.keycloak.org/docs/latest/server_admin/#realm_keys)：单一 active 密钥 + 多个 passive 密钥、`Active=Off`（被动）与 `Enabled=Off`（禁用）的差别、优先级决定当前签名密钥（"The highest number makes the key pair active"、"A key pair can have the status Active, but still not be selected as the currently active key pair for the realm"）、推荐 3–6 个月新建 / 1–2 个月后删除、离线令牌需先刷新、泄露场景的 not-before 推送步骤
- [Keycloak 源码 `services/.../protocol/oidc/utils/JWKSServerUtils.java`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/protocol/oidc/utils/JWKSServerUtils.java)：JWKS 生成只过滤 `status.isEnabled() && publicKey != null`，因此被动密钥的公钥一并发布
- [Keycloak Admin REST `GET /admin/realms/{realm}/keys`](https://github.com/keycloak/keycloak/blob/main/core/src/main/java/org/keycloak/representations/idm/KeysMetadataRepresentation.java)：响应包含 `active` 映射与每个密钥的 `kid` / `status` / `providerPriority` / `validTo`
- [Spring Security 参考文档 — OAuth2 Resource Server: JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html)：默认在内存中缓存 JWK Set 5 分钟，可用 `Cache` 覆盖
- [Spring Security `NimbusJwtDecoder`](https://github.com/spring-projects/spring-security/blob/main/oauth2/oauth2-jose/src/main/java/org/springframework/security/oauth2/jwt/NimbusJwtDecoder.java)：解码错误模板 `An error occurred while attempting to decode the Jwt: %s`
- [Envoy `jwt_authn` v3 配置 proto](https://github.com/envoyproxy/envoy/blob/main/api/envoy/extensions/filters/http/jwt_authn/v3/config.proto)：`remote_jwks.cache_duration` 默认 10 分钟、`async_fetch.failed_refetch_duration` 默认 1 秒、`fast_listener` 默认 false
- [Envoy `jwks_cache.h`](https://github.com/envoyproxy/envoy/blob/main/source/extensions/filters/http/jwt_authn/jwks_cache.h)：拉取条件为「未持有 JWKS 或已过期」
- [nginx `ngx_http_auth_jwt_module`](https://nginx.org/en/docs/http/ngx_http_auth_jwt_module.html)：`auth_jwt_key_cache` 的语法与默认值（`0`，不缓存），1.21.4 起提供
- [coreos/go-oidc `oidc/jwks.go`](https://github.com/coreos/go-oidc/blob/master/oidc/jwks.go)：kid 未命中时按 OIDC Core §10.1.1 重新拉取、请求带 `Cache-Control: no-cache`、最终错误文本 `failed to verify id token signature`（oauth2-proxy 使用该库）
- [PyJWT `jwt/jwks_client.py`](https://github.com/jpadilla/pyjwt/blob/master/jwt/jwks_client.py)：Tier 1 `lifespan` 默认 300 秒、未知 kid 的强制刷新受 `cooldown_duration`（默认 30 秒）限制、Tier 2 `cache_keys` 默认关闭且无时间过期
- Istio / istiod 的 JWKS 拉取与 fail-closed 行为见站内 [Istio + Keycloak JWT 认证与 IAM 授权落地]({{< relref "docs/solution-blogs/istio-keycloak-jwt-authz" >}})
