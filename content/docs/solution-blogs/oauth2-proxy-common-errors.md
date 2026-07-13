---
title: "IAM 网关 oauth2-proxy 常见错误排错 | IDaaS Book"
description: "IAM 网关 oauth2-proxy 集成 Keycloak 的 12 个高频错误排错：CSRF Cookie、expected audience、redirect loop、invalid_token 与 Nginx 401。"
date: 2026-07-13T00:00:00+08:00
lastmod: 2026-07-13T00:00:00+08:00
draft: false
weight: 3
menu:
  docs:
    parent: "solution-blogs"
    identifier: "oauth2-proxy-common-errors"
toc: true
---

## 场景

你按照文档配好了 oauth2-proxy + Keycloak，部署到 Kubernetes，打开浏览器——白屏、401、无限跳转、或者 "csrf cookie not found"。这些错误 oauth2-proxy 的日志里写得很直白，但**为什么发生、怎么修**才是真正的卡点。

这篇文章把 GitHub Issues 和 Stack Overflow 上反复出现的高频错误整理成速查表：每条有诊断命令、根因分析、修复步骤。不需要逐条 Google——直接对号入座。

适用：oauth2-proxy v7.x + Keycloak（任意版本），auth-url 或 ForwardAuth 模式。

不适用：oauth2-proxy 旧版（v6 及以下，部分参数名不同）、非 Keycloak Provider（GitHub/Google 等 Provider 有各自特有的错误）。

## 错误速查导航

