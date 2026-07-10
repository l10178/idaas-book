---
title: "第17章：IDaaS 方案全景对比 — Keycloak vs CAS vs Dex 选型决策框架 | IDaaS Book"
description: "主流 IDaaS 方案全景对比：开源 vs 商业，自建 vs SaaS，Keycloak、Janssen、Casdoor、Zitadel、Authelia、ORY、Pomerium、Dex、CAS 及商业方案选型决策框架"
date: 2024-04-04T00:00:00+08:00
draft: false
weight: 44
menu:
  docs:
    parent: "implementation"
    identifier: "other-idaas-solutions"
toc: true
---

## 17.1 IDaaS 市场格局

当前 IDaaS 市场可分为以下几个阵营：

```
               │ 云原生产品
    Okta       │  Auth0 (Okta)    自建/私有化
    Entra ID   │  Ping Identity   Keycloak
    Google CI  │  ForgeRock       Janssen
    腾讯云IDaaS│  JumpCloud        Casdoor
               │

    商业 SaaS ←──────────────→ 开源自建
         (快)                    (可控)
```

> 注：ForgeRock 已于 2023 年被 Ping Identity 收购，二者现同属一家；Microsoft 已将 Azure AD 更名为 Entra ID。

## 17.2 开源方案对比

### Keycloak

**类型**：完整 IAM / IDaaS 平台
**语言**：Java (Quarkus)
**许可证**：Apache 2.0

**核心优势**：
- 功能最全面的开源 IAM
- Red Hat 背书，社区活跃、长期演进
- 丰富的协议支持（OIDC、SAML 2.0、OAuth 2.0）
- 活跃的社区和生态
- SPI 机制支持深度定制
- 文档相对完善

**不足**：
- 学习曲线较陡
- 版本升级可能需要适配
- 中文体验不够好（界面翻译生硬）
- 性能调优需要经验

### Casdoor

**类型**：轻量级 IAM / SSO
**语言**：Go + React
**许可证**：Apache 2.0
**最新稳定版**：v3.108.0（2026 年 7 月）

**核心优势**：
- 部署极简（单二进制文件）
- UI 现代、用户体验好
- 原生支持多种语言（包括中文）
- 支持 OAuth 2.0、OIDC、SAML、CAS、LDAP、SCIM、WebAuthn/Passkeys
- 内置 Casbin 作为授权引擎，与 Casdoor 同源
- 2025-2026 新增 MCP Gateway 和 A2A 协议支持（AI-First）
- 活跃的中国社区

**不足**：
- 功能不如 Keycloak 全面
- 生态和插件较少
- 大规模场景的验证不足
- 企业级特性待完善

> 📖 详见：[Casdoor 深度解读 — 架构、部署与 Keycloak 对比选型]({{< relref "docs/implementation/casdoor-deep-dive" >}})

### Janssen（原 Gluu Server）

**类型**：企业级 IAM
**语言**：Java
**许可证**：Apache 2.0
**最新稳定版**：v2.2.0（2026 年 7 月）

Janssen 是 Linux Foundation 旗下的开源数字身份基础设施项目，2020 年由 Gluu Server 4.x 社区版 fork 而来。Gluu 团队是主要贡献者，商业发行版为 Gluu Flex。

**核心优势**：
- 完整的 OAuth/OIDC 授权服务器（OpenID 认证），支持 SCIM、FIDO2/Passkey
- Helm Chart 支持 Kubernetes 部署，也支持单机 VM 安装
- Agama 认证流程 DSL，可编程定制认证流程
- Linux Foundation 治理，社区透明

**不足**：
- 部署和运维复杂（对 Kubernetes 经验有要求）
- 社区规模小于 Keycloak
- 中文文档和社区资源有限

### Authelia

**类型**：专注于 SSO + MFA 的反向代理伴侣
**语言**：Go
**许可证**：Apache 2.0

