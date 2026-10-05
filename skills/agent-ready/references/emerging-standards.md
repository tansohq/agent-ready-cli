# Emerging Standards

1. **Stripe Projects** — Agent provisioning + billing protocol. Curated marketplace with scoped API keys and one-time-use virtual cards. GA since Sessions 2026 (April 2026) and now lists 50+ providers.
2. **Web Bot Auth** (profile of RFC 9421 HTTP Message Signatures, IETF WG chartered October 23, 2025) — Cryptographic agent identity. Agents sign requests with a public key registered in a well-known directory; WAFs verify without CAPTCHA. Cloudflare, AWS WAF, Vercel, Shopify, Akamai have implemented support (as of early 2026). Visa Trusted Agent Protocol and Mastercard Agent Pay address the same agent identity problem at the card network layer. Amazon Bedrock AgentCore Browser uses HTTP Message Signatures to reduce CAPTCHAs.
3. **MCP** (Model Context Protocol) — Anthropic-originated, now Linux Foundation. Standard for agent-tool interaction.
4. **Google A2A** (Agent-to-Agent) — Discovery + interaction protocol for agents talking to agents.
5. **x402** (HTTP 402) — Micropayment protocol. Pay-per-request without subscription. Rails are real (Stripe integrated USDC on Base; governance moved to Linux Foundation with Coinbase, Cloudflare, Google, Visa, Stripe, AWS, Mastercard as members). Sustained commercial volume is unproven — independent analysis found ~half of reported transaction volume was wash-traded, and daily transactions dropped ~92% from Dec 2025 peak to Feb 2026. Watch, but don't build on volume claims yet.

---

## WebMCP (Emerging)

HTML form attributes that turn forms into agent tools:
- `toolname` — names the tool
- `tooldescription` — describes what it does
- `toolautosubmit` — allows agent to submit without confirmation

More token-efficient than screenshots. Agents operate forms directly without parsing visual layout. Signals the direction: HTML forms become agent interfaces automatically.
