---
title: "Keycloak HTTPS Required 错误与反向代理排错指南 | IDaaS Book"
description: "Keycloak 报 HTTPS required 或 Invalid redirect_uri 的排查：反向代理 X-Forwarded-* 头与 proxy 配置"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 1
menu:
  docs:
    parent: "keycloak-troubleshooting"
    identifier: "keycloak-ts-https"
toc: true
---

## 问题描述

以 Http 方式登录，页面错误提示如下。

`We're sorry... HTTPS required.`

## 问题原因

Keycloak 各个 Realm 默认的登录设置里，`Require SSL` 为 `external requests`，对于外部请求，必须是 Https。
非外部请求，也就是私有地址，可以是 http，如：`localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x, 172.16.x.x`。
详细参考[官方文档说明](https://www.keycloak.org/docs/latest/server_installation/index.html#setting-up-https-ssl)。

## 解决方案

1. 配置 https 并使用 https 登录，毫无疑问，这是正确的解决方案。

   生产环境推荐在反向代理 / Ingress 上终结 TLS，并让 Keycloak 以 `proxy=passthrough`（或 `edge`/`reencrypt` 视场景）感知前端协议，详见 [安全增强功能]({{< relref "docs/keycloak/security-features/_index.md" >}})。

2. 如果只是测试环境，可以修改 Realm 的设置，`Require SSL` 改为 `none`。

   - K8S 命令行调用 Keycloak 官方 admin 工具 `kcadm` 修改（Quarkus 版默认上下文路径为 `/`，已无 `/auth` 前缀）：

     ```bash
     # login with a admin user
     kubectl exec -it keycloak-pod -- /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 --realm master --user admin --password admin-password
     # update your realm config
     kubectl exec -it keycloak-pod -- /opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=none
     ```

   - 也可以直接在管理控制台 → Realm → Realm Settings → Login → Require SSL 处改为 `none`。

> ⚠️ **不建议**直接写库 `update REALM set ssl_required='NONE'`：直接改库绕过了 Infinispan 缓存层，可能导致缓存与数据库不一致，且不在 Keycloak 官方支持范围内。请优先使用 `kcadm.sh` 或控制台。
