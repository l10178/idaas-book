---
title: "Hanko — Passkey-first 开源 IAM 认证方案详解 | IDaaS Book"
description: "Hanko 开源 IAM 认证平台深度解析：Passkey/WebAuthn 优先的 Go 后端架构、Hanko Elements 前端组件、与 Keycloak/Auth0 的 IAM 选型对比，以及 Docker 自建部署指南"
date: 2026-07-10T00:00:00+08:00
draft: false
weight: 53
menu:
  docs:
    parent: "implementation"
    identifier: "hanko-deep-dive"
toc: true
---

Hanko 是一个 Passkey-first 的开源身份认证平台，由德国团队 Hanko.io 开发，Go 语言编写。它的设计哲学很明确：**密码是过时的，Passkey（FIDO2/WebAuthn）应该成为用户认证的首选方式**。当前最新稳定版为 `backend/v2.7.0`（2026 年 6 月），GitHub 约 9k star。

与其他 IAM 平台不同，Hanko 不试图覆盖整个身份生命周期——它聚焦于**认证（Authentication）**这一层，做得专而精，定位为 Auth0、Clerk、WorkOS 的开源替代。

## 核心差异点

Hanko 与 Keycloak、Authentik 等全栈 IAM 平台的关键区别：

| 维度 | Hanko | Keycloak / Authentik |
|------|-------|---------------------|
| **定位** | 认证层（Authentication-only） | 全栈 IAM（认证+授权+联邦+用户管理） |
| **认证优先** | Passkey/WebAuthn 第一，密码可选甚至可禁用 | 密码+TOTP 为主，Passkey 作为 MFA 选项 |
| **集成方式** | `<hanko-auth>` Web Component 一行标签嵌入 | OIDC/SAML 协议对接，需自行开发登录页 |
| **前端 SDK** | React/Vue/Angular 等框架的一等公民支持 | 无官方前端 SDK，依赖社区适配器 |
| **部署复杂度** | Docker Compose 5 分钟起步 | Docker Compose / Helm / Operator 多组件 |
| **IAM 深度** | 轻量——不覆盖 LDAP 联邦、SCIM 供应、细粒度 RBAC | 深度覆盖企业 IAM 全场景 |

选 Hanko 的理由不是「功能更多」，而是「如果你只需要一个现代化、接入快、用户零门槛的认证层，Hanko 是最简路径」。

## 架构概览

```mermaid
flowchart TB
    subgraph "前端层"
        FE[Web / Mobile App]
        ELEMENTS[Hanko Elements<br/>&lt;hanko-auth&gt; Web Component]
        SDK[Hanko Frontend SDK<br/>JS/TS Client]
    end

    subgraph "Hanko Backend (Go)"
        API[Auth API<br/>REST + WebSocket]
        PASSKEY[Passkey / WebAuthn<br/>注册 + 验证]
        PASSCODE[Email Passcode<br/>邮件验证码登录]
        OAUTH[OAuth SSO<br/>Google/Apple/GitHub]
        SAML[SAML Enterprise SSO]
        SESSION[Session Management<br/>服务器端会话]
        JWT[JWT Issuing<br/>应用集成]
    end

    subgraph "存储层"
        DB[(PostgreSQL)]
    end

    FE --> ELEMENTS
    ELEMENTS --> SDK
    SDK --> API
    API --> PASSKEY
    API --> PASSCODE
    API --> OAUTH
    API --> SAML
    API --> SESSION
    API --> JWT
    API --> DB

    style ELEMENTS fill:#4a90d9,color:#fff
    style API fill:#e67e22,color:#fff
    style JWT fill:#27ae60,color:#fff
```

Hanko 后端是一个独立的 Go 服务，内置所有认证逻辑。前端通过 Hanko Elements（Web Component）或 Hanko Frontend SDK 与后端交互。Session 由服务端管理，应用通过 JWT 验证用户身份。

## 关键能力

### 1. Passkey-first 认证

Hanko 的 Passkey 实现基于 WebAuthn 标准，覆盖完整的 Passkey 生命周期：

- **注册**：调用 `navigator.credentials.create()` 创建公私钥对，私钥存储在用户设备的安全区域（TPM/Secure Enclave），公钥上传到 Hanko 后端
- **验证**：调用 `navigator.credentials.get()` 让用户通过生物识别或设备 PIN 完成签名
- **跨设备**：支持通过 QR 码 + Bluetooth 的 Cross-Device Authentication（由操作系统处理）
- **降级**：设备不支持 WebAuthn 时自动降级为 Email Passcode，确保覆盖所有用户

