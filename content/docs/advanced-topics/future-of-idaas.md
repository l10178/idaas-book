---
title: "第23章：去中心化身份与可验证凭证"
description: "DID、Verifiable Credentials、区块链身份：IDaaS 的下一场范式革命"
date: 2024-05-04T00:00:00+08:00
draft: false
weight: 54
menu:
  docs:
    parent: "advanced-topics"
    identifier: "future-of-idaas"
toc: true
---

## 23.1 当前身份模型的根本缺陷

当前的"中心化 + 联邦"身份模型有三个根本问题：

1. **身份数据被平台控制**：用户的数据存在各个 IdP 上，用户没有真正的所有权。
2. **身份孤岛**：每个平台的用户身份独立存在，无法跨平台携带。
3. **隐私不足**：用户登录行为被 IdP 完全可见（IdP 知道你访问了哪些应用）。

去中心化身份（Decentralized Identity）试图从根本上改变这种模式。

## 23.2 去中心化身份的核心理念

```
传统模型：                     去中心化模型：
                                
  [IdP] 持有你的数据             你持有你的数据
    │                           │
    ├── [App1]                  ├── [App1]
    ├── [App2]        vs.       ├── [App2]
    └── [App3]                  └── [App3]
                                
IdP 是必需的中间人              没有必需的中间人
```

核心理念：
- **用户拥有并控制自己的身份数据**
- **无需依赖中心化的身份提供方**
- **选择性披露**：用户决定分享哪些信息
- **零知识证明**：可以在不泄露信息的情况下证明某件事

## 23.3 DID（Decentralized Identifier，去中心化标识符）

DID 是 W3C 推荐标准（DID Core 1.0，2021 年成为 W3C Recommendation），是一种新型的全球唯一标识符，不由任何中心机构签发。

### DID 的格式

```
did:example:123456789abcdefghi
│   │       │
│   │       └── 方法特定标识符
│   └────────── DID 方法（指定了如何解析 DID）
└────────────── Scheme（固定为 did）
```

### DID 方法

不同的 DID 方法对应不同的底层技术：

| DID 方法 | 底层技术 | 特点 |
|---------|---------|------|
| did:ethr | 以太坊 | 成熟生态，但有 Gas 成本 |
| did:web | HTTPS | 使用现有 Web 基础设施 |
| did:key | 无 | 仅使用公钥，最简单 |
| did:ion | Bitcoin (Sidetree) | 微软主导，高性能 |
| did:indy | Hyperledger Indy | 专为身份设计 |
| did:plc | 无许可账本 | Bluesky 使用的 DID 方法 |

### DID Document

每个 DID 解析到一个 DID Document（JSON）：

```json
{
  "@context": "https://www.w3.org/ns/did/v1",
  "id": "did:example:123456789abcdefghi",
  "verificationMethod": [
    {
      "id": "did:example:123#keys-1",
      "type": "Ed25519VerificationKey2020",
      "controller": "did:example:123",
      "publicKeyMultibase": "zH3C2AVvLMv6gmMNam3uVAjZpfkcJCwDwnZn6z3wXmqPV"
    }
  ],
  "authentication": ["did:example:123#keys-1"],
  "service": [
    {
      "id": "did:example:123#vcs",
      "type": "VerifiableCredentialService",
      "serviceEndpoint": "https://example.com/vc/"
    }
  ]
}
```

## 23.4 可验证凭证（Verifiable Credentials, VC）

### 概念模型

VC 是物理世界凭证（护照、驾照、学位证）的数字等价物：

```
物理世界：                      数字世界：
                               
  [签发者]                        [签发者 DID]
   (政府)                          (政府 DID)
     │                    签署        │
  [驾照]           ←──────→    [可验证凭证]
     │                              │
  [持有者]                        [持有者 DID]
     │                              │
  [出示给酒吧]                    [出示给应用]
                                (ZKP 可选)
```

### VC 的结构

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1"
  ],
  "id": "http://example.com/credentials/3732",
  "type": ["VerifiableCredential", "UniversityDegreeCredential"],
  "issuer": "did:example:university",
  "issuanceDate": "2024-01-01T00:00:00Z",
  "credentialSubject": {
    "id": "did:example:student",
    "degree": {
      "type": "BachelorDegree",
      "name": "计算机科学学士学位"
    }
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2024-01-01T00:00:00Z",
    "verificationMethod": "did:example:university#keys-1",
    "proofValue": "z5pGNgqhr..."
  }
}
```

### 可验证表达（Verifiable Presentation, VP）

持有者将多个 VC 打包成一个 VP 出示给验证者：

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1"
  ],
  "type": "VerifiablePresentation",
  "verifiableCredential": [
    // {大学学位 VC},
    // {身份证 VC}
  ],
  "proof": {
    // 持有者对 VP 的签名，证明他们确实是 VC 的合法持有者
  }
}
```

