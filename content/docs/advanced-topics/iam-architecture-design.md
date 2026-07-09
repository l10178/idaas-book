---
title: "IAM 架构设计指南 — 从单体到零信任的演进 | IDaaS Book"
description: "企业 IAM 架构设计完整指南：中心化、联邦、去中心化三种架构模式 Mermaid 图解对比，多租户 IAM 架构方案，高可用部署设计，含架构选型决策树与常见误区 FAQ"
date: 2026-07-09T00:00:00+08:00
draft: false
weight: 56
menu:
  docs:
    parent: "advanced-topics"
    identifier: "iam-architecture-design"
toc: true
---

## IAM 架构的核心问题

设计一个 IAM 系统架构，本质上是在回答三个问题：

1. **身份数据放在哪？**——集中存储还是分布在各处？
2. **谁来做认证决策？**——单一权威源还是多点自治？
3. **如何应对规模和故障？**——垂直扩展、水平扩展还是多活？

这三个问题的答案，决定了 IAM 架构的形态。下面从经典到现代，逐一解析。

## 三种经典 IAM 架构模式

### 中心化 IAM 架构

所有身份数据和认证逻辑集中在一个中心节点，所有应用统一对接这个中心。

```mermaid
graph TB
    subgraph "应用层"
        A1[Web 应用]
        A2[移动 App]
        A3[API 网关]
        A4[内部系统]
    end

    subgraph "中心 IAM 层"
        IAM[IAM Server<br/>认证 + 授权 + 审计]
        LDAP[(LDAP / DB<br/>身份存储)]
    end

    A1 --> IAM
    A2 --> IAM
    A3 --> IAM
    A4 --> IAM
    IAM --> LDAP

    style IAM fill:#f9f,stroke:#333,stroke-width:2px
    style LDAP fill:#bbf,stroke:#333
```

**优点**：
- 策略统一，一处管控所有访问
- 审计完整，所有认证事件集中在一条日志流
- 接入简单，应用只需对接一个端点

**缺点**：
- 单点故障——IAM 挂了，所有应用都无法登录
- 性能瓶颈——所有认证请求都打到同一个服务
- 组织边界受限——跨公司、跨域的身份联合需要额外机制

**适用场景**：单一组织、应用数量 < 50、用户规模 < 10 万的中小型企业。

### 联邦 IAM 架构

多个身份域通过信任关系互联，每个域维护自己的身份数据，跨域访问通过标准协议（SAML、OIDC）完成。

```mermaid
graph TB
    subgraph "公司 A"
        IdPA[IdP-A<br/>员工身份]
        AppA[应用 A]
        IdPA --> AppA
    end

    subgraph "公司 B"
        IdPB[IdP-B<br/>合作伙伴身份]
        AppB[应用 B]
        IdPB --> AppB
    end

    subgraph "SaaS 平台"
        SaaS[SaaS IdP]
        SaaSApp[SaaS 应用]
        SaaS --> SaaSApp
    end

    IdPA -.->|SAML/OIDC 信任| IdPB
    IdPA -.->|SAML/OIDC 信任| SaaS
    IdPB -.->|SAML/OIDC 信任| SaaS

    style IdPA fill:#f9f,stroke:#333,stroke-width:2px
    style IdPB fill:#f96,stroke:#333,stroke-width:2px
    style SaaS fill:#9cf,stroke:#333,stroke-width:2px
```

**优点**：
- 消除身份孤岛——用户用自己公司的账号登录合作方的应用
- 减少密码疲劳——不需要为每个外部系统单独注册
- 各域自治——每个组织控制自己的身份策略

**缺点**：
- 信任管理复杂——每增加一个联邦伙伴都要配置证书、metadata、属性映射
- 协议兼容性——SAML 和 OIDC 的互操作有坑（NameID 格式、属性声明方式不同）
- 故障影响面扩大——一个 IdP 出问题可能连锁影响多个下游

