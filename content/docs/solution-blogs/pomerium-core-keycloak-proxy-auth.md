---
title: "Pomerium Core 代理认证实战：Keycloak + JWT 验签保护内部应用 | IDaaS Book"
description: "开源版 Pomerium Core 落地代理认证：Keycloak OIDC 对接（/oauth2/callback）、最小 Docker Compose、路由与 PPL 策略、上游 X-Pomerium-Jwt-Assertion 验签、验证步骤、常见错误与回滚。"
date: 2026-09-11T00:00:00+08:00
lastmod: 2026-09-11T00:00:00+08:00
draft: false
weight: 76
menu:
  docs:
    parent: "solution-blogs"
    identifier: "pomerium-core-keycloak-proxy-auth"
toc: true
---

## 场景

你有一组**完全没有认证能力**的内部服务（Grafana、自研管理后台、内部 API、Kibana 之类），想用一个代理把登录和访问控制都做掉：Keycloak 负责「你是谁」，Pomerium Core（开源版）负责「你能不能进、进哪个上游」，并且**上游应用能拿到可信的身份**去写审计日志、做数据行级过滤。

本文用**开源版**给出可直接跑起来的最小配置。目标不是「能登录」，而是链路上每一环都可验证：

1. 未登录访问被拦到 Keycloak；
2. 登录成功后回到原 URL，上游拿到 `X-Pomerium-Jwt-Assertion`；
3. 上游**验签**通过后才信任身份；
4. 出错时知道是哪一环的问题。

> ⚠️ 前置认知：Pomerium 从 **v0.21 起移除了 forward auth**（`forward_auth_url` / Nginx `auth_request` 那套），Pomerium 自己就是数据面。如果你手上是「Pomerium + Nginx auth_request」的老教程，请先看 [Pomerium 深度介绍]({{< relref "../implementation/pomerium-deep-dive.md" >}}) 里的迁移章节。

## 适用 / 不适用

| 适合 | 不适合 |
|------|--------|
| 内部应用统一入口，要求路由级策略（域/claim/路径/IP） | 只需要一个「登录后才能访问」的极简代理（oauth2-proxy 更轻） |
| 上游需要可信身份（验签 JWT）做二次授权或审计 | 上游应用已经完整实现 OIDC 且不需要网关策略 |
| 需要同时接入 HTTP 与 TCP/SSH 类服务 | 只想给单个应用加个登录页 |
| 希望策略用声明式配置受版本控制 | 团队没有维护 Envoy/网关的经验，且没有运维投入 |

## 拓扑

```mermaid
graph LR
    U[浏览器] -->|https://grafana.internal.example.com| P[Pomerium Core<br/>v0.33.x :443]
    P -->|OIDC| K[Keycloak<br/>authenticate.example.com]
    P -->|转发 + X-Pomerium-Jwt-Assertion| G[Grafana :3000]
    P -->|转发 + 验签| A[自研后台 :8080]
    P -.->|JWKS| J[/.well-known/pomerium/jwks.json]
```

三个域名落到同一个 Pomerium：`authenticate.example.com`（认证服务）、应用的对外域名（路由 `from`）、上游内网地址（路由 `to`）。

## 第 1 步：Keycloak 侧

| 配置项 | 值 |
|--------|-----|
| Realm | `internal` |
| Client ID | `pomerium-core` |
| Client authentication | 开启（confidential client） |
| Standard flow | 开启 |
| Valid redirect URIs | `https://authenticate.example.com/oauth2/callback` |
| Web origins | `https://authenticate.example.com` |

**回调路径是固定的 `/oauth2/callback`，挂在认证服务域名上**。v0.31 起 `authenticate_callback_path` 设置被移除，这个路径不可改；IdP 侧填错就会在登录时直接报 `redirect_uri_mismatch`。

需要在策略里按维度区分人群时，加一个 **Group Membership mapper** 把组写进 token（scope 里带上 `groups`），然后在 PPL 里用 `claim/groups` 匹配：

```bash
# 确认 claim 真的在 token 里（不要跳过这一步，很多"策略不生效"其实是 claim 不在）
curl -s -H "Authorization: Bearer <access_token>" \
  https://authenticate.example.com/realms/internal/protocol/openid-connect/userinfo | jq '.groups'
```

