# FreshCart Observability

**Operating FreshCart like a real service: metrics, structured logs, distributed tracing, SLOs, burn-rate alerting, incident response, and a blameless postmortem.**

This is the final capstone in my FreshCart cloud engineering series. Rather than adding another product feature, this project focuses on operating the application built over the previous weeks.

Building on the Kubernetes deployment of `checkout-api` and `storefront`, I added observability and incident-response capabilities to help answer three questions:

- **What is happening?** Metrics and dashboards show service health.
- **Why is it happening?** Structured logs and distributed traces help investigate failures.
- **What should happen next?** SLOs, alerts, and a runbook guide detection and recovery.

The final test is a deliberately induced incident: introduce a controlled fault, observe whether the monitoring detects it, investigate using evidence, restore service, and document what should improve.

> **Final blog post:** [When FreshCart Failed: How Monitoring, Traces, and SLOs Helped Me Find the Root Cause](https://michaelokpu.medium.com/when-freshcart-failed-how-monitoring-traces-and-slos-helped-me-find-the-root-cause-5ac09ff3f90d)
>
> **Capstone series:** [GCP](https://dev.to/mikey_og/how-i-designed-and-built-a-secure-two-tier-architecture-on-google-cloud-platform-1eie) · [Docker and Containerization](https://michaelokpu.medium.com/from-works-on-my-machine-to-repeatable-builds-containerizing-freshcart-with-docker-1154d8cd92f7) · [Terraform / IaC](https://michaelokpu.medium.com/codifying-freshcart-building-a-reproducible-two-tier-gcp-architecture-with-terraform-e4370a4c04cb) · [CICD](https://michaelokpu.medium.com/automating-freshcart-building-a-secure-ci-cd-pipeline-with-github-actions-trivy-and-gcp-f0a5d62114e1) · [K8s](https://michaelokpu.medium.com/deploying-freshcart-to-kubernetes-self-healing-scaling-and-zero-downtime-updates-c83a76c7ec98) · **Week 8: Observability**

## Architecture

The following diagram describes the intended observability architecture. Confirm that the trace-export paths and log correlation shown here match the deployed configuration.

```mermaid
flowchart LR
    U[Users / Load Generator] --> SF[Storefront<br/>NGINX + tracing]
    SF -->|API requests + trace context| API[checkout-api<br/>Replicas + instrumentation]

    API --> PG[(PostgreSQL<br/>Persistent Volume)]

    SF -.->|OTLP| J[Jaeger]
    API -.->|OTLP| J

    P[Prometheus] -->|Alerts| AM[Alertmanager]
    P --> G[Grafana]
    API -.->|Scrape /metrics| P

    API -.->|JSON stdout/stderr| CL[Google Cloud Logging]

    subgraph GKE[GKE Cluster]
        SF
        API
        PG
        J
        P
        AM
        G
    end
```

**Architecture diagram:** [`docs/architecture-obs.png`](docs/architecture/obs-diagram.png)

### Main components

| Component | Responsibility |
|---|---|
| Storefront | Serves the frontend and forwards API requests to `checkout-api`. |
| Checkout API | Handles application requests and exposes instrumentation for metrics, logs, and traces. |
| PostgreSQL | Stores application data using persistent storage. |
| Prometheus | Collects application and Kubernetes metrics and evaluates alert rules. |
| Alertmanager | Handles alert grouping, routing, and notification policies. |
| Grafana | Displays service health, latency, errors, traffic, saturation, and error-budget information. |
| Jaeger | Provides a trace interface for investigating request paths and latency. |
| Google Cloud Logging | Collects and searches application and platform logs. |

## What was implemented

| Pillar | Implementation | Relevant files |
|---|---|---|
| Metrics | `prom-client` instrumentation and `kube-prometheus-stack` | `checkout-api/src/observability/metrics.ts`, `observability/values-monitoring.yaml`, `observability/servicemonitor.yaml` |
| Structured logs | Pino JSON logs to stdout, collected by Cloud Logging on GKE | `checkout-api/src/observability/logger.ts` |
| Distributed tracing | OpenTelemetry instrumentation and Jaeger | `checkout-api/src/observability/tracing.ts`, `storefront/`, `observability/jaeger.yaml` |
| SLOs and alerts | Prometheus recording rules and burn-rate alert rules | `observability/slo-rules.yaml` |
| Dashboard | Grafana dashboard configuration | `observability/grafana-dashboard.json` |
| Runbook | Investigation and recovery steps for availability burn | `docs/runbook-availability-burn.md` |
| Postmortem | Blameless incident analysis and follow-up actions | `docs/postmortem.md` |

File paths describe the intended repository layout; verify that each listed file exists and matches the deployed configuration.

## The four golden signals

The checkout API's monitoring focuses on the four golden signals of service health.

| Signal | Measurement |
|---|---|
| **Latency** | `http_request_duration_seconds` histogram, including p95 latency. |
| **Traffic** | Request rate, for example `rate(http_requests_total[1m])`. |
| **Errors** | The proportion of eligible requests returning HTTP 5xx responses. |
| **Saturation** | Pod CPU relative to requests, database connection-pool waiting, and event-loop lag where instrumented. |

The purpose is to understand the application as a service, not merely confirm that its pods are running.

A pod can be `Running` while customers experience slow requests or server errors. Combining application metrics with Kubernetes and dependency metrics helps distinguish these situations.

## Structured logs and distributed traces

### Logs

The application uses Pino to emit structured JSON logs. On GKE, container logs written to stdout and stderr can be collected by Google Cloud's logging integration and queried in Cloud Logging.

This provides a central place to investigate application errors without having to inspect each pod separately.

**Screenshot:** [Insert a Cloud Logging entry showing structured JSON fields, timestamp, severity, and message.]

### Traces

OpenTelemetry instrumentation is intended to provide request-level visibility across the storefront and checkout API, with Jaeger as the trace interface.

Where trace context is propagated correctly, a trace can show how much time a request spends in different services and operations.

**Screenshot:** [Insert a Jaeger trace showing the storefront-to-checkout-api request path.]

If logs include `trace_id` and `span_id`, those identifiers can help connect a log entry to the corresponding trace. Verify that the identifiers are populated and that the trace is searchable before describing this as a working end-to-end correlation feature.

## Service-level objectives and error budgets

The project defines two SLOs for `checkout-api`.

| SLO | Target over 30 days | Error budget |
|---|---:|---:|
| Availability: eligible requests that do not return HTTP 5xx | 99.5% | 0.5% |
| Latency: eligible requests completed in under 500 ms | 95% | 5% |

These are the configured objectives, not claims about measured performance over a complete 30-day window.

The error budget is the fraction of eligible requests allowed to miss the objective. The exact Prometheus expressions must use the same request population and failure definitions as the SLO.

For example, an availability SLO based on non-5xx responses treats HTTP 4xx responses as successful unless the implementation explicitly defines otherwise. That policy should be intentional and documented.

### Burn-rate alerting

The alerts use error-budget burn rate rather than a raw error count.

A burn rate of `1` means the service is consuming its error budget at the average rate that would exhaust it over the 30-day SLO window. A higher burn rate indicates faster budget consumption.

The intended alert rules are:

| Alert | Condition | Severity |
|---|---|---|
| `CheckoutApiAvailabilityFastBurn` | Availability error ratio exceeds 7.2% over both the 1-hour and 5-minute windows, for 2 minutes | Page |
| `CheckoutApiLatencyBurn` | Slow-request ratio exceeds 30% over both the 30-minute and 5-minute windows, for 2 minutes | Ticket |
| `CheckoutApiDbPoolSaturated` | Database-pool waiting remains above the configured threshold for 2 minutes | Ticket |

**Configuration:** [`observability/slo-rules.yaml`](observability/slo-rules.yaml)

For the 99.5% availability objective, a 14.4× burn rate corresponds to a 7.2% error ratio. The latency alert uses shorter windows than some standard long-window burn-rate policies to make the experiment practical at this project's scale.

The database-pool alert is intended to provide an earlier signal of dependency saturation. Its threshold and firing behavior should be verified against the actual metric and alert expression.

**Screenshot:** [Insert the healthy alert-rules view before inducing the incident.]

## The incident exercise

The final test deliberately introduces a controlled fault into `checkout-api`. The purpose is to verify that monitoring can detect customer-facing impact and that logs, traces, and the runbook can support investigation and recovery.

### Fault injection

**Fault introduced:** I ran kubectl set env on the checkout-api deployment in the freshcart namespace to simulate a bad release. It changed DB_POOL_MAX from 10 to 2 and added FAULT_DB_DELAY_MS=1500, which was previously unset. That created rollout revision 4, replacing the healthy revision 3. Each request then held one of only 2 database connections for 1.5 s, so requests queued, hit the connection timeout and returned HTTP 500. The change was made by environment variable only, with no image or code change.


**Command used:**
```bash
kubectl -n freshcart set env deployment/checkout-api \
  DB_POOL_MAX=2 \
  FAULT_DB_DELAY_MS=1500
```


### Incident timeline

| Event | Time (UTC) |
|---|---|
| Fault introduced | [T0] |
| Availability burn alert fired | [T1] |
| Mitigation applied | [T2] |
| Recovery confirmed and alert resolved | [T3] |

### Observed impact

| Measurement | Observed result |
|---|---|
| Peak HTTP 5xx ratio | [Insert measured value] |
| Peak p95 latency | [Insert measured value] |
| Error-budget impact | [Insert measured value or calculation] |
| Approximate customer-facing impact | [Insert measured duration] |

### Investigation and recovery

The intended investigation process is:

1. Confirm the affected service and customer impact using the dashboard.
2. Inspect pod status, recent events, and rollout history.
3. Identify the slow or failing operation using a trace.
4. Correlate trace information with application errors in Cloud Logging.
5. Apply the mitigation and verify recovery using requests and monitoring data.

If a Kubernetes rollout rollback was the actual mitigation, the command is:

```bash
kubectl -n freshcart rollout undo deployment/checkout-api
```

Only report that the alert fired automatically, the trace identified the cause, or the rollback restored service if the evidence supports those conclusions.

**Incident evidence:** [`docs/evidence/`](docs/screenshots/)

**Runbook:** [`docs/runbook-availability-burn.md`](docs/runbook-availability-burn.md)

**Postmortem:** [`docs/postmortem.md`](docs/postmortem.md)

### Postmortem and action item

The postmortem should distinguish the immediate trigger from the underlying technical cause and contributing factors.

The planned improvement is a `CheckoutApiDbPoolSaturated` alert, accompanied by a runbook update that checks database-pool pressure earlier in the investigation.

Document:

- What changed and why it caused the failure.
- Which signal first indicated a problem.
- What the traces and logs revealed.
- How the service was recovered.
- What was changed afterward to reduce the likelihood or impact of recurrence.

If the new alert was retested and fired before the availability burn alert, include that result and its timestamps. Otherwise, describe the alert as implemented but not yet validated in a retest.

## Repository structure

```text
freshcart-obs/
├── checkout-api/
│   └── src/observability/
│       ├── tracing.ts
│       ├── logger.ts
│       ├── metrics.ts
│       └── fault.ts
├── storefront/
│   └── # NGINX configuration and tracing integration
├── k8s/
│   └── # Namespace, PostgreSQL, Deployments, Services,
│       # HPA, RBAC, and application configuration
├── observability/
│   ├── values-monitoring.yaml
│   ├── servicemonitor.yaml
│   ├── slo-rules.yaml
│   ├── jaeger.yaml
│   ├── loadgen.yaml
│   └── grafana-dashboard.json
├── docs/
│   ├── architecture-obs.png
│   ├── runbook-availability-burn.md
│   ├── postmortem-001.md
│   ├── arch-decisions.md
│   └── screenshots/
└── docker-compose.yml
```

## Running on GKE

The following is a deployment outline for a **new Standard GKE cluster**. It is not a set of commands to run blindly against an existing cluster.

The project has also used an Autopilot cluster named `freshcart-gke`. If you are continuing with that cluster, use its existing context and follow the applicable Autopilot requirements instead of creating another cluster.

### Prerequisites

Run these commands from WSL Ubuntu or another Linux environment with:

- `gcloud`
- `gke-gcloud-auth-plugin`
- `kubectl`
- `helm`
- Docker
- Node.js version compatible with the application's `package.json`

You also need access to the GCP project, permission to create or use the relevant GKE and Artifact Registry resources, and a working network connection to the required container registry and Helm chart sources.

### 1. Set the deployment variables

```bash
export PROJECT_ID=freshcart-twotier
export REGION=us-central1
export ZONE=us-central1-a
export CLUSTER_NAME=freshcart-obs
export REG="${REGION}-docker.pkg.dev/${PROJECT_ID}/freshcart-repo"

gcloud config set project "$PROJECT_ID"
gcloud auth list
```

Confirm that the Artifact Registry repository `freshcart-repo` exists in `us-central1` and that you have permission to push images.

### 2. Build and push the application images

```bash
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

docker build -t "${REG}/checkout-api:obs-v1" ./checkout-api
docker push "${REG}/checkout-api:obs-v1"

docker build -t "${REG}/storefront:obs-v1" ./storefront
docker push "${REG}/storefront:obs-v1"
```

Update the image references in the Kubernetes manifests to point to the pushed images.

For reproducible releases, prefer immutable commit-SHA tags over reusing `obs-v1`.

### 3. Create a Standard GKE cluster, if needed

**Skip this step if you are using an existing cluster.** Creating a new cluster may incur additional charges.

```bash
gcloud container clusters create "$CLUSTER_NAME" \
  --zone "$ZONE" \
  --num-nodes 2 \
  --machine-type e2-standard-2 \
  --disk-size 40
```

Retrieve its credentials and verify the active context:

```bash
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --zone "$ZONE"

kubectl config current-context
kubectl get nodes
```

Make sure the context points to the intended cluster before applying any manifests.

### 4. Deploy the application and database

Create the namespace first:

```bash
kubectl apply -f k8s/00-namespace.yaml
```

Create the database credential Secret using the username and password expected by the application. The following is a placeholder example, not a production secret-management recommendation:

```bash
read -r -p "Database username: " DB_USER
read -r -s -p "Database password: " DB_PASSWORD
echo

kubectl -n freshcart create secret generic checkout-db-secret \
  --from-literal=DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@postgres:5432/freshcart"

unset DB_PASSWORD
```

Confirm that the Secret's key matches the environment variable referenced by the checkout API Deployment. If the application expects a different variable name or connection format, adapt the Secret and Deployment accordingly.

Apply PostgreSQL before the API workloads:

```bash
kubectl apply -f k8s/02-postgres.yaml

kubectl -n freshcart rollout status statefulset/postgres \
  --timeout=180s
```

Adjust the workload name or resource type if the PostgreSQL manifest defines a different kind or name. Verify the actual resource with `kubectl -n freshcart get all,pvc`.

Deploy the tracing backend and application resources:

```bash
kubectl apply -f observability/jaeger.yaml

kubectl apply \
  -f k8s/03-checkout-api-deployment.yaml \
  -f k8s/04-checkout-api-service.yaml \
  -f k8s/05-storefront-deployment.yaml \
  -f k8s/06-storefront-service.yaml \
  -f k8s/09-hpa.yaml \
  -f k8s/10-rbac.yaml
```

Check that the resources are ready:

```bash
kubectl -n freshcart get pods,services,pvc
kubectl -n freshcart get hpa
kubectl -n freshcart get events --sort-by=.lastTimestamp
```

**Database initialization:** confirm that the application schema and required tables exist before testing the API. A running PostgreSQL pod does not prove that the schema has been initialized.

### 5. Install Prometheus and Grafana

Add the Prometheus Community Helm repository:

```bash
helm repo add prometheus-community \
  https://prometheus-community.github.io/helm-charts

# OR
# if the above process fails, install and use the follow-up commands to ensure it running
helm install kube-prometheus-stack \
  oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack \
  --namespace monitoring --create-namespace
  
helm list -n monitoring
kubectl get pods -n monitoring
  
kubectl -n monitoring get pods -w

helm repo update
```

Install the monitoring stack:

```bash
helm install kube-prom \
  prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --values observability/values-monitoring.yaml
```

If the Helm repository cannot be reached, troubleshoot DNS, proxy, firewall, and network access before continuing. Do not disable TLS verification as a workaround.

Wait for the monitoring workloads:

```bash
kubectl -n monitoring get pods
helm -n monitoring status kube-prom
```

Apply the ServiceMonitor and SLO rules:

```bash
kubectl apply -f observability/servicemonitor.yaml
kubectl apply -f observability/slo-rules.yaml
kubectl apply -f observability/loadgen.yaml
```

Check that Prometheus discovers the application target and that the expected recording and alert rules are loaded. A successful `kubectl apply` alone does not prove that metrics are being scraped or alerts are evaluating correctly.

## Accessing the observability tools

Use `kubectl port-forward` for local access. These commands assume the release and resource names match the configuration above.

**Grafana**

```bash
kubectl -n monitoring port-forward svc/kube-prom-grafana 3000:80
```

Open `http://localhost:3000`.

**Prometheus**

```bash
kubectl -n monitoring port-forward \
  svc/kube-prom-kube-prometheus-prometheus 9090:9090
```

Open `http://localhost:9090`.

**Alertmanager**

```bash
kubectl -n monitoring port-forward \
  svc/kube-prom-kube-prometheus-alertmanager 9093:9093
```

Open `http://localhost:9093`.

**Jaeger**

```bash
kubectl -n freshcart port-forward svc/jaeger 16686:16686
```

Open `http://localhost:16686`.

If a service name differs, find the actual name using:

```bash
kubectl -n monitoring get services
kubectl -n freshcart get services
```

Application logs can be inspected in **Google Cloud Console → Logging → Logs Explorer**. Filter by the GKE cluster, namespace, and workload labels available in the collected log entries.

## Reproducing the incident

Only perform fault injection in a test environment where temporary failures are acceptable.

First, record the current state and verify that the fault-injection configuration is supported by the running image.

The following is an example based on the intended pool-pressure experiment:

```bash
kubectl -n freshcart set env deployment/checkout-api \
  DB_POOL_MAX=2 \
  FAULT_DB_DELAY_MS=1500
```

These environment variables must be implemented by the application for the experiment to have the expected effect. The fault should be disabled by default.

Observe the application metrics and alert state, then follow [`docs/runbook-availability-burn.md`](docs/runbook-availability-burn.md).

If the experiment changes the Deployment's pod template, a rollout may occur. Record the revision and timestamps so the incident can be reconstructed afterward.

If rollback is the chosen mitigation:

```bash
kubectl -n freshcart rollout undo deployment/checkout-api
kubectl -n freshcart rollout status deployment/checkout-api
```

Verify application health and the relevant dashboard metrics before declaring recovery.

## Teardown and cost management

Deleting a cluster can remove workloads and cluster-managed resources. Verify the target cluster and preserve any evidence you need before running destructive commands.

```bash
gcloud container clusters list
kubectl config current-context
```

For the dedicated Standard cluster created by this guide:

```bash
gcloud container clusters delete "$CLUSTER_NAME" \
  --zone "$ZONE"
```

Review any separately managed resources afterward, including persistent disks, static IP addresses, forwarding rules, and Artifact Registry images. Do not delete resources belonging to the existing `freshcart-gke` cluster or other projects by mistake.

## Design decisions and limitations

- **In-cluster PostgreSQL:** acceptable for the scope of this capstone, but a managed database would generally provide a stronger operational foundation for a production service. See [`docs/arch-decisions.md`](docs/arch-decisions.md).
- **Telemetry retention:** the intended Jaeger configuration uses in-memory storage, and Prometheus stores data for two days on an `emptyDir`. Data may be lost when the relevant pods are recreated. Confirm the deployed values before relying on this retention description.
- **Private access to observability tools:** the intended workflow uses `kubectl port-forward` rather than publicly exposing Grafana, Prometheus, Alertmanager, or Jaeger.
- **Alert notifications:** the project focuses on rule evaluation and inspecting alerts in the UI. A Slack or PagerDuty receiver is not configured unless explicitly added and tested.
- **Secrets:** database credentials are created separately from version-controlled manifests. Do not commit live credentials. Configure and protect Grafana administrator credentials before deployment.
- **Incident validation:** the postmortem and screenshots should record what actually happened, including any alert that did not fire as expected.
- **Tracing:** end-to-end visibility depends on working instrumentation, context propagation, exporter configuration, and a reachable trace backend.

## Earlier weeks

This repository builds on the previous FreshCart capstones:

| Week | Focus | Repository |
|---|---|---|
| 3 | Two-tier GCP architecture | [freshcart-twotier](https://github.com/Mikey064/freshcart-twotier) |
| 4 | Docker and containerization | [freshcart-docker-mikey](https://github.com/Mikey064/freshcart-docker-mikey) |
| 5 | Terraform and reproducible infrastructure | [freshcart-tf](https://github.com/Mikey064/freshcart-tf) |
| 6 | Secure CI/CD with GitHub Actions | [freshcart-cicd](https://github.com/Mikey064/freshcart-cicd) |
| 7 | Kubernetes deployment | [freshcart-k8s](https://github.com/Mikey064/freshcart-k8s) |
| 8 | Observability and incident response | []()**This repository** |

## Final takeaway

FreshCart evolved from an application running on cloud infrastructure into a system with repeatable infrastructure, automated delivery, workload orchestration, and an observability workflow.

The objective of this final capstone is not simply to show that Prometheus, Grafana, or Jaeger can run. It is to demonstrate how telemetry, alerting, investigation, recovery, and a blameless postmortem fit together when something goes wrong.

**Repository:** [Mikey064/freshcart-obs](https://github.com/Mikey064/freshcart-obs)
