---
title: "Supabase Auth vs Keycloak — 对比、集成与互补实践 | IDaaS Book"
description: "Supabase 和 Keycloak 如何选？两者如何集成？本文从认证能力、授权模型、多租户、企业 SSO 四个维度深度对比，并提供 Keycloak 作为 Supabase 外部 OIDC Provider 的完整集成方案。"
date: 2026-07-09T00:00:00+08:00
draft: false
toc: true
---

## 背景

**Supabase** 是 Firebase 的开源替代品，内置了基于 GoTrue 的 Auth 系统，开箱即用地支持邮箱密码登录、Magic Link、社交登录（Google/GitHub 等）、手机验证码。

**Keycloak** 是企业级的开源 IAM 平台，支持 OIDC/SAML/LDAP、RBAC/ABAC、多租户 Realm、用户联邦——这些 Supabase Auth 全部不做。

一个常见的问题是：**我的项目用 Supabase，还需要 Keycloak 吗？如果要，怎么集成？**

本文回答这三个问题：对比、集成、互补。

## Supabase Auth vs Keycloak：能力对比

### 核心差异

| 能力 | Supabase Auth | Keycloak |
|------|:---:|:---:|
| 邮箱/密码 | ✅ | ✅ |
| Magic Link | ✅ | 需定制 SPI |
| 手机验证码 | ✅ | 需定制 SPI |
| 社交登录（OIDC） | ✅ | ✅ |
| **SAML 2.0** | ❌ | ✅ |
| **LDAP/AD 联邦** | ❌ | ✅ |
| **RBAC/ABAC** | 基础 RLS | ✅ 完备 |
| **多租户（Realm）** | ❌ | ✅ |
| **自定义认证流程** | 有限 | ✅ SPI 完全可编程 |
| **MFA（TOTP/WebAuthn）** | ✅ (TOTP) | ✅ (TOTP + WebAuthn) |
| **用户联邦** | ❌ | ✅ |
| **管理控制台/API** | Dashboard | Admin Console + REST API + CLI |
| **自建部署** | ✅ (Docker) | ✅ (Docker/K8s/Bare Metal) |
| **数据主权** | ✅ | ✅ |

> **一句话总结**：Supabase Auth 是给应用开发者的「前端友好的认证工具箱」，Keycloak 是给企业的「全功能 IAM 平台」。

### 什么场景下 Supabase Auth 就够了？

- 只需要邮箱密码 / Magic Link / 社交登录
- 用户都是消费者（C 端），不需要企业 SSO
- 授权逻辑简单，用 RLS（Row Level Security）足够
- 没有多租户隔离需求
- 团队没有 IAM 专员

### 什么场景下你需要 Keycloak？

- 需要对接企业客户的 SAML / LDAP / AD
- 需要 RBAC 或 ABAC 的细粒度权限模型
- 需要多租户隔离（每个客户一个 Realm）
- 需要自定义认证流程（审批流、逐步认证）
- 需要和已有的企业 IAM 基础设施集成

## 集成方案：Keycloak 作为 Supabase 的外部 OIDC Provider

**核心思路**：Supabase 继续管理自己的用户（Row Level Security、数据权限），但**认证环节委托给 Keycloak**。用户在 Keycloak 登录后，Supabase 接受 Keycloak 签发的 JWT。

### 架构

```
用户 → Keycloak 登录（支持 SAML/LDAP/社交/MFA）
         │
         ▼ JWT (由 Keycloak 签发)
    Supabase (验证 JWT → 创建/关联 Supabase 用户)
         │
         ▼ Supabase RLS (基于 JWT claims 的行级安全)
    PostgreSQL 数据
```

### 步骤

#### 1. Keycloak 侧：创建 OIDC Client

在 Keycloak Admin Console 中为 Supabase 创建一个 OIDC Client：

