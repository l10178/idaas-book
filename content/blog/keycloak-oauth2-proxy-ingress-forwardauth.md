---
title: "Keycloak + oauth2-proxy 保护内部应用：Ingress 与 ForwardAuth 配置清单"
description: "使用 Keycloak 与 oauth2-proxy 通过 NGINX Ingress 及 Traefik ForwardAuth 为内部应用添加 OIDC 认证的完整配置与排错指南"
summary: "一份面向内部应用的 Keycloak + oauth2-proxy 网关层 SSO 配置清单，覆盖 NGINX Ingress、Traefik ForwardAuth、常见报错和回滚。"
date: 2026-07-04T00:00:00+08:00
lastmod: 2026-07-04T00:00:00+08:00
draft: false
weight: 10
images: []
categories: ["Keycloak", "OAuth2 Proxy"]
tags: ["Keycloak", "oauth2-proxy", "OIDC", "ingress-nginx", "Traefik", "ForwardAuth", "SSO"]
contributors: []
pinned: false
homepage: false
seo:
  title: "Keycloak + oauth2-proxy 配置：Ingress / Traefik ForwardAuth 内部应用 SSO"
  description: "Keycloak 与 oauth2-proxy 对接教程：OIDC issuer URL、audience mapper、groups claim、X-Auth-Request 头、cookie/CSRF redirect loop、NGINX Ingress auth-url 与 Traefik ForwardAuth 排错。"
  canonical: ""
  noindex: false
---

很多内部应用没有原生 OIDC 登录，或者不值得为了一个后台页面改业务代码。更稳的做法是在入口层放一个 `oauth2-proxy`：浏览器先到 Keycloak 登录，`oauth2-proxy` 建立会话，再由 NGINX Ingress `auth_request` 或 Traefik `ForwardAuth` 决定是否放行。

这不是万能身份中台方案。它适合保护只需要「登录后可访问」或按组粗粒度授权的 Web 应用；如果后端需要细粒度 API 权限、租户隔离或可审计的业务授权，仍应在应用内实现 OIDC/JWT 校验和授权逻辑。网关层认证只能挡门，不能替应用做业务决策。保安不是产品经理，虽然有时都很想拦需求。

## 适用与不适用场景

| 场景 | 建议 |
|---|---|
| 内部控制台、只给员工访问的管理页面 | 适合。用 oauth2-proxy 统一接 Keycloak，按邮箱域、groups 或 roles 放行。 |
| 多个同域名子路径应用共用登录 | 适合，但要统一 `cookie-domain`、`redirect-url` 和入口路径。 |
| 后端只需要用户邮箱/用户名/组信息 | 可用 `X-Auth-Request-*` 头透传，但入口代理必须覆盖同名请求头，避免客户端伪造。 |
| API 需要资源级权限、租户级权限、审计责任链 | 不适合只靠网关认证。后端应验证 access token，并做授权判断。 |
| 原生支持 OIDC 的 Grafana、GitLab、Vault 等 | 优先用原生 OIDC；oauth2-proxy 更适合不支持 OIDC 的应用。 |

## 最小架构

```text
Browser
  -> https://app.example.test
  -> NGINX Ingress auth-url / Traefik ForwardAuth
  -> oauth2-proxy
  -> Keycloak realm: internal
  -> upstream app
```

三个 URL 必须先定死：

| 名称 | 示例 | 用途 |
|---|---|---|
| Keycloak issuer | `https://sso.example.test/realms/internal` | oauth2-proxy 发现 OIDC 端点。Keycloak 17+ 新部署默认不带 `/auth`。 |
| 应用入口 | `https://app.example.test` | 用户访问的外部地址，也是 cookie 生效域。 |
| oauth2-proxy 回调 | `https://app.example.test/oauth2/callback` | Keycloak Client 的合法 Redirect URI。 |

上线前先访问：

```bash
curl -fsS https://sso.example.test/realms/internal/.well-known/openid-configuration \
  | jq -r '.issuer,.authorization_endpoint,.token_endpoint,.jwks_uri'
```

返回的 `issuer` 必须和 `--oidc-issuer-url` 完全一致。差一个 `/auth`、协议或 host，后面就是 302 套娃现场。

## Keycloak 端配置

在目标 Realm 中创建一个 OpenID Connect Client：

| 配置项 | 建议值 |
|---|---|
| Client ID | `oauth2-proxy` |
| Client authentication | 开启，使用 confidential client |
| Standard flow | 开启 |
| Direct access grants | 关闭，除非有明确脚本登录需求 |
| Valid redirect URIs | `https://app.example.test/oauth2/callback` |
| Web origins | `https://app.example.test` 或按实际域名配置 |

然后补两个 mapper：

1. **Audience mapper**：把 `Included Client Audience` 设置为 `oauth2-proxy`。否则 oauth2-proxy 校验 access token 时常见 `expected audience` / `invalid aud`，日志里可能只看到 `account`。
2. **Group Membership mapper**：把组写入 `groups` claim。若只按 realm role 控制，也可以用 oauth2-proxy 的 Keycloak OIDC provider role 选项，但 groups 更容易给 Ingress/后端统一消费。

