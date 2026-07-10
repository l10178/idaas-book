---
title: "Keycloak 直连 Kubernetes OIDC 认证 — API Server 集成与 RBAC 绑定 | IDaaS Book"
description: "Keycloak 作为 Kubernetes 集群 OIDC Provider 的完整配置指南，覆盖 kube-apiserver 参数、客户端配置、groups claim 映射、kubelogin 接入与常见排错"
date: 2026-07-11T00:00:00+08:00
lastmod: 2026-07-11T00:00:00+08:00
draft: false
weight: 14
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-kubernetes-rbac"
toc: true
tags:
  - keycloak
  - kubernetes
  - rbac
  - oidc
---

## 场景

你有一个 Kubernetes 集群，团队成员目前用证书或静态 token 认证，管理起来既麻烦又不安全。组织已经在用 Keycloak 管理用户和组，你想把 K8s 集群的认证直接委托给 Keycloak，用 Keycloak 里的组来控制谁有集群管理员权限、谁只能看 Pod 日志。

与 [Dex + Keycloak 联邦方案]({{< relref "dex-keycloak-federation" >}}) 不同，这里不需要额外的 Dex 代理层——Keycloak 本身就是标准的 OIDC Provider，Kubernetes API Server 原生支持 OIDC 认证。

**一句话：Keycloak 告诉 K8s「这个人是谁、属于哪些组」，K8s RBAC 决定「这些组能做什么」。**

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 单集群或少量集群，用户都在 Keycloak 里 | 几十个集群需要统一管理（建议加 Dex，参考[联邦方案]({{< relref "dex-keycloak-federation" >}})） |
| Keycloak 是唯一的用户身份源 | 需要同时接受 GitHub、LDAP、Google 等多源认证（用 Dex 做聚合） |
| 团队规模中等（几十到几百用户） | 上千用户且需要动态 RBAC 同步 |
| 已有 Keycloak 部署，不想引入新组件 | Keycloak 还没部署（先部署 Keycloak，参考[生产部署指南]({{< relref "../implementation/kubernetes-production" >}})） |

## 架构

```mermaid
sequenceDiagram
    participant User as kubectl / kubelogin
    participant K8s as K8s API Server
    participant KC as Keycloak

    User->>K8s: kubectl get pods
    K8s->>User: 401 + OIDC redirect URL
    User->>KC: 浏览器打开 Keycloak 登录页
    Note over User,KC: OIDC Authorization Code + PKCE
    KC->>User: 登录成功，返回 id_token + refresh_token
    User->>K8s: kubectl get pods (Authorization: Bearer &lt;id_token&gt;)
    K8s->>K8s: 验证 JWT 签名 + issuer + aud + exp
    K8s->>K8s: 提取 sub、groups → 匹配 RBAC
    K8s->>User: Pod 列表
```

流程要点：
1. kubectl 收到 401 后自动或手动触发浏览器登录（通过 kubelogin 等插件）
2. 用户在 Keycloak 完成认证，拿到 id_token
3. kubectl 把 id_token 附在后续 API 请求的 Authorization header 中
4. K8s API Server 用 Keycloak 的公钥验证 JWT 签名，提取用户身份和组信息
5. K8s RBAC 根据 groups 匹配 RoleBinding / ClusterRoleBinding，决定授权结果

## 最小配置

### 1. Keycloak 端：创建 K8s 专用客户端

在目标 Realm 中创建一个 OpenID Connect 客户端：

| 设置项 | 值 | 说明 |
|--------|-----|------|
| Client ID | `kubernetes` | 任意标识，与 apiserver 的 `--oidc-client-id` 对应 |
| Client type | `public` | kubectl 是公开客户端，无法安全保存 secret |
| Valid Redirect URIs | `http://localhost:8000/*`, `http://localhost:18000/*` | kubelogin 本地回调端口，按实际工具配置 |
| Access Type | `public` | 不要求 client secret |
| Standard Flow Enabled | `ON` | 授权码流程 |
| Direct Access Grants Enabled | `ON`（可选） | 如果需要用密码直接登录 |

**关键一步：配置 groups claim mapper**

Keycloak 默认不在 id_token 中提供 groups claim，但 K8s RBAC 依赖 groups 做权限判断。需要手动添加 mapper：

1. 进入 Client → `kubernetes` → Client scopes → `kubernetes-dedicated` → Add mapper → By configuration → Group Membership
2. 配置：
   - Name: `groups`
   - Token Claim Name: `groups`
   - Add to ID token: `ON`
   - Add to access token: `OFF`（K8s 只认 id_token）
   - Add to userinfo: `OFF`
   - Full group path: `OFF`（建议用短名，K8s RBAC 里更好读）

