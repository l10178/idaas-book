---
title: "第18章：IDaaS 集成模式与实践 — 网关、BFF 与 Sidecar 架构模式 | IDaaS Book"
description: "IDaaS 集成模式全景与工程实践指南：深入分析网关模式、BFF 模式、Sidecar 代理模式及 SDK 嵌入式模式的架构设计与技术选型决策"
date: 2024-04-05T00:00:00+08:00
lastmod: 2026-07-06T00:00:00+08:00
draft: false
weight: 45
menu:
  docs:
    parent: "implementation"
    identifier: "integration-patterns"
toc: true
---

## 18.1 集成模式概览

将 IDaaS 集成到应用架构中有多种模式，选择正确的模式取决于应用类型、安全要求和技术栈：

| 模式 | 适用场景 | 复杂度 | 安全性 |
|-----|---------|--------|--------|
| 网关模式 | 传统 Web 应用、API | 低 | 中 |
| BFF 模式 | SPA、移动端 | 中 | 高 |
| Sidecar 模式 | 微服务/服务网格 | 中 | 高 |
| SDK/库模式 | 任何应用 | 低 | 取决于实现 |
| 直接集成 | 自定义应用 | 中 | 取决于实现 |

## 18.2 网关模式

### API 网关认证

在 API 网关层统一处理认证，后端服务不感知身份：

```
客户端 → [API 网关] → [后端服务]
              │
              │ Token 验证
              ▼
        [IDaaS Server]
```

**优点**：
- 后端服务零改动
- 集中管理认证策略
- 网关层统一的限流、日志、监控

**缺点**：
- 网关层成为性能瓶颈
- 细粒度授权在网关层实现困难
- 后端服务不知道"谁"在访问

### Nginx + OAuth2 代理

使用 `oauth2-proxy` 为任何 HTTP 应用添加 OAuth 2.0 保护。完整配置指南、生产排错与回滚方案见 [Keycloak + oauth2-proxy 集成实战指南]({{< relref "docs/solution-blogs/keycloak-oauth2-proxy" >}})，本节给出快速参考。

```
浏览器 → Nginx → oauth2-proxy → 应用
                │
                └── 未认证 → 重定向到 IDaaS
```

```yaml
# docker-compose.yaml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.15.4
    command:
      - --provider=oidc
      - --oidc-issuer-url=https://idp.example.com/realms/myrealm
      - --client-id=my-app
      - --client-secret=xxx
      - --cookie-secret=generate-a-random-secret
      - --upstream=http://my-app:8080
      - --http-address=0.0.0.0:4180
    ports:
      - "4180:4180"
```

### Gateway API + Envoy Gateway 原生 OIDC

入口控制器是 Envoy Gateway 时，网关数据面（Envoy）自带 OAuth2 filter，可以直接在 `SecurityPolicy` 里声明 OIDC，不再需要额外部署 oauth2-proxy：

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: myapp-oidc
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: myapp
  oidc:
    provider:
      issuer: "https://idp.example.com/realms/myrealm"
    clientID: "my-app"
    clientSecret:
      name: "myapp-oidc-secret"   # Secret 的密钥名必须是 client-secret
    redirectURL: "https://app.example.com/myapp/oauth2/callback"
```

取舍与上面的网关模式一致：后端零改动、授权粒度粗。区别是少了独立组件和一跳，代价是要求 confidential client（`clientSecret` 是必填字段），且 `redirectURL` / `logoutPath` 必须落在被保护 HTTPRoute 的 host + path 前缀内。完整模板、字段默认值与升级注意事项见 [Envoy Gateway 原生 OIDC + Keycloak 落地与排错]({{< relref "docs/solution-blogs/envoy-gateway-oidc-keycloak" >}})。

## 18.3 BFF 模式（Backend For Frontend）

BFF 模式是 SPA 和移动应用的推荐模式：

```
┌────────┐     ┌─────────────┐     ┌──────────────┐
│  SPA   │────→│  BFF Server │────→│  后端微服务   │
│ (浏览器)│     │ (机密客户端) │     │              │
└────────┘     └──────┬──────┘     └──────────────┘
  Token   ←→          │ ←→ Access Token
  in                  │ Token 交换
  HttpOnly            │ Session 管理
  Cookie              ▼
                ┌──────────┐
                │  IDaaS   │
                └──────────┘
```

**为什么 BFF 模式更安全**：

SPA 不能安全存储 Token（localStorage 易受 XSS 攻击，浏览器无法保护）。BFF 将 Token 存储在服务端，使用 HttpOnly、Secure、SameSite Cookie 与前端通信。

> 这一模式的规范性要求见 RFC 10017（BCP 212）§6.1：BFF 必须以机密客户端身份运行、Cookie 必须带 `Secure`/`HttpOnly`、必须实现 CSRF 防护。落地时的最小配置、并发刷新导致的 `invalid_grant` 排错与回滚见 [IAM BFF 模式与 SPA Token 安全]({{< relref "../solution-blogs/iam-bff-spa-token-architecture" >}})。

### BFF 的实现

```typescript
// BFF 服务示例 (Node.js + Express)
app.get('/api/proxy/*', async (req, res) => {
  const accessToken = req.session.accessToken;
  
  if (!accessToken || isExpired(accessToken)) {
    const newToken = await refreshAccessToken(req.session.refreshToken);
    req.session.accessToken = newToken.access_token;
    req.session.refreshToken = newToken.refresh_token;
  }
  
  const backendPath = req.path.replace('/api/proxy', '');
  const response = await fetch(`https://backend-api${backendPath}`, {
    headers: { Authorization: `Bearer ${req.session.accessToken}` }
  });
  
  res.json(await response.json());
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  const tokens = await exchangeCode(code, codeVerifier);
  req.session.accessToken = tokens.access_token;
  req.session.refreshToken = tokens.refresh_token;
  res.redirect('/');
});
```

## 18.4 Sidecar 模式（服务网格）

在服务网格（如 Istio）中处理认证：

```
[Pod]
 ┌──────────────────┐
 │  Application     │──→ 业务逻辑（不关心认证）
 │  Container       │
 ├──────────────────┤
 │  Sidecar Proxy   │──→ 拦截所有流量，处理认证
 │  (Envoy)         │
 └──────────────────┘
       │
       ▼
  [Istio Control Plane]
  ├── RequestAuthentication（从 JWT 提取身份）
  └── AuthorizationPolicy（基于身份的授权）
