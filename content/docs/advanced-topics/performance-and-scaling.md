---
title: "第22章：性能与扩展性"
description: "IDaaS 系统性能优化与水平扩展：数据库优化、缓存策略、负载测试方案"
date: 2024-05-03T00:00:00+08:00
draft: false
weight: 53
menu:
  docs:
    parent: "advanced-topics"
    identifier: "performance-and-scaling"
toc: true
---

## 22.1 IDaaS 的性能模型

IDaaS 系统的负载特征：

- **读多写少**：认证操作远多于管理操作（100:1 或更高）
- **突发性强**：工作日早晨的登录高峰
- **延迟敏感**：用户等待认证的时间忍受度极低（期望 < 500ms）
- **状态管理**：Session 和 Token 需要分布式存储

### 关键性能指标

| 指标 | 目标值 | 说明 |
|-----|--------|------|
| 登录延迟（P50） | < 200ms | 正常情况 |
| 登录延迟（P95） | < 500ms | 高峰情况 |
| 登录延迟（P99） | < 1s | 极端情况 |
| Token 签发延迟 | < 50ms | 不含用户认证 |
| Token Introspection | < 10ms | 资源服务器高频调用 |
| 可用性 | 99.99% | 年停机 < 52 分钟 |

## 22.2 数据库优化

IDaaS 的性能瓶颈往往在数据库。

### 查询优化

**索引策略**：

```sql
-- Keycloak 中最频繁的查询路径（示例基于 JPA schema，实际表/列名随版本而变，
-- 且 Keycloak 默认已为多数查询列建好索引，手动建索引前请先确认避免重复）
-- 查找用户的 Session
CREATE INDEX idx_user_session_user ON USER_SESSION(USER_ID);

-- 查找 Realm 的 Session
CREATE INDEX idx_user_session_realm ON USER_SESSION(REALM_ID);

-- Client Session 关联到 User Session（外键为 USER_SESSION_ID）
CREATE INDEX idx_client_session_user_session ON CLIENT_SESSION(USER_SESSION_ID);

-- 离线 Token 查找
CREATE INDEX idx_offline_user_session ON OFFLINE_USER_SESSION(USER_SESSION_ID);
```

### 连接池

```
db-pool-initial-size: 10
db-pool-min-size: 10
db-pool-max-size: 单节点合理的最大连接数
  ≈ 该节点的并发工作线程数（受 DB 总连接上限 / 节点数 约束）
  例：DB 最大连接 600，3 节点，则单节点上限 ≈ 600 / 3 × 0.7 ≈ 140
  （确保 节点数 × 单节点池上限 ≤ 数据库 max_connections 的合理比例，如 60–70%）
```

### 读写分离

对于大规模部署（>100K 用户）：

```
          ┌─────────────┐
写操作 ──→│ Primary DB  │
          └──────┬──────┘
                 │ 复制
          ┌──────┴──────┐
读操作 ──→│  Read Replica│ (认证读取)
          └─────────────┘
```

部分操作（如用户属性读取）可以从只读副本进行，减少主库压力。

## 22.3 缓存策略

### 缓存层级

```
L1: JVM 本地缓存（最快，但节点间不一致）
    ↓ Miss
L2: Infinispan 分布式缓存（集群内一致，网络开销）
    ↓ Miss
L3: 数据库（最慢，但数据最新）
```

### 缓存 TTL 调优

| 缓存 | 建议 TTL | 原因 |
|-----|---------|------|
| Realm 配置 | 3600s | 配置不常变 |
| 用户数据 | 300-600s | 需要一定时效性 |
| 客户端配置 | 3600s | 不常变 |
| 角色/组 | 600s | 变更频率中等 |
| 授权策略 | 300s | 需要较快生效 |

### 缓存预热

在集群重启后，可以先预热缓存：

```bash
# 模拟高并发读取，将热点数据加载到缓存
for realm in $(get-all-realms); do
  curl -s "https://auth.example.com/admin/realms/$realm/users?max=200" > /dev/null
done
```

## 22.4 水平扩展

### 扩展模型

Keycloak 的水平扩展是"共享数据库 + 分布式缓存"模型：