> 注意：如果没有专用的 `kubernetes-dedicated` client scope，在 Client → Client scopes → Add client scope 里创建或复用已有的 scope。Mapper 要挂在被客户端引用的 scope 上才生效。

### 2. K8s API Server 端：OIDC 参数

编辑 kube-apiserver 的启动参数（通常位于 `/etc/kubernetes/manifests/kube-apiserver.yaml`）：

```yaml
spec:
  containers:
  - command:
    - kube-apiserver
    # 已有参数保持不变，在末尾追加以下 OIDC 参数
    - --oidc-issuer-url=https://keycloak.example.com/realms/myorg
    - --oidc-client-id=kubernetes
    - --oidc-username-claim=preferred_username
    - --oidc-groups-claim=groups
    - --oidc-username-prefix=keycloak:
    - --oidc-groups-prefix=keycloak:
    - --oidc-ca-file=/etc/kubernetes/pki/keycloak-ca.crt
```

| 参数 | 说明 |
|------|------|
| `oidc-issuer-url` | Keycloak Realm 的 issuer URL。**必须是 HTTPS**，且必须能被 API Server 和 kubectl 访问 |
| `oidc-client-id` | 与 Keycloak 中创建的 Client ID 一致 |
| `oidc-username-claim` | 用哪个 JWT claim 作为 K8s 用户名。`preferred_username` 通常是 `sub` 之外更可读的选择 |
| `oidc-groups-claim` | 用哪个 JWT claim 作为 K8s 组名。与上面 mapper 中填的 Token Claim Name 一致 |
| `oidc-username-prefix` | 为 OIDC 用户名添加前缀，避免与内置用户（如 `system:admin`）冲突 |
| `oidc-groups-prefix` | 为 OIDC 组添加前缀，与 RBAC binding 中的组名对应 |
| `oidc-ca-file` | Keycloak 的 TLS CA 证书。**如果 Keycloak 用自签名证书，必须传这个参数，否则 API Server 无法验证 issuer** |

> Keycloak OIDC issuer URL 格式为 `https://<hostname>/realms/<realm-name>`（注意是 `/realms/` 而不是 `/auth/realms/`——Keycloak 17+ 的 Quarkus 发行版去掉了 `/auth` 前缀）。用 `curl https://keycloak.example.com/realms/myorg/.well-known/openid-configuration` 验证 issuer 是否可访问、返回的 `issuer` 字段是否与 `--oidc-issuer-url` 一致。

### 3. 客户端：kubectl 配置

推荐使用 `kubelogin`（原名 `kubectl oidc-login`）作为 kubectl 的认证插件：

```bash
# 安装 kubelogin（Krew 插件方式）
kubectl krew install oidc-login

# 在 kubeconfig 中配置 OIDC 用户
kubectl config set-credentials keycloak-user \
  --exec-api-version=client.authentication.k8s.io/v1beta1 \
  --exec-command=kubectl \
  --exec-arg=oidc-login \
  --exec-arg=get-token \
  --exec-arg=--oidc-issuer-url=https://keycloak.example.com/realms/myorg \
  --exec-arg=--oidc-client-id=kubernetes \
  --exec-arg=--oidc-extra-scope="groups" \
  --exec-arg=--oidc-use-pkce

# 使用该用户访问集群
kubectl config set-context --current --user=keycloak-user
```

配置完成后，执行任意 `kubectl` 命令会自动打开浏览器完成 Keycloak 登录，之后 token 会缓存到本地。

### 4. RBAC 绑定

用户登录后，K8s 看到的身份是 `keycloak:preferred_username`，组是 `keycloak:groupname`。基于组做 RBAC 绑定：

```yaml
# 集群管理员绑定：Keycloak 中 k8s-admins 组的用户获得 cluster-admin
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: keycloak-admins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
- kind: Group
  name: keycloak:k8s-admins
  apiGroup: rbac.authorization.k8s.io

---
# 只读绑定：Keycloak 中 k8s-viewers 组的用户在 default 命名空间只能查看
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: keycloak-viewers
  namespace: default
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: view
subjects:
- kind: Group
  name: keycloak:k8s-viewers
  apiGroup: rbac.authorization.k8s.io
```

> **为什么用组而不是用户做 RBAC？** 如果直接按用户名绑 RoleBinding，每来一个新人就要改一次 K8s 配置。用组绑定后，在 Keycloak 里把人拉进组就生效了，不需要动 K8s。这也是 [IAM 权限模型中 RBAC 模式]({{< relref "../advanced-topics/authorization-models" >}}) 的典型实践。

## 验证

