---
title: "IAM 用户迁移：遗留密码哈希如何迁进 Keycloak | IDaaS Book"
description: "IAM 用户迁移的密码难题：用 PasswordHashProvider SPI 接收遗留哈希、Admin API 批量导入已哈希凭据、首次登录自动重哈希的判定条件，以及删掉 provider 后用户被静默锁死的回滚边界。"
date: 2026-09-25T00:00:00+08:00
draft: false
weight: 90
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-password-hash-migration"
toc: true
---

## 场景

IAM 迁移项目里，realm、客户端、登录页、SSO 跳转通常几周就能对完，真正卡住的是最后一步：存量用户的口令。哈希不可逆，也不可能让 20 万活跃用户集体改密码。

这篇文章只回答一个问题：**在不拿到明文的前提下，怎么让老用户用原来的密码登录 Keycloak**。这里没有"平滑迁移"的通用答案，只有四条路径各自的成立条件，以及一条会让用户永久登不进来的操作。

| | 适用 | 不适用 |
|---|---|---|
| 本文 | 自研系统迁移（密码哈希存在业务库，算法和参数可获取）、AD/LDAP 目录接入、旧系统口令库需要保留凭据语义 | 密码已泄露或哈希算法不可信的系统（那必须强制重置）；已经把密码真源放在 AD/LDAP 的场景（不需要迁移密码）；只迁用户属性、不迁登录态的场景 |

前置能力：能读到旧系统的哈希算法、盐和代价参数，并确认这些材料与线上数据一致。拿不到参数就不要往下走，走强制重置。

## 四条路径

| 路径 | 前提 | 用户感知 | 迁移完成时机 | 主要风险 |
|---|---|---|---|---|
| A 目录透传 | 密码真源已在 AD/LDAP | 无 | 无需迁移 | 目录不可用时登录受限 |
| B 导入已有哈希 + 自定义 HashProvider | 能拿到算法与参数 | 无 | 每个用户下次密码登录时 | provider 下线早于末位用户登录 = 锁死 |
| C 临时密码 + 强制改密 | 无 | 强 | 上线窗口 | 客服与改密流程压力 |
| D 登录时向旧系统验证（User Storage SPI） | 旧系统在线且可调 | 无 | 首次登录 | 双跑期长，旧系统成为登录依赖 |

判断顺序很简单：**密码真源在目录里，就走 A，别迁密码**；真源在自研系统的应用表里，才轮到 B 或 C。D 是 A 的代码版——用 `User Storage SPI` 的 `CredentialInputValidator` 在首次登录时向旧系统校验，通过后写入本地凭据，代价是旧系统退场前一直是登录链路的一部分。

下面重点讲 B，因为它的行为最容易误判。

## Keycloak 认不认这个哈希，由两处 id 是否相等决定

密码登录的校验路径在 `PasswordCredentialProvider.isValid()`（26.7.4）：

1. 从该用户的凭据里取 `credentialData.algorithm`；
2. 用这个字符串去查 provider：`session.getProvider(PasswordHashProvider.class, algorithm)`；
3. **查不到就直接 `return false`**，日志只有一句 debug：

```
PasswordHashProvider {0} not found for user {1}
```

这就是"我明明把哈希导进去了，用户却登不上"的根因。第 3 步的日志是 **debug 级**，默认 INFO 配置下什么都不输出，用户看到的是"用户名或密码错误"，运维看到的是"凭据在库里躺着"。

唯一的直接证据是临时把这条日志打开：

```bash
bin/kc.sh start --log-level="INFO,org.keycloak.credential:debug"
```

所以自定义 provider 的 `getId()` 返回值，必须和导入 payload 里写的 `algorithm` **完全一致**（大小写敏感）。这个字符串是 Keycloak 的 provider 查找键，不是注释。

## Provider 要做的三件事

服务声明文件必须叫 `META-INF/services/org.keycloak.credential.hash.PasswordHashProviderFactory`，内容是实现类的全限定名。JAR 放进 `providers/` 后要重新 `kc.sh build`；在 `--optimized` 启动模式下不 build 等于没装（构建期与运行期选项的边界见 [IAM SPI 扩展的生产交付]({{< relref "keycloak-spi-extension-deployment" >}})）。

