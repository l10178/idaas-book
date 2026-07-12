---
title: "Keycloak + oauth2-proxy 集成实战指南 | IDaaS Book"
description: "Keycloak 搭配 oauth2-proxy 保护 Web 应用的完整配置指南，覆盖 audience 映射、Cookie 域配置、Nginx Ingress auth-url 与排错"
date: 2026-07-08T00:00:00+08:00
lastmod: 2026-07-08T00:00:00+08:00
draft: false
weight: 1
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-oauth2-proxy"
toc: true
---

## 场景

你有一组内部 Web 应用（Grafana、Kibana、自研管理后台等），它们本身没有认证逻辑。你想用 Keycloak 做统一身份认证，用 oauth2-proxy 做反向代理层拦截所有未认证请求，在 Kubernetes 集群里通过 Nginx Ingress 暴露。

一句话：**Keycloak 负责「你是谁」，oauth2-proxy 负责「你能不能进这个应用」**。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 内部工具统一认证（Grafana、Prometheus、Kibana） | 需要细粒度授权的对外 API（用 BFF 或 API 网关） |
| 快速给老旧应用加 OIDC 登录 | SPA 直连 Keycloak（不需要代理层） |
| K8s Ingress 统一认证入口 | 需要 Keycloak Adapter 老项目的迁移目标（直接用标准 OIDC 库，参考 [迁移指南]({{< relref "keycloak-adapter-migration" >}})） |
| 多个应用共享同一个 oauth2-proxy 实例 | 移动端 Native App（应该用系统浏览器 + PKCE） |

## 架构

```mermaid
sequenceDiagram
    participant Browser as 浏览器
    participant Ingress as Nginx Ingress
    participant Proxy as oauth2-proxy
    participant App as 后端应用
    participant KC as Keycloak

    Browser->>Ingress: GET /app
    Ingress->>Proxy: auth-url /oauth2/auth
    Proxy-->>Ingress: 401 (未认证)
    Ingress->>Browser: 302 → Keycloak 登录页
    Browser->>KC: 登录
    KC-->>Browser: 302 → /oauth2/callback
    Browser->>Proxy: GET /oauth2/callback?code=...
    Proxy->>KC: Token 交换 (code → tokens)
    KC-->>Proxy: id_token + access_token + refresh_token
    Proxy-->>Browser: Set-Cookie (_oauth2_proxy) + 302 → /app
    Browser->>Ingress: GET /app (带 Cookie)
    Ingress->>Proxy: auth-url (带 Cookie)
    Proxy-->>Ingress: 202 (已认证)
    Ingress->>App: 代理请求 + X-Auth-Request-* Headers
    App-->>Browser: 200 OK
```

流程要点：
1. Nginx Ingress 用 `auth-url` 注解把认证委托给 oauth2-proxy
2. oauth2-proxy 发现没有有效 Cookie，返回 401，Ingress 把用户重定向到 Keycloak
3. 用户在 Keycloak 完成登录，回调到 oauth2-proxy
4. oauth2-proxy 用授权码换 Token，设置加密 Cookie，写回浏览器
5. 后续请求带 Cookie，oauth2-proxy 验证通过，Ingress 放行

## Keycloak 端配置

### 1. 创建客户端

在目标 Realm 下创建 OpenID Connect 客户端：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| Client ID | `oauth2-proxy` | 客户端标识 |
| Client type | `confidential` | 机密客户端（有密钥） |
| Valid Redirect URIs | `https://<你的域名>/oauth2/callback` | oauth2-proxy 回调地址 |
| Web Origins | `https://<你的域名>` | 允许的 CORS 来源 |
| Client Authentication | `On` | 启用客户端认证 |
| Standard Flow | `Enabled` | 标准授权码流程（oauth2-proxy 默认使用） |

### 2. 配置 Audience Mapper（最容易遗漏）

oauth2-proxy v7.4+ 默认验证 ID Token 的 `aud` 字段。Keycloak 默认不把 client ID 写入 audience，导致 `expected audience` 错误。

**Protocol Mapper 配置：**

| 配置项 | 值 |
|--------|-----|
| Mapper Type | `Audience` |
| Name | `aud-oauth2-proxy` |
| Included Client Audience | `oauth2-proxy` |
| Add to ID token | `ON` |
| Add to access token | `ON` |

配置后 Keycloak 签发的 ID Token payload 会包含：
```json
{
  "aud": ["account", "oauth2-proxy"],
  ...
}
```

## oauth2-proxy 端配置

### Kubernetes Deployment

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oauth2-proxy-secret
  namespace: auth