| 配置项 | 值 |
|--------|-----|
| Client ID | `supabase` |
| Client Protocol | `openid-connect` |
| Access Type | `confidential` |
| Valid Redirect URIs | `https://<your-project>.supabase.co/auth/v1/callback` |
| Client Authenticator | `Client ID and Secret` |

> 记录生成的 **Client Secret**，后续 Supabase 配置需要。

#### 2. Keycloak 侧：配置 JWT Claims

Supabase 的 RLS 依赖 JWT 中的特定 claims。配置一个 Mapper 来注入 `sub` 和 `email`：

```json
{
  "name": "supabase-claims",
  "protocol": "openid-connect",
  "protocolMapper": "oidc-usermodel-attribute-mapper",
  "config": {
    "user.attribute": "email",
    "claim.name": "email",
    "access.token.claim": "true",
    "id.token.claim": "true"
  }
}
```

确保 JWT 中包含 `sub`（用户唯一 ID）、`email` 和 `aud`（audience，需匹配 Supabase 的 URL）。

#### 3. Supabase 侧：配置外部 OIDC Provider

在 Supabase Dashboard → Authentication → Providers → 添加 Keycloak：

```bash
# 或者通过 Supabase CLI / SQL
# 环境变量方式（自建 Supabase）
GOTRUE_EXTERNAL_KEYCLOAK_ENABLED=true
GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID=supabase
GOTRUE_EXTERNAL_KEYCLOAK_SECRET=<client-secret>
GOTRUE_EXTERNAL_KEYCLOAK_URL=https://keycloak.example.com/realms/<realm>
GOTRUE_EXTERNAL_KEYCLOAK_REDIRECT_URI=https://<your-project>.supabase.co/auth/v1/callback
```

#### 4. 前端集成

```typescript
// 用户点击「企业 SSO 登录」→ 跳转到 Keycloak
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'keycloak',
  options: {
    redirectTo: 'https://yourapp.com/auth/callback',
  },
});
```

登录成功后，Supabase 会自动创建/关联用户。

### 验证

```bash
# 1. 获取 Keycloak Token
curl -X POST https://keycloak.example.com/realms/<realm>/protocol/openid-connect/token \
  -d 'client_id=supabase' \
  -d 'client_secret=<secret>' \
  -d 'grant_type=password' \
  -d 'username=testuser' \
  -d 'password=testpass'

# 2. 检查 JWT claims（确认包含 sub/email/aud）
# 3. 用该 token 调用 Supabase API
```

## 互补场景：两者一起用的最佳实践

### 场景 1：C 端用户用 Supabase Auth，B 端客户用 Keycloak

```
Supabase Auth ──────────── C 端消费者
    (邮箱/Magic Link/社交)

Keycloak ───────────────── B 端企业客户
    (SAML/LDAP/RBAC)         │
                              └── 认证后签发 JWT → Supabase 验证
```

**优势**：
- C 端用户体验好（Magic Link 无密码），不用引入 Keycloak 的复杂度
- B 端客户可以用企业 IdP 接入，满足合规和安全要求
- 所有用户数据统一在 Supabase PostgreSQL 中，RLS 统一管理权限

### 场景 2：Keycloak 作为多租户网关，Supabase 作为数据层

```
客户 A (Realm A) ──┐
客户 B (Realm B) ──┤ → Keycloak → JWT (含 tenant_id claim) → Supabase
客户 C (Realm C) ──┘                                                │
                                                            RLS: tenant_id = auth.jwt() -> tenant_id
```

每个客户在 Keycloak 中有独立的 Realm，完全隔离的用户、角色、认证策略。Supabase 通过 JWT 中的 `tenant_id` 实现数据隔离。

### 场景 3：逐步迁移——先用 Supabase Auth，成熟后再加 Keycloak

```
Phase 1:  Supabase Auth（快速上线，C 端）
Phase 2:  + Keycloak 作为外部 OIDC Provider（B 端/企业客户）
Phase 3:  Keycloak 承担全部认证，Supabase Auth 逐步退役（可选）
```

