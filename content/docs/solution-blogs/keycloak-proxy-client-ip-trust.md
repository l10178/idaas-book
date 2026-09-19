---
title: "IAM：Keycloak 反向代理真实客户端 IP 与代理信任边界 | IDaaS Book"
description: "Keycloak 在反向代理后记录不到真实客户端 IP 的排查：proxy-headers 与 proxy-trusted-addresses 的默认行为、PROXY protocol 与 passthrough 的互斥约束、请求头清洗清单、验证命令与回滚顺序。"
date: 2026-09-19T22:00:00+08:00
lastmod: 2026-09-19T22:00:00+08:00
draft: false
weight: 78
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-proxy-client-ip-trust"
toc: true
---

## 场景

代理配好了、登录也能用，但下面三件事里至少有一件是坏的：

1. Admin Console → Events 里所有登录的 `ipAddress` 都是 `10.x` 的入口代理地址，事件导出到 SIEM 后「所有失败登录来自同一个 IP」，任何基于来源 IP 的告警、封禁、关联分析全部失效。
2. 渗透测试报告写了一条：伪造 `X-Forwarded-For` 后，Keycloak 认为请求来自内网地址。而配置里明明写了 `--proxy-headers=xforwarded`。
3. 换成 TLS passthrough 之后 IP 又变回代理地址；照着旧博客补上 `proxy=edge` 或 `proxy-headers`，服务直接起不来。

这三种症状指向同一个东西：**从 TCP 连接、到 HTTP 头、再到 Keycloak 的信任判定，客户端 IP 要穿过一整条链才成立，任何一环没有收口，IP 就是不可信的**。

## 适用 / 不适用

| 适合本文 | 不适合 |
|---------|--------|
| Keycloak 26.x（重新加密 / 边缘终结 / TLS passthrough）部署在 Nginx、ingress-nginx、HAProxy、Traefik、云 LB 之后 | 用 `start-dev` 本地跑、没有代理的开发和验证环境 |
| 事件日志、暴力破解告警、IP 白名单、审计合规里需要真实来源 IP | 想通过改 header 解决 issuer / redirect_uri 问题——那是 hostname v2 的范畴，见 [Keycloak Hostname v2 配置]({{< relref "keycloak-hostname-v2-config" >}}) |
| 需要在代理层做请求头清洗与路径白名单 | 期望 Keycloak 自己识别「哪些代理可信」——Keycloak 只能按配置的地址列表判定，网络层收口必须由你完成 |

## 先分清三层问题

同一个 `X-Forwarded-*` 头被三个机制读取，坏掉时的症状完全不同，混在一起排查一定走弯路。

| 层次 | 由谁决定 | 症状 | 配置项 |
|------|---------|------|--------|
| URL / issuer 生成 | hostname v2 + Realm Frontend URL | discovery 的 `issuer` 是内网地址、邮件链接指回内网、oauth2-proxy 报 issuer/audience 不匹配 | `--hostname`、`--hostname-backchannel-dynamic`、`proxy-headers`（仅参与 origin/host 判定） |
| 客户端 IP 解析 | Keycloak 读取 `Forwarded` / `X-Forwarded-*` | 事件 `ipAddress`、审计日志、登录失败记录里的来源是代理地址；IP 白名单形同虚设 | `--proxy-headers`、`--proxy-protocol-enabled` |
| 信任边界 | 网络可达范围 + 代理是否覆盖写入 + 地址白名单 | 伪造头生效、绕过代理直连成功、`proxy-trusted-addresses` 写太宽 | 网络策略 / 安全组、代理的 header 覆盖与清洗、`--proxy-trusted-addresses` |

一个具体判据：**改 `proxy-headers` 不会修好 issuer，改 `hostname` 也不会修好 `ipAddress`**。前者是 URL 生成，后者是来源地址解析。

## 决策表：按拓扑选配置

官方反向代理文档把拓扑分成三类，客户端 IP 的取法各不相同：

