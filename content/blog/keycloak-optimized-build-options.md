---
title: "Keycloak --optimized 启动失败：IAM 构建期选项与运行期选项的边界"
description: "Keycloak 报 build time options have values that differ from what is persisted 的原因：--optimized 只认镜像里持久化的构建期选项，给出正确的镜像构建方式、诊断命令与回滚路径。"
summary: "容器里给 Keycloak 挂 KC_DB、KC_METRICS_ENABLED 却启动失败或选项不生效，多数是 build-time 与 runtime 选项混用。这篇把校验逻辑、报错原文、版本差异、正确镜像构建方式和回滚讲清楚。"
date: 2026-09-24T22:00:00+08:00
lastmod: 2026-09-24T22:00:00+08:00
draft: false
weight: 34
images: []
categories: ["Keycloak", "Kubernetes"]
tags: ["Keycloak", "optimized", "kc.sh build", "build-time", "container", "troubleshooting", "IAM"]
contributors: []
pinned: false
homepage: false
seo:
  title: "Keycloak --optimized 启动失败：构建期选项与运行期选项边界"
  description: "Keycloak 报 The following build time options have values that differ from what is persisted 的根因与修复：build-time 选项必须固化在镜像里，附多阶段 Containerfile、show-config 诊断与回滚步骤。"
  canonical: ""
  noindex: false
---

## 症状

镜像和 compose 文件看起来都没问题，但 Pod 起不来，或者配置"写了不生效"：

```text
ERROR: The following build time options have values that differ from what is persisted - the new values will NOT be used until another build is run: kc.db, kc.metrics-enabled
```

同一类问题的另外两种表现：

1. 报的是 provider 时间戳，不是选项值：

   ```text
   ERROR: A provider JAR was updated since the last build, please rebuild for this to be fully utilized.
   ```

2. 什么都没报，只是"配置没效果"——旧版本（≤ 25.x）对这类冲突不报错，照常启动，用的是镜像里构建时固化的值，运行期传的那份被丢掉了。这是最难排查的一种：日志干净，行为不对。

这三种都是同一个根因：**在 `start --optimized` 下，用运行期配置去覆盖构建期（build-time）选项**。

## 先看什么

不要先改 YAML。先确定三件事。

```bash
# 1. 这个选项属于哪一类？build --help 只列构建期选项
kc.sh build --help | grep -E "db|metrics|health|features"

# 2. 服务端最终解析成了什么，每个值的来源是什么
kc.sh show-config
```

`show-config` 的输出会标注来源，例如：

```text
kc.optimized = true (Persisted)
kc.metrics-enabled = true (ENV)
kc.hostname = https://idaas.example.com (ENV)
```

看到 `(Persisted)` 就是镜像里固化下来的构建期值——**运行期再传任何不同的值都无效**，而且在新版本上会直接导致启动失败。

校验实际比对的对象是镜像内 `lib/quarkus/generated-bytecode.jar` 里的 `META-INF/keycloak-persisted.properties`（`kc.optimized`、`kc.profile` 等键和 provider 的 `last-modified` 时间戳也记在这里）。Keycloak 镜像基于精简基础镜像，不一定带 `unzip`/`jar`，排查时优先用 `show-config` 和启动日志，不必强行解包。

