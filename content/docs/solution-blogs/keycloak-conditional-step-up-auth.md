---
title: "Keycloak 条件认证与 Step-Up 实战 — 按角色/IP/场景分级认证 | IDaaS Book"
description: "Keycloak Authentication Flow 条件认证完整实战：基于角色、IP 地址、应用敏感度的分级 OTP/MFA 配置、Step-Up 认证流程、条件子流编排与排错"
date: 2026-07-11T00:00:00+08:00
lastmod: 2026-07-11T00:00:00+08:00
draft: false
weight: 11
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-conditional-step-up-auth"
toc: true
---

## 场景

你已经部署了 Keycloak 并开启了 OTP/TOTP，但遇到了实际问题：

- 管理员每次登录都要输 OTP，内网也不放过——体验太差；
- 普通用户从公司内网登录，你不想强制 OTP，但外网必须；
- 敏感操作（比如修改手机号、删除项目）需要二次认证，普通浏览不打扰。

这三类需求的核心诉求一致：**不是所有人都需要同一套认证流程，认证强度应该随场景动态调整**。Keycloak 的 Authentication Flow 框架就是为这个设计的。本文给出三种最常用的条件认证模式和完整配置步骤。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 按角色分级 MFA（管理员强制 OTP / 普通用户可选） | 所有用户一刀切——直接用 Browser Flow 配一个 REQUIRED OTP 即可，不用条件流 |
| 按网络位置决定是否要求 OTP（内网免/外网强制） | 硬件 Token / SMS 验证码——需要自定义 SPI 实现，不在本文范围 |
| 敏感操作 Step-Up（改密码/改手机号要求二次认证） | 纯粹的 FIDO2/WebAuthn 无密码登录——本系列另有 [MFA 专题]({{< relref "docs/core-capabilities/multi-factor-authentication" >}}) |
| Keycloak 17+ (Quarkus) 任意版本 | Keycloak 旧 WildFly 版本（UI 位置不同，但概念一致） |

## 前置知识：Authentication Flow 的执行语义

Keycloak 的 Authentication Flow 是一棵**执行树**，每个节点是一个 Authenticator，四种执行策略决定了整棵树的运行逻辑：

| 执行策略 | 语义 | 典型用途 |
|---------|------|----------|
| REQUIRED | 必须执行且成功，否则整个流失败 | 用户名密码表单 |
| ALTERNATIVE | 可选——同级有任意一个成功就跳过后续 | Cookie 复用（已有会话直接放行） |
| CONDITIONAL | 包裹一个子流，由子流内的 Condition 决定是否执行 | "如果用户是管理员 → 执行 OTP" |
| DISABLED | 不执行 | 临时关闭某个步骤 |

关键理解：**CONDITIONAL 本身不做决策，它只是一个「如果条件满足就进入子流」的开关**。真正的条件判断由子流内的 Condition Authenticator 完成——Keycloak 内置了 `Condition - User Role`、`Condition - User Configured`、`Condition - Level of Authentication` 等。

下面用三道实战题串起这三类条件。

## 模式一：基于角色的条件 OTP（管理员强制 / 普通用户跳过）

### 需求

管理员必须通过 OTP，普通用户只需用户名密码。

### 配置步骤

1. **进入 Authentication 配置**：Realm → Authentication → Flows → 选择 **Browser** 流。
2. **复制默认流**：点击右上角 `Action → Duplicate`，命名为 `Browser - Role-based OTP`。不要直接修改默认流——留一条回滚的后路。
3. **在 Forms 子流中添加条件 OTP**：

```
Browser - Role-based OTP
├── Cookie（ALTERNATIVE）
├── Identity Provider Redirector（ALTERNATIVE）
└── Forms（REQUIRED）
    ├── Username Password Form（REQUIRED）
    └── Role-based OTP（CONDITIONAL）        ← 新增
        ├── Condition - User Role（REQUIRED） ← 条件：拥有 admin 角色
        │   配置：role=admin
        └── OTP Form（REQUIRED）              ← OTP 输入
```

