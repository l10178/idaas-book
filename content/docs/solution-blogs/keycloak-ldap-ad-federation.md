---
title: "Keycloak LDAP / Active Directory 用户联邦 — 配置、同步与排错 | IDaaS Book"
description: "Keycloak 对接企业 LDAP 和 Active Directory 的完整实战指南：连接配置、用户搜索与同步策略、属性映射、组导入与排错"
date: 2026-07-09T00:00:00+08:00
lastmod: 2026-07-09T00:00:00+08:00
draft: false
weight: 3
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-ldap-ad-federation"
toc: true
---

## 场景

你所在的企业已经用 Active Directory 或 OpenLDAP 管理员工账号多年。现在引入 Keycloak 做统一认证，但不可能把所有用户手动迁移到 Keycloak 本地数据库——需要 Keycloak 直接对接现有的 LDAP/AD，让用户用域账号登录，管理员在原系统维护用户。

一句话：**LDAP/AD 是权威用户源，Keycloak 消费但不拥有这些用户**。

## 适用 / 不适用

| 适用场景 | 不适用场景 |
|----------|------------|
| 企业已有 AD/LDAP，不能动用户库 | 新建系统、无遗留目录服务（直接用 Keycloak 本地用户即可） |
| 需要 LDAP 用户和 Keycloak 本地用户混合认证 | 需要 Keycloak 写入 LDAP（User Federation 默认只读同步） |
| 多个 Realm 共享同一个 LDAP 源 | LDAP schema 与标准差异极大、需要大量自定义逻辑 |

## 最小配置

### Keycloak 侧：添加 LDAP User Federation

1. 进入目标 Realm → **User federation** → **Add Ldap provider**。
2. 填写连接参数（以 AD 为例，OpenLDAP 见下节差异表）：

| 参数 | 示例值 (AD) | 说明 |
|------|-------------|------|
| **Vendor** | Active Directory | 选择 `Active Directory` 后 Keycloak 会自动调整部分默认值 |
| **Connection URL** | `ldaps://dc.example.com:636` | 生产必须用 LDAPS（端口 636），不要用裸 LDAP |
| **Bind DN** | `CN=svc_keycloak,CN=Users,DC=example,DC=com` | 专用服务账号，不要用域管理员 |
| **Bind Credential** | 服务账号密码 | 使用 `vault` / Kubernetes Secret 注入，别写死在配置里 |
| **Users DN** | `CN=Users,DC=example,DC=com` | LDAP 中存放用户条目的基础 DN |
| **Edit Mode** | `READ_ONLY` | 生产环境必须 READ_ONLY，避免 Keycloak 侧修改污染 LDAP |

3. 配置用户搜索：

| 参数 | 值 | 说明 |
|------|-----|------|
| **Username LDAP attribute** | `sAMAccountName` (AD) / `uid` (OpenLDAP) | 作为 Keycloak 用户名的 LDAP 属性 |
| **RDN LDAP attribute** | `cn` (AD) / `uid` (OpenLDAP) | 条目的命名属性 |
| **UUID LDAP attribute** | `objectGUID` (AD) / `entryUUID` (OpenLDAP) | 不可变的唯一标识，用于追踪用户 |
| **User Object Classes** | `person, organizationalPerson, user` (AD) / `inetOrgPerson, organizationalPerson` (OpenLDAP) | 过滤用户条目的 objectClass |

4. 可选：LDAP 过滤器限制同步范围：

```
# 只同步 IT 部门的启用用户
(&(objectCategory=person)(department=IT)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
```

> 过滤器里的 `userAccountControl:1.2.840.113556.1.4.803:=2` 是 AD 中标志“禁用账户”的位运算写法。生产环境务必过滤掉禁用账户，否则离职员工仍可通过 LDAP 同步拥有 Keycloak 账号。

5. 保存。Keycloak 会立即尝试连接 LDAP 并验证配置。

### 配置 Mappers（属性映射）