| 拓扑 | 代理到 Keycloak 的连接 | 客户端 IP 来源 | Keycloak 侧 |
|------|---------------------|--------------|------------|
| 重新加密（re-encrypt，生产最常见） | TLS 到 Keycloak | 代理覆盖写入的 `Forwarded` / `X-Forwarded-*` | `--proxy-headers=xforwarded` 或 `forwarded`，并配 `--proxy-trusted-addresses` |
| 边缘终结（edge，代理到 Keycloak 明文） | HTTP | 同上 | 同上；另外必须 `--http-enabled=true` |
| TLS passthrough | 原始 TLS 透传，代理看不到 HTTP | HAProxy `send-proxy-v2` 等 PROXY protocol 头 | `--proxy-protocol-enabled=true`；**禁止** `--proxy-headers` |
| 无代理 | 直连 | TCP 连接地址 | 两个都保持默认关闭 |

`--proxy-headers` 与 `--proxy-protocol-enabled` **互斥**，同时设置是配置错误而不是「更保险」。passthrough 下设置 `--proxy-headers` 尤其危险：代理无法改写加密流量里的头，任何头都来自客户端，Keycloak 会直接采信。

## 最小配置

### 1. Keycloak 侧

裸机 / 容器参数：

```bash
bin/kc.sh start \
  --hostname=https://sso.example.com \
  --proxy-headers=xforwarded \
  --proxy-trusted-addresses=10.0.10.0/24
```

Kubernetes 环境变量：

```yaml
env:
  - name: KC_PROXY_HEADERS
    value: xforwarded
  - name: KC_PROXY_TRUSTED_ADDRESSES
    value: "10.0.10.0/24"     # 入口代理所在网段（Pod CIDR / LB 地址），不要写成 0.0.0.0/0
```

用 Keycloak Operator 时，`proxy-headers` / `proxy-trusted-addresses` 若未在 CRD 里作为一等字段暴露，可以通过 `spec.additionalOptions` 透传（官方 Advanced configuration 明确该字段接受任意服务器选项）；改完用 `kubectl -n keycloak rollout status statefulset/keycloak`（或 Deployment）确认滚动完成再验证。

`--proxy-trusted-addresses` 的语义需要读清楚：**设置了列表，则来自列表之外地址的代理头会被忽略；不设置，则所有地址都被信任**。这不是「默认安全」，而是「默认谁递头都认」。上游源码里这条描述就在 `ProxyOptions.PROXY_TRUSTED_ADDRESSES` 上，默认值为空列表。

K8s 里选网段有一条纪律：按 Pod CIDR 或入口组件所在命名空间精确到最小 CIDR。写 `10.0.0.0/8` 会把工作负载网段、甚至在集群里落地的攻击者一起圈进「可信」范围——那不是配置精度问题，而是信任边界问题。

### 2. 重新加密拓扑：代理侧必须做到「覆盖写入」

Keycloak 只负责解析，**「这些头是不是真的」由代理保证**。官方文档的要求是：代理要覆盖写入（overwrite）这些头，而不是在客户端值后面追加。

**ingress-nginx** 的两个开关决定了行为，默认值其实是安全的一侧：

| 配置 | 默认 | 语义（官方原文含义） |
|------|------|-------------------|
| `use-forwarded-headers` | `false` | 忽略客户端传入的 `X-Forwarded-*`，用 nginx 自己看到的请求信息填充。只有 nginx 前面还有一层可信 L7 代理时才设为 `true` |
| `compute-full-forwarded-for` | `false` | 默认「替换」而不是「追加」；设为 `true` 后改为把远端地址追加到原值后面，此时**上游应用要自己按可信代理列表决定取哪一段** |

所以最常见的 K8s 事故不是「头被伪造」，而是两种配置漂移：

- 前面其实没有 L7 代理，却把 `use-forwarded-headers` 设成了 `true`——客户端直接伪造 IP；
- 前面有 L4（TCP）LB，LB 不改包里的源地址，所有请求在 nginx 看来都来自 LB 地址，事件里全部收敛成同一个 IP。这种情况要在 nginx 侧启用 realip 模块并提供可信来源网段（`enable-real-ip` + `proxy-real-ip-cidr`），而不是去动 Keycloak。

