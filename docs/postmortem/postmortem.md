# Postmortem: checkout-api elevated errors and latency
Date: <date> · Duration: <T3 − T0> · Severity: SEV2 (self-induced game day)

## Summary
2–3 sentences, customer impact in numbers (peak error ratio, peak p95, % budget burned).

## Impact
Peak 5xx ratio __%, p95 __ s, error budget consumed __% of the monthly budget.

## Timeline (UTC) — from Prometheus/Grafana/Cloud Logging/kubectl, not memory
| Time | Event | Source |
|---|---|---|
| T0 | Release changed DB_POOL_MAX=2, slow query introduced | kubectl rollout history |
| … | First 5xx logged | Cloud Logging |
| T1 | CheckoutApiAvailabilityFastBurn fired | Prometheus Alerts |
| … | Slowest trace opened; pg span 1.5 s + pool wait | Jaeger |
| T2 | rollout undo | kubectl |
| T3 | Alert resolved | Prometheus |

## Root cause
Immediate trigger: ___.
Why it was possible (go deeper than the trigger): no limit/alert on DB pool saturation, no load test or canary before rollout, config change shipped with no guardrail…

## What went well / what didn't
…

## Action items
| Action | Type | Status |
|---|---|---|
| Alert on DB pool saturation (`db_pool_waiting`) | new alert | **Done — PR #__** |
| Add "check DB pool panel" to runbook step 2 | runbook update | **Done** |
| Add a smoke/load check to the pipeline | pipeline check | Planned |