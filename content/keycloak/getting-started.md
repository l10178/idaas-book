---
title: 'Keycloak 简介'
date: 2020-09-26T18:54:37+08:00
draft: false
---

[keycloak][] 是一个开源的、面向现代应用和服务的 IAM（身份认证和访问控制）解决方案。

主要功能：

- SSO  
  单点登录（Single-Sign On），支持 OpenID Connect、OAuth 2.0、SAML 2.0 标准协议。
- Identity Brokering and Social Login  
  通过配置，可实现对不同身份认证服务的集成，通过这些身份认证服务登录应用。如 GitHub、Google 等，开源社区也有人提供了微信集成方案。
- User Federation  
  用户联合，提供了对 LDAP、Active Directory、Kerberos 的集成方案。
- Client Adapters  
   不同平台多种语言的支持，Java、Python、Go、Node.js、Spring、Quarkus 等。
- 后台管理  
  提供了多种语言的后台管理界面，如果想偷懒的话改改图标定制个主题就能拿来用。同时还有 CLI 、SDK 和 RESTful API。
- 授权服务  
  提供基于 RBAC、ABAC、UBAC 等多种策略的授权功能。
- 其他常用功能  
  密码策略、暴力检测、MFA、日志审计。

## 选型参考

为什么选他：

1. Redhat 开源，稳定质量可靠，一直在演进和更新。
2. 易开发易扩展，相对 CAS。
3. 功能丰富易用，如果只是要一个简单的 IAM，几乎是开箱即用。
4. 标准实现，易集成。Kubernetes、Grafana、Kibana、Rancher、Vault、Harbor、Jenkins 等等天然支持。

为什么不选他：

1. 没进 [CNCF](https://www.cncf.io/)，相比较而言 [Dex](https://dexidp.io) 的攻势很猛。

### 名词对应

**IAM** Identity and Access Management，身份认证和访问控制。

**MFA** Multi-Factor Authentication，多重身份认证，多因子认证。

[keycloak]: https://www.keycloak.org
