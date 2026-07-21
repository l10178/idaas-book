---
title: "IAM 是什么：身份与访问管理入门 | IDaaS Book"
description: "IAM（身份与访问管理）入门：理解认证、授权、用户生命周期和审计，并用 IAM 与 IDaaS 的区别、协议选型和落地检查项开始设计。"
date: 2026-07-09T00:00:00+08:00
draft: false
weight: 10
menu:
  docs:
    parent: "fundamentals"
    identifier: "what-is-iam"
toc: true
---

## IAM 是什么

**IAM**（Identity and Access Management，身份与访问管理）是一套管理「谁可以访问什么」的能力体系，而不是某一个具体产品。它涵盖四个核心域：

1. **认证（Authentication）**：确认你是谁——密码、MFA、生物特征、Passkey
2. **授权（Authorization）**：确认你能做什么——RBAC、ABAC、PBAC
3. **用户管理（User Management）**：账号的生命周期——创建、变更、禁用、删除
4. **审计（Audit）**：记录谁在什么时候做了什么——合规、追溯、异常检测

Gartner 将 IAM 定义为：**"确保正确的个体在正确的时间以正确的理由访问正确的资源的安全原则。"**

简单理解：IAM 就是企业的「门禁系统和访客登记簿」的结合体——它决定谁能进哪个门，进去后能做什么，并记录一切出入痕迹。

## 为什么需要 IAM

### 没有 IAM 的世界

- 每个应用自己管账号 → 100 个应用 = 100 套账号密码
- 员工离职 → IT 需要逐个应用禁用账号，漏一个就是安全漏洞
- 审计问「谁在什么时候访问了什么」→ 需要翻 100 个系统的日志
- 权限管理混乱 → 不该看到数据的人看到了，该看到的人没权限

### 有了 IAM 的世界

- 统一身份：一个账号，所有应用通行
- 集中管控：启用/禁用在一个地方操作，即时生效
- 完整审计：所有身份操作一目了然
- 自动化：入职自动创建账号分配权限，离职自动回收

## IAM 的核心能力

### 身份生命周期不是“禁用账号”这么简单

很多 IAM 介绍把离职流程写成“调用一次禁用接口”。生产环境里真正要验证的是**权限是否在下游收敛**：身份源标记离职后，IAM 应停止新的登录和令牌签发；通过 SCIM 对接的应用还要完成禁用或删除；已经发出的 Access Token 则要按其有效期、撤销机制或网关在线校验策略处理，不能把“SCIM 返回 200”当成访问已经消失。

一个可落地的最小闭环是：

1. HR/目录系统把用户状态改为离职，并记录变更事件 ID。
2. IAM 消费事件，禁用用户、撤销会话，并停止新的 Token 签发。
3. IAM 通过 [SCIM 用户生命周期接口]({{< relref "../protocols/scim-protocol" >}}) 向下游发送 `active=false`；下游返回成功后保存响应和时间戳。
4. 用原用户凭证分别验证：新登录失败、下游账号不可用、旧 Token 在设计的窗口内失效。
5. 失败时进入重试队列和人工补偿，而不是静默丢弃事件。

> **排错提示**：如果“离职后仍能访问”，先区分三件事：IAM 是否仍签发新 Token、下游是否收到 `active=false`、资源服务是否只验证 JWT 的签名和 `exp` 而不查实时状态。三者的修复位置不同。

这也是 [身份生命周期管理]({{< relref "identity-lifecycle" >}}) 与 [IAM 会话和 Token 生命周期]({{< relref "../advanced-topics/iam-session-management" >}}) 必须一起设计的原因。SCIM 的资源变更语义见 [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644)，Token 与会话的具体窗口则应以部署配置和威胁模型为准。

### 1. 认证（你是谁）

| 认证方式 | 安全性 | 用户体验 | 适用场景 |
|---------|--------|---------|---------|
| 密码 | 低 | 差 | 逐渐淘汰 |
| 密码 + MFA | 中高 | 一般 | 大多数企业 |
| 无密码/Passkey | 高 | 好 | 现代应用 |
| 社交登录 | 中 | 好 | C 端应用 |
| 生物特征 | 高 | 好 | 移动端/设备端 |

