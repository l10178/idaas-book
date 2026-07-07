---
title: "第10章：单点登录（SSO）— 架构模式、会话管理与跨域方案 | IDaaS Book"
description: "单点登录（SSO）完整指南：SSO 架构模式选型、会话管理策略、跨域方案对比、企业 SSO 落地实践和安全考量。涵盖 SAML SSO 与 OIDC SSO 两种主流实现路径。"
date: 2024-03-01T00:00:00+08:00
draft: false
weight: 31
menu:
  docs:
    parent: "core-capabilities"
    identifier: "sso-single-sign-on"
toc: true
---

## 10.1 SSO 的核心理念

单点登录（Single Sign-On, SSO）的核心承诺：**用户只需认证一次，即可访问所有被授权的应用。**

这不仅是用户体验的改善，更是安全性提升。原因很简单：

- 用户只需要记住一个强密码（而不是 N 个弱密码或同一个密码用 N 遍）
- 认证策略集中管理（强制 MFA、密码策略统一执行）
- 会话可以集中管理和吊销

## 10.2 SSO 的三种实现模式

### 模式一：中心化 SSO

所有用户和应用都注册在同一个中心 IAM 系统中。

```
         ┌─────────────────┐
         │   IAM/IDaaS      │
         │  (认证中心)       │
         └───┬───┬───┬─────┘
             │   │   │
      ┌──────┘   │   └──────┐
      ▼          ▼          ▼
   [App1]    [App2]     [App3]
```

实现方式：通常通过 OIDC 或 SAML 2.0。
代表：Keycloak 单域部署。

### 模式二：联邦 SSO（Federated SSO）

多个身份域之间建立信任关系：

```
         [IdP A] ←──信任──→ [IdP B]
            │                   │
      ┌─────┴──┐          ┌────┴──┐
    [App1] [App2]       [App3] [App4]
```

用户无论在哪个 IdP 认证，都能访问信任域中的任何应用。

实现方式：SAML Federation、OIDC Federation。
代表：教育领域的 Shibboleth 联邦、企业间的 Azure AD B2B。

### 模式三：身份代理（Identity Broker / IdP-Proxy）

用一个中心 IdP 作为"代理"，后端对接多个不同的身份源：

```
          ┌──────────────┐
          │  IdP Proxy   │
          │  (Keycloak)  │
          └─┬──┬──┬─────┘
            │  │  │
     ┌──────┘  │  └──────┐
     ▼         ▼         ▼
 [AD/LDAP] [GitHub] [Google]
```

用户可以使用不同的身份登录（域账号、GitHub 账号、Google 账号），但应用只需要对接一个 IdP。

## 10.3 SSO 的会话管理

### Cookie-Based Session（传统 Web SSO）

```
用户首次登录 App1：
1. 用户 → App1（未登录）
2. App1 重定向 → IdP
3. 用户在 IdP 认证，IdP 创建全局 SSO Session
4. IdP 重定向回 App1（携带 token）
5. App1 创建自己的本地 Session

用户随后访问 App2：
1. 用户 → App2（未登录）
2. App2 重定向 → IdP
3. IdP 看到已有的 SSO Session，直接确认身份
4. IdP 重定向回 App2（携带 token）
5. App2 创建自己的本地 Session

关键设计：
- IdP 有一个全局的 SSO Session（Cookie，建议设置 `HttpOnly; Secure; SameSite=Lax`，跨站点 SSO 场景下用 `SameSite=None; Secure`）
- 每个应用有自己的本地 Session
- 登出时需要同时清除应用本地 Session 和 IdP 的 SSO Session
```

### Token-Based Session（SPA / 移动端）

基于 Token 的 SSO 不依赖 Cookie：

- 用户认证后获得 Access Token 和 Refresh Token
- 将 Token 安全地存储在客户端（移动端的 Keychain/Keystore，Web 端的 BFF）
- 多个应用可以共享同一个 IdP 签发的 Token

## 10.4 单点登出（Single Logout, SLO）

SSO 的"另一面"：如何处理登出？

### 理想模式

用户在一个应用中登出 → IdP 通知所有已登录的应用 → 全部清除会话。

### 现实挑战

并非所有应用都支持 Back-Channel Logout（后端登出通知）。实际中常见的是混合方案：

1. **被动登出**：各应用的 Session 设置为短有效期，过期后需要重新到 IdP 认证（这时发现 SSO Session 也已过期，要求重新登录）。
2. **主动登出**：支持 Logout 协议的应用，IdP 主动清除其 Session。

### 登出最佳实践

- IdP Session 和 App Session 都要设有效期
- Access Token 有效期应较短（如 5–15 分钟），App Session 可较长并通过 Refresh Token 静默续期；Refresh Token 有效期应长于 Access Token 但不超过 IdP SSO Session 有效期
- 使用 Refresh Token 的静默刷新，减少用户感知
- 重要操作前重新评估认证状态（Step-up Auth）

## 10.5 SSO 的安全性增强

### 重新认证（Re-authentication / Step-up Auth）

- 访问高价值资源时，即使已有 SSO Session，也要求重新认证。
- 例如：查看普通数据只需 SSO Session，修改支付设置需要重新输入密码 + MFA。

### 连续访问评估（Continuous Access Evaluation, CAE）

新一代 SSO 不再只验证"登录时"的认证状态，而是持续评估：

- 用户 IP 地址是否发生了变化？
- 设备是否符合安全策略？
- 用户行为是否正常？

任何一个条件不满足，立即吊销 Access Token，中断访问。

### 设备信任

将 SSO 与设备管理（MDM/UEM）集成：

- 只允许公司管理的设备访问企业应用
- 检查 OS 版本、安全补丁状态、是否越狱等

## 10.6 SSO 的常见陷阱

1. **SSO 不等于免密**：SSO 只是减少密码输入的次数，认证强度不能降低。弱密码 + SSO 只会让攻击者更容易获得"万能钥匙"。

2. **SSO Session 过长**：设置过长的 SSO Session（如 30 天），等于 30 天内任何人都可以在用户离开后使用其设备访问所有应用。

3. **登出不完整**：用户登出了应用 A，但应用 B 的 Session 仍然活跃。

4. **Refresh Token 滥用**：将 Refresh Token 存放在不安全的地方（如 localStorage），且不设 Rotation。

5. **忽略网络分区**：SSO 依赖 IdP 的可用性。如果 IdP 不可用，所有应用都无法登录。

6. **过度信任 SSO**：应用只检查"用户是否从 IdP 来"，而不验证 token 的具体内容（过期时间、scope、audience）。

## 10.7 SSO 高可用设计

SSO 是基础设施中的关键路径，其可用性设计尤为重要：

- IdP 集群化部署，多节点
- IdP 自身状态外置（如使用外部数据库/Session 存储）
- 跨可用区 / 跨区域部署
- 缓存关键数据（如用户属性），减少数据库依赖
- 监控 IdP 健康状态、延迟和错误率

## 10.8 小结

SSO 是 IDaaS 的入门功能，也是最核心的功能之一。好的 SSO 设计是安全性和便利性的平衡：认证强度不能削弱，会话管理需要精细化，单点登出要重视，IdP 自身的高可用是基础前提。
