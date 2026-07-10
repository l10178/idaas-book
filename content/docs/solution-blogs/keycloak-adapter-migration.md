---
title: "Keycloak Adapter 弃用迁移指南 — 从专用 Adapter 迁移到标准 OIDC 库 | IDaaS Book"
description: "Keycloak Adapter 弃用后迁移到标准 OIDC 库的完整指南：Java/Spring Boot、Node.js、Python、.NET 的迁移路径与常见踩坑"
date: 2026-07-09T00:00:00+08:00
lastmod: 2026-07-09T00:00:00+08:00
draft: false
weight: 10
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-adapter-migration"
toc: true
---

## 场景

你的项目几年前接入了 Keycloak，用的是官方推荐的 Keycloak Adapter（`keycloak-spring-security-adapter`、`keycloak-connect`、`keycloak-python` 等）。最近升级依赖或做安全审查时发现：**这些 Adapter 已经被 Keycloak 官方弃用，不再维护了**。

继续用会有什么问题？旧 Adapter 绑定了 Keycloak 特定版本、依赖老旧框架（如 WildFly、javax），安全补丁不再跟进，且与 Spring Boot 3+ / Jakarta EE 不兼容。需要迁移到各语言生态的标准 OIDC 库。

这篇文章按语言给出迁移路径、最小配置和常见踩坑。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 还在用 `keycloak-spring-security-adapter` 的 Spring Boot 应用 | 已经在用 Spring Security OAuth2 Client 或标准 OIDC 库（继续保持） |
| 还在用 `keycloak-connect` 的 Express.js/Node.js 应用 | 用的是 Keycloak Admin Client（`keycloak-admin-client`）——这是 REST API 客户端，不需要迁移 |
| 还在用 `keycloak-python` 或自写的 Adapter 模式对接 | 前端 SPA 直接对接 Keycloak（前端用 keycloak-js 的情况不同，需单独评估） |
| 升级到 Spring Boot 3.x 后发现 Adapter 不兼容 | 应用根本没有认证/授权需求 |

> **注意区分**：`keycloak-admin-client`（REST API 管理客户端，Maven artifact `org.keycloak:keycloak-admin-client`）**不需要迁移**。它是基于标准 REST API 的，与 Adapter 无关。本文讨论的是用于「保护应用、拦截请求」的认证 Adapter。

## Adapter 弃用时间线

| 版本 | 变化 |
|------|------|
| Keycloak 17 | 首个 Quarkus 发行版；旧 WildFly 发行版停更；部分 Adapter 标记 deprecated |
| Keycloak 19 | 大部分语言 Adapter 从主仓库移除，不再随发行版发布 |
| Keycloak 24+ | 所有 Adapter 彻底弃用，官方文档中移除相关章节；明确推荐各语言生态的标准 OIDC 库 |

