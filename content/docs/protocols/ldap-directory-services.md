---
title: "第8章：LDAP 与目录服务 — Active Directory 集成与目录同步 | IDaaS Book"
description: "LDAP 协议原理与目录服务：Active Directory 集成、LDAPS/TLS 安全传输、搜索过滤器、AD 用户同步与身份联邦最佳实践"
date: 2024-02-04T00:00:00+08:00
draft: false
weight: 28
menu:
  docs:
    parent: "protocols"
    identifier: "ldap-directory-services"
toc: true
---

## 8.1 目录服务概述

目录服务是一种专门为读操作优化的分布式数据库，用于存储组织化的、层次化的信息。在 IDaaS 中，目录服务是最重要的身份数据存储方式之一。

### 为什么不是关系数据库？

| 特性 | 目录服务 | 关系数据库 |
|-----|---------|-----------|
| 读/写比例 | 100:1 或更高 | 变化多样 |
| 数据模型 | 层次化（树状） | 关系化（表） |
| 查询语言 | LDAP Filter | SQL |
| 性能优化 | 索引和缓存优先 | 事务和一致性 |
| 数据结构 | 灵活 Schema | 固定 Schema |
| 典型用途 | 身份查找、认证 | 业务数据处理 |
| 扩展方式 | 只读副本 | 读写分离 |

目录服务是为"查找"而生的：员工查找、组查找、认证等操作要求极低的延迟和极高的读并发，这正是目录服务的设计目标。

## 8.2 LDAP 协议基础

### LDAP 数据模型

LDAP 数据以**树状结构**（Directory Information Tree, DIT）组织：

```
              dc=example,dc=com
              │
    ┌─────────┼─────────┐
    │         │         │
ou=users   ou=groups  ou=services
    │         │
cn=张三    cn=engineers
```

每个节点称为一个 **Entry**（条目），具有：

- **DN（Distinguished Name）**：唯一标识符，如 `cn=张三,ou=users,dc=example,dc=com`
- **ObjectClass**：定义条目类型（如 `person`, `organizationalPerson`, `inetOrgPerson`）
- **Attributes**：属性（如 `mail`, `uid`, `userPassword`）

### 常见 ObjectClass

```
top
├── person
│   ├── organizationalPerson
│   │   └── inetOrgPerson（最常用，包含 mail, uid 等现代属性）
│   └── residentialPerson
├── groupOfNames（静态组）
├── groupOfUniqueNames（静态组，uniqueMember 替代 member）
└── organizationalUnit
```

### LDAP 操作

| 操作 | 描述 |
|-----|------|
| Bind | 认证连接到 LDAP 服务器 |
| Search | 查询目录（最常用操作） |
| Compare | 比较某个属性值 |
| Add | 添加新条目 |
| Delete | 删除条目 |
| Modify | 修改条目属性 |
| ModifyDN | 重命名或移动条目 |
| Unbind | 断开连接 |

### LDAP Search

```
ldapsearch -H ldaps://ldap.example.com \
  -D "cn=admin,dc=example,dc=com" \
  -w password \
  -b "ou=users,dc=example,dc=com" \
  "(&(objectClass=inetOrgPerson)(department=engineering))" \
  cn mail uid

参数说明：
  -H: LDAP 服务器 URI
  -D: Bind DN（管理员 DN）
  -w: 密码
  -b: 搜索 Base
  "(&(...)(...))": LDAP Filter
  cn mail uid: 要返回的属性
```

### LDAP Filter 语法

```
运算符：
&  — AND
|  — OR
!  — NOT
=  — 相等
>= — 大于等于
<= — 小于等于
~= — 约等于
*  — 通配符

示例：
"(objectClass=person)"                     — 所有人员条目
"(&(objectClass=person)(department=IT))"   — IT 部门的人员
"(|(department=IT)(department=HR))"        — IT 或 HR 人员
"(!(department=IT))"                       — 非 IT 人员
"(cn=张*)"                                 — 姓张的（CN 以"张"开头）
"(mail=*@example.com)"                     — example.com 邮箱用户
```

## 8.3 Active Directory

Microsoft Active Directory 是最广泛部署的目录服务。了解 AD 对于 IDaaS 实践至关重要，因为大多数企业仍在使用 AD 管理员工身份。

### AD 核心概念

- **Domain（域）**：AD 的基本管理单位
- **Domain Controller（DC，域控制器）**：运行 AD 域服务
- **OU（Organizational Unit，组织单位）**：用于组织对象和应用组策略
- **Group Policy（组策略）**：集中管理的安全策略（密码策略、审计策略等）
- **Global Catalog（全局编录）**：整个林中所有对象的子集缓存，用于跨域搜索
- **Forest（林）**：多个共享 Schema 的域树的集合
- **Trust（信任关系）**：域/林之间的信任关系

### AD 用户认证

