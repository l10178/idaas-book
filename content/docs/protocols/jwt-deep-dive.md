---
title: "JWT 深入解读 — 结构、声明、验证与安全最佳实践 | IDaaS Book"
description: "JWT（JSON Web Token）完整技术解读：Header/Payload/Signature 结构、标准声明、JWS/JWE/JWK 区别、验证流程、常见攻击向量与防护，配合 Mermaid 生命周期图和 Keycloak 配置示例"
date: 2026-07-12T00:00:00+08:00
draft: false
weight: 24
menu:
  docs:
    parent: "protocols"
    identifier: "jwt-deep-dive"
toc: true
---

## JWT 是什么

**JWT（JSON Web Token，RFC 7519）** 是 IAM 领域最核心的数据格式之一。它不是认证协议，而是一种**紧凑的、URL 安全的令牌格式**，用于在双方之间传递声明（Claims）。OAuth 2.0 的 Access Token、OpenID Connect 的 ID Token 都使用 JWT 作为载体。

一句话理解：JWT 是一个**自包含的、可验证的 JSON 对象**——你把信息编码进去，接收方可以独立验证它的真实性和完整性，不需要回查颁发服务器。

### JWT 在 IAM 中的角色

```mermaid
graph LR
    A[认证请求] --> B[IDP 验证身份]
    B --> C[签发 JWT]
    C --> D1[Access Token<br/>访问 API]
    C --> D2[ID Token<br/>身份信息]
    C --> D3[Refresh Token<br/>续期]
    D1 --> E[Resource Server<br/>验证 JWT 签名和声明]
    D2 --> F[Client<br/>解析用户信息]
```

JWT 不解决「你是谁」的问题（那是认证协议的事），它解决的是「我怎么相信你给我的信息是真的」。

## JWT 的结构

一个 JWT 由三部分组成，用 `.` 分隔：

```
eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
|________ Header ________|______ Payload _______|_______________ Signature _________________|
```

### 结构可视化

```mermaid
graph TB
    subgraph "JWT = Header . Payload . Signature"
        H["Header<br/>{\"alg\": \"RS256\",<br/> \"typ\": \"JWT\",<br/> \"kid\": \"key-1\"}"]
        P["Payload<br/>{\"sub\": \"user123\",<br/> \"iss\": \"https://idp.example.com\",<br/> \"aud\": \"my-app\",<br/> \"exp\": 1720000000,<br/> \"iat\": 1719996400}"]
        S["Signature<br/>RSASHA256(<br/>  base64(Header) + '.' +<br/>  base64(Payload),<br/>  PrivateKey<br/>)"]
    end
    H -->|"Base64URL Encode"| E1["eyJhbGciOi..."]
    P -->|"Base64URL Encode"| E2["eyJzdWIiOi..."]
    E1 --> J["Final JWT"]
    E2 --> J
    S -->|"Base64URL Encode"| E3["SflKxwRJ..."]
    E3 --> J
```

### Header（头部）

