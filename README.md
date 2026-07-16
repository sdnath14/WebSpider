# WebSpy deployment layout

The app is split into two independent projects:

- `frontend/` — Vite static site for Vercel.
- `backend/` — Node API for Render, including Playwright-based scraping.

## Deploy the backend to Render

1. Create a **Web Service** from this repository. Render can use the included `render.yaml`, or configure it manually with root directory `backend`, build command `npm ci && npx playwright install --with-deps chromium`, and start command `npm start`.
2. Set `ALLOWED_ORIGINS` to your Vercel URL, for example `https://web-spy.vercel.app`. Multiple origins are comma-separated. Include your local Vite URL too if needed: `https://web-spy.vercel.app,http://localhost:5173`.
3. Deploy and copy the public service URL. Confirm `https://<your-service>.onrender.com/health` returns `{"success":true,"status":"ok"}`.

The API listens on Render's `PORT` automatically. Standard scans are fetched by the backend, so the browser no longer depends on public CORS proxies.

### Optional AI and file storage

The AI search and chat routes require an Ollama-compatible server. Set `OLLAMA_HOST` on Render only when you have a reachable Ollama service; a local Ollama process cannot run inside the standard Render web service by itself.

Render's default filesystem is ephemeral. Saved scrape JSON files are temporary unless `SCRAPES_DIR` points to a mounted persistent disk. The frontend still keeps its report history in the browser.

## Deploy the frontend to Vercel

1. Import the same repository into Vercel and set the project **Root Directory** to `frontend`.
2. Add the environment variable `VITE_API_URL` with the Render service URL, for example `https://web-spy-api.onrender.com`. Add it for Production, Preview, and Development as appropriate.
3. Deploy. Vercel runs `npm run build` and serves `dist/`.

For local development, run the backend and frontend in separate terminals:

```bash
cd backend && npm ci && npm run dev
cd frontend && npm install && npm run dev
```

`frontend/.env.example` documents the frontend variable. In development the frontend defaults to `http://localhost:3000` when `VITE_API_URL` is not set.
