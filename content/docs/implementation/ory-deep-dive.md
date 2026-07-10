---
title: "Ory 开源身份栈深度解析 — Hydra、Kratos、Keto 云原生 IAM 架构 | IDaaS Book"
description: "Ory 开源身份栈解读：Hydra（OAuth2.1/OIDC）、Kratos（身份管理）、Keto（权限引擎）、Oathkeeper（零信任网关）及与 Keycloak 对比选型"
date: 2026-07-09T00:00:00+08:00
draft: false
weight: 52
menu:
  docs:
    parent: "implementation"
    identifier: "ory-deep-dive"
toc: true
---

Ory 是一套用 Go 编写的云原生、API-first 身份基础设施组件，由 [Ory Corp](https://www.ory.sh) 维护。与 Keycloak 这样的「一体化」IAM 平台不同，Ory 将身份功能拆成多个独立微服务，各自聚焦一个领域：认证（OAuth2/OIDC）、用户管理、权限控制、访问网关。这种架构在云原生团队中很受欢迎——你可以只部署需要的部分，也可以全部组合起来替代自研或商业方案。

截止 2026 年 7 月，各组件 GitHub star 与版本：
- [Hydra](https://github.com/ory/hydra)：17k+ star，OIDC Certified OAuth 2.1 服务器，v26.2.0
- [Kratos](https://github.com/ory/kratos)：13k+ star，用户认证与身份管理，v26.2.0
- [Keto](https://github.com/ory/keto)：5k+ star，Zanzibar 风格权限服务器，v26.2.0
- [Oathkeeper](https://github.com/ory/oathkeeper)：3.5k+ star，身份感知反向代理，v26.2.0

Ory Network 是官方托管服务，也可以全部自托管。OpenAI、SAP、ASICS 等公司都在生产环境使用。

## 设计哲学

Ory 的四条核心设计原则：

1. **API-first，无强制 UI**：Kratos 和 Hydra 不提供登录页面——你可以用 React、Vue、原生移动端完全自定义认证界面。这与 Keycloak 的「开箱即用登录页」形成鲜明对比。
2. **微服务拆分**：认证（Hydra）、身份（Kratos）、权限（Keto）、网关（Oathkeeper）独立部署、独立扩缩容、独立升级。不想要的功能直接不部署。
3. **标准优先**：Hydra 是少数获得 [OpenID Certified](https://openid.net/certification/) 的 Go 实现之一，完整支持 OAuth 2.1、PKCE、DPoP、mTLS 等安全扩展。
4. **云原生 DNA**：所有组件天然支持 PostgreSQL / MySQL / CockroachDB，通过环境变量或配置文件驱动，适合容器化与 Kubernetes。

## 架构全景

```mermaid
flowchart TB
    subgraph "用户侧"
        U[用户浏览器]
        APP[OAuth2 客户端应用]
    end

    subgraph "Ory 身份栈"
        direction TB
        
        subgraph "Kratos — 身份管理"
            KRATOS_API[Public API\n注册/登录/设置]
            KRATOS_ADMIN[Admin API\n用户管理]
            KRATOS_DB[(用户数据库)]
        end

        subgraph "Hydra — OAuth2/OIDC"
            HYDRA_PUBLIC[Public API\n授权/Token]
            HYDRA_ADMIN[Admin API\nClient 管理]
            HYDRA_DB[(OAuth2 数据库)]
        end

        subgraph "Keto — 权限"
            KETO_WRITE[Write API\n创建关系]
            KETO_READ[Read API\n权限检查]
            KETO_DB[(关系数据库)]
        end

        subgraph "Oathkeeper — 网关"
            OK_JUDGE[Access Rules\n访问规则引擎]
            OK_PROXY[Reverse Proxy\n反向代理]
        end
    end

    subgraph "下游"
        SVC[受保护的服务]
    end

    U -->|登录/注册| KRATOS_API
    APP -->|OAuth2 授权| HYDRA_PUBLIC
    HYDRA_PUBLIC -->|验证用户身份| KRATOS_API
    HYDRA_ADMIN -->|管理 OAuth2 Client| HYDRA_DB
    KRATOS_ADMIN --> KRATOS_DB
    KETO_WRITE --> KETO_DB
    KETO_READ --> KETO_DB
    OK_JUDGE -->|权限决策| KETO_READ
    OK_PROXY -->|验证 Token| HYDRA_PUBLIC
    OK_PROXY --> SVC

    style KRATOS_API fill:#4a90d9,color:#fff
    style HYDRA_PUBLIC fill:#27ae60,color:#fff
    style KETO_WRITE fill:#e67e22,color:#fff
    style OK_PROXY fill:#8e44ad,color:#fff
```

上图展示了 Ory 各组件之间的关系：Kratos 负责"这个用户是谁"，Hydra 负责"给这个客户端发什么 Token"，Keto 负责"这个用户有没有权限做这件事"，Oathkeeper 在最外层做统一的认证鉴权入口。

关键交互路径：
1. 用户通过 Kratos API 注册/登录，Kratos 返回 session cookie
2. 应用发起 OAuth2 授权码流，重定向到 Hydra
3. Hydra 调用 Kratos 验证用户登录态
4. 应用拿到 access token，通过 Oathkeeper 代理访问后端
5. Oathkeeper 向 Hydra 验证 token、向 Keto 查询权限

## 核心组件详解

### Hydra — OAuth 2.1 / OpenID Connect 认证服务器

Hydra 是整个 Ory 生态中 star 最高、最成熟的组件。它的定位非常明确：**只做 OAuth2/OIDC 协议层面的认证和授权，不做用户管理**。

这意味着 Hydra 没有内置的用户数据库、没有登录页面、没有注册流程。它通过 HTTP API 与 Kratos（或任何外部用户系统）集成，来验证"这个用户是谁"。

**核心能力**：
- 完整的 OAuth 2.0 / OAuth 2.1 / OIDC 协议实现
- OpenID Certified（Go 生态中为数不多的认证实现之一）
- 支持 Authorization Code + PKCE、Client Credentials、Refresh Token、Device Authorization Grant
- 支持 DPoP (RFC 9449)、mTLS sender-constrained tokens、JWT Profile for OAuth 2.0
- 原生支持 PAR (Pushed Authorization Requests, RFC 9126)
- 内置 OAuth 2.0 动态客户端注册（RFC 7591）
- 支持自定义 Claim、自定义 Consent 页面

**适用场景**：
- 已有用户系统，需要标准 OAuth2/OIDC 认证层（例如内部 API 网关需要颁发 JWT）
- 微服务架构中需要一个轻量的 Token 发行和校验中心
- 需要 OpenID Certification 的合规场景
- 多租户 SaaS 平台需要为每个租户提供独立 OAuth2 端点

**不适用场景**：
- 没有现成用户系统的团队——需要同时部署 Kratos 或其他身份管理方案
- 需要开箱即用登录页面的场景——Hydra 不提供 UI，需要自己开发
- 需要 SAML 协议支持——Hydra 只做 OAuth2/OIDC（Ory 建议用外部 IdP 桥接）

### Kratos — 云原生用户认证与身份管理

Kratos 是 Ory 的用户身份管理组件，负责所有"与人相关"的事情：注册、登录、密码管理、MFA、社交登录、账户恢复。它同样遵循 API-first 原则——所有功能通过 REST API 暴露，前端完全由你控制。

**核心能力**：
- 多种认证方式：密码、WebAuthn/Passkey、TOTP、Magic Link、短信/邮件验证码、社交登录（GitHub、Google、Apple 等），SAML 2.0
- 完整的账户生命周期：注册、邮箱验证、密码重置、账户恢复
- Session 管理：支持 Cookie-based session 和 API Token
- 身份 Schema：通过 JSON Schema 定义用户数据结构，支持自定义属性验证
- 多因素认证（MFA）：可配置为强制或可选，支持 TOTP、WebAuthn、Lookup Secret
- 自带管理 API：CLI 和 SDK 可用于批量导入和管理用户

**身份 Schema 示例**：

```yaml
# identity.schema.json
$schema: http://json-schema.org/draft-07/schema#
type: object
properties:
  traits:
    type: object
    properties:
      email:
        type: string
        format: email
      name:
        type: object
        properties:
          first:
            type: string
          last:
            type: string
    required:
      - email
```

这个 Schema 机制是 Kratos 的一个重要特性——你可以定义用户需要哪些字段，Kratos 会自动验证注册和更新时的数据合法性，而不像 Keycloak 那样所有自定义属性都是扁平的键值对。

**Keycloak 用户属性对比**：

| 特性 | Keycloak | Kratos |
|------|----------|--------|
| 用户数据结构 | 扁平键值对属性 | JSON Schema 定义的结构化数据 |
| 前端 UI | 内置 FTL 模板 | 无 UI，完全自定义 |
| 社交登录 | 内置 Provider 配置 | 通过 API 配置，可扩展 |
| MFA | 内置 TOTP、WebAuthn | TOTP、WebAuthn、Lookup Secret、自定义 |
| 密码策略 | 内置策略引擎 | 通过 JSON Schema 和 Hook 实现 |
| 扩展方式 | SPI (Java) | WebHook / API-first |

### Keto — Zanzibar 风格权限引擎

Keto 实现的是 Google 在 [Zanzibar 论文](https://research.google/pubs/pub48190/) 中描述的全局授权系统。它的核心理念是：**权限不是"用户有什么角色"，而是"主体对客体有什么关系"**。

这是一个 ReBAC（Relationship-Based Access Control）的实现，比传统的 RBAC 更灵活：

```
// RBAC 思维
user1 → role:admin → can:write → document:123

// ReBAC（Keto/Zanzibar）思维
user1 → owner → document:123  // user1 是 document:123 的 owner
owner → can_write → document  // owner 关系意味着写权限

// 查询：user1 能否写 document:123？
// Keto 通过关系图推导：user1 → owner → document:123 → can_write ✓
```

**核心概念**：
- **Object**：被访问的资源（如 document:123、project:abc）
- **Relation**：对象之间的关系（owner、editor、viewer、parent）
- **Subject**：执行操作的主体（用户、组、服务账号）
- **Namespace**：对象类型定义（定义每种对象支持哪些关系）

**Namespace 配置示例**：

```yaml
# keto_namespaces.yaml
- name: Document
  relations:
    owner:
    editor:
      union:
        - this: { owner }
    viewer:
      union:
        - this: { editor }
        - this: { owner }

- name: Organization
  relations:
    member:
    admin:
      union:
        - this: { member }
```

**适用场景**：
- Google Drive 风格的共享权限模型（文档 → 文件夹 → 组织 → 域，权限层层继承）
- 多租户 SaaS 平台中租户内复杂的资源权限
- 需要"把这个文件夹的只读权限给这个用户组"这种细粒度控制

**不适用场景**：
- 简单的"管理员/普通用户"二分法——RBAC 更合适
- 不需要跨对象权限推导的场景

### Oathkeeper — 身份感知反向代理

Oathkeeper 是 Ory 生态的 API 网关/反向代理，定位与 oauth2-proxy 和 Pomerium 类似但更偏向 API 鉴权而非用户应用代理。它通过 Access Rules 定义哪些路径需要什么认证和授权条件。

**核心能力**：
- 认证：验证 JWT、OAuth2 Token、Cookie Session
- 授权：调用 Keto 做权限决策、调用远程服务做自定义鉴权
- 数据变换：将认证后的用户信息注入 HTTP Header（类似 oauth2-proxy 的 `X-Auth-Request-*`）
- 零信任：每个请求都经过完整的认证 + 鉴权链

```yaml
# Access Rule 示例
- id: protect-api
  match:
    url: http://my-api.example.com/<**>
    methods: [GET, POST, PUT, DELETE]
  authenticators:
    - handler: jwt
      config:
        jwks_urls:
          - https://hydra.example.com/.well-known/jwks.json
  authorizer:
    handler: allow
  mutators:
    - handler: header
      config:
        headers:
          X-User-ID: "{{ .Extra.user_id }}"
          X-User-Email: "{{ .Extra.email }}"
```

## Ory Network vs 自托管

Ory 提供了两种运行模式：

| 维度 | Ory Network（托管） | 自托管 |
|------|---------------------|--------|
| 部署复杂度 | 零运维，开箱即用 | 需要自行管理所有组件 |
| 可定制性 | UI 完全自定义，API 可控 | 完全控制 |
| 高可用 | 内置 SLA | 需要自建 |
| 数据控制 | 数据存储在 Ory Cloud | 数据在自己基础设施 |
| 费用 | 按 MAU / API 调用计费 | 基础设施成本 |
| 升级 | 自动 | 手动按节奏升级 |
| 适合 | 快速启动、不想维护基础设施 | 合规要求、已有 K8s 基础设施 |

## Ory vs Keycloak：选型对比

这是最常被问到的问题。一个简单的概括：**Keycloak 是自成一体的 IAM 平台，Ory 是一套可自由组合的身份积木**。

| 维度 | Keycloak | Ory |
|------|----------|-----|
| 架构 | 单体（Quarkus 后端） | 微服务（Hydra + Kratos + Keto + Oathkeeper） |
| 语言 | Java (Quarkus) | Go |
| 内置 UI | 完整的管理控制台 + 登录页 | 无（需自行开发） |
| OAuth2/OIDC | 完整支持 | 完整支持 + OpenID Certified |
| SAML 2.0 | 完整 IdP 支持 | 仅 Kratos 支持 SAML 作为登录方式 |
| 用户管理 | 内置，开箱即用 | Kratos 负责，API-first |
| 权限控制 | RBAC + 细粒度权限 | ReBAC (Keto/Zanzibar) |
| 扩展性 | SPI 机制 | WebHook + API |
| 部署复杂度 | 低（一个容器即可运行） | 高（至少 2-3 个服务） |
| 学习曲线 | 中等 | 较高 |
| 适合团队规模 | 1-3 人即可运维 | 最好 3-5 人有 Go 经验 |
| 生产案例 | 全球众多银行、政府、企业 | OpenAI、SAP、ASICS |

**选择 Keycloak 的信号**：
- 需要一个"部署就能用"的完整 SSO 平台
- 团队以 Java/DevOps 为主，不想写前端
- 需要管理控制台、用户自助服务等开箱即用的功能
- 需要 SAML IdP 能力
- 对"一体化"感到安心

**选择 Ory 的信号**：
- 已有或准备自研前端，希望完全控制 UX
- 团队以 Go/云原生为主，熟悉微服务治理
- 只需要部分功能（如仅 OAuth2 服务器，已有用户系统）
- 需要 Zanzibar 级别的细粒度权限
- 多租户 SaaS 需要为每个租户提供独立的 OAuth2 端点

## 快速部署（Docker Compose）

以下配置启动 Ory 核心三件套（Hydra + Kratos + Keto），适合本地开发和评估：

```yaml
# docker-compose.yml（开发用途，非生产配置）
version: "3.9"
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ory
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: ory
    ports:
      - "5432:5432"

  hydra:
    image: oryd/hydra:v26.2.0
    ports:
      - "4444:4444"  # Public
      - "4445:4445"  # Admin
    command: serve all --dev
    environment:
      - DSN=postgres://ory:secret@postgres:5432/hydra?sslmode=disable
      - URLS_SELF_ISSUER=https://localhost:4444
      - URLS_CONSENT=https://localhost:3000/consent
      - URLS_LOGIN=https://localhost:3000/login
    depends_on:
      - postgres

  kratos:
    image: oryd/kratos:v26.2.0
    ports:
      - "4433:4433"  # Public
      - "4434:4434"  # Admin
    command: serve -c /etc/config/kratos/kratos.yml --dev
    volumes:
      - ./kratos.yml:/etc/config/kratos/kratos.yml
    environment:
      - DSN=postgres://ory:secret@postgres:5432/kratos?sslmode=disable

  keto:
    image: oryd/keto:v26.2.0
    ports:
      - "4466:4466"  # Read
      - "4467:4467"  # Write
    command: serve -c /etc/config/keto/keto.yml
    volumes:
      - ./keto.yml:/etc/config/keto/keto.yml
    environment:
      - DSN=postgres://ory:secret@postgres:5432/keto?sslmode=disable
```

启动后验证：

```bash
# 检查 Hydra 就绪
curl -s https://localhost:4444/health/alive | jq .

# 检查 Kratos 就绪
curl -s http://localhost:4433/health/alive | jq .
```

## 常见问题（FAQ）

**Q: Ory 能完全替代 Keycloak 吗？**

不能简单地说"能"或"不能"。如果你只需要 OAuth2/OIDC，Hydra 完全可以替代 Keycloak 的认证层。如果你还需要开箱即用的管理控制台、SAML IdP、内置登录页，就需要 Kratos + 前端开发，投入比 Keycloak 大。如果你的场景是"已有用户系统 + 需要 OAuth2 认证"，Ory 可能是更好的选择。

**Q: Ory 适合小团队吗？**

适合有 Go/云原生经验的小团队。Ory 的抽象干净、文档清晰，但你需要应付多个微服务的部署、监控、升级。如果团队只有 1-2 人且没有 Go 经验，Keycloak 的运维成本更低。

**Q: Ory 支持 LDAP 吗？**

Kratos 本身不直接连接 LDAP。Ory 的推荐做法是使用 [Ory Dockertest](https://github.com/ory/dockertest) 或通过 WebHook 集成外部 LDAP。如果需要直接在 IDP 层面使用 LDAP，Keycloak 的用户联邦功能更直接（参考 [Keycloak + LDAP/AD 用户联邦]({{< relref "docs/solution-blogs/keycloak-ldap-ad-federation" >}})）。

**Q: Hydra 的 OIDC Certification 是什么？**

这是 OpenID Foundation 对 OIDC Provider 的一致性认证，确保实现严格符合 OpenID Connect 规范。Hydra 是少数获得该认证的 Go 实现之一，意味着如果你需要合规审计或与标准 OIDC 客户端集成，Hydra 的实现更可靠。

## 小结

Ory 代表了一种与 Keycloak 完全不同的 IAM 哲学：不追求"一个制品解决所有问题"，而是通过专注的微服务组合出你需要的身份能力。这种架构在现代云原生团队中越来越受欢迎——它与微服务、Kubernetes、API-first 的思维天然契合。

如果你的团队已经在用 Go、习惯微服务治理、愿意在登录 UI 上投入前端资源，Ory 是一个值得认真评估的方案。如果你的首要目标是"部署即用"，Keycloak 仍然是更务实的选择。
