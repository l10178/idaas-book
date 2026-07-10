---
title: "第21章：IAM / IDaaS 安全最佳实践 — 密钥管理、令牌保护与攻击面防御 | IDaaS Book"
description: "IAM 与 IDaaS 安全最佳实践全景：涵盖密钥管理、令牌保护、会话安全、攻击面防御与安全监控的系统性防护指南"
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
- Argon2 是 2015 年密码哈希竞赛（PHC）的获胜者，Argon2id 是其推荐的抗侧信道混合变体（RFC 9106 推荐使用 Argon2id），内存硬（Memory-hard），抗 ASIC 攻击

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
- 使用 [DPoP]({{< relref "../protocols/oauth2-dpop.md" >}}) 或 mTLS 绑定 Token 到客户端

### Refresh Token

- Rotation：每次使用后发放新 Token，旧 Token 立即失效
- Reuse Detection：同一 Refresh Token 被使用两次即视为泄露，立即吊销该令牌链（该用户/该客户端的相关令牌）
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
  SameSite=Lax;     # CSRF 纵深防御之一；最强为 SameSite=Strict（但影响跨站回跳）
  Path=/;
  Max-Age=3600;     # 短生命周期
  Domain=auth.example.com  # 限定在认证域
```

> 注：`SameSite` 是 CSRF 纵深防御的一环，不应作为唯一防线；主流浏览器已默认 `Lax+POST` 限制，仍需配合 CSRF Token / Origin / `Sec-Fetch-Site` 校验。

### Session 管理

> **参见**：[IAM 会话管理与 Token 生命周期]({{< relref "iam-session-management" >}})——SSO 会话架构、Token 刷新流程与吊销机制的完整指南。

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
/token                 按 grant_type 分别限速；密码模式（ROPC）已被 OAuth 2.1/Security BCP 弃用，应避免启用，如确需则施加更严格限速（如 5 次/IP/分钟）
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
- 禁用无业务用途的 HTTP 方法（如 `TRACE`、按需禁用 `PUT`/`DELETE`/`CONNECT`）；`OPTIONS` 是 CORS 预检所必需，应正确响应而非禁用

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

- 定期（至少季度）审查访问权限，尤其管理员权限。更多关于权限模型选型和角色审计的内容，参见 [IAM 授权模型对比与选型指南]({{< relref "../advanced-topics/authorization-models.md" >}})
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

## 21.10 IAM 安全 FAQ

### Q1：IAM 安全最佳实践和通用安全有什么不同？

IAM 安全的核心矛盾在于：**身份系统是所有应用的入口，它比任何单个应用更需要安全**。相比通用安全，IAM 安全有三个独特关注点：

1. **凭证存储不等于密码存储**：IAM 存储的不仅是用户密码，还包括签名密钥、Token 签名证书、OAuth Client Secret、API Key 等——这些泄露的后果比单用户密码泄露严重得多
2. **信任链传递**：如果你的 IDP 被攻破，攻击者可以签发任意 Token 冒充任何用户，所有信任该 IDP 的应用都随之沦陷——这是典型的「单点风险集中」，必须比普通应用多一道防线
3. **协议级别攻击面**：redirect_uri 劫持、CSRF、授权码拦截、Mix-Up Attack、Token 泄露——这些是 Web 应用安全之外 OAuth/OIDC 协议特有的攻击面，常规 WAF 无法防护

### Q2：等保 2.0 对 IAM 有什么具体要求？

等保 2.0（GB/T 22239-2019）在「身份鉴别」和「访问控制」两个安全类中对 IAM 提出了明确要求：

| 等保级别 | 身份鉴别关键要求 | 访问控制关键要求 |
|---------|----------------|----------------|
| 二级 | 身份标识+口令，失败处理 | 账户-权限绑定，最小权限 |
| 三级 | **双因素认证**，口令复杂度+定期更换，登录失败锁定 | **强制访问控制**（主客体安全标记），**最小权限**，授权粒度到用户级 |
| 四级 | 密码技术（数字证书/生物特征）+口令组合 | 与三级相同但有更严格的审计 |

**对 IDaaS 自建场景**，三级等保要求 IDP 自身必须支持 MFA、具备完整的审计日志（不可篡改、不可删除）、管理员操作需有审批流程。Keycloak 本身提供了 MFA、审计事件、Admin Events 等能力，但在不可篡改日志方面需配合外部日志采集（如 ELK + 对象存储 WORM 锁）。

> **参考**：《信息安全技术 网络安全等级保护基本要求》（GB/T 22239-2019）第八章「安全计算环境」。

### Q3：零信任架构下，IAM 的角色变了吗？

变了。传统网络边界模型中 IAM 只做「入口认证」——认证通过后内部流量默认信任。零信任模型下 IAM 的角色升级为**持续验证中枢**：

1. **每次访问都验证**：不是登录一次就通过，而是每个 API 调用都验证 Token 的有效性、时效性和权限范围
2. **策略引擎（PDP）依赖 IAM 提供实时身份上下文**：用户角色、设备状态、位置、风险评分——IAM 成为策略决策的实时数据源
3. **Session 不再是信任凭证**：长时间 Session 被短生命周期 Token + 持续风险检测取代

实践中，这意味着你的 IDP 必须能支撑高频的 Token Introspection 查询、暴露风险事件（如异常登录），并支持与策略引擎（如 OPA、Pomerium）的实时集成。更多架构细节参见 [零信任身份架构]({{< relref "zero-trust-identity" >}})。

### Q4：企业的 IAM 系统应该从哪些方面开始做安全加固？

如果现在就要开始加固，按优先级排列：

1. **MFA 强制开启（管理员优先）**：这是 ROI 最高的单一措施。Keycloak 中通过 Authentication → Required Actions 或直接配置 OTP/WebAuthn Flow 实现
2. **Token 签名密钥保护**：确认签名密钥文件（private key）的访问权限，不在配置文件中硬编码，定期轮换密钥（Keycloak 的 `Keys` tab 支持）
3. **管理控制台访问限制**：管理控制台绝不暴露在公网，通过 VPN/内网访问
4. **审计日志完整采集**：所有 admin 操作、登录失败、Token 颁发事件接入集中日志平台
5. **打补丁**：关注 Keycloak 安全公告和 GitHub Security Advisories，安全补丁在 7 天内上线
6. **渗透测试**：至少每年一次针对 IDP 的专项渗透测试，重点测试 redirect_uri 验证、CSRF 防护、Token 泄露路径

### Q5：IAM 里的 MFA 应该全员强制吗？

分场景：

| 场景 | 建议 |
|------|------|
| 管理员、运维人员 | **强制 MFA**（无例外），推荐 FIDO2/WebAuthn 或 TOTP |
| 访问敏感数据的员工 | **强制 MFA** |
| 普通员工日常办公 | 推荐 MFA，可逐步推广（先推荐再强制） |
| 客户/外部用户 | 提供 MFA 选项，不强制（需平衡安全和转化率） |
| API/服务账户 | 不适用 MFA，用 mTLS 或密钥轮换保证安全 |

Keycloak 中可以通过 Authentication Flows 按角色或组配置不同的认证链，实现「管理员强制 MFA + 普通用户可选 MFA」的分层策略。

> **实战参考**：Keycloak 的 MFA 配置细节见 [Keycloak MFA / 多因素认证]({{< relref "../keycloak/security-features/mfa/index.md" >}})。

## 21.11 延伸阅读

- [OAuth 2.0 攻击面与防护深度图解]({{< relref "../protocols/oauth2-attack-surface.md" >}})：五大攻击面的完整 Mermaid 图解——redirect_uri 劫持、CSRF、授权码拦截、Mix-Up Attack、Token 泄露与 DPoP 防护
- [OAuth 2.0 DPoP 深度解析]({{< relref "../protocols/oauth2-dpop.md" >}})：Sender-Constrained Token 的完整原理、DPoP Proof JWT 结构与 Keycloak 26 DPoP 配置
- [OAuth 2.0 深度解读]({{< relref "../protocols/oauth2-deep-dive.md" >}})：授权框架的完整剖析
- [零信任身份架构]({{< relref "zero-trust-identity" >}})：零信任模型下 IAM 如何成为持续验证中枢
- [IAM 安全合规与等保 2.0 要求]({{< relref "iam-compliance-dengbao" >}})：身份鉴别、访问控制与审计的等保逐条落地 Checklist

## 21.12 小结

IDaaS 安全不是配置清单，而是一种思维方式。每个环节——密码存储、Token 管理、会话控制、传输加密、API 安全、部署安全——都需要被认真对待。最简单的安全原则：如果你不确定某个配置是否安全，就用最安全的选项，然后通过监控和审计验证它确实在工作。
