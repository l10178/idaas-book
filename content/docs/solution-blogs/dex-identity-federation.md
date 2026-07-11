---
title: "Dex 是什么——Kubernetes 身份代理完全指南 | IDaaS Book"
description: "Dex 是什么？Kubernetes 生态的 OIDC 身份代理。连接 LDAP/SAML/OIDC 上游到 OIDC 下游。对比 Keycloak/OAuth2 Proxy/Pomerium，附完整集成配置。"
date: 2026-07-09T00:00:00+08:00
draft: false
toc: true
---

## Dex 是什么

**Dex** 是 CNCF 沙箱项目，一个**身份联邦代理（Identity Federation Proxy）**。它的核心作用是：**把各种上游身份协议（LDAP、SAML、OIDC、GitHub、Google 等）统一转换成下游的 OpenID Connect**。

一句话：**Dex 不管理用户，它只是把「各种身份」翻译成「OIDC Token」的翻译官。**

```
上游身份源（多种协议）           Dex                   下游应用（仅 OIDC）
┌─────────────────┐      ┌──────────┐      ┌─────────────────┐
│ LDAP / AD        │─────▶│          │─────▶│ Kubernetes      │
│ SAML IdP         │─────▶│   Dex    │─────▶│ Grafana         │
│ GitHub / Google  │─────▶│          │─────▶│ ArgoCD          │
│ OIDC Provider    │─────▶│          │─────▶│ 你的应用         │
└─────────────────┘      └──────────┘      └─────────────────┘
```

### 为什么需要 Dex

典型的 Kubernetes 集群认证困境：

```
你的公司用 LDAP/AD → 但 Kubernetes 只支持 OIDC
你的客户用 SAML IdP → 但 ArgoCD 只支持 OIDC
你的团队用 GitHub → 但 Grafana 只支持 OIDC
```

Dex 解决的就是这个 **协议翻译** 问题。它不是 IAM 平台（Keycloak 才是），它是 IAM 协议桥梁。

## Dex vs 同类工具

### Dex vs Keycloak

| 维度 | Dex | Keycloak |
|------|-----|----------|
| **定位** | 身份代理/协议翻译 | 全功能 IAM 平台 |
| **用户管理** | ❌ 不存用户 | ✅ 内建用户存储 |
| **自建用户** | ❌ 无本地用户 | ✅ 内建用户数据库 |
| **MFA** | ❌ 依赖上游 | ✅ TOTP/WebAuthn |
| **授权** | ❌ 无 | ✅ RBAC/ABAC |
| **管理UI** | ❌ 无 | ✅ Admin Console |
| **上游连接器** | LDAP/SAML/OIDC/GitHub/Google/Microsoft/LinkedIn... | LDAP/SAML/OIDC/社交登录 |
| **下游协议** | 仅 OIDC | OIDC + SAML |
| **资源消耗** | 极低（~50MB 内存） | 中等（~512MB+） |
| **代码量** | ~20k 行 Go | ~100 万行 Java |

> **选择原则**：如果你已经有用户存储（LDAP/AD/已有 IdP），只需要把它的协议翻译成 OIDC——用 Dex。如果你需要创建和管理用户、定义角色权限、配置 MFA——用 Keycloak。

### Dex vs OAuth2 Proxy

| 维度 | Dex | OAuth2 Proxy |
|------|-----|-------------|
| **定位** | 身份代理（协议翻译） | 反向代理（认证网关） |
| **工作方式** | 转换协议，签发 JWT | 拦截请求，验证 Session |
| **支持上游** | 10+ 连接器 | GitHub/Google/OIDC/Keycloak |
| **下游协议** | OIDC | 无（注入 Header 到应用） |
| **典型场景** | K8s API Server、ArgoCD、Grafana | 保护没有内置认证的 Web 应用 |
| **粒度** | 集群级/应用级 | 应用级/路径级 |

> OAuth2 Proxy 和 Dex 经常一起用：Dex 做协议翻译，OAuth2 Proxy 在应用前面做网关认证。

### Dex vs Pomerium

| 维度 | Dex | Pomerium |
|------|-----|----------|
| **定位** | 身份联邦代理 | 企业 SSO 网关 |
| **下游协议** | OIDC | HTTP 反向代理 |
| **策略引擎** | ❌ 无 | ✅ Rego/OPA |
| **运维复杂度** | 极低 | 中等 |