官方声明：**不要在新项目中使用 Keycloak Adapter，已用项目尽快迁移。** 参考 [Keycloak Securing Applications Guide](https://www.keycloak.org/docs/latest/securing_apps/) 中关于标准 OIDC 库的推荐。

## 迁移路径：逐语言

### Java / Spring Boot

**旧方案**：

```xml
<!-- 已弃用，不要继续使用 -->
<dependency>
    <groupId>org.keycloak</groupId>
    <artifactId>keycloak-spring-boot-starter</artifactId>
    <version>21.0.0</version>
</dependency>
```

```java
// keycloak.json 或 keycloak.yml 配置方式，已弃用
```

**新方案：Spring Security OAuth2 Client**

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-oauth2-client</artifactId>
</dependency>
```

`application.yml`：

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-id: my-app
            client-secret: ${KC_CLIENT_SECRET}
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope: openid, profile, email, roles
        provider:
          keycloak:
            issuer-uri: https://kc.example.com/realms/myrealm
            user-name-attribute: preferred_username
```

安全配置（SecurityConfig）：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2.defaultSuccessUrl("/home"))
            .logout(logout -> logout
                .logoutSuccessHandler(oidcLogoutSuccessHandler())
            );
        return http.build();
    }

    private LogoutSuccessHandler oidcLogoutSuccessHandler() {
        OidcClientInitiatedLogoutSuccessHandler handler =
            new OidcClientInitiatedLogoutSuccessHandler(clientRegistrationRepository);
        handler.setPostLogoutRedirectUri("{baseUrl}");
        return handler;
    }
}
```

**迁移要点**：

1. **角色映射**：Keycloak Adapter 会自动把 Realm Roles 映射到 `ROLE_*`，Spring Security OAuth2 Client 需要手动配置 `GrantedAuthoritiesMapper`。
2. **`keycloak.json` → `application.yml`**：所有 Keycloak 连接参数从外部 JSON 文件迁移到 Spring Security 标准 YAML 配置。
3. **Logout**：从 `KeycloakLogoutHandler` 迁移到 `OidcClientInitiatedLogoutSuccessHandler`。

### Node.js / Express

**旧方案**：

```javascript
// keycloak-connect 已弃用
const Keycloak = require('keycloak-connect');
const keycloak = new Keycloak({}, keycloakConfig);
app.use(keycloak.middleware());
app.get('/secured', keycloak.protect(), handler);
```

**新方案：openid-client**

```javascript
const { Issuer, generators } = require('openid-client');
const passport = require('passport');

// 基于 issuer URL 自动发现
const keycloakIssuer = await Issuer.discover(
  'https://kc.example.com/realms/myrealm'
);

const client = new keycloakIssuer.Client({
  client_id: 'my-app',
  client_secret: process.env.KC_CLIENT_SECRET,
  redirect_uris: ['https://myapp.example.com/callback'],
  response_types: ['code'],
});

// 集成 Express session + Passport
app.get('/login', (req, res) => {
  const nonce = generators.nonce();
  const state = generators.state();
  req.session.nonce = nonce;
  req.session.state = state;
  const url = client.authorizationUrl({
    scope: 'openid profile email',
    state,
    nonce,
  });
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const params = client.callbackParams(req);
  const tokenSet = await client.callback(
    'https://myapp.example.com/callback',
    params,
    { state: req.session.state, nonce: req.session.nonce }
  );
  const userinfo = await client.userinfo(tokenSet.access_token);
  req.session.user = userinfo;
  res.redirect('/');
});
```

**迁移要点**：

1. `keycloak-connect` 管理 session 和 token 刷新；迁移到 `openid-client` 后需自行管理 session 存储和 refresh token 逻辑。
2. 角色信息从 `req.kauth.grant.access_token.content.realm_access.roles` 变为 `userinfo` 或 id_token 中提取。

### Python

**旧方案**：

```python
# keycloak-python / flask-oidc 等老模式
from keycloak import KeycloakOpenID
# 这里是 Admin Client，不是本文讨论的 Adapter
# 旧项目常见用 flask-oidc 或其他不标准的方式通过 keycloak.json 对接
```

**新方案：authlib**

```python
from authlib.integrations.flask_client import OAuth
from flask import Flask, redirect, url_for, session

app = Flask(__name__)
oauth = OAuth(app)

keycloak = oauth.register(
    name='keycloak',
    client_id='my-app',
    client_secret=os.environ.get('KC_CLIENT_SECRET'),
    server_metadata_url='https://kc.example.com/realms/myrealm'
                         '/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid profile email'},
)

@app.route('/login')
def login():
    redirect_uri = url_for('authorize', _external=True)
    return keycloak.authorize_redirect(redirect_uri)

@app.route('/callback')
def authorize():
    token = keycloak.authorize_access_token()
    userinfo = keycloak.parse_id_token(token)
    session['user'] = userinfo
    return redirect('/')
