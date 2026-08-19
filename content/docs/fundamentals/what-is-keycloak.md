---
title: "Keycloak 是什么——开源 IAM 完全指南 | IDaaS Book"
description: "Keycloak 是什么？开源身份与访问管理平台。覆盖 SSO、OIDC、SAML、LDAP Federation、用户联邦、多租户等全部核心能力。从入门到生产环境部署。"
date: 2026-07-09T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "fundamentals"
    identifier: "what-is-keycloak"
toc: true
---

## Keycloak 是什么

**Keycloak** 是 Red Hat 赞助的开源**身份与访问管理（IAM）平台**，由 Keycloak 开源社区维护。它提供标准化的登录、令牌和用户联邦能力；项目的 GitHub star 数会变化，不能代替版本、兼容性或容量验证。

一句话概括：**Keycloak 是你可以自己部署的 Okta / Auth0**。它提供了现代应用所需的全部身份能力，你不需要支付按用户计费的钱，只需要自己运维它。

核心能力：

- **单点登录（SSO）**：一次登录，所有接入应用免密访问
- **多协议支持**：OpenID Connect、OAuth 2.0、SAML 2.0——全覆盖
- **身份联邦**：对接外部身份源（LDAP、Active Directory、社交登录）
- **用户管理**：自建用户存储 + 外部联合用户源
- **多因素认证**：TOTP、WebAuthn/Passkey、短信验证码
- **细粒度授权**：基于角色、组、属性的访问控制
- **管理控制台**：Web UI + REST API + CLI（kcadm）

## 为什么选择 Keycloak

### Keycloak vs 商业 IDaaS

| 对比维度 | Keycloak | Okta / Auth0 |
|---------|----------|-------------|
| 许可 | 开源免费（Apache 2.0） | 按用户数/月付费 |
| 部署 | 自建（Docker / K8s / Bare Metal） | SaaS（无需运维） |
| 数据主权 | 完全自主控制 | 数据留存在供应商 |
| 定制能力 | SPI 插件 + 主题化 + 源码级定制 | API + 有限的配置定制 |
| 运维成本 | 需要团队维护 | 零运维 |
| 1000 用户年成本 | ~$0（仅服务器成本） | ~$2000-6000/年 |

> **结论**：如果你需要数据主权、深度定制能力、或者用户量大到按用户计费肉疼，Keycloak 是最优解。如果你团队没有 IAM 运维能力，选 SaaS IDaaS。

### Keycloak vs 其他开源 IAM

| 对比维度 | Keycloak | Authentik | Casdoor | Zitadel |
|---------|----------|-----------|---------|---------|
| 语言 | Java | Python | Go | Go |
| 协议 | OIDC/SAML/LDAP | OIDC/SAML/LDAP | OIDC/SAML/OAuth | OIDC/SAML |
| 社区 | 活跃开源项目 | 活跃增长 | 中文活跃 | 事件驱动架构 |
| 企业级 | 生产成熟 | 功能齐全 | 轻量易用 | 多租户原生 |
| 学习曲线 | 中高 | 中 | 低 | 中高 |

## Keycloak 的架构

```
┌─────────────────────────────────────────┐
│              Keycloak 服务器              │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ │
│  │  Realm  │ │  Realm   │ │  Realm    │ │
│  │  员工   │ │  客户    │ │  合作伙伴  │ │
│  │  ┌────┐ │ │  ┌────┐  │ │  ┌────┐   │ │
│  │  │用户│ │ │  │用户│  │ │  │用户│   │ │
│  │  │角色│ │ │  │角色│  │ │  │角色│   │ │
│  │  │组  │ │ │  │组  │  │ │  │组  │   │ │
│  └────────┘ │  └───────┘ │  └─────────┘ │
└─────────────────────────────────────────┘
          │                   │
     ┌────▼────┐        ┌────▼────┐
     │ App A   │        │ App B   │
     │(OIDC)   │        │(SAML)   │
     └─────────┘        └─────────┘
```

- **Realm（域）**：Keycloak 内的独立身份域。每个 Realm 有独立的用户、角色、组、客户端和认证配置；它不是业务数据或租户授权边界的自动替代品。典型用法：员工 Realm、客户 Realm、合作伙伴 Realm。
- **Client（客户端）**：接入 Keycloak 的应用。每个应用是一个 Client，配置自己的认证流程、重定向 URI。
- **User Federation（用户联邦）**：对接外部用户源（LDAP、AD、自定义数据库），不把用户数据复制到 Keycloak。

## Keycloak 核心概念速查

| 概念 | 是什么 | 类比 |
|------|--------|------|
| Realm | 独立的身份域；隔离 Keycloak 内的身份配置，不自动隔离业务数据 | 一个「身份配置域」 |
| Client | 接入 Keycloak 的应用 | 一个「应用注册」 |
| User | 身份主体 | 一个「用户账号」 |
| Role | 权限标签，可以挂到用户或组上 | 一个「权限字符串」 |
| Group | 用户的分组 | 一个「部门/团队」 |
| Identity Provider | 外部身份源 | 「用 Google 登录」 |
| User Federation | 外部用户存储的桥梁 | 「用户数据在 LDAP，Keycloak 读取但不复制」 |
| Authentication Flow | 认证流程的定义 | 「登录时需要做哪些步骤」 |

## Keycloak 支持的协议

| 协议 | 用途 | Keycloak 实现 |
|------|------|-------------|
| **OpenID Connect** | 现代应用 SSO | REST API + JWT Token |
| **OAuth 2.0** | 授权/API 安全 | 四种 Grant Type |
| **SAML 2.0** | 企业应用 SSO | 完整 SAML SP + IdP |
| **LDAP/LDAPS** | 目录服务同步 | User Federation |
| **Kerberos** | 内网 SSO | Kerberos Bridge |
| **SCIM** | 用户自动配置 | [SCIM API 端点与离职验证]({{< relref "../protocols/scim-protocol.md" >}}) |

