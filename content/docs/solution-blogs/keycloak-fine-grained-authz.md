---
title: "Keycloak 细粒度权限与授权策略实战 — Groups vs Roles、Authorization Services | IDaaS Book"
description: "Keycloak 细粒度授权实战：Groups 与 Roles 的选择、Composite Roles 组合角色、Authorization Services 策略配置与 Policy Evaluation 调试"
date: 2026-07-09T00:00:00+08:00
lastmod: 2026-07-09T00:00:00+08:00
draft: false
weight: 8
contributors: []
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-fine-grained-authz"
toc: true
tags:
  - keycloak
  - authorization
  - rbac
---

## 场景

你已经在 Keycloak 里配好了 Realm、Client 和用户，SSO 登录也跑通了。现在业务方提了三个需求：

1. "这个 API 只有管理员能调，普通用户不行"
2. "同一个 API，部门 A 的人能写、部门 B 的人只能读"
3. "用户可以查看自己的订单，但不能看别人的"

你在 Keycloak 的 Groups、Roles、Composite Roles、Authorization Services 之间绕晕了——到底该用哪个？配了半天 Policy Evaluation 还是不通过。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 需要对单个资源做细粒度控制（按 HTTP 方法、URI、资源属性） | 只需要简单的「已登录/未登录」判断 |
| 多个应用共用 Keycloak，授权规则各不相同 | 授权规则完全由应用内部代码管理 |
| 需要 ABAC/ReBAC 混合模型 | 只需要 OAuth 2.0 Scope 就够了 |
| 有管理后台需要按角色区分菜单可见性 | 你的应用根本不区分角色 |

## 核心概念速览

在深入配置之前，先理清几个最容易混淆的概念：

### Group vs Role

| | Group | Role |
|---|---|---|
| **本质** | 用户的组织归属 | 用户的权限标签 |
| **典型值** | `engineering`、`sales`、`cn-team` | `admin`、`viewer`、`order-manager` |
| **能嵌套吗** | ✅ 支持子 Group | ✅ 通过 Composite Role 嵌套 |
| **适合干什么** | 按部门/团队分组、LDAP 映射 | 授予具体权限、做 RBAC |
| **不适合干什么** | 直接做权限判断 | 表达部门层级关系 |

**简单原则**：Group 说「你是谁的人」，Role 说「你能干什么」。一个用户可以有多个 Group 和多个 Role。

### Realm Role vs Client Role

| | Realm Role | Client Role |
|---|---|---|
| **作用域** | 整个 Realm 通用 | 仅某个 Client 可见 |
| **典型场景** | `global-admin`、`auditor` | `app-a:editor`、`app-b:viewer` |
| **使用建议** | 跨应用共享的角色 | 每个应用自己的角色 |

**实践建议**：默认用 Client Role，只有真正跨应用的角色才用 Realm Role。这样每个应用的角色命名空间独立，不会互相污染。

### Composite Role（组合角色）

Composite Role 就是一个角色「包含」其他角色。比如：

- `order-admin` 是一个 Composite Role
- 它包含 `order-viewer` + `order-editor` + `order-exporter`
- 把 `order-admin` 赋给用户，自动拥有三个子角色的全部权限

这比给每个用户逐个赋三个角色更清爽，也方便统一调整。

## 方案一：基于 Roles 的简单 RBAC

### Keycloak 端配置

**1. 创建 Client Roles**

在目标 Client → Roles 下创建：

```
app-admin
app-user
app-viewer
```

**2. 创建 Composite Role**

创建 `app-admin` 时勾选 Composite，添加关联角色 `app-user`、`app-viewer`。

**3. 给用户分配角色**

Users → 目标用户 → Role Mapping → Assign Role → 选择对应的 Client Role。

### 应用端读取角色

应用的 JWT Token（Access Token）中会包含 `realm_access.roles` 和 `resource_access.<client-id>.roles`：

```json
{
  "realm_access": {
    "roles": ["default-roles-myapp", "offline_access", "uma_authorization"]
  },
  "resource_access": {
    "my-app": {
      "roles": ["app-admin"]
    }
  }
}
```

应用代码据此做权限判断（以 Spring Security 为例）：

```java
@PreAuthorize("hasRole('app-admin')")
@GetMapping("/admin/users")
public List<User> listUsers() { ... }

@PreAuthorize("hasAnyRole('app-admin', 'app-user')")
@GetMapping("/api/orders")
public List<Order> listOrders() { ... }
```

