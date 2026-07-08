---
title: "解决方案博客"
description: "Keycloak、oauth2-proxy、Nginx Ingress、Traefik ForwardAuth 等身份网关的实战配置与排错指南"
weight: 55
menu:
  docs:
    parent: "solution-blogs"
    identifier: "solution-blogs-index"
---

这部分是「带着问题来，拿着方案走」的实战指南。每篇文章聚焦一个具体的集成场景：出问题怎么办、最小配置怎么写、怎么验证配对了、配错了什么症状、怎么回滚。

与前面章节的理论和架构介绍不同，这里的文章结构统一为：场景描述 → 适用/不适用 → 最小配置 → 验证 → 常见错误表 → 回滚方式。

**已覆盖主题：**

| 主题 | 关键词 |
|------|--------|
| [Keycloak + oauth2-proxy 集成指南]({{< relref "keycloak-oauth2-proxy" >}}) | OIDC, audience, CSRF, redirect loop, Nginx Ingress, ForwardAuth |
| [Keycloak 重定向循环与 401 排错指南]({{< relref "keycloak-redirect-loop-troubleshooting" >}}) | ERR_TOO_MANY_REDIRECTS, 401 Unauthorized, Cookie, TLS 终结, SameSite |
| [oauth2-proxy 深度介绍]({{< relref "../implementation/oauth2-proxy-deep-dive.md" >}}) | 架构原理、Provider 选型、Cookie/Session、安全加固、与 Pomerium/Traefik/Nginx 对比 |
