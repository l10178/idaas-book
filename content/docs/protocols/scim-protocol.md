---
title: "第9章：SCIM 协议"
description: "跨域身份管理系统（SCIM 2.0）协议深度解读：用户和组的标准化配置与管理"
date: 2024-02-05T00:00:00+08:00
draft: false
weight: 25
menu:
  docs:
    parent: "protocols"
    identifier: "scim-protocol"
toc: true
---

## 9.1 为什么需要 SCIM？

OAuth 2.0 和 OIDC 解决了认证和授权问题，SAML 解决了联邦 SSO 问题，但它们都没有回答一个问题：如何标准化地创建、更新和删除用户？

在 SCIM 出现之前，每个系统都有自己的用户 API：

```
App1: POST /api/v1/users {"name": "..."}     ← 每种格式都不一样
App2: PUT /rest/user/create {"userName": "..."}
App3: SOAP <CreateUser><Name>...</Name></CreateUser>
```

**SCIM（System for Cross-domain Identity Management）** 就是为了结束这种混乱而生的标准。它是由 IETF 制定的 HTTP 协议（RFC 7642/7643/7644），使用 JSON 作为数据格式。

## 9.2 SCIM 的核心概念

### 核心数据模型

SCIM 定义了核心资源类型：

#### User 资源

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "2819c223-7f76-453a-919d-413861904646",
  "externalId": "employee-12345",
  "userName": "zhangsan@example.com",
  "name": {
    "formatted": "张三",
    "familyName": "张",
    "givenName": "三"
  },
  "displayName": "张三",
  "nickName": "小张",
  "profileUrl": "https://connect.example.com/zhangsan",
  "title": "高级工程师",
  "userType": "员工",
  "preferredLanguage": "zh-CN",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai",
  "active": true,
  "emails": [
    {
      "value": "zhangsan@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "phoneNumbers": [
    {
      "value": "+86-13800138000",
      "type": "mobile"
    }
  ],
  "groups": [
    {
      "value": "e9e30dba-f08f-4109-8486-d5c6a331660a",
      "$ref": "/Groups/e9e30dba-f08f-4109-8486-d5c6a331660a",
      "display": "工程师组"
    }
  ],
  "roles": [
    {
      "value": "admin",
      "display": "管理员"
    }
  ],
  "meta": {
    "resourceType": "User",
    "created": "2024-01-01T08:00:00Z",
    "lastModified": "2024-01-15T09:30:00Z",
    "location": "/Users/2819c223-7f76-453a-919d-413861904646",
    "version": "W/\"3694e05e9dff592\""
  }
}
```

#### Group 资源

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "e9e30dba-f08f-4109-8486-d5c6a331660a",
  "displayName": "工程师组",
  "members": [
    {
      "value": "2819c223-7f76-453a-919d-413861904646",
      "$ref": "/Users/2819c223-7f76-453a-919d-413861904646",
      "display": "张三"
    }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2024-01-01T08:00:00Z",
    "lastModified": "2024-01-15T09:30:00Z"
  }
}
```

### Schema 扩展

SCIM 支持通过扩展 Schema 添加自定义属性：

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
    "urn:example:params:scim:schemas:extension:custom:1.0:User"
  ],
  "userName": "zhangsan@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "EMP-12345",
    "costCenter": "CC-Beijing-01",
    "organization": "技术部",
    "division": "平台研发",
    "department": "基础架构",
    "manager": {
      "value": "manager-id",
      "displayName": "李四"
    }
  },
  "urn:example:params:scim:schemas:extension:custom:1.0:User": {
    "accessLevel": "vip",
    "region": "north-china"
  }
}
```

Enterprise User 扩展（`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`）是预定义的扩展，包含企业常见的属性：`employeeNumber`、`organization`、`department`、`manager` 等。

## 9.3 SCIM 操作

### RESTful API

SCIM 使用标准的 RESTful API 风格：

```
GET    /Users              — 搜索用户（支持过滤、排序、分页）
POST   /Users              — 创建用户
GET    /Users/{id}         — 获取特定用户
PUT    /Users/{id}         — 完整替换用户
PATCH  /Users/{id}         — 部分更新用户
DELETE /Users/{id}         — 删除用户

