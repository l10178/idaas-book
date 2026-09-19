---
title: "Keycloak 暴力破解检测与 IAM 账户锁定策略 | IDaaS Book"
description: "Keycloak 暴力破解检测（Brute Force Detection）配置：IAM 登录失败锁定阈值、指数退避、会话清理、管理员解锁，以及事件来源 IP 被代理吞掉时排错为什么会失效"
date: 2020-12-04T23:54:37+08:00
draft: false
weight: 2
menu:
  docs:
    parent: "keycloak-security-features"
    identifier: "keycloak-brute-force"
toc: true
---

Brute Force Detection 暴力检测，防止密码暴力破解，登录失败 N 次锁定。

## 启用暴力检测

控制台选择 Realm，设置：Realm Settings -> Security Defenses -> Brute Force Detection。

[![Brute Force Detection](./brute-force.png)](./brute-force.png)

- Permanent Lockout

  ON 表示永久锁定。  
  OFF 表示临时锁定。

- Max Login Failures

  登录失败达到多少次时，锁定账号。

- Quick Login Check Milli Seconds

  快速登录检测，两次登录请求之间的时间间隔（单位毫秒）小于该值时，则认定为快速登录。

- Minimum Quick Login Wait

  一旦被认定为快速登录，该账号将被临时锁定为该配置项配置的时长。

## 解除锁定

1. 临时锁定用户，达到锁定时长后，会自动解锁。
2. 管理员在用户列表或用户详情里可以手动解锁。

   [![解除锁定](./unlock-user.png)](./unlock-user.png)

## 注意事项

1. 失败次数统计仅与登录账号相关，与会话无关，关闭重启浏览器，次数不会重置。
2. 用户锁定后，给出的错误提示还是默认的用户名密码错误，就是不想让攻击者知道用户暂时被禁用了。
3. 锁定是按**账号**维度的，不按来源 IP 统计：同一个 IP 换着账号试密码，不会触发锁定。Keycloak 本身没有 IP 维度锁定，需要靠 WAF / 网关限速补。缺的这块反而让「失败事件里的 IP」变得更重要——它是你唯一的事后追溯依据。

## 前提：事件里的来源 IP 必须是真实的

上面「定期检查 `EVENT_LOG` 表中的 `LOGIN_ERROR` 事件」这类做法，成立的前提是事件记录的 `ipAddress` 确实是攻击者地址。Keycloak 在反向代理后如果没配好，这个字段会变成入口代理的地址，于是：

- SIEM 里所有失败登录来自同一个 IP，基于 IP 的封禁和关联分析全部失效；
- 攻击者换账号试探时，日志里看不出「同一来源」这个线索；
- 反过来更糟：伪造 `X-Forwarded-For` 能让记录指向任意地址，把有限的溯源能力也变成误导。

原因是 Keycloak 默认不解析转发头，且一旦设置了 `proxy-headers` 而没限定 `proxy-trusted-addresses`，默认会信任所有来源的转发头。配置与验证方法（含伪造头自测）见 [Keycloak 反向代理真实客户端 IP 与代理信任边界]({{< relref "../../solution-blogs/keycloak-proxy-client-ip-trust" >}})。

## 工作原理

Keycloak 在 Realm 级别维护一个登录失败计数器。当用户在配置的时间窗口内连续登录失败达到阈值时，账户被临时锁定。

```mermaid
sequenceDiagram
    participant U as 用户
    participant K as Keycloak
    U->>K: 1. 输入错误密码
    K->>K: 2. 失败计数 +1
    U->>K: 3. 再次输入错误密码
    K->>K: 4. 失败计数 +1（达到阈值）
    U->>K: 5. 第三次尝试
    K->>U: 6. ❌ 账户已临时锁定
    Note over K: 等待锁定时间过后自动解锁
```

## 配置参数

在 Realm Settings > Security Defenses > Brute Force Detection 中配置：

| 参数 | 建议值 | 说明 |
|------|--------|------|
| Minimum Quick Login Wait | 1 秒 | 两次登录最短间隔，阻止自动化攻击 |
| Max Login Failures | 5 次 | 触发锁定的失败次数 |
| Wait Increment | 1 分钟 | 每次触发后锁定时间递增 |
| Quick Login Check | 1 秒 | 检测快速登录的时间窗口 |
| Max Wait | 15 分钟 | 单次锁定最长等待时间 |
| Failure Reset Time | 12 小时 | 失败计数器重置周期 |
| Permanent Lockout | 关闭 | 不建议开启——需管理员手动解锁 |

## 生产环境建议

- **生产环境务必开启**，配合强密码策略使用
- 监控 `keycloak_login_failures` 指标，设置告警
- 白名单内网 IP 段（通过自定义 Authenticator 实现）
- 结合 WAF/API Gateway 做外层速率限制，Keycloak 做内层账户保护
- 定期检查 `EVENT_LOG` 表中的 `LOGIN_ERROR` 事件，识别被攻击的账号