**核心优势**：
- 与 Nginx/Traefik/HAProxy 深度集成
- 配置简单（YAML）
- 轻量级（适合家庭实验室、小微环境）

**不足**：
- 不是完整的 IAM，更像认证网关
- 用户管理功能有限
- 不支持 SAML
- 不适合大规模多应用场景

### Zitadel

**类型**：云原生 IAM
**语言**：Go（后端）+ TypeScript/Angular（前端）
**许可证**：AGPL-3.0
**最新稳定版**：v4.15.3（2026 年 6 月）

**核心优势**：
- 事件溯源 + CQRS 架构，完整的审计追踪，天然适合合规场景
- 原生三层多租户模型（Instance/Organization/Project），SaaS 友好
- API 优先设计（REST + gRPC），FIDO2/Passkeys 原生支持
- Go 单二进制部署，资源占用低

**不足**：
- AGPL-3.0 许可证对商业 SaaS 有约束
- 社区成熟度和中文资源远不及 Keycloak
- CQRS/事件溯源增加运维复杂度

> 📖 详见：[Zitadel 深度解读 — 事件驱动、多租户原生的开源 IAM 平台]({{< relref "docs/implementation/zitadel-deep-dive" >}})

### Logto

**类型**：CIAM（客户身份），面向 SaaS 和 AI 应用
**语言**：TypeScript (Node.js)
**许可证**：MPL-2.0

**核心优势**：
- Protocol-first 设计：OIDC、OAuth 2.1、SAML 即开即用，SDK 三步接入
- 多租户 Organization 从第一天就是一等公民，支持独立 SSO、RBAC 和品牌定制
- 30+ 框架官方 SDK（React、Next.js、Flutter、Go、Python 等）
- 内置可定制的登录 UI，支持 Social Login 和企业 SSO 连接器
- MCP（Model Context Protocol）原生支持，AI Agent 可直接调用身份能力
- Cloud + OSS 统一代码库，功能无阉割

**不足**：
- 不支持原生 LDAP 用户联邦（可通过 LDAP→OIDC 桥接方案接入）
- 社区规模和中文资源不及 Keycloak
- PostgreSQL 是唯一支持的数据库，无 Oracle/MySQL 官方支持
- 授权模型以 RBAC 为主，细粒度的 ABAC/ReBAC 支持有限

**适用场景**：B2B SaaS 平台的客户身份管理、AI Agent 应用的身份层、需要多租户 + 开箱即用登录 UI 的全栈产品。

> 📖 详见：[Logto 深度介绍 — 面向 SaaS 和 AI 应用的现代开源身份基础设施]({{< relref "docs/implementation/logto-deep-dive" >}})

### Authentik

**类型**：灵活的开源 IAM
**语言**：Python（Django）后端 + Go（outpost 代理）+ TypeScript 前端
**许可证**：MIT

**核心优势**：
- 可视化流程构建器（Flow），自定义认证流程门槛低
- 内置 LDAP Outpost / 反向代理 outpost，支持作为 SAML 2.0 / OIDC / OAuth2 / LDAP IdP
- 多租户、精细的 RBAC 与表达式策略

**不足**：
- 资源占用相对较高
- 社区与文档成熟度不及 Keycloak

> 关于 Authentik 的架构、Flow Builder、Outpost 代理机制以及生产部署实践，参见 [Authentik 开源 IAM 平台详解]({{< relref "docs/implementation/authentik-deep-dive.md" >}})。

### ORY 体系

**类型**：API-first 的组合式开源身份与授权栈
**语言**：Go
**许可证**：Apache 2.0

由四个独立微服务组成：`Kratos`（身份/注册/登录）、`Hydra`（OAuth2/OIDC Server）、`Oathkeeper`（反向代理/访问网关）、`Keto`（权限/ReBAC）。强调 API 优先、无内置 UI、按需组合，适合需要细粒度控制、与自研前端深度集成的团队；代价是上手与集成成本较高。详见 [Ory 开源身份栈深度解析]({{< relref "docs/implementation/ory-deep-dive" >}})。

