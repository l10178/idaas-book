---
title: "密码策略"
date: 2020-12-14T23:54:37+08:00
draft: false
---

密码策略，常见的如密码最小长度、必须包含特殊字符、密码不能与历史密码相同等。控制用户在修改密码时，新密码必须满足一定的条件，从而增强密码安全。

Keycloak 内置了丰富的密码策略，满足常用的需求，不过默认都是不启用的，需要管理员主动设置。

启用方式，单击 `Authentication` 菜单，选择 `Password Policy` 选项卡。 在右侧下拉列表框中选择要添加的策略。根据策略提示设置不同的参数，保存。

密码策略只对新创建用户，或者用户修改密码生效，对已有用户不生效。如果想更快生效，就强制用户必须修改密码，在用户的 `Required User Actions` 里增加 `Update Password` 。

## 密码策略类型

- HashAlgorithm

  哈希算法，密码加密算法，以此算法存储，可根据官方指导自己实现算法。

- Hashing Iterations

  哈希次数，指定密码在存储或验证之前被哈希的次数。
  多次哈希防止数据库泄露后，密码被暴力破解。哈希次数越多安全性越高，性能越差。

- Minimum Length

  密码最小长度。加大密码长度才是最有效的安全措施，什么大小写数字都是骗人的。

- Digits

  密码里必须包含 N 个数字。

- Lowercase Characters

  密码里必须包含 N 个小写字母。

- Uppercase Characters

  密码里必须包含 N 个大写字母。

- Special Characters

  密码里必须包含 N 个特殊字符，特殊字符如 `?!#%$` 。

- Not Username

  不能是当前用户名。

- Not Email

  不能是当前用户的邮箱。

- Regular Expression

  正则表达式，用 `java.util.regex.Pattern` 解析。

- Expire Password

  密码有效期，过期时间， N 天。超过这个时间后，用户必须修改密码。

- Not Recently Used

  密码历史，不能是最近使用过的 N 个密码。

- Password Blacklist

  密码黑名单，比如不能是常见的 `admin,test,123456` 等等，通过文件定制黑名单列表。
