---
title: "Keycloak 26.7 新特性深度解读：SCIM 自动配置与 IAM 安全增强 | IDaaS Book"
description: "Keycloak 26.7.0 重大更新：SCIM API 自动用户配置（预览）、多集群免外部缓存高可用、AuthZEN 标准授权、OpenID SSF 实时安全信号、SAML Step-up 认证等 IAM 核心能力详解"
date: 2026-07-11T00:00:00+08:00
lastmod: 2026-07-11T00:00:00+08:00
draft: false
weight: 56
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-26-7-whats-new"
toc: true
---

## 场景描述

Keycloak 26.7.0 于 2026 年 7 月 9 日发布，是 26.x 系列中功能密度最高的版本之一。四个核心方向值得关注：**SCIM API 让用户自动配置成为可能**、**多集群 HA 不再依赖外部缓存**、**AuthZEN 和 OpenID SSF 让授权和安全事件标准化**、**SAML Step-up 从预览转正**。如果你正在维护 Keycloak 生产集群，或者评估开源 IAM 方案，这些变化直接影响你的架构决策。

## 适用场景

- 需要自动从 HR 系统同步用户到 Keycloak 的场景（SCIM API）
- 跨机房/跨区域部署 Keycloak 集群，不想额外维护 Infinispan 或 Redis 的场景
- 需要标准化的授权决策接口（替代 Keycloak 专有 Authorization API）的场景
- 需要实时通知下游应用「用户被禁用/登出/改密码」的场景
- 有 SAML 应用需要 Step-up 认证的场景

## 不适用场景

- 仍在用 Keycloak 25.x 或更早版本的环境——先确认升级路径，不要直接跳版本
- SCIM API 目前是 Preview，生产环境需评估风险后可控开启
- 多集群免外部缓存也是 Preview，对缓存一致性要求极高的场景建议等待 GA

## 26.7.0 新特性总览

| 特性 | 状态 | IAM 影响 |
|------|------|----------|
| SCIM API 用户/组管理 | Preview | 用户自动配置——打通 HR → IDP → 应用的全链路 |
| 多集群 HA（免外部缓存） | Preview | 简化架构，降低运维依赖 |
| AuthZEN Authorization API | Experimental | 标准化授权接口，解耦 PEP/PDP |
| OpenID SSF 实时安全信号 | Experimental | 用户状态变更实时推送给下游（不再等 Token 过期） |
| Identity Brokering API V2 | Supported（V1 废弃） | 更安全的外部 Token 获取机制 |
| SAML Step-up 认证 | Supported（从 Preview 转正） | SAML 应用终于可以要求更高认证级别 |
| Token Exchange Delegation | Experimental | 服务间委托授权更安全 |
| MCP Authorization 增强 | Supported | AI 工具接入 Keycloak 的标准化方式 |
| OID4VCI 可验证凭证 | Experimental（持续改进） | 去中心化身份方向的重要进展 |
| 反向代理蓝图（HAProxy/Traefik） | Supported | 降低反向代理配置门槛 |

## 升级前先检查的兼容性变化

26.7.0 不只是“打开几个新特性”。官方升级说明列出了一些会影响既有配置或管理脚本的变化，建议把下面的检查放在滚动升级之前：

1. **Identity Provider alias 不再允许修改**：如果自动化脚本会通过 Admin REST API 改 alias，先改为“新建并迁移引用”的流程。已有 alias 不要在升级窗口里重命名。
2. **X.509 Client Authentication 需要 Certificate Authority subject DN**：26.7.0 的管理界面要求配置该值；旧配置暂时保持兼容，但下一主版本会在服务端强制校验。使用 TLS 终止代理转发客户端证书时，还要确认 Keycloak 的 truststore 能验证完整证书链，不能只信任一个未验证的请求头。
3. **`view-system` 管理角色已移除**：升级前搜索用户、服务账号和组的角色映射。需要读取完整服务器信息的账号应位于 `master` realm，并被谨慎授予 `manage-realm`，不要用它替换成更宽的管理员权限。
4. **Authorization Services 的 URI 模板校验更严格**：重点检查空占位符（如 `/api/{}/x`）、中间通配符（如 `/api/*/x`）和多余右花括号。旧数据可能暂时保留，但下一次更新该资源时会被拒绝。
5. **`dynamic-scopes` 改名为 `parameterized-scopes`**：启动参数、部署清单和 Helm values 中若仍使用旧名称，应在升级前替换；创建参数化 scope 时还需要声明参数类型。

可以先在目标环境导出并审计配置，再执行升级；不要把“数据库迁移成功”当成兼容性验证。至少应回归：管理员登录、OIDC/SAML 登录、Token 刷新、LDAP/SCIM 同步、授权评估和反向代理后的 issuer。