生产环境建议单独建 Client，不要复用业务系统 Client。Client Secret 按密钥管理系统下发，轮换时先让 oauth2-proxy 支持新 Secret，再撤旧 Secret；别在发布窗口玩盲盒。

## oauth2-proxy 最小配置

用环境变量承载密钥，配置文件只保留可审计的非敏感项：

```ini
# oauth2-proxy.cfg
provider = "keycloak-oidc"
oidc_issuer_url = "https://sso.example.test/realms/internal"
client_id = "oauth2-proxy"
redirect_url = "https://app.example.test/oauth2/callback"
email_domains = ["*"]
code_challenge_method = "S256"

cookie_secure = true
cookie_samesite = "lax"
cookie_domains = [".example.test"]
whitelist_domains = [".example.test"]

set_xauthrequest = true
set_authorization_header = true
pass_access_token = true
reverse_proxy = true
```

对应 Secret：

```bash
export OAUTH2_PROXY_CLIENT_SECRET='<keycloak-client-secret>'
export OAUTH2_PROXY_COOKIE_SECRET='<32-byte-base64-or-hex-secret>'
oauth2-proxy --config=/etc/oauth2-proxy/oauth2-proxy.cfg
```

注意：

- `cookie_secret` 要足够长且稳定。Pod 重启就换 secret，会把所有会话打掉；发布没问题，用户会骂。
- `set_xauthrequest=true` 会让 `/oauth2/auth` 响应带 `X-Auth-Request-User`、`X-Auth-Request-Email`、`X-Auth-Request-Groups` 等头，适合 NGINX `auth_request` 模式。
- `pass_access_token=true` 会把 access token 放到响应头，只有后端确实需要 token 时才开，并限制入口到后端的可信网络边界。

## NGINX Ingress 配置

同一个 host 通常需要两个 Ingress：一个暴露 oauth2-proxy 的 `/oauth2` 路径，一个保护业务应用。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: oauth2-proxy
  namespace: platform
spec:
  ingressClassName: nginx
  rules:
  - host: app.example.test
    http:
      paths:
      - path: /oauth2
        pathType: Prefix
        backend:
          service:
            name: oauth2-proxy
            port:
              number: 4180
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: internal-app
  namespace: app
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "https://$host/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
    nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email,X-Auth-Request-Groups,Authorization"
spec:
  ingressClassName: nginx
  rules:
  - host: app.example.test
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: internal-app
            port:
              number: 80
```

如果要让后端读取用户信息，只信任 Ingress 注入的头；应用直连入口要禁掉，或者在后端清理来自外部请求的同名 header。

## Traefik ForwardAuth 配置

Traefik 的思路相同：ForwardAuth middleware 先问 oauth2-proxy，允许后再转发到后端。

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: oauth2-forwardauth
  namespace: app
spec:
  forwardAuth:
    address: "http://oauth2-proxy.platform.svc.cluster.local:4180/oauth2/auth"
    trustForwardHeader: true
    authResponseHeaders:
      - X-Auth-Request-User
      - X-Auth-Request-Email
      - X-Auth-Request-Groups
      - Authorization
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: internal-app
  namespace: app
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: app-oauth2-forwardauth@kubernetescrd
spec:
  ingressClassName: traefik
  rules:
  - host: app.example.test
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: internal-app
            port:
              number: 80
```

还需要把 `/oauth2` 路径路由到 oauth2-proxy，否则登录开始和回调没有入口。Traefik 场景下更容易遗漏这条路由，症状通常是 `/oauth2/start` 404 或登录后回不到应用。

## 验证命令

按这个顺序查，能少走很多弯路：

```bash
# 1. OIDC discovery 是否可访问，issuer 是否匹配
curl -fsS https://sso.example.test/realms/internal/.well-known/openid-configuration | jq -r '.issuer'

# 2. oauth2-proxy 是否健康
kubectl -n platform logs deploy/oauth2-proxy --tail=100
kubectl -n platform port-forward svc/oauth2-proxy 4180:4180
curl -i http://127.0.0.1:4180/oauth2/auth

# 3. 外部入口是否能跳到 Keycloak
curl -kI https://app.example.test/ | sed -n '1,12p'

# 4. 登录后检查 cookie 与回调
# 浏览器开发者工具查看 /oauth2/callback 是否 Set-Cookie，Domain/SameSite/Secure 是否符合预期。

# 5. 后端是否收到认证头
kubectl -n app logs deploy/internal-app --tail=100
```

access token 的 `aud` 可以在测试环境临时解码确认：

```bash
TOKEN='<access-token>'
printf '%s' "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.aud,.groups'
```

不要把生产 token 粘进在线解码网站。这个建议朴素，但能保平安。

## 常见错误症状表

