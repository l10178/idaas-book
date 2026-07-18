## Summary
- Clarify when `--oidc-extra-audience` is appropriate instead of changing Keycloak claims.
- Document the operational trade-off between cookie and Redis Session Store.
- Add the same IAM gateway decision guidance to the integration and deep-dive pages.

## Changed files
- `content/docs/solution-blogs/oauth2-proxy-common-errors.md`
- `content/docs/solution-blogs/keycloak-oauth2-proxy.md`
- `content/docs/implementation/oauth2-proxy-deep-dive.md`

## Technical sources
- https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/
- https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc/
- https://kubernetes.github.io/ingress-nginx/examples/auth/oauth-external-auth/

## SEO/GEO impact
- Strengthens the IAM gateway troubleshooting intent around `expected audience`, `oidc-extra-audience`, Redis Session Store, and multi-replica oauth2-proxy.
- Adds reusable decision guidance and security caveats to three internally linked pages.

## Validation
- `npm run build` passed with Hugo 0.164.0 Extended and Node v26.3.0.
- `git diff --check` passed.

## Risk/rollback
- Documentation-only change; no runtime dependency or deployment change.
- Roll back by reverting the squash merge commit.