具体操作：
- 在 Forms 子流内，点击 `+` → `Add step` → 搜索 `Condition - User Role`，添加。
- 添加后点击该步骤的齿轮图标，在 `User role` 字段填入 `admin`（注意是 Realm Role 的 role name，不带 `ROLE_` 前缀）。
- 再添加 `OTP Form`，确保它和 `Condition - User Role` 在同一 CONDITIONAL 子流下。

操作方式：选中 Forms → `Actions → Add sub-flow` → 命名为 `Role-based OTP`，类型选 `conditional`。然后把两个步骤拖入该子流。

4. **绑定到 Browser Flow**：Realm → Authentication → Bindings → Browser Flow → 选择 `Browser - Role-based OTP`。

### 效果

- 用户 `admin`（拥有 `admin` Role）登录：用户名密码 → OTP → 进入应用 ✓
- 用户 `alice`（无 `admin` Role）登录：用户名密码 → 直接进入应用 ✓（条件不满足，CONDITIONAL 子流被跳过）

### 验证

```bash
# 1. 确认 admin 用户有 admin 角色
# Keycloak Admin Console → Users → admin → Role Mappings → 确认有 admin Realm Role

# 2. 测试 admin 登录（会被要求 OTP）
# 浏览器访问应用 → 用 admin 登录 → 应看到 OTP 页面

# 3. 测试普通用户登录（应跳过 OTP）
# 浏览器隐私窗口 → 用普通用户登录 → 应直接进入应用

# 4.（可选）查看认证日志确认条件触发
# Keycloak Admin Console → Events → 筛选 LOGIN 事件
# admin 的 DETAILS 中应包含 auth_method=otp
# 普通用户的 DETAILS 中 auth_method 为 password
```

## 模式二：基于 IP 地址的条件 OTP（内网免 / 外网强制）

### 需求

公司内网（`10.0.0.0/8`、`192.168.0.0/16`）登录免 OTP，外网或 VPN 登录强制 OTP。

### 前置要求

基于 IP 的条件需要**反向代理正确传递 `X-Forwarded-For`**。如果你的 Keycloak 前有 Nginx/Traefik/ALB，确保：

```nginx
# Nginx 示例
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

并且在 Keycloak 中启用代理信任：
```bash
# keycloak.conf 或环境变量
KC_PROXY_HEADERS=xforwarded
```

### 配置步骤

与模式一类似，区别在于 Condition 类型：

```
Browser - IP-based OTP
├── Cookie（ALTERNATIVE）
├── Identity Provider Redirector（ALTERNATIVE）
└── Forms（REQUIRED）
    ├── Username Password Form（REQUIRED）
    └── Network-based OTP（CONDITIONAL）
        ├── Condition - IP Address（REQUIRED）
        │   配置：cidr=10.0.0.0/8,192.168.0.0/16
        │   negate=ON                    ← 关键：取反，"不在内网时触发"
        └── OTP Form（REQUIRED）
```

`negate=ON` 是核心——意思是「当 IP **不在** 内网段时」这个子流才生效。如果不配 `negate`，语义反了（内网反而要 OTP）。

### 效果

| 登录位置 | IP | OTP 要求 |
|---------|-----|---------|
| 办公室有线网络 | 10.1.2.3 | ❌ 不需要 |
| 公司 WiFi | 192.168.1.100 | ❌ 不需要 |
| 咖啡馆 WiFi | 203.0.113.5 | ✅ 需要 |
| VPN 出口（假设 VPN IP 也在内网段） | 10.255.0.1 | 取决于网段配置 |

### 验证

```bash
# 1. 从内网机器登录 → 应跳过 OTP
curl -v -H "X-Forwarded-For: 10.1.2.3" https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth?... 

