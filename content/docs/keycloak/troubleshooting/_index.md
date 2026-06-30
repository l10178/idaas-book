---
title: "Keycloak 常见问题排查"
description: "Keycloak 生产常见问题与排查：HTTPS/反向代理要求、Liquibase 与 MySQL 组复制冲突、Kubernetes 导入导出迁移、缓存与集群排查"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 16
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-troubleshooting"
toc: true
---

本节收录 Keycloak 生产环境高频问题与排查方案。每个子页是一个独立案例，含现象、根因、解决方案。建议先看本页的「快速索引」按症状定位。

## 快速索引

| 症状 | 关键词 | 解决方案 |
|------|--------|----------|
| 登录后报 `HTTPS required` / `Invalid parameter: redirect_uri` | HTTPS、反向代理、proxy | [HTTPS / 反向代理问题]({{< relref "docs/keycloak/troubleshooting/https-required.md" >}}) |
| 启动卡在 Liquibase / 数据库初始化失败 | Liquibase、MySQL Group Replication、锁 | [Liquibase 与 MySQL 组复制]({{< relref "docs/keycloak/troubleshooting/liquibase-mysql-group-replication.md" >}}) |
| K8s 环境导入导出 Realm 迁移失败 | 导入导出、Helm、Operator | [K8s 导入导出迁移]({{< relref "docs/keycloak/troubleshooting/export-import-on-k8s.md" >}}) |

## 通用排查思路

1. **看日志**：`kc.sh start --log-level=DEBUG` 或容器 `kubectl logs`，优先找 `ERROR`/`WARN` 与异常栈。
2. **分层定位**：浏览器（302/redirect_uri）→ 反代（X-Forwarded-* 头）→ Keycloak（Realm/Client 配置）→ 数据库（连接/锁/迁移）。
3. **复现**：用 `curl -v` 复现 OIDC 授权请求，观察 `Location` 头与参数。
4. **核对版本**：Keycloak 大版本间（WildFly → Quarkus）配置项与默认路径变化大，先确认版本。

## 常见根因分类

- **反向代理头缺失**：`X-Forwarded-Proto`/`Host` 未透传，导致 Keycloak 生成 `http://` 回调或域名错误。需 `proxy-address-forwarding=true`。
- **数据库迁移锁**：Liquibase 在多节点同时启动或 MySQL Group Replication 下加锁失败。需串行启动或调整锁表配置。
- **Realm 导入格式/路径**：Helm/Operator 导入期望 `keycloakConfig` 或 volume 挂载路径，与命令行 `--import` 行为不同。
- **Client redirect_uri 不匹配**：精确匹配，避免通配；回调路径区分大小写与尾部斜杠。
- **缓存不一致**：集群 `loginFailures`/`users` 缓存栈配置不当，导致暴力检测或用户更新跨节点不生效。

更多案例见上方子页。新问题欢迎提交 [Issue](https://github.com/l10178/idaas-book/issues) 补充。