Hanko 的后端只存储公钥，不接触私钥——即使数据库泄露，攻击者也无法完成 WebAuthn 签名。

### 2. Hanko Elements（Web Component）

Hanko 提供了 `<hanko-auth>` Web Component，一行标签就能嵌入完整的登录/注册 UI：

```html
<!-- 一行标签搞定登录/注册/Passkey/Passcode 全流程 -->
<hanko-auth api="https://auth.example.com"></hanko-auth>
```

组件支持的页面：
- 登录（Passkey / Email Passcode / 密码 / OAuth SSO）
- 注册（Passkey 创建 + 邮件验证）
- 用户 Profile（管理 Passkey、密码、邮箱）
- MFA 设置（TOTP、Security Key）

组件通过 CSS 变量自定义样式，支持多语言（含中文）。不需要自己写登录页、回调处理、Token 刷新的逻辑。

### 3. 多种认证方式

| 方式 | 状态 | 适用场景 |
|------|------|---------|
| **Passkey / WebAuthn** | ✅ 核心功能 | 所有支持的设备，推荐首选 |
| **Email Passcode** | ✅ 生产可用 | Passkey 降级或无需注册的临时访问 |
| **密码** | ✅ 可选开启 | 遗留兼容，可全局禁用 |
| **OAuth SSO** | ✅ Google/Apple/GitHub | 社交登录，支持自定义 OIDC Provider |
| **SAML Enterprise SSO** | ✅ 生产可用 | 企业级单点登录 |
| **TOTP MFA** | ✅ 作为第二因素 | 敏感操作额外验证 |

密码功能是完全可选的：你可以在配置中关闭密码登录，强制所有用户使用 Passkey 或 Email Passcode。

### 4. API-first 设计

Hanko 后端暴露完整的 REST API，不强制使用 Hanko Elements。如果你需要自定义 UI，可以直接调用 API：

- `POST /passcode/login/initialize` — 发送 Email Passcode
- `POST /passcode/login/finalize` — 验证 Passcode 并获取 JWT
- `POST /webauthn/registration/initialize` — 开始 Passkey 注册
- `POST /webauthn/registration/finalize` — 完成 Passkey 注册
- `POST /webauthn/login/initialize` — 开始 Passkey 登录
- `POST /webauthn/login/finalize` — 完成 Passkey 登录并获取 JWT
- `GET /user` — 获取当前用户信息
- `POST /logout` — 登出并销毁 Session

### 5. JWT 与应用集成

Hanko 不充当 OIDC Provider（不像 Keycloak 对外签发 ID Token）。它的集成模式是：

```
用户 → <hanko-auth> 登录 → Hanko Backend 签发 JWT → 前端将 JWT 发往后端 → 后端验证 JWT
```

后端验证 JWT 需要 Hanko 的 JWKS 端点（`/.well-known/jwks.json`）。对于 Node.js 后端，官方提供 `@teamhanko/hanko-node` middleware；其他语言可以用标准 JWT 库 + JWKS 验证。

如果你的应用需要通过 OIDC 与其他系统对接，Hanko 不是合适的方案——那时你需要的是 Keycloak 或 Authentik 作为 OIDC Provider。

## 快速部署（Docker Compose）

Hanko 官方提供了完整的 Docker Compose 配置，包含后端、前端示例和邮件模拟器：

```yaml
# docker-compose.yml
version: "3.8"
services:
  hanko:
    image: ghcr.io/teamhanko/hanko:latest
    ports:
      - "8000:8000"   # public API
      - "8001:8001"   # admin API
    environment:
      - DATABASE_URL=postgres://hanko:changeme@postgres:5432/hanko
      - PASSLINK_SMTP_HOST=mailhog
      - PASSLINK_SMTP_PORT=1025
      - SERVER_PUBLIC_ADDRESS=http://localhost:8000
      - SERVER_ADMIN_ADDRESS=http://localhost:8001
      - WEBAUTHN_RP_ID=localhost
      - WEBAUTHN_RP_ORIGIN=http://localhost:8888
      - SECRET=change-me-to-a-random-32-byte-string
    depends_on:
      - postgres
      - mailhog

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: hanko
      POSTGRES_PASSWORD: changeme
      POSTGRES_DB: hanko
    volumes:
      - pg_data:/var/lib/postgresql/data

  mailhog:
    image: mailhog/mailhog
    ports:
      - "8025:8025"   # MailHog Web UI

volumes:
  pg_data:
```

