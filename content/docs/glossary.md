---
title: "附录：术语表"
description: "IDaaS 核心术语速查表"
date: 2024-01-01T00:00:00+08:00
draft: false
weight: 99
menu:
  docs:
    parent: "docs"
    identifier: "glossary"
toc: true
---

## 协议与标准

| 术语 | 全称 | 说明 |
|-----|------|------|
| **OAuth 2.0** | Open Authorization 2.0 | 授权框架（RFC 6749），不是认证协议 |
| **OIDC** | OpenID Connect | 基于 OAuth 2.0 的身份认证协议 |
| **SAML 2.0** | Security Assertion Markup Language 2.0 | 基于 XML 的身份联邦协议 |
| **SCIM** | System for Cross-domain Identity Management | 跨域身份管理协议（RFC 7643/7644） |
| **JWT** | JSON Web Token | JSON 格式的安全令牌（RFC 7519） |
| **JWS** | JSON Web Signature | JWT 的签名规范 |
| **JWE** | JSON Web Encryption | JWT 的加密规范 |
| **LDAP** | Lightweight Directory Access Protocol | 轻量级目录访问协议 |
| **TLS** | Transport Layer Security | 传输层安全协议 |
| **mTLS** | Mutual TLS | 双向 TLS 认证 |
| **PKCE** | Proof Key for Code Exchange | OAuth 2.0 授权码增强（RFC 7636） |
| **DPoP** | Demonstrating Proof of Possession | Token 持有证明（RFC 9449） |
| **SLO** | Single Logout | 单点登出 |
| **FIDO2** | Fast IDentity Online 2 | 无密码认证标准 |
| **WebAuthn** | Web Authentication | W3C 的 Web 认证 API |
| **DID** | Decentralized Identifier | 去中心化标识符（W3C 标准） |
| **VC** | Verifiable Credential | 可验证凭证（W3C 标准） |

## 认证与授权

| 术语 | 全称 | 说明 |
|-----|------|------|
| **AuthN** | Authentication | 认证——"你是谁？" |
| **AuthZ** | Authorization | 授权——"你能做什么？" |
| **SSO** | Single Sign-On | 单点登录 |
| **MFA** | Multi-Factor Authentication | 多因素认证 |
| **2FA** | Two-Factor Authentication | 双因素认证 |
| **TOTP** | Time-based One-Time Password | 基于时间的一次性密码 |
| **HOTP** | HMAC-based One-Time Password | 基于计数的一次性密码 |
| **OTP** | One-Time Password | 一次性密码 |
| **AMR** | Authentication Methods Reference | 认证方法引用（OIDC Claim） |
| **ACR** | Authentication Context Class Reference | 认证强度级别引用（OIDC Claim） |
| **RBAC** | Role-Based Access Control | 基于角色的访问控制 |
| **ABAC** | Attribute-Based Access Control | 基于属性的访问控制 |
| **PBAC** | Policy-Based Access Control | 基于策略的访问控制 |
| **ReBAC** | Relationship-Based Access Control | 基于关系的访问控制 |
| **DAC** | Discretionary Access Control | 自主访问控制 |
| **MAC** | Mandatory Access Control | 强制访问控制 |
| **SoD** | Separation of Duties | 职责分离 |
| **PoLP** | Principle of Least Privilege | 最小权限原则 |
| **JIT** | Just-In-Time Access | 即时访问（临时提权） |

## 身份架构

| 术语 | 全称 | 说明 |
|-----|------|------|
| **IAM** | Identity and Access Management | 身份与访问管理 |
| **IDaaS** | Identity as a Service | 身份即服务 |
| **IdP** | Identity Provider | 身份提供方 |
| **SP** | Service Provider | 服务提供方（依赖 IdP 的应用） |
| **RP** | Relying Party | OIDC 中的依赖方（同 SP） |
| **OP** | OpenID Provider | OIDC 的身份提供方 |
| **CIAM** | Customer Identity and Access Management | 客户身份管理 |
| **IGA** | Identity Governance and Administration | 身份治理与管理 |
| **PAM** | Privileged Access Management | 特权访问管理 |
| **AM** | Access Management | 访问管理 |
| **DAG** | Directed Acyclic Graph | 有向无环图（认证流结构） |

## 令牌与会话

| 术语 | 全称 | 说明 |
|-----|------|------|
| **Access Token** | | 访问令牌，用于访问受保护资源 |
| **Refresh Token** | | 刷新令牌，用于获取新的 Access Token |
| **ID Token** | | OIDC 身份令牌（JWT 格式） |
| **TGT** | Ticket Granting Ticket | CAS/Kerberos 的票据授予票据 |
| **ST** | Service Ticket | CAS 的服务票据 |
| **Session** | | 会话，服务器端维护的用户登录状态 |

## 软件与产品

| 术语 | 说明 |
|-----|------|
| **Keycloak** | Red Hat 开源的 IAM/IDaaS 平台，CNCF 项目 |
| **CAS** | Apereo CAS，教育领域广泛使用的 SSO 服务器 |
| **Dex** | CoreOS 开发的轻量级 OIDC 身份代理 |
| **OpenLDAP** | 开源 LDAP 实现 |
| **AD** | Active Directory，微软目录服务 |
| **AD FS** | Active Directory Federation Services |
| **Okta** | 商业 IDaaS 领导者 |
| **Auth0** | 面向开发者的 IDaaS（已被 Okta 收购） |
| **Azure AD** | 微软的云身份服务（现 Microsoft Entra ID） |
| **OPA** | Open Policy Agent，CNCF 策略引擎 |
| **OpenFGA** | 开源 ReBAC 实现，CNCF Sandbox |
| **Zitadel** | 云原生开源 IAM |

## 安全概念

| 术语 | 说明 |
|-----|------|
| **零信任** | "永远不信任，始终验证"的安全架构 |
| **纵深防御** | 多层安全防御策略 |
| **威胁建模** | 系统性地识别和评估安全威胁 |
| **CSRF** | Cross-Site Request Forgery，跨站请求伪造 |
| **XSS** | Cross-Site Scripting，跨站脚本攻击 |
| **OWASP** | Open Web Application Security Project |
| **GDPR** | 欧盟通用数据保护条例 |
| **等保 2.0** | 中国网络安全等级保护 2.0 |
| **SOC 2** | 服务组织控制 2 报告（安全审计标准） |
| **ISO 27001** | 信息安全管理体系国际标准 |
