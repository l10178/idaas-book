---
title: "Keycloak Liquibase 与 MySQL 组复制冲突排查与解决 | IDaaS Book"
description: "Keycloak 在 MySQL Group Replication 下 Liquibase 数据库迁移失败的排查与解决方案：锁表与迁移串行化"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 2
menu:
  docs:
    parent: "keycloak-troubleshooting"
    identifier: "keycloak-ts-liquibase"
toc: true
---

## 问题描述

Keycloak 对接的是一个 MGR(mysql group replication)的集群，安装时出错，数据初始化失败。

查看 Keycloak 启动日志，错误信息大致如下（Quarkus 版日志形如）。

```log
ERROR [org.keycloak.connections.jpa.updater.liquibase.LiquibaseJpaUpdaterProvider] (executor-thread-1) Initializing database schema. Using changelog META-INF/jpa-changelog-master.xml
ERROR [org.keycloak.connections.jpa.updater.liquibase.conn.DefaultLiquibaseConnectionProvider] (executor-thread-1) Change Set META-INF/jpa-changelog-1.0.0.Final.xml::
1.0.0.Final-KEYCLOAK-5461::sthorger@redhat.com failed.  Error: Table 'APPLICATION_DEFAULT_ROLES' already exists [Failed SQL: CREATE TABLE keycloak.APPLICATION_DEFAULT_ROLES (APPLICATION_ID VARCHAR(36) NOT NULL, ROLE_ID VARCHAR(36) NOT NULL)]
ERROR [org.keycloak.services] (executor-thread-1) java.lang.RuntimeException: Failed to update database
```

查看 MySQL 日志，看到如下错误。

```log
[ERROR] Plugin group_replication reported: 'Table DATABASECHANGELOG does not have any PRIMARY KEY. This is not compatible with Group Replication'
```

## 问题原因

根据 MySQL 日志，很明确了是因为 DATABASECHANGELOG 没有主键。MySQL group replication 要求表必须有主键或者非 Null 的唯一索引。

keycloak 使用 Liquibase 初始化数据。Liquibase 自动创建的 DATABASECHANGELOG 表没有主键，主要是为了避免特定数据库 key 的长度限制。查看 [Liquibase 官方说明](https://docs.liquibase.com/concepts/basic/databasechangelog-table.html)，“id”, “author”, “filename”可以作为唯一索引。

## 解决方案

解决办法也很简单，在 keycloak 启动之前，提前创建好 DATABASECHANGELOG 表并增加主键（或唯一性索引）。

```sql
CREATE TABLE `DATABASECHANGELOG` (
  `ID` varchar(255) NOT NULL,
  `AUTHOR` varchar(255) NOT NULL,
  `FILENAME` varchar(255) NOT NULL,
  `DATEEXECUTED` datetime NOT NULL,
  `ORDEREXECUTED` int(11) NOT NULL,
  `EXECTYPE` varchar(10) NOT NULL,
  `MD5SUM` varchar(35) DEFAULT NULL,
  `DESCRIPTION` varchar(255) DEFAULT NULL,
  `COMMENTS` varchar(255) DEFAULT NULL,
  `TAG` varchar(255) DEFAULT NULL,
  `LIQUIBASE` varchar(20) DEFAULT NULL,
  `CONTEXTS` varchar(255) DEFAULT NULL,
  `LABELS` varchar(255) DEFAULT NULL,
  `DEPLOYMENT_ID` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`ID`,`AUTHOR`,`FILENAME`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```
## 问题症状

Keycloak 启动时 Liquibase 报错，无法完成数据库迁移：

```
ERROR: Liquibase failed to start because the database is read-only
or the current user lacks write permissions.
```

在 MySQL Group Replication 环境中，节点切换期间可能出现短暂只读状态，导致 Liquibase 的 `DATABASECHANGELOGLOCK` 表写入失败。

## 根因分析

Liquibase 使用 `DATABASECHANGELOGLOCK` 表实现分布式锁，防止多个 Keycloak 实例同时执行数据库迁移。在 MySQL Group Replication 环境下：

1. 写节点（Primary）故障转移时，新 Primary 有短暂的只读窗口
2. 如果 Keycloak 恰好在此时启动，Liquibase 获取锁失败
3. Keycloak 默认会重试，但默认重试策略不够适应 GR 的切换耗时

## 解决方案

### 方案一：延长 Liquibase 重试

在 Keycloak 配置中增加 Liquibase 的重试参数（Keycloak 21+ 支持）：

```bash
# 环境变量方式
KC_DB_URL=jdbc:mysql://... 
KC_SPI_LIQUIBASE_RETRY_COUNT=10
KC_SPI_LIQUIBASE_RETRY_DELAY=5
```

### 方案二：调整 MySQL GR 参数

```sql
-- 降低只读窗口时间
SET GLOBAL group_replication_member_expel_timeout = 10;
SET GLOBAL group_replication_unreachable_majority_timeout = 30;
```

### 方案三：预检查数据库可写性

在 Keycloak 启动脚本中增加预检查：

```bash
# 等待 MySQL 可写
for i in $(seq 1 30); do
  if mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" -e "SELECT 1" 2>/dev/null; then
    echo "MySQL ready"
    break
  fi
  sleep 2
done
```

## 预防措施

- 在 Kubernetes 中为 Keycloak Pod 配置 `initContainer` 做数据库就绪检查
- MySQL GR 集群设置合理的故障转移超时，避免 Keycloak 启动窗口与 GR 切换窗口重叠
- 生产环境建议使用 PostgreSQL，避免 MySQL GR 的只读状态问题