关键配置项：

| 参数 | 作用 | 生产注意事项 |
|------|------|------------|
| `SERVER_PUBLIC_ADDRESS` | 对外的 API 地址 | 生产环境必须是 HTTPS |
| `WEBAUTHN_RP_ID` | WebAuthn 的 Relying Party ID | 必须是有效域名（非 localhost），决定 Passkey 的作用域 |
| `WEBAUTHN_RP_ORIGIN` | Web 应用的 origin | 必须与部署的域名一致 |
| `SECRET` | JWT 签名和 Session 加密密钥 | 至少 32 字节随机串，通过环境变量注入 |
| `DATABASE_URL` | PostgreSQL 连接串 | 生产环境建议使用托管 PostgreSQL |

## 与 Keycloak 的定位互补

Hanko 和 Keycloak 不是竞争关系，而是互补关系：

**Hanko 做认证体验，Keycloak 做身份基础设施。**

如果你的场景是：
- 面向消费者的 SaaS 应用，希望用户 3 秒内完成无密码登录 → **Hanko**
- 企业内部应用，需要 OIDC Provider + LDAP 联邦 + 细粒度 RBAC → **Keycloak**
- 两者都需要 → **Hanko 做用户端认证，Keycloak 做 OIDC Provider 和后台服务之间的身份层**

实际上可以把 Hanko 和 Keycloak 组合使用：Hanko 负责用户注册和登录，登录成功后发放 JWT；Keycloak 作为 OIDC Provider，通过 Token Exchange 将 Hanko JWT 转换为 OIDC Token，供下游 OIDC 客户端消费。

## 常见问题（FAQ）

### Hanko 能替代 Keycloak 做企业 IAM 吗？

不适合。Hanko 的定位是 Authentication-only——它不提供 LDAP/AD 联邦、SCIM 自动配置、细粒度 RBAC 授权、OIDC Provider 等功能。如果你的企业 IAM 需求包括这些，Keycloak 或 Authentik 是更合适的选择。Hanko 更适合作为面向终端用户的 SaaS 认证层。

### Passkey 是不是只支持最新设备？

WebAuthn 在 2022 年后发布的设备和浏览器上基本覆盖。Chrome 67+、Edge 79+、Safari 14+、Firefox 60+ 均支持。对于不支持的设备，Hanko 会降级到 Email Passcode。在实际用户中，Passkey 支持率已超过 95%。

### Hanko 的 Session 是怎么管理的？

Hanko 使用服务器端 Session（不是 JWT 自包含 Token），Session ID 存储在 HttpOnly + Secure + SameSite Cookie 中。Session 在服务端可随时吊销，支持远程登出。JWT 用于跨域传递身份到应用后端。

### Hanko 能对接企业微信/飞书/钉钉吗？

不直接支持。Hanko 的 OAuth SSO 支持 Google、Apple、GitHub 以及自定义 OIDC Provider。如果你需要对接企业微信/飞书/钉钉，可以用 Keycloak 作为中间 IDP，通过 Keycloak 的 Identity Provider 功能连接这些平台，然后用 Keycloak 作为 Hanko 的自定义 OIDC Provider。

### Hanko 适合多少用户规模？

官方未公布具体的性能基准数据。基于 Go 语言的单机能力，Hanko 在 4 核 8G 的服务器上可以支撑数万级别的并发 Passkey 注册和验证。对于 10 万+ 用户的场景，建议进行自己的压力测试，并根据结果考虑水平扩展。

## 小结

Hanko 是开源 IAM 生态中的一个独特存在：它不是全栈方案，而是把「让用户抛开密码」这件事做到极致。Passkey-first 的设计、Web Component 一行集成的接入方式、Go 后端的轻量部署，让它在面向消费者的 SaaS 认证场景中很有竞争力。

如果你的项目需要快速搭建用户认证、不想维护密码逻辑、也暂时不需要企业级 IAM 能力（LDAP、SCIM、细粒度 RBAC），Hanko 值得评估。如果你的需求更重——企业 SSO、身份联邦、多协议授权——Keycloak 或 Authentik 是更稳妥的选择。

更多信息参见 [Hanko GitHub](https://github.com/teamhanko/hanko)、[Hanko 官方文档](https://docs.hanko.io)、[Passkeys.io](https://www.passkeys.io)（Hanko 维护的 Passkey 体验站）。关于其他开源 IAM 方案，参考本书 [IDaaS 方案全景对比]({{< relref "docs/implementation/other-idaas-solutions.md" >}})。
