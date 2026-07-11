---
title: "Keycloak 生产巡检与运维清单 — IAM 运维日常健康检查与应急处理 | IDaaS Book"
description: "Keycloak 生产环境运维手册：日常巡检项目、IAM 健康检查、监控告警阈值、证书管理、备份验证与常见 IAM 运维故障应急响应流程"
date: 2026-07-11T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-operations-checklist"
toc: true
---

## 场景

你已经在生产环境跑起了 Keycloak 集群，Prometheus 监控也接了，备份脚本也写了。但运维不只是"配好就忘"——每天需要确认哪些指标？证书什么时候过期？磁盘是不是快满了？用户会话数是否异常暴涨？

这份清单来自多个 Keycloak 生产集群的实际运维经验，覆盖日常、每周和月度巡检项，以及常见 IAM 运维故障的应急响应步骤。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| Keycloak 24+ Quarkus 生产集群 | 开发环境（`start-dev` 模式） |
| 2 个以上节点的集群部署 | 单节点测试部署 |
| 已配置 Prometheus + Grafana 监控 | 没有监控手段的裸部署 |
| 运维人员需要标准化巡检流程 | 初次部署（先看 [Kubernetes 生产部署指南]({{< relref "docs/implementation/kubernetes-production" >}})） |

## 日常巡检（每天）

以下检查项应在每天开始工作前完成，单次耗时不超过 5 分钟。

### 1. 节点存活检查

```bash
# 检查每个节点的健康端点
for node in keycloak-0 keycloak-1 keycloak-2; do
  curl -s -o /dev/null -w "%{http_code}" "https://${node}.internal/health/live"
  echo " ${node}"
done
```

期望输出：全部返回 `200`。健康端点在 Quarkus 中默认启用（`/health/live` 和 `/health/ready`），不需要额外配置。

### 2. 会话数量趋势

```bash
# 通过 Prometheus 查询活跃会话数
# Metrics: keycloak_sessions_total
```

关注点：如果会话数突然翻倍或骤降 50% 以上，可能是以下原因：
- 会话突然翻倍：Token 刷新循环或客户端配置错误导致频繁创建新会话
- 会话骤降：节点被踢出集群（检查 Infinispan 集群状态）或负载均衡器健康检查失败

正常波动范围：工作日 ±20% 属于正常。突发流量（如全员早会登录）短暂峰值后可回落。

### 3. 登录失败率

```promql
# PromQL：登录错误占比
rate(keycloak_failed_login_attempts_total[5m]) /
rate(keycloak_login_attempts_total[5m]) * 100
```

阈值：失败率 > 10% 告警。常见原因：
- 用户密码过期（批量到期）
- LDAP/AD 后端不可达（IAM 身份源故障）
- 暴力破解攻击（检查 [暴力破解检测]({{< relref "docs/keycloak/security-features/brute-force-detection/index" >}}) 日志）

### 4. JVM 内存与 GC

```promql
# 堆内存使用率
jvm_memory_used_bytes{area="heap"} / jvm_memory_max_bytes{area="heap"} * 100
```

阈值：堆内存使用率持续 > 80% 应排查。常见原因：
- 会话缓存膨胀（用户数增长，缓存没设上限）
- 内存泄漏（检查 `jvm_memory_pool_bytes_used` 的趋势）
- JVM 参数不当（生产建议 `-Xmx` 至少 2G）

### 5. 磁盘使用率

```bash
# 检查数据目录大小
du -sh /opt/keycloak/data/
```

关注项：
- `data/h2/` 仅在开发模式使用，生产应指向外部数据库
- `data/log/` 日志轮转是否正常（不应出现单个日志文件超过 500MB）
- `data/tmp/` 定期清理，避免临时文件堆积

## 每周巡检

### 6. 证书到期检查

Keycloak 涉及多类证书，任一过期都会导致服务不可用：

| 证书类型 | 检查方式 | 到期前告警 |
|---------|---------|-----------|
| HTTPS 证书（Ingress/TLS） | `openssl s_client -connect` | 30 天 |
| ID Token 签名密钥（RS256/ES256） | Keycloak Admin Console → Realm Settings → Keys | 30 天 |
| JGroup 集群通信证书 | `keytool -list -v -keystore` | 30 天 |
| 数据库 TLS 证书 | `openssl s_client -connect db:5432 -starttls postgres` | 30 天 |
| LDAPS 证书 | `openssl s_client -connect ad-server:636` | 30 天 |

