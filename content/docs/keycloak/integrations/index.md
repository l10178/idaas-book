---
title: "Keycloak 与第三方开源软件集成"
description: "Keycloak 单点登录集成实战：Grafana / GitLab / Jenkins / NGINX Ingress / Kubernetes / Vault / Harbor / MinIO / Nextcloud 等常见开源软件通过 OIDC / OAuth2 Proxy 对接 Keycloak"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 15
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-integrations"
toc: true
---

Keycloak 之所以成为 IDaaS 首选，很大程度是因为它天然适配开源生态——Grafana、GitLab、Jenkins、Kubernetes、Vault、Harbor 等常见软件要么原生支持 OIDC/SAML，要么通过 OAuth2 Proxy 轻松接入。本节给出一套「配方集」，按软件查配方，最小改动落地 SSO。

> 前置：先在 Keycloak 创建一个 `confidential` Client，记录 `client_id`、`client_secret`、`redirect_uri`。除非特别说明，统一用 **OIDC + 授权码模式 + PKCE**。

## 通用模式：OAuth2 Proxy

绝大多数本身不支持 OIDC 的 Web 服务，都可以用 [`oauth2-proxy`][oauth2-proxy] 在前置反代中统一接入。它是 Keycloak 集成的瑞士军刀。

```ini
# oauth2-proxy.cfg
provider          = "keycloak-oidc"
oidc_issuer_url   = "https://kc.example.com/realms/myrealm"
client_id         = "oauth2-proxy"
client_secret     = "SECRET"
redirect_url      = "https://app.example.com/oauth2/callback"
email_domains     = "example.com"
cookie_secret     = "32字节随机"
set_authorization_header = true
pass_access_token        = true
```

```nginx
# Nginx 前置
location /oauth2/ { proxy_pass http://127.0.0.1:4180; }
location / {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/start;
    proxy_pass http://upstream_app;
}
```

下面各软件若原生支持 OIDC 则优先用原生，否则用此模式。

## Grafana

Grafana 原生支持 OIDC，配置 `grafana.ini`：

```ini
[auth.generic_oauth]
enabled = true
name   = Keycloak
client_id     = grafana
client_secret = SECRET
scopes        = openid email profile
auth_url      = https://kc.example.com/realms/myrealm/protocol/openid-connect/auth
token_url     = https://kc.example.com/realms/myrealm/protocol/openid-connect/token
api_url       = https://kc.example.com/realms/myrealm/protocol/openid-connect/userinfo
login_attribute_path = preferred_username
groups_attribute_path = groups
role_attribute_path   = contains(groups[*], 'grafana-admin') && 'Admin' || 'Viewer'
allow_sign_up = true
```

要点：

- 在 Keycloak Client 的 **Protocol Mappers** 加 `groups` mapper（把用户 Realm/Client 角色映射成 `groups` claim），即可用角色驱动 Grafana 权限。
- `role_attribute_path` 把 Keycloak 角色映射为 Grafana `Admin`/`Editor`/`Viewer`。

## GitLab

GitLab 通过 OmniAuth 支持 OIDC（`gitlab.rb`）：

```ruby
gitlab_rails['omniauth_providers'] = [
  {
    name: "openid_connect",
    label: "Keycloak",
    args: {
      name: "openid_connect",
      scope: ["openid", "profile", "email"],
      response_type: "code",
      issuer: "https://kc.example.com/realms/myrealm",
      discovery: true,
      client_auth_method: "basic",
      uid_field: "preferred_username",
      send_scope_to_token_endpoint: true,
      client_options: {
        identifier: "gitlab",
        secret: "SECRET",
        redirect_uri: "https://gitlab.example.com/users/auth/openid_connect/callback"
      }
    }
  }
]
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
```

要点：

- Keycloak Client 的 `redirect_uri` 精确填 `https://gitlab.example.com/users/auth/openid_connect/callback`。
- 通过 `groups` claim 映射 GitLab Group/角色，实现按域控制权限。

## Jenkins

Jenkins 用 [OAuth2 / OIDC 插件][jenkins-oidc] 或 [Keycloak 插件][jenkins-keycloak]。推荐 Keycloak 插件（更贴合）：

1. 安装 **Keycloak Authentication Plugin**。
2. Manage Jenkins → Configure Global Security → Security Realm = Keycloak。
3. 填 Keycloak URL、Realm、Client ID/Secret。
4. 角色策略：用 Keycloak Realm 角色映射 Jenkins 角色（`admin`/`develop`/`read`）。

> CI 场景的「机器账号」用 Service Account + Client Credentials，不要给流水线人工账号。

## Kubernetes / NGINX Ingress

