# Runbook: CheckoutApiAvailabilityFastBurn / CheckoutApiLatencyBurn

**What it means:** checkout-api is failing or slow enough to burn the monthly error budget >14.4x (availability) / >6x (latency).
**Customer impact:** shoppers see errors or slow responses at checkout.
**Severity:** page (availability) / ticket (latency)

## 1. Confirm (2 min)
- Grafana "checkout-api — golden signals": is error ratio > 7.2% or p95 > 500 ms? Is traffic normal?
- `kubectl -n freshcart get pods` — restarts, CrashLoop, Pending?

## 2. Scope (3 min)
- Did something change? `kubectl -n freshcart rollout history deploy/checkout-api` and `git log -5`
- Is saturation high? CPU panel, `db_pool_waiting` panel.

## 3. Find the cause (10 min)
- Jaeger: service checkout-api, min duration 1s → open the slowest trace → which span is long? (db query? waiting for a connection?)
- Cloud Logging: `resource.labels.container_name="checkout-api" severity>=ERROR` → read the message; copy trace_id and search it in Jaeger.

## 4. Mitigate
- Bad release / config change → `kubectl -n freshcart rollout undo deploy/checkout-api`
- DB trouble → check postgres pod; `kubectl -n freshcart logs deploy/postgres`
- Pure load → HPA should scale; if maxed out, raise `maxReplicas` temporarily.

## 5. Verify recovery
- Error ratio < 1% and p95 < 500 ms for 10 min; alert resolves.

## 6. Afterwards
- Open a postmortem from docs/postmortem-template. Escalate if no improvement after 15 min.