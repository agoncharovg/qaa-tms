# QAA-TMS Frontend

## Local run

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

The SPA serves on `http://localhost:3000` and expects the backend on
`http://localhost:8000` by default.

## Docker Compose

From the repository root:

```bash
docker compose up --build frontend backend db
```

That starts Postgres, the FastAPI backend, and the Vite frontend together for
local development.

## Environment variables

- `VITE_API_BASE_URL`: base URL for the FastAPI backend. Default:
  `http://localhost:8000`
- `VITE_AGENT_PORTS`: local companion-app probe range. Default:
  `47600-47605`
