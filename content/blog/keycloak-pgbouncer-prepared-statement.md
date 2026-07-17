---
title: "Keycloak + PgBouncer 排错：prepared statement does not exist 与通过环境变量配 JDBC URL 参数"
description: "Keycloak 接 PgBouncer 事务池后报 prepared statement S_1 does not exist 的根因，以及用 KC_DB_URL_PROPERTIES 注入 prepareThreshold=0 的通用解法"
summary: "Keycloak 挂在 PgBouncer 后面后事务提交失败、报 prepared statement does not exist 的排错记录，顺带说清楚怎么通过环境变量给任意组件的 JDBC URL 追加参数。"
date: 2026-07-17T00:00:00+08:00
lastmod: 2026-07-17T00:00:00+08:00
draft: false
weight: 20
images: []
categories: ["Keycloak", "PostgreSQL"]
tags: ["Keycloak", "PgBouncer", "PostgreSQL", "JDBC", "连接池", "troubleshooting"]
contributors: []
pinned: false
homepage: false
seo:
  title: "Keycloak + PgBouncer 排错：prepared statement does not exist 与 KC_DB_URL_PROPERTIES"
  description: "Keycloak 连接 PgBouncer 事务池时 prepared statement S_1 does not exist 报错根因，用 prepareThreshold=0 关闭服务端 prepared statement，并说明通过环境变量给任意组件 JDBC URL 追加参数的通用做法。"
  canonical: ""
  noindex: false
---

把 Keycloak 挂到 PgBouncer 后面几乎是标配。Keycloak 自己就维护着一个 Agroal 连接池，副本一扩，到 PostgreSQL 的连接数很容易爆。中间挡一层 PgBouncer，用事务级复用把上百条应用连接收敛到少量后端连接，连接数立刻就老实了。

换上之后日志里多半会冒出这样一段：

```
2026-07-15 03:43:59,266 WARN  [com.arjuna.ats.jta] (executor-thread-2) ARJUNA016039:
  onePhaseCommit on < ... > (io.agroal.narayana.LocalXAResource@47a4c16f)
  failed with exception XAException.XA_RBROLLBACK:
  javax.transaction.xa.XAException: Error trying to transactionCommit local transaction:
  ERROR: prepared statement "S_1" does not exist
    at io.agroal.narayana.XAExceptionUtils.xaException(XAExceptionUtils.java:21)
    at io.agroal.narayana.XAExceptionUtils.xaException(XAExceptionUtils.java:9)
    at io.agroal.narayana.LocalXAResource.commit(LocalXAResource.java:73)
    ...
Caused by: org.postgresql.util.PSQLException: ERROR: prepared statement "S_1" does not exist
    at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2904)
    at org.postgresql.core.v3.QueryExecutorImpl.processResults(QueryExecutorImpl.java:2589)
    at org.postgresql.core.v3.QueryExecutorImpl.execute(QueryExecutorImpl.java:431)
    at org.postgresql.core.v3.QueryExecutorImpl.execute(QueryExecutorImpl.java:389)
    at org.postgresql.jdbc.PgConnection.executeTransactionCommand(PgConnection.java:998)
    at org.postgresql.jdbc.PgConnection.commit(PgConnection.java:1020)
    at io.agroal.pool.ConnectionHandler.transactionCommit(ConnectionHandler.java:367)
    at io.agroal.narayana.LocalXAResource.commit(LocalXAResource.java:70)
    ... 53 more
```

真正要看的是最后那行 `Caused by: ... ERROR: prepared statement "S_1" does not exist`。上面那一长串 Narayana / Quarkus / Keycloak 的栈只是这行数据库错误的外包装——事务在提交阶段崩了，被 JTA 回滚。

下面记一下这次怎么查的，以及一个比 `prepareThreshold=0` 本身更值得记住的套路：通过环境变量往 JDBC URL 上塞参数。这套做法跟 Keycloak 没绑死，任何用 pgjdbc、又允许通过环境变量拼 URL 的组件都能这么干。

## 这报错到底怎么来的

把三件事摆到一起就清楚了。