```

```yaml
apiVersion: security.istio.io/v1
kind: RequestAuthentication
metadata:
  name: jwt-auth
spec:
  selector:
    matchLabels:
      app: my-service
  jwtRules:
  - issuer: https://idp.example.com/realms/myrealm
    jwksUri: https://idp.example.com/realms/myrealm/protocol/openid-connect/certs
    forwardOriginalToken: true
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: require-jwt
spec:
  selector:
    matchLabels:
      app: my-service
  action: ALLOW
  rules:
  - from:
    - source:
        requestPrincipals: ["*"]
    to:
    - operation:
        methods: ["GET", "POST"]
```

> 这段只是模式示意。`RequestAuthentication` 单独存在时不拒绝没有 token 的请求，`issuer` 必须与 Keycloak 实际签发的 `iss` 逐字符一致，`audiences` 不配就不校验 `aud`——三个坑的完整解释、验证命令和回滚顺序见 [Istio + Keycloak JWT 认证与 IAM 授权落地]({{< relref "docs/solution-blogs/istio-keycloak-jwt-authz" >}})。安全类 API 自 Istio 1.22 起为 `security.istio.io/v1`，仍在使用 `v1beta1` 的清单建议一并迁移。

## 18.5 SDK 模式

直接使用各生态的 OIDC/OAuth 2.0 库集成。

> 自 Keycloak 24+ 起，官方已弃用各语言的专用 **Keycloak Adapter**，推荐改用框架自带的标准 OIDC 客户端。已有 Adapter 项目的迁移步骤参见 [Keycloak Adapter 弃用迁移指南]({{< relref "docs/solution-blogs/keycloak-adapter-migration" >}})。

### Spring Security OIDC 集成

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/admin/**").hasRole("admin")
                .anyRequest().authenticated()
            )
            .oauth2Login()
            .logout()
                .logoutSuccessUrl("/");
        return http.build();
    }
}
```

### 通用 OIDC 库

- **Java**：Spring Security OAuth 2.0 Client、Nimbus JOSE + JWT
- **Go**：`coreos/go-oidc`、`zitadel/oidc`、`ory/fosite`
- **Python**：`flask-oidc`、`django-oidc-provider`
- **Node.js**：`openid-client`
- **Rust**：`openidconnect-rs`

另有一类应用自带 OIDC 客户端（Grafana、Jenkins、Harbor、Argo CD 等），配置点是「应用自己的配置项 + Keycloak 侧 client 与 claim」，而不是写代码。这类接入的难点通常不在认证流程，而在**角色/组 claim 到应用内角色的映射**——Keycloak 输出的 `realm_access.roles`、`groups` 是嵌套或分组结构，应用的映射表达式各有一套语法。以 Grafana 为例的完整配置与映射对照见 [Grafana 接入 Keycloak OIDC]({{< relref "docs/solution-blogs/grafana-keycloak-oidc-sso" >}})。

## 18.6 协议选择指南

| 应用类型 | 推荐协议 | 原因 |
|---------|---------|------|
| 现代 Web 应用 | OIDC + PKCE | 标准化、安全、SPA 友好 |
| SPA（无 BFF） | OIDC + PKCE | 安全处理 Token |
| 移动 App | OIDC 授权码 + PKCE，经系统浏览器/Custom Tab | 安全浏览器（RFC 8252） |
| 服务间 API | OAuth 2.0 Client Credentials | M2M 认证 |
| 遗留企业应用 | SAML 2.0 | 兼容性 |
| 物联网设备 | OAuth 2.0 Device Flow | 输入受限 |

## 18.7 常见集成陷阱

1. **在 SPA 中将 Token 存在 localStorage**：易受 XSS，应使用 BFF 模式。
2. **不验证 Token 的 audience**：一个应用的 Token 被另一个应用接受。
3. **使用隐式模式（Implicit Flow）**：已不安全，迁移到 PKCE。
4. **硬编码 OIDC 配置**：应使用发现文档动态获取。
5. **忽略 Token 刷新**：Access Token 过期后不处理，用户突然退出。
6. **每个应用自己实现认证**：违反了 SSO 的初衷。

## 18.8 小结

集成 IDaaS 的核心不在于"对接 API"，而在于选择正确的架构模式。SPA 应用首选 BFF 模式，微服务环境首选 Sidecar/网格模式，传统 Web 应用首选网关模式或 SDK 模式。无论选择哪种模式，确保 Token 安全存储、使用 PKCE、避免业界已知的反模式。
