FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_AGENT_PORTS=47600-47605

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_AGENT_PORTS=${VITE_AGENT_PORTS}

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ /app/
RUN npm run build

FROM nginx:1.29-alpine

COPY build/nginx.conf /etc/nginx/conf.d/default.conf
COPY build/frontend-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 8080
