# Starting from Level 0

If the product has NO API at all (dashboard-only):

## First step: pick ONE core action and expose it as an API endpoint
- Start with read-only (lower risk): `GET /v1/status`, `GET /v1/usage`, `GET /v1/reports/{id}`
- Then add one write action that agents actually need

## Practical sequence
1. **Week 1**: Add one read endpoint. Document it. Add API key generation to dashboard.
2. **Week 2**: Add one write endpoint (the action agents request most).
3. **Week 3**: Add usage/billing visibility endpoint.
4. **Week 4**: Add programmatic signup path (even if simplified).

## Example
Dashboard-only analytics tool:
- Week 1: `GET /v1/reports/{id}` — agents can fetch report data
- Week 2: `POST /v1/reports` — agents can create reports
- Week 3: `GET /v1/usage` — agents can monitor their consumption
- Week 4: `POST /v1/signup` — agents can create accounts for developers

## The 80/20
Most agent interactions are reads (checking status, fetching data, monitoring usage). Expose reads first — they're safe, useful, and prove the pattern before you tackle writes.
