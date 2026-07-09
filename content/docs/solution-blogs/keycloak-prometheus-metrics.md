---
title: "Keycloak Prometheus 监控指标详解 — 启用、采集与告警 | IDaaS Book"
description: "Keycloak 24+ Prometheus 监控指标配置：metrics 端点启用、Kubernetes ServiceMonitor 采集、Grafana Dashboard 导入与告警规则排错"
date: 2026-07-09T00:00:00+08:00
lastmod: 2026-07-09T00:00:00+08:00
draft: false
weight: 4
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-prometheus-metrics"
toc: true
---

## 场景

你把 Keycloak 部署到生产环境（Kubernetes 或裸机），Pod 在跑、用户能登录——但发生问题时只能一个个看日志，不知道是数据库慢了、JVM 内存快满了、还是某条认证链路在掉请求。

你需要一套开箱即用的 Prometheus + Grafana 可观测方案：知道该采集哪些指标、哪些指标对应什么运维动作、告警阈值怎么设。

## 适用 / 不适用

| 适用 | 不适用 |
|------|--------|
| Keycloak 22+（Quarkus 发行版，Micrometer 指标） | Keycloak < 22（WildFly 版本使用不同的指标名） |
| 已有 Prometheus/Grafana 体系 | 没有 Prometheus 基础（需要先搭建监控栈） |
| Kubernetes Operator / Helm / 裸机部署 | 仅想通过 Keycloak Admin UI 看运行状态 |

> Keycloak 22 从 WildFly 迁移到 Quarkus 后，指标体系改用了 Micrometer，旧版 Grafana Dashboard（如 ID 10441）的指标名不再适用。如果你的 Keycloak 是 WildFly 版本，指标路径为 `/auth/realms/master/metrics`，且指标名以 `keycloak_` 为前缀。

## 启用 Metrics

### 方式一：CLI 启动参数

```bash
kc.sh start --metrics-enabled=true
```

### 方式二：环境变量

```bash
export KC_METRICS_ENABLED=true
```

### 方式三：conf/keycloak.conf

```
metrics-enabled=true
```

### 方式四：Kubernetes Operator CR

```yaml
spec:
  additionalOptions:
    - name: metrics-enabled
      value: "true"
```

### 方式五：Helm

```bash
helm install keycloak bitnami/keycloak --set metrics.enabled=true
```

> `metrics-enabled` 是构建时（build-time）选项，必须在首次启动时或通过 `kc.sh build` 阶段指定。如果你通过 Operator 或 conf 文件修改了此选项但没重建，需要先 `kc.sh build` 或重启 Pod 使其生效。

### 确认 Metrics 端点可用

Keycloak 的 metrics 端点位于 **management 接口**（默认端口 9000），路径为 `/metrics`。不存在按 Realm 的路径。

```bash
# 确认端点可访问（集群内）
curl -s http://localhost:9000/metrics | head -20

# Kubernetes 内验证
kubectl -n keycloak exec deploy/production-keycloak -- curl -s http://localhost:9000/metrics | grep keycloak
```

## Prometheus 采集配置

### 裸机 / VM 部署

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'keycloak'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['keycloak-host:9000']
```

### Kubernetes PodMonitor（推荐，Prometheus Operator）

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: keycloak
  namespace: keycloak
spec:
  selector:
    matchLabels:
      app: keycloak
  podMetricsEndpoints:
    - port: management  # Keycloak management 端口
      path: /metrics
      interval: 30s
```

### Kubernetes ServiceMonitor

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: keycloak
  namespace: keycloak
spec:
  selector:
    matchLabels:
      app: keycloak
  endpoints:
    - port: management
      path: /metrics
      interval: 30s
```

> `management` 端口（9000）不应暴露到公网。Prometheus 抓取走集群内网络即可；如果 Prometheus 在集群外，通过内部 Service 或 VPN 访问，不要给 9000 端口开 Ingress/公网 LB。

## 关键指标速查

Keycloak 22+ 使用 Micrometer，指标名以 `keycloak_` 为前缀（旧版 WildFly 指标也以 `keycloak_` 开头但命名方式不同）。

### 认证相关

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_logins_total` | Counter | 登录成功总数 |
| `keycloak_failed_login_attempts_total` | Counter | 登录失败总数 |
| `keycloak_registrations_total` | Counter | 用户自助注册总数 |
| `keycloak_token_total` | Counter | Token 签发总数 |

### 请求延迟

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_request_duration_seconds_bucket` | Histogram | 请求耗时分布 |
| `keycloak_request_duration_seconds_sum` | (辅助) | 耗时总和 |
| `keycloak_request_duration_seconds_count` | (辅助) | 请求总数 |

### HTTP 状态码

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_http_requests_total` | Counter | HTTP 请求总数 |