| 错误关键词 | 出现阶段 | 严重程度 | 跳转 |
|-----------|---------|---------|------|
| `csrf cookie not found` | 登录回调 | 🔴 阻断 | [错误 1](#1-csrf-cookie-not-found) |
| `expected audience` | Token 校验 | 🔴 阻断 | [错误 2](#2-expected-audience-got-account) |
| `redirect loop` / `ERR_TOO_MANY_REDIRECTS` | 登录后 | 🔴 阻断 | [错误 3](#3-登录后无限重定向-redirect-loop) |
| `invalid_token` | Token 校验 | 🔴 阻断 | [错误 4](#4-invalid_token) |
| `missing state parameter` | 登录回调 | 🔴 阻断 | [错误 5](#5-missing-state-parameter) |
| `cookie too large` | 登录回调 | 🟡 部分用户 | [错误 6](#6-cookie-too-large) |
| `401` 已登录却被拒 | 请求阶段 | 🟡 间歇性 | [错误 7](#7-401-已登录但认证被拒) |
| `could not get claim: missing claim "email"` | Token 校验 | 🟡 特定用户 | [错误 8](#8-missing-claim-email) |
| `error=access_denied` | Keycloak 端 | 🟡 配置 | [错误 9](#9-erroraccess_denied) |
| `Nginx 503` / `no live upstreams` | 请求阶段 | 🟡 基础设施 | [错误 10](#10-nginx-ingress-返回-503) |
| Cookie 只在主域名生效，子域名不行 | 跨子域 | 🟡 配置 | [错误 11](#11-cookie-跨子域不生效) |
| 登出一个应用导致全部退出 | 共享 session | 🟢 体验 | [错误 12](#12-登出一个应用全部退出) |

---

## 1. csrf cookie not found

**日志典型输出**：

```
oauth2-proxy[1] <timestamp> <request> 403 csrf cookie not found
```

**根因**：oauth2-proxy 在发起 OAuth 授权请求前，会生成一个 `_oauth2_proxy_csrf` Cookie（存储 state 参数的非对称哈希）。OAuth Provider（Keycloak）回调时，浏览器必须把这个 Cookie 原样带回 `/oauth2/callback`。以下任何一环断了都会触发这个错误：

1. **Cookie 被浏览器拒绝**：SameSite 过严 / Secure 标记与 HTTP 不匹配 / Domain 不匹配
2. **Cookie 路径不匹配**：CSRF Cookie 默认 path 为 `/`，但如果被反向代理改写可能出现不一致
3. **HTTPS 前端 → HTTP 后端**：Cookie 设了 `Secure`，但 oauth2-proxy 收到的请求是 HTTP（TLS 在上一级终结，`X-Forwarded-Proto` 没传对）
4. **跨域调用**：前端 SPA 在 `a.example.com`，oauth2-proxy 在 `auth.example.com`，Cookie Domain 不覆盖

### 诊断

```bash
# 1. 看 oauth2-proxy 日志确认错误来源
kubectl logs -n auth deploy/oauth2-proxy --tail=20 | grep csrf

# 2. 用浏览器 DevTools 看 Cookie 是否被写入
# Application → Cookies → 检查 _oauth2_proxy_csrf 是否存在
# 如果 CSRF Cookie 缺失，再看 Console 是否有 SameSite/Secure 警告

# 3. 检查 oauth2-proxy 启动参数中的 Cookie 配置
kubectl get deploy -n auth oauth2-proxy -o yaml | grep -E 'cookie-secure|cookie-samesite|cookie-domain|ssl-upstream-insecure-skip-verify'

# 4. 验证 X-Forwarded-Proto 是否正确传递
# 如果 oauth2-proxy 前置了 Nginx/Traefik，确认代理发送了 X-Forwarded-Proto
```

### 修复

```yaml
# oauth2-proxy 启动参数调整
args:
# 关键：SameSite 不能是 strict——Keycloak 回调是跨站请求（从 keycloak.example.com → myapp.example.com）
- --cookie-samesite=lax
# 如果 TLS 在外部 LB 终结，oauth2-proxy 监听 HTTP，则关闭 Secure（仅限内网通信）
# 更好的做法：在 oauth2-proxy 内部也启 TLS，或配置 --ssl-upstream-insecure-skip-verify
- --cookie-secure=false   # 仅当 oauth2-proxy 自身监听 HTTP 时
# 确保 Cookie Domain 覆盖回调域名
- --cookie-domain=.example.com
# 信任反向代理传入的转发头
- --reverse-proxy=true
```

**验证修复**：

1. 清除浏览器所有 Cookie（DevTools → Application → Clear site data）
2. 重新访问应用 URL
3. 观察 Network 面板：`/oauth2/start` 的响应头应有 `Set-Cookie: _oauth2_proxy_csrf=...`
4. 登录完成后不应再出现 403

> **常见误区**：不是所有 "csrf cookie not found" 都是 Cookie 问题。如果你的 oauth2-proxy 有多个副本且没用 Redis Session Store，用户首次请求打到副本 A（生成 CSRF Cookie），Keycloak 回调时被负载均衡打到副本 B——副本 B 不认识这个 CSRF Cookie，返回 403。解决办法：加 `--session-store-type=redis` 或使用 Ingress 的 session affinity（见 [错误 7](#7-401-已登录但认证被拒)）。

---

## 2. expected audience got ["account"]

**日志典型输出**：

```
oauth2-proxy[1] <timestamp> <request> 401 error validating token: 
oidc: expected audience "oauth2-proxy" got ["account"]
```

**根因**：oauth2-proxy v7.4+ 默认启用 `--insecure-oidc-skip-issuer-verification=false`，会校验 ID Token 的 `aud`（audience）字段。Keycloak 默认只在 `aud` 里填 `account`（代表 Account Console），不包含 Client ID。

### 诊断

```bash
# 1. 解码 ID Token 查看 aud 字段（在浏览器 DevTools → Network → /oauth2/callback 中找到 id_token）
echo "<id_token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .aud

# 预期输出包含你的 client ID，例如 ["account", "oauth2-proxy"]
# 如果只有 ["account"]，说明缺 Audience Mapper
```

### 修复

在 Keycloak Admin Console 中：

1. 进入目标 Realm → Clients → `oauth2-proxy`
2. **Client scopes** 标签 → 点击 `oauth2-proxy-dedicated`（或你用的 scope）
3. **Add mapper** → **By configuration** → 选择 **Audience**
4. 填写：

| 字段 | 值 |
|------|-----|
| Name | `aud-oauth2-proxy` |
| Included Client Audience | `oauth2-proxy` |
| Add to ID token | ON |
| Add to access token | ON |

5. 保存后**不需要重启 Keycloak**，新签发的 Token 立即生效。

**验证**：重新登录，解码新的 ID Token，确认 `aud` 包含 `"oauth2-proxy"`。

如果配置正确但仍然报错，检查 oauth2-proxy 的 `--client-id` 是否与 Keycloak 的 Client ID 完全一致（大小写敏感）。

---

## 3. 登录后无限重定向（redirect loop）

**现象**：输入用户名密码 → Keycloak 返回 302 → 浏览器短暂闪一下应用页面 → 又被 302 到 Keycloak 登录页 → 周而复始，最终 `ERR_TOO_MANY_REDIRECTS`。

这是最复杂的错误类别，根因在四个层面之一。详细排查路线图见 **[Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}})**，这里只给快速对照：

| 层面 | 快速检查 | 高频原因 |
|------|---------|---------|
| Cookie | `--cookie-domain` / `--cookie-samesite` | SameSite=strict 拦截 Keycloak 回调；或 Domain 不匹配导致 Cookie 写不进去 |
| TLS/代理 | `X-Forwarded-Proto` 的值 | Keycloak 看到的是 HTTP，签发 `http://` 的 redirect_uri |
| OIDC 回调 | `redirect_uri` 是否精确匹配 | Keycloak 配置的 Redirect URI 和实际请求差一个斜杠/端口/协议 |
| Token 校验 | `--oidc-issuer-url` 是否正确 | issuer URL 与 ID Token 中的 `iss` 声明不一致 |

**最快的排错方式**：

```bash
# 1. 确认 oauth2-proxy 能否正确连接 Keycloak OIDC Discovery
kubectl exec -n auth deploy/oauth2-proxy -- wget -qO- \
  https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration 2>&1 | head

# 2. 用浏览器 DevTools 跟踪完整流程
# Network 面板 → 勾选 Preserve log
# 找到 /oauth2/start → /auth?（跳转 Keycloak）→ /oauth2/callback?code= → /app 这条链路
# 哪个环节返回的 HTTP 状态码不对劲，就是那个环节的问题
```

---

## 4. invalid_token

**日志典型输出**：

```
invalid_token
token contains an invalid number of segments
failed to verify token: oidc: unable to verify jwt: ...
```

**根因分类**：

| 子类型 | 日志特征 | 根因 |
|--------|---------|------|
| JWT 格式错误 | `invalid number of segments` | 传入的不是 JWT（可能是 refresh token 被当 access token 用了） |
| 签名校验失败 | `unable to verify jwt` | Keycloak 的公钥和签发 Token 的私钥不匹配（Realm 重建后密钥对变了） |
| 过期 | `token is expired` | Token 过期，但 oauth2-proxy 没正确 refresh |
| issuer 不匹配 | `issuer mismatch` | `--oidc-issuer-url` 与 Token 中 `iss` 不同 |

### 诊断

```bash
# 1. 解码 Token 查看关键字段
echo "<token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq '{iss, aud, exp, iat, nbf}'

# 2. 对比 oidc-issuer-url
kubectl get deploy -n auth oauth2-proxy -o yaml | grep oidc-issuer-url

# 3. 确认 Keycloak 的 issuer 值
curl -s https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration | jq .issuer
```

### 修复

- **issuer 不匹配**：`--oidc-issuer-url` 必须与 Keycloak OIDC Discovery 返回的 `issuer` 完全一致（注意尾部斜杠、端口号）
- **签名校验失败**：Keycloak Realm 重建后，oauth2-proxy 可能需要重启来刷新 JWKS 缓存。如果 Keycloak 配置了多个签名密钥（轮换期间），确认 oauth2-proxy v7.5+ 版本（支持多 JWK）
- **Token 过期**：检查 `--cookie-refresh` 参数是否小于 Token 有效期。Keycloak 默认 Access Token 5 分钟，ID Token 也是 5 分钟

```bash
# 临时绕过 issuer 校验排查（仅测试用，不要在生产环境留这个参数）
- --insecure-oidc-allow-unverified-email=true
- --insecure-oidc-skip-issuer-verification=true
```

---

## 5. missing state parameter

**日志输出**：

```
oauth2-proxy[1] <timestamp> <request> 403 missing state parameter
```

**根因**：OAuth 2.0 的 CSRF 防护依赖 `state` 参数——oauth2-proxy 发起授权请求时生成一个随机 state，Keycloak 必须原样返回。如果 Keycloak 回调时 URL 中没有 `state` 参数，说明：

1. **Keycloak 配置的回调 URI 带了额外参数**，覆盖了 oauth2-proxy 的 state
2. **用户直接访问了 `/oauth2/callback`**（不应该手动访问）
3. **中间有代理/网关** 截断了 URL 参数

### 诊断

```bash
# 1. 检查 Keycloak 客户端的 Valid Redirect URIs
# Keycloak Admin Console → Clients → oauth2-proxy → Settings
# 应为 https://myapp.example.com/oauth2/callback
# 不要加 ? 或额外查询参数

# 2. 确认 Nginx/Traefik 没有截断 query string
# Nginx: 确认 proxy_pass 没有尾部斜杠错误
# Traefik: ForwardAuth 中间件默认保留 query string，不需要额外配置
```

### 修复

1. 在 Keycloak 中检查 Redirect URI 配置：去掉 `?`、`&` 或任何多余参数
2. 如果用了 CDN/WAF（Cloudflare、阿里云 WAF），检查是否有规则过滤了 URL 参数
3. 清除浏览器缓存后重试

---

## 6. cookie too large

**日志输出**：

```
cookie value too long (4096 bytes max)
```

**根因**：oauth2-proxy 把 ID Token、Access Token、Refresh Token 全部加密存在 Cookie 里。如果 Token 中包含大量 claims（如组列表、角色列表），Cookie 可能超过浏览器 4096 字节限制。

高发于：Keycloak 用户属于几十个 group，每个 group 名字又很长。

### 修复

**方案 1：使用 Redis Session Store，Cookie 只存 Session ID**

Redis 是降低 Cookie 体积和集中管理会话的选项，不是多副本部署的硬性前提。普通 Cookie store 在所有副本共享同一个 `--cookie-secret` 时可以无状态工作；启用 Redis 后，需要把 Redis 的高可用、备份和故障切换纳入 IAM 网关的运维范围。

```yaml
args:
- --session-store-type=redis
- --redis-connection-url=redis://redis.auth.svc.cluster.local:6379/0
```

**方案 2：精简 Cookie 内容**

```yaml
# 如果后端不需要 Access Token，不传递
# --pass-access-token=false
# --set-authorization-header=false
```

**方案 3：减少 Token 中的 claims**

在 Keycloak 中移除不必要的 Protocol Mapper（如大段的自定义属性映射），或用 Client Scope 限制 scope：

```yaml
args:
- --scope=openid   # 只要 openid，不加 email profile（如果不需要的话）
```

---

## 7. 401 已登录但认证被拒

**现象**：登录成功，Cookie 存在，但过一段时间（或刷新页面）返回 401。

**根因**：先区分两种 Session Store。默认 Cookie store 将会话加密放在浏览器 Cookie 中，因此副本 A、B 只要共享同一个 `--cookie-secret` 就能读取它；多副本本身不会造成“副本 B 不认识会话”。如果使用 Redis Session Store，则所有副本必须访问同一个 Redis。仍然出现 401 时，优先检查 Cookie 是否过期、刷新失败、Secret 是否不一致，以及代理是否丢失 Cookie，而不是先把问题归咎于副本数。

### 诊断

```bash
# 1. 确认副本数
kubectl get deploy -n auth oauth2-proxy

# 2. 确认是否有 session affinity 配置
kubectl get ingress -A -o yaml | grep -A5 'session-cookie'

# 3. 查看是否有 refresh token 相关错误
kubectl logs -n auth deploy/oauth2-proxy --tail=50 | grep -E 'refresh|expired|session'
```

### 修复

```yaml
# 方案 1：Redis Session Store（推荐）
args:
- --session-store-type=redis
- --redis-connection-url=redis://redis:6379/0

# 方案 2：Ingress 层 Session Affinity
# Nginx Ingress:
metadata:
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/session-cookie-name: "OAUTH2_PROXY_ROUTE"
    nginx.ingress.kubernetes.io/session-cookie-path: "/"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "3600"
```

---

## 8. missing claim "email"

**日志输出**：

```
could not get claim: missing claim "email"
```

**根因**：oauth2-proxy 默认要求 ID Token 中必须有 `email` claim。某些用户（如 LDAP 联邦过来的用户、Keycloak 内部 service account）在 Keycloak 中没有配置邮箱。

### 修复

**方案 1：确保用户有邮箱**

在 Keycloak 中：Users → 目标用户 → Attributes → 添加 `email` 属性；或用 User Federation mapper 从 LDAP/AD 映射 `mail` → `email`。

**方案 2：放宽 oauth2-proxy 的 email 要求**

```yaml
args:
- --insecure-oidc-allow-unverified-email=true
- --email-domain=*   # 允许所有域（包括空邮箱）
```

**方案 3（推荐）：创建 Keycloak Protocol Mapper 保底**

在 Client Scope 中添加一个 **Hardcoded claim** mapper：如果用户没有邮箱，回退到 username + `@placeholder.local`：

1. Clients → oauth2-proxy → Client scopes → 专用 scope
2. Add mapper → **Hardcoded claim**
3. Token Claim Name: `email`, Claim value: 留空
4. 再添加一个 **User Attribute** mapper（email → email），优先级更高

---

## 9. error=access_denied

**现象**：浏览器地址栏出现 `https://myapp.example.com/oauth2/callback?error=access_denied&...`

**根因**：Keycloak 拒绝了授权请求。常见原因：

| 原因 | 检查 |
|------|------|
| 用户不在 `--allowed-group` 指定的组里 | `kubectl logs` 可以看到 oauth2-proxy 把哪些 group 传给了 Provider |
| Client 的 "Consent Required" 关了但用户没有已存 consent | Keycloak Clients → oauth2-proxy → 打开 Consent Required |
| 用户被 Keycloak 的 Brute Force Detection 暂时锁定 | Keycloak → Realm Settings → Security Defenses → Brute Force Detection |
| `scope` 参数中请求了不被 Client 允许的 scope | oauth2-proxy `--scope=openid email profile` 需要 Client 的 Client Scopes 包含这些 |

### 修复

1. 确认 `--allowed-group` 中的组名与 Keycloak 中的组名完全一致
2. 如果不需要组限制，去掉 `--allowed-group` 参数
3. 检查 Keycloak 的 Events（Admin Console → Events → Login Events），会显示具体的 "DENIED" 原因

---

## 10. Nginx Ingress 返回 503

**现象**：访问应用 URL，Nginx 返回 503 Service Temporarily Unavailable。

**根因**：Ingress Controller 无法访问 oauth2-proxy 的 `auth-url` 端点。

### 诊断

```bash
# 1. 确认 oauth2-proxy Service 的端点健康
kubectl get endpoints -n auth oauth2-proxy

# 2. 检查 Ingress annotation 中的 auth-url 是否可达
kubectl get ingress <ingress-name> -o yaml | grep auth-url

# 3. 从 Ingress Controller Pod 测试连接
kubectl exec -n ingress-nginx deploy/ingress-nginx-controller -- \
  curl -sS -o /dev/null -w "%{http_code}" \
  http://oauth2-proxy.auth.svc.cluster.local:4180/ping

# 预期：200（/ping 不要求认证）
```

### 修复

- 如果 endpoint 为空：检查 oauth2-proxy Pod 是否 Ready，`kubectl describe pod` 看 readiness probe
- 如果 Service 名不对：确认 Ingress annotation 中用的是 `<service>.<namespace>.svc.cluster.local`
- 如果在 K3s/K0s 等非标准 K8s 发行版：确认 CoreDNS 正常，`svc.cluster.local` 可解析

---

## 11. Cookie 跨子域不生效

**现象**：`app1.example.com` 登录成功，访问 `app2.example.com` 需要重新登录。

**根因**：`--cookie-domain` 没有在前加点号 `.`。

### 修复

```yaml
# ❌ 错误：只能匹配 example.com 本身
- --cookie-domain=example.com

# ✅ 正确：匹配 *.example.com 所有子域
- --cookie-domain=.example.com
```

**验证**：

```bash
# 浏览器 DevTools → Application → Cookies → 查看 _oauth2_proxy Cookie 的 Domain 属性
# 应为 .example.com（带前导点号）
```

---

## 12. 登出一个应用全部退出

**现象**：在应用 A 点了退出，应用 B、C 也全部退出了。

**根因**：多个应用共用同一个 oauth2-proxy 实例和同一个 Cookie Domain。调用 `/oauth2/sign_out` 时，清除了所有子域共享的 Cookie。

这可能是**符合预期的**（统一登出是 SSO 的标准行为），也可能是**不想要的**（不同应用应该独立管理 session）。

### 方案

**如果需要各自独立**：

```yaml
# 每个应用部署独立的 oauth2-proxy 实例
# 关键差异：cookie-name 不同
实例 A:
- --cookie-name=_oauth2_proxy_app_a
- --cookie-domain=app-a.example.com

实例 B:
- --cookie-name=_oauth2_proxy_app_b
- --cookie-domain=app-b.example.com
```

**如果需要统一登出，但只想登出当前应用**：使用 Keycloak 的 `/protocol/openid-connect/logout` 而非 oauth2-proxy 的 `/oauth2/sign_out`。

---

## 诊断命令速查

```bash
# oauth2-proxy 日志（最近 50 行，过滤错误）
kubectl logs -n auth deploy/oauth2-proxy --tail=50 | grep -iE 'error|fail|invalid|csrf|403|401'

# 查看 oauth2-proxy 完整启动参数
kubectl get deploy -n auth oauth2-proxy -o jsonpath='{.spec.template.spec.containers[0].args}' | jq -r '.[]'

# Keycloak OIDC Discovery
curl -s https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration | jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri}'

# 解码 JWT（三部分，取第二部分 payload）
echo "<jwt>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .

# 检查 Keycloak 客户端配置的 Redirect URI
# Keycloak Admin Console → Clients → oauth2-proxy → Settings → Valid Redirect URIs
# 或通过 REST API：
# curl -s -H "Authorization: Bearer <admin_token>" \
#   https://keycloak.example.com/admin/realms/myrealm/clients?clientId=oauth2-proxy | jq .

# 测试 oauth2-proxy 健康端点
curl -s http://oauth2-proxy.auth.svc.cluster.local:4180/ping
# 预期：OK

# 模拟认证请求（不带 Cookie）
curl -v http://oauth2-proxy.auth.svc.cluster.local:4180/oauth2/auth
# 预期：401（未认证）
```

---

## 延伸阅读

- [Keycloak + oauth2-proxy 集成实战指南]({{< relref "keycloak-oauth2-proxy" >}})——完整部署配置，从 Keycloak 到 Nginx Ingress 到 Traefik ForwardAuth
- [Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}})——重定向循环的完整排查路线图
- [Traefik ForwardAuth + Keycloak + oauth2-proxy]({{< relref "traefik-forwardauth-keycloak" >}})——Traefik 网关下的配置与排错
- [oauth2-proxy 深度介绍]({{< relref "../implementation/oauth2-proxy-deep-dive" >}})——架构原理、Provider 选型、Cookie/Session 机制
- [oauth2-proxy 官方文档 — Keycloak OIDC Provider](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc)
- [oauth2-proxy GitHub Issues](https://github.com/oauth2-proxy/oauth2-proxy/issues)

---

## IAM FAQ

### oauth2-proxy 和 Nginx Ingress auth-url 是什么关系？

oauth2-proxy 是认证决策点。Nginx Ingress 用 `auth-url` 注解把每个外部请求发给 oauth2-proxy 做认证判定。oauth2-proxy 返回 202 → Ingress 放行；返回 401 → Ingress 把用户重定向到 Keycloak 登录。这种模式叫**外部认证（external auth）**，oauth2-proxy 不代理流量，只做判定。

### oauth2-proxy 和 Keycloak 的 IAM 职责怎么划分？

Keycloak 是 IAM 的身份提供者（IDP）：管理用户、组、角色、密码策略、MFA、身份联邦。oauth2-proxy 是策略执行点（PEP）：在流量入口拦住未认证请求，发起 OIDC 登录，向后端透传认证结果。两者配合形成完整的 IAM 认证链路——Keycloak 管「你是谁」，oauth2-proxy 管「你能不能进这个应用」。

### 多副本 oauth2-proxy 一定要 Redis 吗？

不一定。默认 Cookie store 是无状态的，多副本共享同一个 `--cookie-secret` 即可读取会话；Redis 主要用于减小 Cookie、集中撤销会话或把状态放到服务端。启用 Redis 后，Redis 也成为 IAM 网关的运行依赖，需要配置认证、TLS、监控和备份。
