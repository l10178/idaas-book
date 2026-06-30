---
title: "用户增删改查端到端"
description: "Keycloak Admin REST API 实战：用 curl 完成获取 token、列出用户、创建用户、解析 Location 头、删除用户的完整端到端流程"
date: 2021-04-17T12:50:38+08:00
draft: false
weight: 1
menu:
  docs:
    parent: "keycloak-admin-api"
    identifier: "keycloak-user-end2end"
toc: true
---

Keycloak Admin REST API，curl 模拟用户增加修改删除的完整例子。

```bash
#!/bin/bash

HOST_IP=127.0.0.1
HOST_NAME=keycloak.example
DEFAULT_REALM=master
ADMIN_API_URL=http://${HOST_IP}/auth/admin/realms/${DEFAULT_REALM}
USER_API_URL=${ADMIN_API_URL}/users

# admin user
ADMIN_NAME=xxx
ADMIN_PWD=xxx

parse_json() {
 echo "${1//\"/}" | sed "s/.*$2:\([^,}]*\).*/\1/"
}

echo "====Begin test user CRUD===="

token_url=http://${HOST_IP}/auth/realms/${DEFAULT_REALM}/protocol/openid-connect/token
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