```
     [LB]
      │
 ┌────┼────┐
 │    │    │
[K1] [K2] [K3]  ← 所有节点对等，无状态
 │    │    │
 └────┼────┘
      │
   [PostgreSQL]  ← 共享状态
```

### 扩容建议

- 2-3 个节点是最常见的生产配置
- 超过 10 个节点时，Infinispan 分布式缓存的网络通信开销显著增加
- 超大规模场景建议使用**外部 Infinispan 集群**

### Session 处理

Keycloak 用 Infinispan 缓存 user/client/offline session。要实现多节点共享需配置 distributed 缓存 + 集群发现，并设置足够的 `owners`（默认值在多副本下不一定满足高可用，生产需调高）；realm/client/user 等缓存则多为 local + Infinispan invalidation 模式（写时发失效广播让其他节点丢弃本地条目，而非复制数据）：

- 用户登录到节点 1，Session 写入 distributed 缓存
- 后续请求到达节点 2，从缓存加载 Session（依赖正确的集群发现与 owner 副本数）

对于极高可用性要求，可以考虑：
- 无 Session 模式（仅使用 Token，无服务端 Session）
- 外部 Infinispan/Redis 作为 Session 存储

## 22.5 负载测试

### 测试工具

- **JMeter**：传统但强大的 HTTP 负载测试
- **k6**：现代、代码化、Kubernetes 友好
- **wrk/wrk2**：轻量级、高性能

### k6 测试脚本示例

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // 逐步增加到 100 VU
    { duration: '5m', target: 100 },   // 保持在 100 VU
    { duration: '2m', target: 500 },   // 增加到 500 VU
    { duration: '5m', target: 500 },   // 保持在 500 VU
    { duration: '2m', target: 0 },     // 逐步减少
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // P95 < 500ms
    'http_req_failed': ['rate<0.01'],   // 失败率 < 1%
  },
};

const BASE_URL = 'https://auth.example.com';

export default function () {
  // 获取登录页面（k6 的 http.get 第二个参数是 params 对象，不是 query string，
  // 因此 OIDC 参数必须拼进 URL）
  const authUrl = `${BASE_URL}/realms/test/protocol/openid-connect/auth` +
    `?client_id=test-client` +
    `&redirect_uri=${encodeURIComponent('https://app.example.com/callback')}` +
    `&response_type=code&scope=openid`;
  let loginPage = http.get(authUrl);

  // 提取 form action URL
  // ... 解析并提交登录表单 ...
  
  // 实际测试中需要完整的 OIDC 流程模拟
  // 这里展示框架结构
}
```

### 性能基测

不同规模下的预期表现：

| 规模 | 节点 | 并发 | 预期 TPS | DB CPU |
|-----|------|------|---------|--------|
| 1K 用户 | 1×2C/4G | 50 | 100-200 | < 20% |
| 10K 用户 | 2×4C/8G | 200 | 300-500 | 20-40% |
| 100K 用户 | 3×8C/16G | 500 | 500-1000 | 40-60% |
| > 500K 用户 | 4+×16C/32G | 1000+ | 需定制评估 | 定制方案 |

## 22.6 常见性能问题与优化

### 问题一：数据库慢查询

**症状**：P99 延迟高，数据库 CPU 持续高

**诊断**：
```sql
SELECT query, calls, mean_exec_time, max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**解决**：添加索引、优化查询、增加连接池

### 问题二：缓存命中率低

**症状**：数据库 QPS 在峰值时异常高

**诊断**：监控缓存命中率、检查 TTL 配置

**解决**：增加 TTL、预热缓存、检查缓存序列化

### 问题三：Session 表膨胀

**症状**：数据库体积持续增长

**原因**：过期 Session 未清理

**解决**：确认 Session 清理定时任务正常执行

### 问题四：Token Introspection 性能

**症状**：资源服务器调用 Introspection 端点延迟高

**优化**：
- 使用 JWT 格式 Access Token（资源服务器本地验证，无网络开销）
- Introspection 结果缓存
- 批量 Introspection

## 22.7 小结

IDaaS 的性能调优是一个系统工程：数据库优化是重中之重（索引、连接池）、缓存策略要合理（TTL 平衡新鲜度和命中率）、水平扩展要规划好。最重要的是——在生产环境上线前进行负载测试，了解系统的实际处理能力，而不是凭感觉评估。