声明令牌的类型和签名算法：

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2024-signing-key"
}
```

| 字段 | 含义 | 说明 |
|------|------|------|
| `alg` | 签名算法 | RS256/ES256/HS256/EdDSA，**不允许 none** |
| `typ` | 令牌类型 | 固定为 `JWT` |
| `kid` | 密钥标识 | JWK Set 中的密钥 ID，用于密钥轮换时选择正确的公钥 |

### Payload（载荷）

存放声明（Claims），分为三类：

**1. 注册声明**（Registered Claims，RFC 7519 §4.1）

| 声明 | 全称 | 含义 | 使用频率 |
|------|------|------|---------|
| `iss` | Issuer | 签发者 URL | **必填** |
| `sub` | Subject | 主体标识（用户 ID） | **必填** |
| `aud` | Audience | 目标接收方（Client ID 或 URL 数组） | **必填** |
| `exp` | Expiration | 过期时间（Unix 时间戳） | **必填** |
| `iat` | Issued At | 签发时间 | **必填** |
| `nbf` | Not Before | 生效时间 | 按需 |
| `jti` | JWT ID | 唯一标识，防重放 | 推荐 |

**2. 公开声明**（Public Claims）：在 IANA JWT Claims Registry 注册的声明，如 `name`、`email`、`email_verified`。

**3. 私有声明**（Private Claims）：自定义声明，如 `groups`、`roles`、`tenant_id`。需在双方协商命名空间。

```json
{
  "iss": "https://keycloak.example.com/realms/myrealm",
  "sub": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "aud": "oauth2-proxy",
  "exp": 1720000000,
  "iat": 1719996400,
  "nbf": 1719996400,
  "jti": "unique-token-id-abc123",
  "name": "张三",
  "email": "zhangsan@example.com",
  "groups": ["engineers", "deployers"]
}
```

### Signature（签名）

签名的作用是**完整性保护**和**来源认证**——接收方验证签名后就知道：(1) 内容没被篡改；(2) Token 确实由持有对应私钥的签发者签发。

```
签名算法取决于 alg：
- HS256：HMAC-SHA256(base64(Header) + '.' + base64(Payload), shared_secret)
- RS256：RSA-SHA256(base64(Header) + '.' + base64(Payload), private_key)
- ES256：ECDSA-SHA256(base64(Header) + '.' + base64(Payload), private_key)
```

**关键区别**：HS256 是对称算法（签发和验证用同一个 secret），RS256/ES256 是非对称算法（签发用私钥，验证用公钥）。生产环境**始终使用非对称算法**，因为对称算法的 secret 泄露后攻击者可以伪造任意 Token。

## JWT 的生命周期

```mermaid
sequenceDiagram
    participant Client as 客户端
    participant IDP as 身份提供者 (IDP)
    participant RS as 资源服务器 (API)

    Note over Client,RS: 1. Token 签发
    Client->>IDP: 认证请求
    IDP-->>Client: 签发 JWT（Access Token + ID Token）

    Note over Client,RS: 2. Token 使用
    Client->>RS: API 请求 + Authorization: Bearer <JWT>
    
    Note over RS: 3. Token 验证
    RS->>RS: 验证签名（JWK 公钥）
    RS->>RS: 验证 exp / nbf / iss
    RS->>RS: 验证 aud（是否匹配本 API）
    RS-->>Client: 200 OK（验证通过）或 401（验证失败）

    Note over Client,RS: 4. Token 过期后
    Client->>IDP: Refresh Token 换新 Access Token
    IDP-->>Client: 新 JWT
```

验证流程的正确顺序：

1. **解析**：Base64URL 解码 Header 和 Payload
2. **获取公钥**：从 `iss/.well-known/openid-configuration` 获取 JWK Set，用 `kid` 匹配
3. **验证签名**：用公钥验证 Signature
4. **验证时效**：`exp` 必须大于当前时间，`nbf`（如有）必须小于当前时间
5. **验证签发者**：`iss` 必须匹配预期的 Issuer URL（**精确匹配，含尾部 `/` 检查**）
6. **验证受众**：`aud` 必须包含本 API 的 Client ID 或 URL
7. **验证唯一性**（可选）：检查 `jti` 不在已使用列表中

## JWS、JWE 与 JWK

JWT 本身只定义了令牌格式，实际工程中常与以下规范组合使用：

| 规范 | RFC | 作用 | 类比 |
|------|-----|------|------|
| **JWS** | RFC 7515 | JSON Web Signature——给 JWT **签名**，保证完整性和来源 | 信封上的火漆印章 |
| **JWE** | RFC 7516 | JSON Web Encryption——给 JWT **加密**，保证机密性 | 不透明的加密信封 |
| **JWK** | RFC 7517 | JSON Web Key——描述密钥的 JSON 格式 | 公钥的标准化名片 |

```mermaid
graph TB
    subgraph "JWS（签名）"
        P1["Claims<br/>{sub: 'alice'}"] --> S1["JWS<br/>{payload, signatures}"]
    end
    subgraph "JWE（加密）"
        P2["Claims<br/>{sub: 'alice'}"] --> E1["加密"]
        E1 --> S2["JWE<br/>{ciphertext, encrypted_key, iv}"]
    end
    subgraph "Nested JWT（签名+加密）"
        P3["Claims"] --> S3["JWS"]
        S3 --> E3["JWE"]
    end
