# acme.dev fixture (synthetic)

Invented product used to exercise the full funnel and the before/after delta.
Nothing here was observed on a real site. Two runs:

- `run1/` — scan + audit + crash: signup behind reCAPTCHA, checkout browser-only.
- `run2/` — same providers after the fixes: one-call signup, still blocked at pay.

Render with:

```
node bin/cli.js report --from fixtures/acme.dev/run1
node bin/cli.js report --from fixtures/acme.dev/run2 --previous fixtures/acme.dev/run1
```
