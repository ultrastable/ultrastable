# BOUNDARY-1: the closed boundary as a container. Inside it agents create and destroy freely; the image rebuilds from this repository alone.
# Egress (credentials, money, owner accounts, public publishing, third-party systems) is not mounted: no secrets, no network by default.
# Run: docker build -t ultrastable-boundary . && docker run --rm --network none ultrastable-boundary
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git tar && rm -rf /var/lib/apt/lists/*
WORKDIR /boundary
COPY . .
RUN git init -q && git add -A && git -c user.email=b@b -c user.name=boundary commit -qm boundary
CMD ["sh", "-c", "python3 -m foundation boundary --check && python3 -m foundation boundary --drill"]