```

**实践建议**：
- Access Token 用 JWS（签名），足以保证完整性。Token 本身不放在浏览器端存储即可。
- 不要依赖 JWT 的加密来保护敏感数据——如果把加密的 JWT 放在前端，攻击者拿到 JWT 后可以离线暴力破解。把敏感数据放在后端。
- 需要端到端加密时用 Nested JWT（先签名再加密），典型场景是金融级 API 或跨组织数据交换。

## 常见攻击向量与防护

### 1. alg=none 攻击

**原理**：如果服务器接受 `"alg": "none"`，攻击者可以绕过签名验证，伪造任意 Payload。

**防护**：验证代码中硬编码允许的算法白名单，拒绝 `none` 和不在白名单中的算法。

### 2. 算法混淆攻击（HS256 → RS256）

**原理**：服务器用 RS256 验证，但攻击者篡改 Header 为 `"alg": "HS256"`，用服务器的 RSA 公钥作为 HMAC secret 伪造签名。如果服务器用 HS256 逻辑去验证（公钥当 secret 用），验证通过。

**防护**：使用支持 `alg` 白名单的 JWT 库（如 `jjwt`、`PyJWT`），明确指定期望的算法；不要从 Token Header 自动推断算法。

### 3. kid 注入

**原理**：`kid` 指向 `/dev/null` 或外部 URL，诱导服务器用空文件或攻击者控制的密钥来验证。

**防护**：只从 JWK Set 中读取 `kid`，不信任 Token Header 中的路径式 `kid`。

### 4. Audience 缺失

**原理**：服务器不验证 `aud`，一个发给应用 A 的 Token 被用于访问应用 B。

**防护**：验证代码中始终检查 `aud` 字段是否包含本应用的标识符。这是 **oauth2-proxy 最常见的报错来源**——`expected audience <client-id> got account`，详见 [oauth2-proxy 集成指南]({{< relref "docs/solution-blogs/keycloak-oauth2-proxy.md" >}})。

### 5. 过期 Token 重放

**原理**：即使设置了 `exp`，在 Token 有效期内攻击者窃取 Token 后可以直接使用。

**防护**：
- 尽量缩短 Access Token 有效期（15 分钟以内）
- 使用 Refresh Token Rotation（每次刷新换新的 Refresh Token）
- Token 绑定（Sender-Constrained Token）：DPoP（RFC 9449）或 mTLS

## Keycloak 中的 JWT 配置

### 1. 签名算法配置

在 Keycloak Realm Settings → Keys → 选择 RS256/ES256/EdDSA。**生产环境推荐 ES256**（更短的签名，相同的安全强度）。

Keycloak 默认使用 RS256，密钥轮换时会自动在 JWK Set 中保留旧公钥一段时间，使已签发的 Token 在有效期内仍可验证。

### 2. 自定义 Claims（Client Scope + Mapper）

```
Keycloak 管理控制台：
Client Scopes → 创建 scope → Mappers → 添加
  - Mapper Type: User Attribute / Group Membership / Script Mapper
  - Token Claim Name: 目标 claim 名称（如 groups、department）
  - Add to ID token: ON
  - Add to access token: ON
