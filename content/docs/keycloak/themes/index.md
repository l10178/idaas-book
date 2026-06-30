---
title: "Keycloak 主题定制"
description: "Keycloak 主题（Themes）定制实战：login/account/admin/email 四类主题、FreeMarker 模板结构、message bundle 国际化与中文化、CSS/JS 资源覆盖、Keycloakify（React）现代方案、打包部署与缓存刷新"
date: 2024-04-01T00:00:00+08:00
draft: false
weight: 20
menu:
  docs:
    parent: "keycloak-22e9ba8aefa7ef9891199cf8db3a08cd"
    identifier: "keycloak-themes"
toc: true
---

Keycloak 的界面层由 **Themes（主题）** 驱动，基于 FreeMarker（FTL）模板渲染。通过自定义主题，可以让登录页、账户中心、管理控制台和邮件通知贴合企业品牌，并修正官方中文翻译不符合国人习惯的问题。本节先讲传统的 FTL 主题结构、定制流程与生产部署实践，再介绍现代替代方案 [Keycloakify](https://github.com/keycloakify/keycloakify)——用 React 编写主题，并给出两者选型对比。

## 主题类型

Keycloak 内置四类主题，可分别独立覆盖：

| 主题类型 | 作用域 | 对应 URL | 说明 |
|---------|--------|----------|------|
| `login` | 登录 / 注册 / OTP / 忘记密码等认证流程页 | `/realms/{realm}/protocol/openid-connect/auth` | 最常定制的一类 |
| `account` | 用户账户自助中心 | `/realms/{realm}/account` | 用户管理凭证、设备、会话 |
| `admin` | 管理控制台（Angular SPA） | `/admin` | 仅能微调，不建议深度改 |
| `email` | 邮件正文模板 | 邮件通知 | 纯文本/HTML 模板 |

> 自 Keycloak 17（Quarkus）起，Account Console v2 已迁移为基于 React 的 SPA，仅支持通过主题资源做有限覆盖；登录主题仍是 FreeMarker，定制自由度最高。

## 主题目录结构

一个自定义主题的目录结构如下：

```
themes/
└── mybrand/                    # 主题名
    ├── login/                  # 类型：login
    │   ├── theme.properties    # 主题元信息
    │   ├── resources/
    │   │   ├── css/
    │   │   │   └── styles.css
    │   │   ├── js/
    │   │   │   └── script.js
    │   │   └── img/
    │   │       └── logo.png
    │   └── *.ftl               # 覆盖的 FreeMarker 模板（按需）
    ├── account/
    │   └── theme.properties
    └── email/
        ├── theme.properties
        └── html/
            └── email-verification.ftl
```

### theme.properties

```properties
# 主题元信息
parent=keycloak                   # 继承官方 base 主题，只覆盖差异
import=common/keycloak            # 引入公共资源

# 样式与脚本
styles=css/login.css css/styles.css
scripts=js/script.js

# 自定义变量
brandName=我的企业
logoUrl=https://example.com/logo.png
```

`parent=keycloak` 是关键技巧：**只覆盖你要改的文件，其余自动继承**官方主题，升级 Keycloak 时改动面最小。

## 登录页定制示例

### 1. 覆盖登录模板

从官方主题拷贝 `login/login.ftl` 到自己的主题目录，按需修改。例如在表单上方插入品牌 Banner：

```html
<!-- themes/mybrand/login/login.ftl -->
<#macro registrationLayout bodyClass="" displayInfo=false>
  <#-- 引入 base 布局 -->
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${realm.displayName!"Keycloak"} 登录</title>
    <link rel="stylesheet" href="${url.resourcesPath}/css/styles.css">
  </head>
  <body>
    <div class="brand-banner">
      <img src="${url.resourcesPath}/img/logo.png" alt="${properties.brandName!}">
      <h1>${properties.brandName!"Keycloak"}</h1>
    </div>
    <div class="kc-form">
      <#nested "form">          <!-- 实际表单内容注入点 -->
    </div>
  </body>
  </html>
</#macro>
```

### 2. 自定义 CSS

```css
/* themes/mybrand/login/resources/css/styles.css */
:root {
  --brand-primary: #1a73e8;
}
body {
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}
.brand-banner { text-align: center; padding: 1.5rem 0; }
.kc-form {
  max-width: 380px; margin: 0 auto;
  background: #fff; border-radius: 8px; padding: 2rem;
  box-shadow: 0 2px 12px rgba(0,0,0,.08);
}
```

## 消息与国际化（中文化）

Keycloak 的文案来自 **message bundle**。新建 `messages_*.properties` 即可覆盖或补充翻译：

```
themes/mybrand/login/
└── messages/
    ├── messages.properties          # 默认（英文）
    └── messages_zh_CN.properties    # 简体中文
```

```properties
# messages_zh_CN.properties
username=用户名
password=密码
doLogIn=登录
doRegister=注册
forgotPassword=忘记密码？
loginTotpTitle=双因子认证（OTP）
errorInvalidUser=用户名或密码错误
kcErrorTitle=出错了
```

> **技巧**：Keycloak 自带的中文翻译偏机翻、不符合国人习惯。先从官方 base 主题拷贝 `messages_zh_CN.properties` 全量覆盖，再逐条润色，是社区最常用做法（也是本书项目发起的初衷之一）。

### 多语言切换

在 Realm → Themes 中可分别指定 `Internationalization Enabled = ON`，并在主题中渲染语言下拉：

```html
<#if realm.internationalizationEnabled>
  <div class="locale">
    <#list locale.supported as l>
      <a href="${l.url}">${l.label}</a>
    </#list>
  </div>
</#if>
```

## 邮件主题定制

邮件主题位于 `email/html/*.ftl` 与 `email/text/*.ftl`，常见模板：

| 模板文件 | 触发场景 |
|---------|---------|
| `email-verification.ftl` | 注册邮箱验证 |
| `email-update-confirmation.ftl` | 邮箱变更确认 |
| `password-reset.ftl` | 忘记密码重置 |
| `executeActions.ftl` | Required Action（如强制改密） |
| `identity-provider-link.ftl` | 身份提供商账号关联 |

可用的变量包括 `${user.username}`、`${realm.displayName}`、`${link}`、`${linkExpiration}` 等。

## 现代方案：用 Keycloakify 以 React 编写主题

传统 FTL 主题够用，但有两个固有痛点：**FreeMarker 不是组件化技术**，复杂登录流（多步骤、动态表单、复用既有设计系统）难以维护；**无类型安全**，模板变量名写错只能在运行时才暴露。社区项目 [Keycloakify](https://github.com/keycloakify/keycloakify) 用 **React + TypeScript** 重新定义了主题开发体验，是目前最主流的「现代主题」方案。

### 它是怎么工作的

Keycloakify 的核心思路是「**保留 Keycloak 的数据契约，替换渲染层**」：

1. Keycloak 仍按 FTL 主题流程把上下文（`realm`、`client`、`url`、`user`、`messages`、`locale` 等）准备好。
2. Keycloakify 提供一层极薄的 FTL 垫片，把上述上下文序列化为 JSON，注入页面。
3. 你用 React 组件读取这个 **`kcContext`**（强类型）对象渲染 UI——拿到的是和 FTL **完全相同**的数据，能力不缩水。
4. `npm run build` 产出一个标准 **Keycloak 主题 JAR**，部署方式与传统主题一致（放入 `providers/`）。

也就是说，Keycloakify 没有绕过 Keycloak 的主题体系，而是把「写 FTL」换成了「写 React」，产物仍是 Keycloak 原生认得的主题 JAR。

### 支持的主题类型

| 主题类型 | Keycloakify 支持 | 说明 |
|---------|------------------|------|
| `login` | ✅ 完整支持 | 主战场：登录、注册、OTP、忘记密码、社交登录等所有页面 |
| `email` | ✅ 支持 | 可用 React/TypeScript 编写邮件模板 |
| `account` | ⚠️ 有限 | Keycloak 25+ 官方 Account Console 已是 React SPA；Keycloakify 推荐聚焦 login，账户中心优先用官方或谨慎覆盖 |
| `admin` | ❌ 不支持 | 管理控制台是独立 SPA，无论传统还是 Keycloakify 都不建议深度改 |

### 快速开始

基于官方 starter 初始化一个 Keycloakify 项目（推荐直接克隆 starter 仓库，环境最稳）：

```bash
# 方式一：克隆官方 starter（React + Vite + TypeScript）
git clone https://github.com/keycloakify/keycloakify-starter my-brand-theme
cd my-brand-theme
rm -rf .git && git init
npm install

# 方式二：在已有项目中接入
# 参考官方文档执行 keycloakify 的 initialize 步骤
```

项目结构大致如下（具体目录随 starter 版本略有差异）：

```
src/
├── keycloak-theme/
│   ├── login/                  # 登录主题各页面（React 组件）
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   └── KcContext.tsx       # 强类型 kcContext 定义
│   └── email/                  # 邮件主题
├── i18n/                        # 多语言文案
└── index.ts
```

### 读取 Keycloak 上下文（kcContext）

每个页面对应一个 React 组件，通过 `useKcContext()` 拿到强类型上下文（具体导入路径随你的 starter 布局而定）：

```tsx
import { useKcContext as useKcContextBase } from "keycloakify/login/useKcContext";
import type { KcContext } from "keycloak-theme/login/KcContext";

export default function Login() {
  const { kcContext } = useKcContextBase<KcContext>();

  // 与 FTL 完全一致的变量
  const realmName  = kcContext.realm.displayName ?? "Keycloak";
  const loginUrl   = kcContext.url.loginAction;     // 表单提交地址
  const isSocial   = kcContext.client !== undefined;
  const msg        = kcContext.messages;            // 国际化文案（带类型）

  return (
    <form action={loginUrl} method="post">
      <h1>{msg("loginTitleHtml", realmName)}</h1>
      <input name="username" placeholder={msg("username")} />
      <input name="password" type="password" placeholder={msg("password")} />
      <button type="submit">{msg("doLogIn")}</button>
    </form>
  );
}
```

> `msg(...)` 是 Keycloakify 提供的国际化函数，背后仍读 Keycloak 的 message bundle，并在此基础上叠加你在 React 里定义的额外文案，类型安全。

### 开发与调试：Storybook + Mock 上下文

Keycloakify 内置 **Storybook** 集成，可脱离真实 Keycloak 用 mock 的 `kcContext` 调样式、热更新：

```bash
npm run storybook   # 浏览器打开，逐页面预览不同上下文形态
npm run build       # 产出 dist_keycloak/keycloak-theme-*.jar
```

部署：把产出的 JAR 放入 Keycloak `providers/` 目录，Realm → Themes 选择该主题，与传统主题完全一致。

### Keycloakify vs 传统 FTL 主题

| 维度 | 传统 FTL 主题 | Keycloakify（React） |
|------|--------------|----------------------|
| 模板语言 | FreeMarker（.ftl） | React + TypeScript |
| UI 复用 | 难，FTL 片段复用有限 | 组件化，可复用既有设计系统 |
| 状态/交互 | 无前端状态，靠原生 JS 拼 | React state/effect，天然适合多步骤流 |
| 类型安全 | 无，变量名写错运行时才报错 | `kcContext` 强类型，IDE 自动补全 |
| 开发体验 | 改完刷新 + 清缓存 | Storybook 热更新 + mock 上下文 |
| 产物 | 主题目录 / JAR | 主题 JAR（部署方式相同） |
| 学习成本 | 需学 FTL + Keycloak 模板变量 | 会 React 即可上手 |
| 升级维护 | Keycloak 模板变量变更需手改适配 | 升级 `keycloakify` 依赖适配新页面 |
| Admin 主题 | 不支持 | 不支持 |
| 适用场景 | 小幅品牌化、改文案、零构建依赖 | 深度定制登录 UI、复用 React 设计系统 |

### 选型建议

- **选传统 FTL**：只改 logo / 配色 / 文案，团队不熟 React，追求零构建依赖、最小依赖链。
- **选 Keycloakify**：登录流 UI 复杂（多步骤、风控验证、动态字段），想复用既有 React 组件库，或需要类型安全与组件化维护体验。

两者不互斥：很多团队用传统主题做 `account`/`email`，用 Keycloakify 做 `login`，按主题类型各取所长。

### 注意事项与局限

- **Admin 控制台不可定制**，Keycloakify 也无能为力。
- **新登录页要重建 JAR**：Keycloak 新增登录页面时，需升级 `keycloakify` 重新构建以纳入，否则该页回退到默认主题。
- **客户端渲染**：React 在浏览器侧渲染，登录页首屏 HTML 由垫片注入；登录页非 SEO 关键页，影响可忽略。
- **版本对齐**：Keycloakify 各版本适配特定 Keycloak 版本范围，升级 Keycloak 时同步核对 [Keycloakify 版本兼容表](https://github.com/keycloakify/keycloakify)，避免页面缺失或上下文字段错位。
- **JAR 体积**：含 React 运行时，比纯 FTL 主题大，生产可启用代码分割 / 按需加载。

## 启用与部署

### 在控制台启用主题

Realm → **Themes** 标签，分别设置：

- Login Theme: `mybrand`
- Account Theme: `mybrand`
- Admin Theme: `mybrand`（可选）
- Email Theme: `mybrand`

### 部署方式

**方式一：直接放目录**（容器单机）

把 `themes/mybrand` 挂载到容器 `/opt/keycloak/themes/mybrand`：

```bash
docker run -p 8080:8080 \
  -v $(pwd)/themes/mybrand:/opt/keycloak/themes/mybrand \
  quay.io/keycloak/keycloak:latest start-dev
```

**方式二：打成 JAR**（推荐，适合 K8s / 集群）

```
mytheme.jar
└── META-INF/
    ├── keycloak-themes.json
    └── resources/
        └── themes/mybrand/...
```

`keycloak-themes.json`：

```json
{
  "themes": [
    { "name": "mybrand", "types": [ "login", "account", "email" ] }
  ]
}
```

打成 JAR 后放入 `providers/` 目录，Keycloak 启动时自动加载，便于通过 Helm/Operator 统一分发。

### 缓存刷新

开发期模板修改不生效，是因为主题资源被缓存。两种刷新方式：

```bash
# 方式一：启动时禁用主题缓存（仅开发）
kc.sh start-dev --theme-cache-themes=false --theme-cache-templates=false

# 方式二：Realm 设置中勾选 "Refresh Theme Cache"，或重启服务
```

## 生产实践清单

- ✅ 始终 `parent=keycloak` 继承官方主题，只覆盖差异，降低升级成本。
- ✅ 中文 message bundle 全量拷贝后逐条润色，避免机翻感。
- ✅ 静态资源（logo、favicon、字体）走 CDN 或打进 JAR，避免随容器漂移。
- ✅ 登录页加企业备案号、隐私政策链接（合规要求）。
- ✅ 主题版本随 Keycloak 升级回归测试——模板变量在新版本可能变更。
- ✅ 不要深度定制 `admin` 主题（Angular SPA），官方升级会覆盖逻辑。
- ✅ 复杂登录 UI 优先评估 [Keycloakify](https://github.com/keycloakify/keycloakify)，升级 Keycloak 时同步核对版本兼容性。

## 小结

主题定制是 Keycloak 最直观的能力出口。传统路径掌握「继承 + 覆盖」模式、message bundle 国际化、JAR 打包部署三件套即可交付品牌化与中文化的登录体验；若登录 UI 复杂或需复用 React 设计系统，[Keycloakify](https://github.com/keycloakify/keycloakify) 是更现代、类型安全的选择，两条路产物同为 Keycloak 原生主题 JAR，可按主题类型混用。下一节我们转向另一条自动化路径——Admin REST API。