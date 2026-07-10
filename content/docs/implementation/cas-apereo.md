---
title: "第15章：Apereo CAS — 开源企业级 SSO 与 CAS 协议详解 | IDaaS Book"
description: "Apereo CAS 开源企业级单点登录架构深度解析：核心组件设计原理、生产环境部署实战、多协议支持与适用场景评估"
date: 2024-04-02T00:00:00+08:00
draft: false
weight: 42
menu:
  docs:
    parent: "implementation"
    identifier: "cas-apereo"
toc: true
---

## 15.1 CAS 简介

Apereo CAS（Central Authentication Service）是教育和技术社区最古老、最广泛使用的开源 SSO 解决方案之一。始于耶鲁大学（2002年），现由 Apereo 基金会维护。

CAS 的定位是：**专注于 Web SSO 的认证服务器**，提供了丰富的协议支持和现代的身份管理能力。

## 15.2 CAS 与 Keycloak 的定位差异

| 维度 | CAS | Keycloak |
|-----|-----|----------|
| 起源 | 教育领域（耶鲁大学） | 企业领域（Red Hat） |
| 设计哲学 | 高度可配置，Assembly Line | 开箱即用，约定优于配置 |
| 扩展方式 | 依赖注入，丰富的模块 | SPI 机制 |
| 用户管理 | 委派给外部源 | 自有用户存储 + 联合 |
| 协议支持 | CAS 协议、SAML 2.0、OIDC、OAuth 2.0、WS-Federation | OIDC、OAuth 2.0、SAML 2.0（不原生支持 WS-Fed）|
| 文档质量 | 一般 | 好 |
| 社区 | 教育+研究机构为主 | 更广泛的企业社区 |
| 容器化友好度 | 需要定制构建 | 原生支持 |

**选型建议**：
- 如果你的环境主要是 Java 生态，需要高度定制化 → CAS
- 如果你需要快速部署，开箱即用 → Keycloak
- 如果你在教育领域，已有 CAS 基础设施 → 继续用 CAS

## 15.3 CAS 架构

### 核心设计：Assembly Line

CAS 使用"装配线"模式处理认证请求：

```
请求 → [解析器] → [服务管理] → [认证引擎] → [策略引擎] → [主题] → [审计] → 响应
         │                      │
    这是什么服务？           用户如何认证？
```

CAS 6.x 基于 Spring Boot / Spring Cloud，整个系统高度模块化。当前 Apereo CAS 主线已演进到 7.x（基于 Spring Boot 3.x、要求 Java 17+），6.x 已逐步停止维护，新项目建议直接基于 7.x LTS。

### 核心组件

**Central Authentication Service (CAS Server)**：
- 基于 Spring Webflow 的 Web 应用
- 通过 WAR Overlay 方式部署
- 内置丰富的认证处理器（LDAP、JDBC、X.509、多种 MFA、社交 IdP 等）

**Service Registry**：
- 管理哪些服务可以使用 CAS
- 支持 JSON、YAML、LDAP、MongoDB、JPA 等多种存储

**Ticket Registry**：
- 管理 TGT（Ticket Granting Ticket）和 ST（Service Ticket）
- 支持内存、Hazelcast、Redis、Memcached 等

## 15.4 CAS 协议

CAS 协议是 CAS 自有的 SSO 协议（不要与 CAS 软件混淆）。

### 核心流程

```
1. 用户访问 Service-A（如 Jira）
2. Service-A 重定向到 CAS Server
3. 用户认证，获得 TGT Cookie（存在浏览器）
4. CAS 签发 ST（Service Ticket），重定向回 Service-A
5. Service-A 将 ST 发送到 CAS Server 验证
6. CAS 验证后返回用户身份信息

后续访问 Service-B：
1. 用户访问 Service-B
2. Service-B 重定向到 CAS Server
3. CAS 看到浏览器已有 TGT → 直接签发 ST
4. 用户无缝登录 Service-B
```

### CAS v1 / v2 / v3 协议区别

- **CAS v1**：仅返回用户 principal（纯文本）
- **CAS v2**：XML 响应，支持属性，并引入 PGT/PT 代理认证机制
- **CAS v3**：支持 JSON 响应，属性语义增强，代理认证链（proxy chain）完善

## 15.5 Docker 部署

CAS 提供 Docker 基础镜像，但通常需要基于 Overlay 自定义：

> 下例以 6.6 仅为写法示意；6.6 已进入维护尾声，生产请改用当前 7.x LTS 镜像，并按 7.x 的 Spring Boot 3 / Java 17+ 要求调整 Overlay。

```dockerfile
FROM apereo/cas:6.6    # 示例，生产建议升级到 7.x LTS

# 复制配置文件
COPY etc/cas/config/ /etc/cas/config/
COPY build/libs/cas.war /cas-overlay/

# 自定义启动配置
ENV CAS_CONTEXT_PATH="/cas"
ENV SERVER_PORT=8443
ENV SPRING_PROFILES_ACTIVE="standalone"

EXPOSE 8443
CMD ["run"]
```

## 15.6 CAS 最佳实践

1. **使用 WAR Overlay**：不要修改 CAS 源码，通过 Overlay 定制
2. **外部化配置**：所有配置应通过 Spring Cloud Config 或配置文件管理
3. **票据注册中心**：生产环境使用 Redis，而不是内存
4. **日志聚合**：CAS 日志应该集中收集
5. **监控**：CAS 提供 Actuator 端点，可暴露 Prometheus 指标

## 15.7 小结

Apereo CAS 在教育和技术社区拥有深厚的用户基础。虽然 Keycloak 在新项目中更受欢迎，但 CAS 的高度可定制性和广泛的协议支持在某些场景中无可替代。如果要与现有的 CAS 生态集成，或者在需要同时支持多种"非标准"认证方式的环境中，CAS 是很好的选择。
