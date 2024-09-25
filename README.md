# idaas-book

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml)
![GitHub Repo stars](https://img.shields.io/github/stars/l10178/idaas-book)
![GitHub contributors](https://img.shields.io/github/contributors/l10178/idaas-book)
[![GitHub release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)

A book about identity as a service (IDaaS).

一本关于 IDaaS 身份即服务的书，翻译和汇总 IAM、IDaaS、OAuth2 等相关专业知识，介绍相关的 keycloak、CAS、Dex 等软件，记录使用中遇到的问题和解决方案，让 IDaaS 领域相关的问题更容易理解。

## 前言

为什么写这本书，因为大佬的世界和普通人是割裂的，有人讲协议，有人讲实现，有人讲未来的实现，普通人很难理解。

为什么叫 Book，和我以往的博客体系有什么区别，因为我想系统性的总结关于此类的问题和实践经验，从原理到实践应该是体系化的。

本项目的主语言是中文，因为英文已经被人写了一个遍了，实在是没法超越，不如老老实实的承认人家写的好，咱只是翻译。
如果你在搜索 keycloak 中文、CAS 中文、oauth2 中文，可能会进入本项目，如果不幸这里没有你想要的内容，请提交 issue 或 PR。

## 贡献者指南

本项目使用 [Hugo][] 开发，使用 [Doks][] 作为 Hugo 主题，一切内容都是 Markdown，专心写文字即可。

本地开发时需要先安装 Nodejs 和 Hugo。

```bash
# 安装 npm 依赖包，注意此过程需要连接 github 下载 hugo
npm install
# 启动 Web，然后浏览器访问 http://localhost:1313/即可浏览效果
npm run dev
# 创建新页面
npm run create blog/k8s.md
# 编译结果
npm run build
```

## License

本文档采用 [CC BY-NC 4.0][] 许可协议。

[Hugo]: https://gohugo.io/
[Doks]: https://github.com/thuliteio/doks
[CC BY-NC 4.0]: https://creativecommons.org/licenses/by-nc/4.0/
