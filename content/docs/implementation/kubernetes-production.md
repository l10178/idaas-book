---
title: "第19章：Kubernetes 生产环境部署"
description: "Keycloak 在 Kubernetes 上的生产级部署：Operator、Helm、高可用、备份与监控"
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

**推荐**：生产环境使用 Keycloak Operator（对 Keycloak 22+ 版本原生支持更好）。

## 19.2 使用 Keycloak Operator

### 安装 Operator

```bash
# 安装 Operator（请使用与下文 Keycloak 镜像版本匹配的 Operator tag，如 24.0.x）
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/24.0.5/kubernetes/keycloaks.k8s.keycloak.org-v1.yml
kubectl apply -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/24.0.5/kubernetes/keycloak-operator.yml
# 或通过 OperatorHub / OLM 安装，确保 Operator 版本与 Keycloak 镜像版本一致
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
  image: quay.io/keycloak/keycloak:24.0
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

> 拓扑说明：上面采用「Ingress/LB 终结 TLS → 明文转发到 Keycloak」的常见部署，故 `httpEnabled: true` + `proxy.headers: xforwarded`；若改为「Keycloak 自身终结 TLS」，则 `httpEnabled: false` + `http.tlsSecret` 指定证书，通常不再需要 `proxy.headers`（除非前面还有一层 LB 转发头）。两种拓扑二选一，不要混用。

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

## 19.10 小结

生产环境下 Keycloak 的 Kubernetes 部署，核心关注点：
- 使用 Operator 简化运维
- 外部数据库（PostgreSQL）代替嵌入式数据库
- 至少 2 副本 + 反亲和 + PDB
- 定期数据库备份 + Realm 配置导出
- Prometheus + Grafana 监控 + 告警规则
- NetworkPolicy 和 Secrets 管理加强安全
- cert-manager 自动化 TLS 证书管理
