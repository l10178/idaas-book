---
title: "IAM Token 体积治理：Keycloak claims 裁剪与 oauth2-proxy Cookie 膨胀"
description: "IAM Token 体积治理实战：Keycloak lightweight access token 的 mapper 开关与不可移除 claims、group full path 默认值、oauth2-proxy 4000 字节 Cookie 上限与分片命名、Redis 会话票据格式、claims 与 Cookie 体积的量化诊断方法。"
summary: "用户组一多就出现 431、日志开始警告 Multiple cookies are required——问题不在浏览器，而在网关里那条 token → Cookie → 请求头的放大器。给出 Keycloak 侧四层裁剪、oauth2-proxy 侧 4000 字节内部上限的真实机制、量化诊断命令与分层回滚。"
date: 2026-09-23T00:00:00+08:00
lastmod: 2026-09-23T23:00:00+08:00
draft: false
weight: 36
images: []
categories: ["Keycloak"]
tags: ["keycloak", "lightweight-access-token", "oauth2-proxy", "cookie", "431", "troubleshooting"]
contributors: []
pinned: false
homepage: false
seo:
  title: "IAM Token 体积治理：Keycloak claims 裁剪与 oauth2-proxy Cookie 膨胀排错"
  description: "IAM Token 体积治理实战：Keycloak lightweight access token 的 mapper 开关与不可移除 claims、group full path 默认值、oauth2-proxy 4000 字节 Cookie 上限与分片命名、Redis 会话票据格式、claims 与 Cookie 体积的量化诊断方法。"
  canonical: ""
  noindex: false
---

## 场景

三个症状看起来无关，实际是同一条链路上的三个位置：

1. 上游应用返回 `431 Request Header Fields Too Large`，或日志里出现 `Header is too large: size 8193>8192`，而业务代码一行没改。
2. oauth2-proxy 日志开始刷 `WARNING: Multiple cookies are required for this session as it exceeds the 4kb cookie limit`，浏览器里能看到 `_oauth2_proxy_0`、`_oauth2_proxy_1`。
3. 只有「组多、角色多」的那部分用户登录失败，新员工和测试账号完全正常。

**适用**：Keycloak 作为 IdP、oauth2-proxy（或任何把 token 放进 Cookie 的认证网关）作为入口的部署；用户组/角色数量在几十到几百量级；需要判断该裁 claims、该换会话存储，还是该调代理缓冲区。

**不适用**：Session 存在 Redis 且 Cookie 只有票据的场景——此时瓶颈通常转移到 Redis 容量与网络，本文的 Cookie 分析部分不适用；SAML 客户端的断言体积问题走另一套属性映射，见 [SAML 2.0 协议详解]({{< relref "docs/protocols/saml2" >}})。