**常见拓扑**：

| 拓扑 | 描述 | 适用场景 |
|------|------|---------|
| Hub-and-Spoke | 所有 SP 对接中心 Hub IdP，Hub 再对接外部 IdP | 企业有多条业务线但希望统一管理 |
| 网状联邦 | 每对 IdP 之间独立建立信任 | 组织数量少（3-5 个），关系简单 |
| 链式联邦 | A 信任 B，B 信任 C，形成信任链 | 供应链场景，不推荐（故障传播链长） |

### 去中心化 IAM 架构（DID/VC）

用户自己持有身份凭证（Verifiable Credential），不依赖任何中心化的身份提供者。这是 IAM 的未来方向，依赖 W3C DID 标准和可验证凭证（VC）技术。

```mermaid
graph LR
    subgraph "用户"
        Wallet[数字钱包<br/>持有 VC]
    end

    subgraph "发证方"
        Issuer[大学/政府/雇主<br/>签发 VC]
    end

    subgraph "验证方"
        Verifier[应用/服务<br/>验证 VC]
    end

    subgraph "信任层"
        Registry[(可验证数据注册表<br/>区块链/分布式账本)]
    end

    Issuer -->|签发 VC| Wallet
    Wallet -->|出示 VC| Verifier
    Verifier -->|查询公钥/状态| Registry
    Issuer -->|注册 DID/公钥| Registry

    style Wallet fill:#f9f,stroke:#333,stroke-width:2px
    style Registry fill:#ddd,stroke:#333
```

**优点**：
- 用户自主权——身份数据由用户控制，不是服务商控制
- 无单点故障——没有中心 IdP 可以宕掉
- 隐私保护——选择性披露（只出示"已满 18 岁"，不出示出生日期）

**缺点**：
- 基础设施不成熟——DID 方法、钱包互操作性仍在演进
- 合规挑战——GDPR"被遗忘权"与不可篡改的账本如何调和仍在讨论
- 用户体验——密钥管理和恢复对普通用户仍有门槛

**现阶段定位**：不适合作为企业 IAM 的主架构，但在特定场景（教育证书、供应链溯源、员工技能认证）已有落地案例。

## 现代 IAM 架构模式

### 多租户 SaaS IAM 架构

一个 IAM 实例服务多个租户（组织），每个租户的数据和配置完全隔离。

```mermaid
graph TB
    subgraph "租户 A"
        UsersA[用户/组/角色]
        AppsA[应用/客户端]
        PoliciesA[认证策略]
    end

    subgraph "租户 B"
        UsersB[用户/组/角色]
        AppsB[应用/客户端]
        PoliciesB[认证策略]
    end

    subgraph "IAM 平台"
        Gateway[API 网关<br/>租户路由]
        AuthN[认证服务]
        AuthZ[授权服务]
        Audit[审计服务]
    end

    subgraph "存储层"
        DB_A[(租户 A 数据库)]
        DB_B[(租户 B 数据库)]
        Shared[(共享配置)]
    end

    UsersA -.-> Gateway
    UsersB -.-> Gateway
    Gateway --> AuthN --> AuthZ --> Audit
    AuthN --> DB_A
    AuthN --> DB_B
    AuthZ --> DB_A
    Audit --> Shared

    style Gateway fill:#f9f,stroke:#333,stroke-width:2px
```

**三种隔离方案对比**：

| 方案 | 实现方式 | 隔离强度 | 成本 | 代表 |
|------|---------|---------|------|------|
| 独立实例 | 每个租户一套完整 IAM 部署 | ★★★★★ | 高 | Keycloak 多实例 |
| 共享实例 + 逻辑隔离 | 同一实例，通过 Realm/Organization 隔离 | ★★★★☆ | 中 | Keycloak Realm、Zitadel Organization |
| 共享实例 + 字段隔离 | 所有租户在同一张表，tenant_id 区分 | ★★★☆☆ | 低 | 自研方案 |