### Pomerium

**类型**：企业级零信任身份感知代理
**语言**：Go（控制面）+ C++（Envoy 数据面）
**许可证**：Apache 2.0（开源版）

**核心优势**：
- 基于 Envoy 的高性能反向代理，原生支持零信任架构
- 声明式策略语言（PPL），路由级细粒度访问控制
- 原生多 IDP 支持，不同路由可使用不同 IDP
- 内置审计日志和会话管理
- 支持 JWT 断言注入，后端可验证请求来源

**不足**：
- 配置复杂度高于 oauth2-proxy，小团队快速上手有门槛
- 企业特性（设备信任、高级报告）需企业版
- 社区规模中等，中文资源有限

> 📖 详见：[Pomerium 深度介绍 — 企业级零信任身份感知代理]({{< relref "docs/implementation/pomerium-deep-dive" >}})

### SuperTokens

**类型**：开发者友好的用户认证与会话管理
**语言**：Java（Core）+ Node.js/Go/Python（Backend SDK）
**许可证**：核心开源（含商业许可）

**核心优势**：
- 极致的开发者体验：前端 SDK 提供 `<SignInAndUp />` 等开箱即用组件，后端 SDK 封装所有协议细节
- 三层架构（Frontend SDK → Backend SDK → Core），每层可独立替换
- 内置会话管理：Access + Refresh Token 自动刷新、防 CSRF/XSS、Token 撤销
- 多租户原生支持（v9.0+），适配 SaaS 场景
- 用户数据完全自控，最小供应商锁定

**不足**：
- 不是完整 IAM 平台，无 LDAP/AD 联邦、无 SAML 协议代理
- 不充当 OIDC Provider，无法对外提供 OIDC 能力
- 企业 SSO 等功能需商业许可
- 大规模企业生产验证案例少于 Keycloak

> 📖 详见：[SuperTokens 深度解读 — 开发者友好的开源用户认证]({{< relref "docs/implementation/supertokens-deep-dive" >}})

### Hanko

**类型**：Passkey-first 认证平台
**语言**：Go（后端）+ JavaScript/TypeScript（前端 SDK 与 Web Components）
**许可证**：AGPL-3.0（后端）/ MIT（客户端 SDK 与 Elements）

**核心优势**：
- Passkey/WebAuthn 优先设计，密码完全可选，可直接禁用
- `<hanko-auth>` Web Component 一行标签嵌入登录/注册全流程，自带 UI
- 轻量部署（Go 单服务 + PostgreSQL），Docker Compose 5 分钟起步
- Email Passcode 作为 Passkey 不可用时的降级，覆盖所有设备
- OAuth SSO（Google/Apple/GitHub）+ SAML Enterprise SSO
- 细化的前端 SDK 和框架示例（React、Vue、Angular）

**不足**：
- 不做 OIDC Provider，不对外签发 ID Token（应用通过 JWT + JWKS 验证集成）
- 不覆盖 LDAP/AD 联邦、SCIM 自动配置、细粒度 RBAC 授权
- 企业 IAM 能力（组织、角色、权限）仍在开发中（v2.7 阶段）
- 社区规模和中文资源有限

> 📖 详见：[Hanko 深度介绍 — Passkey-first 开源 IAM 认证方案]({{< relref "docs/implementation/hanko-deep-dive" >}})

## 17.3 商业方案概览

### Okta

IDaaS 品类的开创者和市场领导者。

**优势**：
- 最成熟的 IDaaS 产品
- OIN 集成目录含数千应用预置集成
- 强大的自适应 MFA
- 企业级 SLA（99.99%）
- Workflows（身份编排自动化）

**不足**：
- 价格高（每用户每月 $2-$15+）
- 数据驻留受 Okta 区域限制（支持多 region 部署，但需确认所选 region 满足合规要求）
- 供应商锁定风险

### Microsoft Entra ID（原 Azure AD）