### 验证

```bash
# 获取 Token
TOKEN=$(curl -s -X POST "https://keycloak.example.com/realms/myapp/protocol/openid-connect/token" \
  -d "client_id=my-app" \
  -d "username=testuser" \
  -d "password=testpass" \
  -d "grant_type=password" | jq -r '.access_token')

# 解码 Token 看 roles
echo "$TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq '.resource_access."my-app".roles'
```

### 这个方案够用吗？

- ✅ 大多数中小型应用的 RBAC 需求
- ✅ 配置简单，应用端适配成本低
- ❌ 做不到「同一个 API 按 HTTP 方法区分权限」
- ❌ 做不到「部门 A 看自己的数据，部门 B 看自己的」

当你需要**资源级别**的权限控制时，就需要 Authorization Services。

## 方案二：Keycloak Authorization Services（细粒度授权）

Keycloak Authorization Services 基于 UMA 2.0 和 OAuth 2.0，核心模型是：

```
Resource（资源） → Scope（操作）→ Policy（策略）→ Permission（权限）
```

- **Resource**：你要保护的东西（如 `/api/orders`、`Order:123`）
- **Scope**：对资源的操作（如 `view`、`edit`、`delete`）
- **Policy**：谁可以操作（角色策略、用户策略、JS 策略、Group 策略等）
- **Permission**：把 Resource + Scope + Policy 绑在一起

### 最小可运行配置

#### Step 1: 启用 Authorization Services

Client → Settings → Authorization Enabled → ON

启用后，Client 页面会出现 Authorization 标签页。

#### Step 2: 创建 Resource

Authorization → Resources → Create resource：

| 字段 | 值 | 说明 |
|------|-----|------|
| Name | `Orders API` | 资源名称 |
| Display name | `订单管理 API` | 显示名称 |
| URIs | `/api/orders/*` | 匹配的 URI 模式 |
| Scopes | `view`, `create`, `edit`, `delete` | 该资源支持的操作 |

#### Step 3: 创建 Policies

Authorization → Policies → Create policy → Role：

**Policy 1: 管理员完全访问**

| 字段 | 值 |
|------|-----|
| Name | `Admin Full Access` |
| Roles | `app-admin` |
| Logic | Positive |

**Policy 2: 普通用户只读**

| 字段 | 值 |
|------|-----|
| Name | `User Read Only` |
| Roles | `app-user` |
| Logic | Positive |

#### Step 4: 创建 Permissions

Authorization → Permissions → Create permission → Scope-Based：

**Permission 1: 管理员全部操作**

| 字段 | 值 |
|------|-----|
| Name | `Admin can manage orders` |
| Resources | `Orders API` |
| Scopes | `view`, `create`, `edit`, `delete` |
| Policies | `Admin Full Access` |
| Decision Strategy | Affirmative |

**Permission 2: 普通用户只能查看**

| 字段 | 值 |
|------|-----|
| Name | `User can view orders` |
| Resources | `Orders API` |
| Scopes | `view` |
| Policies | `User Read Only` |
| Decision Strategy | Affirmative |

#### Step 5: 测试 Policy Evaluation

Authorization → Evaluate：

1. 输入测试用户
2. 选择 Resource: `Orders API`
3. 选择 Scope: `edit`
4. 如果用户是 `app-admin` → **PERMIT**
5. 如果用户是 `app-user` → **DENY**

### 应用端集成

应用端有两种集成方式：

**方式 A：请求方令牌（Bearer Token，主动授权检查）**

```bash
# 获取 RPT（Requesting Party Token）
curl -X POST "https://keycloak.example.com/realms/myapp/protocol/openid-connect/token" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:uma-ticket" \
  -d "audience=my-app" \
  -d "permission=Orders API#view" \
  -H "Authorization: Bearer $USER_TOKEN"
```

返回的 RPT 中包含该用户对 `Orders API` 的 `view` 权限。

**方式 B：应用端本地检查（策略执行点模式）**

应用通过 Keycloak 的 Token Introspection 或本地解析 Access Token 判断权限：

```java
// Spring Security + Keycloak Adapter 模式
@GetMapping("/api/orders")
public List<Order> listOrders() {
    // 应用自行检查 JWT 中的 roles/scopes
}
```

**方式 C：Keycloak Policy Enforcer（推荐）**

在 `keycloak.json` 或 `application.properties` 中配置：

