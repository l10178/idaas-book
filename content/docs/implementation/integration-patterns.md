---
title: "第18章：集成模式与实践"
description: "IDaaS 集成的常见模式：网关模式、BFF 模式、Sidecar 模式、SDK 模式"
date: 2024-04-05T00:00:00+08:00
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

使用 `oauth2-proxy` 为任何 HTTP 应用添加 OAuth 2.0 保护：

```
浏览器 → Nginx → oauth2-proxy → 应用
                │
                └── 未认证 → 重定向到 IDaaS
```

```yaml
# docker-compose.yaml
services:
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.5.0
    command:
      - --provider=oidc
      - --oidc-issuer-url=https://idp.example.com/realms/myrealm
      - --client-id=my-app
      - --client-secret=xxx
      - --cookie-secret=generate-a-random-secret
      # 不设置 --email-domain 以允许所有域；如需精确控制，用 --allowed-email-domains=example.com
      - --upstream=http://my-app:8080
      - --http-address=0.0.0.0:4180
    ports:
      - "4180:4180"
```

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

### BFF 的实现

```typescript
// BFF 服务示例 (Node.js + Express)
app.get('/api/proxy/*', async (req, res) => {
  // 从 Session 获取 Access Token
  const accessToken = req.session.accessToken;
  
  if (!accessToken || isExpired(accessToken)) {
    // 用 Refresh Token 刷新（存储在服务端）
    const newToken = await refreshAccessToken(req.session.refreshToken);
    req.session.accessToken = newToken.access_token;
    req.session.refreshToken = newToken.refresh_token;
  }
  
  // 代理请求到后端，携带 Access Token（剥离 /api/proxy 前缀）
  const backendPath = req.path.replace('/api/proxy', '');
  const response = await fetch(`https://backend-api${backendPath}`, {
    headers: { Authorization: `Bearer ${req.session.accessToken}` }
  });
  
  res.json(await response.json());
});

// OAuth 回调处理
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  // 用 code + code_verifier 交换 token
  const tokens = await exchangeCode(code, codeVerifier);
  
  // 存储 token 到服务端 session
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
# Istio RequestAuthentication
apiVersion: security.istio.io/v1beta1
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
    forwardOriginalToken: true  # 将原始 JWT 传递给后端（后端仍应自行校验 audience/issuer/过期，不可盲目信任网关）
---
# Istio AuthorizationPolicy
apiVersion: security.istio.io/v1beta1
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
        requestPrincipals: ["*"]  # 匹配任意已认证 principal（JWT 有效性由 RequestAuthentication 强制校验）
    to:
    - operation:
        methods: ["GET", "POST"]
```

## 18.5 SDK 模式

直接使用 IDaaS 提供的 SDK 集成：

### Keycloak 适配器

```java
// Spring Boot + Keycloak
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
            .oauth2Login()  // Spring Security 自动处理 OIDC 流程
            .logout()
                .logoutSuccessUrl("/");
        return http.build();
    }
}
```

### 通用 OIDC 库

许多语言的通用 OIDC 库：

- **Java**：Spring Security OAuth 2.0 Client、Nimbus JOSE + JWT
- **Go**：`coreos/go-oidc`、`ory/fosite`
- **Python**：`flask-oidc`、`django-oidc-provider`
- **Node.js**：`openid-client`
- **Rust**：`openidconnect-rs`

## 18.6 协议选择指南

| 应用类型 | 推荐协议 | 原因 |
|---------|---------|------|
| 现代 Web 应用 | OIDC + PKCE | 标准化、安全、SPA 友好 |
| SPA（无 BFF） | OIDC + PKCE | 安全处理 Token |
| 移动 App | OIDC 授权码 + PKCE，经系统浏览器/Custom Tab（iOS ASWebAuthenticationSession / Android Custom Tab） | 安全浏览器（RFC 8252） |
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