## 第 2 步：Pomerium Core 配置

```yaml
# config.yaml
address: :443
http_redirect_addr: :80
authenticate_service_url: https://authenticate.example.com

# --- IdP ---
idp_provider: oidc
idp_client_id: pomerium-core
idp_client_secret: "${KEYCLOAK_CLIENT_SECRET}"
idp_provider_url: https://authenticate.example.com/realms/internal
idp_scopes: [openid, email, profile, groups]

# --- 密钥（生产用 *_file，把值放进 Secret）---
signing_key_file: /pomerium/ec_private.pem      # 给上游验签用的签名私钥
cookie_secret_file: /pomerium/cookie_secret     # 会话 Cookie 加解密
shared_secret_file: /pomerium/shared_secret     # 服务间互认证

# --- 路由 ---
routes:
  - from: https://grafana.internal.example.com
    to: http://grafana.monitoring.svc.cluster.local:3000
    pass_identity_headers: true                 # 注入签名 JWT
    policy:
      - allow:
          and:
            - domain:
                is: example.com
            - claim/department:
                is: platform

  - from: https://console.internal.example.com
    to: http://console.internal.svc.cluster.local:8080
    pass_identity_headers: true
    idle_timeout: 10m
    policy:
      - allow:
          and:
            - claim/groups:
                contains: iam-admins
      - deny:
          or:
            - email:
                is: contractor@example.com
```

生成密钥：

```bash
openssl ecparam -genkey -name prime256v1 -noout -out ec_private.pem
head -c32 /dev/urandom | base64 > cookie_secret
head -c32 /dev/urandom | base64 > shared_secret
```

> 🔴 **开源版的坑**：`groups` 不是可用判据（v0.20 起对开源版移除），`groups.has: xxx` 会直接配置失败。用 `claim/groups` 配合匹配器（`contains` / `in` / `is`）。`date`、`day_of_week`、`time_of_day` 属 Zero/Enterprise；`record` 属 Enterprise。

## 第 3 步：验证链路（三段式）

```bash
# ① 未登录：应被重定向到认证服务，而不是直接 200
curl -sI https://grafana.internal.example.com/ | egrep -i "HTTP/|location"
#   HTTP/2 302
#   location: https://authenticate.example.com/.pomerium/... 或认证服务登录入口

# ② 公开端点与内部端点可达（排障用，不需要登录）
curl -sI https://grafana.internal.example.com/ping        # 200
curl -s  https://grafana.internal.example.com/.well-known/pomerium/jwks.json | jq '.keys[0].kid'

# ③ 带浏览器会话访问上游后，在上游看断言头（示例应用 /headers 会把头打印出来）
#    X-Pomerium-Jwt-Assertion: eyJhbGciOi...
```

把 JWT 解出来核对三个值：

```bash
# 手工解码 payload（不做验签，仅核对取值）
cut -d. -f2 <<< "$TOKEN" | tr '_-' '/+' | base64 -d 2>/dev/null | jq '{iss, aud, email, exp: (.exp|todate)}'
```

预期：`aud` 等于**当前路由的对外域名**，`iss` 与之对应（默认同为路由主机名），`exp` 只比 `iat` 晚 **5 分钟**。

## 第 4 步：上游验签（真实保护点）

