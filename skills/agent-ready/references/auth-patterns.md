# Authentication Patterns

## Gold Standard: OAuth 2.0 Client Credentials Grant

Machine-to-machine auth. No user interaction. Short-lived tokens. Supported by Auth0, Okta, every major identity provider.

Flow:
```
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=AGENT_ID
&client_secret=AGENT_SECRET
&scope=read:billing write:config
```

Returns short-lived access token. Agent refreshes as needed.

## Gold Standard: Stripe API Keys

Simple, effective:
- Secret key for server-side (full access)
- Restricted keys with granular permissions
- Key rotation via API
- Test mode keys for sandbox

## Shipping Now: Web Bot Auth

Web Bot Auth is a profile of RFC 9421 (HTTP Message Signatures) specifically for bot authentication. The IETF Web Bot Auth WG charter was approved and the group became active on October 23, 2025. RFC 9421 is the generic signatures standard; Web Bot Auth narrows it to agent identity verification at WAFs.

Agents register public keys in a well-known directory; WAFs verify identity without CAPTCHA. Implementations (as of early 2026): Cloudflare, AWS WAF, Vercel, Shopify, Akamai. Visa Trusted Agent Protocol and Mastercard Agent Pay address the same agent identity problem at the card network layer. Amazon Bedrock AgentCore Browser uses HTTP Message Signatures to reduce CAPTCHAs.

For product builders: if your auth friction is "agents can't get past the WAF/CAPTCHA," Web Bot Auth is the fix now, not a future direction. Support it alongside API keys and Client Credentials.

## What Works
- API keys with scoped permissions (read-only, billing-only, admin)
- Key rotation endpoint (`POST /v1/keys/rotate`)
- Multiple keys per account (different agents, different scopes)
- Client Credentials OAuth for enterprise/multi-tenant

## What Blocks Agents

| Anti-Pattern | Why It Kills Agents | Fix |
|---|---|---|
| Magic links | Requires email inbox + browser click | API key or Client Credentials |
| SMS OTP | Requires phone | TOTP (agent can compute) |
| Browser-only OAuth consent | Click "Allow" screen | Client Credentials Grant |
| Device fingerprinting | Headless browsers get flagged | Web Bot Auth (RFC 9421), allowlist verified agents |
| IP allowlisting without API | Can't self-manage access | API to manage IP allowlist |
| Session cookies only | No API token alternative | Add bearer token auth path |

## Hierarchy (best to worst for agents)
1. API keys with scopes (simplest, most agents support)
2. OAuth Client Credentials (enterprise-grade, short-lived tokens)
3. Service accounts with key pairs (GCP model, secure but complex)
4. OAuth Authorization Code + PKCE (requires browser, but possible with agent browsers)
5. Magic links / email OTP (agent-hostile)
6. CAPTCHA-gated (agent-impossible — replace with Web Bot Auth or behavioral scoring)
