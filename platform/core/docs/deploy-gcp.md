# Deploy on Google Cloud

Prereqs: a GCP project with billing, `gcloud` signed in, this repo checked out.

```bash
PROJECT=my-project REGION=us-central1 ./deploy/gcp/deploy.sh
```

What it does: enables Cloud Run, Cloud Scheduler, Secret Manager and Artifact Registry; stores a generated bearer token in Secret Manager; deploys the container to Cloud Run (min=max=1 instance); creates a Cloud Scheduler job that `POST`s `/tick` every 10 minutes with the token; prints the dashboard URL.

Operating notes
* The dashboard is read-only without the token; gate resolution and item creation need it (`?token=` on the dashboard URL).
* Default storage is the instance's SQLite file: demo-grade, single instance. For durable, multi-instance use run `USE_CLOUD_SQL=1 ./deploy.sh`: it creates a Cloud SQL Postgres instance (db-f1-micro), database and user, stores the URL in Secret Manager as `ultrastable-db-url` and attaches it to Cloud Run over the Cloud SQL unix socket (`ULTRASTABLE_DB`). Not yet exercised against a live Cloud SQL instance. Backups are Cloud SQL automated backups (`Store.backup` is SQLite-only).
* To use Gemini via Vertex AI as an additional model adapter: implement `Agent.do/verify` against the Vertex endpoint (roadmap; same contract as `AnthropicAgent`).
* The Dockerfile is not yet built in this repo's CI environment locally; CI builds it on every push.