```bash
# 批量检查 HTTPS 证书到期时间
echo | openssl s_client -servername idaas.example.com -connect idaas.example.com:443 2>/dev/null | openssl x509 -noout -enddate
```

Keycloak 的 Realm 密钥有 `active` 和 `passive` 两种状态。轮换时先将新密钥设为 `passive`，确认所有客户端验证通过后再激活。

### 7. 数据库连接池

```promql
# 活跃连接数 vs 最大连接数
hikaricp_connections_active / hikaricp_connections_max
```

阈值：活跃连接 > 80% 最大值时告警。排查方向：
- 慢查询导致连接堆积
- 连接池太小（生产建议 `db-pool-initial-size=10`，`db-pool-max-size=50`）

### 8. 备份验证

```bash
# 检查最近备份文件是否正常
ls -lh /backup/keycloak/$(date +%Y%m%d)*
# 实际恢复测试：在 staging 环境还原备份
```

**重要**：备份不验证等于没备份。每周在隔离环境做一次还原测试，确认：
- 数据库 dump 可正常导入
- Realm JSON 导出可正常导入
- 用户密码哈希迁移后仍可登录

### 9. 用户会话异常审计

```promql
# 按客户端统计活跃会话
keycloak_sessions_total by (realm, client_id)
```

关注：某客户端会话数异常（如测试客户端突然有 500+ 活跃会话），可能是：
- 测试脚本忘了关
- 客户的 Refresh Token 循环（每 30 秒刷新一次，需要检查客户端配置）

## 月度巡检

### 10. 性能基线对比

记录以下指标作为月度基线，与上月对比：

| 指标 | 记录方式 | 异常阈值 |
|------|---------|---------|
| 登录 P99 延迟 | Prometheus `keycloak_request_duration_seconds` 分位数 | 比上月增加 50% |
| Token 签发 QPS | `rate(keycloak_token_requests_total[1h])` | 用于容量规划 |
| 数据库查询延迟 | HikariCP metrics | > 100ms P99 |
| Infinispan 集群通讯延迟 | JGroups metrics | > 50ms avg |
| 平均会话时长 | `keycloak_session_duration_seconds` | 监控用户行为变化 |

### 11. 用户与角色审计

IAM 权限的"熵增"是不可逆的——权限只会越来越多，不会自动减少。月度审计项：

- [ ] 过去 30 天内新增的管理员账号列表（检查是否有未授权的管理员创建）
- [ ] 拥有 `realm-admin` 角色的用户清单（是否都是已知运维人员）
- [ ] 30 天未登录的用户（是否应该禁用）
- [ ] 未使用的 Client/Scope/Role（考虑清理或归档）

```bash
# 通过 Admin REST API 查询管理员用户
curl -s "https://keycloak.example.com/admin/realms/{realm}/roles/realm-admin/users" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.[].username'
```

### 12. 日志审计抽样

随机抽取过去 24 小时的 100 条 `ADMIN_EVENT`，检查：
- 是否有非工作时间的配置变更
- 是否有异常的 IP 来源（如境外 IP 操作管理后台）
- `DELETE` 操作是否有对应的审计记录

## 告警规则速查

建议在 Prometheus AlertManager 中配置以下规则：

```yaml
groups:
  - name: keycloak
    rules:
      - alert: KeycloakNodeDown
        expr: up{job="keycloak"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Keycloak node {{ $labels.instance }} is down"

      - alert: KeycloakHighLoginFailureRate
        expr: |
          rate(keycloak_failed_login_attempts_total[5m])
          / rate(keycloak_login_attempts_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Login failure rate > 10% in realm {{ $labels.realm }}"

      - alert: KeycloakHighHeapUsage
        expr: |
          jvm_memory_used_bytes{area="heap"}
          / jvm_memory_max_bytes{area="heap"} > 0.85
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "JVM heap usage > 85% on {{ $labels.instance }}"

      - alert: KeycloakCertificateExpiry
        expr: probe_ssl_earliest_cert_expiry - time() < 86400 * 14
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "TLS certificate expires in less than 14 days"
```

## 常见 IAM 运维应急场景

### 场景一：所有节点同时不可达

**症状**：`/health/live` 全部返回非 200，用户登录失败

**应急步骤**：
1. 检查数据库是否存活——Keycloak 强依赖数据库，数据库挂了所有节点不可用
2. 检查 Kubernetes Node/基础设施——是否发生了节点驱逐或网络分区
3. 如果数据库正常但 Keycloak 异常，优先重启一个节点，观察日志中的启动错误
4. 不要在数据库恢复前同时重启所有节点——可能导致 Infinispan 集群分裂