## Keycloak 典型使用场景

### 场景 1：Web 应用 SSO

```
用户浏览器 → 访问 App A → 重定向到 Keycloak 登录 → 认证成功 → 回到 App A
                                                           ↓
                  访问 App B → 自动登录（已有 Keycloak Session）
```

### 场景 2：API 安全

```
App → POST /token (client_credentials) → Keycloak → JWT Access Token
App → GET /api/data (Authorization: Bearer <token>) → API 验证 JWT
```

### 场景 3：对接企业 AD/LDAP

```
Keycloak ──(LDAPS)──→ 企业 AD
   ↓
   └→ 用户仍然在 AD 中管理
   └→ Keycloak 作为 OIDC/SAML 桥梁暴露给新应用
```

详见 [Keycloak LDAP / AD 用户联邦]({{< relref "../solution-blogs/keycloak-ldap-ad-federation" >}})。

### 场景 4：多租户 SaaS 平台

```
Keycloak
├── Tenant A Realm（客户 A 的用户和权限）
├── Tenant B Realm（客户 B 的用户和权限）
└── Tenant C Realm（客户 C 的用户和权限）
```

每个租户完全隔离，独立主题化。详见 [Keycloak 多租户实践]({{< relref "../advanced-topics/multi-tenant-iam" >}})。

## Keycloak 版本选择

| 版本 | 状态 | 建议 |
|------|------|------|
| Keycloak 26.7.2 | 官方发布页当前可见的 26.7 补丁版本（2026-08-19 发布，含账户接管等关键 CVE 修复） | 新项目优先在目标拓扑上验证后采用；生产环境应尽快升级 |
| Keycloak 26.x 的其他维护版本 | 需按具体补丁版本核对支持状态 | 已有项目不要只因小版本号变化就盲目升级，先读升级说明 |
| Keycloak 25.x 及更早 | 不应作为新项目基线 | 规划升级并在测试环境验证兼容性 |

> **版本判断边界**：截至 2026-08-19，Keycloak 官方 GitHub Release 页面可见的最新发布标签为 `26.7.2`。版本会继续变化，生产升级前应重新核对 [官方发布页](https://github.com/keycloak/keycloak/releases)、[升级指南](https://www.keycloak.org/docs/latest/upgrading/index.html) 和 [反向代理配置](https://www.keycloak.org/server/reverseproxy)。升级仍需结合数据库迁移、自定义 SPI、反向代理和扩展兼容性验证；“最新”不是回滚方案。详见 [Keycloak 26.7 更新速览]({{< relref "../solution-blogs/keycloak-26-7-whats-new" >}})。

## Keycloak 常见问题

### Q1：Keycloak 适合多大体量的用户？

Keycloak 没有脱离部署拓扑、认证峰值、数据库、缓存和令牌策略的通用“用户数 / req/s”承诺。总用户数也不能替代容量证据：登录风暴、管理 API、令牌刷新、外部 User Federation 和数据库连接池可能分别成为瓶颈。生产评估至少应在目标版本和目标配置上测量认证峰值、P95/P99 延迟、数据库连接、缓存行为，并演练节点和数据库故障。

因此，单实例还是集群不应按“10 万用户”这类固定数字切换：单实例只有在峰值压测和故障目标都满足时才成立；需要节点级故障切换、升级期间保持服务或更高峰值时，再按 Keycloak 当前版本的高可用和缓存文档设计集群。详见 [Keycloak 高可用部署]({{< relref "../solution-blogs/keycloak-ha-dr" >}})。

> 🗺️ **部署导航**：如果你是第一次部署 Keycloak 到生产环境，建议先看 [Keycloak 生产环境完整部署路线图]({{< relref "../solution-blogs/keycloak-production-roadmap" >}})——从部署方式选型到安全加固的八步全景指南。

### Q2：Keycloak 能替代 Okta / Auth0 吗？

能，但不是完全对等的替代：
- ✅ **功能覆盖**：SSO、MFA、用户管理、社交登录——Keycloak 全部覆盖
- ✅ **协议标准**：完全兼容 OIDC/OAuth/SAML，应用不需要改
- ⚠️ **运维差异**：Okta 免运维，Keycloak 需要自己管。算上人力成本后，小体量（< 500 用户）用 Okta 可能更便宜
- ⚠️ **生态**：Okta Integration Network 有 7000+ 预置连接器，Keycloak 需要自己配置

### Q3：Keycloak 和 Casdoor 怎么选？

| 选 Keycloak | 选 Casdoor |
|------------|-----------|
| 需要完整 IAM 能力 | 只需要轻量 SSO |
| 用户量大（10 万+） | 中小规模 |
| 有 Java/运维团队 | 有 Go/简单运维需求 |
| 需要 SAML | 主要 OIDC/OAuth |
| 企业合规要求高 | 创业/中小企业 |

详见 [Keycloak vs Casdoor 深度对比]({{< relref "../implementation/casdoor-deep-dive#keycloak-vs-casdoor" >}})。

### Q4：Keycloak 的学习曲线陡吗？

坦率说：**有一定学习曲线**。但这是 IAM 本身的复杂度，不是 Keycloak 独有的。任何 IAM 平台（Okta、Auth0、Keycloak）都需要理解 Realm、Client、Identity Provider、MFA 这些概念。学会 Keycloak = 学会通用 IAM 概念，迁移到其他平台只需学不同的 UI 和 API。