AD 域登录默认使用 Kerberos 进行认证，但也支持 NTLM（向后兼容）：

```
Kerberos 认证流程（简化版）：
1. 客户端 → KDC：AS_REQ（请求 TGT）
2. KDC → 客户端：AS_REP（返回 TGT）
3. 客户端 → KDC：TGS_REQ（用 TGT 请求服务票据）
4. KDC → 客户端：TGS_REP（返回服务票据）
5. 客户端 → 服务：AP_REQ（呈现服务票据）
6. 服务验证票据，建立认证上下文
```

### AD + LDAP

AD 通过 LDAP 暴露目录查询接口。LDAP 协议本身通过 **bind 操作**完成认证，可以是简单 bind（DN + 密码）或 SASL bind（如 GSS-SPNEGO/Kerberos）；AD 域登录默认走 Kerberos，而 LDAP 认证两者皆可。IDaaS 系统通常通过 LDAP（而不是 Kerberos）与 AD 交互进行用户同步。

```
# 在 AD 中搜索用户（memberOf 反向查询为 AD 特有，标准 LDAP 需配置 memberOf overlay）
ldapsearch -H ldaps://dc.example.com \
  -D "CN=Administrator,CN=Users,DC=example,DC=com" \
  -w password \
  -b "DC=example,DC=com" \
  "(&(objectClass=user)(memberOf=CN=Engineers,OU=Groups,DC=example,DC=com))" \
  sAMAccountName mail displayName
```

## 8.4 开源 LDAP 实现

### OpenLDAP

最广泛使用的开源 LDAP 服务器。

```bash
# 安装
apt install slapd ldap-utils

# 配置基础 DN 和管理员密码
dpkg-reconfigure slapd

# 验证
ldapsearch -x -H ldap://localhost -b "dc=example,dc=com"
```

### 389 Directory Server

由 389 Project 社区维护（源自 Red Hat/Fedora），Keycloak 文档列为推荐的 LDAP 实现之一。

### ApacheDS

纯 Java 实现的 LDAP 服务器，适合嵌入 Java 应用。

## 8.5 IDaaS 中的 LDAP 集成模式

### 模式一：LDAP 作为用户联合源（User Federation）

IDaaS 平台连接到 LDAP，将 LDAP 用户导入（或实时查询）：

```
IDaaS ←─ LDAP(S) ─→ LDAP Server (AD/OpenLDAP)
```

用户仍在 LDAP 中管理，IDaaS 只是"消费"这些用户。

### 模式二：LDAP 同步 + 本地缓存

定时同步 LDAP 用户到 IDaaS 自己的存储：

- 用户属性发生变化时同步（增量同步）
- 新增/禁用/删除用户时同步
- 保留同步日志和错误处理

### 模式三：IDaaS 作为 LDAP 代理

应用连接到 IDaaS 暴露的 LDAP 端点，IDaaS 后端再代理到真正的 LDAP：

```
App → LDAP → IDaaS → AD/LDAP
```

这对于兼容只支持 LDAP 的遗留应用非常有用。

## 8.6 LDAPS 与 StartTLS

### LDAPS（LDAP over SSL）

使用专用端口（636），在整个连接期间全程加密。这是生产环境的推荐方式。

### StartTLS

在普通 LDAP 连接（端口 389）上通过 StartTLS 扩展升级到 TLS。但 StartTLS 存在降级风险，RFC 9325 等建议优先使用专用端口的 LDAPS；新部署若无端口限制应直接用 LDAPS，仅在必须复用 389 端口时才考虑 StartTLS。

### TLS 最佳实践

- 使用有效证书（非自签名）
- 证书有效期遵循 CA/B Forum 趋势（公开信任证书已普遍缩短至 90 天内，内部 CA 1 年以内）
- 客户端验证服务端证书（不跳过验证）

## 8.7 性能优化

1. **合理设计索引**：对频繁搜索的属性建立索引（uid, mail, member 等）。
2. **限制搜索范围**：搜索结果数量限制 + 搜索时间限制。
3. **分页查询**：使用 Simple Paged Results Control（RFC 2696）。
4. **读写分离**：主服务器负责写，只读副本负责查询。
5. **连接池**：客户端使用连接池，避免频繁建立和断开连接。
6. **缓存**：合理利用 LDAP 服务器和客户端的缓存。

## 8.8 小结

LDAP 和目录服务是 IDaaS 世界的基础设施层。对于大多数企业来说，Active Directory 仍然是员工的权威身份源。IDaaS 系统的核心能力之一就是与这些目录服务无缝集成——既能让用户继续使用已有的域账号，又能将身份管理能力扩展到云原生应用。关于 Keycloak 对接 LDAP/AD 的具体配置步骤、同步策略和排错方法，参见 [Keycloak LDAP / AD 用户联邦实战指南]({{< relref "docs/solution-blogs/keycloak-ldap-ad-federation" >}})。