Token 生命周期与令牌各自职责见 [IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management" >}})；本文只回答一个问题：**体积是在哪一层被放大的，以及每一层的裁剪代价是什么。**

## 先定位：体积在哪一段被放大

绝大多数「Token 太大」的故障，根因不是 token 本身超限，而是 token 被复制进了另一个有硬上限的容器。先确定是下面哪一条链路：

| 链路 | 体积载体 | 触发的硬上限 | 典型症状 |
|------|---------|-------------|---------|
| access token → `Authorization` 请求头 | 每个受保护请求 | nginx `large_client_header_buffers` 默认 `4 8k`（单行 8KB）；上游框架自己的 header 上限 | 431、`Header is too large: size 8193>8192` |
| id token + access token + refresh token → oauth2-proxy 会话 Cookie | 每个浏览器请求 | oauth2-proxy 自身 4000 字节的 Cookie 上限（见下文），不是浏览器 4096 | Cookie 被拆成 `_0`/`_1`，或认证反复失败 |
| 角色/组 claim → 资源服务的授权判定 | 内存与解析时间 | 无硬上限，但每次请求都付成本 | 网关延迟随组数线性上升 |
| CSRF Cookie 累积（与 claims 无关） | 每个未认证请求 | 同上 | 只在多标签页/并行请求时出现 431，见 [oauth2-proxy 常见错误排错]({{< relref "blog/oauth2-proxy-common-errors" >}}) 中的 CSRF 一节 |

**第一步永远是确认谁返回了 431**：入口 nginx、上游应用，还是浏览器。三者对应的修法完全不同，而「先调大 buffer」在第二种情况下通常无效——上游框架的 header 上限不会因为你改了 nginx 就变大（GitHub issue #644 里 8192 这个数字来自上游容器，不是 nginx）。

## Keycloak 侧：四层裁剪，代价递增

### 第 1 层：protocol mapper 的开关矩阵（零代价，先做）

Keycloak 的每个 claim 由 protocol mapper 产出，而 mapper 现在有四个目标开关。理解这张表是后面所有操作的基础：

| 开关 | 属性名 | 默认值 | 含义 |
|------|--------|--------|------|
| Add to ID token | `id.token.claim` | 随 mapper 类型而异 | 是否写入 ID token |
| Add to access token | `access.token.claim` | `true` | 是否写入常规 access token |
| Add to lightweight access token | `lightweight.claim` | `false` | 是否写入轻量 access token |
| Add to token introspection | `introspection.token.claim` | `true` | 是否由 introspection 端点返回 |

后两个开关是成对设计的：**轻量 access token 把 claims 从 token 里移除，同时保留在 introspection 响应里**，资源服务改用 introspection 取回。这也是为什么 `Add to token introspection` 默认是 `true`——从旧版本升级时，introspection 的返回内容与 access token 保持一致，行为不变（Keycloak 24.0 与 25.0 的 release notes 都点明了这个兼容性设计）。

具体的裁剪动作：

- 只用 `X-Auth-Request-*` 头做身份区分的网关场景，不需要把 `email`、自定义属性塞进 access token。
- 前后端分离时，不要给「只需要 `sub` 和 `preferred_username`」的客户端挂用户属性 mapper。
- 注意每个 mapper 都同时服务 ID token 与 access token，两者要分开判断；对 SPA 来说 ID token 往往可以更瘦。

### 第 2 层：group claim 的 `full.path` 默认是 true

`oidc-group-membership-mapper` 有一个容易忽略的开关，官方描述是：

> **Full group path**（`full.path`，boolean，默认 `true`）：Include full path to group i.e. `/top/level1/level2`, false will just specify the group name

也就是说，默认行为写入的是**完整路径**。一个嵌套三层的组 `/company/engineering/backend` 在 claim 里占 30 字节以上，而只要末级名字是 `backend` 就占 7 字节。层级越深、组越多，差距按乘法放大。

改成 `false` 之前先确认一件事：**下游是否依赖完整路径做前缀匹配**。很多授权规则写的是「只要组名等于 xxx」，改成 `full.path=false` 会让原本唯一的组名出现同名歧义。如果确实需要路径，另一个方向是收敛组的层级深度，而不是逐客户端调开关。

### 第 3 层：轻量 access token（真正的结构级裁剪）

Keycloak 24.0 引入 lightweight access token，25.0 又把它「再瘦」了一轮。它解决的是 access token 里携带 PII 的问题，副作用正好是体积。

**不能移除的 claims**（官方明确列出，即使开了轻量 token 也仍在）：

```
exp, iat, jti, iss, typ, azp, sid, scope, cnf
```

**25.0 的进一步变化**（升级时值得知道，因为它解释了「为什么升级后 token 变小/某些 claim 不见了」）：

- `sub` 和 `auth_time` 改由 `basic` client scope 上的 protocol mapper 添加——仍进 ID token 与常规 access token，但**不进**轻量 access token。
- `nonce` 现在只进 ID token，不再进常规 access token。需要它在 access token 里，必须显式加 mapper（`oidc-nonce-backwards-compatible-mapper`）。
- `session_state` 不再写入任何 token，规范里语义相同的 `sid` 仍然保留。

**两种启用方式**：

| 方式 | 位置 | 适用 |
|------|------|------|
| Always use lightweight access token | 客户端 → Advanced settings | 该客户端的所有请求都用轻量 token，最简单 |
| `use-lightweight-access-token` executor | Realm settings → Client policies → Profiles | 需要按条件（如客户端类型、scope 参数）切换，例如默认轻量、个别 scope 用完整 token |

轻量 token 生效后，**资源服务拿不到 `realm_access.roles`**——这是最容易踩的一步。三个出口：

1. **Introspection**：资源服务把 access token 交给 `/protocol/openid-connect/token/introspect` 取回被移除的 claim。注意 introspect 需要客户端凭据，调用方要能承担这次额外往返；高频接口上这是显式的性能取舍。
2. **Introspection 取完整 JWT**：introspect 请求带 `Accept: application/jwt` 时，响应可能额外包含 `jwt` 字段，返回完整的 JWT access token——官方文档特别指出它对轻量 access token 特别有用。
3. **Token Exchange 换回完整 token**：客户端可以用轻量 token 换取常规 access token，[Token Exchange 实战]({{< relref "docs/solution-blogs/keycloak-token-exchange" >}}) 里有完整的请求与权限模型。官方有一条硬前提：**签发轻量 token 的客户端上，audience mapper 必须打开 `Add to lightweight access token`**，因为 token exchange 要求目标客户端出现在 `aud` 里。没配这个 mapper，换取会因为找不到目标 audience 直接失败。

资源服务是否真的需要角色 claim，是这一层的决策分界：**如果资源服务只用 `sub` 做审计、授权都在网关做，轻量 token + introspection 是纯收益；如果每个请求都要解析角色树，先把角色设计收窄（减少每次请求的判定面）比换 token 格式更有效。**

### 第 4 层：把角色和 scope 收窄（架构级，最容易被跳过）

Keycloak 文档在角色章节里给的定位是：Role Scope Mappings 用来限制 access token 中声明哪些角色。落到工程上：

- 按客户端拆角色，不要把所有权限堆在 realm 级角色里——realm 级角色会出现在该 realm 所有客户端的 token 中。
- 用 composite role 表达「岗位」，把上百个细粒度角色收成 3-5 个令牌内可见的角色，细粒度判定放到应用侧或授权服务。
- 与 [Keycloak 细粒度权限与授权策略]({{< relref "docs/solution-blogs/keycloak-fine-grained-authz" >}}) 里的 Authorization Services 结合时，记住权限评估结果不需要进 token。

## oauth2-proxy 侧：4000 字节是它自己的上限

这是最值得先知道的一个数字：**oauth2-proxy 的内部上限是 4000 字节，不是浏览器的 4096。**

源码 `pkg/sessions/cookie/session_store.go` 里的常量与注释写得很清楚：Cookie 的 4KB 限制覆盖名称、值和属性，浏览器普遍上限是 4096，所以它给自己留了余量，取 4000：

```go
// Cookies are limited to 4kb for all parts
// including the cookie name, value, attributes; IE (http.cookie).String()
// Most browsers' max is 4096 -- but we give ourselves some leeway
maxCookieLength = 4000
```

超限时的行为不是报错，而是**静默拆分成多个 Cookie**，名字加 `_0`、`_1` 后缀（`splitCookieName` 用 `%s_%d` 生成），并打一条日志：

```
WARNING: Multiple cookies are required for this session as it exceeds the 4kb cookie limit.
Please use server side session storage (eg. Redis) instead.
```

拆分的后果在 Nginx Ingress `auth_request` 模式下最明显：认证子请求返回的 `Set-Cookie` 需要完整回传给浏览器，只转发第一片就会让下一次请求认证失败。上例中的那个坑在 [oauth2-proxy 常见错误排错]({{< relref "blog/oauth2-proxy-common-errors" >}}) 第 6 节有完整的转发配置。

维护者对拆分的态度是明确负面的：拆分应被视为**错误信号**而非可接受的降级（维护者在 issue #1940 中说明拆分「很容易出问题」，并且有单独 issue #482 讨论废弃该特性）。所以「日志里有这条 WARNING 但业务还能跑」不是可以忽略的状态——它在等一个多标签页或并发刷新把它变成故障。

会话数据的编码演进也值得知道：早期把每个 token 分别加密塞进 Cookie，现在是 **MessagePack 序列化 + LZ4 压缩后再加密**（实现讨论见 issue #522，维护者在 issue #644 的说明里确认这次重构把典型会话从约 5000 字节压到约 2700 字节）。压缩率随 token 内容变化，因此以你实际版本和实际用户为准确认，不要直接套用这个数字做容量规划。

### 三条降体积的路径与各自代价

| 路径 | 配置 | 收益 | 代价 |
|------|------|------|------|
| 换 Redis 会话存储 | `--session-store-type=redis`、`--redis-connection-url` | Cookie 只剩票据，体积与 claims 多少解耦 | Redis 的 TLS、凭据、容量、故障切换、备份演练进入 IAM 网关的生产前置条件 |
| 剥离 Cookie 里的 token | `--session-cookie-minimal=true` | Cookie 显著变小 | Cookie store 专用；不再持有 refresh/ID token，刷新与凭据转发能力随之失效 |
| 减少请求的 scope | `--scope=openid email`（去掉 `profile`） | ID token 与 userinfo 相关 claims 变少 | 依赖 `profile` 字段（如 `name`、`groups` 之外的属性）的场景会缺字段 |

Redis 存储的票据格式是 `{CookieName}-{ticketID}.{secret}`：ticketID 是 128 位随机数的 hex 编码，secret 是 128 位 base64url 随机数且每个会话唯一，会话用该 secret 加密后通过 `SETEX` 写入 Redis。所以「Cookie 变小了」这件事**不依赖 claims 裁剪**——票据长度和 token 体积无关，这也是它比 `--session-cookie-minimal` 更彻底的原因。

`--session-cookie-minimal` 的坑必须提前说清楚：官方描述是「strip OAuth tokens from cookie session stores if they aren't needed」，关键词是 *aren't needed*。如果同时开了 `--cookie-refresh` 或 `--pass-authorization-header`，会话里已经没有被用来刷新的 refresh token，刷新流程会失败，社区 issue 里的典型报错是：

```
failed to refresh token: oauth2: cannot fetch token: 400 Bad Request
{"error":"invalid_grant","error_description":"Token is not active"}
```

维护者的解释很直接：minimal 模式下没有 refresh token/ID token 可用于刷新。所以要二选一——用 Redis，或者接受 `--cookie-refresh=0`（用户到期后重新登录）。**不要同时开 minimal 和 refresh，然后去查 Keycloak 为什么说 token 无效。**

### 两个时间参数与 Keycloak 会话的对应关系

Cookie 有效期配错会造成「Keycloak 里会话还在，网关却重新登录」。官方文档给的推荐关系是：

- `--cookie-refresh := Access Token 生命周期 - 1 分钟`
- `--cookie-expire := Refresh Token 生命周期`（对应 Keycloak 的 client session idle）

减 1 分钟是因为存在竞态：access token 还有效 1 秒时通过网关、到后端已过期，后端的 JWT 校验就会失败。这个细节在 [oauth2-proxy 深度介绍]({{< relref "docs/implementation/oauth2-proxy-deep-dive" >}}) 的超时章节有对应的 Keycloak 侧参数对照。

## 验证

```bash
# 1) 按 claim 看 access token 的构成，找出最大的几个字段（只解码不验签，仅用于定位）
TOKEN='<paste access token>'
echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | awk '{l=length($0)%4; if(l==2) $0=$0"=="; else if(l==3) $0=$0"="; print}' \
  | base64 -d 2>/dev/null \
  | jq -r 'to_entries | map({k:.key, bytes:(.value|tostring|length)}) | sort_by(.bytes) | reverse | .[0:8][] | "\(.bytes)\t\(.k)"'

# 2) 看 oauth2-proxy 实际写出的会话 Cookie 有多大、拆成了几片
curl -sS -D- -o /dev/null --cookie "$SESSION_COOKIE" https://app.example.com/ \
  | awk 'tolower($0) ~ /^set-cookie: _oauth2_proxy/ {printf "%d bytes\t%s...\n", length($0), substr($0,1,64)}'

# 3) 判断会话是 Cookie store 还是 Redis store（后者 Cookie 值是短票据）
#    Redis:  _oauth2_proxy_<hex>.<base64url>，长度远小于 4000
#    Cookie: 长密文，接近 4000 或出现 _0/_1 分片

# 4) 确认轻量 token 是否真的生效（对比开启前后的 claim 数量与总量）
echo "$TOKEN" | cut -d. -f2 | tr '_-' '/+' | awk '{l=length($0)%4; if(l==2) $0=$0"=="; else if(l==3) $0=$0"="; print}' \
  | base64 -d 2>/dev/null | jq -r 'keys | length'

# 5) 轻量 token 下确认资源服务仍能拿回角色（introspection）
curl -sS -u "resource-svc:<secret>" \
  -d "token=$TOKEN" -d "client_id=resource-svc" \
  https://idp.example.com/realms/corp/protocol/openid-connect/token/introspect | jq '{active, sub, realm_access}'
```

第 1 步的字节数是「JSON 序列化后的字符长度」，用于横向比较 claim 的相对大小，不是签名字段的精确占用——判断绝对值请以第 2 步的实际 Cookie 长度为准。

判定顺序固定为：**谁返回 431 → Cookie 是否分片 → 分片是否被完整转发 → claims 是否真的需要**。跳过第一步去调 buffer，通常只是把故障推迟到组数再涨一轮。

## 常见错误对照表

| 症状 | 证据 | 根因 | 修复 |
|------|------|------|------|
| 上游 431 / `Header is too large: size 8193>8192` | 报错来自上游容器日志，不是入口 nginx | access token 被放进 `Authorization` 头，超过上游框架的 header 上限 | 先确认拒绝方；再考虑裁剪 claims 或换用 `X-Auth-Request-*` 传必要身份，而不是只调 nginx buffer |
| 日志警告 Cookie 超过 4kb 限制 | 出现 `_oauth2_proxy_0`、`_1` | 会话 Cookie 超过 oauth2-proxy 自身的 4000 字节 | 按收益排序：换 Redis 会话存储 → 减少请求 scope → 裁剪 claims；不要依赖分片 |
| 只有组多的用户失败 | 失败账号的 `groups` claim 明显更长 | `full.path=true` 写入完整组路径，叠加组数量 | 确认下游不依赖路径后改 `full.path=false`；或收敛组层级 |
| 开启轻量 token 后资源服务 401 | 401 且 token 里没有 `realm_access.roles` | 轻量 token 移除了角色 claims，资源服务仍按 JWT 自包含解析 | 改为 introspection（或带 `Accept: application/jwt`），或对该客户端改用完整 token |
| token exchange 换完整 token 失败 | 提示目标 audience 缺失 | 签发轻量 token 的客户端上，audience mapper 未打开 `Add to lightweight access token` | 打开该 mapper，让目标客户端进入 `aud` |
| 开启 `--session-cookie-minimal` 后刷新失败 | `invalid_grant` / `Token is not active` | 会话里已无 refresh token 可用于刷新 | 用 Redis 存储，或 `--cookie-refresh=0` 接受重新登录 |
| Keycloak 里会话有效，网关要求重新登录 | oauth2-proxy 日志无刷新错误 | `--cookie-expire` 短于 refresh token 生命周期 | 按官方推荐把 `cookie-expire` 对齐 refresh token、`cookie-refresh` 设为 access token 减 1 分钟 |
| 升级到 25.x 后 token 少了 claim | 对比升级前后 token | `sub`/`auth_time` 迁到 `basic` scope、`nonce` 只进 ID token、`session_state` 不再写入 | 按需补 `oidc-nonce-backwards-compatible-mapper`；依赖 `session_state` 的地方改用 `sid` |

## 回滚

三层改动的影响面不同，**一次只回退一层**，每步后重跑验证清单：

1. **Keycloak 客户端配置**（影响最小）：关闭 Always use lightweight access token 或摘掉 client policy，恢复被关闭的 mapper 开关，把 `full.path` 改回 `true`。回滚后要重新登录才会拿到新的 token 形态——已签发的 token 在其 `exp` 之前不会变。
2. **oauth2-proxy 参数**：`--session-cookie-minimal` 与 `--scope` 的改动回退到上一个 ConfigMap/Deployment 版本即可，但**用户需要重新登录**（Cookie 结构与 scope 都变了）。只回退 `--cookie-refresh`/`--cookie-expire` 时，保留一份改动前的 ConfigMap 便于对照。
3. **会话存储切换**（影响最大）：从 Redis 切回 Cookie store 时，所有现存 Redis 会话立即失效，等同于全体重新登录。切换前确认 `--cookie-secret` 仍然一致，否则 Cookie store 解密失败会表现为「登录成功但立刻又要求登录」。切换窗口尽量选低峰，并保留 Redis 实例一段时间以便回切。

回滚判据是「目标用户能正常登录且 Cookie 不再分片」，不是「日志没有新报错」。特别是第 1 层，claims 变化不会立刻体现在已签发 token 上，必须用重新登录后的 token 验证。

## 常见问题（IAM Token 体积与 Cookie）

### IAM 里的 Token 为什么会越来越大？

因为 token 是「用户权限快照」，而权限模型通常是只增不减的：新增业务就加角色，组织调整就加组，组又带层级路径。token 体积因此是组织结构的副产品，不是 IdP 的配置问题。可观测的信号是：某个用户的 token 体积突然跳变，通常对应一次组织或角色重构。

### Keycloak 有官方的减少 Token 体积功能吗？

有。24.0 引入 lightweight access token，25.0 进一步把 `sub`、`auth_time`、`nonce`、`session_state` 从相关 token 中移出。它通过 `use-lightweight-access-token` client policy 或客户端 Advanced settings 的开关启用，被移除的 claims 通过 introspection 或 token exchange 取回。这是结构级方案，比逐个关 mapper 更可靠。

### 启用轻量 access token 后资源服务 401 怎么办？

先确认资源服务是否依赖 `realm_access.roles` 这类被移除的 claim。依赖就改走 introspection（高频接口需评估额外往返成本），或对那个客户端保留完整 token；不依赖则说明它本来也不该解析这些 claim，把授权判断收敛到网关或授权服务更合理。

### oauth2-proxy 用 Cookie 存会话能支撑多少用户组？

没有官方给出的组数上限，因为决定因素是**序列化后的字节数**，而不是组数。可以按 4000 字节的绝对上限反推：先用本文第 2 步量出实际长度，再留出 30% 余量。一旦日志出现分片警告，说明已经越线，应尽早切 Redis 而不是靠调大代理 buffer 维持。

### 调大 nginx 的 header buffer 能解决 Token 过大的问题吗？

通常不能。nginx 默认 `large_client_header_buffers 4 8k` 只约束请求行与单个 header 字段，而 431 常常来自上游框架自己的限制；调大 nginx 只是让请求走得更远。而且 buffer 按连接分配，盲目调大会增加内存开销。正确顺序是确认拒绝方、再决定裁剪内容。

### `--cookie-expire` 改了会影响 Keycloak 侧会话吗？

不会。Cookie 有效期是网关本地的会话凭证生命周期，Keycloak 的 SSO/Client Session 由 IdP 自己的 idle/max 参数控制。两者不一致的表现是：Cookie 还在但 refresh token 已过期，或 Cookie 先过期导致 IdP 会话仍在却要重新登录。正确做法是按官方推荐对齐——`cookie-expire` 对齐 refresh token 生命周期。

## 关键来源

- [Keycloak Server Administration Guide：Using lightweight access token](https://www.keycloak.org/docs/latest/server_admin/)：不可移除 claims 清单（`exp`/`iat`/`jti`/`iss`/`typ`/`azp`/`sid`/`scope`/`cnf`）、`use-lightweight-access-token` executor 与 "Always use lightweight access token"、`Add to lightweight access token` 与 `Add to token introspection` 开关、Token Exchange 与 audience mapper 前提
- [Keycloak Protocol Mappers（Admin API 参考）](https://www.keycloak.org/admin-api/protocol-mappers)：`lightweight.claim`（默认 `false`）、`introspection.token.claim`（默认 `true`）等属性默认值；`oidc-group-membership-mapper` 的 `Full group path`（`full.path`，默认 `true`）
- [Keycloak 24.0 Release Notes](https://www.keycloak.org/docs/24.0.5/release_notes/)：Lightweight access tokens 首次引入、`Add to token introspection` 的升级兼容语义
- [Keycloak 25.0 Release Notes](https://www.keycloak.org/docs/25.0.6/release_notes/index.html)："Lightweight access token to be even more lightweight"：`sub`/`auth_time` 迁至 `basic` client scope、`nonce` 仅 ID token、`session_state` 不再写入
- [Keycloak Securing Applications and Services Guide](https://www.keycloak.org/docs/latest/securing_apps/)：introspection 请求 `Accept: application/jwt` 时返回完整 JWT access token
- [oauth2-proxy 源码 `pkg/sessions/cookie/session_store.go`](https://github.com/oauth2-proxy/oauth2-proxy/blob/master/pkg/sessions/cookie/session_store.go)：`maxCookieLength = 4000` 及注释、`splitCookie` / `splitCookieName`（`_0`、`_1` 后缀）、超限警告日志文本
- [oauth2-proxy Session Storage 官方文档](https://oauth2-proxy.github.io/oauth2-proxy/configuration/session_storage)：Cookie / Redis 后端差异、票据格式 `{CookieName}-{ticketID}.{secret}`、`SETEX` 写入、`cookie-refresh`/`cookie-expire` 与 token 生命周期的对应关系
- [oauth2-proxy Configuration Overview](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)：`--session-cookie-minimal`（cookie store 专用）、`--session-store-type`、`--cookie-csrf-per-request-limit` 等参数定义
- [oauth2-proxy issue #1940](https://github.com/oauth2-proxy/oauth2-proxy/issues/1940)、[#482](https://github.com/oauth2-proxy/oauth2-proxy/issues/482)、[#644](https://github.com/oauth2-proxy/oauth2-proxy/issues/644)、[#522](https://github.com/oauth2-proxy/oauth2-proxy/issues/522)：维护者对 Cookie 拆分的立场、MessagePack + LZ4 会话编码重构、`Header is too large: size 8193>8192` 与 `--session-cookie-minimal` 刷新失败的实际报错
- [nginx `large_client_header_buffers`](http://nginx.org/en/docs/http/ngx_http_core_module.html#large_client_header_buffers)：默认值 `4 8k`（`client_header_buffer_size` 默认 `1k`）
