---
title: "第19章：Keycloak Kubernetes 生产环境部署 — Helm、Operator 与高可用 | IDaaS Book"
description: "Keycloak 在 Kubernetes 上的生产级部署：Operator、Helm、高可用、备份恢复、监控指标与反向代理配置"
date: 2024-04-06T00:00:00+08:00
draft: false
weight: 46
menu:
  docs:
    parent: "implementation"
    identifier: "kubernetes-production"
toc: true
---

## 19.1 部署方式选择

在 Kubernetes 上部署 IDaaS（以 Keycloak 为例），有三种主流方式：

| 方式 | 适用场景 | 优点 | 缺点 |
|-----|---------|------|------|
| Helm Chart | 一般场景 | 简单、社区维护 | 定制受限 |
| Keycloak Operator | 生产环境 | 云原生、自动管理 | 学习曲线 |
| 手动 YAML | 特殊需求 | 完全控制 | 运维负担大 |

**推荐**：生产环境优先使用 Keycloak Operator（原生支持 Quarkus 发行版，建议跟随当前稳定版）。如果组织已经有成熟 Helm 交付体系，可以使用 Helm，但要把数据库、反向代理、健康检查、监控和升级回滚纳入同一套发布流程。

### 生产部署快速决策表

| 问题 | 推荐做法 | 风险提示 |
|-----|---------|---------|
| Operator 还是 Helm？ | 长期运行、需要自动化滚动升级和 CRD 管理时优先 Operator；短期 PoC 或已有 Helm 平台可选 Helm | 不要同时用 Operator 和 Helm 管理同一个 Keycloak 实例，控制面会打架 |
| 数据库放哪里？ | 使用外部 PostgreSQL 或云数据库，独立备份与监控 | Operator 不负责创建和维护生产数据库；把数据库塞进同一个无状态发布包，迟早会在恢复演练里交学费 |
| TLS 在哪里终结？ | 通常在 Ingress/LB 终结 TLS，Keycloak 仅解析可信代理头 | `proxy.headers: xforwarded` 只应信任受控代理；不要把 management 端口暴露到公网 |
| 版本如何选择？ | Keycloak 镜像、Operator 资源和 CRD 使用同一稳定版本，并先在预发环境演练升级 | 跳版本升级前先读 release notes 和迁移指南，准备数据库备份与回滚窗口 |

## 19.2 使用 Keycloak Operator