```python
# app.py —— Flask + PyJWT，进程内缓存 JWKS
from flask import Flask, request, jsonify
import jwt
from jwt import PyJWKClient

APP_HOST = "console.internal.example.com"
JWKS_URL = f"https://{APP_HOST}/.well-known/pomerium/jwks.json"
jwks = PyJWKClient(JWKS_URL, cache_keys=True)

app = Flask(__name__)

@app.get("/api/whoami")
def whoami():
    raw = request.headers.get("X-Pomerium-Jwt-Assertion")
    if not raw:
        return jsonify(error="missing identity header"), 401
    try:
        key = jwks.get_signing_key_from_jwt(raw)
        claims = jwt.decode(
            raw,
            key.key,
            algorithms=["ES256", "RS256"],
            audience=APP_HOST,     # 必须校验：多路由共用一套部署时的安全边界
            issuer=APP_HOST,
            leeway=10,             # exp 只有 5 分钟，时钟容差别开太大
        )
    except jwt.PyJWTError as exc:
        return jsonify(error=f"invalid identity: {exc}"), 401
    return jsonify(email=claims["email"], sub=claims["sub"], groups=claims.get("groups"))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

没有 SDK 的场景（Nginx 作上游、或语言栈不便引入 JWT 库）可以用两个「不需要改应用」的替代方案：

1. **验签侧车**：用 Envoy 的 `jwt_authn` filter 或 `pomerium/verify` 之类的小服务把断言验掉，再把清洗后的头（如 `X-Auth-Email`）交给应用；
2. **网络隔离 + 明文头**：只在「上游仅允许 Pomerium 访问」且已 `remove_request_headers` 清掉客户端自带同名头时，才可以使用 `X-Pomerium-Claim-Email` 这类**未签名**头。

## 常见错误表

| 症状 | 根因 | 处理 |
|------|------|------|
| Keycloak 报 `Invalid parameter: redirect_uri` | `Valid redirect URIs` 没填 `https://authenticate.<domain>/oauth2/callback` | 补齐（路径不可改） |
| 登录成功但回到应用又要登录 | `authenticate_service_url` 与实际访问域名不一致；或 Cookie 未带 Secure/域不匹配 | 保证协议+域名完全一致；不要无谓设置 `cookie_domain` |
| 上游 401 `invalid audience` | 解码时 `audience` 填成了内网地址或认证域名 | `aud` = 路由 `from` 的主机名 |
| 上游 401 `signature verification failed` | JWKS 缓存未刷新（轮换过密钥）或取错端点 | 刷新 `/.well-known/pomerium/jwks.json`，按 `kid` 选 key |
| 上游偶尔 401（大量请求时明显） | JWT 的 `exp` 只有 5 分钟，客户端/服务端时钟偏移 | 校时（chrony/NTP），`leeway` 控制在十几秒内 |
| 策略里的组条件不生效 | 用了 `groups` 判据（Core 不支持），或 token 没有该 claim | 改 `claim/groups`；先在 userinfo 里确认 claim 存在 |
| 浏览器报 ERR_TOO_MANY_REDIRECTS | 上游自己也在做 OAuth，把 Pomerium 的重定向再重定向 | 上游应用只做验签，不再触发登录流程 |
| 上游 502/503 | `to:` 地址不可达 | K8s 用 FQDN；确认 NetworkPolicy 允许 Pomerium 访问上游 |
| 服务启动失败，提示未知字段 | 配置里残留 `forward_auth_url`、Redis 存储、`authenticate_callback_path` 等已移除项 | 按官方 upgrading 文档替换 |

## 回滚

代理认证会改变全部流量入口，上线前先准备两条退路：

```bash
# 方案 A：DNS/负载均衡指回旧入口（最快，秒级生效）
# 方案 B：临时放开某条路由（只用于止血，随后立刻恢复并复盘）
#   在路由下临时加：
#   allow_public_unauthenticated_access: true
kubectl -n pomerium rollout restart deploy/pomerium   # 或 systemctl restart pomerium
```

配置与密钥全部走版本控制和 Secret 管理（`shared_secret_file`、`cookie_secret_file`、`signing_key_file`），不要写进镜像；`signing_key` 轮换时保留旧公钥一段时间，避免上游验签窗口内全部 401。

## 相关阅读

- [Pomerium 深度介绍 — 开源版身份感知代理与代理认证实践]({{< relref "../implementation/pomerium-deep-dive.md" >}})
- [oauth2-proxy 深度介绍]({{< relref "../implementation/oauth2-proxy-deep-dive.md" >}}) 与 [oauth2-proxy 常见错误排错]({{< relref "oauth2-proxy-common-errors" >}})
- [Traefik ForwardAuth + Keycloak + oauth2-proxy]({{< relref "traefik-forwardauth-keycloak" >}})
- [零信任 IAM：JWT 与 Introspection 的边界]({{< relref "../advanced-topics/zero-trust-identity" >}})
- [Keycloak + oauth2-proxy 集成指南]({{< relref "keycloak-oauth2-proxy" >}})