### 2. 授权（你能做什么）

三种主流授权模型：

- **RBAC**（基于角色）：给角色分配权限，给用户分配角色。适合组织架构清晰的企业。
- **ABAC**（基于属性）：根据用户属性、资源属性、环境属性动态决策。灵活但复杂。
- **PBAC**（基于策略）：用策略语言（如 OPA/Rego、XACML）描述规则。适合需要审计可解释性的场景。

详见 [授权模型深度对比]({{< relref "../advanced-topics/authorization-models" >}})。

### 3. 用户生命周期

```
入职创建 → 在职变更（换部门/升职） → 离职回收
  ↓            ↓                          ↓
自动分配    动态调整                   即时禁用
初始权限   权限                         所有访问
```

### 4. 审计与合规

- 登录日志：谁、何时、从哪登录、成功/失败
- 权限变更历史：谁被赋予了/撤销了什么权限
- 异常告警：异地登录、频繁失败、权限提升
- 合规报告：GDPR、等保、SOC2 等标准的审计证据

## IAM 的架构模式

### 模式一：集中式 IAM

单一 IAM 系统管理所有身份。适合中小规模、应用数量可控的场景。

```
[用户] → [IAM] → [应用 A]
              → [应用 B]
              → [应用 C]
```

### 模式二：联邦式 IAM

多个身份域通过信任关系互联。一个身份域可以信任另一个身份域的用户。

```
[公司 A 的 IAM] ← 信任 → [公司 B 的 IAM]
```

### 模式三：去中心化 IAM

用户自己持有身份凭证（可验证凭证），不依赖中心化身份提供方。W3C DID/VC 标准。

## IAM vs IDaaS vs 传统 IAM

| 概念 | 含义 | 关系 |
|------|------|------|
| **IAM** | 身份与访问管理的能力范畴 | 抽象概念，有无数实现方式 |
| **传统 IAM** | 以软件形式部署的 IAM | IAM 的一种实现形式 |
| **IDaaS** | 以云服务形式交付的 IAM | IAM 的一种交付模式 |

> IAM 是「是什么」，IDaaS 是「怎么交付」。如同数据库 vs RDS——你不会问「选数据库还是 RDS」，你问的是「用什么 RDS 实例来做数据库」。两者的完整对比——从架构到选型到混合部署，见 [IAM 和 IDaaS 区别]({{< relref "iam-vs-idaas" >}})。

## 开源 IAM 方案对比

| 方案 | 语言 | 协议支持 | 适用场景 |
|------|------|---------|---------|
| [Keycloak]({{< relref "what-is-keycloak" >}}) | Java | OIDC/SAML/LDAP | 企业全功能 IAM |
| Authentik | Python | OIDC/SAML/LDAP | 自建 SSO 网关 |
| Casdoor | Go | OIDC/SAML/OAuth | 轻量 IAM，中文社区活跃 |
| Zitadel | Go | OIDC/SAML | 事件驱动多租户 IAM |
| Ory (Hydra+Kratos) | Go | OIDC/OAuth | 云原生微服务 IAM |
| Dex | Go | OIDC | Kubernetes SSO 桥梁 |

详见 [IDaaS 方案全景对比]({{< relref "../implementation/other-idaas-solutions" >}})。

- [SCIM 用户生命周期管理]({{< relref "../protocols/scim-protocol" >}})——用户开通、变更与离职回收的接口语义
- [IAM 会话管理]({{< relref "../advanced-topics/iam-session-management" >}})——会话、Access Token 与撤销窗口的设计

## IAM 常见问题

### Q1：IAM 和 IDaaS 到底有什么区别？

简单说：**IAM 是能力范畴，IDaaS 是交付模式**。IAM 告诉你「要管理谁可以访问什么」，IDaaS 告诉你「把这个能力做成云服务」。详细对比见 [IAM 和 IDaaS 区别]({{< relref "iam-vs-idaas" >}})。

### Q2：中小企业需要 IAM 吗？

不需要买专门 IAM 软件，但需要 IAM 的思想和基本实践：
- 用 Google Workspace / Microsoft 365 做统一身份源
- 所有 SaaS 应用通过 SSO 接入（不要各自建账号）
- 离职流程第一件事：回收所有身份权限

