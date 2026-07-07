---
title: "OAuth 2.0 授权码流程与 PKCE 完整图解"
description: "OAuth 2.0 授权码流程（Authorization Code Flow）的每一步详解，PKCE（RFC 7636）的安全增强机制，以及 OAuth 2.1 带来的变化。附带完整 Mermaid 时序图和常见攻击面分析。"
date: 2026-07-07T00:00:00+08:00
draft: false
weight: 22
menu:
  docs:
    parent: "protocols"
    identifier: "oauth2-auth-code-pkce"
toc: true
seo:
  title: "OAuth 2.0 授权码流程与 PKCE 完整图解 | IDaaS Book"
  description: "OAuth 2.0 Authorization Code Flow 完整时序图与 PKCE 安全增强机制。涵盖 code_challenge/code_verifier 生命周期、OAuth 2.1 变更和常见攻击面分析。"
---

## 为什么需要这份图解

OAuth 2.0 授权码流程（Authorization Code Flow）是所有现代身份协议的基础。OIDC 基于它、单页应用靠它、移动 App 也用它——但大部分资料要么只有文字描述，要么跳过了关键的安全细节。

这份图解的目标是：**一图看懂完整交互，然后逐帧理解每个参数的设计意图和攻击面。**

## 授权码流程完整时序图

下面是 OAuth 2.0 Authorization Code Flow 的标准交互，包含四个角色：用户（Resource Owner）、客户端（Client）、授权服务器（Authorization Server）和资源服务器（Resource Server）。

```mermaid
sequenceDiagram
    actor User as 用户<br/>(Resource Owner)
    participant Client as 客户端<br/>(Client)
    participant AS as 授权服务器<br/>(Authorization Server)
    participant RS as 资源服务器<br/>(Resource Server)

    Note over User,RS: ═══ 第一步：发起授权请求 ═══
    User->>Client: 1. 点击「使用 XX 账号登录」
    Client->>Client: 2. 构造授权请求 URL<br/>含 client_id, redirect_uri,<br/>response_type=code, scope,<br/>state（防 CSRF 随机值）

    Note over User,RS: ═══ 第二步：用户授权 ═══
    Client->>User: 3. HTTP 302 重定向到<br/>授权服务器的 /authorize 端点
    User->>AS: 4. 浏览器跟随重定向，<br/>用户在授权服务器页面登录并确认授权
    AS->>AS: 5. 验证用户身份<br/>检查 client_id 和 redirect_uri<br/>是否与注册时一致

    Note over User,RS: ═══ 第三步：获取授权码 ═══
    AS->>User: 6. HTTP 302 重定向回<br/>redirect_uri?code=AUTH_CODE&state=xxx
    User->>Client: 7. 浏览器跟随重定向，<br/>将 code 和 state 传给客户端
    Client->>Client: 8. 验证 state 参数<br/>（防止 CSRF 攻击）

    Note over User,RS: ═══ 第四步：用授权码换令牌 ═══
    Client->>AS: 9. POST /token<br/>grant_type=authorization_code<br/>code=AUTH_CODE<br/>redirect_uri（再次发送以验证）<br/>client_id + client_secret
    AS->>AS: 10. 验证 code（一次性）<br/>验证 redirect_uri 一致性<br/>验证 client 身份
    AS->>Client: 11. 返回 {access_token,<br/>refresh_token, expires_in}

    Note over User,RS: ═══ 第五步：使用令牌访问资源 ═══
    Client->>RS: 12. GET /api/user<br/>Authorization: Bearer {access_token}
    RS->>AS: 13. （可选）验证 token<br/>introspect 或本地校验
    RS->>Client: 14. 返回受保护资源
```

### 每一步的设计意图

| 步骤 | 关键参数 | 为什么这么设计 |
|------|----------|---------------|
| 2 | `response_type=code` | 指定使用授权码模式（不是 implicit） |
| 2 | `state` | 随机值，防止 CSRF——客户端在第 8 步验证，攻击者无法伪造 |
| 2 | `redirect_uri` | 必须在授权服务器上预注册，防止令牌被重定向到攻击者控制的地址 |
| 4 | 用户在授权服务器页面上登录 | 客户端永远看不到用户的密码——这是 OAuth 的核心理念 |
| 6 | `code` 通过浏览器返回 | 授权码作为中间凭证，即使被截获也没有用——因为没有 client_secret |
| 9 | `code` + `client_secret` | 授权码 + 客户端密钥双重验证，确保只有合法客户端能换取 token |
| 9 | `redirect_uri` 再次发送 | 防止授权码被注入到其他客户端的回调中（mix-up attack 防护） |
| 12 | `Authorization: Bearer` | Bearer token——持有即有权，所以必须通过 HTTPS 传输 |

## PKCE：授权码流程的安全补丁

**PKCE（Proof Key for Code Exchange，RFC 7636）** 是授权码流程的关键安全扩展。它最初为移动 App 设计（因为移动端无法安全存储 client_secret），但现在 **OAuth 2.1 要求所有客户端都必须使用 PKCE**。

