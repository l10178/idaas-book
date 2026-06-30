---
title: "Keycloak Admin REST API 调用"
description: "Keycloak Admin REST API 实战：认证鉴权、Realm/Client/User/Role/Group 增删改查、curl 与各语言 SDK 示例、分页与批量操作、权限模型与最佳实践"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-admin-api"
toc: true
---

Keycloak 提供完整的 **Admin REST API**，几乎覆盖管理控制台的全部能力——Realm、Client、User、Role、Group、认证流、事件等均可通过 HTTP 调用管理。本节讲解认证方式、核心端点、典型 CRUD 实战与 SDK 选型，让你能用脚本/服务把身份管理自动化。

> Keycloak 17（Quarkus）起默认上下文路径为 `/`，API 前缀为 `/admin/realms`；旧版本（WildFly）前缀为 `/auth/admin/realms`。下文以 Quarkus 新路径为准，旧版自行补 `/auth`。

## 认证与鉴权

调用 Admin API 需要一个拥有管理权限的 `access_token`，通过 OAuth 2.0 Password Grant 或 Client Credentials Grant 获取。

### 方式一：Password Grant（admin-cli，适合脚本）

```bash
TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=admin" \
  -d "password=${ADMIN_PWD}" \
  | jq -r .access_token)
```

### 方式二：Client Credentials Grant（适合服务对接）

先在 `master` 或目标 Realm 创建一个 `confidential` Client，赋予 `realm-management` 中相应角色（如 `manage-users`、`view-realm`、`manage-clients`）：

```bash
TOKEN=$(curl -s -X POST \
  "http://localhost:8080/realms/master/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=admin-bot" \
  -d "client_secret=${SECRET}" \
  | jq -r .access_token)
```

> 生产推荐 **Client Credentials**：用专用服务账号 + 最小角色，而非暴露 admin 用户密码。`access_token` 默认 5 分钟，请缓存并在过期前刷新。

调用示例：

```bash
curl -s "http://localhost:8080/admin/realms/master/users" \
  -H "Authorization: Bearer ${TOKEN}"
```

## 核心 API 端点速查

| 资源 | 方法 | 路径 | 说明 |
|------|------|------|------|
| Realm | GET/POST | `/admin/realms` | 列出 / 创建 Realm |
| Realm | GET/PUT/DELETE | `/admin/realms/{realm}` | 查 / 改 / 删 单个 Realm |
| Client | GET/POST | `/admin/realms/{realm}/clients` | 列出 / 创建 Client |
| Client | GET | `/admin/realms/{realm}/clients/{id}/installation` | 获取接入配置 |
| User | GET/POST | `/admin/realms/{realm}/users` | 列出（支持过滤）/ 创建用户 |
| User | PUT/DELETE | `/admin/realms/{realm}/users/{id}` | 改 / 删 用户 |
| User | PUT | `/admin/realms/{realm}/users/{id}/reset-password` | 重置密码 |
| Role | GET/POST | `/admin/realms/{realm}/roles` | Realm 级角色 |
| Role mapping | POST | `/admin/realms/{realm}/users/{id}/role-mappings/realm` | 给用户授角色 |
| Group | GET/POST | `/admin/realms/{realm}/groups` | 用户组管理 |
| Events | GET | `/admin/realms/{realm}/events` | 查询事件审计 |
| Attack | DELETE | `/admin/realms/{realm}/attack-detection/brute-force/users/{id}` | 清除暴力破解锁定 |

完整文档见 `http://localhost:8080/admin/realms/master/`（OpenAPI）或官方 [Admin REST API][admin-api-docs]。

## 用户增删改查端到端

详细的 curl 全流程（获取 token → 列出 → 创建 → 解析 Location → 删除）见 [用户增删改查端到端]({{< relref "docs/keycloak/admin-api/user-end2end.md" >}})。这里补充更贴近生产的片段。

### 创建用户并分配角色

