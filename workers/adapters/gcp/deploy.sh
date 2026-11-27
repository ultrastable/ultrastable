#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
# Deploy the Ultrastable tick to Google Cloud. NOT YET RUN against a real project (needs a GCP project and billing; owner step).
# Usage: PROJECT=my-proj REGION=us-central1 ORG=acme bash adapters/gcp/deploy.sh   (from the repository root)
set -euo pipefail
: "${PROJECT:?}" "${REGION:=us-central1}" "${ORG:=demo}"
# US-14-R10 and US-14-R16: refuse to ship when the reviewer and the doer resolve to one model family while two are available. The keys live in
# Secret Manager, not in this shell, so a key_env a config names counts as declared (--keys-declared); the revision's own start-up check
# (adapters/gcp/server.js) reads real presence and a revision without its key never becomes ready. With no config this check is skipped
# loudly, and the start-up check is then the only one.
if [ -n "${ULTRASTABLE_CONFIG:-}" ]; then node core/modelport/cli.js "$ULTRASTABLE_CONFIG" --keys-declared
else echo "model-port check skipped: ULTRASTABLE_CONFIG is not set; the revision's start-up check still refuses a bad model setup" >&2; fi
SVC=ultrastable-tick; BUCKET="${PROJECT}-ultrastable-${ORG}"; SA="${SVC}@${PROJECT}.iam.gserviceaccount.com"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com --project "$PROJECT"
gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access || true
gcloud iam service-accounts create "$SVC" --project "$PROJECT" || true
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:${SA}" --role roles/storage.objectAdmin
head -c 32 /dev/urandom | base64 | gcloud secrets create ultrastable-tick-token --data-file=- --project "$PROJECT" || true
# The service account reads the tick token by identity permission, not by a copy: Cloud Run needs this binding for --set-secrets to start the revision.
gcloud secrets add-iam-policy-binding ultrastable-tick-token --project "$PROJECT" --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor
gcloud run deploy "$SVC" --project "$PROJECT" --region "$REGION" --source . --no-allow-unauthenticated \
  --service-account "$SA" --max-instances 1 --min-instances 0 \
  --set-env-vars "ULTRASTABLE_ORG=${ORG}" --set-secrets "TICK_TOKEN=ultrastable-tick-token:latest" \
  --add-volume "name=data,type=cloud-storage,bucket=${BUCKET}" --add-volume-mount "volume=data,mount-path=/data"
URL=$(gcloud run services describe "$SVC" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
TOKEN=$(gcloud secrets versions access latest --secret ultrastable-tick-token --project "$PROJECT")
# Cloud Scheduler: every 10 minutes, with the shared token and a Google identity token so Cloud Run IAM also passes. The job is the tick's clock, so
# it is created when it is missing and updated when it exists (a new URL or token reaches it); any refusal stops the script with its message.
if gcloud scheduler jobs describe ultrastable-tick --project "$PROJECT" --location "$REGION" --format 'value(name)'; then
  gcloud scheduler jobs update http ultrastable-tick --project "$PROJECT" --location "$REGION" --schedule "*/10 * * * *" \
    --uri "${URL}/tick" --http-method POST --update-headers "X-Tick-Token=${TOKEN}" \
    --oidc-service-account-email "$SA" --oidc-token-audience "$URL"
else
  gcloud scheduler jobs create http ultrastable-tick --project "$PROJECT" --location "$REGION" --schedule "*/10 * * * *" \
    --uri "${URL}/tick" --http-method POST --headers "X-Tick-Token=${TOKEN}" \
    --oidc-service-account-email "$SA" --oidc-token-audience "$URL"
fi
# An uptime check on /health every minute (the health row of US-SPEC-14 section 3; the platform's own uptime worker covers Cloudflare hosts at 5 minutes).
# The service refuses unauthenticated requests, so the check sends the Monitoring service agent's OIDC token and that agent may invoke the service.
# A failure of either step stops the deploy script with its message; there is no swallowed error. UNPROVEN until run against a project (section 8).
PNUM=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')
gcloud run services add-iam-policy-binding "$SVC" --project "$PROJECT" --region "$REGION" \
  --member "serviceAccount:service-${PNUM}@gcp-sa-monitoring-notification.iam.gserviceaccount.com" --role roles/run.invoker
UPT="https://monitoring.googleapis.com/v3/projects/${PROJECT}/uptimeCheckConfigs"
EXISTING=$(curl -fsS -H "Authorization: Bearer $(gcloud auth print-access-token)" "$UPT")
if grep -q "\"displayName\": \"${SVC}-health\"" <<<"$EXISTING"; then
  echo "uptime check ${SVC}-health already exists"
else
  curl -fsS -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "Content-Type: application/json" "$UPT" \
    -d "{\"displayName\":\"${SVC}-health\",\"monitoredResource\":{\"type\":\"uptime_url\",\"labels\":{\"project_id\":\"${PROJECT}\",\"host\":\"${URL#https://}\"}},\"httpCheck\":{\"path\":\"/health\",\"port\":443,\"useSsl\":true,\"serviceAgentAuthentication\":{\"type\":\"OIDC_TOKEN\"}},\"period\":\"60s\",\"timeout\":\"10s\"}"
fi
echo "deployed ${URL}; health: curl -H \"Authorization: Bearer \$(gcloud auth print-identity-token)\" ${URL}/health"