## Dex 的上游连接器

Dex 通过 **Connector** 插件连接上游。内置连接器：

| 连接器 | 用途 |
|--------|------|
| **LDAP** | 对接企业 AD / OpenLDAP |
| **SAML** | 对接企业 SAML IdP（Okta/Auth0/ADFS） |
| **OIDC** | 对接其他 OIDC Provider（含 Keycloak） |
| **GitHub** | GitHub 组织/团队 → OIDC CLAIM |
| **Google** | Google Workspace 账号 |
| **Microsoft** | Azure AD / Microsoft 365 |
| **GitLab** | GitLab 组织 |
| **Bitbucket Cloud** | Atlassian 账号 |
| **OpenShift** | OpenShift 集群 |
| **Atlassian Crowd** | Crowd 用户目录 |

### 连接器配置示例

**LDAP 连接器：**

```yaml
connectors:
  - type: ldap
    id: ldap
    name: Company LDAP
    config:
      host: ldap.example.com:636
      insecureNoSSL: false
      bindDN: cn=dex,ou=services,dc=example,dc=com
      bindPW: /etc/dex/ldap-bind-password
      usernamePrompt: Email Address
      userSearch:
        baseDN: ou=users,dc=example,dc=com
        filter: "(objectClass=person)"
        username: mail
        idAttr: DN
        emailAttr: mail
        nameAttr: displayName
      groupSearch:
        baseDN: ou=groups,dc=example,dc=com
        filter: "(objectClass=groupOfNames)"
        userMatchers:
          - userAttr: DN
            groupAttr: member
        nameAttr: cn
```

**SAML 连接器（对接 Okta）：**

```yaml
connectors:
  - type: saml
    id: okta
    name: Okta
    config:
      ssoURL: https://your-org.okta.com/app/xxx/sso/saml
      caData: /etc/dex/okta-ca.pem
      usernameAttr: email
      emailAttr: email
      groupsAttr: groups
```

**OIDC 连接器（对接 Keycloak）：**

```yaml
connectors:
  - type: oidc
    id: keycloak
    name: Keycloak
    config:
      issuer: https://keycloak.example.com/realms/myrealm
      clientID: dex
      clientSecret: /etc/dex/keycloak-client-secret
      redirectURI: https://dex.example.com/callback
      insecureEnableGroups: true
      userNameKey: preferred_username
```

## Dex + Kubernetes 完整集成

### 架构

```
企业 LDAP/AD
     │
     ▼ LDAP
   Dex ──────▶ Kubernetes API Server (OIDC)
     │                    │
     ▼ OIDC               ▼ JWT 认证
  kubectl ─────▶ kubectl 使用 Dex 签发的 JWT 操作集群
```

### 步骤 1：配置 Dex

`dex-config.yaml`：

```yaml
issuer: https://dex.example.com
storage:
  type: kubernetes
  config:
    inCluster: true
web:
  http: 0.0.0.0:5556
connectors:
  - type: ldap
    id: ldap
    name: LDAP
    config:
      host: ldap.example.com:636
      # ... LDAP 配置同上

staticClients:
  - id: kubernetes
    redirectURIs:
      - http://localhost:8000  # kubectl callback
    name: Kubernetes
    secret: <generated-secret>

oauth2:
  skipApprovalScreen: true
```

### 步骤 2：配置 Kubernetes API Server

```yaml
# kube-apiserver.yaml
spec:
  containers:
  - command:
    - kube-apiserver
    - --oidc-issuer-url=https://dex.example.com
    - --oidc-client-id=kubernetes
    - --oidc-username-claim=email
    - --oidc-groups-claim=groups
```

### 步骤 3：生成 kubeconfig

```bash
# 安装 dex-k8s-authenticator 或手动配置
kubectl config set-credentials dex-user \
  --auth-provider=oidc \
  --auth-provider-arg=idp-issuer-url=https://dex.example.com \
  --auth-provider-arg=client-id=kubernetes \
  --auth-provider-arg=client-secret=<secret> \
  --auth-provider-arg=id-token=<id-token> \
  --auth-provider-arg=refresh-token=<refresh-token>
```

### 步骤 4：验证

```bash
kubectl --user=dex-user get pods
# 成功 → Dex 将 LDAP 用户身份转成了 K8s 可识别的 OIDC Token
```

## Dex 典型使用场景

### 场景 1：统一 K8s 集群认证

