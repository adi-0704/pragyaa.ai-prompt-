# Pragyaa.AI — Prompt Evolution Engine

AI-powered audit prompt recalibration for ICICI Bank DC upgrade calls.

## Stack
- Frontend: Vanilla HTML/CSS/JS
- Backend: Python (Flask) — Vercel Serverless Function
- AI: Internal Vertex AI API (gemini-2.5-flash-lite)

## Structure
```
/
├── index.html          # UI
├── app.js              # Frontend logic
├── style.css           # Styles
├── requirements.txt    # Python deps
├── vercel.json         # Routing config
└── api/
    └── index.py        # Flask serverless backend
```

## Endpoints
- `POST /api/analyze` — Upload Excel, get discrepancy analysis + AI-evolved prompt
- `POST /api/vertex`  — Proxy to internal Vertex AI
- `GET  /api/health`  — Health check
