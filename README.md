# idaas-book

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml)
![GitHub Repo stars](https://img.shields.io/github/stars/l10178/idaas-book)
![GitHub contributors](https://img.shields.io/github/contributors/l10178/idaas-book)
[![GitHub release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)

A book about identity as a service (IDaaS).

一本关于身份即服务的书，翻译和汇总 IAM、IDaaS、OAuth2 等相关专业知识，介绍相关的 keycloak、CAS、Dex 等软件，记录使用中遇到的问题和解决方案。

## 贡献者指南

本项目使用 [Hugo][] 开发，使用 [Doks][] 作为 Hugo 主题，一切内容都是 Markdown，专心写文字即可。

本地开发时需要先安装 Nodejs，然后使用 pnpm（或 npm） 安装 Hugo bin，本地不需要提前安装 Hugo。

```bash
# 安装 npm 依赖包，注意此过程需要连接 github 下载 hugo
pnpm install
# 启动 Web，然后浏览器访问 http://localhost:1313/即可浏览效果
pnpm run dev
# 创建新页面
pnpm run create docs/platform/backstage.md
pnpm run create blog/k8s.md
# 执行代码检查
pnpm run lint
# 编译结果
pnpm run build
```

如果文章中包含图片，提交 Git 前推荐使用 [pngquant][] 先进行无损压缩。

```bash
# 选择自己的文件夹
for file in $(ls *.png)
do
  pngquant $file --force --output $file
done
```

## 贡献者列表

<a href="https://github.com/l10178/idaas-book/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=l10178/idaas-book" />
</a>

## License

本文档采用 [CC BY-NC 4.0][] 许可协议。

[nxest.com]: https://www.nxest.com
[Hugo]: https://gohugo.io/
[Doks]: https://github.com/gethyas/doks
[pngquant]: https://pngquant.org/
[CC BY-NC 4.0]: https://creativecommons.org/licenses/by-nc/4.0/
