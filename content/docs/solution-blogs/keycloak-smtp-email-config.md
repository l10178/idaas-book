---
title: "Keycloak SMTP 邮件配置与密码重置完整指南 | IDaaS Book"
description: "Keycloak 生产环境邮件配置实战：SMTP 参数设置（Gmail/企业微信/AWS SES）、密码重置流程、邮箱验证、Kubernetes 部署示例与常见错误排错。"
date: 2026-07-11T00:00:00+08:00
draft: false
weight: 63
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-smtp-email-config"
toc: true
---

## 场景

Keycloak 部署好了，用户在登录页面点「忘记密码」，填了邮箱，点击提交——然后什么都没发生。不去翻 Keycloak 服务器日志的话，你甚至不知道是 SMTP 没配、端口被封、还是邮件进了垃圾箱。

Keycloak 的邮件功能不是可选的装饰品。以下功能都依赖它：

- **忘记密码 / 密码重置**：用户最常见的自助操作
- **邮箱验证（Verify Email）**：注册后确认用户拥有该邮箱
- **执行动作（Required Actions）**：管理员要求用户在下次登录时更新密码、验证邮箱、配置 OTP
- **事件通知**：登录异常检测、设备变更通知（Keycloak 25+ Event Listener 扩展支持）

不配邮件 = 废掉 Keycloak 一半的用户自助能力。

## 适用与不适用

| 适用 | 不适用 |
|------|--------|
| 生产或预发布环境，需要忘记密码 / 邮箱验证 | 纯 API/机器身份场景（Client Credentials Grant 不需要邮件） |
| Keycloak 17+ Quarkus 发行版 | WildFly 旧版 Keycloak（配置参数名不同） |
| Kubernetes / Docker / 裸金属部署 | Keycloak 内置 H2 开发模式不需要（但可以用 Fake SMTP 验证配置） |
| 需要使用 Gmail、企业微信邮箱、AWS SES、阿里企业邮等常见 SMTP | 需要高度自定义邮件模板的场景（本文聚焦配置，模板定制见[主题定制]({{< relref "docs/keycloak/themes/index.md" >}})） |

## 最小可用配置

### 1. Keycloak SMTP 配置参数

在 Keycloak Admin Console → Realm Settings → Email 中填写：

| 参数 | 示例值 | 说明 |
|------|--------|------|
| From | `noreply@example.com` | 发件人地址，建议用专用邮箱 |
| From Display Name | `Example IAM` | 收件人看到的发件名 |
| Host | `smtp.example.com` | SMTP 服务器地址 |
| Port | `587` | STARTTLS 用 587，SSL 用 465 |
| Enable SSL | OFF（STARTTLS） | 端口 587 配 STARTTLS；端口 465 配 SSL=ON |
| Enable StartTLS | ON | 与 SSL 互斥 |
| Enable Authentication | ON | 几乎所有生产 SMTP 都需要 |
| Username | `noreply@example.com` | SMTP 认证用户名，通常是邮箱全地址 |
| Password | `your-app-password` | SMTP 密码或应用专用密码 |

### 2. 测试邮件发送

填完后**不要**直接让用户测试忘记密码。先在 Admin Console → Realm Settings → Email → **Test connection** 输入一个能收邮件的地址点 Send。成功说明 SMTP 配置正确；失败看错误信息。

常见错误速查：

| 错误 | 原因 |
|------|------|
| `Could not connect to SMTP host` | 网络不通、SMTPS 端口被封、K8s NetworkPolicy 拦截 |
| `535 Authentication failed` | 用户名/密码错误、Gmail 需要 App Password |
| `530 Must issue STARTTLS first` | 配了端口 587 但没开 StartTLS |
| `javax.net.ssl.SSLHandshakeException` | 端口配成了 465 SSL 但服务器用了自签名证书 |

## 常见 SMTP 提供方配置

### Gmail

Gmail 要求使用**应用专用密码（App Password）**，不能用登录密码。步骤：