紧随 Office 365/Microsoft 365 生态的 IDaaS。

**优势**：
- 与 Microsoft 生态深度集成
- 条件访问（Conditional Access）功能强大
- 庞大的企业用户基础
- 价格相对合理（部分包含在 M365 订阅中）

**不足**：
- 非 Microsoft 生态的集成相对弱
- 配置复杂度高（Portal 选项繁杂）
- 对开源标准支持历史不佳（在改善）

### Auth0（Okta 旗下）

面向开发者的 IDaaS。

**优势**：
- 开发者体验极佳
- 灵活的登录页面定制（Universal Login）
- 丰富的 SDK 和快速入门指南
- Actions（自定义代码扩展）

**不足**：
- 自被 Okta 收购后定价变化
- 数据驻留受 Okta 区域限制（支持多 region，需确认合规）
- 自定义程度有上限

### 中国 IDaaS 方案

国内主要的 IDaaS 服务商：
- **腾讯云 IDaaS**：依托企业微信生态
- **阿里云 IDaaS**：依托钉钉生态
- **华为云 OneAccess**：政企场景
- **竹云**：专注政企 IAM
- **芯盾时代**：零信任 + 身份安全

国内选型需要考虑：
- 信创/国产化要求
- 等保 2.0 合规
- 钉钉/企业微信/飞书的生态集成（详见 [Keycloak 集成企业微信/飞书/钉钉 IAM 方案]({{< relref "../solution-blogs/keycloak-wecom-feishu-dingtalk" >}})）
- 本地化服务和支持

## 17.4 选型决策框架

### 第一步：确定部署模式

```
你的数据主权要求是什么？
├─ 数据必须在中国境内，完全自主可控
│   └─ 自建 Keycloak / Casdoor / 国内IDaaS
│
├─ 数据可以在国内云上
│   └─ 腾讯云IDaaS / 阿里云IDaaS
│
└─ 数据主权无特殊要求
    └─ Okta / Auth0 / Azure AD
```

### 第二步：评估功能需求

```
需要的功能清单：
□ SSO（OIDC + SAML）
□ MFA（至少支持 TOTP）
□ 用户自助服务
□ 社交登录 / 外部 IdP 集成
□ LDAP/AD 联合
□ API 访问控制
□ RBAC 授权
□ 审计日志
□ SCIM 用户供应
□ 自定义认证流程
□ 多租户
□ 高可用部署
□ 自适应 MFA
□ 无密码认证
```

### 第三步：评估非功能需求

```
□ 预期用户规模：< 1K / 1K-10K / 10K-100K / >100K
□ 并发认证 TPS：< 100 / 100-1000 / >1000
□ 可用性要求：99.9% / 99.99% / 99.999%
□ 团队技能：Java / Go / 运维能力
□ 预算：开源自建 / 中小预算 / 企业预算
```

### 第四步：POC 验证

选择 2-3 个候选方案，进行概念验证：
1. 部署候选方案（≤ 1 天）
2. 集成 1-2 个关键应用
3. 测试核心流程（登录、SSO、MFA、登出）
4. 负载测试（模拟实际 TPS）
5. 评估运维友好度

## 17.5 迁移策略

从现有方案迁移到新 IDaaS 的关键步骤：

1. **用户导出**：从旧系统导出所有用户（含密码哈希格式）
2. **密码迁移**：使用"惰性迁移"——下次登录时自动在新系统重置密码
3. **应用切换**：分批切换应用，每批之间有验证期
4. **并行期**：新旧系统并行运行一段时间
5. **下线旧系统**：确认所有用户和事务迁移完毕

## 17.6 小结

IDaaS 选型没有"最佳"方案，只有"最合适"的方案。选型的关键是理清自己的需求：需要解决的问题是什么？团队的运营能力如何？数据有什么合规要求？不要追求功能最多的方案（你可能用不到），而要选择最适合你团队技能、业务规模和合规要求的方案。
