---
title: "IAM 密码策略实战 - NIST SP 800-63B 与等保 2.0 在 Keycloak 中的落地 | IDaaS Book"
description: "IAM 密码策略企业落地指南：NIST SP 800-63B 核心建议、等保 2.0 双因素要求、Keycloak 密码策略完整配置、Argon2id 哈希切换、泄露密码检测与常见误区排错"
date: 2026-07-16T00:00:00+08:00
draft: false
weight: 73
menu:
  docs:
    parent: "solution-blogs"
    identifier: "iam-password-policy-guide"
toc: true
---

## 场景

你的企业正在做等保 2.0 三级测评，审计员问你三个问题：

1. "密码策略是否符合 NIST 最新指南？"——你发现 Keycloak 里只配了 `length(8)`
2. "密码哈希用的什么算法？"——你不确定，因为不知道该以哪个版本、哪个环境的默认值为准，而安全团队要求 Argon2id
3. "用户改密码时能不能拦截已泄露的密码？"——你查了一圈发现 Keycloak 有 `passwordBlacklist` 但不知道怎么用

这三个问题代表了 IAM 密码安全最常见的三个盲区：策略过弱、哈希过时、泄露检测缺失。本指南不重复密码学理论，只解决"Keycloak 里怎么配、配错了什么症状、怎么验证生效"。

**适用**：Keycloak 26.x 生产环境，需要满足等保 2.0 三级或企业内部安全审计的 IAM 管理员。

**不适用**：Keycloak 版本低于 26.x（Argon2 尚未成为默认算法，需先确认 provider 是否可用）；使用外部 LDAP/AD 管理密码的场景（密码策略在 LDAP 侧生效，Keycloak 只做验证代理）。

## 两份标准的交叉对照

NIST SP 800-63B（2020 修订版）和等保 2.0（GB/T 22239-2019）在密码策略上的要求有重叠也有差异：

| 维度 | NIST SP 800-63B | 等保 2.0 三级 | Keycloak 对应能力 |
|------|-----------------|--------------|------------------|
| 最小长度 | ≥ 8（验证者建议 ≥ 8，可允许 ≥ 64） | 口令应有复杂度要求 | `length` |
| 复杂度 | 不强制大小写/数字/特殊字符组合 | 需大小写、数字、特殊字符 | `upperCase` / `lowerCase` / `digits` / `specialChars` |
| 定期更换 | **不推荐**定期更换，仅在怀疑泄露时更换 | 建议定期更换 | `forceExpiredPassword` |
| 密码历史 | 未明确要求 | 不重复最近使用过的密码 | `passwordHistory` |
| 泄露检测 | **必须**检查已知泄露密码库 | 未明确 | `passwordBlacklist` |
| 哈希算法 | Argon2id / bcrypt / scrypt / PBKDF2（按顺序） | 未明确指定算法 | `hashAlgorithm` |
| 用户名/邮箱检查 | 不与用户名相同 | 不与用户名相同 | `notUsername` / `notEmail` |
| 截断处理 | 不应截断密码长度 | 未明确 | 无截断（Keycloak 支持最长 255 字符） |

关键差异：**NIST 反对定期强制换密码**，而等保 2.0 倾向于定期更换。实践建议：对普通用户不强制定期更换（遵循 NIST），但对管理员和高权限角色仍设 90 天更换周期（满足等保审计期望）。Keycloak 可以通过不同 Realm 或认证流实现分层策略。

## Keycloak 密码策略完整配置

### 步骤 1：设置密码策略

进入 **Realm Settings → Authentication → Password Policy**，按以下顺序添加策略（策略间用 `and` 连接）：