Kubernetes 体系下，最常见的是在 **NGINX Ingress Controller** 前置 `oauth2-proxy`，按 Ingress 注解启用：

```yaml
# oauth2-proxy Deployment + Service（kube-system）
apiVersion: apps/v1
kind: Deployment
metadata: { name: oauth2-proxy, namespace: kube-system }
spec:
  replicas: 1
  selector: { matchLabels: { app: oauth2-proxy } }
  template:
    metadata: { labels: { app: oauth2-proxy } }
    spec:
      containers:
      - name: oauth2-proxy
        image: quay.io/oauth2-proxy/oauth2-proxy:v7.15.0
        args:
        - --provider=keycloak-oidc
        - --oidc-issuer-url=https://kc.example.com/realms/myrealm
        - --client-id=oauth2-proxy
        - --client-secret=SECRET
        - --cookie-secret=xxxxxxxxxxxxxxxx
        - --email-domain=*
        - --set-authorization-header
        ports: [{ containerPort: 4180 }]
```

```yaml
# 业务 Ingress，启用认证
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  annotations:
    nginx.ingress.kubernetes.io/auth-url: "https://$host/oauth2/auth"
    nginx.ingress.kubernetes.io/auth-signin: "https://$host/oauth2/start?rd=$escaped_request_uri"
spec:
  rules:
  - host: app.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend: { service: { name: app, port: { number: 80 } } }
```

> 这是「网关层 SSO」模式：业务代码无需感知身份，鉴权在入口完成。详见 [第18章 · 集成模式]({{< relref "docs/implementation/integration-patterns.md" >}})。

### Keycloak + oauth2-proxy 生产排错清单

`oauth2-proxy` 与 Keycloak 对接时，高频问题往往不是「OIDC 不通」，而是 issuer、audience、回调地址或反向代理头不一致。上线前建议按下表逐项核对：

| 症状 / 报错 | 常见根因 | 修正方式 |
|-------------|----------|----------|
| `expected audience` / `invalid aud`，日志里只有 `account` | Keycloak access token 的 `aud` 没有包含 oauth2-proxy 的 `client_id` | 在 Keycloak Client 增加 **Audience mapper**，把 `Included Client Audience` 设为 `oauth2-proxy`；或在 oauth2-proxy 显式配置 `--oidc-extra-audience`。 |
| 登录后反复跳转 / `csrf cookie not found` | `redirect_url`、Ingress `auth-signin`、Cookie Domain / SameSite 与实际访问域名不一致 | `redirect_url` 固定为外部入口 `https://app.example.com/oauth2/callback`；Ingress 使用 `$host` 与 `$escaped_request_uri`；跨子域共享时再设置 `--cookie-domain=.example.com`。 |
| `/oauth2/auth` 返回 401，但用户已登录 | 业务 Ingress 没把认证响应头传给后端，或 oauth2-proxy 未开启 header 输出 | oauth2-proxy 开启 `--set-xauthrequest=true`；NGINX Ingress 用 `auth-response-headers` 透传 `X-Auth-Request-User`、`X-Auth-Request-Email`、`X-Auth-Request-Groups`。 |
| Keycloak 回调到 `http://` 或错误 host | Keycloak / oauth2-proxy 后面有反向代理，但 `X-Forwarded-*` 头或 proxy 配置缺失 | 入口层保留 `X-Forwarded-Proto`、`X-Forwarded-Host`；Keycloak 侧按生产反向代理章节配置 hostname/proxy headers。 |
| Keycloak 17+ 后 issuer 不匹配 | 仍沿用旧 WildFly 路径 `/auth/realms/<realm>` | 新部署默认使用 `https://kc.example.com/realms/<realm>`；只有旧版本或保留兼容路径时才使用 `/auth/realms/<realm>`。 |

一个较稳的最小配置如下，重点是 issuer、audience、PKCE、cookie secret 与 header 输出都显式写清：

```bash
oauth2-proxy \
  --provider=keycloak-oidc \
  --oidc-issuer-url=https://kc.example.com/realms/myrealm \
  --client-id=oauth2-proxy \
  --client-secret=$OAUTH2_PROXY_CLIENT_SECRET \
  --redirect-url=https://app.example.com/oauth2/callback \
  --cookie-secret=$OAUTH2_PROXY_COOKIE_SECRET \
  --email-domain='*' \
  --code-challenge-method=S256 \
  --set-xauthrequest=true \
  --set-authorization-header=true
```