User Federation 的 Mappers 控制 LDAP 属性如何映射为 Keycloak 用户属性：

| Mapper 类型 | 用途 | 关键配置 |
|-------------|------|----------|
| **username** | 默认已创建 | 确认 `LDAP Attribute` 与 Username LDAP attribute 一致 |
| **email** | 同步邮箱 | LDAP Attribute = `mail`，Email Verified 可按需设置 |
| **full name** | 同步全名 | LDAP Attribute = `displayName` (AD) / `cn` (OpenLDAP) |
| **group-ldap-mapper** | 同步 LDAP 组到 Keycloak Groups | Groups DN、Group Object Classes、Membership LDAP Attribute |
| **user-attribute-ldap-mapper** | 自定义属性（部门、工号等） | 逐属性添加，LDAP Attribute → User Model Attribute |
| **role-ldap-mapper** | 将 LDAP 组映射为 Keycloak Realm/Client 角色 | 仅当需要 LDAP 组直接对应应用权限时使用 |

**组同步的核心配置**（group-ldap-mapper）：

| 参数 | 示例值 (AD) | 说明 |
|------|-------------|------|
| **LDAP Groups DN** | `CN=Users,DC=example,DC=com` | 存放组条目的基础 DN，通常与 Users DN 相同 |
| **Group Name LDAP Attribute** | `cn` | 组条目的名称属性 |
| **Group Object Classes** | `group` | 过滤组条目的 objectClass |
| **Membership LDAP Attribute** | `member` | 组成员属性（AD 用 `member`，有些 LDAP 用 `uniqueMember`） |
| **Membership Attribute Type** | `DN` | `member` 的值是用户 DN |
| **Mode** | `READ_ONLY` | 与 User Federation 的 Edit Mode 保持一致 |
| **Preserve Group Inheritance** | `ON` | 保留 LDAP 组的层级关系，否则扁平导入 |

### 同步策略

Keycloak 提供三种同步触发方式：

| 方式 | 命令/操作 | 适用场景 |
|------|-----------|----------|
| **手动全量同步** | Admin Console → Synchronize all users | 初次导入、调试 |
| **手动增量同步** | Admin Console → Synchronize changed users | 变更较少的日常维护 |
| **定期后台同步** | User Federation → Settings → Periodic Full Sync / Changed Users Sync | 生产环境：全量（每周/每天）+ 增量（每 15-60 分钟） |

```bash
# 也可以通过 Admin CLI 触发同步
# 获取 ldap provider 的 component ID
COMPONENT_ID=$(kcadm.sh get components -r myrealm -q name=ldap --fields id | jq -r '.[0].id')

# 触发增量同步
kcadm.sh create components/$COMPONENT_ID/sync-changed -r myrealm -s action=triggerFullSync

# 触发全量同步
kcadm.sh create components/$COMPONENT_ID/sync -r myrealm -s action=triggerFullSync
```

> 生产经验：全量同步耗时与 LDAP 规模正比，10 万级用户全量同步可达数十分钟。不要在业务高峰期跑全量同步。如果 LDAP 服务器性能有限，改走增量同步 + 夜间全量的策略。

## AD 与 OpenLDAP 关键差异

| 配置项 | Active Directory | OpenLDAP |
|--------|-----------------|----------|
| Vendor | Active Directory | LDAP（默认） |
| Username attribute | `sAMAccountName` | `uid` |
| RDN attribute | `cn` | `uid` |
| UUID attribute | `objectGUID` | `entryUUID` |
| User Object Classes | `person, organizationalPerson, user` | `inetOrgPerson, organizationalPerson` |
| Group Membership | `member`（DN 格式） | `member` 或 `uniqueMember` |
| 禁用账户过滤 | `!(userAccountControl:1.2.840.113556.1.4.803:=2)` | 取决于具体实现，通常通过 `pwdAccountLockedTime` |

## 验证

配置完成后按以下顺序验证，不要跳：