| 策略 | 推荐值 | 说明 |
|------|--------|------|
| `hashAlgorithm` | `argon2` | 26.x 非 FIPS 环境的默认值；显式写死会同时关闭"登录时自动重哈希"的升级路径，见下节 |
| `hashIterations` | 留空 | 只对 PBKDF2 生效；Argon2 的强度参数在 provider 配置里，策略里填 ≤100 的值会覆盖它，超过 100 会被忽略并回退 provider 默认值 |
| `length` | `12` | NIST 最低 8，但企业建议 12+ |
| `upperCase` | `1` | 等保要求 |
| `lowerCase` | `1` | 等保要求 |
| `digits` | `1` | 等保要求 |
| `specialChars` | `1` | 等保要求 |
| `notUsername` | 开启 | NIST + 等保共同要求 |
| `notEmail` | 开启 | 防止用户用邮箱做密码 |
| `passwordHistory` | `5` | 不重复最近 5 次密码 |
| `passwordBlacklist` | 见下文配置 | 拦截常见泄露密码 |
| `forceExpiredPassword` | `90`（仅管理员角色） | 普通用户不设；管理员 Realm 单独配 |
| `regexPattern` | 按需 | 如禁止连续重复字符 `.*(.)\\1{2,}.*` |

### 步骤 2：确认哈希算法是否已经是 Argon2id

Keycloak 26 起，**非 FIPS 环境的默认密码哈希算法已经是 Argon2**（type 默认为 `id`，即 Argon2id）；FIPS 环境因 Argon2 不符合 FIPS 140-2，默认仍是 PBKDF2。所以"从 PBKDF2 切到 Argon2id"这一步在 26.x 上通常不需要手动做，需要做的是确认它真的生效。

**不要再配置 `--features=argon2`**。Argon2 在早期版本中是 preview 特性，26.x 已内置为默认 provider，特性列表中不再有该项，继续配置它不会产生任何效果。

验证方式不看配置项，看落库结果——新建或重置一个测试用户的密码，然后查凭据算法：

```sql
SELECT credential_data
FROM credential
WHERE type = 'password' AND user_id = '<测试用户ID>';
```

非 FIPS 的 26.x 上，`algorithm` 应为 `argon2`；如果仍是 `pbkdf2-sha256`，说明当前环境是 FIPS 或策略里显式固定了算法。

**Argon2 参数调优**（provider 级配置，不在密码策略里）：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `type` | `id` | Argon2id，抗侧信道与抗 GPU 的折中模式 |
| `version` | `1.3` | 可选 `1.0` |
| `memory` | `7168` KiB（7 MB） | 每次哈希占用的内存 |
| `iterations` | `5` | time cost |
| `parallelism` | `1` | 并行度 |
| `hashLength` | `32` | 输出长度（字节） |

按 `spi-password-hashing--argon2--<property>` 的形式配置，例如 `--spi-password-hashing--argon2--memory=19456`；默认值以 Keycloak《All provider configuration》和 `Argon2PasswordHashProviderFactory` 为准。调整前先算内存底线：**memory × 并发哈希数**就是进程的内存下限；官方默认还会把并行哈希数限制为 JVM 可见的 CPU 核数，避免容器内 CPU 限流拖累其他请求。

> **Keycloak 的 Argon2 默认内存（7 MiB）低于 OWASP 对 Argon2id 的基线建议**（不低于 19 MiB、迭代 2、并行度 1）。是否上调要结合登录并发与内存预算决定，并在预发环境实测登录延迟——把 memory 从 7 MiB 提到 19 MiB，单次哈希的内存占用约为原来的 2.7 倍。
>
> **密码策略里的 `hashIterations` 不是 Argon2 的调参入口。** Argon2 provider 只在策略值 ≤100 时把它当作 time cost 使用，超过 100 会打一条 `Iterations for Argon should be less than 100, using default` 警告并回退到 provider 默认值；而它的 `policyCheck()` 比对的是 **provider 配置的**迭代数（默认 5）。把策略设成与 provider 不一致的值（例如策略填 8），存进去的凭据相对 provider 配置永远不达标，于是**每次成功登录都会再重哈希一次**：安全强度没提高，CPU 白烧。策略里留空，要调强度就改 `--spi-password-hashing--argon2--iterations`。