GET    /Groups             — 搜索组
POST   /Groups             — 创建组
GET    /Groups/{id}        — 获取特定组
PATCH  /Groups/{id}        — 更新组（包括修改组成员）
DELETE /Groups/{id}        — 删除组

GET    /ServiceProviderConfig  — 服务提供方配置
GET    /ResourceTypes          — 可用资源类型
GET    /Schemas                — 可用 Schema
```

### 搜索与过滤

SCIM 支持强大的过滤语法：

```
# 精确匹配
GET /Users?filter=userName eq "zhangsan@example.com"

# 前缀匹配
GET /Users?filter=userName sw "zhang"

# 包含判断
GET /Users?filter=emails[type eq "work"].value co "example.com"

# 复合条件
GET /Users?filter=userType eq "员工" and active eq true

# 组成员查询
GET /Users?filter=groups[value eq "group-id"]

# 分页
GET /Users?startIndex=1&count=100

# 选择性返回属性
GET /Users?attributes=userName,name,emails

# 排除属性
GET /Users?excludedAttributes=password,securityQuestions
```

### PATCH 操作

PATCH 是 SCIM 最精妙的设计之一，支持 JSON Patch（RFC 6902）：

```json
// 添加新属性
PATCH /Users/user-123
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "emails",
      "value": [{"value": "zhangsan@personal.com", "type": "home"}]
    }
  ]
}

// 替换属性
{
  "Operations": [
    {
      "op": "replace",
      "path": "title",
      "value": "资深工程师"
    }
  ]
}

// 移除属性
{
  "Operations": [
    {
      "op": "remove",
      "path": "emails[type eq \"home\"]"
    }
  ]
}
```

## 9.4 实际集成场景

### 场景一：HR 系统 → IDaaS

最常见的 SCIM 应用场景：

```
HR 系统（Workday/PeopleSoft）
    │
    │ SCIM 2.0 Bootstrap
    ▼
IDaaS（自动创建用户）
    │
    │ SCIM / 自定义 API
    ▼
下游应用（Slack、GitHub、Jira...）
```

当员工在 HR 系统中被录用时：
1. HR 系统通过 SCIM 将新员工推送到 IDaaS
2. IDaaS 根据规则自动创建账户、分配组
3. IDaaS 通过 SCIM 或应用连接器将用户同步到下游应用

### 场景二：IDaaS → SaaS 应用

IDaaS 通过 SCIM 向 SaaS 应用提供用户：

```
IDaaS → SCIM → Salesforce (预置用户)
IDaaS → SCIM → Google Workspace (预置用户)
IDaaS → SCIM → Microsoft 365 (预置用户)
```

### 去预置（De-provisioning）

SCIM 同样用于离职用户的清理：

- PATCH `/Users/{id}` `{"active": false}` — 暂停用户
- DELETE `/Users/{id}` — 删除用户

## 9.5 实现 SCIM 服务端

如果要自己实现 SCIM 服务端，核心组件包括：

1. **资源定义**：User、Group 的资源 Schema
2. **过滤解析器**：解析 SCIM filter 语法
3. **排序和分页**：支持 SCIM 风格的排序和分页
4. **PATCH 解释器**：解析和执行 PATCH 操作
5. **ETag 支持**：版本控制，乐观锁
6. **错误处理**：SCIM 标准错误格式

**推荐做法**：使用成熟的库，而不是从头实现。Java 生态中，可以使用 Apache SCIMple 或 WSO2 Charon；Go 生态中可以使用 `github.com/elimity-com/scim`。

## 9.6 安全考量

1. **认证**：SCIM 端点必须认证，通常使用 Bearer Token（OAuth 2.0）。
2. **TLS 必须启用**：所有 SCIM 通信必须通过 HTTPS。
3. **授权**：分离读权限和写权限，不同的 SCIM 使用者应有不同的权限。
4. **速率限制**：防止批量操作导致系统过载。
5. **审计日志**：记录所有 SCIM 操作的审计日志。
6. **敏感属性保护**：不要在 SCIM 响应中返回密码、加密密钥等敏感信息。

## 9.7 小结

SCIM 2.0 是 IDaaS 世界中"用户配置"的标准语言。它将身份管理从"手工操作"和"定制脚本"升级为标准化、自动化的 API 调用。对于 IDaaS 平台选型，SCIM 支持的质量——尤其对标标准用户 Schema、过滤语法、PATCH 操作——是评估的重要维度。