```
┌─────────────────────────────────────────────────┐
│                  Dex                             │
│  LDAP ←── 员工     │           │                │
│  GitHub ←── 外部协作者  ──▶ OIDC ──▶ K8s        │
│  SAML ←── 合作伙伴  │           │                │
└─────────────────────────────────────────────────┘
```

所有用户通过 Dex 统一接入 K8s 集群，不需要为每种身份源单独配置。

### 场景 2：Dex + Keycloak 组合

```
Keycloak（用户管理 + MFA + RBAC）
     │
     ▼ OIDC
   Dex（协议再次代理）
     │
     ▼ OIDC
K8s / Grafana / ArgoCD / Harbor
```

为什么 Keycloak 已经支持 OIDC，还要 Dex？

- **轻量级**：Dex 在集群内运行，消耗极低，可以按集群部署
- **K8s 原生**：Dex 和 K8s API Server 的集成是最成熟的 OIDC 方案之一
- **简单**：Dex 的配置比 Keycloak 轻量得多，只做一件事

### 场景 3：Multi-Cluster 统一认证

```
                     Dex（中央）
                    /    |    \
                   /     |     \
            Cluster A  Cluster B  Cluster C
```

一个 Dex 实例，多个 K8s 集群共用。所有集群的 API Server 指向同一个 Dex issuer。

## Dex vs Keycloak 决策树

```
你需要自建用户？ ──YES──▶ Keycloak
    │
    NO
    │
你需要 MFA？ ──YES──▶ Keycloak
    │
    NO
    │
你需要 RBAC/授权？ ──YES──▶ Keycloak
    │
    NO
    │
你只需要把 LDAP/SAML 转成 OIDC？ ──YES──▶ Dex
```

## Dex + OAuth2 Proxy + Keycloak 全栈方案

```
                  ┌─────────────┐
                  │  Keycloak    │  用户管理·MFA·RBAC·多租户
                  └──────┬──────┘
                         │ OIDC
                  ┌──────▼──────┐
                  │    Dex       │  LDAP/AD/SAML → OIDC 协议翻译
                  └──────┬──────┘
                         │ OIDC
                  ┌──────▼──────┐
                  │ OAuth2 Proxy │  应用网关：拦截请求，验证 Session
                  └──────┬──────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
           Grafana    ArgoCD    你的应用
```

- **Keycloak**：用户全生命周期管理 + MFA + RBAC
- **Dex**：把企业 LDAP/AD 翻译成 OIDC（Keycloak 也能接 LDAP，但 Dex 更轻量且 K8s 原生支持更好）
- **OAuth2 Proxy**：在应用前面拦截未认证请求，无缝注入用户身份 Header

## 常见问题

### Q1：Dex 能替代 Keycloak 吗？

不能。Dex 不做用户管理、不做 MFA、不做授权。它是一个协议翻译器，不是 IAM 平台。如果只需要把 LDAP 翻译成 OIDC——用 Dex。如果需要完整的 IAM——用 Keycloak。

### Q2：Dex 和 OAuth2 Proxy 有什么区别？

Dex 是「身份协议翻译器」（上游 LDAP/SAML → 下游 OIDC Token），OAuth2 Proxy 是「认证反向代理」（拦截 HTTP 请求 → 验证 Cookie/Token → 注入身份 Header）。两者经常一起用：Dex 签发 Token，OAuth2 Proxy 验证 Token。

### Q3：Dex 支持多租户吗？

Dex 本身没有多租户概念。但你可以部署多个 Dex 实例指向不同的上游连接器。多租户需求建议用 Keycloak 的 Realm。

### Q4：Dex 的性能如何？

Dex 极其轻量。单个实例通常使用 < 50MB 内存，可以处理数百 req/s。存储可以用内存（开发）、Kubernetes CRD、etcd 或 SQL 数据库。

### Q5：已经用了 Keycloak，还需要 Dex 吗？

大部分情况下不需要——Keycloak 本身支持 OIDC，可以直接对接 K8s。但在以下场景中 Dex 仍有价值：
- 需要极端轻量的集群级认证代理（每个集群部署一个 Dex 比每个集群部署 Keycloak 省资源）
- K8s OIDC 集成的成熟度：Dex + K8s 的组合是社区中测试最充分的方案
- 简化配置：Dex 的配置比 Keycloak 简单得多，适合只需要一个 OIDC endpoint 的场景