第一件，pgjdbc 默认会用服务端 prepared statement。同一条 SQL 被执行到第 5 次（`prepareThreshold` 默认值）之后，驱动会在 PostgreSQL 那边创建一个 prepared statement，名字就是 `S_1`、`S_2` 这种，之后直接复用，省掉解析和规划。这个 statement 是挂在某一条后端连接上的，属于那条连接的 session 级状态。

第二件，PgBouncer 的事务池模式会换后端连接。`pool_mode = transaction` 下，一个事务跑完就把客户端连接还回池里，下一个事务可能被分到另一条到 PostgreSQL 的后端连接。这就是它能高复用的根本，但也意味着客户端看到的「同一条连接」，在不同事务背后其实是不同的 server connection。

第三件自然就来了。客户端在连接 A 上建了 `S_1`，下一个事务被 PgBouncer 路由到连接 B，客户端以为自己还拿着 `S_1`，发了个 `EXECUTE S_1` 过去，但连接 B 上根本没这东西，PostgreSQL 直接回 `prepared statement "S_1" does not exist`。

Keycloak 这里踩得特别准：它用 JPA + Narayana 管事务，提交时驱动要执行 `COMMIT`，而 `COMMIT` 这条语句在 pgjdbc 里也会走 prepared statement 路径——`S_1` 经常就是它。所以你会看到一个特别唬人的现象：报错的不是哪条业务 SQL，而是提交事务的 `COMMIT` 本身，外层就变成 `onePhaseCommit ... failed` / `XA_RBROLLBACK`。盯着业务 SQL 排查能浪费一下午。

这事不是 Keycloak 的 bug，也不是 PgBouncer 配错了，是事务池型中间件和驱动端优化天生打架。

## 修：把 prepareThreshold 关成 0

最省事的修法是让 pgjdbc 别在服务端建 prepared statement。`prepareThreshold=0` 就是干这个的，驱动退回每次发完整 SQL，没有任何跨事务的服务端状态，PgBouncer 随便换后端连接都不影响。

Keycloak 这边对应一个环境变量：

```yaml
env:
  - name: KC_DB_URL_PROPERTIES
    value: "?prepareThreshold=0"
```

Keycloak 拼装 JDBC URL 时会把 `KC_DB_URL` 和它接在一起，最终给驱动的是：

```
jdbc:postgresql://pgbouncer.internal:6432/keycloak?prepareThreshold=0
```

有个坑要注意。如果 `KC_DB_URL` 里已经带了别的查询参数，比如 `?sslmode=require`，那 `KC_DB_URL_PROPERTIES` 得用 `&` 接，不然拼出来 `?sslmode=require?prepareThreshold=0` 是个非法 URL：

```yaml
env:
  - name: KC_DB_URL
    value: "jdbc:postgresql://pgbouncer.internal:6432/keycloak?sslmode=require"
  - name: KC_DB_URL_PROPERTIES
    value: "&prepareThreshold=0"
```

重启 Pod，确认日志里不再刷 `prepared statement "S_*" does not exist`，事务提交就回来了。

关掉服务端 prepared statement 不是没代价。每条 SQL 多一次 Parse，PostgreSQL 多做一次解析和规划。但 Keycloak 基本是短事务、固定 SQL，这点开销跟「连接数爆炸」和「事务提交失败」比，可以认。真要心疼 CPU，再去看后面那条升级 PgBouncer 1.21+ 的路。

## 真正该记下来的：往 JDBC URL 塞参数的套路

比 `prepareThreshold=0` 这个具体值更值得记的是「通过环境变量往 JDBC URL 上追加参数」这件事本身。这次 Keycloak 的解法就是个现成例子：不碰 `KC_DB_URL`、不改 `keycloak.conf`，单靠 `KC_DB_URL_PROPERTIES` 给 URL 尾巴接一个 `prepareThreshold=0`，问题就解了。任何用 JDBC、又允许用环境变量拼连接 URL 的组件，都是同一个套路——找到那个「数据库 URL 之外、专门用来追加查询参数」的开关，把参数塞进去。Keycloak 是 `KC_DB_URL_PROPERTIES`；Spring Boot 一般直接拼到 `spring.datasource.url`；Quarkus 是 `quarkus.datasource.jdbc.url`；纯 Hibernate 在 `hibernate.connection.url` 后面加；非 Java 的 libpq 走 `PGOPTIONS` 或连接串里的 `options`。位置不同，思路一致：找到能往连接字符串里塞参数的那个口子。