**原生 Nginx** 有个必须知道的细节：`$proxy_add_x_forwarded_for` 的定义是「客户端请求头里已有的 `X-Forwarded-For` 值 + 追加 `$remote_addr`」，即**追加语义**，客户端伪造的值会留在最前面。单层可信代理下应当覆盖写入：

```nginx
location / {
    proxy_pass http://keycloak:8080;

    # 覆盖写入：不要用 $proxy_add_x_forwarded_for
    proxy_set_header X-Forwarded-For   $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Port  $server_port;

    # Keycloak 不读取 X-Real-IP，不要指望用它兜底；
    # 客户端传入的同名头应当被丢弃，而不是转发。
}
```

`X-Forwarded-Port` 建议显式写出：26.2 起，若 `X-Forwarded-Host` 不带端口，推导出的 URL 里也不会带端口，旧版本「自动补 8443」的行为不再成立。

**HAProxy** 可以直接照 26.7 官方新增的蓝图，核心是先用 `http-request del-header` 清掉客户端传入的代理身份头，再由 HAProxy 生成自己的值：

```haproxy
frontend https_front
    bind *:8443 ssl crt /path/to/haproxy-external-certificate
    mode http

    # 1) 清掉客户端可能伪造的代理身份头
    http-request del-header Forwarded
    http-request del-header x-forwarded-.* -m reg
    http-request del-header x-original-.* -m reg
    http-request del-header x-real-ip

    default_backend keycloak_back

backend keycloak_back
    mode http
    balance roundrobin
    option forwarded host by by_port for    # 生成 RFC 7239 Forwarded，携带真实客户端信息（HAProxy 2.8+）
    option httpchk GET /health/ready
    http-check expect status 200
    server keycloak1 keycloak1:8443 ssl verify required check port 9000 check-ssl verify none inter 5s fall 3
```

`option forwarded` 是 HAProxy 2.8 引入的指令；更早版本用 `option forwardfor` 时，同样要保留前面的 `del-header`，否则客户端自带的值会和你追加的值一起进入 Keycloak。

### 3. passthrough 拓扑：PROXY protocol 是唯一出路

代理看不到 HTTP，就没有「改写头」这个选项。官方给的路径是 PROXY protocol：代理在 TCP 流最前面插入原始连接信息，Keycloak 用 `--proxy-protocol-enabled=true` 读取。

```bash
bin/kc.sh start --proxy-protocol-enabled true --health-enabled true --shutdown-delay=30s
```

HAProxy 侧对应 `send-proxy-v2`（`send-proxy` / `send-proxy-v2` 随 HAProxy 版本而定，按所用版本手册确认）。

两个必须一起接受的代价：

1. **PROXY protocol 头既不加密也不签名**，可以伪造、篡改、泄露。它的安全性完全依赖网络层——只有代理能连 Keycloak 的 8443，绕不过去。
2. **优雅关闭窗口要对齐健康检查**。官方 HAProxy passthrough 蓝图的健康检查是 `inter 5s fall 3`，也就是说代理最多需要 15 秒才会把正在关闭的实例摘掉，而 26.6 起 Keycloak 默认 `shutdown-delay` / `shutdown-timeout` 各只有 1 秒。蓝图给的取值是 `--shutdown-delay=30s`——比检测窗口长，才不会在滚动更新时把在途登录打断。

## 请求头清洗清单

官方反向代理文档给了一份「哪些头必须被清洗」的清单。它假设代理前面只有一层，且这一层不是从另一层可信代理接收流量——如果你的拓扑是多层代理，清洗责任要在最外层完成，内层改为信任上游网段。

