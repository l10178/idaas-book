---
title: "第16章：Dex 身份代理"
description: "Dex 身份代理的架构、配置、与 Kubernetes 的集成及最佳实践"
date: 2024-04-03T00:00:00+08:00
draft: false
weight: 43
menu:
  docs:
    parent: "implementation"
    identifier: "dex-identity"
toc: true
---

## 16.1 Dex 的设计定位

Dex 最初由 CoreOS 开发，现由 dexidp 社区维护（CNCF 生态相关），专门为 Kubernetes 生态设计。它的定位非常精准：

> **Dex 不是一个完整的 IAM 系统，它是一个 OIDC 身份代理。**

Dex 不做的事：
- 不存储用户（用户数据在外部 IdP）
- 不提供用户管理 UI
- 不提供授权管理（RBAC 由 Kubernetes 的 RBAC 处理）

Dex 做的事：
- 连接各种上游 IdP（LDAP、AD、GitHub、Google、SAML 等）
- 统一输出为 OIDC
- 为 Kubernetes 提供 OIDC 认证

### 什么时候用 Dex？

- 你的 Kubernetes 集群需要对接企业 AD/LDAP 进行认证
- 你只需要一个轻量级的 OIDC 桥接
- 你不想部署完整的 Keycloak

### 什么时候不用 Dex？

- 你需要用户管理界面
- 你需要丰富的授权策略
- 你需要支持多种下游协议（如 SAML）
- 你需要自定义认证流程

## 16.2 Dex 架构

```
          ┌─────────────────────────┐
          │       Dex Server        │
          │                         │
          │  ┌───────────────────┐  │
          │  │  Connectors       │  │
          │  │  ┌──────┐┌──────┐ │  │
          │  │  │ LDAP ││ OIDC │ │  │
          │  │  └──────┘└──────┘ │  │
          │  │  ┌──────┐┌──────┐ │  │
          │  │  │ SAML ││GitHub│ │  │
          │  │  └──────┘└──────┘ │  │
          │  │  ┌──────┐┌──────┐ │  │
          │  │  │Google││ AD   │ │  │
          │  │  └──────┘└──────┘ │  │
          │  └───────────────────┘  │
          │                         │
          │  统一输出：OIDC Provider │
          └───────────┬─────────────┘
                      │
      ┌───────────────┼───────────────┐
      ▼               ▼               ▼
 [Kubernetes]    [Grafana]      [Istio]
```

## 16.3 Dex 配置

### 基本配置结构

```yaml
# config.yaml
issuer: https://dex.example.com

storage:
  type: kubernetes
  config:
    inCluster: true

web:
  http: 0.0.0.0:5556
  # TLS 配置在生产环境必须

# OIDC 客户端配置
staticClients:
  - id: kubernetes
    redirectURIs:
      - 'http://localhost:8000'
    name: 'Kubernetes'
    secret: 'generated-client-secret'

# 上游连接器
connectors:
  - type: ldap
    id: ldap
    name: LDAP
    config:
      host: ldap.example.com:636
      insecureNoSSL: false
      bindDN: cn=admin,dc=example,dc=com
      bindPW: admin-password
      userSearch:
        baseDN: ou=users,dc=example,dc=com
        filter: "(objectClass=inetOrgPerson)"
        username: uid
        idAttr: uid
        emailAttr: mail
        nameAttr: displayName
      groupSearch:
        baseDN: ou=groups,dc=example,dc=com
        filter: "(objectClass=groupOfNames)"
        userMatchers:
          - userAttr: DN
            groupAttr: member
        nameAttr: cn

  - type: github
    id: github
    name: GitHub
    config:
      clientID: $GITHUB_CLIENT_ID
      clientSecret: $GITHUB_CLIENT_SECRET
      redirectURI: https://dex.example.com/callback
      orgs:
        - name: my-org
          teams:
            - platform-team
```

### 连接器类型

Dex 支持的连接器：

