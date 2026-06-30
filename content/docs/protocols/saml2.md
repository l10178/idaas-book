---
title: "第7章：SAML 2.0"
description: "SAML 2.0 安全断言标记语言深度解读：协议流程、断言结构、元数据、与 OIDC 的对比"
date: 2024-02-03T00:00:00+08:00
draft: false
weight: 23
menu:
  docs:
    parent: "protocols"
    identifier: "saml2"
toc: true
---

## 7.1 历史与现状

SAML（Security Assertion Markup Language）是由 OASIS 标准组织制定的基于 XML 的身份联邦协议。SAML 2.0 于 2005 年发布，是 Web 浏览器 SSO 的行业先驱。

尽管 OIDC 在新应用中的采用率已远超 SAML，但 SAML 2.0 在企业级应用中依然占有重要地位。特别是在以下场景：

- 金融、政府、教育等传统行业
- 大型企业的遗留应用
- 需要与 Microsoft AD FS 集成的场景
- 教育和研究联邦（如 eduGAIN、InCommon，基于 Shibboleth）

### SAML vs OIDC 的历史视角

|  | SAML 2.0 | OIDC |
|--|---------|------|
| 发布时间 | 2005 | 2014 |
| 数据格式 | XML | JSON |
| 签名方式 | XML DSig | JWS |
| 加密方式 | XML Enc | JWE |
| 绑定协议 | 重定向、POST、Artifact 等 | HTTP（Redirect/POST，含 form_post/jwt response mode） |
| 移动端支持 | 差 | 好 |
| SPA 支持 | 差 | 好 |
| 复杂度 | 高 | 低 |
| 行业采用 | 传统企业 | 现代应用 |

一句话总结：**遗留系统用 SAML，新系统用 OIDC，作为 IDaaS 平台两者都要支持。**

## 7.2 SAML 的核心概念

### 主体（Subject）

被认证的实体，通常是用户。由 `NameID` 标识。

### 身份提供方（Identity Provider, IdP）

负责认证用户并签发断言的一方。

### 服务提供方（Service Provider, SP）

依赖 IdP 的断言做出授权决定的一方。即用户要访问的应用。

### 断言（Assertion）

SAML 的核心数据单元，是由 IdP 签发的关于用户的安全声明。包含三种语句：

1. **Authentication Statement**：谁在什么时间用什么方式认证了
2. **Attribute Statement**：用户的属性信息
3. **Authorization Decision Statement**：表达授权决策（在 Web SSO 中很少使用，多由 SP 自行做授权决策；规范本身并未废弃）

### 元数据（Metadata）

描述 IdP 或 SP 配置的 XML 文档，包括实体 ID、端点地址、支持的服务、证书等。

### 协议（Protocol）

SAML 定义的标准化请求-响应消息。最常见的协议是 **Web Browser SSO Profile**。

### 绑定（Binding）

协议消息如何传输。主要绑定：

- **HTTP Redirect Binding**：消息通过 URL 参数传输（适用于短消息）
- **HTTP POST Binding**：消息通过 POST 表单传输（适用于长消息，如断言）
- **HTTP Artifact Binding**：通过后端通道获取断言（更安全但更复杂）
- **HTTP SOAP Binding**：后端 SOAP 调用

## 7.3 Web Browser SSO Profile 详解

### SP-Initiated SSO

由应用（SP）发起的 SSO：

```
用户              SP                   IdP
 │                │                    │
 │──访问应用─────→│                    │
 │                │──生成AuthnRequest  │
 │←──302重定向────│   (SAMLRequest)    │
 │──GET /sso──────│──────────────────→│
 │  (SAMLRequest) │                    │
 │                │                    │──用户未登录→要求认证
 │←──登录页面─────────────────────────│
 │──认证信息──────────────────────────→│
 │                │                    │──生成Assertion
 │←──自动提交POST包含SAMLResponse──────────────────│
 │──POST /acs─────→│                    │
 │(SAMLResponse)   │──验证断言,创建Session│
 │←──登录成功──────│                    │
```

### IdP-Initiated SSO

由 IdP 发起的 SSO。用户在 IdP 的仪表板上点击应用链接。流程类似但省去了 SP 发 AuthnRequest 的步骤。

### SAMLRequest（AuthnRequest）

```xml
<samlp:AuthnRequest
    xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="identifier-1"
    Version="2.0"
    IssueInstant="2024-01-01T00:00:00Z"
    Destination="https://idp.example.com/sso"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
    AssertionConsumerServiceURL="https://sp.example.com/acs">
  <saml:Issuer>https://sp.example.com/metadata</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
                      AllowCreate="true"/>
  <samlp:RequestedAuthnContext Comparison="exact">
    <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
  </samlp:RequestedAuthnContext>
</samlp:AuthnRequest>
```

### SAMLResponse（包含 Assertion）

```xml
<samlp:Response
    ID="response-1"
    Version="2.0"
    IssueInstant="2024-01-01T00:01:00Z"
    Destination="https://sp.example.com/acs"
    InResponseTo="identifier-1">
  <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion
      ID="assertion-1"
      Version="2.0"
      IssueInstant="2024-01-01T00:01:00Z">
    <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>
    <ds:Signature>
      <!-- 数字签名 -->
    </ds:Signature>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">
        zhangsan@example.com
      </saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData
            NotOnOrAfter="2024-01-01T00:06:00Z"
            Recipient="https://sp.example.com/acs"
            InResponseTo="identifier-1"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2024-01-01T00:01:00Z"
                     NotOnOrAfter="2024-01-01T00:06:00Z">
      <saml:AudienceRestriction>
        <saml:Audience>https://sp.example.com/metadata</saml:Audience>
      </saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="2024-01-01T00:01:00Z"
                         SessionIndex="session-1">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>
          urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport
        </saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email">
        <saml:AttributeValue>zhangsan@example.com</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="displayName">
        <saml:AttributeValue>张三</saml:AttributeValue>
      </saml:Attribute>
      <saml:Attribute Name="department">
        <saml:AttributeValue>技术部</saml:AttributeValue>
      </saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
```