**存量密码会在下次登录时自动重哈希**：密码校验通过后，Keycloak 会用当前算法和策略参数重新计算并覆盖原凭据，用的就是这次登录提交的明文。所以切算法不需要"全员改密"，但升级会集中在用户首次登录时发生，带来 CPU 开销和数据库读放大，需要按活跃分布压测首登窗口。前提是 realm 密码策略**没有**把 `hashAlgorithm` / `hashIterations` 显式固定成旧值——那样匹配上的存量凭据不会再被重哈希。

导入遗留系统的密码哈希、监控重哈希进度、以及删除 provider 导致用户锁死的边界，见 [IAM 用户迁移：遗留密码哈希如何迁进 Keycloak]({{< relref "keycloak-password-hash-migration" >}})。

### 步骤 3：配置泄露密码黑名单

NIST SP 800-63B 要求验证者检查密码是否在已知泄露列表中。Keycloak 的 `passwordBlacklist` 策略支持从文件加载黑名单。

**配置方法**：

1. 准备黑名单文件，每行一个密码：

```text
# /opt/keycloak/data/password-blacklist.txt
123456
password
123456789
12345678
12345
1234567
admin
qwerty
letmein
welcome
```

2. 将文件放到 Keycloak 数据目录（或自定义路径）：

```bash
# Docker
docker run -v /path/to/password-blacklist.txt:/opt/keycloak/data/password-blacklist.txt ...

# Kubernetes
apiVersion: v1
kind: ConfigMap
metadata:
  name: password-blacklist
data:
  password-blacklist.txt: |
    123456
    password
    123456789
    ...
```

```yaml
# 挂载到 StatefulSet
spec:
  template:
    spec:
      containers:
        - name: keycloak
          volumeMounts:
            - name: password-blacklist
              mountPath: /opt/keycloak/data/password-blacklist.txt
              subPath: password-blacklist.txt
      volumes:
        - name: password-blacklist
          configMap:
            name: password-blacklist
```

3. 在 Password Policy 中添加 `passwordBlacklist`，值为文件名（不含路径）：`password-blacklist.txt`

**验证**：

```bash
# 尝试设置密码为黑名单中的值，应被拒绝
curl -s -X POST "http://localhost:8080/realms/myrealm/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","credentials":[{"type":"password","value":"123456","temporary":false}]}'
# 预期返回 400 + 错误提示密码不符合策略
```

### 步骤 4：分层密码策略（管理员 vs 普通用户）

Keycloak 不支持按角色设置不同密码策略（密码策略是 Realm 级别的），但可以通过以下方式实现分层：

**方案 A：管理员独立 Realm**

将管理员放在单独的 Realm（如 `admin-realm`），配置更严格的密码策略：

| 策略 | 普通 Realm | admin-realm |
|------|-----------|-------------|
| `length` | 12 | 16 |
| `forceExpiredPassword` | 不设 | 90 |
| `passwordHistory` | 5 | 10 |
| `regexPattern` | 无 | 禁止连续 3 个相同字符 |

**方案 B：Required Action 触发**

对管理员用户手动添加 `Update Password` Required Action，配合定期审计检查。

## 验证清单

配置完成后，逐项验证：

```bash
# 1. 确认密码策略已生效
# 在 Keycloak Admin REST API 中查看当前 Realm 的密码策略
curl -s "http://localhost:8080/admin/realms/myrealm" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.passwordPolicy'

# 预期输出类似:
# "length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1) and notUsername() and notEmail() and passwordHistory(5) and passwordBlacklist(password-blacklist.txt) and hashAlgorithm(argon2)"

# 2. 尝试设置弱密码，应被拒绝
curl -s -X PUT "http://localhost:8080/admin/realms/myrealm/users/$USER_ID/reset-password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"password","value":"weak","temporary":false}'
# 预期返回 400

# 3. 验证 Argon2 哈希已启用
# 创建新用户并设置密码后，查 credential 表的 credential_data 列：
# SELECT credential_data FROM credential WHERE type = 'password' AND user_id = '<用户ID>';
# 其中的 algorithm 应为 "argon2" 而非 "pbkdf2-sha256"

# 4. 尝试设置黑名单中的密码，应被拒绝
curl -s -X PUT "http://localhost:8080/admin/realms/myrealm/users/$USER_ID/reset-password" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"password","value":"123456","temporary":false}'
# 预期返回 400

# 5. 验证密码历史检查
# 先设置密码 A，再改为密码 B，再尝试改回密码 A
# 第三步应被拒绝
```