## 23.5 关键特性

### 选择性披露（Selective Disclosure）

用户可以选择只披露凭证中的部分信息：

"我持有有效的驾照" → 只证明"持有驾照"这个事实，不暴露具体驾照号码、地址等信息。

选择性披露有两类主流技术路线：(1) 基于 ZKP 的签名方案——BBS+（对应 W3C BBS Cryptosuite / BBS-BLS 签名）和 CL 签名（Idemix/Hyperledger Indy 生态）；(2) 基于哈希披露的非 ZKP 方案——**SD-JWT**（IETF 标准化中，已被欧盟 EUDI Wallet 采纳为可验证凭证格式之一）。

### 可撤销

签发者可以撤销已签发的 VC（类似于驾照吊销）。撤销方式包括：

- **撤销列表（Revocation List）**：定期发布的二进制位图
- **Bitstring Status List**（曾名 StatusList2021）：基于压缩位图的高效撤销/状态机制，是 VC 2.0 推荐方式
- **累加器（Accumulator）**：零知识友好的撤销方式

### 过期与续期

VC 可以设置有效期，过期后需要签发者重新签发。

## 23.6 欧盟 eIDAS 2.0 与 EUDI Wallet

欧盟已通过 eIDAS 2.0 法规（Regulation (EU) 2024/2980，对 910/2014 的修订）推动数字身份钱包（EUDI Wallet）的普及，并分阶段强制公私部门接受。要求：

- 每个成员国提供数字身份钱包
- 钱包能存储和出示可验证凭证
- 公私部门都必须接受 EUDI Wallet
- 隐私和选择性披露是核心要求

这对于 IDaaS 产业的影响深远——一旦政府支持的数字身份钱包普及，许多传统的认证场景将被重塑。

## 23.7 对 IDaaS 的影响

### 短期（3-5 年）

- IDaaS 平台逐步支持 DID/VC 作为"另一种认证方式"
- 大企业试点员工数字身份（取代工牌、权限卡）
- 教育和政府领域率先采用 VC

### 中期（5-10 年）

- IDaaS 从"身份数据的保管者"转型为"身份信任的协调者"
- 密码的使用大幅减少，VC 成为 Web 认证的主要方式
- 跨组织、跨国的身份互认大幅简化

### 长期（10 年+）

- 中心化的身份提供方不再是必需品
- 每个个体拥有完全自主的数字身份
- IDaaS 的形态可能从根本上改变

## 23.8 当前挑战

1. **用户体验**：管理私钥对普通用户来说仍然困难
2. **标准化仍在演进**：DID Core 1.0（2021 Recommendation）、VC Data Model 1.1（2022）与 2.0（2024 Recommendation）核心已成正式推荐标准；而选择性披露、BBS、状态机制、可验证凭证 API 等配套规范仍在演进
3. **恢复机制**：设备丢失后如何安全地恢复身份？
4. **法规合规**：GDPR 的被遗忘权与区块链的不可篡改性之间的矛盾
5. **大规模采用**：从"早期采用者"到"主流"还有很长的路

## 23.9 实践建议

对于 IDaaS 实践者：
1. 关注 W3C CCG（Credentials Community Group）和 DIF（Decentralized Identity Foundation）的动态
2. 了解主流实现：Microsoft Entra Verified ID、Hyperledger Aries、Spruce
3. 在 B2B 和合规要求高的场景（如教育、医疗）优先试验 VC
4. 保持务实：DID/VC 是大趋势，但不急着在生产中大规模替换现有体系

## 23.10 小结

去中心化身份代表了身份管理的范式转变——从"平台拥有你的身份"到"你拥有你的身份"。虽然全面采用还需要时间，但 DID 和 VC 提供的隐私保护、数据自主权和跨域互操作性，正在逐步成为 IDaaS 必须正视的未来方向。关注标准进展、参与社区讨论、适时进行 POC 验证，是务实的前进方式。
