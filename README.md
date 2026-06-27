# idaas-book

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml)
![GitHub Repo stars](https://img.shields.io/github/stars/l10178/idaas-book)
![GitHub contributors](https://img.shields.io/github/contributors/l10178/idaas-book)
[![GitHub release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)

## 关于本书

一本关于 **IDaaS（Identity as a Service，身份即服务）** 的完整技术书籍，共 5 个部分、24 章，约 15 万字。

本书从 IAM 基础原理出发，系统性地讲解 OAuth 2.0、OpenID Connect、SAML 2.0、LDAP、SCIM 等核心协议，深入剖析 SSO、MFA、身份联邦等核心能力，对比 Keycloak、CAS、Dex 等开源方案，并覆盖 Kubernetes 生产部署、授权模型、零信任和去中心化身份等高级主题。

## 内容结构

| 部分 | 内容 |
|------|------|
| 第一部分：IDaaS 基础 | IDaaS 定义与演进、IAM 核心概念、AuthN vs AuthZ、身份生命周期 |
| 第二部分：协议与标准 | OAuth 2.0、OpenID Connect、SAML 2.0、LDAP、SCIM |
| 第三部分：核心能力 | SSO、MFA、身份联邦与代理、审计与合规 |
| 第四部分：实现与实践 | Keycloak 架构、Apereo CAS、Dex、IDaaS 方案对比、集成模式、K8s 部署 |
| 第五部分：高级主题 | 授权模型、安全最佳实践、性能扩展、去中心化身份、零信任 |
| 附录 | IDaaS 核心术语速查表 |

## 本地开发

本项目使用 [Hugo](https://gohugo.io/) 开发，使用 [Doks](https://github.com/thuliteio/doks) 作为 Hugo 主题。

```bash
# 安装 npm 依赖包
npm install
# 启动本地开发服务器 http://localhost:1313/
npm run dev
# 编译生产版本
npm run build
```

## 贡献

如果你发现了错误或有改进建议，欢迎提交 Issue 或 Pull Request。

## License

本书采用 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) 许可协议。