```properties
keycloak.policy-enforcer-config.enforcement-mode=ENFORCING
keycloak.policy-enforcer-config.paths[0].path=/api/orders/*
keycloak.policy-enforcer-config.paths[0].methods[0].method=GET
keycloak.policy-enforcer-config.paths[0].methods[0].scopes=view
```

应用不写权限代码，所有授权判断由 Keycloak Adapter 在请求入口完成。

## 方案三：使用 Groups 做部门级数据隔离

当授权不只是「能不能访问 API」而是「能看到哪些数据」时，Groups 更合适。

### 场景

- 浙江分公司的员工只能查看浙江的订单
- 上海分公司的员工只能查看上海的订单

### 配置

1. 创建 Groups: `/china/zhejiang`、`/china/shanghai`
2. 创建 Group-based Policy：`Zhejiang Users`（绑定 `/china/zhejiang` Group）
3. 创建 Resource: `Orders-Zhejiang`（URI: `/api/orders?region=zhejiang`）
4. Permission: `Zhejiang Users` → `Orders-Zhejiang` → `view`

### 应用端实现

应用的 `/api/orders` 接受 `region` 查询参数，根据当前用户的 Groups 做过滤：

```java
@GetMapping("/api/orders")
public List<Order> listOrders(Authentication auth) {
    Set<String> groups = auth.getAuthorities().stream()
        .map(GrantedAuthority::getAuthority)
        .filter(g -> g.startsWith("ROLE_GROUP_"))
        .collect(Collectors.toSet());

    if (groups.contains("/china/zhejiang")) {
        return orderService.findByRegion("zhejiang");
    }
    // ...
}
```

> **注意**：Keycloak 默认不会把 Groups 放进 JWT。需要添加 Group Mapper（Client → Client Scopes → 对应的 scope → Mappers → Add mapper → Group Membership），勾选 "Full group path"。

## 常见错误

| 症状 | 原因 | 解决 |
|------|------|------|
| Policy Evaluation 始终 DENY | 用户没有 Policy 要求的 Role/Group | 检查用户 Role Mapping，确认角色已分配 |
| RPT 请求返回 403 | Client 未启用 Authorization Services | Client → Settings → Authorization Enabled |
| JWT 中没有 Groups | 缺少 Group Mapper | 添加 Group Membership Mapper |
| 改了策略不生效 | Authorization 缓存 | 清除 Keycloak 缓存或重启；生产环境设短 TTL |
| `resource_access` 为空 | Client 没有定义 Client Roles | 先在 Client → Roles 创建角色 |
| Composite Role 的子角色不生效 | 子角色分配到了 Realm Role 而非同一 Client | Composite Role 的子角色必须在同一 Client Scope 内 |

## 回滚方式

- **角色分配回滚**：Users → Role Mapping → 移除错误角色重新分配
- **Authorization Services 回滚**：Client → Settings → Authorization Enabled → OFF（所有策略和权限配置保留在数据库但不再生效）
- **Policy 回滚**：删除有问题的 Policy 或 Permission，重建
- **生产环境注意**：Authorization Services 的配置变更会立即生效，建议先在 Staging 环境验证 Policy Evaluation 结果再上线

## 什么时候用哪种方案

| 需求 | 方案 |
|------|------|
| 按角色区分 API 访问（管理员 vs 普通用户） | Realm/Client Roles + 应用端判断 |
| 同一个 API 按 HTTP 方法区分权限 | Authorization Services + Scope-Based Permission |
| 按用户属性/部门做数据隔离 | Groups + Group-Based Policy + 应用过滤 |
| 需要动态可配置的权限规则 | Authorization Services + JavaScript Policy |
| 第三方应用访问 API 时做 Scope 限制 | OAuth 2.0 Scopes（Client → Client Scopes） |

## 与其他章节的关联

- [RBAC、ABAC、ReBAC 授权模型对比]({{< relref "../advanced-topics/authorization-models" >}}) — 全局视角的授权模型选型
- [Keycloak 架构详解]({{< relref "../implementation/keycloak-architecture" >}}) — Keycloak 内部 Realm/Role/Group 的组织模型
- [OAuth 2.0 协议深入]({{< relref "../protocols/oauth2-deep-dive" >}}) — OAuth Scopes 与 Authorization Server 的工作原理
- [Keycloak + oauth2-proxy 集成]({{< relref "keycloak-oauth2-proxy" >}}) — 网关层认证后，应用层授权的配合方式