```

**迁移要点**：

1. 如果老项目用的是 `python-keycloak` 做认证流程，注意这个库的认证功能不是标准 OIDC 流程，迁移到 `authlib` 可获得完整的 `authorization_code` + PKCE 支持。
2. 注意 `server_metadata_url` 正是 Keycloak 的 `.well-known/openid-configuration` 端点——使用它代替手动配置 `authorization_endpoint` 和 `token_endpoint`。

### .NET / ASP.NET Core

**旧方案**：

```csharp
// 已弃用的 Keycloak Adapter for .NET
// 或自写 HttpClient 对接 Keycloak REST
```

**新方案：Microsoft.AspNetCore.Authentication.OpenIdConnect**

```csharp
// Program.cs
builder.Services.AddAuthentication(options =>
{
    options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
})
.AddCookie()
.AddOpenIdConnect(options =>
{
    options.Authority = "https://kc.example.com/realms/myrealm";
    options.ClientId = "my-app";
    options.ClientSecret = builder.Configuration["KC_CLIENT_SECRET"];
    options.ResponseType = OpenIdConnectResponseType.Code;
    options.SaveTokens = true;
    options.GetClaimsFromUserInfoEndpoint = true;
    options.TokenValidationParameters = new TokenValidationParameters
    {
        NameClaimType = "preferred_username",
        RoleClaimType = "roles"
    };
});
```

## 常见踩坑

| 问题 | 症状 | 原因与解决 |
|------|------|-----------|
| 角色映射丢失 | 迁移后用户无法访问受保护资源（403） | Keycloak Adapter 默认将 Realm Roles 映射为 `ROLE_*`；标准库需在 `GrantedAuthoritiesMapper`（Java）或 `OnTokenValidated`（.NET）中手动提取 `realm_access.roles` |
| Logout 不彻底 | 登出后刷新页面仍然能访问 | Keycloak Adapter 自带后端 SSO Logout 回调和 RP-Initiated Logout；标准库需要单独配置 `OidcClientInitiatedLogoutSuccessHandler`（Spring）或调用 `options.Events.OnRedirectToIdentityProviderForSignOut`（.NET） |
| `keycloak.json` 残留 | 启动时报找不到配置文件 | 迁移后删除所有 `keycloak.json` / `WEB-INF/keycloak.json`，改用框架标准配置 |
| 依赖冲突 | Spring Boot 升级后 `ClassNotFoundException: javax.servlet` | 旧 Adapter 依赖 `javax.*`，与 Spring Boot 3+ / Jakarta EE 不兼容；移除 Adapter 依赖后解决 |
| Token Refresh 中断 | 用户一段时间后突然被登出 | Adapter 的 `KeycloakInstalled` 等类内置了自动 refresh 逻辑；标准 OIDC 需要自己处理 refresh token 流程或用框架的自动刷新机制 |
| Session 膨胀 | 内存使用上升 | 旧 Adapter 可能把 access token 存在服务端 session；迁移到标准库后如果用了同样的策略，确认 session 存储可承载 |
| Logout 重定向到错误地址 | 登出后 404 | 旧 Adapter 的 `adminUrl` 概念在新方案中对应 `post_logout_redirect_uri`，需在 Keycloak Client 配置中设置 |

## 验证

迁移完成后，按以下顺序验证：

```bash
# 1. 确认 Keycloak 的 issuer 可发现
curl -s https://kc.example.com/realms/myrealm/.well-known/openid-configuration | jq .issuer

# 2. 确认 client 注册的 redirect URI 匹配
# 在 Keycloak Admin Console → Clients → my-app → Settings → Valid redirect URIs
# 必须包含 Spring Security 的 /login/oauth2/code/{registrationId} 或自定义 callback URL

# 3. 启动应用后访问受保护页面，确认：
#    - 被重定向到 Keycloak 登录页（不是 500 或空白页）
#    - 登录后成功回调并看到用户信息
#    - 登出后再次访问受保护页面，被要求重新登录