```bash
# 1. 检查 OIDC 发现端点是否可达
curl -sS https://keycloak.example.com/realms/myorg/.well-known/openid-configuration | jq .issuer

# 2. 手动完成一次认证并检查 Token
kubectl oidc-login get-token \
  --oidc-issuer-url=https://keycloak.example.com/realms/myorg \
  --oidc-client-id=kubernetes \
  --oidc-extra-scope="groups"

# 3. 解码 id_token 检查 groups claim
# 将上面获取的 token 解码（用 jwt.io 或命令行）
echo "<token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .groups

# 4. 测试权限
kubectl auth can-i list pods --as=keycloak:<username>
kubectl auth can-i create deployments --as=keycloak:<username>

# 5. 检查当前用户身份
kubectl auth whoami
```

## 常见错误表

| 症状 | 可能原因 | 排查方法 |
|------|---------|---------|
| `invalid issuer` | `--oidc-issuer-url` 与 Keycloak `.well-known` 返回的 issuer 不一致 | 用 curl 访问 issuer 的 `.well-known/openid-configuration`，对比返回的 `issuer` 字段 |
| `groups claim not found` | Keycloak 客户端没配 groups mapper | 检查 Client Scopes → Evaluate → 看 id_token 里有没有 `groups` claim |
| `certificate signed by unknown authority` | Keycloak 用了自签名证书但没传 `oidc-ca-file` | 把 Keycloak CA 证书挂到 API Server 并配置 `--oidc-ca-file` |
| `401 Unauthorized` 但登录成功 | 用户不在 RoleBinding 绑定的组里 | `kubectl auth whoami` 看身份，对照 RBAC 里的组名（含前缀） |
| `id_token has expired` | Token 过期，kubelogin 没自动刷新 | 检查 `refresh_token` 是否有效，必要时代码里清掉缓存 token 重新登录 |
| API Server 启动失败 | `--oidc-issuer-url` 不可达 | API Server 启动时会校验 issuer 可访问性；确保 K8s 控制面可以连通 Keycloak |
| 浏览器回调 `localhost` 没响应 | kubelogin 没监听本地端口 | 检查 kubelogin 版本；旧版可能需要 `--listen-address=127.0.0.1:8000` |
| `oidc: audience mismatch` | `--oidc-client-id` 与 Token 的 `aud` 不匹配 | 确保客户端 Audience Mapper 正确配置，Token 中 `aud` 包含 `kubernetes` |

## 回滚方式

如果 OIDC 认证出问题导致团队成员无法访问集群：

```bash
# 1. 紧急恢复：用静态 token 或证书登录（管理员应始终保留一个非 OIDC 的 kubeconfig）
kubectl --kubeconfig=/root/.kube/admin-config get nodes

# 2. 临时切换用户上下文到证书认证
kubectl config use-context admin@cluster.local

# 3. 诊断完后再切回 OIDC
kubectl config use-context <oidc-context>

# 4. 如果是 API Server 参数配错导致无法启动
# 编辑 /etc/kubernetes/manifests/kube-apiserver.yaml，删除 OIDC 参数
# kubelet 会自动重启 apiserver
```

**关键原则**：永远保留一个不依赖 OIDC 的管理员 kubeconfig（如基于证书的 cluster-admin），这是 OIDC 认证出问题时的逃生通道。

---

## 与 Dex 方案的对比

| 维度 | Keycloak 直连 | Dex + Keycloak |
|------|-------------|----------------|
| 组件数量 | Keycloak + kubelogin | Keycloak + Dex + kubelogin |
| 多集群管理 | 每个集群配置相同的 OIDC 参数 | 所有集群指向同一个 Dex issuer |
| 多源认证 | 仅 Keycloak 用户 | Dex 可聚合 Keycloak + LDAP + GitHub 等多源 |
| issuer 灵活性 | 固定为 Keycloak Realm URL | 可以自定义 issuer URL |
| 运维复杂度 | 低 | 中（多一个需维护的组件） |
| 适用规模 | 1-3 个集群，单一身份源 | 多个集群或多身份源 |

详细对比见 [IAM 协议选型与身份架构决策指南]({{< relref "../advanced-topics/iam-protocol-selection-guide" >}})。

## 延伸阅读

- [IAM 权限模型：RBAC、ABAC 与 ReBAC 对比]({{< relref "../advanced-topics/authorization-models" >}})：理解 K8s RBAC 与 Keycloak 授权模型的对应关系
- [Dex + Keycloak 联合身份：Kubernetes 集群 OIDC 认证]({{< relref "dex-keycloak-federation" >}})：需要 Dex 代理层的方案
- [Keycloak Kubernetes 生产部署]({{< relref "../implementation/kubernetes-production" >}})：Operator、Helm 和高可用部署
- [Keycloak 细粒度权限与授权策略实战]({{< relref "keycloak-fine-grained-authz" >}})：Groups vs Roles 的深入分析
- [Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}})：如果 OIDC 回调阶段出问题