| 症状 / 日志 | 常见根因 | 修正方式 |
|---|---|---|
| `expected audience` / `invalid aud`，`aud` 里只有 `account` | Keycloak access token 没包含 oauth2-proxy 这个 audience | 在 Keycloak Client 增加 Audience mapper；或在 oauth2-proxy 配置额外允许的 audience。优先修 token，不要长期放宽校验。 |
| 登录成功后反复跳转 | `redirect_url`、Ingress `auth-signin`、cookie domain 或 SameSite 与真实入口不一致 | 固定 `redirect_url=https://app.example.test/oauth2/callback`；跨子域再设置 `.example.test` cookie domain；检查外部 HTTPS 入口。 |
| `csrf cookie not found` | 回调域名和发起登录域名不一致，或 cookie 被浏览器拒收 | 统一 host；启用 HTTPS；检查 `cookie_secure`、`cookie_samesite`、`cookie_domains`。 |
| `/oauth2/auth` 一直 401 | 浏览器没有带 oauth2-proxy session cookie，或请求没有走同一个 host | 先确认 `/oauth2/callback` 是否成功 Set-Cookie，再查 Ingress/Traefik 路由是否共用同一 host。 |
| 后端拿不到用户/邮箱/组 | oauth2-proxy 没开 `set_xauthrequest`，或 Ingress/ForwardAuth 没透传响应头 | 开启 `set_xauthrequest=true`；NGINX 设置 `auth-response-headers`；Traefik 设置 `authResponseHeaders`。 |
| Keycloak 回调 URL 变成 `http://` | 反向代理没有正确设置或覆盖 `X-Forwarded-*` / `Forwarded` 头 | Keycloak 生产部署配置 hostname/proxy headers；入口代理必须覆盖来自客户端的转发头。 |
| Keycloak 17+ issuer 不匹配 | 沿用旧 WildFly `/auth/realms/<realm>` 路径 | 新部署使用 `/realms/<realm>`；只有旧版本或明确保留兼容路径时才使用 `/auth/realms/<realm>`。 |
| Traefik 登录入口 404 | 只配置了 ForwardAuth，没把 `/oauth2` 路径路由到 oauth2-proxy | 给 `app.example.test/oauth2/*` 增加到 oauth2-proxy 的 Router/Ingress。 |

## 生产检查清单

- [ ] Keycloak issuer、oauth2-proxy `oidc_issuer_url`、`.well-known` 返回值完全一致。
- [ ] Client Redirect URI 精确到 `/oauth2/callback`，没有无约束通配。
- [ ] access token 的 `aud` 包含 oauth2-proxy Client ID。
- [ ] groups/roles claim 命名和 oauth2-proxy 配置一致。
- [ ] cookie secret 稳定保存，不随 Pod 重建变化。
- [ ] 所有外部入口使用 HTTPS，Cookie `Secure` 生效。
- [ ] 后端只信任来自入口代理的 `X-Auth-Request-*` 头，禁止绕过 Ingress/Traefik 直连。
- [ ] 日志里不打印 access token、ID token、client secret。
- [ ] 有一键回滚方式：移除认证中间件/注解，而不是删除 Keycloak Client。

## 回滚方式

NGINX Ingress 回滚最小动作：删除业务 Ingress 上的三条认证注解，保留 oauth2-proxy Deployment、Service 和 Keycloak Client，方便事后复盘。

```bash
kubectl -n app annotate ingress internal-app \
  nginx.ingress.kubernetes.io/auth-url- \
  nginx.ingress.kubernetes.io/auth-signin- \
  nginx.ingress.kubernetes.io/auth-response-headers-
```

Traefik 回滚最小动作：移除业务 Ingress/IngressRoute 上的 ForwardAuth middleware 引用，保留 oauth2-proxy 路由。

```bash
kubectl -n app annotate ingress internal-app \
  traefik.ingress.kubernetes.io/router.middlewares-
```

回滚后先确认业务恢复，再排查 audience、cookie、转发头。事故中最怕一边修配置一边删资源，最后连案发现场都没了。

## 相关章节

- [Keycloak 与第三方开源软件集成]({{< relref "docs/keycloak/integrations/" >}})
- [Keycloak 常见问题排查]({{< relref "docs/keycloak/troubleshooting/" >}})
- [Keycloak Kubernetes 生产部署]({{< relref "docs/implementation/kubernetes-production.md" >}})

## 参考资料

- oauth2-proxy Keycloak OIDC provider 文档：<https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc/>
- oauth2-proxy 配置总览：<https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/>
- ingress-nginx External OAUTH Authentication 示例：<https://kubernetes.github.io/ingress-nginx/examples/auth/oauth-external-auth/>
- Traefik ForwardAuth middleware 文档：<https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/>
- Keycloak hostname/proxy headers 文档：<https://www.keycloak.org/server/hostname>
- Keycloak OIDC endpoints 文档：<https://www.keycloak.org/securing-apps/oidc-layers>
