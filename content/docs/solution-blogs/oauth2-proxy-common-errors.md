---
title: "IAM 网关 oauth2-proxy 常见错误排错 | IDaaS Book"
description: "IAM 网关 oauth2-proxy 集成 Keycloak 的 12 个高频错误排错：CSRF Cookie、expected audience、redirect loop、invalid_token 与 Nginx 401。"
date: 2026-07-13T00:00:00+08:00
lastmod: 2026-08-10T21:00:00+08:00
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

这篇文章把 oauth2-proxy 的公开 Issue 与可复现的配置逻辑整理成速查表：每条有诊断命令、根因分析和修复步骤。Issue 只能说明问题曾被报告，不能替代当前版本的验证。

适用：oauth2-proxy v7.x + Keycloak（任意版本），auth-url 或 ForwardAuth 模式。

不适用：oauth2-proxy 旧版（v6 及以下，部分参数名不同）、非 Keycloak Provider（GitHub/Google 等 Provider 有各自特有的错误）。

> **参数边界**：反向代理场景应同时设置 `--reverse-proxy=true` 和受控的 `--trusted-proxy-ip`。不要把“信任转发头”理解成“信任所有客户端发送的转发头”。oauth2-proxy 官方配置说明指出，未设置 `--trusted-proxy-ip` 时会为兼容旧行为而信任所有来源；能直连 oauth2-proxy 的客户端因此可能伪造 `X-Forwarded-*`。本文参数以[官方配置文档](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/)为准。

先验证网络边界，再看 Cookie 或 `redirect_uri`：oauth2-proxy Service 应使用 ClusterIP，网络策略只允许入口代理访问；不要把“能从 Pod 内 curl 通”误当成“公网路径和转发头可信”。如果入口代理的地址来自节点、云负载均衡或多个网段，应以实际连接来源和部署文档为准逐项收敛，不能直接填整个 VPC。

```yaml
# 示例：网段必须替换为实际 ingress-nginx/Traefik 的来源地址
- --reverse-proxy=true
- --trusted-proxy-ip=10.42.0.0/16
```

这条检查适用于 [Keycloak + oauth2-proxy 集成]({{< relref "keycloak-oauth2-proxy" >}})、[Traefik ForwardAuth]({{< relref "traefik-forwardauth-keycloak" >}}) 和 [Keycloak 重定向循环排错]({{< relref "keycloak-redirect-loop-troubleshooting" >}})；三者的入口组件不同，但转发头的信任边界相同。

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

**根因**：oauth2-proxy 在发起 OAuth 授权请求前，会生成一个 `_oauth2_proxy_csrf` Cookie，用于把回调与此前的授权请求关联起来。OAuth Provider（Keycloak）回调时，浏览器必须把这个 Cookie 带回 `/oauth2/callback`。以下任何一环断了都会触发这个错误：

1. **Cookie 被浏览器拒绝**：SameSite 过严 / Secure 标记与 HTTP 不匹配 / Domain 不匹配
2. **Cookie 路径不匹配**：CSRF Cookie 默认 path 为 `/`，但如果被反向代理改写可能出现不一致
3. **HTTPS 前端 → HTTP 后端的转发头错误**：浏览器访问的是 HTTPS，但入口没有把 `X-Forwarded-Proto: https` 传给 oauth2-proxy；不要仅因 Pod 内部监听 HTTP 就关闭 `Secure`
4. **Cookie Domain 不覆盖回调主机**：例如应用在 `a.example.com`，认证入口在 `auth.example.com`，但 Cookie 没有显式设置共享父域

还有一个容易被误判成“Cookie 随机丢失”的分支：同一个浏览器同时发起多个未认证请求。默认情况下，oauth2-proxy 不为每个请求创建独立的 CSRF Cookie；多个标签页、前端并行加载资源，或用户连续点击登录，都可能让较早的 `state` 与回调不再对应。若日志同时出现 `csrf cookie not found`、`state mismatch`，并且响应头已经成功写入 CSRF Cookie，优先检查这个并发场景，而不是先扩大 Cookie Domain。

