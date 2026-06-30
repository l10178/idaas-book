---
title: "Keycloak 安全增强功能"
description: "Keycloak 安全防护实战：密码策略、暴力破解检测与账号锁定、MFA/OTP 多因子认证、安全加固清单（HTTPS/CSP/Token/会话/CORS/审计）"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-security-features"
toc: true
---

安全是 Keycloak 的核心战场。本节聚焦生产环境最常用的三类开箱即用安全能力——**密码策略**、**暴力破解检测**、**多因子认证（MFA/OTP）**，并给出一份覆盖传输、令牌、会话、审计的生产加固清单。三者配合即可满足等保 2.0 中「身份鉴别」与「访问控制」的基本要求。

## 密码策略

在 Realm → **Authentication → Password Policy** 中配置，支持多策略叠加，策略间以 ` and ` 连接。

| 策略 | 作用 | 推荐值 |
|------|------|--------|
| `length` | 最小长度 | 12+ |
| `upperCase` | 至少 N 个大写 | 1 |
| `lowerCase` | 至少 N 个小写 | 1 |
| `digits` | 至少 N 位数字 | 1 |
| `specialChars` | 至少 N 个特殊字符 | 1 |
| `notUsername` | 不与用户名相同 | 开启 |
| `notEmail` | 不与邮箱相同 | 开启 |
| `passwordHistory` | 不重复最近 N 次密码 | 5 |
| `forceExpiredPassword` | N 天强制过期 | 90 |
| `regexPattern` | 正则校验 | 按需 |

> 策略对**已有用户下次改密**生效，新密码即时校验。配合 Required Action `Update Password` 可强制全员在下次登录时改密。

详细图文见 [密码策略]({{< relref "docs/keycloak/security-features/password-policies/index.md" >}})。

## 暴力破解检测与账号锁定

Keycloak 内置 **Brute Force Detection**，按 IP / 用户名维度计数，达到阈值自动锁定账户并清理会话。

关键参数（Realm → **Authentication → Brute Force Detection**）：

| 参数 | 含义 | 推荐值 |
|------|------|--------|
| `Failure Factor` | 连续失败几次触发锁定 | 5 |
| `Wait Increment Seconds` | 每次锁定递增秒数 | 60 |
| `Max Wait Seconds` | 最大锁定时长上限 | 900 |
| `Max Login Failures` | 全局失败计数上限 | 30 |
| `Quick Login Check Milli Seconds` | 两次登录最小间隔 | 1000 |

效果：

- 连续失败达阈值 → 用户被临时锁定，且锁定时长**指数退避**递增。
- 锁定期间清理该用户所有活跃会话（防止用旧 token 继续访问）。
- 管理员可在 **Attack Detection** 页面手动解除锁定。

详细操作截图见 [暴力破解检测]({{< relref "docs/keycloak/security-features/brute-force-detection/index.md" >}})。

> 注意：暴力破解检测默认依赖数据库计数，集群下计数通过 Infinispan `loginFailures` 缓存共享；若关闭该缓存或使用外部代理做限流，需评估覆盖范围。

## 多因子认证（MFA / OTP）

Keycloak 内置基于 **TOTP** 的 OTP 实现，与 Google Authenticator / FreeOTP / Microsoft Authenticator 等标准 OTP App 兼容，开箱即用。

启用方式：

1. 浏览器认证流（Browser Flow）中 OTP 默认为 `CONDITIONAL`——条件执行。
2. 在用户详情页勾选 **Required Action: Configure OTP**，强制用户下次登录注册设备。
3. 用户登录 → 扫描 QR 码注册 → 输入动态口令完成认证。
4. 设备管理：用户在 Account Console 自助删除/重置；管理员可在控制台删除用户凭证令其重新注册。

完整流程截图见 [MFA-OTP]({{< relref "docs/keycloak/security-features/mfa/index.md" >}})。

### 进阶：自适应认证

通过认证流编排可做**条件式 MFA**——按风险动态决定是否要求二因子：

- **基于条件执行器**：`Conditional User Configured`（用户已配置 OTP 才要求）/ `Conditional User Role`（仅特定角色要求）/ `Conditional IP Address`（非内网 IP 要求 MFA）。
- **典型策略**：内网免 OTP、外网强制 OTP；高管账号强制硬件密钥（WebAuthn/FIDO2，Keycloak 21+ 内置）。

## 生产安全加固清单

### 传输层

- [ ] 全站 HTTPS，由 Nginx/Ingress 终结 TLS，Keycloak 仅监听内部。
- [ ] 开启 `proxy-address-forwarding=true`，正确识别客户端真实 IP（暴力检测/审计依赖）。
- [ ] HSTS、TLS 1.2+，禁用老 cipher。

### Token 与会话

- [ ] Access Token `lifespan` 调短（5–15 分钟），Refresh Token 启用并设 `revoke refresh token on logout`。
- [ ] SSO Session Idle/Max 按合规设定（如等保建议会话超时 15 分钟）。
- [ ] Client 启用 **PKCE**（public client 必备）/ 强制 `client_secret`（confidential）/ 限制 `redirect_uri` 白名单。
- [ ] 禁止隐式流（implicit flow），统一用授权码模式。

### 控制台与 API

- [ ] `master` Realm 仅保留极少数管理员；业务在独立 Realm。
- [ ] Admin API 走服务账号 + 最小 `realm-management` 角色，禁用 `admin-cli` 直连生产。
- [ ] 开启 **Admin Events** 与 **User Events** 持久化，对接 SIEM/日志系统。

### 头与跨域

- [ ] 配置 CSP / X-Frame-Options（防止登录页被 iframe 嵌套钓鱼）。
- [ ] CORS 白名单精确到域名，避免通配 `*`。

### 凭证与密钥

- [ ] Realm 签名密钥定期轮换（见 [高级特性 · 密钥轮换]({{< relref "docs/keycloak/advanced-features/index.md" >}})）。
- [ ] 数据库连接启用 TLS；管理员密码入库加盐哈希。

### 审计与监控

- [ ] 关键事件（登录失败、特权操作、口令变更）接入告警。
- [ ] 暴力破解/异常 IP 通过 `events` 或 SIEM 规则发现。

## 小结

密码策略把好「入口口令」关，暴力检测封堵撞库，MFA 提供第二道防线，再叠加传输/令牌/会话/审计的加固清单，Keycloak 即可达到生产级安全基线。需要更深的能力扩展——SPI、认证流编排、事件总线——见下一节高级特性。