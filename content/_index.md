---
title: "IDaaS 身份即服务 —— 一本完整的书"
description: "一本关于身份即服务的完整书籍"
lead: "从 IAM 基础原理到 OAuth 2.0、OIDC、SAML 协议深度解读，从 Keycloak、CAS、Dex 开源方案到生产环境部署，一本关于 IDaaS（身份即服务）的完整技术书籍。"
date: 2023-09-07T16:33:54+02:00
lastmod: 2024-05-05T00:00:00+08:00
draft: false
seo:
  title: "IDaaS Book —— 一本关于身份即服务的完整书籍"
  description: "IDaaS 身份即服务完整书籍：涵盖 IAM 基础、OAuth 2.0、OIDC、SAML 2.0、LDAP、SCIM 协议、Keycloak/CAS/Dex 开源方案、SSO/MFA/身份联邦、授权模型、Kubernetes 生产部署、零信任与去中心化身份"
  canonical: ""
  noindex: false
---

## 关于本书

这是一本系统性的关于 **IDaaS（Identity as a Service，身份即服务）** 的技术书籍。

本书从 IAM 的基础概念出发，深入到每一个核心协议（OAuth 2.0、OpenID Connect、SAML 2.0、LDAP、SCIM），讲解 IDaaS 平台的核心能力（SSO、MFA、身份联邦、审计合规），对比主流开源方案（Keycloak、CAS、Dex、Casdoor 等），并给出生产环境部署和集成的最佳实践。最后，我们还会探讨授权模型、零信任架构和去中心化身份等前沿话题。

**本书共 5 个部分、24 章，约 13 万字。** 适合 IDaaS 初学者、IAM 工程师、架构师以及任何对身份认证领域感兴趣的开发者阅读。

## 内容结构

### 第一部分：IDaaS 基础
- 第1章：什么是 IDaaS —— 定义、演进与核心价值
- 第2章：IAM 核心理念 —— AAA 模型、设计原则与架构
- 第3章：认证与授权深度辨析 —— AuthN vs AuthZ
- 第4章：身份生命周期管理 —— 从创建到注销的全流程

### 第二部分：协议与标准
- 第5章：OAuth 2.0 深度解读 —— 授权模式、Token 管理
- 第6章：OpenID Connect —— ID Token、UserInfo、发现机制
- 第7章：SAML 2.0 —— 断言、绑定、元数据与联邦
- 第8章：LDAP 与目录服务 —— Active Directory 集成
- 第9章：SCIM 协议 —— 标准化用户配置

### 第三部分：核心能力
- 第10章：单点登录（SSO）—— 架构模式与会话管理
- 第11章：多因素认证（MFA）—— TOTP、FIDO2、自适应认证
- 第12章：身份联邦与代理 —— 跨域身份互信
- 第13章：审计与合规 —— 等保、ISO 27001、异常检测

### 第四部分：实现与实践
- 第14章：Keycloak 架构深度解析
- 第15章：Apereo CAS —— 教育与企业 SSO
- 第16章：Dex 身份代理 —— Kubernetes 原生方案
- 第17章：IDaaS 方案全景对比 —— 选型决策框架
- 第18章：集成模式与实践 —— 网关、BFF、Sidecar
- 第19章：Kubernetes 生产环境部署

### 第五部分：高级主题
- 第20章：授权模型深度对比 —— RBAC、ABAC、ReBAC
- 第21章：IDaaS 安全最佳实践
- 第22章：性能与扩展性
- 第23章：去中心化身份与可验证凭证
- 第24章：零信任与身份驱动安全

### 附录
- 术语表 —— IDaaS 核心术语速查

## 开始阅读

点击左侧导航栏的"文档"，从第一部分开始系统阅读，或根据需求跳转到感兴趣的章节。

## 贡献

如果你发现了错误或有改进建议，欢迎到 [GitHub](https://github.com/l10178/idaas-book) 提交 Issue 或 Pull Request。

## License

本文档采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 许可协议。
