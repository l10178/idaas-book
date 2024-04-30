---
title: "Https Required"
date: 2020-12-10T23:59:00+08:00
draft: false
---

## 问题描述

以 Http 方式登录，页面错误提示如下。

`We're sorry... HTTPS required.`

## 问题原因

keycloak 各个 Realm 默认的登录设置里，`Require SSL` 为 `external requests`，对于外部请求，必须是 Https。
非外部请求，也就是私有地址，可以是 http，如：`localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x, 172.16.x.x`。
详细参考[官方文档说明](https://www.keycloak.org/docs/latest/server_installation/index.html#setting-up-https-ssl)。

## 解决方案

1. 配置 https 并使用 https 登录，毫无疑问，这是正确的解决方案。
2. 如果只是测试环境，可以修改 Realm 的设置，`Require SSL` 改为 `none`。

   - 修改数据方式

     ```sql
     update REALM set ssl_required='NONE' where id = 'master';
     ```

   - K8S 命令行调用 keycloak 官方 admin 工具 kcadm 修改

     ```bash
     # login with a admin user
     kubectl exec -it keycloak-pod -- /opt/jboss/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user admin --password admin-password
     # update your realm config
     kubectl exec -it keycloak-pod -- /opt/jboss/keycloak/bin/kcadm.sh update realms/master -s sslRequired=none
     ```
