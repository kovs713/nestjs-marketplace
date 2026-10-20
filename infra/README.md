# infra

## Layout

```text
infra/docker/
  Dockerfile             one image for all services; SERVICE selects the app at runtime
  compose.yml            postgres, kafka, redis, minio, migrations, 7 services
  postgres/init.sql      6 roles, 6 databases
  migrate.sh             drizzle + outbox/inbox schema per SERVICE
  migrate.check.py       migrate.sh routing and failure test (no DB needed)

infra/k8s/
  00-namespace.yaml      namespace, PodSecurity, ResourceQuota
  10-postgres-secrets.yaml  postgres password, JWT secret, DATABASE_URLs
  10-postgres.yaml       single Postgres; databases seeded from postgres/init.sql
  30-kafka.yaml          single-broker KRaft + topic Job
  40-redis.yaml          WebSocket pub/sub + cache
  45-minio.yaml          S3-compatible storage + bucket Job
  50-services.yaml       7 Deployments + Services
  60-migrations.yaml     Drizzle + outbox migration Jobs
  80-ingress.yaml        /api -> gateway, /notifications + /ws -> notification
```

## Local

Host run (infra in Docker, apps on host). Each app reads its own `PORT` from
`apps/<service>/.env`, so all seven answer on the host:

```bash
bun run infra:up     # postgres, kafka, redis, minio (in Docker)
bun run start:all    # apps on host

for p in 3000 3001 3002 3003 3004 3005 3006; do
  printf '%s: ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:$p/health/live"
done
```

Full Compose (image built once via `api-gateway`; only gateway `3000` and
notification `3001` are published, everything else stays on the Docker network):

```bash
docker compose -f infra/docker/compose.yml build
docker compose -f infra/docker/compose.yml up -d

curl -f http://localhost:3000/health/live
curl -f http://localhost:3001/health/live
docker compose -f infra/docker/compose.yml ps
```

Each service declares only its real dependencies and environment: `api-gateway`
and `users-service` have no Kafka/Redis/MinIO wiring; migrations run as one-shot
services gating their service through `depends_on`.

Local checks:

```bash
python3 infra/docker/migrate.check.py   # migrate.sh routing and failure gates
```

Expect `200` on `/health/live`; `/health/ready` probes the dependencies each
service declares (Kafka, Redis, DB, gRPC) and returns `200` while the stack is
up.

## Kubernetes

Apply in this order (kubectl does not order multi-document files by itself):

```bash
kubectl apply -f infra/k8s/00-namespace.yaml

# Same SQL file Compose mounts; keep one source of truth for roles/databases
kubectl -n marketplace create configmap postgres-init \
  --from-file=10-init.sql=infra/docker/postgres/init.sql \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f infra/k8s/10-postgres-secrets.yaml -f infra/k8s/10-postgres.yaml
kubectl -n marketplace wait --for=condition=ready pod -l app=postgres --timeout=180s

kubectl apply -f infra/k8s/30-kafka.yaml -f infra/k8s/40-redis.yaml -f infra/k8s/45-minio.yaml
kubectl -n marketplace wait --for=condition=complete job/kafka-init-topics --timeout=300s
kubectl -n marketplace wait --for=condition=complete job/minio-create-bucket --timeout=120s

# Apply alone would not re-run completed Jobs, so recreate them first
kubectl -n marketplace delete job -l app.kubernetes.io/component=migrate --ignore-not-found
kubectl apply -f infra/k8s/60-migrations.yaml
kubectl -n marketplace wait --for=condition=complete job -l app.kubernetes.io/component=migrate --timeout=300s

kubectl apply -f infra/k8s/50-services.yaml -f infra/k8s/80-ingress.yaml
```

Migrations must succeed before services start: they create the Drizzle schema
and the outbox/inbox tables, and services no longer carry schema-check init
containers.

`postgres-init` runs only while `PGDATA` is empty. To re-seed after changing the
SQL:

```bash
kubectl -n marketplace scale sts postgres --replicas=0
kubectl -n marketplace delete pvc data-postgres-0
kubectl -n marketplace scale sts postgres --replicas=1
```

If `minio-create-bucket` fails:

```bash
kubectl -n marketplace delete job minio-create-bucket
kubectl apply -f infra/k8s/45-minio.yaml
```

## Environment

- `apps/<service>/.env` is local-only; copy from `.env.example`.
- Priority: container env > `.env` > defaults.
- Validation: zod schemas in `libs/*/src/*.config.ts`; `libs/common` holds the
  shared app/database schemas.
- `S3_*` is validated only when `FilesModule` is imported; keep the compose and
  k8s service blocks in sync with what each app module actually imports.
- Drizzle uses `DATABASE_URL`; `db:migrate:<service>` runs from `apps/<service>`.

## Minikube

```bash
minikube start --cpus=4 --memory=6g

eval $(minikube docker-env)
docker build -f infra/docker/Dockerfile -t marketplace:dev .
# Or: minikube image load marketplace:dev

# Apply manifests using the Kubernetes sequence above.

minikube addons enable ingress
echo "$(minikube ip) marketplace.local" | sudo tee -a /etc/hosts
```

```bash
kubectl -n marketplace get pods -w
kubectl -n marketplace port-forward svc/minio 9000:9000 9001:9001
kubectl -n marketplace port-forward svc/catalog-service 50051:50051           # gRPC
kubectl -n marketplace port-forward deployment/catalog-service 3002:3000      # HTTP health
kubectl -n marketplace rollout restart deploy/catalog-service
```