### 会话与用户

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_sessions_total` | Gauge | 当前活跃会话数 |

### JVM 与系统（Micrometer 标准）

| 指标 | 类型 | 含义 |
|------|------|------|
| `jvm_memory_used_bytes` | Gauge | JVM 已用内存 |
| `jvm_memory_max_bytes` | Gauge | JVM 最大可用内存 |
| `jvm_gc_pause_seconds` | Summary | GC 暂停时间 |
| `jvm_threads_live_threads` | Gauge | 活跃线程数 |
| `process_cpu_usage` | Gauge | 进程 CPU 使用率 |
| `system_cpu_usage` | Gauge | 系统整体 CPU 使用率 |

### 数据库连接池（Agroal）

| 指标 | 类型 | 含义 |
|------|------|------|
| `agroal_active_count` | Gauge | 正在使用的连接数 |
| `agroal_available_count` | Gauge | 空闲可用连接数 |
| `agroal_max_used_count` | Gauge | 历史峰值使用连接数 |
| `agroal_waiting_count` | Gauge | 等待获取连接的请求数 |

### 缓存指标（需额外开启 `cache-metrics-enabled`）

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_cache_hit_total` | Counter | 缓存命中次数 |
| `keycloak_cache_miss_total` | Counter | 缓存未命中次数 |

### 事件指标（需额外开启 `event-metrics-enabled`）

| 指标 | 类型 | 含义 |
|------|------|------|
| `keycloak_event_listener_events_total` | Counter | 事件监听器处理的事件总数 |

## Grafana Dashboard

### 推荐 Dashboard ID

新版 Keycloak（22+，Micrometer 指标）推荐：

