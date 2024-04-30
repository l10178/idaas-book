---
title: "Liquibase MGR"
date: 2020-12-08T23:50:37+08:00
draft: false
---

## 问题描述

Keycloak 对接的是一个 MGR(mysql group replication)的集群，安装时出错，数据初始化失败。

查看 keycloak 启动日志，错误信息大致如下。

```log
INFO  [org.keycloak.connections.jpa.updater.liquibase.LiquibaseJpaUpdaterProvider] (ServerService Thread Pool -- 66) Initializing database schema. Using changelog META-INF/jpa-changelog-master.xml
ERROR [org.keycloak.connections.jpa.updater.liquibase.conn.DefaultLiquibaseConnectionProvider] (ServerService Thread Pool -- 66) Change Set META-INF/jpa-changelog-1.0.0.Final.xml::
1.0.0.Final-KEYCLOAK-5461::sthorger@redhat.com failed.  Error: Table 'APPLICATION_DEFAULT_ROLES' already exists [Failed SQL: CREATE TABLE keycloak.APPLICATION_DEFAULT_ROLES (APPLICATION_ID VARCHAR(36) NOT NULL, ROLE_ID VARCHAR(36) NOT NULL)]
FATAL [org.keycloak.services] (ServerService Thread Pool -- 66) java.lang.RuntimeException: Failed to update database
INFO  [org.jboss.as.server] (Thread-2) WFLYSRV0220: Server shutdown has been requested via an OS signal
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```