| 连接器 | 说明 |
|--------|------|
| LDAP | 标准的 LDAP/AD 目录 |
| OIDC | 任何 OpenID Connect 提供方 |
| SAML | SAML 2.0 身份提供方 |
| GitHub | GitHub 组织和团队 |
| Google | Google Workspace / Cloud Identity |
| Microsoft | Azure AD / Microsoft 365 |
| GitLab | GitLab 实例 |
| OpenShift | Red Hat OpenShift |
| Bitbucket | Bitbucket Cloud |
| LinkedIn | LinkedIn 社交登录 |

## 16.4 Kubernetes 集成

### Kubernetes API Server 配置

```
# kube-apiserver 启动参数
--oidc-issuer-url=https://dex.example.com
--oidc-client-id=kubernetes
--oidc-username-claim=email
--oidc-groups-claim=groups
```

### kubectl 配置

> 注意：Kubernetes client-go 的 `auth-provider` 字段已自 v1.26 起被移除，旧式 `auth-provider: oidc` 在新版 kubectl 中不再可用，应改用 `exec` 插件调用 `kubelogin`。

```yaml
# ~/.kube/config（基于 exec 插件 + kubelogin）
users:
  - name: zhangsan
    user:
      exec:
        apiVersion: client.authentication.k8s.io/v1
        command: kubelogin
        args:
          - get-token
          - --oidc-issuer-url=https://dex.example.com
          - --oidc-client-id=kubernetes
```

### 使用 kubelogin

[kubelogin](https://github.com/int128/kubelogin) 是更友好的方式：

```bash
kubectl oidc-login setup \
  --oidc-issuer-url=https://dex.example.com \
  --oidc-client-id=kubernetes \
  --oidc-client-secret=generated-client-secret
```

## 16.5 Dex 的高可用部署

### Kubernetes 部署

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dex
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dex
  template:
    metadata:
      labels:
        app: dex
    spec:
      containers:
      - name: dex
        image: ghcr.io/dexidp/dex:v2.38.0   # 示例版本，部署时请改用最新稳定 tag
        args: ["dex", "serve", "/etc/dex/config.yaml"]
        ports:
        - containerPort: 5556
        - containerPort: 5558  # metrics
        env:
        - name: GITHUB_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: dex-credentials
              key: github-client-id
        - name: GITHUB_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: dex-credentials
              key: github-client-secret
        volumeMounts:
        - name: config
          mountPath: /etc/dex
      volumes:
      - name: config
        configMap:
          name: dex-config
```

### 存储选项

Dex 支持多种存储后端：

| 存储 | 适合场景 |
|-----|---------|
| Kubernetes CRD | Kubernetes 原生部署 |
| PostgreSQL | 企业级可靠性 |
| MySQL | 常见企业数据库 |
| SQLite3 | 单节点，测试环境 |
| Memory | 仅测试 |

> 注：Dex 早期版本曾提供 etcd 存储，新版（v2.31+）已移除，当前版本不再支持 etcd 作为 storage 后端。

## 16.6 Dex vs Keycloak 选择决策

```
需要以下功能？
├─ 用户管理界面？
│   └─ 是 → Keycloak
│
├─ 用户自助服务（注册、改密码）？
│   └─ 是 → Keycloak
│
├─ 多种下游协议（SAML + OIDC + LDAP）？
│   └─ 是 → Keycloak
│
├─ 复杂的认证流程定制？
│   └─ 是 → Keycloak
│
├─ 授权策略管理（RBAC/ABAC）？
│   └─ 是 → Keycloak
│
└─ 只需要 OIDC 代理？只给 K8s 用？
    └─ 是 → Dex
```

## 16.7 小结

Dex 是 Kubernetes 世界中"做一件事并把它做好"的典型代表。它不试图成为完整的 IAM 平台，而是专注于将各种身份源桥接到 OIDC。对于以 Kubernetes 为中心的基础设施，Dex + Kubernetes RBAC 是一个轻量而强大的组合。如果需要更完整的 IDaaS 能力，Keycloak 是更合适的选择。
