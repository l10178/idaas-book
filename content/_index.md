---
title: "IDaaS Book：企业身份与访问管理实战全书"
description: "面向架构师、安全团队与平台工程师的中文 IDaaS / IAM 系统手册。覆盖 OAuth 2.0、OIDC、SAML、Keycloak 生产部署、零信任与身份治理。"
lead: "从一次登录到零信任架构——系统掌握企业身份基础设施的设计、协议、工程落地与安全治理。全书 5 部分 24 章，约 13 万字，持续更新。"
date: 2023-09-07T16:33:54+02:00
lastmod: 2026-07-06T00:00:00+08:00
draft: false
seo:
  title: "IDaaS Book：企业身份与访问管理实战全书 | OAuth 2.0 · Keycloak · SSO · 零信任"
  description: "面向架构师与平台工程师的中文 IDaaS / IAM 系统手册。覆盖 OAuth 2.0、OpenID Connect、SAML、Keycloak 生产部署、RBAC/ABAC、零信任与身份治理。在线阅读，持续更新。"
  canonical: ""
  noindex: false
---

## 企业身份，不该每次都从头踩坑

几乎所有现代应用都绕不开身份认证与授权，但它从来不只是「接一个登录页」那么简单。

真正复杂的地方在于：**账号从哪里来、组织架构如何同步、权限边界如何治理、多个系统如何单点登录、审计合规如何落地，以及当业务规模增长后如何稳定运行。**

**《IDaaS Book》是当前最完整的中文企业身份（IAM）实战全书。** 它把协议原理、架构设计、产品选型、工程落地和安全治理串成一条主线——让做登录、权限、身份中台和零信任接入的团队，有一份可以随时翻阅的系统参考。

---

## 这本书能帮你解决什么

| 你遇到的问题 | 书中对应章节 |
|-------------|------------|
| OAuth 2.0 授权码、隐式、客户端凭证……到底用哪个？ | [OAuth 2.0 深度解读]({{< relref "docs/protocols/oauth2-deep-dive.md" >}}) — 四种模式 + 安全边界 |
| OIDC 和 OAuth 2.0 的区别是什么？ID Token 里有什么？ | [OpenID Connect]({{< relref "docs/protocols/openid-connect.md" >}}) — 认证层协议完整拆解 |
| SAML 还在用吗？和 OIDC 怎么选？ | [SAML 2.0]({{< relref "docs/protocols/saml2.md" >}}) + [方案对比]({{< relref "docs/implementation/other-idaas-solutions.md" >}}) |
| Keycloak 怎么在生产环境部署？Operator 还是 Helm？ | [Keycloak 架构]({{< relref "docs/keycloak/_index.md" >}}) + [K8s 生产部署]({{< relref "docs/implementation/kubernetes-production.md" >}}) |
| RBAC 够用吗？什么时候需要 ABAC 或 ReBAC？ | [授权模型深度对比]({{< relref "docs/advanced-topics/authorization-models.md" >}}) |
| 多租户 SaaS 怎么设计账号体系？ | [集成模式]({{< relref "docs/implementation/integration-patterns.md" >}}) + [身份生命周期]({{< relref "docs/fundamentals/identity-lifecycle.md" >}}) |
| 零信任到底是什么？怎么落地？ | [零信任与身份驱动安全]({{< relref "docs/advanced-topics/zero-trust-identity.md" >}}) |
| 等保 / ISO 27001 对身份系统有什么要求？ | [审计与合规]({{< relref "docs/core-capabilities/audit-and-compliance.md" >}}) |

---

## 全书结构

全书共 **5 部分 · 24 章 · 约 13 万字**，附术语速查表。

### 第一部分：IDaaS 基础（第 1–4 章）
什么是 IDaaS、IAM 核心理念（AAA 模型）、认证与授权深度辨析、身份生命周期管理。

### 第二部分：协议与标准（第 5–9 章）
OAuth 2.0/2.1、OpenID Connect、SAML 2.0、LDAP 与目录服务、SCIM 协议。**不止讲字段，更讲安全边界、常见误区和生产踩坑。**

### 第三部分：核心能力（第 10–13 章）
单点登录（SSO）、多因素认证（MFA / FIDO2 / Passkey）、身份联邦与代理、审计与合规。

### 第四部分：实现与实践（第 14–19 章）
Keycloak 架构剖析、Apereo CAS、Dex 身份代理、方案全景对比与选型框架、集成模式（网关/BFF/Sidecar）、Kubernetes 生产环境部署。

### 第五部分：高级主题（第 20–24 章）
授权模型深度对比（RBAC / ABAC / ReBAC）、安全最佳实践、性能扩展、去中心化身份（DID / VC）、零信任架构。

---

## 推荐阅读路线

| 目标 | 推荐路径 |
|------|----------|
| 🔰 快速建立体系 | [简介与阅读指南]({{< relref "docs/guides/introduction.md" >}}) → 第 1–4 章 → 第 5–9 章 |
| 🔗 做 SSO / 协议接入 | OAuth 2.0 → OpenID Connect → SAML 2.0 → SSO → 集成模式 |
| 🏗️ 做身份平台选型 | Keycloak 架构 → CAS / Dex → 方案对比 → Kubernetes 部署 |
| 🛡️ 做权限治理 | AuthN vs AuthZ → RBAC/ABAC/ReBAC → 审计与合规 |
| 🔐 做安全增强 | MFA → 安全最佳实践 → 零信任 |

---

## 开始阅读

- 📖 **系统阅读**：[完整文档目录]({{< relref "docs/_index.md" >}})
- 🎯 **按角色选读**：[简介与阅读指南]({{< relref "docs/guides/introduction.md" >}})
- ⚙️ **动手实践**：[Keycloak 实战指南]({{< relref "docs/keycloak/_index.md" >}})

---

## 这本书的特点

- 🧭 **体系完整**：从概念到协议、从能力到工程、从现状到趋势，一条主线贯穿。
- 🔬 **协议深读**：OAuth 2.0 / OIDC / SAML / SCIM 不止讲用法，更讲安全边界与常见误区。
- ⚙️ **工程落地**：Helm / Operator 部署、网关与 BFF 集成、高可用与监控，配套真实配置示例。
- 🧩 **方案对比**：横向对比主流开源 IDaaS，附选型决策框架。
- 🛡️ **前沿覆盖**：零信任、DID / VC、ReBAC、Passkey / WebAuthn 独立成章。

---

## 贡献与反馈

本书持续完善中。如果你发现技术错误、过时内容，或有真实落地案例想补充：

- 🐛 提交 [Issue](https://github.com/l10178/idaas-book/issues)
- ✨ 提交 [Pull Request](https://github.com/l10178/idaas-book/pulls)
- 💬 有想看的主题？在 Issue 中标记 `discussion`

如果这本书对你有帮助，欢迎 [⭐ Star](https://github.com/l10178/idaas-book) 支持，让更多需要的人看到它。

---

## License

内容：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用 4.0 国际）  
站点脚手架：沿用上游 [Doks](https://github.com/thuliteio/doks) 许可