# 2. 从外网 IP 登录 → 应要求 OTP
curl -v -H "X-Forwarded-For: 203.0.113.5" https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth?...

# 3. 确认 Keycloak 能看到真实 IP
# Keycloak Admin Console → Sessions → 查看任意 Session → IP Address 字段
# 应显示客户端真实 IP，不是代理 IP
```

## 模式三：Step-Up 认证（敏感操作提升认证强度）

### 需求

用户浏览应用没问题，但要修改手机号、删除项目、导出数据等敏感操作时，要求重新认证（OTP 或 WebAuthn）。

### Step-Up 机制原理

Keycloak 通过 **Level of Authentication (LoA)** 来追踪当前会话已达到的认证级别。每个 Authenticator 在配置中有一个 `Authentication Level` 数值（默认 0），认证成功后用户会话的 LoA 被提升为该值。

默认级别参考：
- 密码认证：默认 level 1（不显示在 UI，但内部有效）
- OTP：默认 level 2
- WebAuthn：默认 level 3

Step-Up 的工作方式：在应用端发起认证请求时，附带 `acr_values`（Authentication Context Class Reference）参数，Keycloak 检查当前会话的 LoA 是否 ≥ 要求值。不满足则触发对应的认证子流。

### 配置步骤

**1. 配置 LoA 值**

为 OTP Form 设置 Authentication Level：
- Authentication → Flows → 进入你的 Browser Flow → 找到 `OTP Form`
- 点击齿轮 → `Authentication Level` 设为 `2`

**2. 创建 Step-Up 子流**

在 Browser Flow 中添加一个专门处理 Step-Up 的条件子流：

```
Browser Flow
├── ...（常规认证步骤）
└── Step-Up Handling（CONDITIONAL）
    ├── Condition - Level of Authentication（REQUIRED）
    │   配置：level=2
    └── OTP Form（REQUIRED）
        Authentication Level = 2
```

**3. 应用端配置**

在应用发起 OIDC 授权请求时，通过 `acr_values` 指定需要的 LoA：

```text
# 普通请求（不需要 Step-Up）
GET /authorize?
  response_type=code&
  client_id=myapp&
  redirect_uri=https://myapp.example.com/callback&
  scope=openid

# 敏感操作请求（要求 LoA ≥ 2，触发 Step-Up）
GET /authorize?
  response_type=code&
  client_id=myapp&
  redirect_uri=https://myapp.example.com/callback&
  scope=openid&
  acr_values=2