`?` 还是 `&`，规则就一条——看最终拼出来的 URL 里有没有 `?`。没有就用 `?`，有了就用 `&`。拼错了是连接异常，不会静默生效，错了也容易看出来。

## 验证

按这个顺序看一眼：

```bash
# Pod 真的带上新环境变量了
kubectl -n platform get deploy keycloak -o yaml | grep -A1 KC_DB_URL_PROPERTIES

# 重启后还刷不刷 prepared statement
kubectl -n platform logs deploy/keycloak --tail=200 | grep -i "prepared statement"

# 事务提交有没有恢复，ARJUNA016039 / XA_RBROLLBACK 应该消失
kubectl -n platform logs deploy/keycloak --tail=200 | grep -E "ARJUNA016039|XA_RBROLLBACK"

# 压一波登录，确认登录、token 签发、会话落库都正常
```

报错不再刷、回滚也不再见，就算修好了。最好观察过一个扩缩容周期，PgBouncer 复用最狠的时段也稳，再收工。

## 不想关 prepared statement 的两条路

`prepareThreshold=0` 是改动最小的解。如果就是舍不得服务端 prepared statement，还有别的办法。

一是升级 PgBouncer 到 1.21+，开 `max_prepared_statements`。新版本在事务池模式下会自己在客户端和后端连接之间维护 prepared statement 的映射，驱动还能继续享受那点收益。代价是要升 PgBouncer、搞懂新参数、确认版本配套，比加一个环境变量重得多。

二是换成 session 池（`pool_mode = session`），一个客户端连接独占一条后端连接，prepared statement 自然不会丢。但这么一来 PgBouncer 基本退化成「最大连接数上限管理」，事务级复用这个主要价值没了，连接数收敛效果大打折扣。除非你本来的诉求就是卡上限而不是高复用，不然不划算。

顺带一提，如果你压根没上 PgBouncer，是应用内连接池直连 PostgreSQL，这个 prepared statement 失效的问题不会出现——这事就是「事务池型中间件后面跑 pgjdbc」这一类组合特有的。

## 排错判断

- 日志里是 `prepared statement "S_N" does not exist` 配 `XA_RBROLLBACK` / `onePhaseCommit failed` → 命中本问题，设 `KC_DB_URL_PROPERTIES=?prepareThreshold=0` 重启。
- 同样报错，但 Keycloak 是直连 PostgreSQL、中间没 PgBouncer → 多半不是这个，查有没有别的复用/代理层，或 PostgreSQL 端连接被异常回收。
- 报错没了但 SQL 解析变慢 → 修复生效的副作用，要么认了，要么走 PgBouncer 1.21+ 那条路。
- 拼完 URL 之后建连阶段就报 `SQLException` → 八成是 `?` / `&` 接错了，看 `KC_DB_URL` 里是不是已经有 `?`。

## 相关章节

- [Keycloak 生产数据库配置指南]({{< relref "docs/solution-blogs/keycloak-postgresql-config.md" >}})
- [Keycloak 常见问题排查]({{< relref "docs/keycloak/troubleshooting/" >}})
- [Keycloak Kubernetes 生产部署]({{< relref "docs/implementation/kubernetes-production.md" >}})

## 参考资料

- PostgreSQL JDBC 驱动 prepared statement 文档：<https://jdbc.postgresql.org/documentation/use/#server-prepared-statements>
- PgBouncer 1.21 prepared statement 支持说明：<https://github.com/pgbouncer/pgbouncer/blob/master/doc/config.md#max_prepared_statements>
- Keycloak 数据库配置环境变量：<https://www.keycloak.org/server/db>
- PgBouncer pool mode 文档：<https://www.pgbouncer.org/config.html#pool_mode>