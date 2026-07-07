---
title: "Keycloak Kubernetes 导入导出与数据迁移实战 | IDaaS Book"
description: "Keycloak 在 Kubernetes 环境下 Realm 导入导出与迁移：Helm/Operator 配置、volume 挂载与命令行导入的踩坑与方案"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 3
menu:
  docs:
    parent: "keycloak-troubleshooting"
    identifier: "keycloak-ts-export"
toc: true
---

> 本文以 **Keycloak Quarkus 发行版（17+）** 为准。Keycloak 17 起官方已移除 WildFly 发行版，旧版用 `standalone.sh -Dkeycloak.migration.action=export` 的导出方式不再适用，统一改用 `kc.sh export` / `kc.sh import`。

## 问题描述

Keycloak 集群跑在 Kubernetes 上，初始化了一些配置，想完整地导出来备份或迁移。

## 解决方案

### 命令行导出

Quarkus 版本使用 `kc.sh export` 一次性导出整个 Realm。`export` 子命令以「仅导出」模式启动，不会常驻监听端口，因此**无需**像旧 WildFly 版本那样设置端口偏移规避端口冲突。

导出为单个文件：

```bash
kubectl -n keycloak exec -it keycloak-0 -- /opt/keycloak/bin/kc.sh export \
  --file /tmp/keycloak-export.json --realm myrealm
```

导出为目录（每个 Realm 一个文件）：

```bash
kubectl -n keycloak -it exec keycloak-0 -- /opt/keycloak/bin/kc.sh export \
  --dir /tmp/export --realm myrealm
```

> 若不指定 `--realm`，则导出**除 `master` 外**的所有 Realm；`master` Realm 不参与导出。

导出完成后，用 `kubectl cp` 把文件从 Pod 复制出来（注意 Pod 内 `/tmp` 通常才对当前用户可写）：

```bash
kubectl -n keycloak cp keycloak-0:/tmp/export ./keycloak-export
```

### 启动时导入

Quarkus 版本通过 `--import-realm` 在启动时自动导入 `data/import` 目录下的 Realm JSON：

```bash
# 容器启动参数 / 环境变量
KC_IMPORT=/opt/keycloak/data/import
KC_ARGS="--import-realm"
```

挂载好 Realm JSON 后首次启动即自动导入；之后不再重复导入。Operator / Helm 部署可在 `Keycloak` CR 或 values 中用 `RealmImport`（Operator）或 extraEnv 传入。

### 复杂配置导入报错

若导出的配置较复杂（包含授权策略、自定义脚本等），导入时可能遇到：

```log
ERROR: Script upload is disabled
```

Keycloak 已默认禁用内嵌脚本上传（出于安全考虑）。脚本类 SPI 应改为打成 JAR 放入 `providers/` 部署，而非通过导入 JSON 携带脚本。

## 注意事项

1. 管理控制台也能导出，但导出**不全**：密码、密钥等敏感信息不会包含，务必以命令行导出为准。
2. 导出的是普通 JSON 文件，可按需手工编辑再导入，不必每次改动都重新导出。
3. Realm、用户、Client 也可通过 `kcadm.sh` 分别操作，特殊定制可拆分后独立导入。
4. 生产备份请结合数据库快照 + Realm JSON 双重保障，二者互为校验。