| 头 | 类别 | 不清洗的风险 |
|----|------|------------|
| `Forwarded`、`X-Forwarded-For/Proto/Host/Port/Prefix` | 代理身份 | 伪造 IP、协议、主机，影响访问控制与审计。**覆盖写入**，不要只是删掉 |
| `X-Original-Forwarded-For`、`X-Real-IP` | 代理身份 | 某些代理/应用会采信的变体，可绕过基于 IP 的限制 |
| `X-Original-URL`、`X-Original-Method` | 代理身份 | 影响基于路径的鉴权判定（认证子请求机制常用） |
| `X-Forwarded-Access-Token` | 代理身份 | 部分 OAuth2 代理会注入，可被伪造用于注入令牌 |
| `X-Forwarded-Tls-Client-Cert`、`X-Forwarded-Tls-Client-Cert-Info` | 客户端证书 | 伪造证书头即伪造客户端身份 |
| `traceparent`、`tracestate` | 分布式追踪 | 污染追踪后端、映射内网服务依赖 |
| `baggage` | 分布式追踪 | 向下游注入任意键值对 |
| `b3`、`x-b3-*` | 分布式追踪 | 同上，并放大可观测性成本 |

三种实现方式，按你的入口组件选：

- **HAProxy**：`http-request del-header <name>`，支持 `-m reg` 正则批量匹配（官方蓝图写法）。
- **Traefik**：`customRequestHeaders` 里把不需要的头显式置为空字符串来删除；Traefik 不支持正则匹配，只能逐条列出。
- **Nginx**：原生 `proxy_set_header` 只能改不能删（写成空值仍会发送一个空头）；真正删除需要 headers-more 模块的 `more_clear_input_headers`。托管 ingress 通常不给改 nginx.conf，那就依赖 ingress-nginx 的默认行为（忽略客户端传入的 `X-Forwarded-*`），并在最前面放一层能删头的组件。

## 验证

### 第一步：让事件真的把 IP 记下来

事件没开的时候，你排查的是「没有数据」而不是「数据不对」。Realm Settings → Events → User events settings 打开 Save events，并把 LOGIN / LOGIN_ERROR 加入保存类型。然后用 Admin REST API 回读 `ipAddress`（该字段来自 `EventRepresentation`）：

```bash
TOKEN=$(curl -s -d "client_id=admin-cli" -d "grant_type=password" \
  -d "username=admin" -d "password=***" \
  https://sso.example.com/realms/master/protocol/openid-connect/token | jq -r .access_token)

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://sso.example.com/admin/realms/app/events?type=LOGIN_ERROR&first=0&max=5" \
  | jq '.[] | {time, type, ipAddress, error}'
```

从浏览器所在机器触发一次失败登录，再执行上面的查询。`ipAddress` 应该是出口公网地址，而不是 `10.x` 的代理地址。

### 第二步：伪造头测试（决定信任边界是否闭合）

在集群内（或任何能绕过入口代理直连 Keycloak Service 的位置）发一个带伪造头的请求，看事件里的 `ipAddress` 是否变成伪造值：

```bash
kubectl -n keycloak port-forward svc/keycloak 8080:8080 &
# 触发一次会产生事件、但不影响生产的请求（例如错误的客户端凭据换取 token）
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'X-Forwarded-For: 203.0.113.7' \
  -H 'X-Real-IP: 203.0.113.7' \
  -d 'grant_type=client_credentials&client_id=probe&client_secret=wrong' \
  http://127.0.0.1:8080/realms/app/protocol/openid-connect/token
```

然后回到第一步的查询。判定规则很简单：

- 事件里出现 `203.0.113.7` → 信任边界**没有闭合**：要么网络层允许绕过代理，要么 `proxy-trusted-addresses` 太宽（或根本没设）。
- 事件里是代理地址或真实地址 → 说明该路径已被收口，继续用同样方式验证其他可达路径（Service、NodePort、Pod IP、另一个命名空间的入口）。

如果这个测试在当前环境做不了，退一步至少完成两件事：确认代理配置是**覆盖写入**而不是追加，确认只有代理组件能访问 Keycloak 的 8443/8080（`9000` 管理端口不要代理出去，健康检查与指标应该直连）。

### 第三步：确认改动在滚动更新后仍生效

K8s 上改 `KC_PROXY_TRUSTED_ADDRESSES` 后，等 `rollout status` 完成，再跑一次第一步。Redis/Infinispan 集群里多副本配置不一致时，会出现「一部分节点 IP 对、一部分不对」——只抽查一个 Pod 不足以结论，按副本逐个确认。

