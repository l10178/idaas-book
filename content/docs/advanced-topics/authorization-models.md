---
title: "第20章：授权模型深度对比"
description: "RBAC、ABAC、PBAC、ReBAC 授权模型深度对比：原理、实现与选型指南"
date: 2024-05-01T00:00:00+08:00
draft: false
weight: 51
menu:
  docs:
    parent: "advanced-topics"
    identifier: "authorization-models"
toc: true
---

## 20.1 授权模型的演进

```
1960s-70s  1970s-80s  1990s-2000s   2000s-2010s    2019
   │          │          │              │             │
  DAC        MAC       RBAC           ABAC         ReBAC
(自主)     (强制)    (角色)         (属性)      (关系)
                    NIST 2004     XACML 2003   Google Zanzibar

复杂度递增，精细度递增
```

## 20.2 RBAC（基于角色的访问控制）

### 核心模型

```
用户 ──→ 角色 ──→ 权限

Alice → [经理] → [审批报销, 查看团队报表]
Bob   → [员工] → [提交报销, 查看自己的报表]
```

### RBAC 的三个层次

**RBAC0（基础 RBAC）**：用户 → 角色 → 权限
**RBAC1（层次 RBAC）**：角色之间有继承关系

```
         [员工]
           │
    ┌──────┴──────┐
    │             │
  [组长]       [专员]
    │
  [经理]
    │
  [总监]
```

**RBAC2（约束 RBAC）**：角色互斥（SoD）、基数限制、先决条件

### RBAC 在 Keycloak 中的实现

Keycloak 的 RBAC 由三层组成：

- **Realm Roles**：Realm 级别的角色（全局）
- **Client Roles**：Client 级别的角色（应用特有）
- **Composite Roles**：组合角色（包含其他角色）

结合 Group 实现用户 → 组 → 角色的间接映射。

### RBAC 的局限

- **角色爆炸**：当业务精细化时，角色数量激增
- **静态性**：角色不能根据上下文（时间、位置、设备）动态调整
- **跨域困难**：不同系统的角色体系无法互通

## 20.3 ABAC（基于属性的访问控制）

### 核心模型

不依赖角色，而是根据多维度属性动态决定：

```
策略 = f(主体属性, 客体属性, 环境属性, 操作)

决策: IF
  主体.clearance >= 资源.sensitivity AND
  主体.department == 资源.owner_department AND
  环境.time in BusinessHours AND
  环境.location in TrustedLocations AND
  操作 == "read"
THEN Permit
```

### XACML 标准

XACML（eXtensible Access Control Markup Language）是 ABAC 的标准化实现框架，基于 OASIS 标准：

```
┌──────┐     ┌──────┐     ┌──────┐     ┌──────┐
│ PAP  │────→│ PDP  │────→│ PEP  │────→│ 应用  │
│策略管理│     │策略决策│     │策略执行│     │      │
└──────┘     └──┬───┘     └──────┘     └──────┘
               │
          ┌────┴────┐
          │  PIP    │  ← 策略信息点（属性来源）
          └─────────┘
```

XACML 虽然概念强大，但复杂度高、性能开销大。在新项目中，更多选择 OPA（Open Policy Agent）或基于策略引擎的轻量方案。

### OPA（Open Policy Agent）

OPA 是 CNCF 毕业项目，使用 Rego 语言编写策略：

```rego
package example.authz

import rego.v1

default allow := false

allow if {
    # 用户必须属于被访问部门
    input.user.department == input.resource.department
    # 仅在工作时间（9:00-18:00）
    time.now_ns > input.business_hours.start
    time.now_ns < input.business_hours.end
    # 用户必须是活跃状态
    input.user.active == true
}
```

### ABAC 的优势与挑战

**优势**：
- 极度的灵活性，支持复杂策略
- 不依赖预定义角色
- 支持动态上下文

**挑战**：
- 策略难以可视化和审计（"这个用户最终能做什么？"）
- 策略编写和维护成本高
- 性能开销（每个请求需要评估多个属性）
- 属性来源的可靠性问题

## 20.4 ReBAC（基于关系的访问控制）

### Google Zanzibar