## 常见错误与排错

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 设置密码报 `invalid password` 但策略已满足 | `passwordBlacklist` 文件路径不对或文件名不匹配 | 确认文件在 Keycloak 数据目录，且策略值与文件名一致 |
| 设置密码后 `credential_data.algorithm` 不是 `argon2` | 运行在 FIPS 环境（Argon2 不符合 FIPS 140-2），或策略里显式固定了 `hashAlgorithm` / `hashIterations` | 确认是否 FIPS 环境；检查 realm 密码策略是否显式写了算法与迭代数 |
| 存量用户密码仍是旧算法 | 该用户尚未用密码登录过；或策略固定了旧参数，`policyCheck` 一直匹配，不再触发重哈希 | 用 `credential_data.algorithm` 的分组统计看进度；用户登录一次即自动升级，不需要额外加 Required Action |
| `forceExpiredPassword(90)` 导致用户频繁被要求改密码 | 所有用户同时触发 | 分批添加 Required Action，或先用脚本查询哪些用户密码超过 90 天 |
| LDAP 用户的密码策略不生效 | LDAP 联邦用户的密码在 LDAP 侧管理 | 在 LDAP/AD 侧配置密码策略；Keycloak 密码策略对联邦用户不生效 |
| `regexPattern` 策略导致所有密码被拒绝 | 正则表达式写反或匹配逻辑错误 | 先用简单正则测试，如 `.{8,}` 表示至少 8 字符 |
| 密码策略修改后已有用户不受影响 | 密码策略只对改密/新建时校验 | 添加 `Update Password` Required Action 强制已有用户改密 |

## 回滚方式

如果密码策略变更导致大面积用户无法登录：

1. **立即回滚策略**：在管理控制台移除新添加的策略项，恢复到之前的策略组合
2. **清除 Required Action**：批量清除用户的 `Update Password` Required Action

```bash
# 批量清除所有用户的 Update Password Required Action
# 获取所有有该 action 的用户
USERS=$(curl -s "http://localhost:8080/admin/realms/myrealm/users?first=0&max=1000" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq -r '.[].id')

for UID in $USERS; do
  curl -s -X PUT "http://localhost:8080/admin/realms/myrealm/users/$UID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"requiredActions":[]}'
done
```

3. **Argon2 回滚边界**：Argon2 是 26.x 内置的默认 provider，没有 `--features=argon2` 可移除；要停用只能在密码策略里显式固定 `hashAlgorithm(pbkdf2-sha512)`。此时已有 Argon2 哈希的密码仍可验证（Keycloak 按凭据里的 `algorithm` 选择验证器），但**如果运行环境切到 FIPS，Argon2 provider 不可用，这批用户会直接登录失败**。回滚前先确认没有 FIPS 切换计划，并核对 `credential_data.algorithm` 的实际分布

## 生产检查清单

```text
□ 密码策略已配置：length(12) + 复杂度 + notUsername + notEmail + passwordHistory(5)
□ 哈希算法已确认：非 FIPS 环境为 Argon2id，FIPS 环境为 PBKDF2-SHA256（600k+ iterations），并以 credential_data.algorithm 的实际落库结果为准
□ 泄露密码黑名单已部署并验证生效
□ 管理员密码策略比普通用户更严格（独立 Realm 或额外检查）
□ forceExpiredPassword 仅用于管理员角色
□ 已有用户已通过 Required Action 迁移到新策略
□ LDAP/AD 联邦用户的密码策略在源头配置（非 Keycloak 侧）
□ 密码策略变更已记录审计日志
□ 回滚方案已验证可行
```

## IAM 密码策略 FAQ

### Q1：NIST 说不需要定期换密码，但等保要求定期更换，怎么平衡？

