---
title: "简介与阅读指南"
description: "IDaaS 身份即服务一书简介：定位、适合人群与按角色的阅读路径"
summary: ""
date: 2024-04-01T00:00:00+08:00
lastmod: 2024-04-01T00:00:00+08:00
draft: false
images: []
menu:
  docs:
    parent: ""
    identifier: "introduction-6a1a6be4373e933280d78ea53de6158e"
weight: 10
toc: true
---

这是一本关于**身份即服务（IDaaS）**的中文开源技术书。从 IAM 基础原理，到 OAuth 2.0 / OIDC / SAML 协议深度解读；从 Keycloak、CAS、Dex 开源方案剖析，到 Kubernetes 生产部署与零信任架构——试图把原理、协议、工程实践与前沿趋势串联成一条主线。

## 适合谁读

- 🆕 **IDaaS / IAM 初学者**：想建立完整的身份领域知识体系
- 🧑‍💻 **后端与平台工程师**：正在接入 SSO、OAuth、OIDC，需要理解协议细节
- 🏗️ **架构师 / 技术负责人**：要做身份中台选型、生产部署与安全合规决策
- 🔐 **安全工程师**：关注零信任、MFA、授权模型与审计合规

## 按角色的阅读路径

全书共 5 个部分、24 章，可按需选读：

| 你的角色 | 推荐路径 |
|---------|---------|
| 初学者 | 第 1–4 章（基础）→ 第 5–9 章（协议）→ 第 10–13 章（核心能力），顺序通读 |
| 后端 / 平台工程师 | 第 5–6 章（OAuth/OIDC）→ 第 10 章（SSO）→ 第 18 章（集成模式）→ [Keycloak 实战指南]({{< relref "docs/keycloak/_index.md" >}}) |
| 架构师 / 选型 | 第 14–17 章（方案对比与部署）→ 第 20 章（授权模型）→ 第 22 章（性能扩展） |
| 安全工程师 | 第 11 章（MFA）→ 第 13 章（审计合规）→ 第 21 章（安全实践）→ 第 24 章（零信任） |

> 想直接动手：从 [Keycloak 实战指南]({{< relref "docs/keycloak/_index.md" >}}) 的「简介」开始，配合 [第14章]({{< relref "docs/implementation/keycloak-architecture.md" >}}) 的架构解析即可快速搭出一套可用的 IDaaS。完整目录见站点首页。