### 诊断

```bash
# 1. 看 oauth2-proxy 日志确认错误来源
kubectl logs -n auth deploy/oauth2-proxy --tail=20 | grep csrf

# 2. 用浏览器 DevTools 看 Cookie 是否被写入
# Application → Cookies → 检查 _oauth2_proxy_csrf 是否存在
# 如果 CSRF Cookie 缺失，再看 Console 是否有 SameSite/Secure 警告

# 3. 检查 oauth2-proxy 启动参数中的 Cookie 配置
kubectl get deploy -n auth oauth2-proxy -o yaml | grep -E 'cookie-secure|cookie-samesite|cookie-domain|ssl-upstream-insecure-skip-verify'

# 4. 从入口代理所在位置检查转发头；不要只看 oauth2-proxy Pod 内的请求
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=50 | grep -E 'oauth2|X-Forwarded-Proto'
# 5. 检查 oauth2-proxy 是否限制了可信代理来源
kubectl get deploy -n auth oauth2-proxy -o yaml | grep -E 'reverse-proxy|trusted-proxy-ip'
```

### 修复

先保持浏览器访问、Keycloak 回调和 `redirect_uri` 全部使用 HTTPS。TLS 在 Ingress/LB 终结并不意味着要关闭 Cookie 的 `Secure` 属性；应让入口代理正确传递 `X-Forwarded-Proto: https`，并只信任入口代理的地址段。

```yaml
# oauth2-proxy 启动参数调整
args:
# Keycloak 回调通常需要 Lax；只有明确需要跨站 Cookie 时才考虑 None（且必须 Secure）
- --cookie-samesite=lax
- --cookie-secure=true
# 确保 Cookie Domain 覆盖回调域名；单域名部署可省略此项
- --cookie-domain=.example.com
- --reverse-proxy=true
# 换成实际 Ingress/LB 的 Pod 网段或固定出口 CIDR，不要照抄示例
- --trusted-proxy-ip=10.42.0.0/16
```

`--reverse-proxy=true` 只表示按反向代理场景处理请求；它不应被当成“任意客户端都可以提交可信转发头”。oauth2-proxy 当前文档说明，未设置 `--trusted-proxy-ip` 时出于兼容性会信任所有来源，这允许能够直连 oauth2-proxy 的客户端伪造 `X-Forwarded-*`。生产环境应限制 NetworkPolicy/Service 暴露面，并配置实际代理的 IP/CIDR；如果代理地址是动态变化的，优先固定出口或用网络层阻断直连，而不是放大信任范围。