```java
public class LegacyBcryptHashProvider implements PasswordHashProvider {

    @Override
    public boolean verify(String rawPassword, PasswordCredentialModel credential) {
        String stored = credential.getPasswordSecretData().getValue();
        // bcrypt 的盐包含在 $2a$ 哈希串里，验证直接用现成实现，不要自己写
        return BCrypt.checkpw(rawPassword, stored);
    }

    @Override
    public boolean policyCheck(PasswordPolicy policy, PasswordCredentialModel credential) {
        // 旧算法永远不算“符合当前策略”，把升级交给 realm 当前算法去做
        return false;
    }

    @Override
    public PasswordCredentialModel encodedCredential(String rawPassword, int iterations) {
        throw new UnsupportedOperationException(
            "bcrypt-legacy is verify-only: do not set it as realm hash algorithm or SPI default");
    }
}
```

三点说明：

- `policyCheck` 返回 `false` 是有意的。只有当旧算法被设成 realm 哈希算法或 SPI 默认 provider 时这个方法才会对着旧凭据被调用，返回 `false` 表示"不要用它继续产生新哈希"。
- `encodedCredential` 直接抛异常，是为了让"把旧算法设成默认"这类误配**当场失败**，而不是安静地继续写出弱哈希。密码写入路径会把它包成 `ModelException`，表现为设置密码失败。
- `verify` 里用的是 `credential.getPasswordSecretData().getValue()`。需要额外参数（比如 bcrypt cost、多盐方案）时读 `getPasswordSecretData().getAdditionalParameters()`，它的 JSON 字段名是 `algorithmData`（见下节）。

## 批量导入：payload 的形状要精确

`RepresentationToModel.createCredentials()` 只有两个分支：

- `credentials[].value` 非空 → 当成**明文**，用 realm 当前算法重新哈希；
- `value` 为空、提供了 `secretData` / `credentialData` → 通过 `createCredentialThroughProvider()` **原样写入**，且**不经过密码策略校验**。

所以预哈希导入必须留空 `value`：

```json
POST /admin/realms/<realm>/users
{
  "username": "alice",
  "email": "alice@example.test",
  "emailVerified": true,
  "enabled": true,
  "credentials": [
    {
      "type": "password",
      "secretData": "{\"value\":\"$2a$10$<legacy-bcrypt-hash>\"}",
      "credentialData": "{\"algorithm\":\"bcrypt-legacy\",\"hashIterations\":0,\"algorithmData\":{\"cost\":\"10\"}}"
    }
  ]
}
```

三个高频写错的地方：

1. `secretData` 和 `credentialData` 是**字符串化的 JSON**（双重编码），不是嵌套对象。
2. 额外参数的字段名是 **`algorithmData`**，不是 `additionalParameters`——源码里是 `@JsonProperty("algorithmData")`，写错不会报错，只是参数读不到。
3. 盐已包含在哈希串里的算法（bcrypt、PHC 格式的 argon2 字符串）不要给 `salt` 字段；盐单独存的算法（`sha256+salt`、SSHA512 等）必须给 `"salt":"<base64>"`，因为 `PasswordSecretData` 会对它做 base64 解码。

脚本层面的两点约束比 payload 本身更容易出事：

- 这批哈希是**凭据材料**。别把几十万条哈希放进命令行参数、shell history 或聊天记录；用挂载的 Secret 文件配合 `--data-binary @file`。
- 导入接口绕过密码策略是设计行为，但同时意味着：任何能调用这个 Admin API 的主体都可以给用户写入任意凭据。迁移期间不能因为"只是批量导入"就放宽 Admin API 的访问控制。

## 登录即升级：重哈希什么时候真的发生

校验通过之后，`isValid()` 会调用 `rehashPasswordIfRequired()`，逻辑是：

1. 取 **realm 密码策略里的 `hashAlgorithm`**，没配置就用 SPI 默认 provider；
2. 用这个 provider 的 `policyCheck(policy, 已存凭据)` 判断当前哈希是否达标；
3. 返回 `false` 才重哈希，用的是**这次登录提交的明文**。

PBKDF2 provider 的 `policyCheck` 同时比较三件事：迭代数（策略没配时用 provider 默认值）、算法 id、派生 key 长度。存量凭据的算法是 `bcrypt-legacy`，必然不匹配，于是升级自动发生。