在 10 人以下时就开始做这些事，成本极低，后续扩展时不用推倒重来。

### Q3：IAM 安全吗？会不会成为单点故障？

IAM 本身是高价值攻击目标，需要：
- IAM 管理员账号强制 MFA
- IAM 本身的高可用部署
- 紧急访问（Break-glass）账号——IAM 挂了也能进的最后通道
- 定期安全审计和渗透测试

### Q4：IAM 怎么选型？

基于四个维度决策：
1. **规模**：用户数、应用数、认证频率
2. **合规**：是否需要私有化部署，数据出境限制
3. **协议**：现有应用支持什么认证协议（OIDC/SAML/LDAP）
4. **团队**：有没有人维护（SaaS 省人力，自建要有人）

详见 [IAM 协议选型指南]({{< relref "../advanced-topics/iam-protocol-selection-guide" >}})。

### Q5：IAM 项目应该先选产品还是先定架构？

先定**身份权威源、应用接入协议和故障回退路径**，再选产品。至少把下面三件事写进设计记录：

1. 员工身份是否由 HR/AD 驱动，客户身份是否另建 CIAM 身份域；
2. 新应用优先使用 OIDC，仍依赖 SAML 的应用如何联邦接入；
3. IAM 不可用时，已签发 Token 是否允许短时间继续访问，以及管理员如何使用 break-glass 账号恢复。

只比较“支持多少协议”容易得到一张漂亮的功能表，却没有得到可回滚的身份架构。可结合 [IAM 架构设计指南]({{< relref "../advanced-topics/iam-architecture-design" >}}) 和 [Keycloak + oauth2-proxy 集成指南]({{< relref "../solution-blogs/keycloak-oauth2-proxy" >}}) 检查真实请求链路。

## IAM 方案的最小验收闭环

“支持 OIDC、SAML、SCIM”只是产品能力清单，不是可上线的 IAM 方案。上线前至少用一条测试身份走完下面五个断言；每个断言都应留下命令输出、事件 ID 或工单记录：

1. **身份权威明确**：写清 HR、AD、客户注册系统中谁是最终状态来源；IAM 中的手工改动是否会被下一次同步覆盖。
2. **登录对象可验证**：OIDC 客户端用 Discovery 返回的 `issuer` 配置，而不是凭经验拼接 URL；授权码流程启用 PKCE，且回调地址使用精确匹配。Discovery 的元数据语义见 [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)，OAuth 安全建议见 [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)。
3. **授权不依赖“登录成功”**：分别验证一个允许和一个拒绝用例。入口网关的 200/202 只说明会话通过，后端仍需按 `iss`、`aud`、scope/role 和资源关系做授权；不能把任意转发来的用户 Header 当作权限证明。
4. **离职能收敛**：将测试用户标记为离职，验证 IAM 不再签发新 Token、会话按设计撤销，下游 SCIM 资源变为 `active=false`。SCIM 的资源更新语义见 [RFC 7644](https://www.rfc-editor.org/rfc/rfc7644)；已经签发的 JWT 是否立即失效，取决于资源服务的撤销或在线校验策略，不能从 SCIM 的 HTTP 200 推导出来。
5. **故障可回退**：记录 IdP、数据库、密钥、下游同步任一环节故障时的降级边界。至少演练一次：IAM 暂时不可用时，已签发 Token 能否在限定窗口内继续访问，管理员如何通过 break-glass 账号恢复。

一个不依赖具体产品的 OIDC 验收命令如下：

```bash
ISSUER='https://idp.example.com/realms/acme'
curl --fail-with-body -sS "$ISSUER/.well-known/openid-configuration" \
  | jq -e --arg issuer "$ISSUER" '.issuer == $issuer and (.authorization_endpoint | startswith($issuer))'
```

命令只验证 Discovery 的外部地址是否自洽，不验证登录、签名或授权策略。后续应使用脱敏测试账号完成真实回调，并在资源服务侧验证拒绝用例。若这一闭环没有通过，继续增加角色、Mapper 或产品插件通常只会扩大排错面；先修正身份边界和回滚路径，IAM 才不是“能登录的演示环境”。