**选择建议**：
- 租户数 < 50 且安全要求一般 → 共享实例 + 逻辑隔离（推荐 Keycloak Realm 模式）
- 租户数 > 50 但每个租户用户量小 → 共享实例 + 逻辑隔离 + 水平扩展
- 每个租户要求独立合规/等保 → 独立实例
- SaaS 产品卖的是 IAM 能力本身 → 建议 Zitadel（原生多租户）或自研

### 零信任 IAM 架构

零信任的核心原则是"永不信任，始终验证"。IAM 在零信任中承担持续认证和动态授权的角色。关于零信任的完整论述见[第24章]({{< relref "docs/advanced-topics/zero-trust-identity.md" >}})，这里聚焦 IAM 架构如何在零信任中落地。

```mermaid
graph TB
    User[用户 + 设备] --> PEP[策略执行点<br/>PEP<br/>反向代理/API 网关]
    PEP --> App[应用/资源]

    PEP --> PDP[策略决策点<br/>PDP<br/>策略引擎]
    PDP --> PIP[策略信息点<br/>PIP<br/>身份/设备/威胁情报]
    PDP --> Policy[(策略库)]

    PIP --> IDP[IAM / IdP<br/>用户身份 + 设备状态]
    PIP --> MDM[MDM / 设备合规]
    PIP --> TI[威胁情报]

    Audit[(审计日志)] --> SIEM[SIEM / 安全分析]
    SIEM -.->|风险信号反馈| PDP

    style PEP fill:#f9f,stroke:#333,stroke-width:2px
    style PDP fill:#f96,stroke:#333,stroke-width:2px
    style IDP fill:#9cf,stroke:#333
```

在这个架构中，IAM 系统承担的角色从"登录时验证一次"变为"每次访问都提供身份上下文"——这就是 **持续验证（Continuous Verification）**。Keycloak 这类 IAM 通过 Token introspection endpoint 和实时会话状态为 PDP 提供决策依据。

### 混合云 IAM 架构

企业同时有本地数据中心和公有云上的应用，需要一个 IAM 架构同时覆盖两边。

```mermaid
graph TB
    subgraph "本地数据中心"
        OnPremApp[本地应用]
        OnPremIdP[本地 IdP<br/>Keycloak / AD FS]
        LDAP[(AD / LDAP)]
        OnPremIdP --> LDAP
        OnPremApp --> OnPremIdP
    end

    subgraph "公有云"
        CloudApp[云上应用]
        CloudIdP[云 IdP<br/>Entra ID / Okta]
    end

    subgraph "同步与联邦"
        Sync[身份同步<br/>SCIM / AD Connect]
        Fed[身份联邦<br/>SAML / OIDC]
    end

    LDAP --> Sync --> CloudIdP
    OnPremIdP --> Fed --> CloudIdP
    CloudApp --> CloudIdP

    style OnPremIdP fill:#f9f,stroke:#333,stroke-width:2px
    style CloudIdP fill:#9cf,stroke:#333,stroke-width:2px
    style Sync fill:#ddd,stroke:#333
    style Fed fill:#ddd,stroke:#333
```

**关键设计决策**：

| 决策点 | 选项 A | 选项 B |
|-------|--------|--------|
| 身份权威源 | 本地 AD 为主，同步到云 | 云 IdP 为主，本地为辅 |
| 认证锚点 | 本地 IdP，云 IdP 做代理 | 云 IdP，本地做直通认证 |
| 用户同步方向 | 本地 → 云（单向） | 双向同步 |
| 应用注册 | 各自注册 | 统一在云 IdP 注册 |

**推荐模式**：本地 AD 作为权威源 → SCIM/AD Connect 同步到云 IdP → 云 IdP 通过 OIDC/SAML 联邦回本地 IdP 做直通认证。这种"同步+直通"组合兼顾了云端应用的便利性和本地密码策略的控制力。

## 架构选型决策树

