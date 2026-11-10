#!/usr/bin/env bash
# Deploy Ultrastable to Google Cloud Run with a Cloud Scheduler heartbeat.
# Usage: PROJECT=my-gcp-project REGION=us-central1 ./deploy.sh
set -euo pipefail
: "${PROJECT:?set PROJECT}"; REGION="${REGION:-us-central1}"; SVC="${SVC:-ultrastable}"
TOKEN="${ULTRASTABLE_TOKEN:-$(openssl rand -hex 24)}"
gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
printf %s "$TOKEN" | gcloud secrets create ultrastable-token --data-file=- 2>/dev/null || printf %s "$TOKEN" | gcloud secrets versions add ultrastable-token --data-file=-
# Default: one instance, SQLite on the instance disk (demo-grade).
# USE_CLOUD_SQL=1: Cloud SQL Postgres (durable, multi-instance). Needs billing; creates a db-f1-micro instance.
if [ "${USE_CLOUD_SQL:-0}" = "1" ]; then
  SQL_INSTANCE="${SQL_INSTANCE:-ultrastable-pg}"; DB_NAME="${DB_NAME:-ultrastable}"; DB_USER="${DB_USER:-ultrastable}"
  gcloud services enable sqladmin.googleapis.com
  gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
    gcloud sql instances create "$SQL_INSTANCE" --database-version=POSTGRES_16 --tier=db-f1-micro --region "$REGION" --backup-start-time=03:00
  gcloud sql databases create "$DB_NAME" --instance "$SQL_INSTANCE" 2>/dev/null || true
  DB_PASS="$(openssl rand -hex 16)"
  gcloud sql users create "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASS" 2>/dev/null \
    || gcloud sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASS"
  CONN="$(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')"
  DB_URL="postgresql://$DB_USER:$DB_PASS@/$DB_NAME?host=/cloudsql/$CONN"
  printf %s "$DB_URL" | gcloud secrets create ultrastable-db-url --data-file=- 2>/dev/null \
    || printf %s "$DB_URL" | gcloud secrets versions add ultrastable-db-url --data-file=-
  # Cloud Run's service account needs roles/cloudsql.client and roles/secretmanager.secretAccessor.
  gcloud run deploy "$SVC" --source "$(dirname "$0")/../.." --region "$REGION" --allow-unauthenticated \
    --min-instances 1 --max-instances 3 --add-cloudsql-instances "$CONN" \
    --set-secrets ULTRASTABLE_TOKEN=ultrastable-token:latest,ULTRASTABLE_DB=ultrastable-db-url:latest
else
  gcloud run deploy "$SVC" --source "$(dirname "$0")/../.." --region "$REGION" --allow-unauthenticated \
    --min-instances 1 --max-instances 1 --set-secrets ULTRASTABLE_TOKEN=ultrastable-token:latest
fi
URL="$(gcloud run services describe "$SVC" --region "$REGION" --format 'value(status.url)')"
gcloud scheduler jobs create http ultrastable-tick --location "$REGION" --schedule "*/10 * * * *" \
  --uri "$URL/tick" --http-method POST --headers "Authorization=Bearer $TOKEN" 2>/dev/null \
  || gcloud scheduler jobs update http ultrastable-tick --location "$REGION" --schedule "*/10 * * * *" \
       --uri "$URL/tick" --http-method POST --headers "Authorization=Bearer $TOKEN"
echo "Dashboard: $URL   (writes need: Authorization: Bearer <token in Secret Manager 'ultrastable-token'>)"