### PKCE 的威胁模型

没有 PKCE 时，授权码流程存在一个致命漏洞：

1. 恶意 App 在手机上注册了与合法 App 相同的自定义 URL Scheme（例如 `myapp://callback`）
2. 用户在自己的 App 中发起授权
3. 授权服务器返回 `myapp://callback?code=AUTH_CODE` 时，操作系统可能将 code 路由到恶意 App
4. 恶意 App 截获授权码，用它换取 access_token——**它现在可以冒充用户了**

PKCE 通过一个密码学挑战-响应机制彻底堵死了这条路。

### PKCE 完整时序图

```mermaid
sequenceDiagram
    actor User as 用户
    participant Client as 客户端
    participant AS as 授权服务器
    participant Attacker as 恶意 App ❌

    Note over User,AS: ═══ 生成 PKCE 挑战 ═══
    Client->>Client: 1. 生成随机 code_verifier<br/>（43-128 字符的高熵随机字符串）
    Client->>Client: 2. 计算 code_challenge<br/>= SHA256(code_verifier)<br/>然后 Base64URL 编码

    Note over User,AS: ═══ 发起授权（附 challenge） ═══
    Client->>AS: 3. GET /authorize?<br/>response_type=code&<br/>code_challenge=CHALLENGE&<br/>code_challenge_method=S256
    AS->>AS: 4. 存储 code_challenge<br/>与即将发放的 code 关联
    User->>AS: 5. 用户在授权服务器页面登录并授权
    AS->>User: 6. 返回 myapp://callback?code=AUTH_CODE

    Note over User,AS: ═══ PKCE 防护生效 ═══
    Attacker-->>User: 7. 尝试截获授权码
    Attacker->>AS: 8. POST /token<br/>code=AUTH_CODE（截获的）<br/>code_verifier=??? （不知道！）
    AS->>Attacker: 9. ❌ 400 Bad Request<br/>invalid_grant: code_verifier 不匹配

    Note over User,AS: ═══ 合法客户端成功 ═══
    Client->>AS: 10. POST /token<br/>code=AUTH_CODE<br/>code_verifier=ORIGINAL_VERIFIER
    AS->>AS: 11. SHA256(code_verifier)<br/>与存储的 code_challenge 对比
    AS->>Client: 12. ✅ 匹配成功<br/>{access_token, refresh_token}
```

### Code Verifier 和 Code Challenge 的密码学关系

```text
code_verifier = 随机生成的高熵字符串
                （长度 43-128，字符集 A-Z a-z 0-9 - . _ ~）

code_challenge = BASE64URL(SHA256(code_verifier))

验证时：
  授权服务器重新计算 SHA256(code_verifier)
  与授权请求时收到的 code_challenge 对比
  匹配 → 证明请求 token 的就是当初发起授权的同一个客户端
```

**为什么攻击者无法破解？**
- SHA256 是单向哈希——知道 `code_challenge` 无法反推 `code_verifier`
- 暴力穷举 `code_verifier` 在数学上不可行（43 字符的组合空间是 66^43 ≈ 2^260）
- 授权码只有 1 次使用机会 + 通常 30-60 秒有效期

## 常见攻击面与防护

### 1. Redirect URI 劫持

```mermaid
sequenceDiagram
    actor User as 用户
    participant LegitClient as 合法客户端
    participant AS as 授权服务器
    participant Attacker as 攻击者服务器

    Attacker->>User: 1. 诱导用户点击恶意链接<br/>client_id=合法App&redirect_uri=attacker.com
    User->>AS: 2. 用户在授权服务器正常登录
    AS->>User: 3. 302 重定向到 redirect_uri<br/>attacker.com?code=AUTH_CODE
    User->>Attacker: 4. 攻击者获得授权码
    Attacker->>AS: 5. POST /token<br/>code=AUTH_CODE<br/>（用攻击者自己的 client_secret 可能失败，<br/>但若是 public client 或用 PKCE 截获则可能成功）
```

**防护措施：**
- 授权服务器必须严格校验 redirect_uri 与注册值完全匹配（不允许通配符、不允许部分匹配）
- 客户端使用 PKCE——即使攻击者截获 code，没有 code_verifier 也无法换 token
- 使用 `state` 参数防止 CSRF

### 2. CSRF 与 State 参数

**场景**：攻击者在自己网站上嵌入一个隐藏的 iframe，指向：
```
https://auth-server.com/authorize?client_id=victim_app&redirect_uri=victim_app.com/callback&response_type=code&state=ATTACKER_STATE
```

如果受害者在 victim_app 已经登录授权服务器，授权服务器会直接返回授权码到 `victim_app.com/callback?code=CODE&state=ATTACKER_STATE`。虽然攻击者在不同源无法读取 iframe 内容，但如果 victim_app 不验证 state，攻击者可以用自己已知的 state 去预测整个流程。

**防护**：客户端生成随机 `state`，在回调中验证 `state` 与自己存储的一致。攻击者无法预测合法的 `state` 值。