> 26.1 的 `show-config` 在个别场景下会把从环境变量推导出的 second-class 键也打印出来，看上去像"ENV 覆盖成功了"，实际校验不以它为准（[#38249](https://github.com/keycloak/keycloak/issues/38249) 里有这个现象的完整讨论）。判断依据以启动是否报错为准，不要只看 `show-config`。

## 根因

### 为什么会有两类选项

Keycloak 从 WildFly 迁到 Quarkus 后，配置被切成两层：

| | 构建期（build-time） | 运行期（runtime） |
|---|---|---|
| 何时生效 | `kc.sh build` 阶段，值持久化进镜像 | 每次启动 |
| 典型选项 | `db`、`features`、`health-enabled`、`metrics-enabled`、`tracing-enabled`、`cache`、`spi-*` | `db-url`、`db-username`、`db-password`、`hostname`、`proxy-headers`、`log-level`、`db-pool-*` |
| 能否改 | 改完必须重建镜像 | 随便改 |
| 存放位置 | 镜像内 `META-INF/keycloak-persisted.properties`，**明文** | 环境变量 / `keycloak.conf` / CLI |

两个容易踩的点：

- **凭"选项名感觉"分类必然出错。** `db`（数据库厂商）是构建期，`db-url` / `db-username` / `db-password` 是运行期；`metrics-enabled` 是构建期，`db-pool-max-size` 是运行期。官方文档里构建期选项在 All configuration 页面上带一个工具图标，最可靠的确认方式仍是 `kc.sh build --help`。
- **构建期选项明文落盘。** 所以凭据类（`db-password`）在设计上就不允许进构建期：执行 `kc.sh build` 时如果带上运行期选项，日志会打印 `The following run time options were found, but will be ignored during build time: ...`，这是预期行为，不是配置丢了。

### `--optimized` 做了什么

| 启动方式 | 行为 | 代价 |
|---|---|---|
| `kc.sh start`（不带 `--optimized`） | 检测到构建期选项与当前镜像不一致时，**启动过程中自动做一次构建**（auto-build），选项生效 | 每次启动多几秒到几十秒，镜像变得"可变"，不适合按不可变基础设施管理的集群 |
| `kc.sh start --optimized` | 完全跳过构建阶段，构建期选项**以镜像内持久化值为准** | 运行期传入不同的构建期值 = 启动失败 |

想在启动阶段用运行期参数临时改数据库，官方文档给的是明确的排除结论：Red Hat build of Keycloak 26.0《Server Configuration Guide · Configuring the database》里的 Warning 写明——**除了 H2，如果要使用特定数据库，不要对 `start` 使用 `--optimized`；必须先执行构建阶段**（要么不带 `--optimized` 启动，要么先 `build` 再优化启动）。

### 校验逻辑与报错原文

上游 `Picocli.validateBuildtime()` 的逻辑可以概括为：

1. 遍历镜像里持久化的构建期选项，逐个与当前配置解析出的值比对；
2. 值不同的键收集起来（值相同则静默忽略——所以在 build 和 start 两处都写同一个值是安全的，官方文档也这么描述）；
3. 只要集合非空，抛 `PropertyException`，进程退出，不会"降级继续启动"。

豁免的几类键：`kc.optimized`、profile 相关键、`quarkus.*` 前缀的键（由 Quarkus 自己处理），以及 `kc.provider.file.*`（走单独的时间戳校验，见下文）。

报错文本本身已经说明了后果——`the new values will NOT be used until another build is run`——但很多教程把它当成"提示可以忽略"，实际是硬错误。

### 版本差异

同一份配置在不同版本上的结果不一样，这是排查时最容易误判的地方：

| 版本 | 行为 |
|---|---|
| ≤ 25.x | 校验逻辑尚未引入（26.0 才出现 `checkSpiOptions()`），冲突值不会中断启动，服务按镜像内持久化值运行；部分场景连警告都没有（[#33902](https://github.com/keycloak/keycloak/issues/33902)、[#33683](https://github.com/keycloak/keycloak/issues/33683)） |
| 26.0.0 起 | 改为硬错误并拒绝启动，对应提交 `d5d6390b`（2024-09-30，PR #33241，"Make Keycloak fail with an error when the persisted build options differs from those provided"） |
| 26.0 / 26.1 | SPI 选项采用弱校验：只要键名匹配 `kc.spi*-enabled`、`kc.spi*-provider`、`kc.spi*-provider-default`，一律按构建期处理。`spi-user-cache-infinispan-enabled=false`、`spi-events-listener-micrometer-user-event-metrics-enabled` 这类配置因此会触发报错，但它们看上去完全是运行期选项（[#33902](https://github.com/keycloak/keycloak/issues/33902)、[#33683](https://github.com/keycloak/keycloak/issues/33683)） |
| 26.2.x 早期版本 | 回归：写在 `conf/quarkus.properties` 里的 `quarkus.*` 运行期属性也被判成构建期冲突（[#39450](https://github.com/keycloak/keycloak/issues/39450)）。已在 release/26.2 修复（PR #39778，2025-05 合入），绕开方式是改回环境变量而不是 `quarkus.properties` |
| 当前主线 | `quarkus.*` 前缀已从硬错误中排除，SPI 属性映射逻辑重做后，派生出的 SPI 键会正确持久化（[#38249](https://github.com/keycloak/keycloak/issues/38249) 评论） |

运维结论：**升级 Keycloak 主版本时，先检查有没有把构建期选项放在运行期配置里**。这一步的收益比看 release notes 里的新特性大得多。

## 最小可运行配置

### 正确做法：构建期选项固化进镜像

```dockerfile
# 阶段一：构建。所有 build-time 选项在这里给全
FROM quay.io/keycloak/keycloak:26.7.3 AS builder

ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true
ENV KC_FEATURES=token-exchange

RUN /opt/keycloak/bin/kc.sh build

# 阶段二：运行。只保留运行期配置
FROM quay.io/keycloak/keycloak:26.7.3
COPY --from=builder /opt/keycloak/ /opt/keycloak/

ENV KC_DB=postgres            # 与构建期同值，安全；也可以省略
ENV KC_DB_URL=jdbc:postgresql://postgres-svc:5432/keycloak
ENV KC_DB_USERNAME=keycloak
ENV KC_HOSTNAME=https://idaas.example.com
# KC_DB_PASSWORD / KC_DB_USERNAME 建议由 Secret 注入，不要写死在镜像

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
```

对应 Kubernetes 侧：

```yaml
containers:
  - name: keycloak
    image: registry.internal/idaas/keycloak:26.7.3-optimized
    args: ["start", "--optimized"]
    env:
      - name: KC_DB_URL
        value: "jdbc:postgresql://postgres-svc.default:5432/keycloak"
      - name: KC_DB_USERNAME
        valueFrom:
          secretKeyRef: { name: keycloak-db-credentials, key: username }
      - name: KC_DB_PASSWORD
        valueFrom:
          secretKeyRef: { name: keycloak-db-credentials, key: password }
```

注意这里**没有**在运行期传 `KC_DB`、`KC_METRICS_ENABLED`、`KC_FEATURES`：这些已经在镜像里了。如果确实要在运行期重复写一遍，值必须与镜像构建时完全一致。

### Operator 场景

Keycloak Operator 以 `--optimized` 方式启动实例，所以规则同样适用：**构建期选项进镜像，`spec.additionalOptions` 只放运行期选项**。

- 自定义镜像（加 JDBC 驱动、加 SPI、开 metrics/health）必须在镜像里执行 `kc.sh build`，官方文档对 Operator 用镜像的要求是"optimized images with all build-time options set"。
- 在 `additionalOptions` 里写 `metrics-enabled`、`spi-*-enabled` 这类构建期选项，在 26.1 上出现过实例反复重启、报持久化值不一致的情况（[#38249](https://github.com/keycloak/keycloak/issues/38249)）。当时的绕开方式是把这些选项从 `additionalOptions` 移到镜像构建阶段的 CLI 参数里。
- Operator 升级 Keycloak 版本时同样要重建自定义镜像，不能只改 CR 里的镜像 tag——否则构建期选项还是老版本的持久化值。

### provider JAR 的时间戳

往 `providers/` 里放 JAR 之后如果只重启不重建，`start --optimized` 会连 provider 的时间戳一起校验：

```text
ERROR: A provider JAR was updated since the last build, please rebuild for this to be fully utilized.
```

容器环境里，Picocli 的这条校验会降级为警告：

```text
WARN: A provider jar has a different timestamp than when the optimized container image was created...
```

但**别把"容器里只警告"当成保证**。时间戳比对有两条路径，另一条是 re-augmentation 时对持久化映射表的整体比对，它不看运行环境，一旦镜像构建机与运行节点的文件系统时间戳精度不同（CI 主机给出毫秒、部分容器运行时只给到秒）就会直接失败——[#39228](https://github.com/keycloak/keycloak/issues/39228) 就是 GitHub Actions 构建、Azure 运行时报这个错，报告者在镜像构建阶段加 `touch` 后确认解决。

官方容器指南的对策是在 build 之前把 `providers/` 下的文件时间戳显式固定：

```dockerfile
ADD --chown=keycloak:keycloak --chmod=644 myprovider.jar /opt/keycloak/providers/
RUN touch -m --date=@1743465600 /opt/keycloak/providers/*
RUN /opt/keycloak/bin/kc.sh build
```

自带 CI 构建流水线时，这一行 `touch` 值得常驻：它让构建结果可复现，也避免镜像换个运行环境就报 provider 时间戳不一致。

## 验证

```bash
# 1. 构建期选项已持久化，且来源是 Persisted
kc.sh show-config | grep -E "kc\.(db|metrics-enabled|features|optimized)"

# 2. 启动日志里没有 build time options 相关报错，且启动耗时应明显低于非优化模式
kubectl logs deploy/keycloak | grep -E "started in|build time options"

# 3. 功能真生效，而不是"看起来配上了"
curl -sf http://keycloak:9000/health/ready        # 启用 health-enabled 后
curl -s  http://keycloak:9000/metrics | head -3   # 启用 metrics-enabled 后
```

第 3 步是必须的：`KC_METRICS_ENABLED=true` 写错位置时，Pod 能起来，但 `/metrics` 返回 404——这种"启动了但没生效"的案例正是旧版本静默忽略行为留下的。

## 常见误区

| 误区 | 实际行为 |
|---|---|
| "`--optimized` 只是跳过构建的加速开关，随便加" | 它同时把构建期选项变成不可覆盖的硬约束，冲突直接导致启动失败 |
| "在 build 和 start 两处都写同样的值会更保险" | 值相同是安全的，但纯属冗余。真正危险的是两处值不同——尤其是升级镜像后只改了其中一处 |
| "把 `db-password` 也放进构建阶段一起固化" | 构建期选项明文持久化进镜像；且 `db-password` 是运行期选项，build 阶段会打印 `ignored during build time` 后丢弃 |
| "用 `spi-*-enabled` 之类的 SPI 键调运行期行为" | 26.x 的弱校验按键名模式判定，这类键会被当成构建期选项（#33902 / #33683） |
| "报错里说 will NOT be used，说明服务还能用" | 26.0 起这是 `PropertyException`，进程直接退出，不存在"继续用旧值"的降级路径 |

## 回滚

出事时的第一优先级是恢复服务，不是把配置改漂亮：

1. **去掉 `--optimized` 立即恢复。**

   ```bash
   kubectl set image deploy/keycloak keycloak=registry.internal/idaas/keycloak:26.7.3   # 回到通用镜像
   kubectl patch deploy keycloak --type=json \
     -p '[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["start"]}]'
   ```

   代价要提前知道：auto-build 让每次启动都重新构建，启动时间上升；多副本滚动更新时会同时触发多次构建，**先扩容前把 maxSurge/maxUnavailable 收紧，避免启动风暴把数据库打满**。这是应急手段，不是稳态配置。

2. **回退镜像 tag。** 如果是升级镜像后出现的报错，把镜像 tag 退到上一个已验证版本，比改选项更快更稳。

3. **Operator：** 回退 CR 里的 `spec.image`，并同步删除本次新增的 `additionalOptions`——构建期选项留在 `additionalOptions` 里，即使镜像退回去也还是不一致。

4. 恢复后再按上面的方式把构建期选项补进镜像，重新走一遍验证三步，最后才把 `--optimized` 加回去。

## 参考

- Keycloak《Configuring Keycloak》：构建期/运行期选项划分、`--optimized` 语义 —— https://www.keycloak.org/server/configuration
- Keycloak《Running Keycloak in a container》：多阶段 Containerfile、provider 时间戳处理、内存参数 —— https://www.keycloak.org/server/containers
- Red Hat build of Keycloak 26.0《Server Configuration Guide》：`--optimized` 与特定数据库的排除性警告、构建期选项明文持久化说明 —— https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.0/html/server_configuration_guide/db-
- 上游源码校验逻辑 `Picocli.validateBuildtime()`（抛 `PropertyException` 的位置） —— https://github.com/keycloak/keycloak/blob/main/quarkus/runtime/src/main/java/org/keycloak/quarkus/runtime/cli/Picocli.java
- 相关 issue：[#33902](https://github.com/keycloak/keycloak/issues/33902)（26.0 SPI 选项回归）、[#33683](https://github.com/keycloak/keycloak/issues/33683)、[#37918](https://github.com/keycloak/keycloak/issues/37918)（tracing 选项）、[#38249](https://github.com/keycloak/keycloak/issues/38249)（Operator + ENV 传递）、[#39450](https://github.com/keycloak/keycloak/issues/39450)（quarkus.properties 误判，已在 release/26.2 修复）

延伸阅读：[Keycloak 自定义 SPI 扩展的生产交付]({{< relref "docs/solution-blogs/keycloak-spi-extension-deployment" >}})（provider 注册表与镜像构建期的完整交付流程）、[Keycloak OpenTelemetry 追踪接入与 IAM 采样成本控制]({{< relref "docs/solution-blogs/keycloak-opentelemetry-tracing" >}})（`tracing-*` 选项的 build time 依据）、[Keycloak 生产数据库配置（PostgreSQL）]({{< relref "docs/solution-blogs/keycloak-postgresql-config" >}})、[Keycloak Prometheus 监控指标详解]({{< relref "docs/solution-blogs/keycloak-prometheus-metrics" >}})、[Keycloak 生产环境完整部署路线图]({{< relref "docs/solution-blogs/keycloak-production-roadmap" >}})、[Keycloak 生产部署与 Kubernetes 集成]({{< relref "docs/implementation/kubernetes-production" >}})