有四个行为值得写进运行手册：

- **升级只能发生在用户成功登录的那一刻**，没有离线补课的方式。
- 重哈希在**原事务提交之后另开事务**执行，失败只记一条 info：`Error re-hashing the password in a different transaction`，**不会让这次登录失败**。含义是：目标库只读、连接池打满或迁移窗口锁表时，你可能以为"自动升级在跑"，实际上一条都没落库。
- 升级保留原 credential id、`createdDate` 和 `userLabel`，所以密码年龄与轮换策略不会因为升级被重置。
- 官方升级说明提示过这个量级：默认迭代提升后单次密码登录的 CPU 开销明显上升，并且因为重哈希会清理内部缓存，数据库读放大会跟着上来。上线窗口里首登集中发生，需要按自己的用户活跃分布压测，不要照抄别人的并发数。

进度不要靠感觉，直接查库（PostgreSQL）：

```sql
SELECT credential_data::jsonb ->> 'algorithm' AS algorithm, count(*)
FROM credential
WHERE type = 'password'
GROUP BY 1
ORDER BY 2 DESC;
```

表 `credential` 和列 `credential_data` / `secret_data` / `type` 是 Keycloak JPA 模型的列名（`CredentialEntity`）。这个查询要回答两个运维问题：还有多少用户从没登录过（决定 provider 能不能下线），以及旧算法凭据的分布是否和预期一致。

## 不要让旧 provider 变成默认

两个动作都会关掉上面整条升级链路，而且都不会报错：

- `--spi-password-hashing--provider-default=<legacy-id>`；
- 在 realm 密码策略里把 `hashAlgorithm` 设成旧算法 id。

原因在默认 provider 的选取顺序（官方文档）：显式配置 → order 最大的 provider（order ≤ 0 忽略）→ id 为 `default` 的 provider。26.7.4 里 `argon2` 的 order 是 300，`pbkdf2-sha512` 是 200，`pbkdf2-sha256` 是 100，`pbkdf2`（SHA1，已标注不推荐）是 -100。所以非 FIPS 环境下默认 provider 就是 Argon2，且其默认 type 为 `id`，即 Argon2id。一旦把旧算法抬成默认，新密码和重置密码会继续写成旧哈希，而 `policyCheck` 又匹配得上，存量自然也不会升级。

旧 provider 的正确角色只有一个：**verify-only**。

## 失败与回滚

**删 provider JAR 会静默锁死用户。** 任何 `credential_data.algorithm` 仍是旧 id、且从未成功登录过的用户，在 provider 缺失时 `isValid` 直接返回 `false`，日志只有 debug 级的那一行。表现为"迁移后某个部门集体登不上"，且没有任何错误信息可查。所以 JAR 的下线条件不是"迁移项目验收了"，而是上面那条 SQL 里旧算法计数归零。

必须提前下线时，正确做法是先给剩余用户设临时密码并加 `UPDATE_PASSWORD` required action，而不是直接删 provider。

**如果 realm 密码策略的 `hashAlgorithm` 还钉着这个旧 id，删 JAR 的后果会扩大到整个 realm。** 登录路径里的 `rehashPasswordIfRequired()` 先用策略里的算法名去查 provider，再调用 `policyCheck()`；查不到时它**不会**像写密码路径的 `getHashProvider()` 那样告警并回退到默认 provider，而是拿着 `null` 继续调用，抛出的异常被 `isValid()` 的 `catch (Throwable)` 吞掉、返回 `false`。结果是**密码完全正确的用户也登不进来**，而且这条路径上的失败只有一条 warn：`Error when validating user password`。这个不对称很容易误导排错方向——改密、重置密码都正常（写入路径有回退），只有登录挂掉。所以下线清单里除了清点凭据算法，还要把 realm 密码策略的 `hashAlgorithm` 一起摘掉；迁移期还挂着自定义 password-hashing provider 时，策略里留空比显式写算法名安全。

**realm 密码策略一旦显式固定 `hashAlgorithm` / `hashIterations`，等于冻结升级路径。** `policyCheck` 会匹配上这些旧值，存量凭据不再触发重哈希。压测阶段为了降负载这么做是合理的，但必须写进变更记录——否则半年后会以为"自动升级早就跑完了"，直到某天删掉 provider 才发现还有一批用户没升。