## 常见错误症状表

| 症状 | 根因 | 处理 |
|------|------|------|
| 经代理访问时出现 `403 Forbidden`，且集中在做 origin 校验的请求上 | 非 passthrough 拓扑没有设置 `--proxy-headers` | 按拓扑加 `--proxy-headers=xforwarded`（或 `forwarded`）；这是官方明确写出的默认行为 |
| 事件 `ipAddress` 全部是代理地址 | 代理没写转发头 / Keycloak 没开 `proxy-headers` / 开了但代理地址不在 `proxy-trusted-addresses` 内被忽略 | 先看代理配置是否覆盖写入，再核对白名单是否包含代理实际源地址 |
| 伪造 `X-Forwarded-For` 生效 | 网络层可绕过代理，且 `proxy-trusted-addresses` 未设置（默认信任所有地址） | 补白名单 + 收敛网络可达范围；两件事都要做，只做一件仍有缺口 |
| 启动报配置错误 | `proxy-headers` 与 `proxy-protocol-enabled` 同时设置 | 按拓扑二选一 |
| passthrough 下 IP 是代理地址 | 只做了透传，没有开 PROXY protocol | 代理开启 `send-proxy-v2` 类指令 + Keycloak `--proxy-protocol-enabled=true` |
| URL 少端口、回调或 issuer 出现 `https://host/` | 26.2 起 `X-Forwarded-Host` 不带端口时，推导结果也不带端口 | 代理显式设置 `X-Forwarded-Port`；或直接固定完整的 `--hostname` |
| 通过头转发客户端证书的方式在代理后失效 | 26.2 起内置 X509 客户端证书查找会遵循 `proxy-trusted-addresses`；代理不可信时头里的证书不再被处理 | 把代理地址加入白名单；26.7 起该场景还要求 truststore / mTLS 配置正确，HAProxy 侧改用 `--spi-x509cert-lookup--haproxy--ssl-cert-chain`（`ssl-cert-chain-prefix` 已弃用） |
| 滚动更新期间偶发登录中断 | 健康检查窗口长于 `shutdown-delay` | 把 `--shutdown-delay` 提到覆盖代理检测窗口（官方 passthrough 蓝图用 30s） |
| 部分 Pod 的 IP 正确、部分不对 | 多副本配置不一致 | 逐副本核对参数，不要只抽查一个实例 |

## 回滚

这三组配置都不涉及数据库结构变更，回滚就是改参数、重启，但顺序和取值要小心：

1. **参数一起回滚，别回滚一半**。`proxy-headers`、`proxy-protocol-enabled`、`proxy-trusted-addresses` 属于同一个信任决策，改一半会得到一个「看起来在跑、实际谁都能伪造」的中间态。
2. **清空 `proxy-trusted-addresses` 不是中性状态**。留空表示信任所有地址。回滚时应当保留代理网段，而不是删掉这一行。
3. **passthrough ↔ 重新加密互相切换时，代理与 Keycloak 要同时改**，否则就是连接被拒或直接启动失败，登录会整体中断。放在维护窗口里做，先只切一个实例验证再全量。
4. **网络层策略（NetworkPolicy / 安全组）最后确认一遍**。它是最容易被「临时放开排障」然后忘掉的一环，也是唯一能兜住 IP 伪造的一环。

## IAM FAQ

### IAM 平台把 Keycloak 放在反向代理后面，为什么事件里的客户端 IP 是代理地址？

Keycloak 只有在 `--proxy-headers` 设置后才会解析转发头；未设置时它记录的是与它建立 TCP 连接的对端地址，也就是代理。这不是 bug，而是默认值的选择。设 `--proxy-headers=xforwarded`（或 `forwarded`）后 IP 才来自头部，因此**代理必须覆盖写入这些头**，否则记录的就是客户端伪造的值。

### IAM 只设 `proxy-headers` 不设 `proxy-trusted-addresses` 会怎样？

