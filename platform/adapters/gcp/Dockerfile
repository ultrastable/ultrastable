# Build from the repository root: docker build -f platform/adapters/gcp/Dockerfile -t ultrastable-tick .
FROM node:22-slim
WORKDIR /app
COPY seed/worker/src ./seed/worker/src
COPY seed/worker/migrations ./seed/worker/migrations
COPY seed/autonomy ./seed/autonomy
COPY platform/adapters ./platform/adapters
ENV PORT=8080 ULTRASTABLE_DB=/data/ultrastable.db
CMD ["node", "--no-warnings", "platform/adapters/gcp/server.js"]
