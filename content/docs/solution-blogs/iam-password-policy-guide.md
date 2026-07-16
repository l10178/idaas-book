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
2. "密码哈希用的什么算法？"——你不确定，因为 Keycloak 默认用 PBKDF2，而安全团队要求 Argon2id
3. "用户改密码时能不能拦截已泄露的密码？"——你查了一圈发现 Keycloak 有 `passwordBlacklist` 但不知道怎么用

这三个问题代表了 IAM 密码安全最常见的三个盲区：策略过弱、哈希过时、泄露检测缺失。本指南不重复密码学理论，只解决"Keycloak 里怎么配、配错了什么症状、怎么验证生效"。

**适用**：Keycloak 26.x 生产环境，需要满足等保 2.0 三级或企业内部安全审计的 IAM 管理员。

**不适用**：Keycloak 版本低于 20.x（Argon2 支持不完整）；使用外部 LDAP/AD 管理密码的场景（密码策略在 LDAP 侧生效，Keycloak 只做验证代理）。

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
| `hashAlgorithm` | `argon2` | 见下节详细说明 |
| `hashingIterations` | `27`（Argon2 的内存/迭代参数，非 PBKDF2 的迭代次数） | Argon2 模式下的 `iterations` 参数 |
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

### 步骤 2：切换 Argon2id 哈希算法

Keycloak 默认使用 PBKDF2-SHA256，生产环境建议切换到 Argon2id。

**配置方式**（`keycloak.conf` 或环境变量）：

```properties
# keycloak.conf
kc_features=argon2
```

或环境变量：

```bash
KC_FEATURES=argon2
```

> **注意**：Argon2 在 Keycloak 中是 SPI 提供者，需要确保 `providers/` 目录下有对应 JAR（Keycloak 26.x 已内置）。开启后，新创建和修改密码的用户会自动用 Argon2id 哈希。**已有 PBKDF2 哈希的密码不会被自动迁移**——用户下次修改密码时才会切换到 Argon2id，旧 PBKDF2 密码仍可验证。

**Kubernetes 部署示例**：

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: keycloak
spec:
  template:
    spec:
      containers:
        - name: keycloak
          image: quay.io/keycloak/keycloak:26.1
          env:
            - name: KC_FEATURES
              value: "argon2"
            - name: KC_DB
              value: postgres
          args:
            - "start"
            - "--features=argon2"
```

**Argon2 参数调优**：

Argon2id 的安全强度取决于三个参数：

| 参数 | 含义 | 推荐值 | 调整方向 |
|------|------|--------|---------|
| `memory` | 内存使用（KB） | 65536（64MB） | 越大抗 GPU 越好，但登录延迟增加 |
| `iterations` | 迭代次数 | 3 | 越大越安全，但 CPU 开销线性增长 |
| `parallelism` | 并行线程数 | 4 | 应 ≤ 容器可用 CPU 核数 |

在 Keycloak 管理控制台中，**Password Policy → hashAlgorithm → argon2**，然后设置 `hashingIterations` 为上述参数的组合值。Keycloak 内部使用 `iterations` 参数控制 Argon2 的 time cost。

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
# 创建新用户并设置密码后，查看数据库中 USER_CREDENTIAL 表的 ALGORITHM 字段
# 应为 "argon2" 而非 "pbkdf2-sha256"

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
| Argon2 启用后新用户创建报错 | `--features=argon2` 未生效或 Keycloak 版本 < 20 | 确认 `kc_features=argon2` 已设置；检查 Keycloak 版本 |
| 已有用户密码仍用 PBKDF2 | Argon2 只对新密码生效，旧密码不自动迁移 | 给用户添加 `Update Password` Required Action，强制下次登录改密 |
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

3. **Argon2 回滚**：如果 Argon2 导致问题，移除 `--features=argon2` 并重启。已有 Argon2 哈希的密码仍可验证（Keycloak 根据 `ALGORITHM` 字段自动选择验证器），新密码会回退到 PBKDF2

## 生产检查清单

```text
□ 密码策略已配置：length(12) + 复杂度 + notUsername + notEmail + passwordHistory(5)
□ 哈希算法已切换到 Argon2id（或至少 PBKDF2-SHA256 with 600k+ iterations）
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

### Q2：Keycloak 默认的 PBKDF2 不够安全吗？

PBKDF2-SHA256 with 600k+ iterations 仍然符合 NIST SP 800-63B 的最低要求。但 Argon2id 在以下场景明显更优：
- GPU/ASIC 暴力破解（Argon2 的内存硬特性使 GPU 攻击成本高 100 倍以上）
- 密码数据库泄露后的离线攻击窗口

新项目建议直接用 Argon2id。已有项目可以在下次用户改密时自然迁移。

### Q3：密码黑名单文件要多大？

NIST 建议至少包含前 10,000 个最常见密码。可以从 [Have I Been Pwned](https://haveibeenpwned.com/Passwords) 下载 SHA1 哈希列表，或使用 [SecLists](https://github.com/danielmiessler/SecLists) 的明文列表。Keycloak 的 `passwordBlacklist` 读取明文列表，建议控制在 50,000 行以内（文件大小约 500KB），避免每次密码校验时的内存和性能开销。

### Q4：用户密码忘记后重置的密码需要满足策略吗？

是的。Keycloak 在管理员通过 Admin REST API 重置用户密码时，也会校验密码策略。如果重置的密码不满足策略，API 返回 400。临时密码（`temporary: true`）也受策略约束。如果需要绕过策略设置临时密码（不推荐），可以暂时修改策略或使用 Keycloak 的 Import/Export 功能。

### Q5：密码策略对 API 验证和数据库直接修改都生效吗？

密码策略只在 Keycloak 的认证流程中生效。直接在数据库中修改 `USER_CREDENTIAL` 表不会触发策略校验。API 通过 Admin REST API 重置密码会触发校验。如果通过 `kcadm.sh` CLI 工具设置密码，也会触发策略校验。

## 延伸阅读

- [IAM 安全最佳实践]({{< relref "../advanced-topics/security-best-practices" >}})：密钥管理、令牌保护与攻击面防御的系统性指南
- [Keycloak 密码策略配置]({{< relref "../keycloak/security-features/password-policies/index" >}})：Keycloak 内置密码策略项的完整列表
- [Keycloak 暴力破解检测]({{< relref "../keycloak/security-features/brute-force-detection/index" >}})：登录失败锁定与指数退避策略
- [IAM 安全合规与等保 2.0]({{< relref "../advanced-topics/iam-compliance-dengbao" >}})：身份鉴别与访问控制的等保逐条落地
- [Keycloak MFA / 多因子认证]({{< relref "../keycloak/security-features/mfa/index" >}})：TOTP 与 WebAuthn/Passkey 配置
- [Passkey / WebAuthn / FIDO2 IAM 企业落地指南]({{< relref "keycloak-passkey-webauthn" >}})：无密码认证的完整部署路径
- [IAM 最小权限原则落地指南]({{< relref "iam-least-privilege-guide" >}})：权限反模式、JIT 访问与权限审计