默认「所有地址都受信任」。含义是：任何能直连 Keycloak 的请求，只要带上 `X-Forwarded-For`，Keycloak 就会采信。所以「设了 `proxy-headers` 就安全了」是错的——真正的收口是网络层只有代理可达，`proxy-trusted-addresses` 是第二道（官方也说明它是弱保护，因为 IP 本身可伪造）。

### IAM 用 TLS passthrough 时怎么拿到真实客户端 IP？

只能靠 PROXY protocol：代理发 `send-proxy-v2` 类头，Keycloak 用 `--proxy-protocol-enabled=true` 接收，且此时不能设 `--proxy-headers`（两者互斥）。这个头不加密、不签名，必须配合网络层限制可达范围；同时把 `--shutdown-delay` 调到不小于代理健康检查的检测窗口。

## 相关阅读

- [Keycloak Hostname v2 配置与 v1 选项迁移]({{< relref "keycloak-hostname-v2-config" >}})：issuer / 回调 / 邮件链接这些「URL 生成」问题与本文的「来源地址解析」问题的分工
- [Keycloak 审计日志配置与 IAM 合规实践]({{< relref "keycloak-audit-logging-compliance" >}})：事件保存、导出到 SIEM、合规对齐——IP 错了这里就全错
- [Keycloak 暴力破解检测]({{< relref "docs/keycloak/security-features/brute-force-detection/index" >}})：锁定策略本身，以及它与来源 IP 记录的关系
- [Keycloak 生产环境完整部署路线图]({{< relref "keycloak-production-roadmap" >}})：代理与 TLS 在部署顺序中的位置
- [Kubernetes 生产部署]({{< relref "../implementation/kubernetes-production" >}})：Ingress 终结 TLS 与 NetworkPolicy 的完整清单
- [IAM 架构设计指南]({{< relref "docs/advanced-topics/iam-architecture-design" >}})：生产启动参数与代理信任边界在整体架构中的位置

### 关键来源

- [Keycloak 官方文档 — Configuring a reverse proxy](https://www.keycloak.org/server/reverseproxy)：三种 TLS 终结模式、`proxy-headers` 的 403 行为、Trusted Proxies、请求头清洗清单、PROXY protocol 与 `--proxy-headers` 互斥、9000 端口不应暴露
- [Keycloak 官方蓝图 — HAProxy with TLS reencrypt](https://www.keycloak.org/server/haproxy-reencrypt)：`http-request del-header` 清洗写法、`option forwarded`、健康检查与 `--shutdown-delay` 的关系
- [Keycloak 官方蓝图 — HAProxy with TLS passthrough](https://www.keycloak.org/server/haproxy-passthrough)：passthrough 下的 shutdown-delay 取值依据
- `quarkus/config-api/src/main/java/org/keycloak/config/ProxyOptions.java`（Keycloak 主分支）：`proxy-trusted-addresses` 默认空列表且「未设置时信任所有地址」、`proxy-protocol-enabled` 与 `proxy-headers` 互斥
- [Keycloak 26.0.0 升级说明 — Proxy option removed](https://www.keycloak.org/docs/latest/upgrading/)：`proxy` 选项自 24 弃用、26.0.0 移除，Operator 不再默认 `proxy=passthrough`
- [Keycloak 26.2.0 升级说明](https://www.keycloak.org/docs/latest/upgrading/)：`proxy-trusted-addresses` 对内置 X509 客户端证书查找生效；`X-Forwarded-Host` 端口行为变更
- [Keycloak 26.6.0 / 26.7.0 升级说明](https://www.keycloak.org/docs/latest/upgrading/)：`X-Forwarded-Prefix` 支持、默认 shutdown delay/timeout、HAProxy 证书链参数变更
- [nginx 官方文档 — ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)：`$proxy_add_x_forwarded_for` 的追加语义
- [ingress-nginx 官方文档 — ConfigMap](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/configmap/)：`use-forwarded-headers`、`compute-full-forwarded-for`、`enable-real-ip` 语义
- [HAProxy 2.8 发布说明](https://www.haproxy.com/blog/announcing-haproxy-2-8)：`option forwarded` 引入版本
