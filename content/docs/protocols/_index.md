---
title: "第二部分：协议与标准"
description: "IDaaS 核心协议深度解读：OAuth 2.0、OpenID Connect、SAML 2.0、LDAP、SCIM 与 DPoP 的设计原理与安全考量"
weight: 20
menu:
  docs:
    parent: "protocols"
    identifier: "protocols-index"
---

本部分是 IDaaS 的"语言基础"。OAuth 2.0、OpenID Connect、SAML 2.0、LDAP 和 SCIM 是身份世界的通用语言，[JWT（JSON Web Token）]({{< relref "jwt-deep-dive" >}}) 则是贯穿这些协议的核心令牌格式。DPoP（RFC 9449）为 OAuth Token 引入了 sender-constrained 安全机制。每个协议都有对应的安全分析：OAuth 攻击面（redirect_uri 劫持、CSRF、PKCE、Mix-Up、Token 泄露）和 SAML 攻击面（XSW、断言重放、XXE、元数据伪造）分别配有 Mermaid 攻击流程图和防护方案。理解这些协议不仅是看懂技术文档的前提，更是设计安全、可互操作的 IDaaS 系统的基石。

> **在做协议选型决策？** 先看 [IAM 协议选型指南]({{< relref "docs/advanced-topics/iam-protocol-selection-guide.md" >}})——它从 10 种典型场景出发，用决策树帮你确定该用哪个协议，再回来看本章的协议细节。
