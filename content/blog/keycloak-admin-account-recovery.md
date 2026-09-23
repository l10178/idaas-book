---
title: "Keycloak 管理员账号进不去：bootstrap-admin 恢复与 26.x 变量变更"
description: "Keycloak 管理员无法登录的三类原因与恢复步骤：bootstrap-admin user/service 命令、KC_BOOTSTRAP_ADMIN_* 只在 master realm 不存在时生效、执行前必须停所有节点并与服务器用同一套 db 选项，以及 OTP 凭据丢失时用临时服务账号清除凭据。"
summary: "给一个已经跑起来的 Keycloak 加 KC_BOOTSTRAP_ADMIN_PASSWORD 不会重置管理员密码——这些选项只在 master realm 不存在时才创建账号。恢复要用 kc.sh bootstrap-admin 命令：先停所有节点，db 选项与服务器保持一致，已优化构建加 --optimized；首次部署在反代后面点不出来创建入口，是 Welcome Page 的本机访问检查在起作用。"
date: 2026-09-23T21:50:00+08:00
lastmod: 2026-09-23T21:50:00+08:00
draft: false
weight: 35
images: []
categories: ["Keycloak"]
tags: ["keycloak", "bootstrap-admin", "admin-recovery", "initial-admin", "kcadm", "troubleshooting"]
contributors: []
pinned: false
homepage: false
seo:
  title: "Keycloak 管理员无法登录：bootstrap-admin 恢复与变量变更"
  description: "Keycloak 管理员进不去的三类原因与恢复步骤：bootstrap-admin user/service 命令、KC_BOOTSTRAP_ADMIN_* 只在 master realm 不存在时生效、停节点与 db 选项前提、OTP 丢失时清除凭据。"
  canonical: ""
  noindex: false
---

## 场景

「进不去管理控制台」在 Keycloak 里至少有四种完全不同的成因，处理路线也完全不同。先看清是哪一种，再动手：

| 症状 | 根因分支 | 走哪条路线 |
|------|---------|-----------|
| 首次部署，打开管理台没有创建管理员的入口，或提交创建请求直接返回 400 | master realm 无管理员，且 Welcome Page 判定当前访问不是本机 | 环境变量或 `bootstrap-admin` 命令 |
| 已经跑了一段时间，管理员密码/OTP 丢失，或管理员账号被误删 | master realm 已存在，管理员访问丢失 | `bootstrap-admin` 命令 |
| 密码输对了，却卡在 OTP、passwordless 等强化认证步骤 | 强化认证凭据丢失，密码不再是唯一门槛 | 临时服务账号 + `kcadm` 清除凭据 |
| 短时间多次失败后被拒绝登录 | 暴力破解检测临时锁定，不是账号丢失 | 等锁定窗口，不要在锁定期间继续重试 |

本文只处理前三种「确实进不去」的情况。第四种先确认 realm 级 Brute Force Detection 的配置，它不是恢复管理员访问的入口。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| `kc.sh` 发行版（zip/tar、容器镜像），26.x 与 25.x | 用远端数据库但拿不到数据库凭据——`bootstrap-admin` 必须能连库 |
| Kubernetes / 容器部署（有停服窗口） | 要求「不停服、在线重置管理员密码」——Keycloak 没有这个能力 |
| master realm 管理员访问丢失 | 普通 realm 的业务用户忘记密码（那是用户自助重置流程） |
| 想恢复被 OTP 挡住的 realm 管理员 | 服务器本身起不来（那是启动/数据库故障，先解决启动问题） |

## 前提：`KC_BOOTSTRAP_ADMIN_*` 不会重置已有管理员

这是中文资料里错得最多的一点，也是最常见的「我按教程设了变量但没用」的来源。