## 7.4 SAML 的安全机制

### 断言签名（Assertion Signing）

IdP 使用自己的私钥对断言进行数字签名，SP 用 IdP 元数据中的公钥验证签名。这确保了断言的完整性和真实性。

### 响应签名（Response Signing）

对整个 SAML Response 签名。建议同时启用 Response 签名和 Assertion 签名。

### 断言加密

使用 SP 的公钥加密整个断言，确保只有目标 SP 能解密。适合通过用户浏览器传输敏感信息时。

### Subject Confirmation

确保断言被正确的 SP 使用：

- **Bearer**：持有者确认，任何人持有此断言即可使用（最常用，但必须配合 TLS）
- **Holder of Key**：需要证明持有指定的私钥

### 安全特性详解

- `InResponseTo`：SAMLResponse 中的值必须与 SAMLRequest 的 ID 匹配，防重放攻击。
- `NotBefore` / `NotOnOrAfter`：断言的时间窗口限制。
- `AudienceRestriction`：限定断言的目标受众（SP Entity ID）。
- `Recipient`：指定接收断言的精确 URL。
- `Destination`：指定消息的精确目标 URL。

## 7.5 元数据交换

元数据是 SAML 集成的基石，描述了 IdP 和 SP 的所有技术细节。

### IdP 元数据

包含的关键信息：
- Entity ID
- SSO 端点（Redirect/POST/Artifact Binding）
- SLO（Single Logout）端点
- 签名和加密证书
- 支持的 NameID 格式
- organization 和联系人信息

### SP 元数据

包含的关键信息：
- Entity ID
- Assertion Consumer Service (ACS) 端点
- SLO 端点
- 加密证书（用于加密断言）
- 请求的属性列表

### 实际集成

集成的标准流程：
1. （SP 提供方）向你提供 SP 元数据 XML 或 URL
2. 你将 SP 元数据导入 IdP，获得 IdP 元数据
3. 将 IdP 元数据提供给 SP 提供方
4. 双方测试 SSO 流程

## 7.6 常见实现场景

### 企业 SSO（AD FS + SaaS 应用）

```
用户 → AD FS（IdP）→ SAML → Salesforce/Workday/Jira（SP）
```

用户使用域账号登录，通过 AD FS 签发 SAML 断言，无缝访问 SaaS 应用。

> 趋势提示：Microsoft 已推荐将 AD FS 迁移至 Microsoft Entra ID（原 Azure AD），AD FS 不再新增功能、仅维护安全更新；新部署优先考虑 Entra ID 作为 SAML/OIDC IdP，已有 AD FS 可经联邦与 Entra ID 共存过渡。

### 教育联邦（Shibboleth）

Shibboleth 是教育和研究领域的 SAML 实现标准。eduGAIN、InCommon 等教育身份联邦使用 Shibboleth 实现跨机构身份认证（注：eduroam 属于基于 RADIUS 的无线网络漫游联邦，与 SAML 协议不同，不应混淆）。近年来 Shibboleth IdP（v4+）也增加了 OIDC 支持，不少教育联邦正在 SAML 与 OIDC 双协议运行。

### 中国场景（CAS + SAML）

Apereo CAS 同时支持 SAML 和 OIDC，在高校和政务场景中广泛使用。我们将在[第15章]({{< relref "docs/implementation/cas-apereo.md" >}})详细讨论 CAS。

## 7.7 SAML 与 OIDC 互操作

作为 IDaaS 平台，经常需要在这两个协议之间进行转换：

- 对 SAML 应用暴露 OIDC 接口（IdP-Proxy 模式）
- 对 OIDC 应用暴露 SAML 接口

Keycloak 的 Identity Brokering 实现中支持这种转换，我们将在[第14章]({{< relref "docs/implementation/keycloak-architecture.md" >}})详细讨论。

## 7.8 安全最佳实践

1. **始终使用 HTTPS**：SAML 消息通过用户浏览器传输（POST Binding），HTTPS 是基础保护。
2. **启用断言签名和加密**：签名防止篡改，加密防止敏感信息泄露。
3. **验证所有字段**：InResponseTo、Destination、Audience、时间窗口，一个都不能少。
4. **使用短时间窗口**：建议 NotOnOrAfter - NotBefore 不超过 5 分钟。
5. **元数据安全管理**：证书轮换计划，定期更新元数据。
6. **禁止 IdP-Initiated SSO 的滥用**：尽量只使用 SP-Initiated SSO，减少钓鱼风险。
7. **防御 XML 签名包装攻击（XSW）**：XML 签名验证本身需要先解析 XML，正确防御姿势是——解析后必须校验"签名所覆盖的元素恰为 SAML 断言/响应的预期根节点"，并**只信任通过签名验证的节点**，绝不能通过任意 XPath 取值后盲目使用。

## 7.9 小结

SAML 2.0 虽然承载着 XML 的"沉重遗产"，但在企业级身份联邦中依然不可替代。理解 SAML 的关键是掌握断言、协议、绑定和元数据这四个核心概念，以及它们在实际 SSO 流程中如何协同工作。作为 IDaaS 实践者，不需要手写 SAML XML，但需要理解 SAML 的工作原理以诊断集成问题、评估安全风险和进行正确的系统设计。
