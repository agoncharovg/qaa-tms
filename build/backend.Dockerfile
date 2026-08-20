FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/ /app/
COPY build/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

RUN chmod +x /usr/local/bin/backend-entrypoint.sh \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

EXPOSE 8000

ENTRYPOINT ["backend-entrypoint.sh"]
