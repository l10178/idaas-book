---
title: "Keycloak User Profile 用正则限制企业邮箱注册 | IDaaS Book"
description: "在 Keycloak Realm settings 的 User profile 中为 email 属性添加 pattern validator，限制注册邮箱后缀，并说明正则边界、验证方法和可绕开的场景。"
date: 2026-07-21T15:40:00+08:00
lastmod: 2026-07-21T15:40:00+08:00
draft: false
weight: 2
menu:
  docs:
    parent: "solution-blogs"
    identifier: "keycloak-user-profile-pattern-validator"
toc: true
---

## 要解决的问题

Keycloak 允许用户自助注册时，默认只验证邮箱格式，不会判断邮箱是否属于你的组织。如果业务只面向公司员工，可以在 Realm 的 User Profile 中给 `email` 属性增加 `pattern` validator，让注册表单拒绝非公司邮箱。

例如，公司域名是 `example.com`，目标是只允许以下地址：

```text
alice@example.com
bob@sub.example.com
```

不允许：

```text
alice@gmail.com
alice@example.com.evil.test
alice@example.com@example.net
```

这个能力适合做**入口筛选**，不等于企业身份认证。邮箱域名能证明“用户填写了这个格式”，不能证明用户拥有这个邮箱，更不能替代企业 IdP、邮箱验证或邀请制注册。

## 在管理控制台中配置

使用具有管理权限的账号进入目标 Realm：

```text
Realm settings → User profile → Attributes → email → Add validator
```

在 validator 类型中选择 `pattern`，将正则表达式填入 `pattern` 配置项。以只允许 `example.com` 及其子域为例：

```regex
^[^@\s]+@([A-Za-z0-9-]+\.)*example\.com$
```

保存后，User Profile 的 `email` 属性应至少有以下逻辑：

```text
Attribute: email
Validator: pattern
pattern: ^[^@\s]+@([A-Za-z0-9-]+\.)*example\.com$
```

如果只允许根域，不允许 `sub.example.com`，使用更窄的表达式：

```regex
^[^@\s]+@example\.com$
```

### 正则各部分的作用

```text
^                         从字符串开头匹配
[^@\s]+                  一个或多个非 @、非空白字符
@                         邮箱分隔符
([A-Za-z0-9-]+\.)*        可选的一个或多个子域
example\.com             精确匹配目标域名中的点
$                         匹配到字符串结尾
```

这里的 `\.` 必须写成“字面量点”。如果写成 `example.com`，正则里的 `.` 会匹配任意字符，可能把 `exampleXcom` 也放进去。`^` 和 `$` 也不能省略，否则只要字符串某一段匹配，整条值可能被错误接受。

## 为什么不直接配置 `.*@example.com`

下面这个表达式看起来能工作，但边界太松：

```regex
.*@example.com
```

它没有约束完整字符串，也允许 `@` 前出现空白或第二个 `@`。对于只做简单前端演示可能够用，但不适合作为企业注册入口的明确规则。

更重要的是，正则 validator 只校验属性值，不负责邮箱验证。用户仍然可能填写一个并不存在的 `someone@example.com`。如果账号必须由员工本人控制，应继续启用邮箱验证，或关闭公开注册改用企业 IdP / 邀请流程。

## 如何验证

不要只在浏览器里看“保存成功”。使用两个正例和几个边界反例测试注册流程：

| 输入 | 预期 |
|---|---|
| `alice@example.com` | 通过 pattern 校验 |
| `alice@sub.example.com` | 根域+子域表达式下通过 |
| `alice@gmail.com` | 拒绝 |
| `alice@example.com.evil.test` | 拒绝 |
| `alice @example.com` | 拒绝 |
| `alice@example.com@example.net` | 拒绝 |

验证时注意两件事：

1. 既要测试自助注册，也要测试 Account Console 或资料编辑入口。User Profile validator 约束的是属性写入，不应只验证某一个页面的前端提示。
2. 用目标 Keycloak 版本实际测试。管理控制台界面和 User Profile 功能在不同版本间可能变化；如果注册由外部应用完成，外部应用也必须处理 Keycloak 返回的校验错误，不能把前端校验当成唯一防线。

## 这个规则的边界

### 不能代替邮箱所有权验证

`pattern` 只判断字符串是否匹配。它不能发送邮件，也不能确认收件人能读取 `example.com` 邮箱。企业场景通常还需要：

- 开启 Verify Email，并确认邮件发送配置可用；或
- 使用企业 IdP 做 OIDC/SAML 登录；或
- 使用邀请制，由管理员预先指定用户和邮箱。

### 不能阻止管理员或后端绕过注册流程

管理员 API、用户导入、联邦身份映射和自定义集成可能走不同的写入路径。要把“只能公司邮箱”作为真正的业务不变量，应在所有创建用户的入口统一约束，并审计导入与同步任务；不能只依赖注册页上的一个 validator。

### 域名规则要先确定

如果公司使用多个域名，不要为了省事写成宽泛的 `@.*`。分别列出允许的域名，并为每个域名写反例。例如：

```regex
^[^@\s]+@(example\.com|example\.cn)$
```

如果还要允许子域，需要明确子域命名规则，避免把内部测试域、拼写相近的域名一起放开。

## 结论

Keycloak User Profile 的 `pattern` validator 适合做企业注册入口的第一道筛选：配置简单，错误能在属性提交时反馈，规则也能随 Realm 配置管理。推荐把它和邮箱验证、企业 IdP 或邀请制结合使用；单独依赖正则，只能限制邮箱字符串的形状，不能建立邮箱所有权或企业成员资格。