如果同时启用 `--trusted-ip` 作为认证绕过白名单，必须单独审查 `--real-client-ip-header` 的来源链：客户端可直接到达 oauth2-proxy 时，不应信任它提交的 `X-Forwarded-For`。oauth2-proxy 当前仍有关于沿代理链解析该 Header 的安全改进 PR（[#3478](https://github.com/oauth2-proxy/oauth2-proxy/pull/3478)，截至本页更新尚未合入）；在确认所用版本已包含修复前，优先不要用基于转发头的 `--trusted-ip` 绕过认证，或在网络层保证只有受控代理能访问该服务。

如果确实在没有 HTTPS 的本地开发环境运行，才临时使用 `--cookie-secure=false`；不要把这个开关作为生产环境 TLS 终结后的修复。

**验证修复**：

1. 清除浏览器所有 Cookie（DevTools → Application → Clear site data）
2. 重新访问应用 URL
3. 观察 Network 面板：`/oauth2/start` 的响应头应有 `Set-Cookie: _oauth2_proxy_csrf=...`
4. 登录完成后不应再出现 403

如果问题只在并行登录或多个标签页复现，可以显式为每个授权请求启用独立 CSRF Cookie：

```yaml
args:
- --cookie-csrf-per-request=true
# 只在确认浏览器/代理出现 431 Request Header Fields Too Large 时设置上限；
# 上限过小会让较早的并行登录请求失效
- --cookie-csrf-per-request-limit=10
```

`--cookie-csrf-per-request-limit` 只有在 `--cookie-csrf-per-request=true` 时生效；它限制 oauth2-proxy 保留的并行 CSRF Cookie 数量，超出后删除最早的 Cookie。先不设置上限通常更容易验证根因，但生产环境应结合浏览器并发行为和代理 Header 大小限制决定是否加上限。改动后清理旧 Cookie，再用两个标签页同时访问受保护 URL，确认两次回调都能完成；若出现 431，回到上限、Cookie Domain 和代理 Header 限制一起检查。

### Traefik `errors` 中间件造成的并发 CSRF 覆盖

如果使用 Traefik `ForwardAuth`，再用 `errors` 中间件把 401 重定向到 `/oauth2/sign_in`，不要只测试“点击登录”这一条路径。页面加载时的 JavaScript、CSS、favicon 或 Service Worker 可能同时触发多个未认证请求；在 `--skip-provider-button=true` 时，这些请求可能各自启动授权流程并反复写入 CSRF Cookie。最后一个 Cookie 与浏览器正在完成的较早授权请求不匹配，就会得到 `CSRF token mismatch`，看起来像随机故障，实际是竞态。

先看浏览器 Network 面板和 oauth2-proxy 访问日志：如果一次页面加载出现多个 `/oauth2/start` 或 `/oauth2/sign_in`，并且它们连续返回 `Set-Cookie: _oauth2_proxy_csrf=...`，就不要先改 SameSite 或加 Redis。可控的修复顺序是：

1. 暂时将 `--skip-provider-button=false`，让 `/oauth2/sign_in` 只展示登录页，由用户的一次明确导航触发 `/oauth2/start`；这是降低并发启动的诊断和缓解措施，不是对所有代理拓扑的永久保证。
2. 在确认确实需要并行授权后，再启用 `--cookie-csrf-per-request=true`，并按代理 Header 大小设置 `--cookie-csrf-per-request-limit`；不要无限制地把 Cookie 数量调大。
3. 把静态资源和 Service Worker 的未认证请求从错误重定向链路中排除，或让入口只对页面导航触发登录。验证时保留浏览器 Network 日志，确认一次登录只产生预期的授权请求。

这个现象已有 oauth2-proxy issue [#3463](https://github.com/oauth2-proxy/oauth2-proxy/issues/3463) 的复现记录；该 issue 报告的版本和 Traefik 版本属于具体案例，不能据此推断所有版本都相同。最终应以所部署版本的行为为准。关于子域名场景下 CSRF Cookie 不出现的另一类排查线索，可参阅 [Stack Overflow 问题](https://stackoverflow.com/questions/77504002/oauth2-proxy-and-subdomains-unable-to-obtain-csrf-cookie)，但不要把社区问答当作配置规范。

> **常见误区**：看到多副本就立刻加 Redis。这里有一个容易把排错方向带偏的细节：**默认 Cookie Session Store 并不要求回调落到同一个 Pod**。只要多个副本使用相同的 `--cookie-secret`，各副本都能解密由其他副本签发的会话 Cookie；把“多副本”直接等同于“必须上 Redis”会平白增加一个运行依赖。当前 oauth2-proxy 文档将 `cookie` 列为默认 Session Store，`redis` 是另一种可选后端。

只有在以下情况才优先考虑 Redis：Cookie 体积超过浏览器或代理限制、需要服务端集中撤销会话，或希望不把 OAuth Token 放进 Cookie。迁移时先保留相同的外部回调地址和 Cookie 参数，在灰度副本上启用 Redis，并为 Redis 配置 TLS、认证、超时和监控；不要把 `--redis-insecure-skip-tls-verify=true` 当成生产修复。最小配置形态如下（连接字符串和密码放 Secret，不要写入 Git）：

```yaml
args:
- --session-store-type=redis
- --redis-connection-url=rediss://<redis-host>:<port>
# 按部署版本确认对应的密码参数；不要把密码拼进公开的命令示例或日志
- --redis-password=$(REDIS_PASSWORD)
```

**验证顺序**：先看 oauth2-proxy 启动日志确认 Session Store 初始化成功，再用浏览器完成一次全新的登录，最后滚动重启一个副本并访问受保护应用。如果 Redis 不可用，回滚到 `--session-store-type=cookie` 前要评估已有 Redis 会话是否失效；这不是无损切换，最好安排在可接受重新登录的维护窗口。

---

## 2. expected audience got ["account"]

**日志典型输出**：

```
oauth2-proxy[1] <timestamp> <request> 401 error validating token: 
oidc: expected audience "oauth2-proxy" got ["account"]
```

**根因**：oauth2-proxy 的 OIDC 校验会按 `aud`（audience）检查 ID Token 的接收方；当前配置文档中，`--oidc-audience-claim` 默认读取 `aud`，而 `--oidc-extra-audience` 只是额外允许的 audience。Keycloak 只把 `account` 放进 `aud` 时，Token 没有包含 oauth2-proxy 的 Client ID，因此会被拒绝。不要把这个错误归因于某个固定版本号：应以实际运行镜像的启动参数和配置文档为准。

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

**不一定要改 Keycloak 的 Token**：如果同一个客户端需要接受多个明确的 audience，可以在 oauth2-proxy 中用 `--oidc-extra-audience` 增加允许值；它只是在校验时扩大白名单，不会把 audience 写进 Token，也不会替代 `iss`、签名和 `exp` 校验。例如：

```yaml
args:
- --client-id=oauth2-proxy
- --oidc-extra-audience=legacy-dashboard
```

这里必须先确认 `legacy-dashboard` 确实是该 OIDC 客户端应接受的 audience，而不是为了让 401 消失就把任意值加入白名单。`--oidc-extra-audience` 只改变 oauth2-proxy 本地的允许列表，不会修改 Keycloak 已签发的 Token，也不会替代资源服务器对 `iss`、签名、`exp` 和自身 `aud` 的校验。若问题是上游没有把正确的接收方写入 Token，优先修正 Keycloak 的 Audience mapper，并用**新签发的同一种 Token**复核；不要拿 Access Token 的 `aud` 去推断 oauth2-proxy 校验的 ID Token，或反过来混用。

**更稳妥的验证命令**（处理 JWT 常见的 Base64URL 无填充，而不是直接假设普通 Base64）：

```bash
TOKEN='<从实际回调或认证响应取得的 JWT>'
python3 - "$TOKEN" <<'PY'
import base64
import json
import sys

parts = sys.argv[1].split('.')
if len(parts) != 3:
    raise SystemExit('not a JWT: expected 3 segments')
payload = base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4))
print(json.dumps(json.loads(payload), ensure_ascii=False, indent=2))
PY
```

只把 `aud`、`iss`、`exp` 等字段用于诊断，不要把真实生产 Token 粘贴到工单、聊天或日志中。JWT Payload 只是可读编码，不是加密材料；验签仍必须由 oauth2-proxy 使用 Discovery/JWKS 完成。

只有在 `oauth2-proxy` 自己应当成为 Token audience、或者后端也依赖该 claim 时，才在 Keycloak 添加 Audience Mapper。不要为了“让报错消失”使用跳过 issuer 或 JWT 校验的参数；那会把配置错误变成认证绕过风险。

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
# 1. 从集群网络路径确认 oauth2-proxy 能否访问 OIDC Discovery
# 不要默认 oauth2-proxy 镜像内含 wget/curl；用一次性排错 Pod，或换成集群已有的 debug 容器。
kubectl run oidc-debug --rm -i --restart=Never \
  --image=curlimages/curl:8.10.1 -- \
  -fsS https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration \
  | jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri}'

# 如果集群禁止临时 Pod，使用已经存在的网络诊断容器执行同一 curl；
# 关键是测试路径、DNS 和 CA 信任，而不是测试 oauth2-proxy 容器是否带 wget。

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
- **签名校验失败**：先确认 Discovery/JWKS 端点可从 oauth2-proxy Pod 访问，并检查日志中的 `kid` 是否能在当前 JWKS 中找到。Keycloak 密钥轮换或 Realm 重建后，先按运行版本确认 JWKS 缓存刷新行为，再重启 oauth2-proxy；不要用跳过校验的开关掩盖密钥或网络问题。
- **Token 过期**：检查 `--cookie-refresh` 是否小于上游会话或 Token 的有效期；实际有效期以 Realm 和 Client 配置为准，不要把某个默认分钟数写死到生产判断里。

不要用 `--insecure-oidc-skip-issuer-verification` 或类似“不验证”参数作为修复。它会降低认证边界，且无法修复签名、`aud`、过期时间或错误的 Discovery 地址。需要定位时，分别记录 Discovery 返回的 `issuer`、JWKS URL、Token 的 `iss`/`aud`/`kid`，再恢复严格校验后验证。

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

**根因**：Cookie Store 会把会话数据放入加密 Cookie；如果 Token 中包含大量 claims（如组列表、角色列表），Cookie 可能超过浏览器或代理的单 Cookie 大小限制。具体内容取决于 Provider、Session Store 和配置，不应假定三种 Token 都一定完整地存进 Cookie。

高发于：Keycloak 用户属于几十个 group，每个 group 名字又很长。

### 修复

**方案 1：使用 Redis Session Store，Cookie 只存 Session ID**

Redis 是降低 Cookie 体积和集中管理会话的选项，不是多副本部署的硬性前提。普通 Cookie store 在所有副本共享同一个 `--cookie-secret` 时可以无状态工作；启用 Redis 后，需要把 Redis 的高可用、备份和故障切换纳入 IAM 网关的运维范围。

```yaml
args:
- --session-store-type=redis
- --redis-connection-url=rediss://redis.auth.svc.cluster.local:6380/0
# 生产环境还应通过 Secret 注入 Redis 凭据，并校验证书；不要把密码写进 Git
```

**方案 2：关闭不需要的凭据转发**

```yaml
# 如果后端不需要 Access Token，不传递
# --pass-access-token=false
# --set-authorization-header=false
# auth-url 模式也不需要 Basic Auth 头
- --pass-basic-auth=false
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

# 2. Cookie Session Store：确认所有副本使用同一个 Secret（不要打印 Secret 值）
kubectl get deploy -n auth oauth2-proxy -o yaml | grep -A3 -E 'cookie-secret|secretKeyRef'

# 3. Redis Session Store：确认所有副本指向同一个 Redis，并查看 refresh/session 错误
kubectl get deploy -n auth oauth2-proxy -o yaml | grep -E 'session-store-type|redis-connection-url'
kubectl logs -n auth deploy/oauth2-proxy --tail=50 | grep -E 'refresh|expired|session'
```

### 修复

```yaml
# 方案 1：需要服务端会话、集中撤销或 Cookie 过大时使用 Redis
args:
- --session-store-type=redis
- --redis-connection-url=rediss://redis.auth.svc.cluster.local:6380/0
# 凭据通过 Secret 注入；同时配置 Redis 的 TLS、认证、超时、监控和备份

# 方案 2：继续使用默认 Cookie Session Store
# 所有副本必须共享同一个 cookie-secret；不需要为了多副本单独启用
# Ingress session affinity。若 Secret 不一致，滚动发布后旧会话会间歇性失效。
```

Session affinity 只能掩盖路由问题，不能修复不同副本使用不同 `--cookie-secret` 或 Redis 数据不一致的问题。改用 Redis 或修改 Secret 前，先安排可接受重新登录的窗口；Cookie Store 与 Redis Store 之间不是无损热切换。

---

## 8. missing claim "email"

**日志输出**：

```
could not get claim: missing claim "email"
```

**根因**：当前配置或 Provider 校验路径需要 `email` claim，但该用户的 ID Token 没有它。LDAP/AD 属性映射、用户资料是否填写，以及请求的 scope/client scope 都可能影响最终 Token；不要仅凭管理界面能看到邮箱就推断它一定进入了 ID Token。

### 修复

**方案 1：确保用户有邮箱**

在 Keycloak 中：Users → 目标用户 → Attributes → 添加 `email` 属性；或用 User Federation mapper 从 LDAP/AD 映射 `mail` → `email`。

**方案 2：不要用伪造邮箱绕过身份校验**

不要把 `--insecure-oidc-allow-unverified-email=true`、`--email-domain=*` 或硬编码的 `@placeholder.local` 地址当作生产修复：它们可能扩大可登录范围，且不能补出缺失的用户身份属性。

**方案 3（推荐）：修正真实身份属性的来源**

确认 LDAP/AD 的 `mail` 属性已映射到 Keycloak 的 `email`，用户资料中的邮箱已填写并按组织规则验证；确认客户端请求了需要的 scope，并用新签发的 ID Token 检查 claim。若业务确实不把邮箱作为身份标识，应按当前 oauth2-proxy 版本的 Provider 配置选择稳定的用户标识，而不是伪造邮箱；改动前先在测试 Realm 验证登录、域名限制和审计字段。

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

如果 `/ping` 返回 200 但受保护请求仍然失败，继续检查 `auth-url` 是否指向集群内可达的 `/oauth2/auth`，以及 `auth-signin` 是否使用了入口收到的原始请求 URI。ingress-nginx 官方外部认证示例把两者分成两个职责：`auth-url` 做认证判定，`auth-signin` 负责 401 后跳转；不要把登录回调地址误填成后端业务地址。

```yaml
nginx.ingress.kubernetes.io/auth-url: "https://$host/oauth2/auth"
nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
```

依据：[ingress-nginx External OAUTH Authentication](https://kubernetes.github.io/ingress-nginx/examples/auth/oauth-external-auth/)。

---

## 11. Cookie 跨子域不生效

**现象**：`app1.example.com` 登录成功，访问 `app2.example.com` 需要重新登录。

**先纠正一个容易误导排错的判断**：现代浏览器按照 RFC 6265 处理 `Domain=example.com` 和 `Domain=.example.com` 时，会忽略前导点号；两者都允许 Cookie 发送到 `example.com` 及其子域。真正的区别是：省略 `Domain` 属性时，Cookie 才是只对当前主机生效的 host-only Cookie。oauth2-proxy 的 `--cookie-domain` 应填写共享父域，但不应把“必须加点号”当成修复条件。

### 修复

```yaml
# ✅ 跨子域共享：显式设置共享父域；前导点号可省略
- --cookie-domain=example.com

# ✅ 只保护单个主机：省略 --cookie-domain，使用 host-only Cookie
# 不要为了“跨子域”写成不相关的父域，例如 .example.net
```

还要同时检查以下边界：

- 所有应用确实属于同一个注册域；`app1.example.com` 与 `app2.example.org` 不能通过 Cookie Domain 共享。
- Cookie 的 `Path`、`Secure`、`SameSite` 和名称没有被入口代理或另一套 oauth2-proxy 配置覆盖。
- `--cookie-domain` 不能扩大到不受你控制的父域；共享 Cookie 会扩大会话泄露和登出影响范围。单个应用不需要 SSO 时，优先省略该参数。

**验证**：

```bash
# 浏览器 DevTools → Application → Cookies → 查看 _oauth2_proxy Cookie
# 跨子域场景应看到 Domain=example.com（浏览器可能以不同 UI 形式显示）
# 同时确认 Path、Secure、SameSite 与部署拓扑一致
```

规范依据：[RFC 6265 §4.1.2.3 Domain 属性](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2.3)；oauth2-proxy 参数说明见[官方配置文档](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)。

### 不要把 `__Host-` Cookie 前缀和跨子域共享混用

oauth2-proxy 官方配置文档建议在启用 `--cookie-secure` 时考虑使用 `__Host-` 或 `__Secure-` 前缀，但两者的边界不同：`__Host-` Cookie 必须带 `Secure`、`Path=/`，并且**不能设置 `Domain`**。因此它只能绑定当前主机，不能与 `--cookie-domain=example.com` 组合实现跨子域 SSO；跨子域场景应使用符合部署边界的普通名称或 `__Secure-` 名称，并保留 `Secure`。浏览器会拒绝不满足前缀约束的 `Set-Cookie`，表现仍可能只是“登录成功后 Cookie 不见了”。

```yaml
# 单主机部署：host-only Cookie，可考虑 __Host- 前缀
- --cookie-name=__Host-oauth2_proxy
- --cookie-secure=true
- --cookie-path=/
# 不要同时设置 --cookie-domain

# 跨子域 SSO：不能使用 __Host-；显式设置共享父域
- --cookie-name=__Secure-oauth2_proxy
- --cookie-domain=example.com
- --cookie-secure=true
```

验证时不要只看 Cookie 是否出现，还要检查 DevTools 中的 `Domain`、`Path`、`Secure` 和名称前缀。`__Host-` 约束见 [MDN Cookie prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes)；oauth2-proxy 的名称与 Cookie 参数见[官方配置文档](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)。

如果两个应用不应该共享登录会话，不要为了减少一次登录而扩大 Cookie Domain；分别使用主机专属 Domain 和不同的 `--cookie-name`。共享父域还会扩大 Cookie 的发送范围，子域被接管或存在不可信应用时，风险边界也会一起扩大。

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
- [oauth2-proxy 配置总览（Session Store、Cookie 与 Header 参数）](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/)
- [oauth2-proxy 配置总览：CSRF Cookie 并发与大小限制](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/#cookie-options)——`cookie-csrf-per-request` 与 `cookie-csrf-per-request-limit` 的行为
- [oauth2-proxy GitHub Issues](https://github.com/oauth2-proxy/oauth2-proxy/issues)
- [MDN：Set-Cookie 的 Domain 属性](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#domaindomain-value)

---

## IAM FAQ

### oauth2-proxy 和 Nginx Ingress auth-url 是什么关系？

oauth2-proxy 是认证决策点。Nginx Ingress 用 `auth-url` 注解把每个外部请求发给 oauth2-proxy 做认证判定。oauth2-proxy 返回 202 → Ingress 放行；返回 401 → Ingress 把用户重定向到 Keycloak 登录。这种模式叫**外部认证（external auth）**，oauth2-proxy 不代理流量，只做判定。

### oauth2-proxy 和 Keycloak 的 IAM 职责怎么划分？

Keycloak 是 IAM 的身份提供者（IDP）：管理用户、组、角色、密码策略、MFA、身份联邦。oauth2-proxy 是策略执行点（PEP）：在流量入口拦住未认证请求，发起 OIDC 登录，向后端透传认证结果。两者配合形成完整的 IAM 认证链路——Keycloak 管「你是谁」，oauth2-proxy 管「你能不能进这个应用」。

### 多副本 oauth2-proxy 一定要 Redis 吗？

不一定。默认 Cookie store 是无状态的，多副本共享同一个 `--cookie-secret` 即可读取会话；Redis 主要用于减小 Cookie、集中撤销会话或把状态放到服务端。启用 Redis 后，Redis 也成为 IAM 网关的运行依赖，需要配置认证、TLS、监控和备份。