## SCIM API：自动用户配置（Preview）

SCIM（System for Cross-domain Identity Management，RFC 7644）是 IAM 领域最关键的自动化标准之一。有了 SCIM API，Keycloak 可以作为 SCIM Service Provider，接受来自身份治理平台、HR 系统、其他 IDP 的用户/组 CRUD 操作。

### SCIM 解决的 IAM 痛点

没有 SCIM 时，用户入职/离职的典型流程是：
1. HR 系统录入了新员工 → IT 管理员手动在 Keycloak 创建用户
2. 员工离职了 → 管理员要在 Keycloak 和其他所有应用中手动禁用账号
3. 部门调动 → 手动改用户属性和组

有了 SCIM API：
1. HR 系统（如 Workday、飞书 People）通过 SCIM 调用 Keycloak 创建/更新/删除用户
2. Keycloak 通过内置的 Identity Provider mappers 和 User Federation 将变更同步到下游应用
3. 全程无需人工介入

### 启用方式

```bash
# 在 Keycloak 启动时启用 scim-api 预览特性
--features=preview  # 或在 features.enabled 中添加 scim-api
```

```yaml
# Operator CR 中的配置
spec:
  features:
    enabled:
      - scim-api
```

### SCIM API 端点概览

| 操作 | 端点 | 说明 |
|------|------|------|
| 创建用户 | `POST /admin/realms/{realm}/scim/v2/Users` | 支持 Enterprise User 扩展 |
| 查询用户 | `GET /admin/realms/{realm}/scim/v2/Users?filter=userName eq "alice"` | 支持过滤和分页 |
| 更新用户 | `PUT /admin/realms/{realm}/scim/v2/Users/{id}` | 全量替换 |
| 部分更新 | `PATCH /admin/realms/{realm}/scim/v2/Users/{id}` | RFC 7644 Patch 语义 |
| 删除用户 | `DELETE /admin/realms/{realm}/scim/v2/Users/{id}` | 物理删除 |
| 组管理 | `/admin/realms/{realm}/scim/v2/Groups` | 创建、查询、更新、删除 |
| Schema 发现 | `GET /admin/realms/{realm}/scim/v2/Schemas` | 客户端发现支持的属性 |
| ServiceProviderConfig | `GET /admin/realms/{realm}/scim/v2/ServiceProviderConfig` | 能力声明 |

### 与现有 SCIM 章节的关系