# 4. 检查 Token 内容
# 登录后在应用日志或调试端点中解码 access_token / id_token
# 确认 aud、iss、roles claim 正确
```

验证清单：

- [ ] 登录流程完整：重定向 → Keycloak 登录 → 回调 → session 建立
- [ ] 登出后 session 销毁，再次请求需重新认证
- [ ] 角色/权限映射到应用后，授权决策正确
- [ ] Token 过期后自动刷新或要求重新登录（取决于策略）
- [ ] `keycloak.json` / 旧 Adapter 依赖已从项目中完全移除
- [ ] CI 构建通过，无 Adapter 相关依赖冲突

## 回滚方式

迁移过程中如果出现问题，回滚步骤：

1. **保留 Keycloak Client 配置不变**：标准 OIDC 库使用的 Client ID 和 Secret 与旧 Adapter 可以共用同一个 Keycloak Client。回滚时只需切回旧配置。
2. **回滚应用代码**：
   - Maven/Gradle：恢复旧 Adapter 依赖，去除 Spring Security OAuth2 Client 依赖
   - 配置文件：恢复 `keycloak.json` 或旧 `application.yml`
   - 代码：恢复 `KeycloakWebSecurityConfigurerAdapter`（Spring Boot 2.x）或旧中间件代码
3. **Git 操作**：如果迁移改动在一个单独 commit/PR 中，直接 `git revert <commit>`。
4. **先灰度**：在一个测试实例或预发环境验证回滚后功能正常，再全量回滚。

> 长期风险提示：回滚到旧 Adapter 只是临时方案。Keycloak 未来版本可能彻底移除对 Adapter 模式的协议兼容性。回滚后应尽快排期完成迁移。

## 迁移检查清单（可直接用于项目管理）

| 阶段 | 任务 | 产出 |
|------|------|------|
| 准备 | 确认当前使用的 Keycloak Adapter 及其版本 | 依赖清单 |
| 准备 | 确认 Keycloak Server 版本（建议先升级到当前稳定版） | 版本记录 |
| 准备 | 在 Keycloak Admin Console 中确认 Client 的 Access Type 和 redirect URI | Client 配置快照 |
| 实现 | 新建分支，移除旧 Adapter 依赖，添加标准 OIDC 库依赖 | dependency diff |
| 实现 | 编写标准 OIDC 对接代码（参考上面逐语言示例） | 安全配置代码 |
| 实现 | 配置角色/权限映射 | 授权逻辑 |
| 实现 | 配置 Logout 流程 | 登出端点 |
| 验证 | 验证登录/登出/角色/Token Refresh | 测试报告 |
| 验证 | 检查生产环境配置（TLS/反向代理/域名） | 环境清单 |
| 上线 | 灰度发布，监控错误日志 | 上线记录 |
| 清理 | 删除所有残留的 `keycloak.json` 和 Adapter 引用 | clean diff |

## 相关资源

- [Keycloak Securing Applications Guide](https://www.keycloak.org/docs/latest/securing_apps/) — 官方应用安全指南，包含标准 OIDC 库推荐
- [Spring Security OAuth2 Client](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/index.html) — Spring Security 的 OAuth2 客户端文档
- [openid-client (Node.js)](https://github.com/panva/node-openid-client) — Node.js 生态最成熟的 OIDC 依赖方库
- [Authlib (Python)](https://docs.authlib.org/en/latest/client/frameworks.html) — Python Flask/Django 的 OAuth/OIDC 客户端库
- [Keycloak 入门指南]({{< relref "docs/keycloak/getting-started.md" >}}) — 如果还没开始用 Keycloak，从这里起步
- [OAuth 2.0 授权码与 PKCE 流程]({{< relref "docs/protocols/oauth2-authorization-code-pkce.md" >}}) — 理解迁移后的底层安全机制
- [域名重定向循环排错]({{< relref "docs/solution-blogs/keycloak-redirect-loop-troubleshooting.md" >}}) — 迁移后如果遇到重定向问题，这里找答案