**同一个锁死机制也会发生在内置 provider 上：Argon2 与 FIPS 的切换。** Argon2 不符合 FIPS 140-2，官方文档明确说明 FIPS 环境下默认算法仍然是 PBKDF2，并提示非 FIPS 环境如果计划切到 FIPS，应当**一开始**就把密码策略设成 `pbkdf2-sha512`；否则切换后已用 Argon2 哈希的用户将无法登录。原因和上面完全相同：FIPS 环境下 Argon2 provider 不可用，`session.getProvider(PasswordHashProvider.class, "argon2")` 找不到实现，`isValid` 直接返回 false。这里没有"先切环境再补"的窗口——FIPS 环境不会去验证一个它不认识的算法。要在合规切换前排空 Argon2 凭据（切策略到 `pbkdf2-sha512`，等所有用户完成一次登录并通过上面那条 SQL 确认为零），或者接受这批用户走一次强制重置。

回滚动作本身很简单：把 JAR 放回 `providers/`，重新 `kc.sh build`，滚动重启。已经升级过的凭据不受影响，因为新算法由内置 provider 校验。

## 路径 C：什么时候必须放弃迁移

以下情况不要试图保留旧哈希，直接走临时密码 + `UPDATE_PASSWORD`：

- 无盐或固定盐的快速哈希（MD5、SHA1、`sha1(password+salt)`）；
- 哈希与盐、算法参数不在同一份可导出数据里；
- 旧系统已被入侵、数据库曾被导出，或无法确认这份哈希是否被篡改。

把无盐 MD5 接进 Keycloak，只是把风险换了个数据库存放，没有增加任何安全性。算法选型与策略落地的依据见 [IAM 密码策略与哈希算法选型]({{< relref "iam-password-policy-guide" >}})。

## 迁移检查清单

- [ ] provider id 与导入 payload 的 `algorithm` 逐字符一致（大小写敏感）
- [ ] JAR 在 `providers/` 下，且 `kc.sh build` 执行过（`--optimized` 下必须）
- [ ] 单条真实用户完成一次登录，`credential_data.algorithm` 已变为当前算法
- [ ] 用 debug 日志确认没有 `PasswordHashProvider ... not found`
- [ ] 旧 provider 保留在镜像与部署清单里，直到旧算法计数归零
- [ ] realm 密码策略是否显式固定了 `hashAlgorithm` / `hashIterations`，是否与升级预期一致
- [ ] 导入脚本的中间文件按凭据管理，导入后销毁
- [ ] Admin API 在迁移窗口内的访问控制没有放宽
- [ ] 迁移前完成一次数据库备份，并有 [IAM 高可用与灾难恢复]({{< relref "keycloak-ha-dr" >}}) 的恢复演练记录

## IAM FAQ

### Keycloak 支持直接导入已有的密码哈希吗？

支持。Admin API 的 `credentials[].secretData` + `credentialData` 会原样落库，前提是同一对象的 `value` 留空。Keycloak 不会校验这个哈希是否正确，也不会校验算法是否安全，校验责任完全在导入方。

### 迁移后用户还需要改密码吗？

路径 B 不需要：首次成功登录时自动用当前算法重哈希。路径 C 必须改。路径 A（LDAP/AD 联邦）本来就不在 Keycloak 侧存密码，改密仍然发生在目录侧。

### 为什么日志里只有"用户名或密码错误"，看不到真正原因？

provider 找不到这条判断在 `PasswordCredentialProvider.isValid()` 里是 debug 级输出。默认 INFO 级别下没有任何线索，需要临时把 `org.keycloak.credential` 调到 debug，才能看到 `PasswordHashProvider ... not found for user`、`No password stored for user` 这类具体分支。

### 换了哈希算法，存量密码会自动升级吗？

会，在用户下一次**密码登录**时。两个前提：该凭据没被跳过（realm 密码策略没有显式固定成旧参数），以及重哈希事务成功提交。如果压缩了 `hashIterations` 来降负载，升级链路就停了。

### IAM 迁移时该选 LDAP 联邦还是密码哈希迁移？