### 1. 连通性验证

```bash
# 用 Keycloak 服务账号手动验证 LDAP 可访问
ldapsearch -H ldaps://dc.example.com:636 \
  -D "CN=svc_keycloak,CN=Users,DC=example,DC=com" \
  -w "password" \
  -b "CN=Users,DC=example,DC=com" \
  "(&(objectClass=user)(sAMAccountName=testuser))" \
  sAMAccountName mail displayName
```

### 2. Keycloak 侧搜索验证

在 Admin Console → Users → 搜索一个 LDAP 用户。如果刚配置完搜不到：
- 确认 User Federation 的 Edit Mode 不是 `UNSYNCED`
- 手动触发一次同步（Synchronize all users）
- 检查 Keycloak 服务端日志 `server.log`，看是否有 LDAP 连接失败、Bind 失败或搜索语法错误

### 3. 登录验证

用 LDAP 用户账号尝试登录 Keycloak（账号密码是 LDAP 密码，不是 Keycloak 本地密码）。首次登录成功后，Keycloak 会为此用户创建本地缓存实体（`FED_LINK` 指向 LDAP）。

### 4. 组映射验证

登录后检查用户 Token 或 Admin Console → 用户详情 → Groups，确认 LDAP 组已正确导入并关联。

### 5. 增量同步验证

在 LDAP 中新增一个测试用户或修改某个用户属性 → 等待一个增量同步周期或手动触发 → 在 Keycloak 中检查变更是否生效。

## 常见错误症状表

| 症状 | 根因 | 解决方案 |
|------|------|----------|
| 同步后搜不到用户 | Users DN 写错或 LDAP 过滤器太严 | 先用 `ldapsearch` 验证基础 DN 和过滤器能否返回用户 |
| 登录提示"无效的用户名或密码" | Bind 验证失败或用户不在同步范围内 | 检查 LDAP 用户密码是否未过期、账户是否被锁定（`userAccountControl`） |
| 组同步后 Keycloak 中看不到组 | Groups DN 与组实际位置不符，或 group-ldap-mapper 未添加 | 在 LDAP 中确认组条目的 DN 路径，确保 mapper 的 Groups DN 包含这些组 |
| 禁用账户仍能登录 Keycloak | 未过滤 `userAccountControl` 或 Keycloak 本地缓存未失效 | 在 Custom User LDAP Filter 添加 `!(userAccountControl:1.2.840.113556.1.4.803:=2)`；同步后手动删除已缓存用户 |
| `LDAP error 49 (invalid credentials)` | Bind DN 或密码错误 | 确认服务账号未过期、没被锁定；确认密码中特殊字符没有被转义 |
| `LDAP error 50 (insufficient access)` | 服务账号权限不足 | 服务账号需要对 Users DN 和 Groups DN 有读权限（大部分企业 AD 普通域用户即可） |
| `SSLHandshakeException` / 证书错误 | LDAPS 证书不受信任或域名不匹配 | 将 LDAP 服务器 CA 证书导入 Keycloak 的 truststore；或临时将 Connection URL 改为 `ldaps://` + `ldap`→Writheable 验证连通后改回 |
| 增量同步不生效 | LDAP 不支持 `uSNChanged`（AD 特有）或 `modifyTimestamp` | 改用定期全量同步；如为 AD，确认 Vendor 已选 Active Directory |

## 生产环境注意事项

1. **专用服务账号**：用低权限域账号做 Bind（只需对用户/组 OU 有读权限），不要用域管理员。定期轮换密码，并在 Keycloak 侧同步更新。

2. **连接池**：Keycloak 默认 LDAP 连接池较小（10-20），用户量上万时可在 `standalone.xml` / `conf/keycloak.conf` 中调大：
```properties
# quarkus.properties 方式（Keycloak 17+）
spi-connections-ldap-pool-max-size=50
```

