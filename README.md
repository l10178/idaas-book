# IDaaS Book · A Complete Guide to Identity & Access Management

> **The most comprehensive Chinese-language technical book on enterprise identity.**
> From IAM fundamentals and OAuth 2.0 / OIDC / SAML protocol deep-dives to Keycloak, CAS, and Dex production deployments — a systematic guide through the entire identity landscape.
>
> 🇨🇳 Written in Chinese · [Read Online →](https://idaas.xlabs.club)
>
> 语言：[English](README.md) | [简体中文](README.zh-CN.md)

[![Stars](https://img.shields.io/github/stars/l10178/idaas-book?style=social)](https://github.com/l10178/idaas-book/stargazers)
[![Deploy](https://img.shields.io/github/actions/workflow/status/l10178/idaas-book/.github%2Fworkflows%2Fgh-pages.yml?label=deploy)](https://github.com/l10178/idaas-book/actions/workflows/gh-pages.yml)
[![Contributors](https://img.shields.io/github/contributors/l10178/idaas-book)](https://github.com/l10178/idaas-book/graphs/contributors)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-blue)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Release](https://img.shields.io/github/v/release/l10178/idaas-book)](https://github.com/l10178/idaas-book/releases/latest)

---

## Why This Book

Identity is the control plane of modern systems. Every application needs authentication, authorization, SSO, and audit — yet most teams learn these protocols the hard way: scattered docs, outdated blog posts, and vendor-specific manuals that never explain *why*.

This book fills the gap: **a single, coherent Chinese-language resource that connects principles, protocols, engineering practice, and emerging trends in enterprise identity.**

| You need... | This book delivers |
|-------------|-------------------|
| Protocol deep-dives | OAuth 2.0 / 2.1, OIDC, SAML 2.0, LDAP, SCIM — with security boundaries, common pitfalls, and real-world flows |
| Engineering recipes | Keycloak Operator, Helm charts, reverse proxy configs, HA setups, monitoring — copy-paste ready |
| Decision frameworks | Keycloak vs CAS vs Dex vs Casdoor — side-by-side comparison with selection criteria |
| Architecture patterns | Gateway integration, BFF, Sidecar, multi-tenant account design, federation topologies |
| Future-proof knowledge | Zero Trust, DID/VC, ReBAC, Passkey/WebAuthn — standalone chapters, not footnotes |

## What's Inside

**5 parts, 24 chapters, ~130k Chinese characters**, plus a glossary.

| Part | Chapters | Covers |
|------|----------|--------|
| 📘 Part I: IDaaS Foundations | 1–4 | IAM principles, AuthN vs AuthZ, identity lifecycle |
| 📗 Part II: Protocols & Standards | 5–9 | OAuth 2.0/2.1, OpenID Connect, SAML 2.0, LDAP, SCIM |
| 📙 Part III: Core Capabilities | 10–13 | SSO, MFA, identity federation, audit & compliance |
| 📕 Part IV: Implementation | 14–19 | Keycloak, Apereo CAS, Dex, solution comparison, integration patterns, K8s deployment |
| 📓 Part V: Advanced Topics | 20–24 | RBAC/ABAC/ReBAC, security, DID/VC, Zero Trust, performance |
| 📎 Appendix | — | IDaaS terminology quick reference |

<details>
<summary>📖 Full Table of Contents</summary>

**Part I · IDaaS Foundations**
- Chapter 1: What is IDaaS — definition, evolution, and core value
- Chapter 2: IAM core concepts — AAA model, design principles, and architecture
- Chapter 3: Authentication vs Authorization deep dive
- Chapter 4: Identity lifecycle management

**Part II · Protocols & Standards**
- Chapter 5: OAuth 2.0 in depth — grant types, token management, OAuth 2.1
- Chapter 6: OpenID Connect — ID Token, UserInfo, discovery
- Chapter 7: SAML 2.0 — assertions, bindings, metadata, and federation
- Chapter 8: LDAP & directory services — Active Directory integration
- Chapter 9: SCIM protocol — standardized user provisioning

**Part III · Core Capabilities**
- Chapter 10: Single Sign-On (SSO) — architecture patterns and session management
- Chapter 11: Multi-Factor Authentication (MFA) — TOTP, FIDO2, adaptive auth
- Chapter 12: Identity federation & proxying — cross-domain trust
- Chapter 13: Audit & compliance — ISO 27001, anomaly detection

**Part IV · Implementation & Practice**
- Chapter 14: Keycloak architecture deep dive
- Chapter 15: Apereo CAS — education & enterprise SSO
- Chapter 16: Dex identity proxy — Kubernetes-native solution
- Chapter 17: IDaaS landscape comparison — decision framework
- Chapter 18: Integration patterns — gateway, BFF, Sidecar
- Chapter 19: Kubernetes production deployment

**Part V · Advanced Topics**
- Chapter 20: Authorization models — RBAC, ABAC, ReBAC
- Chapter 21: IDaaS security best practices
- Chapter 22: Performance & scalability
- Chapter 23: Decentralized identity & verifiable credentials
- Chapter 24: Zero Trust & identity-driven security

</details>

## Who Should Read

Chinese-reading engineers, architects, and security professionals who need authoritative identity knowledge without language barriers:

- 🏗️ **Architects & Tech Leads** — planning SSO, identity platforms, permission governance
- 🔐 **Security Teams** — MFA, audit compliance, Zero Trust, identity federation
- 🧑‍💻 **Backend / Platform Engineers** — integrating OAuth, OIDC, SAML, LDAP, or Keycloak
- 🧭 **SaaS / Platform Teams** — multi-tenant account design, RBAC, user lifecycle
- 🆕 **IAM Beginners** — build a complete identity domain knowledge system

## Reading Paths

| Your goal | Start here |
|-----------|-----------|
| Quick overview | [Introduction & Reading Guide](https://idaas.xlabs.club/docs/guides/introduction/) → Chapters 1–9 |
| Building SSO / protocol integration | OAuth 2.0 → OpenID Connect → SAML → SSO → Integration Patterns |
| Choosing an identity platform | Keycloak Architecture → CAS / Dex → Comparison → K8s Deployment |
| Designing authorization | AuthN vs AuthZ → RBAC/ABAC/ReBAC → Audit & Compliance |
| Hardening security | MFA → Best Practices → Zero Trust |

## 🌐 Read Online

**[idaas.xlabs.club](https://idaas.xlabs.club)** — full-text search, dark mode, table of contents navigation. Auto-deployed from `main`.

## 🚀 Local Development

Built with [Hugo](https://gohugo.io/) + [Doks](https://github.com/thuliteio/doks) theme.

```bash
npm install          # install dependencies
npm run dev          # start dev server → http://localhost:1313
npm run build        # production build → public/
```

Requires Node.js 26 and Hugo Extended.

## 🤝 Contributing

This book is continuously improving. All contributions welcome:

- **Found an error?** → [Open an Issue](https://github.com/l10178/idaas-book/issues)
- **Want to add content?** → [Submit a Pull Request](https://github.com/l10178/idaas-book/pulls)
- **Have a topic request?** → Tag `discussion` in Issues

PRs should follow existing frontmatter conventions (`title`, `description`, `weight`, `menu`, `toc`) and maintain consistent chapter numbering and style.

## 📊 Why Star This Repo

If you're working with identity — or know you will — starring this repo:

- 📌 Bookmarks a growing reference that stays current
- 🔔 Notifies you of new chapters and protocol updates
- 📈 Helps more Chinese-speaking engineers discover a systematic identity resource

**No paywall, no registration, no vendor lock-in.** Just a book that wants to be useful.

## ⚖️ License

Content: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (Attribution-NonCommercial).  
Site scaffolding: follows upstream [Doks](https://github.com/thuliteio/doks) license.

---

> 🧭 *"Trust is hard. Knowing who to trust is even harder."* — this book helps you navigate both.