Keycloak 官方指南 [Bootstrapping and recovering an admin account](https://www.keycloak.org/server/bootstrap-admin-recovery) 对启动参数的描述是：这些账号 **will be created only during the initial start of the Keycloak server when the master realm doesn't exist yet**，并且总是创建在 `master` realm。换句话说：

- `--bootstrap-admin-username/--bootstrap-admin-password`（环境变量 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`）只在**第一次启动、master realm 还不存在**时生效；
- 一旦 master realm 存在，这些参数就不再创建账号，更不会覆盖现有管理员的密码；
- 官方明确写了：**For recovering lost admin access, use the dedicated command**，也就是 `bootstrap-admin` 命令。

另外两个容易踩的历史包袱：

- 升级指南「Migrating to 26.0.0 → Admin Bootstrapping and Recovery」写明：环境变量 `KEYCLOAK_ADMIN` 和 `KEYCLOAK_ADMIN_PASSWORD` 自 26.0.0 起已弃用，应改用 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`。本文写作时的最新发行版是 **26.7.4**（2026-09-16），仍在用旧变量的部署应该顺手改掉，它同时也是「配置看起来对、行为却对不上」这类问题的常见噪声来源。
- 如果你先用 `bootstrap-admin` 命令建了临时管理员，之后首次启动时再配置启动参数来创建管理员，**启动参数会被忽略**——因为 master realm 在执行命令时已经被创建了。

## 恢复步骤：master realm 已存在，但管理员进不去

### 第一步：停掉所有节点

官方前提写得很直接：**all the Keycloak nodes need to be stopped prior to using this command**。命令会直接写数据库（必要时创建 master realm），集群里还有节点在跑的时候执行，状态不可预期。

Kubernetes 下的顺序（本书建议的做法）：把工作负载副本降到 0 → 确认没有 Pod 残留 → 再用一次性 Job/容器执行恢复命令 → 恢复副本数。Operator 部署则把 CR 的 `spec.instances` 改成 `0`，等 Pod 全部退出。

### 第二步：执行 `bootstrap-admin user`

命令必须能和服务器连到**同一个数据库**。官方建议使用与服务器启动**相同的选项**（文档原文举例就是 `db` 选项）。因为 26.1.0 起，生产 profile 下 `build`、未优化的 `start`，以及 `import`、`export`、`bootstrap-admin` 这类非服务端命令都要求显式指定数据库，所以最省事的做法是直接复用服务器的那一套环境变量：

```bash
# 宿主机 / zip 发行版：db 配置走与服务器相同的环境变量
export KC_DB=postgres
export KC_DB_URL=jdbc:postgresql://postgres:5432/keycloak
export KC_DB_USERNAME=keycloak
export KC_DB_PASSWORD='<与服务器一致的密码>'

bin/kc.sh bootstrap-admin user --username tmpadm --password:env TMP_ADMIN_PW --optimized
```

容器化的等价做法是起一个用完即弃的容器（`--optimized` 复用镜像里已有的构建，避免在容器里再跑一遍 build）：

```bash
docker run --rm \
  -e KC_DB=postgres \
  -e KC_DB_URL=jdbc:postgresql://postgres:5432/keycloak \
  -e KC_DB_USERNAME=keycloak \
  -e KC_DB_PASSWORD='<与服务器一致的密码>' \
  -e TMP_ADMIN_PW='<一次性密码>' \
  quay.io/keycloak/keycloak:26.7.4 \
  bootstrap-admin user --username tmpadm --password:env TMP_ADMIN_PW --optimized
```

几个来自官方文档、但很容易被忽略的细节：

- **`--optimized` 不是可选项，而是取决于你的构建方式。** 用 `kc.sh build` 做过优化构建（官方镜像就是）时加 `--optimized`，让命令跳过构建检查；不加的话，官方 NOTE 提醒命令**可能隐式创建或更新优化构建**——如果你在同一台机器上跑命令和服务实例，这会影响服务器的下一次启动。
- **用户名可以省略。** 省略时用户名默认是 `temp-admin`；不传参数也没有对应环境变量时，命令会交互式提示输入。
- **`--no-prompt` 会让缺失的密码直接变成失败。** 用 `--no-prompt` 但没有提供密码（参数或环境变量）时，命令会报缺少 password 参数并以错误退出，不会再回退到交互输入。适合脚本化的写法是 `bootstrap-admin user --password:env TMP_ADMIN_PW --no-prompt`，即用默认用户名加环境变量密码。
- **临时账号不会自动清理。** 官方明确定义这类账号是 *temporary*：只在完成「取得长期管理员访问」所需的这段时间内存在，之后**需要手工删除**。管理控制台的警告横幅、标签和日志都会提示它是临时账号——看到这类提示不要忽略。

### 第三步：登录、建正式管理员、删临时账号

1. 用 `tmpadm`（或默认的 `temp-admin`）登录 `<外部地址>/admin`，确认控制台顶部出现临时账号的提示。
2. 在 `master` realm 里创建长期管理员：Users → Create user → Credentials 设置密码 → Role mapping 赋予 `admin` 角色。server admin 必须在 `master` realm 内，realm 级管理员管不到服务级操作。
3. 顺手把原管理员账号的凭据重置掉（Users → Credentials → Reset password）：临时账号是**另一个账号**，原管理员的密码不会因为这次恢复而变化，如果它的密码已经泄露或不可控，必须在这里显式重置。
4. 删除临时账号 `tmpadm`，并确认它不再出现在 `master` realm 的用户列表里。

### 强化认证把管理员挡在外面时：改用临时服务账号

如果 realm 强制了 OTP / passwordless 等强化认证，光有密码也进不去。官方为此提供的路径是创建**临时服务账号**，再通过 Admin CLI 直接删除挡路的凭据：

```bash
# 1) 创建临时 admin 服务账号（客户端密钥必须来自环境变量）
bin/kc.sh bootstrap-admin service \
  --client-id tmpclient --client-secret:env TMP_CLIENT_SECRET --optimized

# 2) 用服务账号认证到 master realm
bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master \
  --client tmpclient --secret '<TMP_CLIENT_SECRET>'

# 3) 取出该管理员的凭据列表，找到 type 为 otp 的那一条的 credentialId
bin/kcadm.sh get users/{userId}/credentials -r master

# 4) 删除强化认证凭据，之后即可用密码登录
bin/kcadm.sh delete users/{userId}/credentials/{credentialId} -r master
```

恢复访问后立刻做两件事：给长期管理员重新注册强化认证凭据，删除临时的 service client（它同样不会自动清理，且带着管理员权限）。

## 首次部署：为什么首页建不了管理员

新部署常见的一幕是：本机 `docker run` 能通过首页创建管理员，部署到 Kubernetes 或反向代理后面就不行——首页根本不出现创建入口，或者提交后返回 400。

代码里能直接看到原因。`WelcomeResource` 的创建用户分支在写入之前先做本机判断：非本机请求会记录 `rejectedNonLocalAttemptToCreateInitialUser` 日志并返回 400；而 `isLocal` 的判定逻辑里有一条关键规则——**当既没有配置 `proxy-headers`、也没有启用 `proxy-protocol`，而访问是 https 且不是 dev 模式时，一律不认为是本机访问**。反向代理后面用 `https://idaas.example.com/` 打开首页的情况正好命中这条：Keycloak 无法判断请求是否真的来自本机，于是直接拒绝。首页模板里的提示文案也指向同一出口——`or use a bootstrap-admin command`。

所以生产部署不要指望首页：

- 首次启动就配上 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`（仅首次生效），或者干脆先执行 `bootstrap-admin user`；
- 用完把这两个变量从 Deployment/Secret 里撤掉——它们是明文凭据，留着还容易让人误以为能重置密码；
- 另外注意 26.4.0 的变更：Welcome Page 创建的已经是**正式管理员**，不再是临时账号（源码里对应的 `isTemporary` 标记为 `false`）。老版本上「首页建的管理员必须重新创建」的经验在新版本不成立。

## 验证

- 登录 `<外部地址>/admin` 成功，且能看到临时账号的提示标识。
- 临时账号确实能用 Admin CLI 读到：`bin/kcadm.sh get users -r master -q username=tmpadm`（先按上面的方式 `config credentials`）。
- 恢复完成后复查三件事：临时用户已删除、临时 service client 已删除、长期管理员能独立登录且不依赖临时账号。

## 常见错误

| 现象 | 根因 | 处理 |
|------|------|------|
| 给运行中的集群加了 `KC_BOOTSTRAP_ADMIN_PASSWORD`，密码还是旧的 | 这些选项只在 master realm 不存在时创建账号 | 用 `bootstrap-admin` 命令恢复 |
| 先执行了 `bootstrap-admin`，之后启动参数里的 bootstrap 管理员没出现 | 命令已创建 master realm，启动时的 bootstrap 账号选项被忽略 | 只保留一条路线，重复配置没有叠加效果 |
| 命令执行成功，但用新账号登录目标环境失败 | 命令连到了默认数据库，不是服务器实际使用的库 | db 选项与服务器启动配置保持一致 |
| 集群中只停了部分节点就执行 | 官方要求所有节点停止后再执行 | 全部停掉（K8s 先降到 0 副本），再执行 |
| `--no-prompt` 执行后直接报缺少 password 参数 | 该参数下没有交互回退 | 补 `--password:env <VAR>` 或 `--password` |
| 首页创建管理员返回 400，日志有 `rejectedNonLocalAttemptToCreateInitialUser` | 未配置 `proxy-headers`/`proxy-protocol` 时 https 访问不算本机 | 走 bootstrap 路线，不要绕首页 |
| 执行恢复命令后服务器下次启动变慢或出现构建相关提示 | 未加 `--optimized`，命令隐式重建了优化构建 | 加 `--optimized`，或改用一次性容器执行 |
| 临时账号长期留在生产环境 | 临时账号和临时 service client 都不会自动删除 | 恢复后立即手工删除并记录 |

## 回滚与善后

1. **执行前备份数据库。** `bootstrap-admin` 会写库，出问题时的回滚点就是恢复副本之前的 `pg_dump`（备份与恢复流程见 [Keycloak 高可用与灾难恢复]({{< relref "keycloak-ha-dr" >}})）。
2. **临时凭据用完即删。** 临时管理员用户、临时 service client 都要删；同时轮换启动配置里出现过的 bootstrap 凭据。
3. **记录本次操作。** 时间、执行人、临时账号名、涉及的管理员账号，写进变更记录并纳入 [Keycloak 生产巡检与运维清单]({{< relref "keycloak-operations-checklist" >}}) 的月度审计项，便于事后对账。
4. **别把恢复路径当日常运维路径。** 日常应该保证至少两个长期管理员账号、凭据托管在密码管理器中、强化认证有备用凭据，这样才不需要在故障时走停服恢复。

## 常见问题（FAQ）

### Q1：Keycloak 管理员密码忘了，最快的恢复方式是什么？

能接受一次停服就用 `bootstrap-admin user`：停掉所有节点 → 用与服务器相同的 db 选项执行命令 → 用临时账号登录并创建/重置长期管理员 → 删除临时账号。不能停服则没有官方支持的在线重置路径，只能从数据库恢复层面想办法，风险和成本都更高。

### Q2：为什么配了 `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD` 却没有重置管理员密码？

这两个选项的设计目标是**初始化**而不是**恢复**：它们只在服务器第一次启动、master realm 还不存在时创建管理员账号。master realm 已存在时加这些变量不会生效，恢复必须用 `bootstrap-admin` 命令。

### Q3：`bootstrap-admin` 能在服务运行中执行吗？

官方前提是所有 Keycloak 节点都已停止。命令直接操作数据库，运行中的节点会让结果不可预期，集群场景请先降到 0 副本再执行。

### Q4：临时管理员账号不删除会有什么问题？

它是带完整管理员权限的账号，密码由运维临时设定、常出现在命令行或工单里，长期留存等于在生产保留一个弱控制的特权账号。官方也明确要求恢复完成后手工删除。

## 参考来源

- [Keycloak — Bootstrapping and recovering an admin account](https://www.keycloak.org/server/bootstrap-admin-recovery)：临时账号定义、`bootstrap-admin user/service` 命令、停节点前提、`--optimized` 与隐式构建的 NOTE、`--no-prompt` 行为、强化认证场景的服务账号恢复流程。
- [Keycloak Upgrading Guide](https://www.keycloak.org/docs/latest/upgrading/index.html)：26.0.0「Admin Bootstrapping and Recovery」（`KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` 弃用）、26.1.0 生产 profile 下 `db` 必须显式指定、26.4.0 Welcome Page 改为创建正式管理员。
- Keycloak 源码 [`WelcomeResource.java`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/services/resources/WelcomeResource.java)：`isLocal` 判定与 `rejectedNonLocalAttemptToCreateInitialUser`、`or use a bootstrap-admin command` 提示文案、`createMasterRealmUser(..., isTemporary=false)`。
- Keycloak 源码 [`ApplianceBootstrap.java`](https://github.com/keycloak/keycloak/blob/main/services/src/main/java/org/keycloak/services/managers/ApplianceBootstrap.java)：`isTemporary` 参数与临时管理员/服务账号的创建入口。
- [Keycloak 26.7.4 release](https://github.com/keycloak/keycloak/releases/tag/26.7.4)：本文核对时的最新发行版。

> 数据库选型、连接池与迁移场景见 [Keycloak 生产数据库配置指南]({{< relref "keycloak-postgresql-config" >}})；代理头与外部地址配置见 [Keycloak Hostname v2 配置]({{< relref "keycloak-hostname-v2-config" >}})。