type: Opaque
stringData:
  client-id: "oauth2-proxy"
  client-secret: "<从 Keycloak 客户端 Credentials 复制>"
  cookie-secret: "<openssl rand -base64 32 生成>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oauth2-proxy
  namespace: auth
spec:
  replicas: 2
  selector:
    matchLabels:
      app: oauth2-proxy
  template:
    metadata:
      labels:
        app: oauth2-proxy
    spec:
      containers:
      - name: oauth2-proxy
        image: quay.io/oauth2-proxy/oauth2-proxy:v7.8.2
        args:
        - --provider=keycloak-oidc
        - --oidc-issuer-url=https://keycloak.example.com/realms/myrealm
        - --client-id=$(OAUTH2_PROXY_CLIENT_ID)
        - --client-secret=$(OAUTH2_PROXY_CLIENT_SECRET)
        - --cookie-secret=$(OAUTH2_PROXY_COOKIE_SECRET)
        - --cookie-secure=true
        - --cookie-samesite=lax
        - --cookie-domain=.example.com
        - --cookie-refresh=1h
        - --cookie-expire=24h
        - --upstream=static://202
        - --http-address=0.0.0.0:4180
        - --reverse-proxy=true
        - --set-xauthrequest=true
        - --set-authorization-header=true
        - --pass-access-token=true
        - --pass-authorization-header=true
        - --email-domain=*
        - --scope=openid email profile
        env:
        - name: OAUTH2_PROXY_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: oauth2-proxy-secret
              key: client-id
        - name: OAUTH2_PROXY_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: oauth2-proxy-secret
              key: client-secret
        - name: OAUTH2_PROXY_COOKIE_SECRET
          valueFrom:
            secretKeyRef:
              name: oauth2-proxy-secret
              key: cookie-secret
        ports:
        - containerPort: 4180
          name: http
        livenessProbe:
          httpGet:
            path: /ping
            port: 4180
        readinessProbe:
          httpGet:
            path: /ping
            port: 4180
---
apiVersion: v1
kind: Service
metadata:
  name: oauth2-proxy
  namespace: auth
spec:
  selector:
    app: oauth2-proxy
  ports:
  - port: 4180
    targetPort: 4180
```

### 关键参数说明

| 参数 | 值 | 为什么 |
|------|-----|--------|
| `--provider=keycloak-oidc` | v7.3+ 专用 Provider | 设置正确的 OIDC discovery URL（自动拼接 `/realms/xxx`），默认 scope `openid email profile` |
| `--oidc-issuer-url` | `https://<keycloak>/realms/<realm>` | 必须以 realm 路径结尾，不含尾部斜杠 |
| `--cookie-domain` | `.example.com` | 主域名前加点号，使子域名也能共用 Cookie。单域名不加点号 |
| `--cookie-secure` | `true` | 生产环境必须开启，只通过 HTTPS 传输 Cookie |
| `--cookie-samesite` | `lax` | 允许从外部链接跳转时携带 Cookie（`strict` 会拦截来自 Keycloak 的回调） |
| `--upstream=static://202` | 固定 202 响应 | auth-url 模式：oauth2-proxy 仅做认证判定，不代理到后端 |
| `--reverse-proxy` | `true` | 信任反向代理传入的 `X-Forwarded-*` 头 |
| `--set-xauthrequest` | `true` | 向后端传递 `X-Auth-Request-User`、`X-Auth-Request-Email`、`X-Auth-Request-Groups` 等头 |
| `--pass-access-token` | `true` | 将 Access Token 传给后端（Header: `X-Auth-Request-Access-Token`） |
| `--email-domain` | `*` | 允许所有邮箱域。如需限定，改为 `example.com` 或 `--authenticated-emails-file` |

## Nginx Ingress 配置

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  namespace: default
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "http://oauth2-proxy.auth.svc.cluster.local:4180/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
    nginx.ingress.kubernetes.io/auth-response-headers: "X-Auth-Request-User,X-Auth-Request-Email,X-Auth-Request-Groups,X-Auth-Request-Access-Token"
    # 允许 oauth2-proxy 回调路径绕过认证
    nginx.ingress.kubernetes.io/auth-snippet: |
      if ($request_uri ~* "^/oauth2/") {
        # oauth2-proxy 自身的回调路径不走 auth-url
      }
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - myapp.example.com
    secretName: myapp-tls
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app
            port:
              number: 80
