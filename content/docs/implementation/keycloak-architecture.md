---
title: "第14章：Keycloak 架构深度解析 — 核心组件、部署架构与扩展机制 | IDaaS Book"
description: "Keycloak 的架构设计、核心组件、集群部署、高可用与性能调优"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 41
menu:
  docs:
    parent: "implementation"
    identifier: "keycloak-architecture"
toc: true
---

## 14.1 Keycloak 的设计哲学

Keycloak 是 Red Hat 主导开源的 IAM 解决方案。它的设计哲学可概括为：

1. **开箱即用**：快速部署，即可使用完整 SSO、社交登录、MFA
2. **标准优先**：完整实现 OAuth 2.0、OIDC、SAML 2.0
3. **可扩展**：SPI（Service Provider Interface）机制允许深度定制
4. **云原生**：支持容器化、Kubernetes、Operator 部署

## 14.2 架构全景

```
┌─────────────────────────────────────────────────────────────┐
│                        Keycloak Server                       │
│                                                              │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Admin Console │  │  Account     │  │  Login/Register  │  │
│  │  (管理控制台)   │  │  Console     │  │  Themes (登录页)  │  │
│  │  Angular SPA   │  │  (用户自助)   │  │  FTL Templates   │  │
│  └───────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│          │                 │                    │            │
│  ┌───────┴─────────────────┴────────────────────┴─────────┐  │
│  │                    REST API Layer                       │  │
│  │           (JAX-RS + Admin REST + Realms Admin)          │  │
│  └──────────────────────────┬─────────────────────────────┘  │
│                              │                                │
│  ┌───────────────────────────┴──────────────────────────────┐ │
│  │                    Service Layer                          │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │Auth Flow │ │Identity  │ │User      │ │Client      │  │ │
│  │  │Executor  │ │Provider  │ │Federation│ │Manager     │  │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │ │
│  └───────────────────────────┬──────────────────────────────┘ │
│                              │                                │
│  ┌───────────────────────────┴──────────────────────────────┐ │
│  │                    SPI Layer (扩展点)                     │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌─────────┐ │ │
│  │  │User    │ │Auth    │ │Event   │ │Theme │ │Required │ │ │
│  │  │Storage │ │Flow    │ │Listener│ │      │ │Action   │ │ │
│  │  └────────┘ └────────┘ └────────┘ └──────┘ └─────────┘ │ │
│  └───────────────────────────┬──────────────────────────────┘ │
│                              │                                │
│  ┌───────────────────────────┴──────────────────────────────┐ │
│  │                    Infinispan (缓存层)                    │ │
│  │   ┌────────────┐ ┌────────────┐ ┌──────────────────┐    │ │
│  │   │User Cache  │ │Realm Cache │ │Auth Session Cache│    │ │
│  │   └────────────┘ └────────────┘ └──────────────────┘    │ │
│  └───────────────────────────┬──────────────────────────────┘ │
│                              │                                │
│  ┌───────────────────────────┴──────────────────────────────┐ │
│  │                    Persistence (持久层)                   │ │
│  │         JPA (Hibernate) → PostgreSQL / MySQL              │ │
│  │         Liquibase (数据库迁移管理)                         │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## 14.3 核心概念

### Realm（域）

Realm 是 Keycloak 中最核心的隔离单位。一个 Realm 管理一组用户、凭证、角色和组。不同 Realm 之间完全隔离。

**多租户模式**：
- 每个客户一个 Realm（强隔离，适合 SaaS 供应商）
- 单 Realm + 用户组（简单场景，管理方便）

选择建议：
- 如果客户之间需要完全独立的身份策略、主题、管理员 → 独立 Realm
- 如果只是用户分组，策略相同 → 单 Realm + 组

### Client（客户端）

代表接入 Keycloak 的应用。Client 是协议维度的概念。

| 类型 | 说明 | 对应流程 |
|-----|------|---------|
| confidential | 后端应用，有 client_secret | 授权码模式 |
| public | SPA、移动 App，无 client_secret | 授权码 + PKCE |
| bearer-only | 纯资源服务器，只验证 token | 不需要认证 |

### Authentication Flow（认证流）

Keycloak 的认证流是一个执行图（DAG），由多个 `Authenticator` 组成：

```
Browser Flow 示例：

  [Cookie] ──认证通过──→ [Done]
      │
   未通过
      │
  [Username/Password Form]
      │
  [OTP Form (Conditional)]  ← MFA 条件执行（可以配置）
      │
  [Done]
