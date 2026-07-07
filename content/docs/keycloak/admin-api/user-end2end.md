---
title: "Keycloak Admin API 实战：用户增删改查端到端操作指南 | IDaaS Book"
description: "Keycloak Admin REST API 实战：用 curl 完成获取 token、列出用户、创建用户、解析 Location 头、删除用户的完整端到端流程"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 1
menu:
  docs:
    parent: "keycloak-admin-api"
    identifier: "keycloak-user-end2end"
toc: true
---

Keycloak Admin REST API，curl 模拟用户增加修改删除的完整例子。

> 以下示例以 Keycloak 17+（Quarkus 发行版）为准，默认上下文路径为 `/`，故 URL **不带** `/auth` 前缀。若你的部署用 `http-relative-path=/auth` 兼容了旧客户端，请在每条 URL 前补回 `/auth`。`localhost:8080` 仅用于本地演示，生产请改用 `https://<域名>`。

```bash
#!/bin/bash

HOST_IP=127.0.0.1
HOST_NAME=keycloak.example
DEFAULT_REALM=master
ADMIN_API_URL=http://${HOST_IP}/admin/realms/${DEFAULT_REALM}
USER_API_URL=${ADMIN_API_URL}/users

# admin user
ADMIN_NAME=xxx
ADMIN_PWD=xxx

parse_json() {
 echo "${1//\"/}" | sed "s/.*$2:\([^,}]*\).*/\1/"
}

echo "====Begin test user CRUD===="

token_url=http://${HOST_IP}/realms/${DEFAULT_REALM}/protocol/openid-connect/token
# Get token, a json
token_json=$(curl -X POST \
 -H "host:${HOST_NAME}" \
 -H "Content-Type: application/x-www-form-urlencoded" \
 ${token_url} \
 --data 'grant_type=password' \
 --data 'client_id=admin-cli' \
 --data "username=${ADMIN_NAME}" \
 --data "password=${ADMIN_PWD}")

# get the `access_token` from the json
token=$(parse_json "$token_json" "access_token")

# List users
curl -X GET -H "Authorization: Bearer ${token}" \
 -H "host:${HOST_NAME}" \
 ${USER_API_URL} -v

# Add new user
username=usertest$(date "+%Y%m%d%H%M%S%s")
user={\"enabled\":true,\"attributes\":{},\"username\":\"${username}\",\"emailVerified\":\"\"}

echo "Begin create new user ${username}."

user_create_rsp=$(curl -i -s -H "Authorization: Bearer ${token}" \
 -H "host:${HOST_NAME}" \
 -H "Content-Type: application/json" \
 --data "${user}" \
 ${USER_API_URL} --stderr -)

# Get user id full url from response header `Location`
# < Location: http://xxxx/users/9e901054-bbc7-47db-8a68-4a13474a1080
# The `tr -d` is to fix `Error curl: (3) URL using bad/illegal format or missing URL`
user_id_url=$(echo "${user_create_rsp}" | grep -Fi Location | tr -d '\r' | awk '{print $2}')

# Get only the id from the url
user_id=$(echo ${user_id_url} | awk -F'/' '{print $NF}')
echo "User id is ${user_id} ."

# Delete user by id
curl -X DELETE -H "Authorization: Bearer ${token}" \
 -H "host:${HOST_NAME}" \
 -H "Content-Type: application/json" \
 "${USER_API_URL}/${user_id}"

echo "====End test user CRUD===="

```
## Admin CLI 方式

```bash
# 获取 Admin Token
kcadm.sh config credentials --server http://localhost:8080 \
  --realm master --user admin --password admin

# 创建用户
kcadm.sh create users -r myrealm \
  -s username=alice -s email=alice@example.com -s enabled=true

# 设置密码
kcadm.sh set-password -r myrealm \
  --username alice --new-password changeme --temporary

# 查询用户
kcadm.sh get users -r myrealm -q username=alice

# 更新用户
kcadm.sh update users/USER_ID -r myrealm \
  -s firstName=Alice -s lastName=Smith

# 删除用户
kcadm.sh delete users/USER_ID -r myrealm
```

## REST API 方式

```bash
# 先获取 Admin Token
TOKEN=$(curl -s -X POST http://localhost:8080/realms/master/protocol/openid-connect/token \
  -d 'grant_type=password&client_id=admin-cli&username=admin&password=admin' \
  | jq -r '.access_token')

# 创建用户
curl -X POST http://localhost:8080/admin/realms/myrealm/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","enabled":true}'

# 列出用户
curl http://localhost:8080/admin/realms/myrealm/users \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {id,username,email}'
```

## 常见问题

**Q: 创建用户后收不到密码重置邮件？**
检查 `Realm Settings > Email` 中 SMTP 配置是否正确，测试连接后再试。

**Q: 批量导入用户？**
使用 Keycloak 的 Partial Import 功能，或直接通过 Admin API 循环调用创建接口。

**Q: 用户属性（attributes）怎么设？**
在创建请求的 `attributes` 字段中传 JSON 对象，例如 `{"department":"engineering","region":"cn"}`。
