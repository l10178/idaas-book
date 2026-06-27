---
title: "第21章：IDaaS 安全最佳实践"
description: "IDaaS 安全最佳实践全景：从身份安全到应用安全的系统性防护指南"
date: 2024-05-02T00:00:00+08:00
draft: false
weight: 52
menu:
  docs:
    parent: "advanced-topics"
    identifier: "security-best-practices"
toc: true
---

## 21.1 安全总则

IDaaS 是安全基础设施的核心，它保护着所有应用的入口。如果 IDaaS 被攻破，攻击者就拿到了"万能钥匙"。

因此，IDaaS 自身的安全必须比它所保护的应用更高一个等级。

## 21.2 密码安全

### 密码哈希

- **绝对必须使用单向哈希**，绝不能明文或可逆加密存储密码
- 推荐算法顺序：**Argon2id > bcrypt > scrypt > PBKDF2**
- Argon2id 是 2015 年密码哈希竞赛的获胜者，内存硬（Memory-hard），抗 ASIC 攻击

### 密码策略

- 最小长度 ≥ 12 字符（长度比复杂度更重要）
- 检查密码是否在已知泄露密码库中（Have I Been Pwned API）
- 密码历史检查（不能与最近 5 次相同）
- 但不要强制每 90 天换密码（NIST SP 800-63B 已取消此建议）
- 只在怀疑凭证泄露时要求更改

### 密码传输

- 登录表单必须通过 HTTPS POST
- 绝不在 URL 参数中传输密码
- 使用 Content-Security-Policy 头防止 XSS

## 21.3 Token 安全

### Access Token

- 短有效期（5-15 分钟）
- 使用非对称签名（RS256/ES256），资源服务器用公钥验证
- 包含 audience（aud）限制可用范围
- 使用 DPoP 或 mTLS 绑定 Token 到客户端

### Refresh Token

- Rotation：每次使用后发放新 Token，旧 Token 立即失效
- Reuse Detection：同一 Refresh Token 被使用两次 = 立即全局吊销所有 Token
- 存储在 HttpOnly Secure Cookie 中（Web）或 Keychain/Keystore（移动）

### ID Token

- 只在客户端验证，绝不应发送给资源服务器
- 验证清单：签名、iss、aud、exp、iat、nonce
- 使用 Pairwise Subject Identifier 防止跨应用用户追踪

## 21.4 会话安全

### Cookie 属性

```
Set-Cookie: session_id=xxx;
  Secure;           # 仅通过 HTTPS 传输
  HttpOnly;         # JavaScript 不可访问（防 XSS 窃取）
  SameSite=Lax;     # 防 CSRF
  Path=/;
  Max-Age=3600;     # 短生命周期
  Domain=auth.example.com  # 限定在认证域
```

### Session 管理

- 绝对的会话超时时间（如 8 小时）
- 空闲超时时间（如 30 分钟）
- 更改密码后吊销所有现有 Session
- 可疑活动时立即吊销 Session

## 21.5 传输安全

### TLS 配置

```
TLS 1.2 最低要求，TLS 1.3 推荐
禁用 TLS 1.0/1.1
推荐的密码套件：
  - TLS_AES_256_GCM_SHA384 (TLS 1.3)
  - TLS_CHACHA20_POLY1305_SHA256 (TLS 1.3)
  - ECDHE-RSA-AES256-GCM-SHA384 (TLS 1.2)
HSTS: max-age=31536000; includeSubDomains
```

### 证书管理

- 使用受信任的 CA（非自签名）
- 证书有效期 ≤ 90 天（自动化轮换）
- 监控证书过期时间

## 21.6 API 安全

### 速率限制

```
端点                  限制
/token (密码模式)      5 次/IP/分钟
/authorize             60 次/IP/分钟
所有端点               300 次/IP/分钟（全局）
```

### 输入验证

- 所有 API 端点验证输入（长度、格式、字符范围）
- SQL 注入防护（参数化查询，ORMs）
- XSS 防护（输出编码）
- Open Redirect 防护（redirect_uri 白名单精确匹配）

### API 认证

- 所有管理 API 使用 Bearer Token 认证
- 客户端凭证（client_id + client_secret）用于 M2M
- admin 操作要求专门的 admin role

## 21.7 部署安全

### 最小暴露面

- 只暴露必要的端口和端点
- 管理控制台限制内网或 VPN 访问
- 禁用无关的 HTTP 方法（TRACE, OPTIONS）

### Secrets 管理

- 绝不硬编码密钥和密码
- 使用外部 Secrets 管理（Vault, External Secrets Operator）
- 密钥定期轮换
- 签名密钥泄露有不影响的应急方案

### 基础设施即代码（IaC）

- 所有配置通过代码管理（Helm, Kustomize, Terraform）
- 禁止手动修改生产配置
- 配置变更经过代码审查

## 21.8 安全运营

### 漏洞管理

- 持续监控 IDaaS 组件的安全公告
- 建立补丁窗口（安全补丁 < 7 天，普通更新 < 30 天）
- 测试环境先于生产

### 安全审计

- 定期（至少季度）审查访问权限，尤其管理员权限
- 所有管理操作记录审计日志
- 审计日志不可修改，存储于安全区域

### 事件响应

事先定义好：
- 凭证泄露的应急流程
- Token 批量吊销的操作方式
- 与受影响用户/应用的沟通模板
- 恢复服务的时间目标

## 21.9 安全检查清单

```
□ 密码：使用 Argon2id/bcrypt 哈希？密码策略合理？
□ MFA：管理员强制，用户推荐/强制？
□ Token：短有效期？Refresh Token Rotation？
□ Cookie：Secure + HttpOnly + SameSite=Lax？
□ TLS：禁用旧版本？HSTS 启用？
□ API：速率限制？输入验证？
□ Secrets：外部管理？定期轮换？
□ 日志：所有认证操作记录？不可篡改？
□ 备份：定期备份并测试恢复流程？
□ 监控：关键指标有告警规则？
□ 补丁：安全更新机制到位？
□ 权限审计：定期审查管理员权限？
```

## 21.10 小结

IDaaS 安全不是配置清单，而是一种思维方式。每个环节——密码存储、Token 管理、会话控制、传输加密、API 安全、部署安全——都需要被认真对待。最简单的安全原则：如果你不确定某个配置是否安全，就用最安全的选项，然后通过监控和审计验证它确实在工作。