看密码真源在哪。真源在 AD/LDAP，用联邦透传，不要迁密码，具体配置见 [IAM 目录对接：Keycloak LDAP / AD 用户联邦]({{< relref "keycloak-ldap-ad-federation" >}})。真源在自研系统的应用表，只能在"迁哈希"和"强制重置"之间选，取决于哈希是否可信。

### 旧系统用 bcrypt，Keycloak 能直接验证吗？

不能直接验证，bcrypt 不在 Keycloak 内置的 password-hashing provider 里（内置为 Argon2 与 PBKDF2 系列）。需要用上面那种自定义 provider 接收，或者把校验委托给旧系统（路径 D）。社区里有现成的 bcrypt provider 实现可以参考，但决定使用前要自己审一遍验证逻辑——这段代码是认证链路上的关键判断。

## 延伸阅读

- [IAM 密码策略与哈希算法选型]({{< relref "iam-password-policy-guide" >}})——Argon2id 参数、迭代数与策略分层
- [IAM 目录对接：Keycloak LDAP / AD 用户联邦]({{< relref "keycloak-ldap-ad-federation" >}})——路径 A 的完整配置与排错
- [IAM SPI 扩展的生产交付]({{< relref "keycloak-spi-extension-deployment" >}})——provider JAR 的镜像构建、Operator 部署与 `--optimized` 陷阱
- [Keycloak 26.7.4 安全补丁与 IAM 升级清单]({{< relref "keycloak-26-7-3-security-patch" >}})——升级顺序与回滚
- [IAM 身份生命周期]({{< relref "docs/fundamentals/identity-lifecycle.md" >}})——入转离流程与凭据的长期管理

## 参考来源

- Keycloak 26.7.4 源码 `PasswordCredentialProvider.java`（`isValid()` 的 provider 查找与 `rehashPasswordIfRequired()` 的触发条件）：<https://github.com/keycloak/keycloak/blob/26.7.4/services/src/main/java/org/keycloak/credential/PasswordCredentialProvider.java>
- Keycloak 26.7.4 源码 `RepresentationToModel.java`（`createCredentials()` 的明文与预哈希分支、`createCredentialThroughProvider()` 不校验密码策略）：<https://github.com/keycloak/keycloak/blob/26.7.4/server-spi-private/src/main/java/org/keycloak/models/utils/RepresentationToModel.java>
- `PasswordCredentialData.java` / `PasswordSecretData.java`（`algorithmData` 字段与 salt 的 base64 解码）：<https://github.com/keycloak/keycloak/blob/26.7.4/server-spi/src/main/java/org/keycloak/models/credential/dto/PasswordCredentialData.java>
- `Pbkdf2PasswordHashProvider.java` 的 `policyCheck()`，以及 `Pbkdf2Sha256/Sha512/Argon2PasswordHashProviderFactory` 的 `order()` 与默认迭代数：<https://github.com/keycloak/keycloak/blob/26.7.4/server-spi-private/src/main/java/org/keycloak/credential/hash/Pbkdf2PasswordHashProvider.java>
- Keycloak 官方文档《Configuring providers》（默认 provider 选取顺序、`providers/` 目录与 `build` 要求）：<https://www.keycloak.org/server/configuration-provider>
- Red Hat build of Keycloak 24 Upgrading Guide《Changes to Password Hashing》（默认算法由 pbkdf2-sha256 改为 pbkdf2-sha512、迭代数调整、登录时一次性重哈希与性能影响）：<https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/24.0/html/upgrading_guide/migration-changes>
- Red Hat build of Keycloak 26.0 Upgrading Guide《Argon2 password hashing》（默认算法改为 Argon2、每次哈希约 7 MB 内存、FIPS 环境仍为 PBKDF2）：<https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.0/html-single/upgrading_guide/index>
- Keycloak Release Notes（26.0《Argon2 password hashing》：非 FIPS 环境默认 Argon2、FIPS 环境默认仍为 PBKDF2、切 FIPS 前应先把策略设为 `pbkdf2-sha512`）：<https://www.keycloak.org/docs/latest/release_notes/index.html>
- Keycloak 官方文档《Logging》（`--log-level` 的 category 语法）：<https://www.keycloak.org/server/logging>