> 版本提示：Keycloak 官方下载页与 GitHub Release 显示当前稳定版为 `26.6.4`（2026-07-01 检查）；官方 Operator 安装文档同样提供 `26.6.4` 的 `keycloak-k8s-resources` 示例。Keycloak 迭代很快，部署时请到 [keycloak.org/downloads](https://www.keycloak.org/downloads)、[Keycloak Releases](https://github.com/keycloak/keycloak/releases) 与 [Operator 安装文档](https://www.keycloak.org/operator/installation) 复核**当前最新稳定版**，并保持 Operator 版本与 Keycloak 镜像一致。

### 安装 Operator

```bash
# 安装 Operator（示例使用 26.6.4；生产环境请先确认该版本仍是当前稳定版）
VERSION=26.6.4
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${VERSION}/kubernetes/keycloaks.k8s.keycloak.org-v1.yml
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${VERSION}/kubernetes/keycloakrealmimports.k8s.keycloak.org-v1.yml
kubectl create namespace keycloak
kubectl -n keycloak apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/${VERSION}/kubernetes/keycloak-operator.yml
# 官方推荐在 Kubernetes 环境优先通过 Operator Lifecycle Manager（OLM）安装；裸 Kubernetes 也可按上面的 kubectl 方式安装。
```

安装后至少确认 CRD、Operator Pod 和版本：

```bash
kubectl get crd | grep k8s.keycloak.org
kubectl -n keycloak rollout status deploy/keycloak-operator
kubectl -n keycloak logs deploy/keycloak-operator --tail=50
```

### 部署 Keycloak

```yaml
apiVersion: k8s.keycloak.org/v2alpha1
kind: Keycloak
metadata:
  name: production-keycloak
  namespace: keycloak
  labels:
    app: keycloak
spec:
  instances: 3
  image: quay.io/keycloak/keycloak:26.6.4   # 示例版本；上线前复核当前稳定版
  hostname:
    hostname: auth.example.com
  http:
    httpEnabled: true        # Ingress/LB 终结 TLS 后以明文转发到 Keycloak
  ingress:
    enabled: false  # 使用独立的 Ingress 配置（在 Ingress 层终结 TLS）
  db:
    vendor: postgres
    host: postgres-postgresql.keycloak-db.svc.cluster.local
    port: 5432
    database: keycloak
    usernameSecret:
      name: keycloak-db-secret
      key: username
    passwordSecret:
      name: keycloak-db-secret
      key: password
  proxy:
    headers: xforwarded  # 信任外部 Ingress/LB 转发的 X-Forwarded-* 头
  cache:
    configMapFile:
      name: keycloak-cache-config
      key: cache-ispn.xml
  features:
    enabled:
      - authorization
      - token-exchange
      - admin-fine-grained-authz
  additionalOptions:
    - name: log-level
      value: INFO
    - name: metrics-enabled
      value: "true"
    - name: health-enabled
      value: "true"   # 启用 /health/* 端点（见 19.5 健康检查）
```

> 拓扑说明：上面采用「Ingress/LB 终结 TLS → 明文转发到 Keycloak」的常见部署，故 `httpEnabled: true` + `proxy.headers: xforwarded`；若改为「Keycloak 自身终结 TLS」，则 `httpEnabled: false` + `http.tlsSecret` 指定证书，通常不再需要 `proxy.headers`（除非前面还有一层 LB 转发头）。两种拓扑二选一，不要混用。Keycloak 官方反向代理文档还强调：只代理 8443（或启用 HTTP 后的 8080）业务端口，不要把 9000 management 端口暴露给外部调用者，健康检查和 metrics 应在集群内采集。

### 数据库配置

生产环境必须使用外部数据库：

```yaml
# 使用 Bitnami PostgreSQL HA 或 Cloud SQL
apiVersion: apps/v1
kind: Secret
metadata:
  name: keycloak-db-secret
  namespace: keycloak
stringData:
  username: keycloak
  password: <strong-random-password>
```

## 19.3 使用 Helm Chart

对于不想用 Operator 的场景：

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install keycloak bitnami/keycloak \
  --set auth.adminUser=admin \
  --set auth.adminPassword=<password> \
  --set production=true \
  --set proxyHeaders=xforwarded \   # Keycloak 24+ 用 proxyHeaders 取代已废弃的 proxy=edge
  --set replicaCount=2 \
  --set postgresql.enabled=false \
  --set externalDatabase.host=postgres-host \
  --set externalDatabase.database=keycloak \
  --set metrics.enabled=true
```

## 19.4 高可用配置

### 多副本 + 反亲和

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchExpressions:
        - key: app
          operator: In
          values:
          - keycloak
      topologyKey: kubernetes.io/hostname
```

### Pod 中断预算

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: keycloak-pdb
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: keycloak
```

### 健康检查

> 需先启用健康端点：Operator CR 的 `additionalOptions` 设 `health-enabled: "true"`，或环境变量 `KC_HEALTH_ENABLED=true`，否则 `/health/*` 返回 404、probe 失败。端点位于 management 端口 9000。

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 9000
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health/ready
    port: 9000
  initialDelaySeconds: 10
  periodSeconds: 5
```

## 19.5 数据库优化

### 连接池

```yaml
additionalOptions:
  - name: db-pool-initial-size
    value: "10"
  - name: db-pool-min-size
    value: "10"
  - name: db-pool-max-size
    value: "40"
```

### Session 清理

Keycloak 会自动清理过期的 Session 与离线 Token，主要通过内置配置项控制，无需手写清理脚本：

- `KC_OFFLINE_SESSION_MAX_LIFESPAN` / `KC_OFFLINE_SESSION_IDLE_TIMEOUT`：离线会话的最大寿命与空闲超时，到期后由 Keycloak 内部任务自动清理。
- `KC_SESSION_MAX_LIFESPAN` / `KC_SESSION_IDLE_TIMEOUT`：普通会话的最大寿命与空闲超时。

如需手动维护个别会话，通过 Admin REST API（如 `DELETE /admin/realms/{realm}/sessions/{session}`）。早期草稿中曾误用 `kcadm.sh set-password` 清理 Session——该命令实际是重置用户密码，与 Session 清理无关，请勿照搬。

## 19.6 备份策略

### 数据库备份

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: keycloak-db-backup
spec:
  schedule: "0 1 * * *"
  jobTemplate:
    spec:
      containers:
      - name: backup
        image: postgres:16
        env:
        - name: PGPASSWORD
          valueFrom:
            secretKeyRef:
              name: keycloak-db-secret
              key: password
        command:
        - /bin/sh
        - -c
        - |
          pg_dump -h postgres-host -U keycloak -d keycloak \
            | gzip > /backup/keycloak-$(date +%Y%m%d).sql.gz
        volumeMounts:
        - name: backup
          mountPath: /backup
      volumes:
      - name: backup
        persistentVolumeClaim:
          claimName: backup-pvc
```

### Keycloak 自身的导出

通过 Admin API 也可以导出 Realm 配置（该接口为**异步任务**，返回任务状态后需轮询取回导出结果）：

```bash
curl -X POST "https://auth.example.com/admin/realms/myrealm/partial-export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"exportClients": true, "exportGroupsAndRoles": true}'
```

## 19.7 监控与可观测性

> 本章节提供生产监控的快速配置和告警。更详细的指标解读、ServiceMonitor 配置、Grafana Dashboard 导入和常见排错方法，见 [Keycloak Prometheus 监控指标详解]({{< relref "../solution-blogs/keycloak-prometheus-metrics" >}})。

### Prometheus Metrics

Keycloak 22+ 支持直接暴露 Prometheus 指标（需 `KC_METRICS_ENABLED=true`），端点为**全局**路径：

```
https://auth.example.com/metrics
```

> 注意：Keycloak 不存在 `/realms/{realm}/metrics` 这类按 Realm 暴露的 metrics 端点。

### Grafana Dashboard

推荐导入与 Keycloak 版本匹配的社区 Grafana Dashboard——Keycloak 22+ 改用 Micrometer 指标命名（`keycloak_*` 前缀），需选择对应版本的 dashboard，旧版（如 ID 10441）可能指标不匹配。

### 关键告警规则

```yaml
groups:
- name: keycloak
  rules:
  - alert: KeycloakHighAuthLatency
    expr: rate(keycloak_request_duration_seconds_sum[5m]) / rate(keycloak_request_duration_seconds_count[5m]) > 2
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Keycloak 认证延迟超过 2 秒"
  
  - alert: KeycloakHighLoginFailureRate
    expr: rate(keycloak_failed_login_attempts_total[5m]) > 10
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "登录失败率异常升高"
  
  - alert: KeycloakDown
    expr: up{job="keycloak"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Keycloak 实例不可用"
```

## 19.8 安全加固

### NetworkPolicy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: keycloak-network-policy
spec:
  podSelector:
    matchLabels:
      app: keycloak
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - port: 8443
      protocol: TCP
    - port: 9000  # management
      protocol: TCP
  egress:
  - to:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: postgresql
    ports:
    - port: 5432
```

### Secrets 管理

使用 External Secrets Operator 或 Sealed Secrets 管理敏感信息：

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: keycloak-db-credentials
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: keycloak-db-secret
  data:
  - secretKey: username
    remoteRef:
      key: secret/data/keycloak/db
      property: username
  - secretKey: password
    remoteRef:
      key: secret/data/keycloak/db
      property: password
```

## 19.9 TLS 配置

### 使用 cert-manager

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: keycloak-tls
  namespace: keycloak
spec:
  secretName: keycloak-tls-secret
  dnsNames:
    - auth.example.com
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

## 19.10 生产上线检查清单

上线前至少完成以下检查，避免“能登录一次”被误判为生产就绪：

- [ ] Keycloak 镜像、Operator CRD 与 Operator Deployment 使用同一稳定版本；升级前已读 release notes。
- [ ] 外部 PostgreSQL 已启用备份、恢复演练、连接池上限和慢查询监控。
- [ ] Realm、Client、Identity Provider、认证流等配置有导出或 IaC 管理方式。
- [ ] Ingress/LB 的 TLS 终结与 `proxy.headers` 配置一致，只信任受控代理来源。
- [ ] 9000 management 端口仅供集群内健康检查和 Prometheus 抓取，不对公网开放。
- [ ] 多副本、反亲和、PDB、资源 requests/limits 和滚动升级策略已验证。
- [ ] 监控覆盖登录失败率、请求延迟、Pod 重启、数据库连接池、证书过期和磁盘/备份状态。
- [ ] 回滚方案包含数据库备份点、旧版本镜像、旧 Operator 资源和变更冻结窗口。

## 19.11 小结

生产环境下 Keycloak 的 Kubernetes 部署，核心关注点：
- 使用 Operator 简化运维
- 外部数据库（PostgreSQL）代替嵌入式数据库
- 至少 2 副本 + 反亲和 + PDB
- 定期数据库备份 + Realm 配置导出
- Prometheus + Grafana 监控 + 告警规则
- NetworkPolicy 和 Secrets 管理加强安全
- cert-manager 自动化 TLS 证书管理