### 场景二：用户批量无法登录

**症状**：故障率从 2% 突然跳到 30%+，大量用户报告"账号或密码错误"

**应急步骤**：
1. 确认是否某个 Identity Provider（LDAP/AD）不可达——IAM 身份源故障是批量登录失败的首要原因
2. 检查 LDAP 连接配置：`test ldap-connection` 或 `ldapsearch -H ldaps://ad-server -D "cn=bind-user" -w ${PASSWORD} -b "dc=example,dc=com"`
3. 如果 LDAP 正常，检查 Realm 级的 `bruteForceDetection` 是否误封了大量用户

### 场景三：磁盘空间不足

**症状**：Keycloak 日志报 `No space left on device`，节点不可写

**应急步骤**：
1. 立即清理过期日志：`find /opt/keycloak/data/log -name "*.log" -mtime +7 -delete`
2. 检查数据目录是否有异常大文件：`du -sh /opt/keycloak/data/* | sort -rh | head -10`
3. 如果是数据库磁盘满（外部 PostgreSQL），优先清理审计事件表（`event_entity` 表可能非常大）

## IAM 运维 FAQ

### Q1：IAM 运维和普通应用运维有什么本质区别？

IAM 是基础设施中的"基础设施"——如果 IAM 挂了，所有依赖它的应用都无法登录。这决定了 IAM 运维的两个特点：
1. **可用性要求极高**：IAM 不可用 = 全公司停工，SLA 通常要求 99.95% 以上
2. **安全与便利的平衡**：紧急恢复时可能需要临时放宽安全策略（如关闭 MFA），但事后必须记录和回滚

### Q2：Keycloak 有内置的巡检工具吗？

Keycloak 本身没有一键巡检命令。但可以从以下三个维度组合使用：
- `/health/live` 和 `/health/ready` 端点（存活和就绪检测）
- `/metrics` 端点暴露的 Prometheus 指标（需要启用 `--metrics-enabled=true`）
- Admin REST API（查询用户数、会话数、事件审计）

建议基于上述接口编写运维脚本，而非在控制台手动点检。

### Q3：IAM 证书轮换时如何做到不中断服务？

Keycloak 的 Realm 密钥支持多密钥共存：
1. 创建新密钥，初始状态为 `PASSIVE`（只用于验证，不用于签名）
2. 等待所有客户端和 IdP 获取到新密钥（通常 24 小时内，取决于缓存）
3. 将新密钥切换为 `ACTIVE`，旧密钥保持 `PASSIVE`（继续验证已签发的 Token）
4. 等待旧 Token 全部过期后（取决于 Token 最大有效期），再删除旧密钥

这个流程在 [Keycloak 官方密钥轮换文档](https://www.keycloak.org/docs/latest/server_admin/#rotating-keys) 中有完整描述。

### Q4：如何评估 Keycloak 需要扩容？

纬度 → 指标 → 阈值：

| 信号 | 指标 | 扩缩动作 |
|------|------|---------|
| CPU 持续高负载 | `process_cpu_usage > 0.7` 超过 30 分钟 | 扩容节点或增加 CPU request |
| 内存 GC 频繁 | `jvm_gc_pause_seconds` P99 > 500ms | 增加 heap 或扩容节点 |
| 登录 QPS 接近上限 | 单节点 `keycloak_token_requests` > 预期的 80% | 扩容节点 |
| 数据库连接池耗尽 | `hikaricp_connections_pending > 0` | 先优化慢查询，再扩容连接池 |

先垂直扩容（增加 CPU/Memory），再水平扩容（增加节点）。Keycloak 的 Infinispan 分布式缓存在节点数变化时需要重新平衡，扩容超过 4 个节点时回报递减明显。

## 小结

IAM 运维的核心不是"会不会配"，而是"能不能在凌晨三点被叫起来时，30 分钟内定位问题并恢复服务"。这份清单的价值在于把隐性知识显性化——每周照着走一遍，大多数问题在变成事故之前就能被发现。

配合 [Keycloak 集群缓存调优指南]({{< relref "keycloak-cluster-cache-tuning" >}}) 中的缓存排错和 [Keycloak 高可用与灾难恢复]({{< relref "keycloak-ha-dr" >}}) 中的容灾架构，可以建立完整的 IAM 运维体系。
