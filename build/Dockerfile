FROM node:22-alpine AS frontend-build

WORKDIR /app

ARG VITE_API_BASE_URL=""
ARG VITE_AGENT_PORTS=47600-47605

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AGENT_PORTS=${VITE_AGENT_PORTS}

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ /app/
RUN npm run build

FROM python:3.12-slim AS agent-dist

WORKDIR /src

COPY agent/ /src/agent/

RUN mkdir -p /out \
    && tar \
        --sort=name \
        --mtime='@0' \
        --owner=0 \
        --group=0 \
        --numeric-owner \
        --exclude='agent/.env' \
        --exclude='agent/.venv' \
        --exclude='agent/__pycache__' \
        --exclude='agent/.pytest_cache' \
        --exclude='agent/.mypy_cache' \
        --exclude='agent/.ruff_cache' \
        --exclude='agent/*.pyc' \
        --exclude='agent/*/__pycache__' \
        -cf - agent \
      | gzip -n > /out/qaa-tms-agent-src.tar.gz \
    && sha256sum /out/qaa-tms-agent-src.tar.gz > /out/qaa-tms-agent-src.tar.gz.sha256 \
    && cp /src/agent/pyproject.toml /out/agent-pyproject.toml

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV STATIC_DIR=/app/static
ENV AGENT_DIST_DIR=/app/agent-dist

WORKDIR /app

COPY backend/ /app/
COPY build/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

RUN chmod +x /usr/local/bin/backend-entrypoint.sh \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

COPY --from=frontend-build /app/dist /app/static
COPY --from=agent-dist /out /app/agent-dist

EXPOSE 8000

ENTRYPOINT ["backend-entrypoint.sh"]