3. **超时控制**：设置合理超时，避免 LDAP 服务器故障时 Keycloak 连接池耗尽：
```properties
spi-connections-ldap-connection-timeout-millis=5000
spi-connections-ldap-read-timeout-millis=5000
```

4. **不要在同一 Realm 中用 LDAP 和本地用户混合同名**：如果本地创建了 `zhangsan`，LDAP 也有 `zhangsan`，搜索优先级由 User Federation Provider 的 `Priority` 字段决定——值越小优先级越高。建议 LDAP provider 的 Priority 设为 0（最高）。

5. **密码策略**：Keycloak 的密码策略（长度、复杂度、过期等）对 LDAP 用户不生效——密码在 LDAP 侧管理。如需统一策略，在 AD/LDAP 侧强制执行。

6. **缓存失效**：Keycloak 默认缓存 LDAP 用户数据。如果 LDAP 侧禁用了一个用户但 Keycloak 侧用户仍可访问（因为此前登录的 session 还在），可在 Realm → User federation → ldap → Cache Settings 中将 `Cache policy` 设为 `NO_CACHE` 或缩短 `EVICT_DAILY` 等。

7. **安全传输**：生产必须用 LDAPS（636）。如需 StartTLS（389 升级），确认 LDAP 服务器已正确配置 StartTLS 且不存在降级风险。

## 回滚方式

如果 LDAP 对接配置错误导致用户无法登录：

1. **快速恢复**：在 User Federation → ldap → Settings → 将 `Import Enabled` 设为 `OFF`。这只是禁用导入，已缓存的用户不会立即消失，但新用户无法同步。Keycloak 本地用户不受影响。

2. **完全切断 LDAP**：删除整个 User Federation Provider。已缓存为 Keycloak 本地用户的 LDAP 用户会被保留（带有 `FEDERATED_LINK` 属性），但后续同步停止。如果之前 Edit Mode 为 `READ_ONLY`，这些用户将无法修改密码和属性。

3. **删除并重建 LDAP 用户**：如需彻底清理，通过 Admin Console 或 Admin CLI 删除所有从 LDAP 导入的用户（通常有 `FEDERATION_LINK` 属性标识），再重新配置 User Federation。

> 回滚演练建议：先在预发/测试 Realm 中配置 LDAP，全流程验证通过后再在生产 Realm 实施。不要在生产 Realm 上用域管理员账号做首测。

## 与 Keycloak 本地用户对比

| 维度 | LDAP/AD 联邦 | Keycloak 本地用户 |
|------|--------------|-------------------|
| 用户数据归属 | LDAP 是权威源 | Keycloak 数据库 |
| 密码管理 | LDAP 侧 | Keycloak 侧 |
| 用户生命周期 | 随 LDAP 增删 | 手动/API 管理 |
| 同步方向 | LDAP → Keycloak（单向） | 无 |
| 属性修改 | 回 LDAP 改 | Keycloak 直接改 |
| 离线可用性 | LDAP 故障时用户登录受限（已有缓存可部分缓解） | 不依赖外部目录 |

对于大多数企业场景，正确姿势是：**LDAP/AD 管用户 → Keycloak 消费用户 + 提供协议层（OIDC/SAML）**。如果需要从 Keycloak 侧回写属性到 LDAP（极少数场景），将 Edit Mode 设为 `WRITABLE` 并在 mapper 中开启双向同步，但要非常谨慎——这类配置是问题的温床。

## 小结

Keycloak 的 LDAP User Federation 允许企业保留现有的目录服务作为权威身份源，同时享受现代协议（OIDC/SAML）和 Keycloak 生态的红利。配置的核心在于:正确的 Vendor 选择 → 准确的连接参数 → 最小权限服务账号 → 合理的同步策略 → 组和属性映射——五步走完，测试登录，再加监控和告警，就可以平稳运行。遇到问题优先从 ldapsearch 诊断，90% 的配置问题都可以在 Keycloak 和 LDAP 之间的「握手环节」定位。
