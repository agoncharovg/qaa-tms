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

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV STATIC_DIR=/app/static

WORKDIR /app

COPY backend/ /app/
COPY build/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

RUN chmod +x /usr/local/bin/backend-entrypoint.sh \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

COPY --from=frontend-build /app/dist /app/static

EXPOSE 8000

ENTRYPOINT ["backend-entrypoint.sh"]