```

关键 Mapper 类型：
| Mapper | 用途 | 示例输出 |
|--------|------|---------|
| Group Membership | 用户组信息 | `"groups": ["engineers"]` |
| User Attribute | 自定义用户属性 | `"department": "Engineering"` |
| Audience | 设置 `aud` 字段 | `"aud": "oauth2-proxy"` |
| User Realm Role | 用户 Realm 角色 | `"realm_access": {"roles": ["user"]}` |

### 3. JWK Set 端点

Keycloak 的 JWK Set 在：
```
https://<keycloak-host>/realms/<realm>/protocol/openid-connect/certs
```

JWT 库（如 `jwks-rsa`、`java-jwt`）会自动从这个端点获取公钥，按 `kid` 匹配。

## JWT 最佳实践速查

| 实践 | 说明 |
|------|------|
| 使用非对称算法 | RS256/ES256/EdDSA，不碰 HS256 |
| Access Token ≤ 15 分钟 | 短期 Token + Refresh Token 机制 |
| 验证所有标准声明 | `iss`/`aud`/`exp`/`nbf`/`iat` 逐个检查 |
| 白名单算法 | 代码中 hardcode 允许的 `alg` 列表 |
| 不存敏感数据 | JWT 的 Payload 是 Base64 编码，不是加密，任何人可解码读取 |
| JWK 缓存 | 缓存 JWK Set，避免每次请求都拉取（缓存 TTL 建议 5-15 分钟） |
| 密钥轮换 | JWK Set 中保留旧公钥，确保已签发 Token 在有效期内可验证 |
| Token 绑定 | 生产环境考虑 DPoP 或 mTLS 做 Sender-Constrained Token |
| 日志脱敏 | 记录 JWT 到日志时，去掉 Signature 部分（只保留 Header.Payload） |

## 常见问题

### Q1：JWT 和 Session Cookie 有什么区别？

| 维度 | JWT | Session Cookie |
|------|-----|---------------|
| 状态 | 无状态，Token 自包含所有信息 | 有状态，服务端存 Session |
| 扩展性 | 天然支持水平扩展 | 需要 Session 共享（Redis/DB） |
| 撤销 | 困难（需要黑名单或短有效期） | 简单（删 Session 记录） |
| 跨域 | 适合（API 间传递） | 受 Cookie 跨域限制 |
| 数据量 | 较大（每次请求带完整 Token） | 小（只传 Session ID） |

**选择建议**：BFF（Backend for Frontend）模式下，前端用 Session Cookie，后端 API 间用 JWT，各取所长。

### Q2：ID Token 和 Access Token 有什么区别？

ID Token 是**给客户端看的**身份证明（证明「这个用户是谁」），Access Token 是**给 API 看的**通行证（证明「允许访问什么资源」）。ID Token 不应该发送给 API，Access Token 不应该被客户端解析为用户信息。

详见 [OpenID Connect 完整解读]({{< relref "docs/protocols/openid-connect.md" >}})。

### Q3：JWT 能不能做无状态登出？

不能。JWT 本质是无状态的——签发后只要没过期就有效。要实现即时登出，需要：
- 服务端维护 Token 黑名单（引入状态，背离 JWT 设计初衷）
- 把 Access Token 有效期设得非常短（如 5 分钟），用 Refresh Token Rotation
- 结合 OIDC Session Management / Back-Channel Logout

更深入的 IAM 会话管理讨论见 [IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management.md" >}})。

### Q4：为什么 oauth2-proxy 总报 "expected audience" 错误？

oauth2-proxy 会验证 ID Token 中的 `aud` 字段。如果 Keycloak 客户端没有配置 Audience Mapper，`aud` 默认是 `account` 而不是你的 Client ID。解决：在 Keycloak 客户端中添加 Audience Mapper，把 `aud` 设为 `oauth2-proxy`。

详见 [oauth2-proxy 集成指南]({{< relref "docs/solution-blogs/keycloak-oauth2-proxy.md" >}}) 和 [OAuth 2.0 攻击面分析]({{< relref "docs/protocols/oauth2-attack-surface.md" >}})。

### Q5：HS256 和 RS256 怎么选？

**生产环境永远选 RS256（或 ES256）**。HS256 是对称算法，签发和验证用同一个 secret——这个 secret 泄露后攻击者可以伪造任意 Token。RS256 是非对称算法，私钥只存在于 IDP，所有 API 用公钥验证，私钥泄露的风险面小得多。

## 延伸阅读

- [OAuth 2.0 深度解读]({{< relref "docs/protocols/oauth2-deep-dive.md" >}})——JWT 作为 OAuth Token 的整体工作流
- [OpenID Connect 完整解读]({{< relref "docs/protocols/openid-connect.md" >}})——ID Token 的结构与验证
- [DPoP：OAuth Token 的 Sender-Constrained 绑定]({{< relref "docs/protocols/oauth2-dpop.md" >}})——用 DPoP 解决 Token 窃取重放
- [OAuth 2.1 相比 OAuth 2.0 的变化]({{< relref "docs/protocols/oauth2.1-changes.md" >}})——OAuth 2.1 对 JWT 使用的最新要求
- [IAM 协议选型指南]({{< relref "docs/advanced-topics/iam-protocol-selection-guide.md" >}})——在做认证协议选型决策
- [IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management.md" >}})——JWT 在 IAM 会话生命周期中的位置
- RFC 7519 (JWT)、RFC 7515 (JWS)、RFC 7516 (JWE)、RFC 7517 (JWK)
