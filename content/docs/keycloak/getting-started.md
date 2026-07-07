---
title: "Keycloak 入门指南 — 安装、配置与首个 OIDC 应用接入 | IDaaS Book"
description: "Keycloak 开源 IAM/IDaaS 简介：SSO、社交登录、用户联合、标准协议适配、授权服务、密码策略与 MFA 等核心功能总览与选型参考"
date: 2024-04-01T00:00:00+08:00
lastmod: 2026-07-06T00:00:00+08:00
draft: false
weight: 1
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-getting-started"
toc: true
---

[keycloak][] 是一个开源的、面向现代应用和服务的 IAM（身份认证和访问控制）解决方案。

> 自 Keycloak 17 起，官方只发布 **Quarkus 发行版**，旧的 WildFly 发行版已被移除；各类语言专用的 **Client Adapter 也已陆续废弃**，官方推荐直接使用各生态的标准 OIDC/OAuth 2.0/SAML 库对接。Keycloak 版本迭代很快，本书编写时当前稳定版为 26.6.4（2026-07-06 检查），部署前请到 [keycloak.org/downloads](https://www.keycloak.org/downloads) 确认最新版本。关于 Keycloak 架构（Realm / Client / 认证流引擎 / 缓存 / 集群）的深度解析，见[第14章：Keycloak 架构深度解析]({{< relref "docs/implementation/keycloak-architecture.md" >}})。

主要功能：

- SSO  
  单点登录（Single-Sign On），支持 OpenID Connect、OAuth 2.0、SAML 2.0 标准协议。
- Identity Brokering and Social Login  
  通过配置，可实现对不同身份认证服务的集成，通过这些身份认证服务登录应用。如 GitHub、Google 等，开源社区也有人提供了微信集成方案。
- User Federation  
  用户联合，提供了对 LDAP、Active Directory、Kerberos 的集成方案。
- 标准协议适配  
  由于 Keycloak 严格实现 OIDC / OAuth 2.0 / SAML 2.0 标准，任何符合标准的库均可对接：Java 用 Spring Security / Quarkus OIDC，Go 用 `coreos/go-oidc`，Node.js 用 `openid-client` 等，无需依赖专用适配器。
- 后台管理  
  提供了管理控制台与账户控制台，可定制主题（见[主题定制]({{< relref "docs/keycloak/themes/index.md" >}})）。同时还有 CLI（`kcadm`/`kcreg`）、Admin REST API 与各语言 SDK。
- 授权服务  
  提供基于 RBAC、ABAC、UBAC 等多种策略的授权功能。
- 其他常用功能  
  密码策略、暴力检测、MFA/OTP、日志审计。

## 选型参考

为什么可能选他：

1. Red Hat 主导开源，质量可靠，一直在演进和更新。
2. 易开发易扩展，相对 CAS，尤其是对于 Java 开发者。
3. 功能丰富易用，如果只是要一个简单的 IAM，几乎是开箱即用。
4. 标准实现，易集成，大厂背书。Kubernetes、Grafana、Kibana、Rancher、Vault、Harbor、Jenkins、Activiti 等等天然支持。

为什么可能不选他：

1. 如果你有定制开发的话，版本升级并不友好，也不太难，因人而异。
2. 中文并不友好，包括界面中的中文翻译其实不符合国人习惯，这也是为啥有 IDaaS Book 这个项目。

### 名词解释

**IAM** Identity and Access Management，身份认证和访问控制。

**MFA** Multi-Factor Authentication，多重身份认证，多因子认证。

[keycloak]: https://www.keycloak.org