ReBAC 的理论基础来自 Google 的 Zanzibar 论文（2019）。核心思想是用**关系图**来表达权限：

```
关系元组: object⟨relation⟩→user / user_set     即 (客体, 关系, 主体)
（object 是被保护的资源，relation 是关系/权限名，user 或 user_set 是被授权的主体）

示例（Zanzibar 记法）:
- document:123⟨owner⟩→user:Alice
- document:123⟨parent⟩→folder:projects
- document:123⟨editor⟩→user:Bob
- folder:projects⟨viewer⟩→user:Charlie

userset 重写规则（权限由显式定义的重写规则推导，而非关系本身自动继承）:
document:⟨viewer⟩ → document:⟨viewer⟩ ∪ (document.parent:⟨viewer⟩)
即：文档的 viewer = 直接 viewer ∪ 其父文件夹的 viewer

权限推导:
Charlie 能看 document:123 吗？
→ Charlie 是 folder:projects 的 viewer
→ document:123 的 parent 是 folder:projects
→ 经重写规则，folder:projects 的 viewer 被纳入 document:123 的 viewer
→ 因此 Charlie 可以看 document:123 ✓
```

### ReBAC 的核心概念

- **关系元组**：(object, relation, user/user_set)
- **权限是通过关系推导出来的**，不是直接分配的
- **userset 重写规则**：定义了如何根据关系计算权限

### 开源实现

- **OpenFGA**（原 Auth0 FGA）：ReBAC 开源实现，CNCF Sandbox 项目（截至本稿）
- **SpiceDB**（authzed）：受 Zanzibar 启发的权限数据库
- **Ory Keto**：Ory 生态的权限服务

### ReBAC 适合的场景

- 协作工具（Google Docs、Notion）
- 社交网络（Facebook、GitHub）
- 文件系统权限
- 多级组织架构

## 20.5 模型对比

| 维度 | RBAC | ABAC | ReBAC |
|-----|------|------|-------|
| 权限表达 | 角色 → 权限 | 属性条件 | 关系推导 |
| 精细度 | 粗 | 极细 | 中细 |
| 动态性 | 静态 | 高度动态 | 半动态 |
| 实现复杂度 | 低 | 高 | 中 |
| 管理复杂度 | 中（角色管理） | 高（策略管理） | 中（关系管理） |
| 性能 | 好 | 取决于策略复杂度 | 好 |
| 可视化 | 好（角色图） | 困难 | 好（关系图） |
| 适合场景 | 企业内部权限 | 跨域/动态权限 | 协作/社交权限 |

## 20.6 混合模型：Google 的实践

Google 的授权架构同时使用 RBAC 和 ReBAC：

```
Google Cloud IAM：
- RBAC 层面：Predefined Roles (Viewer, Editor, Owner)
- ReBAC 层面：Resource Hierarchy (Organization → Folder → Project → Resource)
- 权限是 RBAC 角色 + 资源层级继承的混合结果
```

## 20.7 实现建议

### 选型决策树

```
应用类型是什么？
├─ 企业内部管理应用
│   └─ RBAC 通常已足够
│
├─ 需要基于时间的权限（如"只能在工作时间访问"）
│   └─ RBAC + OPA/策略引擎（补充动态条件）
│
├─ 协作工具、社交网络
│   └─ ReBAC 更适合
│
├─ 高度监管的行业（金融、医疗）需要极细粒度
│   └─ ABAC (OPA) 或 PBAC
│
└─ 混合场景
    └─ RBAC 做基线 + OPA 做补充策略 + ReBAC 做关系权限
```

### Keep It Simple

- 90% 的场景可以用 RBAC 解决
- 不要过度设计——先确定 RBAC 确实不够用，再考虑 ABAC/ReBAC
- 如果选择了 ABAC，确保有策略测试和可视化
- 无论哪种模型，都要有**默认拒绝 + 最小权限**

## 20.8 小结

授权模型的选择取决于业务的复杂度和场景需求。RBAC 仍然是大多数应用的最佳起点，ABAC 在需要动态、精细控制的场景中发光发热，ReBAC 在强调关系的应用中是自然之选。好的实践是组合使用——RBAC 作为骨架，策略引擎补充动态规则，关系模型处理继承和共享。