```

> **注意**：`auth-signin` 使用 `$host` 变量，确保重定向到当前访问的域名。oauth2-proxy 的 Service 必须和 Ingress 在同一个集群内可达。

## Traefik ForwardAuth 配置

如果用 Traefik 替代 Nginx Ingress，使用 `ForwardAuth` 中间件。完整配置、排错和对比见专用指南：

👉 **[Traefik ForwardAuth + Keycloak + oauth2-proxy 完整配置与排错指南]({{< relref "traefik-forwardauth-keycloak" >}})**

以下为快速参考配置：

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: oauth2-proxy-auth
  namespace: auth
spec:
  forwardAuth:
    address: http://oauth2-proxy.auth.svc.cluster.local:4180/oauth2/auth
    trustForwardHeader: true
    authResponseHeaders:
    - X-Auth-Request-User
    - X-Auth-Request-Email
    - X-Auth-Request-Groups
    - X-Auth-Request-Access-Token
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: my-app-route
spec:
  entryPoints:
  - websecure
  routes:
  - match: Host(`myapp.example.com`)
    kind: Rule
    middlewares:
    - name: oauth2-proxy-auth
      namespace: auth
    services:
    - name: my-app
      port: 80
```

Traefik 的 ForwardAuth 行为与 Nginx Ingress auth-url 类似：返回 2xx 放行，返回 401 触发重定向。

## 验证

部署完成后按以下顺序验证：

```bash
# 1. 确认 oauth2-proxy 健康
curl -sS http://oauth2-proxy.auth.svc.cluster.local:4180/ping
# 预期：OK

# 2. 确认 Keycloak OIDC Discovery 可访问
curl -sS https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration | jq .issuer
# 预期："https://keycloak.example.com/realms/myrealm"

# 3. 确认未经认证请求被拦截（返回 302 重定向到 Keycloak 登录）
curl -sS -o /dev/null -w "%{http_code}" https://myapp.example.com/
# 预期：302

# 4. 端到端测试：浏览器打开 https://myapp.example.com/
# 预期：跳转到 Keycloak 登录页 → 登录 → 跳回应用

# 5. 确认后端能读到认证信息
# 在应用中打印 HTTP Headers，预期见到：
# X-Auth-Request-User: <username>
# X-Auth-Request-Email: <user@example.com>
# X-Auth-Request-Access-Token: eyJ...
```

## 常见错误排错表

> **完整版速查**：这里列出了最常见错误。12 个高频错误的完整诊断命令、根因分析和修复步骤见 **[oauth2-proxy 常见错误排错速查表]({{< relref "oauth2-proxy-common-errors" >}})**。

| 错误现象 | 根本原因 | 解决方案 |
|----------|----------|----------|
| `expected audience "oauth2-proxy" got ["account"]` | Keycloak 未配置 Audience Mapper | 在客户端上添加 Audience mapper，勾选 "Add to ID token" |
| 登录后无限重定向循环 | Cookie Domain 不匹配 / SameSite 过严 | 检查 `--cookie-domain` 是否正确，`--cookie-samesite` 是否为 `lax`。详细排查见 [Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}}) |
| `csrf cookie not found` | Cookie 被浏览器拦截（SameSite/跨域） | 部署在相同主域名下；`--cookie-samesite=lax`；确保 HTTPS |
| 登录后返回 403 | `--email-domain` 过滤掉了用户 | 临时设置 `--email-domain=*` 验证，确认后再精确配置 |
| `invalid_token` / `token contains an invalid number of segments` | ID Token 格式异常或 JWT 校验失败 | 检查 `--oidc-issuer-url` 是否正确，Keycloak Realm 名是否对 |
| Nginx Ingress 返回 503 | oauth2-proxy Service 不可达 | 确认 Service 在 `auth` namespace 下，ClusterIP 可解析 |
| Cookie 在子域名不生效 | `--cookie-domain` 未加点号前缀 | `.example.com`（带点号）= 所有子域共用；`example.com` = 仅该域名 |
| 登出后其他应用也退出 | Cookie Domain 跨应用共享 | 不同应用用不同的 oauth2-proxy 实例，或不同 Cookie Name |

### 诊断命令速查

```bash
# 查看 oauth2-proxy 日志
kubectl logs -n auth deploy/oauth2-proxy --tail=50

# 查看 Ingress Controller 日志（确认 auth-url 调用）
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller --tail=50 | grep auth

# 手动测试 auth-url 端点（带 cookie）
# 1. 先通过浏览器完成一次登录
# 2. 从浏览器 DevTools → Application → Cookies 复制 _oauth2_proxy 的值
# 3. 在终端重复请求
curl -v -H "Cookie: _oauth2_proxy=<复制值>" \
  http://oauth2-proxy.auth.svc.cluster.local:4180/oauth2/auth
# 预期 HTTP 202（已认证）

# 检查 Keycloak 签发的 ID Token（用 jwt.io 或命令行解码）
# 在浏览器 DevTools → Network → /oauth2/callback → Response Headers 中找到
# 或从 oauth2-proxy 日志中获取
```