### 3. Mix-Up Attack（RFC 9207）

攻击者注册一个恶意客户端，其 `iss`（issuer）指向一个伪造的授权服务器。当用户通过正常客户端发起授权时，攻击者构造请求使授权码从恶意授权服务器发放——但 code 最终会被送到合法客户端。

**防护**：
- 客户端在 `/token` 请求中发送 `redirect_uri`（已在标准中强制）
- 授权服务器在 token 响应中返回 `iss` 参数（OAuth 2.1 / RFC 9207）
- 客户端验证返回的 `iss` 与预期的授权服务器一致

## OAuth 2.0 → 2.1 的关键变更

OAuth 2.1 不是新协议，而是对 2.0 的**安全整合**——把实践社区公认的最佳安全措施变成强制要求：

```mermaid
graph TD
    O20[OAuth 2.0 RFC 6749<br/>2012年] --> BCP[安全 BCP<br/>最佳实践文档]
    BCP --> O21[OAuth 2.1<br/>2024年草案]

    O20 --> RM1[❌ Implicit Grant<br/>移除]
    O20 --> RM2[❌ Password Grant<br/>移除]
    O20 --> RM3[❌ Bearer Token in URI<br/>移除]

    BCP --> ADD1[✅ PKCE 强制<br/>所有客户端]
    BCP --> ADD2[✅ 精确 redirect_uri 匹配<br/>不允许通配符]
    BCP --> ADD3[✅ refresh_token 轮换<br/>每次刷新发新 token]
    BCP --> ADD4[✅ issuer 参数<br/>防止 Mix-Up Attack]

    style O20 fill:#f0f0f0
    style O21 fill:#c8e6c9
    style RM1 fill:#ffcdd2
    style RM2 fill:#ffcdd2
    style RM3 fill:#ffcdd2
    style ADD1 fill:#c8e6c9
    style ADD2 fill:#c8e6c9
    style ADD3 fill:#c8e6c9
    style ADD4 fill:#c8e6c9
```

| 变更 | 2.0 状态 | 2.1 要求 |
|------|---------|---------|
| Implicit Grant | 可用 | **移除**（用 Authorization Code + PKCE 替代） |
| Resource Owner Password Grant | 可用 | **移除**（不安全，用户密码暴露给客户端） |
| PKCE | 可选，推荐给 public client | **强制**（所有客户端必须使用） |
| redirect_uri 匹配 | 允许宽松匹配 | **精确匹配**（不允许通配符） |
| Refresh Token | 无轮换要求 | **必须轮换**（sender-constrained 或一次性） |
| Bearer Token in URI | 允许（`?access_token=...`） | **禁止**（仅允许 POST body 或 Header） |
| issuer 验证 | 无要求 | **强制**（防止 Mix-Up Attack） |

## 实际配置示例

### Keycloak 中启用 PKCE

Keycloak 默认对 public client 启用 PKCE。对于 confidential client，可以在客户端设置中强制启用：

```bash
# Keycloak Admin CLI 强制 PKCE
kcadm.sh update clients/CLIENT_ID \
  -s attributes.pkce.code.challenge.method=S256
```

### oauth2-proxy 中的 PKCE 配置

```yaml
# oauth2-proxy.cfg
provider = "keycloak-oidc"
code_challenge_method = "S256"
# 确保 Auth URL 中包含 PKCE 参数
```

### 验证 PKCE 是否生效

```bash
# 1. 抓取授权请求 URL，确认包含 code_challenge
# /authorize?...&code_challenge=xxx&code_challenge_method=S256

# 2. 确认 token 请求中包含 code_verifier
# POST /token  body: code=xxx&code_verifier=xxx&grant_type=authorization_code

# 3. 尝试用无效的 code_verifier 请求 token——应返回 400
```

## 常见误区

| 误区 | 真相 |
|------|------|
| "PKCE 只是给移动 App 用的" | OAuth 2.1 强制所有客户端使用 PKCE，单页应用和服务端应用都在范围内 |
| "用了 HTTPS 就不需要 PKCE 了" | HTTPS 保护传输层，但无法防止授权码被截获后转发——PKCE 保护的是应用层 |
| "state 参数是可有可无的" | state 是防止 CSRF 的唯一机制——没有 state，攻击者可以让受害者绑定攻击者的账号 |
| "OAuth 是认证协议" | OAuth 2.0 是**授权**协议，不负责认证。认证是 OIDC（基于 OAuth 2.0 构建）的职责 |
| "响应类型是 code 就一定安全" | 不加 PKCE 的授权码流程仍然存在授权码拦截风险 |

## 下一步

- 理解授权码流程后，看 [OpenID Connect]({{< relref "openid-connect.md" >}}) ——它在此之上添加了身份认证层
- 了解 [SAML 2.0]({{< relref "saml2.md" >}}) 的另一种 SSO 实现方式
- 动手实践：[Keycloak 入门]({{< relref "../keycloak/getting-started.md" >}}) 中的 OIDC 客户端配置