```

如果用户当前会话 LoA=1（仅密码），Keycloak 检测到 `acr_values=2` → 触发 Step-Up 子流 → 要求 OTP → 验证通过后 LoA 提升到 2 → 返回授权码。

### oauth2-proxy 中的配置

如果用 oauth2-proxy 做认证代理：

```yaml
# oauth2-proxy 配置
--login-url=https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth
--redeem-url=https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token
--oidc-extra-audience=myapp
# oauth2-proxy 默认不支持自定义 acr_values，需要额外配置
# 可在 nginx 层通过不同 location 分拆认证强度
```

### 效果

| 操作 | acr_values | LoA 要求 | 用户体验 |
|------|-----------|---------|---------|
| 浏览页面 | 不传 | 无 | 密码登录后直接进入 |
| 修改手机号 | `acr_values=2` | 2 | 要求 OTP 二次认证 |
| 删除项目 | `acr_values=3` | 3 | 要求 WebAuthn（如果配置） |

## 常见错误排错表

| 错误现象 | 根本原因 | 解决方案 |
|----------|----------|----------|
| 配置了 CONDITIONAL 但条件不生效 | 子流内的 Condition 设为 `ALTERNATIVE` 而非 `REQUIRED` | CONDITIONAL 子流内任何 Condition 都应设为 `REQUIRED` |
| IP 条件配反了——内网反而要 OTP | 忘记设置 `negate=ON` | `Condition - IP Address` 的 `negate` 字段设为 ON，语义是「不匹配时触发」 |
| OTP 步骤执行了但用户没注册 OTP | 用户没有配置 OTP 设备 | 在 CONDITIONAL 子流中额外加一个 `Condition - User Configured`（REQUIRED），只对已注册 OTP 的用户要求 |
| Step-Up 不触发 | 未在应用中传 `acr_values` | 检查授权请求 URL 是否包含 `acr_values=2`（或所需级别） |
| Step-Up 触发但页面空白 | `acr_values` 要求的值没有对应的 Authenticator 能提供 | 确保有 Authenticator 的 Authentication Level ≥ `acr_values` 要求的级别 |
| 修改 Flow 后登录不了了 | 改坏了默认 Browser Flow | **始终在 Duplicate 后的副本上修改**，Bindings 切回原 Browser Flow 即可恢复 |
| 用户始终看到 OTP 页面（即使条件不满足） | OTP Form 被设为 REQUIRED 而非放在 CONDITIONAL 子流内 | OTP Form 必须放在 CONDITIONAL 子流内；如果在 Forms 下直接设为 REQUIRED，所有用户都要执行 |

### 条件 OTP 的最佳实践模板

实际生产环境推荐的条件 OTP 组合子流（兼顾安全与体验）：

```
MFA Conditional（CONDITIONAL）
├── Condition - User Configured（REQUIRED） ← 只有已注册 OTP 的用户才进入后续判断
├── Condition - User Role（REQUIRED）       ← admin 角色
│   配置：role=admin
├── Condition - IP Address（REQUIRED）      ← 非内网 IP
│   配置：cidr=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
│   negate=ON
└── OTP Form（REQUIRED）
```

这个组合子的逻辑是：**只有当用户已注册 OTP、且是管理员、且不在内网时**，才要求 OTP。三个条件缺一不可——因为 CONDITIONAL 子流内的所有 REQUIRED 步骤都必须通过。

如果需求是「满足任意一个条件就要求 OTP」，把条件放在不同 CONDITIONAL 子流中，或每个条件单独判断。不要把所有条件塞进同一个 CONDITIONAL——这会导致必须全部满足的逻辑。

## 回滚方式

如果新 Flow 配置导致用户无法登录：

```bash
# 1. 在 Keycloak Admin Console 中
# Realm → Authentication → Bindings → Browser Flow → 切回 "browser"（默认）

# 2. 如果连 Admin Console 都进不去（Flow 彻底坏了），用 Admin CLI：
kcadm.sh update realms/myrealm -s 'browserFlow=browser'

# 3. 如果 Admin CLI 也不可用（admin 也被锁了）：
# 直接操作数据库（仅作为最后手段）
# UPDATE REALM_ATTRIBUTE SET VALUE = 'browser'
# WHERE REALM_ID = 'myrealm' AND NAME = 'browserFlow';
# 然后重启 Keycloak
```

**预防措施**：
- 永远在复制后的 Flow 上修改，默认 `browser` 流保持原样不动
- 测试新 Flow 时，先对一个测试 Realm 验证，确认无误后再应用到生产 Realm
- 保留一个「后门」管理员账号，不参与条件判断（用 `Condition - User Role` 排除它）

---

## 延伸阅读

- [Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}})：条件流配错可能导致重定向循环
- [MFA 多因素认证体系]({{< relref "docs/core-capabilities/multi-factor-authentication" >}})：OTP、TOTP、WebAuthn/FIDO2 完整对比
- [IAM 会话管理与 Token 生命周期]({{< relref "docs/advanced-topics/iam-session-management" >}})：LoA 与会话状态的配合
- [Keycloak 细粒度权限与授权策略实战]({{< relref "keycloak-fine-grained-authz" >}})：认证之后，授权怎么配
- [Keycloak 官方文档 — Server Administration Guide — Authentication Flows](https://www.keycloak.org/docs/latest/server_admin/#_authentication-flows)