1. 开启 Google 账号的二步验证
2. 访问 [App Passwords](https://myaccount.google.com/apppasswords) 生成应用密码
3. 用生成的 16 位密码填入 Keycloak

```
Host: smtp.gmail.com
Port: 587
Enable SSL: OFF
Enable StartTLS: ON
Username: your-email@gmail.com
Password: <16位应用密码>
```

### 企业微信邮箱（腾讯企业邮）

企业微信自带腾讯企业邮，适用已有企业微信体系的公司：

```
Host: smtp.exmail.qq.com
Port: 587
Enable SSL: OFF
Enable StartTLS: ON
Username: noreply@yourdomain.com
Password: <邮箱密码或客户端专用密码>
```

安全要求：腾讯企业邮需要邮箱开启 SMTP 服务，并在管理后台允许该账号使用客户端收发。

### AWS SES

适用 AWS 生态，成本低（6.2 万封/月免费层）：

```
Host: email-smtp.<region>.amazonaws.com
Port: 587
Enable SSL: OFF
Enable StartTLS: ON
Username: <SES SMTP 凭证 Access Key>
Password: <SES SMTP 凭证 Secret Key>
```

注意：AWS SES 使用独立的 SMTP 凭据，不是 IAM Access Key。在 SES Console → SMTP Settings → Create SMTP Credentials 中生成。

## Kubernetes 部署配置

Keycloak Operator 或 Helm Chart 中，SMTP 通过环境变量注入：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: keycloak-smtp
type: Opaque
stringData:
  password: "<smtp-password>"
---
apiVersion: k8s.keycloak.org/v2alpha1
kind: Keycloak
metadata:
  name: keycloak
spec:
  additionalOptions:
    - name: spi-mail-smtp-host
      secret:
        name: keycloak-smtp-secret
        key: host
    # ... 其他 SMTP 参数
```

更推荐的方式是通过 `kcadm` 或 Admin Console 在 Realm 级别配置，因为 SMTP 配置属于 Realm 设置而非服务器级配置。用环境变量覆盖虽然可行，但不适合多 Realm 不同邮件配置的场景。

对不使用 Operator 的裸 Deployment，直接用环境变量：

```yaml
env:
  - name: KC_SPI_MAIL_SMTP_HOST
    value: "smtp.example.com"
  - name: KC_SPI_MAIL_SMTP_PORT
    value: "587"
  - name: KC_SPI_MAIL_SMTP_FROM
    value: "noreply@example.com"
  - name: KC_SPI_MAIL_SMTP_AUTH
    value: "true"
  - name: KC_SPI_MAIL_SMTP_STARTTLS
    value: "true"
  - name: KC_SPI_MAIL_USER
    valueFrom:
      secretKeyRef:
        name: smtp-secret
        key: username
  - name: KC_SPI_MAIL_PASSWORD
    valueFrom:
      secretKeyRef:
        name: smtp-secret
        key: password
```

### 网络层额外检查

在 Kubernetes 中，SMTP 出站流量可能被以下机制拦截：

- **NetworkPolicy**：确认 keycloak namespace 允许 Egress 到 SMTP 端口
- **Istio / Sidecar**：Service Mesh 默认可能拦截出站流量，需要配置 `ServiceEntry` 放行 SMTP
- **云厂商安全组**：阿里云/AWS/腾讯云默认拦截 25 端口出站，587 和 465 通常开放

验证网络连通性：

```bash
kubectl exec -it deployment/keycloak -- sh -c "echo 'QUIT' | nc -w5 smtp.example.com 587"
```

## 密码重置与邮箱验证流程

### 密码重置（Forgot Password）完整链路

```
用户点击"忘记密码"
  → 输入邮箱
    → Keycloak 查找用户 → 生成重置链接（含 Token）
      → 通过 SMTP 发送邮件
        → 用户收邮件点击链接 → Keycloak 验证 Token
          → 用户设置新密码 → 完成
```

Keycloak 默认的重置链接格式：
```
https://auth.example.com/realms/<realm>/login-actions/reset-credentials?token=<token>
```

这个 URL 的域名来自你在 Admin Console 中 Realm Settings → Frontend URL 的配置（或浏览器访问 Keycloak 时的域名）。

### Token 有效期

重置 Token 的有效期由 Realm Settings → Tokens → **Reset credentials** 控制，默认值通常是 5 分钟。如果用户反馈"邮件链接点进去显示过期"，改这个参数并提醒用户尽快操作。

### 邮箱验证（Verify Email）

在 Authentication → Required Actions 中启用 **Verify Email**。分两种触发方式：

1. **注册时自动触发**：在 Registration 流程中勾选 Verify Email，用户注册后会收到验证邮件
2. **管理员手动触发**：在用户详情页 → Required Actions → 添加 Verify Email，用户下次登录时必须验证

验证邮件的 Token 有效期受 Realm Settings → Tokens → **Verify email** 控制。

### 邮件未收到的排查顺序

1. **Test connection 是否通过**（第一步）
2. **检查 Keycloak 服务器日志**：`docker logs keycloak | grep -i mail`
3. **检查邮件服务端日志/垃圾箱**：90% 的"没收到"其实是进了垃圾箱
4. **检查 From 地址的 SPF/DKIM**：没有配置发件域名 SPF 记录的邮件会被大部分服务商标记为垃圾邮件
5. **检查网络**：上述 Kubernetes 网络层检查

## 回滚方案

如果 SMTP 配错了导致用户无法自助重置密码：

1. **关闭邮件依赖的 Required Action**：在 Authentication → Required Actions 中临时取消 Verify Email 勾选
2. **管理员手动重置密码**：Admin Console → Users → 选用户 → Credentials → Reset Password，设置临时密码
3. **禁用 SMTP**：清空 SMTP 配置字段（不影响已登录用户的 Session，只影响需要发邮件的新操作）
4. **回滚配置版本**：如果用 Operator/GitOps 管理配置，回滚 Keycloak CR 到上一个版本

## 生产检查清单

- [ ] SMTP 连接成功（Test connection 通过）
- [ ] From 地址的发件域配置了 SPF 记录（`v=spf1 include:spf.example.com ~all`）
- [ ] 有条件配置 DKIM 签名（减少进垃圾箱概率）
- [ ] 重置密码 Token 有效期合理（默认 5 分钟，用户反馈少可延长至 15-30 分钟）
- [ ] Kubernetes NetworkPolicy 允许到 SMTP 端口的 Egress
- [ ] 云厂商安全组开放 SMTP 出站端口（25 一般被封，用 587）
- [ ] SMTP 凭据存储在 Kubernetes Secret 中，不硬编码在 ConfigMap/Deployment YAML
- [ ] 关键操作（发送密码重置邮件）有日志或 Metrics 可观测

## 扩展阅读

- [Keycloak 主题定制 — 邮件模板修改]({{< relref "docs/keycloak/themes/index.md" >}})
- [Keycloak 安全功能 — MFA / 密码策略]({{< relref "docs/keycloak/security-features/_index.md" >}})
- [Keycloak 生产数据库配置 — PostgreSQL 实战]({{< relref "docs/solution-blogs/keycloak-postgresql-config" >}})
- [Keycloak 高可用集群部署]({{< relref "docs/solution-blogs/keycloak-ha-dr" >}})
- IAM 整体概念：[IAM 基础概念]({{< relref "docs/fundamentals/iam-fundamentals.md" >}})