```bash
# 1. 创建用户
USER_LOCATION=$(curl -s -i -X POST \
  "http://localhost:8080/admin/realms/myrealm/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "enabled": true,
    "emailVerified": true,
    "credentials": [
      { "type": "password", "value": "P@ssw0rd!", "temporary": false }
    ]
  }' | grep -i '^location:' | awk '{print $2}' | tr -d '\r')

USER_ID=$(basename "${USER_LOCATION}")

# 2. 查询角色 ID
ROLE_ID=$(curl -s "http://localhost:8080/admin/realms/myrealm/roles/app-admin" \
  -H "Authorization: Bearer ${TOKEN}" | jq -r .id)

# 3. 把角色授予用户
curl -s -X POST \
  "http://localhost:8080/admin/realms/myrealm/users/${USER_ID}/role-mappings/realm" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "[{\"id\":\"${ROLE_ID}\",\"name\":\"app-admin\"}]"
```

### 列出用户（分页与过滤）

```bash
# 分页 + 用户名模糊搜索
curl -s "http://localhost:8080/admin/realms/myrealm/users?first=0&max=20&search=ali" \
  -H "Authorization: Bearer ${TOKEN}" | jq

# 统计总数
curl -s "http://localhost:8080/admin/realms/myrealm/users/count" \
  -H "Authorization: Bearer ${TOKEN}"
```

### 重置密码与发送 Required Action

```bash
# 管理员重置密码
curl -s -X PUT \
  "http://localhost:8080/admin/realms/myrealm/users/${USER_ID}/reset-password" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"type":"password","value":"NewP@ss1!","temporary":true}'

# 触发「下次登录必须改密」邮件
curl -s -X PUT \
  "http://localhost:8080/admin/realms/myrealm/users/${USER_ID}/execute-actions-email" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "actions=UPDATE_PASSWORD"
```

## 各语言 SDK

| 语言 | 推荐库 | 说明 |
|------|--------|------|
| Java | `keycloak-admin-client`（官方，JAX-RS） | 与 Keycloak 同源，功能最全 |
| Python | `python-keycloak` | 社区维护，覆盖常用 Admin/Token 操作 |
| Go | `github.com/Nerzal/gocloak` | 社区维护，API 完整 |
| Node.js | `keycloak-admin`（npm） | 适合 BFF / 自动化脚本 |
| 通用 | curl + `jq` | 运维 / CI 脚本 |

### Java 示例

```java
Keycloak kc = KeycloakBuilder.builder()
    .serverUrl("http://localhost:8080")
    .realm("master")
    .clientId("admin-cli")
    .username("admin")
    .password(ADMIN_PWD)
    .build();

UserRepresentation user = new UserRepresentation();
user.setUsername("alice");
user.setEmail("alice@example.com");
user.setEnabled(true);
kc.realm("myrealm").users().create(user);
```

## 权限模型与最佳实践

- **最小权限**：为自动化客户端单独建 Client，授予 `realm-management` 中需要的角色，避免使用 `admin` 账号。
- **跨 Realm 管理**：管理 `master` Realm 的 token 可操作任意 Realm；也可在每个 Realm 内建 `realm-admin` 角色组实现委托管理。
- **幂等创建**：用户名/邮箱唯一约束，创建前先 `?username=xxx` 查询，避免 409。
- **批量操作**：Admin API 无原生批量端点，循环调用即可；大批量导入建议用 `kc.sh import --file users.json` 离线导入。
- **审计**：所有 Admin API 调用默认产生 `admin_event`，可在 Realm → Events 中开启保存，便于追溯谁在什么时间改了什么。
- **HTTPS**：生产必须通过反代终结 TLS，禁止明文传输 token。

## 小结

Admin REST API 是把 Keycloak 纳入自动化运维和上游用户中心的关键通道。掌握「服务账号 + Client Credentials + 最小角色」的鉴权模式、核心端点与对应 SDK，即可替代绝大多数控制台手工操作。下一节进入安全防护专题。

[admin-api-docs]: https://www.keycloak.org/docs-api/latest/rest-api/index.html