Supabase 支持多 Provider，你可以同时启用 Supabase 原生 Auth 和 Keycloak OIDC，用户在登录页面选择「普通登录」或「企业 SSO」。

## Supabase Auth + Keycloak 的边界

### Supabase Auth 继续负责的

- **RLS 权限**：基于 JWT claims 的行级安全策略
- **用户数据存储**：`auth.users` 表 + 业务数据关联
- **前端 SDK**：`supabase-js` 的 `auth` 模块
- **实时订阅**：基于用户身份的 Realtime Channel 权限

### Keycloak 负责的

- **企业 SSO**：SAML/LDAP/AD 对接
- **高级 MFA**：WebAuthn、条件认证
- **多租户隔离**：Realm 级隔离
- **自定义认证流程**：审批、风险评分
- **统一审计**：跨应用的认证审计

### 责任边界图

```
┌─────────────────────────────────────────┐
│               Keycloak                   │
│   认证 · 多租户 · SAML · MFA · 审计       │
└──────────────┬──────────────────────────┘
               │ JWT
┌──────────────▼──────────────────────────┐
│              Supabase                    │
│   RLS 权限 · 数据存储 · API · 实时         │
└─────────────────────────────────────────┘
```

## 常见问题

### Q1：Supabase 不是已经有 Auth 了吗，为什么还要 Keycloak？

Supabase Auth 解决的是 80% 的认证场景（邮箱/社交登录），但企业环境需要 SAML、LDAP、多租户——这些 Supabase 不做。加上 Keycloak 不是替换，是扩展：Supabase 处理剩下的 20% 企业场景。

### Q2：集成 Keycloak 后，Supabase 的 RLS 还生效吗？

完全生效。Keycloak 签发的 JWT 被 Supabase 验证后，`auth.uid()` 和 `auth.jwt()` 函数正常工作。你可以在 JWT 中注入自定义 claims（如 `role`、`tenant_id`），在 RLS 策略中使用。

### Q3：用户在 Supabase 和 Keycloak 中都有账号，怎么关联？

Supabase 通过 JWT 的 `sub` claim 关联用户。如果同一个真实人在两个系统中有不同账号，需要在应用层做账号关联（identity linking）。Keycloak 的 Identity Broker 功能可以实现这一步——让 Keycloak 作为唯一身份源，Supabase 不做独立注册。

### Q4：自建 Supabase 和 Keycloak，运维成本多大？

| 组件 | 最低配置 | 月成本（AWS 参考） |
|------|---------|-------------------|
| Keycloak | 2 vCPU, 4GB RAM | ~$50-80 (EC2 t3.medium) |
| Supabase | 2 vCPU, 4GB RAM + PostgreSQL | ~$80-120 |
| **合计** | | **~$130-200/月** |

对比 Supabase Pro 计划 $25/月 + Keycloak 的额外运维，自建通常在大体量（10000+ 用户）或需要数据主权时才划算。

### Q5：Auth0/Okta + Supabase 是不是更简单？

部署上更简单（零运维），但成本完全不同。Auth0 的 B2B 方案（企业 SSO/SAML）起价 $240/月。Keycloak 免费。同样能力下：

| 方案 | 100 用户/月 | 1000 用户/月 | 10000 用户/月 |
|------|-----------|------------|-------------|
| Auth0 B2B + Supabase | ~$240 | ~$800 | ~$3000+ |
| Keycloak + Supabase | ~$80（仅服务器） | ~$120 | ~$200 |

差距随用户量增长而急剧拉大。

## 小结

Supabase 和 Keycloak 不是替代关系，是互补关系：

- **只有 C 端用户** → Supabase Auth 单用即可
- **需要对接企业客户** → 加 Keycloak 处理 SAML/LDAP
- **需要多租户** → Keycloak Realm + Supabase RLS
- **需要合规审计** → Keycloak 统一认证审计
