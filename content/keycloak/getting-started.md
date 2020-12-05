---
title: "Keycloak 简介"
date: 2020-09-26T18:54:37+08:00
draft: false
---

## Keycloak 简介

[keycloak][] 是一个开源的、面向现代应用和服务的身份认证和访问控制解决方案。

主要功能：

- SSO  
  单点登录/登出（Single-Sign On/Out）。
- Identity Brokering and Social Login  
  通过配置，可实现对不同身份认证服务的集成，通过这些身份认证服务登录应用。如 OIDC、GitHub、SAML 等等，开源社区也有人提供了微信集成方案。
- 用户联合：User Federation  
  提供了对 LDAP/AD 的集成方案。
- Client Adapters  
   不同平台多种语言的支持，支持标准的 OpenID Connect、 OAuth 2.0、 SAML 等。
- 后台管理  
  提供了后台管理界面，同时还有 CLI，和 RESTFul API 方式管理后台。如果想偷懒的话改改图标定制个主题就能拿来用。

## 选型参考

为什么选他：

1. Redhat 开源，稳定质量可靠，一直在演进和更新。
2. 易开发易扩展，相对 CAS。
3. 标准实现，易集成。Kubernetes、Grafana、Kibana、Rancher、Vault、Harbor 等天然支持。

为什么不选他：

1. 没进 [CNCF](https://www.cncf.io/)，相比较而言 [Dex](https://dexidp.io) 的攻势很猛。

## 名词对应

IAM: Identity and Access Management，身份认证和访问控制。

[keycloak]: https://www.keycloak.org