对普通用户遵循 NIST SP 800-63B：不强制定期更换，仅在怀疑泄露时要求更改。对管理员和高权限角色设置 90 天更换周期（满足等保 2.0 三级审计期望）。技术上用独立 Realm 或分批添加 `Update Password` Required Action 实现。关键原则：**定期更换不如泄露检测重要**——优先部署 `passwordBlacklist`。

### Q2：Keycloak 默认的哈希算法够安全吗？

PBKDF2-SHA256 with 600k+ iterations 仍能满足 NIST SP 800-63B 的要求，OWASP 也把 PBKDF2（HMAC-SHA-256、work factor ≥ 600,000）列为需要 FIPS-140 合规时的推荐算法。Argon2id 的优势在密码库泄露后的离线破解成本：它是内存硬算法，攻击者无法靠便宜的 GPU/ASIC 线性放大猜解速度。

26.x 默认就是 Argon2id（非 FIPS 环境），所以"要不要切"通常不是问题。真正需要关注的是两件事：**Keycloak 的默认内存参数（7 MiB）低于 OWASP 对 Argon2id 的基线（≥19 MiB）**；以及存量凭据会在用户下次密码登录时自动重哈希，负载集中在首登窗口。算法迁移的完整操作与回滚边界见 [IAM 用户迁移：遗留密码哈希如何迁进 Keycloak]({{< relref "keycloak-password-hash-migration" >}})。

### Q3：密码黑名单文件要多大？

NIST 建议至少包含前 10,000 个最常见密码。可以从 [Have I Been Pwned](https://haveibeenpwned.com/Passwords) 下载 SHA1 哈希列表，或使用 [SecLists](https://github.com/danielmiessler/SecLists) 的明文列表。Keycloak 的 `passwordBlacklist` 读取明文列表，建议控制在 50,000 行以内（文件大小约 500KB），避免每次密码校验时的内存和性能开销。

### Q4：用户密码忘记后重置的密码需要满足策略吗？

是的。Keycloak 在管理员通过 Admin REST API 重置用户密码时，也会校验密码策略。如果重置的密码不满足策略，API 返回 400。临时密码（`temporary: true`）也受策略约束。如果需要绕过策略设置临时密码（不推荐），可以暂时修改策略或使用 Keycloak 的 Import/Export 功能。

### Q5：密码策略对 API 验证和数据库直接修改都生效吗？

密码策略只在 Keycloak 的认证流程中生效；直接用 SQL 改 `credential` 表的 `credential_data` 不会触发任何校验。API 通过 Admin REST API 重置密码会触发校验。如果通过 `kcadm.sh` CLI 工具设置密码，也会触发策略校验。唯一被设计为绕过策略的是 Admin API 导入**预哈希**凭据（`secretData` + `credentialData`，且不填 `value`），原因见 [IAM 用户迁移：遗留密码哈希如何迁进 Keycloak]({{< relref "keycloak-password-hash-migration" >}})。

## 延伸阅读

- [IAM 安全最佳实践]({{< relref "../advanced-topics/security-best-practices" >}})：密钥管理、令牌保护与攻击面防御的系统性指南
- [Keycloak 密码策略配置]({{< relref "../keycloak/security-features/password-policies/index" >}})：Keycloak 内置密码策略项的完整列表
- [Keycloak 暴力破解检测]({{< relref "../keycloak/security-features/brute-force-detection/index" >}})：登录失败锁定与指数退避策略
- [IAM 安全合规与等保 2.0]({{< relref "../advanced-topics/iam-compliance-dengbao" >}})：身份鉴别与访问控制的等保逐条落地
- [Keycloak MFA / 多因子认证]({{< relref "../keycloak/security-features/mfa/index" >}})：TOTP 与 WebAuthn/Passkey 配置
- [Passkey / WebAuthn / FIDO2 IAM 企业落地指南]({{< relref "keycloak-passkey-webauthn" >}})：无密码认证的完整部署路径
- [IAM 最小权限原则落地指南]({{< relref "iam-least-privilege-guide" >}})：权限反模式、JIT 访问与权限审计