验证顺序不要反：先访问 `https://kc.example.com/realms/myrealm/.well-known/openid-configuration` 确认 issuer；再登录一次并解码 access token，确认 `aud` 包含 `oauth2-proxy`；最后用浏览器开发者工具检查 `/oauth2/callback` 是否设置了同站点可用的 cookie。生产回滚最简单：移除业务 Ingress 的认证注解或 Traefik ForwardAuth middleware，保留 oauth2-proxy Deployment 以便排查，不要在事故中先删 Keycloak Client。需要完整的 Ingress / ForwardAuth 配置、验证命令和回滚步骤，可参考 [Keycloak + oauth2-proxy 保护内部应用：Ingress 与 ForwardAuth 配置清单]({{< relref "blog/keycloak-oauth2-proxy-ingress-forwardauth.md" >}})。

## Vault

Vault 用 **JWT/OIDC Auth Method**，让 Keycloak 签发的 token 直接换取 Vault token，实现云原生密钥获取：

```bash
vault auth enable oidc
vault write auth/oidc/config \
  oidc_discovery_url="https://kc.example.com/realms/myrealm" \
  client_id="vault" \
  client_secret="SECRET" \
  default_role="engineer"

# 角色：把 Keycloak groups claim 映射到 Vault policy
vault write auth/oidc/role/engineer \
  bound_audiences="vault" \
  allowed_redirect_uris="https://vault.example.com/ui/vault/auth/oidc/oidc/callback" \
  user_claim="sub" \
  groups_claim="groups" \
  policies="default,engineer" \
  ttl="1h"
```

配合外部组映射（identity/group）即可按 Keycloak 角色决定 Vault 权限。

## Harbor

Harbor 原生支持 OIDC（Configuration → Authentication → OIDC）：

| 字段 | 值 |
|------|-----|
| OIDC Provider Name | Keycloak |
| OIDC Endpoint | `https://kc.example.com/realms/myrealm` |
| OIDC Client ID | harbor |
| OIDC Client Secret | SECRET |
| OIDC Scope | openid,profile,email,groups |
| Group Claim Name | groups |

要点：开启 `Verify Certificate`；用 `groups` claim 映射 Harbor 项目成员角色，实现按组授权镜像仓库。

## MinIO

MinIO 支持 OIDC（`mc` 或环境变量）：

```bash
mc admin config set myminio identity_openid \
  config_url="https://kc.example.com/realms/myrealm/.well-known/openid-configuration" \
  client_id="minio" \
  client_secret="SECRET" \
  claim_name="policy" \
  claim_prefix="" \
  scopes="openid,profile"
mc admin service restart myminio
```

通过自定义 `policy` claim（Protocol Mapper 输出）或 Keycloak 角色到 MinIO policy 的映射，控制对 bucket 的访问。

## Nextcloud

Nextcloud 用 **Social login / OIDC 插件**：

```php
// config.php 片段
'oidc_login_provider' => [
  'clientId'     => 'nextcloud',
  'clientSecret'  => 'SECRET',
  'oidcIssuer'   => 'https://kc.example.com/realms/myrealm',
  'authEndpoint' => 'https://kc.example.com/realms/myrealm/protocol/openid-connect/auth',
  'tokenEndpoint'=> 'https://kc.example.com/realms/myrealm/protocol/openid-connect/token',
  'userInfoEndpoint' => 'https://kc.example.com/realms/myrealm/protocol/openid-connect/userinfo',
],
'oidc_login_auto_redirect' => true,
'oidc_login_button_text'  => 'Keycloak 登录',
```

## 通用接入步骤速查

不论软件用原生还是 oauth2-proxy，通用五步：

1. 在 Keycloak 创建 `confidential` Client，开启 `Client Authentication` 与 `Authorization Code + PKCE`。
2. 精确配置 `Valid redirect URI`（含回调路径），避免通配。
3. 在 Client 的 **Protocol Mappers** 加 `email`、`profile`、`groups` 等所需 claim。
4. 软件侧填 Issuer / Auth / Token / UserInfo / 客户端凭证。
5. 联调一次登录流程，确认回调、token、用户属性、角色映射正确。

## 小结

Keycloak 与开源生态的集成主要分两条路：**原生 OIDC**（Grafana、GitLab、Harbor、Vault、MinIO、Nextcloud 等）与 **前置 OAuth2 Proxy**（任意 Web 服务、K8s Ingress）。掌握这两条路、五步通用流程与 Protocol Mapper 的 claim 映射，即可把一整套开源软件统一纳入 SSO，这正是 IDaaS「一次接入、全网通行」的落地价值。集成中遇到具体报错，参见 [常见问题排查]({{< relref "docs/keycloak/troubleshooting/_index.md" >}})。

[oauth2-proxy]: https://oauth2-proxy.github.io/oauth2-proxy/
[jenkins-oidc]: https://plugins.jenkins.io/oic-auth/
[jenkins-keycloak]: https://plugins.jenkins.io/keycloak/