## 多条应用共享一个 oauth2-proxy

如果多个应用使用同一个 Keycloak Client 和 oauth2-proxy 实例（例如 `grafana.example.com`、`kibana.example.com` 都在 `.example.com` 下）：

**适用条件**：
- 所有应用部署在同一主域名下（Cookie Domain 覆盖）
- 使用同一个 Keycloak Realm 和 Client
- 不需要按应用区分用户组/角色（如果后端需要区分，用 `--set-xauthrequest` 传 `X-Auth-Request-Groups`，由后端自行判断）

**配置要点**：
- `--cookie-domain=.example.com`（注意前面的点号）
- 每个应用的 Ingress 都配相同的 `auth-url` 和 `auth-signin`
- 用一个共享的 cookie-secret

**不适用**：
- 不同域名（a.com + b.com）：Cookie 不能跨域，需要各自独立的 oauth2-proxy 实例
- 不同用户组：如果 A 应用只允许 `admin` 组、B 应用只允许 `viewer` 组，要么用不同 Client + oauth2-proxy 实例，要么用 `--allowed-group` 结合 Nginx Ingress `configuration-snippet` 做分流

## 生产环境注意事项

1. **Cookie Secret 轮换**：cookie-secret 用于加密 Cookie，泄露后攻击者可伪造认证 Cookie。定期轮换需同步更新部署（旧 secret 签发的 Cookie 会失效，用户需重新登录）。
2. **副本数**：至少 2 副本，配合 PodDisruptionBudget 保证高可用。
3. **资源限制**：oauth2-proxy 是 Go 程序，内存开销很小（通常 < 50MB），CPU 取决于 QPS（中等流量下 < 100m）。
4. **Redis Session Store**：如果 oauth2-proxy 副本 >1，推荐配置 `--session-store-type=redis` + `--redis-connection-url=redis://...`，避免 Cookie 状态在副本间不一致（不配 Redis 也可正常工作，因为 oauth2-proxy 只用加密 Cookie 存储状态，无服务端 session）。
5. **TLS**：生产环境 Keycloak 和 Ingress 端到端 TLS 必须开启。oauth2-proxy 本身不要求外部 TLS（被反向代理包裹）。
6. **监控**：oauth2-proxy 暴露 `/metrics` 端点（Prometheus 格式），包含认证请求总数、延迟、错误计数。

## 回滚方式

如果新配置导致认证失败，快速回滚步骤：

```bash
# 1. 回滚 oauth2-proxy Deployment 到上一个版本
kubectl rollout undo deployment/oauth2-proxy -n auth

# 2. 回滚 Ingress 注解（如果改过 auth-url 等）
# 还原 Ingress YAML 后重新 apply

# 3. 验证服务恢复
curl -sS -o /dev/null -w "%{http_code}" https://myapp.example.com/
```

如果问题是 Keycloak 客户端配置导致的（比如误改了 Audience Mapper），需在 Keycloak Admin Console 中手动还原配置。Keycloak 客户端配置不受 Kubernetes rollout 影响，建议在改动前导出客户端 JSON 备份：

```bash
# Keycloak Admin CLI 导出客户端配置（需要 admin token）
kcadm.sh get clients/<client-id> -r <realm> > client-backup.json
```

---

## 延伸阅读

- [OAuth 2.0 深度解读 — 授权码流程与 PKCE]({{< relref "docs/protocols/oauth2-authorization-code-pkce" >}})：理解 oauth2-proxy 底层的 OAuth 2.0 授权码 + PKCE 流程
- [JWT 深入解读]({{< relref "docs/protocols/jwt-deep-dive" >}})：oauth2-proxy 验证的 ID Token 本质就是 JWT——理解其结构、签名和声明验证逻辑
- [第 18 章：IDaaS 集成模式与实践]({{< relref "docs/implementation/integration-patterns" >}})：网关模式与其他集成模式的对比
- [第 14 章：Keycloak 架构与部署]({{< relref "docs/implementation/keycloak-architecture" >}})：Keycloak 生产部署的完整指南
- [oauth2-proxy 官方文档 — Keycloak OIDC Provider](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc)
- [oauth2-proxy GitHub — auth-url 模式使用方式](https://github.com/oauth2-proxy/oauth2-proxy)
