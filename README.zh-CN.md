# IDaaS Book · 企业身份与访问管理实战全书

> **最完整的中文企业身份（IAM）技术书。**
> 从 IAM 基础原理和 OAuth 2.0 / OIDC / SAML 协议深度解读，到 Keycloak、CAS、Dex 生产部署与零信任架构——一条主线贯穿整个身份领域。
>
> 🇨🇳 全中文撰写 · [在线阅读 →](https://idaas.xlabs.club)

[![Stars](https://img.shields.io/github/stars/l10178/idaas-book?style=social)](https://github.com/l10178/idaas-book/stargazers)
[![Deploy](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml?label=deploy)](https://github.com/l10178/idaas-book/actions/workflows/gh-pages.yml)
[![Contributors](https://img.shields.io/github/contributors/l10178/idaas-book)](https://github.com/l10178/idaas-book/graphs/contributors)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)

---

## 为什么读这本书

身份认证与授权是所有现代系统的控制平面。每个应用都需要登录、权限、SSO 和审计——但大多数团队学习这些协议的方式是零散的文档、过时的博客和从不解释"为什么"的厂商手册。

这本书填补了中文世界的空白：**一份把原理、协议、工程实践与前沿趋势完整串联的系统性中文资料。**

| 你需要…… | 这本书提供 |
|----------|-----------|
| 协议深度解读 | OAuth 2.0 / 2.1、OIDC、SAML 2.0、LDAP、SCIM——含安全边界、常见误区和真实流程 |
| 工程落地配方 | Keycloak Operator、Helm Chart、反向代理配置、高可用搭建、监控——可直接复制使用 |
| 选型决策框架 | Keycloak vs CAS vs Dex vs Casdoor——横向对比与选型标准 |
| 架构模式 | 网关集成、BFF、Sidecar、多租户账号设计、联邦拓扑 |
| 前沿知识 | 零信任、DID/VC、ReBAC、Passkey/WebAuthn——独立成章，不是脚注 |

## 内容结构

全书共 **5 部分、24 章、约 13 万字**，附术语速查表。

| 部分 | 章节 | 涵盖内容 |
|------|------|----------|
| 📘 第一部分：IDaaS 基础 | 1–4 | IAM 核心理念、认证 vs 授权、身份生命周期 |
| 📗 第二部分：协议与标准 | 5–9 | OAuth 2.0/2.1、OpenID Connect、SAML 2.0、LDAP、SCIM |
| 📙 第三部分：核心能力 | 10–13 | SSO、MFA、身份联邦、审计与合规 |
| 📕 第四部分：实现与实践 | 14–19 | Keycloak、Apereo CAS、Dex、方案对比、集成模式、K8s 部署 |
| 📓 第五部分：高级主题 | 20–24 | RBAC/ABAC/ReBAC、安全、DID/VC、零信任、性能扩展 |
| 📎 附录 | — | IDaaS 核心术语速查表 |

<details>
<summary>📖 完整目录</summary>

**第一部分 · IDaaS 基础**
- 第 1 章：什么是 IDaaS —— 定义、演进与核心价值
- 第 2 章：IAM 核心理念 —— AAA 模型、设计原则与架构
- 第 3 章：认证与授权深度辨析 —— AuthN vs AuthZ
- 第 4 章：身份生命周期管理 —— 从创建到注销的全流程

**第二部分 · 协议与标准**
- 第 5 章：OAuth 2.0 深度解读 —— 授权模式、令牌管理、OAuth 2.1
- 第 6 章：OpenID Connect —— ID Token、UserInfo、发现机制
- 第 7 章：SAML 2.0 —— 断言、绑定、元数据与联邦
- 第 8 章：LDAP 与目录服务 —— Active Directory 集成
- 第 9 章：SCIM 协议 —— 标准化用户配置

**第三部分 · 核心能力**
- 第 10 章：单点登录（SSO）—— 架构模式与会话管理
- 第 11 章：多因素认证（MFA）—— TOTP、FIDO2、自适应认证
- 第 12 章：身份联邦与代理 —— 跨域身份互信
- 第 13 章：审计与合规 —— 等保、ISO 27001、异常检测

**第四部分 · 实现与实践**
- 第 14 章：Keycloak 架构深度解析
- 第 15 章：Apereo CAS —— 教育与企业 SSO
- 第 16 章：Dex 身份代理 —— Kubernetes 原生方案
- 第 17 章：IDaaS 方案全景对比 —— 选型决策框架
- 第 18 章：集成模式与实践 —— 网关、BFF、Sidecar
- 第 19 章：Kubernetes 生产环境部署

**第五部分 · 高级主题**
- 第 20 章：授权模型深度对比 —— RBAC、ABAC、ReBAC
- 第 21 章：IDaaS 安全最佳实践
- 第 22 章：性能与扩展性
- 第 23 章：去中心化身份与可验证凭证
- 第 24 章：零信任与身份驱动安全

</details>

## 适合谁读

需要系统掌握企业身份知识、又不想被语言障碍挡在门外的中文读者：

- 🏗️ **架构师 / 技术负责人**——规划 SSO、身份中台、权限治理方案
- 🔐 **安全团队**——MFA、审计合规、零信任、身份联邦
- 🧑‍💻 **后端 / 平台工程师**——对接 OAuth、OIDC、SAML、Keycloak 等
- 🧭 **SaaS / 平台团队**——多租户账号设计、RBAC、用户生命周期
- 🆕 **IAM 初学者**——建立完整的身份领域知识体系

## 推荐阅读路线

| 你的目标 | 从这里开始 |
|----------|-----------|
| 快速建立体系 | [简介与阅读指南](https://idaas.xlabs.club/docs/guides/introduction/) → 第 1–9 章 |
| 做 SSO / 协议接入 | OAuth 2.0 → OpenID Connect → SAML → SSO → 集成模式 |
| 做身份平台选型 | Keycloak 架构 → CAS / Dex → 方案对比 → K8s 部署 |
| 做权限治理 | AuthN vs AuthZ → RBAC/ABAC/ReBAC → 审计与合规 |
| 做安全增强 | MFA → 安全最佳实践 → 零信任 |

## 🌐 在线阅读

**[idaas.xlabs.club](https://idaas.xlabs.club)**——支持全文搜索、暗色模式、目录导航。随 `main` 分支自动部署。

## 🚀 本地开发

基于 [Hugo](https://gohugo.io/) + [Doks](https://github.com/thuliteio/doks) 主题构建。

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器 → http://localhost:1313
npm run build        # 生产构建 → public/
```

需要 Node.js 26 和 Hugo Extended。

## 🤝 贡献

本书持续完善中，欢迎参与：

- **发现错误？** → [提交 Issue](https://github.com/l10178/idaas-book/issues)
- **想补充内容？** → [提交 Pull Request](https://github.com/l10178/idaas-book/pulls)
- **有想看的主题？** → 在 Issue 中标记 `discussion`

PR 请遵循现有 frontmatter 规范（`title`、`description`、`weight`、`menu`、`toc`），保持章节编号与排版风格一致。

## 📊 为什么 Star 这个仓库

如果你正在做身份相关工作——或者知道自己将来会做——Star 这个仓库意味着：

- 📌 收藏一份持续更新的系统性参考
- 🔔 获取新章节和协议变更的通知
- 📈 帮助更多中文工程师发现这份资源

**没有付费墙，没有注册要求，没有厂商锁定。** 就是一本想把事情讲清楚的书。

## ⚖️ 许可协议

内容：[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用 4.0 国际）。  
站点脚手架：遵循上游 [Doks](https://github.com/thuliteio/doks) 许可。

---

> 🧭 *"信任很难，知道该信任谁更难。"*——这本书帮你理清两者。
