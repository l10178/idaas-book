---
title: "Keycloak HTTPS Required 错误与反向代理排错指南 | IDaaS Book"
description: "Keycloak 报 HTTPS required 或 Invalid redirect_uri 的排查：核对 KC_PROXY_HEADERS、KC_HOSTNAME 与反向代理 X-Forwarded-* 头。"
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

   生产环境可以在反向代理 / Ingress 上终结 TLS，但必须让 Keycloak 解析代理实际写入的头。Keycloak 26+ 使用 `KC_PROXY_HEADERS=xforwarded`（或 `forwarded`），而不是照搬旧版 `proxy=edge`；同时固定公网地址，避免它根据内部请求推断回调地址。详见 [Keycloak 26+ 代理头排错]({{< relref "../../solution-blogs/keycloak-redirect-loop-troubleshooting" >}}) 和[安全增强功能]({{< relref "../security-features/_index.md" >}})。

   例如 TLS 在 Ingress 终结、Keycloak Pod 内使用 HTTP，且 Ingress 覆盖写入 `X-Forwarded-*`：

   ```yaml
   env:
   - name: KC_HTTP_ENABLED
     value: "true"
   - name: KC_PROXY_HEADERS
     value: "xforwarded"
   - name: KC_HOSTNAME
     value: "https://keycloak.example.com"
   ```

   如果代理发送的是标准 `Forwarded` 头，把 `KC_PROXY_HEADERS` 改为 `forwarded`；不要混用两种格式。代理必须覆盖而不是追加客户端提交的同名头，并把 Keycloak Service 限制为只能由受信任代理访问。

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