| Dashboard ID | 说明 | URL |
|---|---|---|
| 21997 | Keycloak Metrics (Quarkus/Micrometer)，覆盖 JVM、HTTP、认证、会话 | [Grafana Dashboards](https://grafana.com/grafana/dashboards/21997) |

旧版 Keycloak（< 22，WildFly）：
| Dashboard ID | 说明 |
|---|---|
| 10441 | 旧版 Keycloak Metrics（不适合 Quarkus 版） |

导入步骤：

```bash
# 通过 Grafana Web UI
# Dashboards → Import → 输入 21997 → 选择 Prometheus 数据源
```

### Dashboard 覆盖的关键面板

- **Login Metrics**：成功/失败登录速率、注册速率
- **HTTP Metrics**：请求 QPS、状态码分布、延迟 P50/P95/P99
- **JVM Metrics**：堆内存使用、GC 次数和耗时、线程数
- **Database**：连接池活跃数、等待数、可用数

## 告警规则

### 核心告警（放到 PrometheusRule CR 或 prometheus.yml 的 rule_files）

```yaml
groups:
  - name: keycloak-critical
    rules:
      # 实例宕机
      - alert: KeycloakDown
        expr: up{job="keycloak"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Keycloak {{ $labels.instance }} 不可达"
          description: "Keycloak 实例 {{ $labels.instance }} 已超过 2 分钟无心跳，metrics 端点不可达"

  - name: keycloak-warning
    rules:
      # 认证延迟过高
      - alert: KeycloakHighAuthLatency
        expr: |
          rate(keycloak_request_duration_seconds_sum[5m]) /
          rate(keycloak_request_duration_seconds_count[5m]) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Keycloak 认证平均延迟超过 2 秒"
          description: "P50 登录延迟已持续 5 分钟超过 2s，检查数据库连接池和 GC"

      # 登录失败率异常升高
      - alert: KeycloakHighLoginFailureRate
        expr: rate(keycloak_failed_login_attempts_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Keycloak 登录失败率异常升高 (>10/min)"
          description: "可能原因：LDAP/AD 断连、暴力猜测、密码策略变更导致大量用户被锁"

      # 数据库连接池耗尽
      - alert: KeycloakConnectionPoolSaturated
        expr: agroal_active_count / agroal_max_used_count > 0.9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Keycloak 数据库连接池使用率超过 90%"
          description: "当前活跃连接数接近历史峰值，检查数据库负载和 pod 数量"

      # JVM 堆内存使用超过 80%
      - alert: KeycloakHighMemoryUsage
        expr: jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Keycloak JVM 堆内存使用率超过 80%"
          description: "可能原因：Session 过多未清理、缓存未命中导致内存泄漏"
```

### 告警阈值调优建议

| 指标 | 默认阈值 | 为什么 |
|------|---------|--------|
| 认证延迟 | > 2s | P50 超过 2s 意味着有半数用户登录体验极差 |
| 登录失败率 | > 10/min | 正常环境下失败率接近 0，持续升高必有异常 |
| 连接池使用率 | > 90% | 说明连接池配置过小或数据库响应过慢 |
| JVM 堆使用 | > 80% | 80% 以上 GC 会频繁触发，响应急剧恶化 |

根据你的环境调大或调小阈值。50 用户的小团队把阈值放大，10 万用户的生产集群可以更严格。

## 常见排错

### 1. `/metrics` 返回 404

**症状**：`curl http://localhost:9000/metrics` 返回 404

| 可能原因 | 检查方法 | 解决方案 |
|----------|---------|----------|
| `metrics-enabled` 未开启 | `curl -s localhost:9000/metrics` 返回 404；检查启动日志是否有 `metrics-enabled` | 设置 `KC_METRICS_ENABLED=true` 后重启 |
| 用了错误的端口（业务端口 8080/8443 而非管理端口 9000） | `curl -s localhost:8443/metrics` 返回 404 | 改用 9000 端口 |
| Keycloak < 22 旧版路径不同 | 检查 Keycloak 版本 | 旧版路径为 `/auth/realms/master/metrics` |

### 2. Prometheus 抓取超时

**症状**：Prometheus targets 页面显示 `context deadline exceeded`

| 可能原因 | 解决方案 |
|----------|---------|
| PodMonitor 指向了业务端口 | 确认 `podMetricsEndpoints.port` 指向 management（9000） |
| NetworkPolicy 阻止了 9000 入站 | 检查 NetworkPolicy，放行 Prometheus namespace 到 Keycloak 9000 的 TCP |
| Prometheus 在集群外无法直连 Pod IP | 创建 Service → Endpoints 或使用 ServiceMonitor 走 Service |

### 3. Grafana Dashboard 无数据或 N/A

**症状**：导入 Dashboard 21997 后所有面板显示 N/A

| 可能原因 | 解决方案 |
|----------|---------|
| Dashboard 是针对 WildFly 版的（10441） | 确认导入的是 21997（Quarkus 版） |
| Prometheus 数据源名不是 `Prometheus` | 在 Dashboard Variables 中修改数据源变量 |
| 指标名前缀不匹配 | 在 Grafana Explore 中执行 `keycloak_logins_total` 确认是否存在 |

### 4. `agroal_*` 系列指标缺失

**症状**：Prometheus 中搜不到 `agroal_active_count`

| 可能原因 | 解决方案 |
|----------|---------|
| 没有使用外部数据库（用了内置 H2） | 只有使用外部数据库（PostgreSQL/MySQL）时才会暴露 Agroal 指标 |
| 数据库连接池还未初始化 | 等待 Keycloak 完成首次数据库请求后再查 |

## 回滚

```bash
# 裸机/VM：去掉启动参数或 conf 中的 metrics-enabled
# 然后重启
kc.sh start --metrics-enabled=false

# Kubernetes Operator：删除 additionalOptions 中的 metrics-enabled 行
kubectl edit keycloak production-keycloak -n keycloak

# 关闭后清除 Prometheus scrape 配置，避免 scrape 报错
```

关闭 metrics 不影响 Keycloak 核心功能——所有认证、授权、Token 签发照常运行，只是失去可见性。

## 常见问题（FAQ）

**Q：能按 Realm 分别暴露 metrics 吗？**
A：不能。Keycloak metrics 端点 `/metrics` 是全局的，不区分 Realm。如果你需要按 Realm 统计，应该在 Grafana 中按 Realm 标签过滤或通过 Keycloak Admin API 单独查询。

**Q：metrics 对性能有影响吗？**
A：在正常负载下影响可忽略（< 1% CPU）。但在极大规模集群（100+ 万用户）中，事件类指标（`keycloak_event_listener_events_total`）如果开启了高频率事件采集，会有轻微开销。建议单独评估 `event-metrics-enabled` 的必要性。

**Q：能和 OpenTelemetry 对接吗？**
A：Keycloak 22+ 原生支持 OpenTelemetry Tracing（通过 `opentelemetry` feature），但 Metrics 现阶段仍以 Micrometer-Prometheus 为主。如果需要 OTLP 格式的 metrics，可以通过 Prometheus → OpenTelemetry Collector 桥接。

**Q：在哪里查看历史最佳实践的 dashboard 配置？**
A：Grafana 官方 Dashboard 库（grafana.com/grafana/dashboards）搜索 "Keycloak Micrometer" 或 "Keycloak 21997"。社区推荐的 21997 覆盖了核心可观测面板。

**Q：旧版 Keycloak（< 22）还能用这些配置吗？**
A：指标名和暴露方式不同。旧版在 `/auth/realms/master/metrics`，指标格式是 WildFly subsystem 风格。如果你还在用旧版，参考 Grafana Dashboard 10441——但强烈建议升级到当前稳定版（26.x）。