当你面对一个新的 IAM 项目，以下决策树可以帮你快速收敛到合适的架构：

```mermaid
graph TD
    Start[开始选型] --> Q1{用户来源?}

    Q1 -->|单一组织内部| Q2{应用数量?}
    Q1 -->|多个组织/合作伙伴| Fed[联邦 IAM 架构<br/>SAML/OIDC 联邦]

    Q2 -->|< 50 个应用| Q3{用户规模?}
    Q2 -->|> 50 个应用| Q4{是否需要<br/>多租户?}

    Q3 -->|< 10 万用户| Central[中心化 IAM<br/>单实例 Keycloak/CAS]
    Q3 -->|> 10 万用户| HA[中心化 + 高可用<br/>多节点集群]

    Q4 -->|是 SaaS 产品| MT[多租户 IAM<br/>Keycloak Realm<br/>或 Zitadel]
    Q4 -->|不是 SaaS| Hybrid[混合架构<br/>中心化 + 联邦]

    Fed --> FQ{组织数量?}
    FQ -->|< 5 个| Mesh[网状联邦]
    FQ -->|> 5 个| Hub[Hub-and-Spoke<br/>中心 Hub IdP]

    style Central fill:#9f9,stroke:#333
    style HA fill:#9f9,stroke:#333
    style MT fill:#9cf,stroke:#333
    style Hybrid fill:#f96,stroke:#333
    style Mesh fill:#f9f,stroke:#333
    style Hub fill:#f9f,stroke:#333
```

这个决策树是简化的起点，实际选型还需要考虑：团队技能栈（Java 还是 Go？）、合规要求（等保、SOC2）、预算（开源自建还是商业 SaaS）、以及是否有特殊的认证流程需求。

## 高可用 IAM 架构设计要点

IAM 是高可用要求最高的基础设施之一——如果 IAM 挂了，所有应用都无法登录。高可用设计需要考虑三个层面：

### 1. 应用层高可用

- **多节点部署**：至少 2 个 IAM 节点，分布在不同的物理机或可用区
- **负载均衡**：前面挂 LB（Nginx/HAProxy/云 LB），使用 IP Hash 或 Sticky Session
- **健康检查**：监控 `/health/ready` 端点，自动摘除故障节点

### 2. 会话层高可用

- **外部会话存储**：不要用内存存储会话（节点挂了会话就丢了）。使用 Redis/Infinispan 做分布式会话缓存
- **会话复制**：如果必须用 Infinispan 嵌入式模式，配置跨节点会话复制（但性能开销大，推荐外部 Redis）
- **令牌无状态化**：使用自包含的 JWT，资源服务器可独立验证，不依赖 IdP 在线

### 3. 数据层高可用

- **数据库主从/集群**：PostgreSQL 流复制、MySQL Group Replication
- **定期备份**：每天全量备份 + 持续 WAL 归档，异地存储
- **灾难恢复演练**：每季度一次从备份恢复的演练

关于 Keycloak 高可用的具体配置和排错，参见 [Keycloak 高可用集群与容灾恢复指南]({{< relref "docs/solution-blogs/keycloak-ha-dr.md" >}})。

## 常见误区

**误区 1："IAM 架构设计就是选一个产品装上"**

实际上，IAM 架构是在回答"身份的权威源在哪、认证链路怎么走、故障怎么降级"。产品是实现架构的工具，不是架构本身。先想清楚架构，再选产品。

**误区 2："中心化 IAM 就是落后架构"**

在某些场景下，中心化 IAM 仍然是最合理的选择。小型组织用一个 Keycloak 实例就能满足所有需求，引入联邦或多租户反而增加不必要的复杂度。架构选型没有"先进/落后"，只有"合适/不合适"。

**误区 3："上了多活就万事大吉"**

多活（Active-Active）IAM 的难点不在部署，而在数据同步冲突。用户同时在两个数据中心修改密码、加入不同的组，冲突如何解决？大多数情况下，Active-Passive 加快速故障切换比 Active-Active 更务实。