```

每个 Authenticator 可以返回：
- `SUCCESS`：进入下一个
- `ATTEMPTED`：等待用户交互
- `CHALLENGE`：需要用户响应
- `FAILURE`：认证中断
- `FORCE_CHALLENGE`：强制重新挑战

### User Storage SPI

Keycloak 不强制将用户存储在自己的数据库中。通过 User Storage SPI，可以将任何外部用户存储集成进来。

内置实现：
- LDAP
- Active Directory  
- Kerberos

自定义实现：开发 `UserStorageProvider` 接口。

## 14.4 缓存架构

Keycloak 使用 Infinispan 作为分布式缓存层：

### 缓存类型

| 缓存名 | 内容 | 重要性 |
|--------|------|--------|
| realms | Realm 配置 | 关键 |
| users | 用户数据 | 关键 |
| authorization | 授权数据 | 关键 |
| keys | 密钥信息 | 关键 |
| sessions | 用户会话 | 高 |
| authenticationSessions | 认证中的会话 | 中 |
| offlineSessions | 离线令牌 | 中 |
| loginFailures | 登录失败计数 | 低 |
| work | 跨节点 invalidation/通知 | 管理 |

### 缓存拓扑

**local**：单节点，仅内存缓存。
**distributed**：多节点集群，通过 Infinispan 网格共享缓存。

### 缓存配置建议

```properties
# keycloak.conf
cache=ispn
cache-stack=kubernetes   # 或 tcp/jdbcPing

# 为不同缓存配置条目限额
cache-embedded-default-max-entries=10000
```

## 14.5 集群与高可用

### 集群部署架构

```
              [Load Balancer (Nginx/HAProxy)]
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   [Keycloak-1] [Keycloak-2] [Keycloak-N]
        │            │            │
        └────────────┼────────────┘
                     │
              [PostgreSQL Cluster]
              [Infinispan Cache]
```

### 集群要求

1. **共享数据库**：所有节点连接同一个数据库实例
2. **IP 组播或替代发现**：节点之间能互相发现
3. **共享缓存**：Infinispan 分布式缓存或外部 Infinispan 集群

### 关键配置

```
# 集群模式
cache=ispn
cache-stack=kubernetes  # 或 tcp/jdbcPing

# 负载均衡器要求
proxy-address-forwarding=true

# Session 所有者
# 生产建议使用分布式 Session
```

### Kubernetes 部署要点

参见第19章"Kubernetes 生产环境部署"。

## 14.6 性能调优

### 数据库

- 单节点连接池大小约为该节点 HTTP 工作线程数的 0.25–0.5 倍；数据库侧允许的最大连接数需按 节点数 × 单节点池大小 预留
- 索引优化：确保 `USER_SESSION`、`CLIENT_SESSION` 等大表有合适索引
- 定期清理过期 Session：`keycloak` 有内置定时任务

### 缓存

- realms/users 缓存默认不过期（lifespan=-1），依靠跨节点 invalidation 维持一致性，如需限制可显式设置 lifespan；keys 缓存默认有较短 lifespan 以支持签名密钥轮换
- 集群环境下缓存一致性检查

### JVM 调优

```
-Xms2g -Xmx4g
-XX:MaxMetaspaceSize=512m
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
```

### 资源建议

| 规模 | CPU | 内存 | 节点数 | 数据库 |
|-----|-----|------|--------|--------|
| 小型（< 1000 用户） | 2核 | 2GB | 1 | PostgreSQL |
| 中型（1K-10K 用户） | 4核 | 4GB | 2 | PostgreSQL HA |
| 大型（10K-100K 用户） | 8核 | 8GB | 3+ | PostgreSQL HA + PgBouncer |
| 超大型（> 100K 用户） | 16核+ | 16GB+ | 4+ | 定制架构 |

## 14.7 监控指标

关键指标：
- 认证请求速率（authn_per_second）
- 认证延迟（p50/p95/p99）
- Token 签发速率
- 活跃 Session 数
- 缓存命中率
- 数据库查询延迟
- JVM 堆使用率和 GC 频率

Keycloak 暴露 Prometheus metrics（通过 `/metrics` 端点或 Micrometer 集成）。

## 14.8 小结

Keycloak 是 IDaaS 开源方案的首选。理解其架构——Realm 隔离、认证流引擎、SPI 扩展机制、缓存架构和集群部署——是从"会用"到"精通"的关键。在生产环境中，重点投入数据库优化、缓存调优、集群高可用和监控。

> 本章聚焦架构与原理。主题定制、Admin REST API、密码策略 / MFA / 暴力破解、SPI 与认证流实战、与 Grafana / GitLab / Jenkins 等第三方软件的集成等动手操作，见[Keycloak 实战指南]({{< relref "docs/keycloak/_index.md" >}})。
