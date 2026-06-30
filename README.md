# IDaaS 身份即服务 · 一本完整的书

> 从 IAM 基础原理，到 OAuth 2.0 / OIDC / SAML 协议深度解读；从 Keycloak、CAS、Dex 开源方案剖析，到 Kubernetes 生产部署与零信任架构——一本系统讲透「身份即服务」的中文开源技术书。

📚 **在线阅读：[idaas.xlabs.club](https://idaas.xlabs.club)**

[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml?label=deploy)](https://github.com/l10178/idaas-book/actions/workflows/gh-pages.yml)
[![GitHub Repo stars](https://img.shields.io/github/stars/l10178/idaas-book?style=social)](https://github.com/l10178/idaas-book/stargazers)
[![GitHub contributors](https://img.shields.io/github/contributors/l10178/idaas-book)](https://github.com/l10178/idaas-book/graphs/contributors)
[![GitHub release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)
[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue)](https://creativecommons.org/licenses/by-nc/4.0/)

---

## 为什么读这本书

身份认证与授权，是几乎所有现代应用都绕不开、却又最容易踩坑的底层基础设施。从一次登录到跨域联邦，从一条 Token 到零信任边界，「身份」已经从单纯的账号密码，演化为整个安全体系的控制平面。

市面上的资料要么零散停留在协议规范，要么只聚焦于某个开源产品的使用手册，缺少一份**把原理、协议、工程实践与前沿趋势串联起来**的系统性中文资料。本书试图填补这个空白：

- **既讲 What，也讲 Why**——不止罗列协议字段，更剖析设计哲学与权衡。
- **既讲原理，也讲落地**——每章配合代码示例、架构图与配置片段。
- **既讲单点方案，也讲选型决策**——对比 Keycloak / CAS / Dex / Casdoor 等主流方案，给出决策框架。

## 适合谁读

- 🆕 **IDaaS / IAM 初学者**：想建立完整的身份领域知识体系
- 🧑‍💻 **后端与平台工程师**：正在接入 SSO、OAuth、OIDC，需要理解协议细节
- 🏗️ **架构师 / 技术负责人**：要做身份中台选型、生产部署与安全合规决策
- 🔐 **安全工程师**：关注零信任、MFA、授权模型与审计合规

## 内容结构

全书共 **5 个部分、24 章、约 13 万字**，附术语速查表。

| 部分 | 章节 | 关键词 |
|------|------|--------|
| 📘 第一部分：IDaaS 基础 | 第 1–4 章 | 定义与演进、IAM 核心理念、AuthN vs AuthZ、身份生命周期 |
| 📗 第二部分：协议与标准 | 第 5–9 章 | OAuth 2.0、OpenID Connect、SAML 2.0、LDAP、SCIM |
| 📙 第三部分：核心能力 | 第 10–13 章 | SSO、MFA、身份联邦与代理、审计与合规 |
| 📕 第四部分：实现与实践 | 第 14–19 章 | Keycloak、Apereo CAS、Dex、方案对比、集成模式、K8s 部署 |
| 📓 第五部分：高级主题 | 第 20–24 章 | 授权模型（RBAC/ABAC/ReBAC）、安全实践、性能扩展、去中心化身份、零信任 |
| 📎 附录 | — | IDaaS 核心术语速查表 |

### 章节速览

<details>
<summary>点击展开完整目录</summary>

**第一部分 · IDaaS 基础**
- 第 1 章：什么是 IDaaS —— 定义、演进与核心价值
- 第 2 章：IAM 核心理念 —— AAA 模型、设计原则与架构
- 第 3 章：认证与授权深度辨析 —— AuthN vs AuthZ
- 第 4 章：身份生命周期管理 —— 从创建到注销的全流程

**第二部分 · 协议与标准**
- 第 5 章：OAuth 2.0 深度解读 —— 授权模式、Token 管理、OAuth 2.1
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

## 本书亮点

- 🧭 **体系完整**：从概念到协议、从能力到工程、从现状到趋势，一条主线贯穿。
- 🔬 **协议深读**：OAuth 2.0 / OIDC / SAML / SCIM 不止讲用法，更讲安全边界与常见误区。
- ⚙️ **工程落地**：Helm / Operator 部署、网关与 BFF 集成、高可用与监控，配套真实配置示例。
- 🧩 **方案对比**：横向对比主流开源 IDaaS，附选型决策框架，避免「只有一个工具」的视角。
- 🛡️ **前沿覆盖**：零信任、去中心化身份（DID / VC）、ReBAC 关系型授权等新趋势独立成章。

## 在线阅读

🌐 托管站点（自动随主分支部署）：**[idaas.xlabs.club](https://idaas.xlabs.club)**

支持全文搜索、目录导航与暗色模式。

## 本地开发

本项目基于 [Hugo](https://gohugo.io/) + [Doks](https://github.com/thuliteio/doks) 主题构建。

```bash
# 安装依赖
npm install

# 启动本地开发服务器 http://localhost:1313/
npm run dev

# 编译生产版本到 public/
npm run build
```

> 需要 Node.js 与 Hugo Extended。详见 [Hugo 官方文档](https://gohugo.io/installation/)。

## 贡献

本书仍持续完善中，欢迎共同打磨：

- 发现错别字、技术谬误或失效链接 → 提交 [Issue](https://github.com/l10178/idaas-book/issues)
- 补充案例、图示或章节 → 欢迎提交 [Pull Request](https://github.com/l10178/idaas-book/pulls)
- 有想看的主题或建议 → 在 Issue 中标记 `discussion`

请确保 PR 中的章节遵循现有 frontmatter 规范（`title` / `description` / `weight` / `menu` / `toc`），并保持章节编号与排版风格一致。

## 致谢

感谢所有为身份与开源社区贡献协议、文档与代码的工程师们——本书站在它们的肩膀上。

如果这本书对你有帮助，欢迎 ⭐ Star 支持，让更多需要的人看到它。

## License

本书内容采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)（署名-非商业性使用 4.0 国际）许可协议。转载请注明出处并保留原始链接，商业使用请先联系作者。

项目源码（Hugo 站点脚手架与配置）沿用上游 [Doks](https://github.com/thuliteio/doks) 的相关许可。