本书第 7 章已详细阐述 [SCIM 协议原理]({{< relref "docs/protocols/scim-protocol.md" >}})，24.2 节覆盖了 [IAM 合规与等保 2.0]({{< relref "docs/advanced-topics/iam-compliance-dengbao.md" >}}) 中对用户生命周期管理的要求。Keycloak 26.7 的 SCIM API 让这些理论有了开箱即用的实现——你可以直接在 Keycloak 上运行 SCIM 客户端（如 [scim2-client](https://github.com/osiam/scim2-client)、Azure AD SCIM 配置等）。

> **生产建议**：SCIM API 是 Preview 功能，建议先在 staging 环境启用并验证与上游系统（HR、IGA）的兼容性。关注 Keycloak 后续版本的 GA 公告。

## 多集群 HA 免外部缓存（Preview）

Keycloak 在多数据中心/多集群部署时，传统方案需要外部 Infinispan 集群来做跨站点缓存同步。26.7.0 引入了简化的多集群 HA 模式，去掉了对外部缓存集群的依赖。

### 架构变化

```
26.6.x 及之前：                   26.7.0 新方案（Preview）：
┌─────────┐  ┌─────────┐          ┌─────────┐  ┌─────────┐
│ Site A  │  │ Site B  │          │ Site A  │  │ Site B  │
│ Keycloak│  │ Keycloak│          │ Keycloak│  │ Keycloak│
└────┬─────┘ └────┬─────┘         └────┬─────┘ └────┬─────┘
     │            │                    │            │
     └───┬────────┘                    └────────────┘
         │                                   │
  ┌──────┴──────┐                      直接通信（无外部缓存层）
  │  Infinispan │
  │  (外部集群)  │
  └─────────────┘
```

这意味着运维复杂度大幅降低——不再需要维护一个单独的高可用 Infinispan 集群及对应的监控和备份。该特性目前是 Preview，建议先非关键环境验证。

## AuthZEN Authorization API（Experimental）

AuthZEN（OpenID AuthZEN Authorization API 1.0）是标准化的授权决策协议，定义了 PEP（策略执行点）和 PDP（策略决策点）之间的通用接口。Keycloak 26.7.0 实现了 PDP 角色——应用发送「subject + resource + action」的评估请求，Keycloak 返回 permit/deny 决策。

### 为什么这很重要

之前，要用 Keycloak 做细粒度授权，调用方必须依赖 Keycloak 的专有 Authorization API（`/auth/realms/{realm}/authz/protection/...`）。这意味着：
- 应用耦合了 Keycloak 的 API 模型
- 迁移到其他 PDP（如 OPA）需要改代码
- 无法在一个标准接口下做 PDP 灰度切换

AuthZEN 解决了这个问题——应用只需要知道 `POST /authzen/v1/evaluation`，返回 `{"decision": "Permit"}` 或 `{"decision": "Deny"}`。这让 Keycloak 可以和 OPA、Cedar 等其他 PDP 在同一个标准接口下互操作。

> AuthZEN 与 [IAM RBAC、ABAC、ReBAC 授权模型对比]({{< relref "docs/advanced-topics/authorization-models.md" >}}) 的内容互补——前者定义了 PDP 的接口标准，后者帮你选授权模型。

## OpenID SSF 实时安全信号（Experimental）

传统 OAuth/OIDC 模型下，用户被禁用或登出后，下游应用要等到 Token 过期（可能长达数小时）才能感知。OpenID Shared Signals Framework (SSF) 让 Keycloak 可以**主动推送**安全事件给注册的接收者。

### 支持的信号类型

| 事件类型 | 触发时机 | 下游动作 |
|---------|---------|---------|
| Session Revoked | 用户主动登出、管理员踢出会话 | 立即清除该用户的本地会话 |
| Credential Change | 用户改了密码 | 要求重新认证 |
| Account Disabled | 管理员禁用账号 | 立即阻止访问 |
| Account Purged | 用户被删除 | 清理所有关联令牌和会话 |

### 启用方式

```bash
--features=ssf
```

> SSF 与 [IAM 会话管理与 Token 生命周期]({{< relref "docs/advanced-topics/iam-session-management.md" >}}) 密切关联——SSF 解决了「Token 还没过期但身份已失效」的问题，让会话管理从事后轮询变成即时推送。

## SAML Step-up 认证（Supported）

Step-up 认证允许：「正常访问用密码就够了，但执行敏感操作（如转账、删除用户）时要额外验证」。之前这个能力只对 OIDC 客户端可用，26.7.0 把 SAML Step-up 从 Preview 提升为 Supported。

SAML SP 在 `AuthnRequest` 中指定 `RequestedAuthnContext`，Keycloak 根据配置的认证流级别判断是否需要 Step-up。对于还有大量 SAML 应用的企业（金融、政务、教育行业常见），这是一个重要的安全增强。

## Identity Brokering API V2（Supported，默认仍未启用）

身份联邦场景中，后端服务有时需要获取用户在外部 IDP 的 Token。V1 API 通过给用户分配 broker role 来控制——这不够精细且不标准。V2 改进：

- **按 Client 授权**：不是给用户赋权，而是在 Client 设置中控制
- **仅限 Confidential Client**：拒绝 Public Client
- **OAuth 2.0 兼容**：标准 `POST` + JSON 响应

26.7.0 中 V2 已获支持，但**默认仍未启用**；V1 为兼容旧客户端仍默认启用，同时已标记废弃。不要只把版本升级到 26.7.0 就假定请求已经切换到 V2。先在 staging 启用 V2 并验证客户端级授权、仅 Confidential Client 可用、`POST` 请求和标准 JSON 错误响应，再安排迁移。

## 验证

```bash
# 确认版本
curl -s https://auth.example.com/ | grep -o 'Keycloak [0-9.]*'

# 确认 SCIM API 端点可访问（需先启用）
curl -s -H "Authorization: Bearer $TOKEN" \
  https://auth.example.com/admin/realms/test/scim/v2/ServiceProviderConfig | jq .

# 确认 AuthZEN 端点
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://auth.example.com/realms/test/authzen/v1/evaluation \
  -d '{"subject":{"type":"user","id":"alice"},"resource":{"type":"document","id":"doc-1"},"action":{"name":"read"}}' | jq .

# 确认 SSF 配置（Admin Console → Realm Settings → Shared Signals）
```

## 常见问题（IAM FAQ）

### Q1：Keycloak SCIM API 和 Okta SCIM 有什么不同？

Okta SCIM 同时支持作为 Service Provider 和 Client，Keycloak 26.7 的 SCIM 目前实现的是 Service Provider 角色（接受外部系统的用户/组操作）。如果你需要 Keycloak 作为 SCIM Client 去从其他系统拉取用户，目前还是用 User Federation（LDAP/Kerberos）或 Identity Brokering 更合适。

### Q2：免外部缓存的多集群 HA 和传统的 Infinispan 方案怎么选？

传统外部 Infinispan 方案更成熟（GA），适用于对缓存一致性要求极严的场景。新方案去掉了外部依赖，运维简单，但目前是 Preview。建议：新项目可以先用新方案在 staging 验证，生产环境等 GA 后再切换。

### Q3：AuthZEN 会取代 Keycloak 现有的 Authorization Services 吗？

短期内不会。AuthZEN 是一种**标准化接口**，Keycloak 现有的 Authorization Services（resource-based policies, JavaScript/Rego policies, permission tickets）是**授权引擎**。AuthZEN 让你可以用标准方式调用这个引擎，不改变其内部策略模型。

### Q4：升级到 26.7.0 有什么注意事项？

参考 [Keycloak 升级指南](https://www.keycloak.org/docs/latest/upgrading/index.html)，重点关注：
- Identity Brokering API V1 → V2 的迁移窗口
- 数据库迁移（Liquibase）会自动执行，升级前做好数据库备份
- 如果用了自定义 SPI，确认与 26.7.0 的 API 兼容性
- 检查 `view-system`、X.509 CA subject DN、参数化 scope 和 Authorization Services URI 模板

## 回滚方式

回滚要分成两层：**应用镜像可以回退，数据库迁移不能默认当作可逆操作**。Keycloak 官方升级指南要求升级前备份数据库；如果启用了持久化用户 Session，还要按部署方式备份对应的 JDBC 或外部 Infinispan 数据。不要在 Liquibase 已经执行后直接运行下面这种通用 `pg_restore` 命令：它可能覆盖升级后产生的用户、客户端和会话数据，也不等于把 schema 安全降回旧版本。

推荐先停止流量、保留故障现场，再在隔离环境用备份验证恢复；确认旧版本确实支持该数据库 schema 后，才回退镜像。若数据库已经完成 26.7.0 迁移，优先恢复到升级前的完整数据库快照并重新执行回滚演练；没有经过验证的快照时，不要把生产数据库直接交给旧版本启动。

```bash
# 仅示意：回退应用镜像前，先确认数据库快照和恢复演练结果
kubectl -n keycloak patch keycloak production-keycloak \
  --type=merge -p '{"spec":{"image":"quay.io/keycloak/keycloak:26.6.4"}}'

# PostgreSQL 自定义格式备份的恢复示例；必须在隔离数据库执行并先确认备份类型
createdb -h postgres-host -U keycloak keycloak_restore
pg_restore -h postgres-host -U keycloak -d keycloak_restore \
  --clean --if-exists /backup/keycloak-pre-upgrade.dump

# 恢复后先做只读验证，再切换流量；不要把 restore 直接指向生产库
curl -fsS https://auth.example.com/health/ready
```

> 这不是“按一个命令撤销升级”。Keycloak 升级指南只保证升级路径中的迁移步骤，数据库恢复、密钥材料、会话数据和流量切换必须按你的备份系统单独演练。若只回退镜像而保留已迁移数据库，先在 staging 验证旧版本是否能启动；否则宁可保持新版本并修复兼容性问题，也不要用生产库做降级实验。

## 延伸阅读

- [Keycloak 26.7.0 Release Notes](https://github.com/keycloak/keycloak/releases/tag/26.7.0)
- [Keycloak 26.7.0 升级说明](https://www.keycloak.org/docs/latest/upgrading/index.html)
- [Keycloak Server Features](https://www.keycloak.org/server/features)
- [Keycloak SCIM 管理文档](https://www.keycloak.org/docs/26.7.0/server_admin/#_managing_scim)
- [Keycloak Shared Signals Framework](https://www.keycloak.org/securing-apps/ssf-support)
- [Keycloak AuthZEN Authorization](https://www.keycloak.org/securing-apps/authzen-authorization)
- [SCIM 协议原理]({{< relref "docs/protocols/scim-protocol.md" >}})
- [IAM 协议选型指南]({{< relref "docs/advanced-topics/iam-protocol-selection-guide.md" >}})
- [IAM 授权模型对比]({{< relref "docs/advanced-topics/authorization-models.md" >}})
- [IAM 会话管理]({{< relref "docs/advanced-topics/iam-session-management.md" >}})
- [第 19 章：Keycloak Kubernetes 生产部署]({{< relref "docs/implementation/kubernetes-production.md" >}})（已更新至 26.7.0）
- [Keycloak 高可用集群部署与灾难恢复]({{< relref "keycloak-ha-dr" >}})