**误区 4："微服务化 IAM 一定更好"**

将 IAM 拆成认证服务、授权服务、用户管理服务、审计服务听起来很合理，但带来了分布式事务、跨服务调用延迟、运维复杂度等问题。Ory 体系就是这种架构——灵活但运维成本高。除非团队有极强的微服务运维能力，否则单体 IAM（如 Keycloak）是更务实的选择。

## IAM 架构 FAQ

### Q1: IAM 架构设计中，认证和授权应该放在同一个服务还是分开？

**分开更好。** 认证（"你是谁"）和授权（"你能做什么"）是两个不同的关注点。实际架构中通常的做法是：
- 认证由 IdP（Keycloak/Dex/CAS）负责，返回 ID Token 或断言
- 授权策略由专门的策略引擎（OPA/Open Policy Agent）或在应用侧实现
- 认证服务和授权服务通过标准协议（OAuth 2.0 Token Introspection）解耦

分开的好处是：更换 IdP 时不影响授权逻辑，反之亦然。

### Q2: 多租户 IAM 用独立 Realm 还是共享 Realm + 属性过滤？

| 维度 | 独立 Realm | 共享 Realm |
|------|-----------|-----------|
| 隔离强度 | 强（数据、配置、会话完全隔离） | 弱（依赖字段过滤） |
| 运维成本 | 高（N 个 Realm = N 个配置管理） | 低（一处配置） |
| 性能 | 好（每个 Realm 独立缓存） | 有瓶颈（共享缓存和数据库表） |
| 适用 | 租户数 < 20，每个租户安全要求高 | 租户数 > 50，每个租户用户量小 |

**推荐**：先评估租户数量和安全隔离要求。如果每个租户有不同的合规要求（等保、SOC2），独立 Realm 是必须的；如果是轻量 SaaS 场景，共享 Realm 加逻辑隔离更经济。

### Q3: 从传统 AD/LDAP 架构迁移到现代 IAM 架构，最关键的三步是什么？

1. **先同步再切换**：用 SCIM 或同步工具把 AD 用户同步到新 IAM，保持双写一段时间
2. **按应用分批迁移**：不是一次性切所有应用，而是按"影响面小→大"的顺序，每切一个应用验证一个
3. **保留回退路径**：在新 IAM 中配置 AD 作为 User Federation 源（Keycloak 支持），切换失败时能快速退回 AD 直连认证

### Q4: IAM 架构中的"会话管理"多重要？

至关重要，但经常被忽视。会话管理决定了：
- 用户的登录体验（是否频繁要求重新登录）
- 安全事件响应速度（能否立即踢掉被入侵的会话）
- 高可用的难度（会话存在内存里还是 Redis 里）

一个合理的会话策略：短期访问令牌（Access Token 5-15 分钟）+ 长期刷新令牌（Refresh Token 8-24 小时）+ 服务端会话吊销能力（Token Introspection 或黑名单）。

## 小结

IAM 架构设计不是一次性决策。组织在成长，应用在增加，安全要求在变化——IAM 架构需要跟着演进。从中心化到联邦，从单体到多租户，每一步都是对"身份数据归谁管、认证决策谁来做、故障来了怎么办"这三个问题的重新回答。

选架构时记住：简单够用 > 超前设计。一个维护良好的单实例 Keycloak，比一个没人能调通的微服务 IAM 栈有价值得多。

> **架构选好了，协议怎么选？** 协议和架构是 IAM 的两个决策维度——协议决定"用什么语言"传递身份信息，架构决定"用什么结构"组织身份系统。继续阅读 [IAM 协议选型指南]({{< relref "docs/advanced-topics/iam-protocol-selection-guide.md" >}})，用决策树确定 OAuth 2.0、OIDC、SAML、LDAP、SCIM 在你架构中的角色。
