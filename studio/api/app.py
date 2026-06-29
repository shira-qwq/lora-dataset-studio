"""FastAPI app — Dataset Intelligence Studio bridge API.

Serves:
- REST endpoints for pipeline results (clusters, embeddings, features, images)
- Job submission and SSE progress
- React V2 SPA (mounted at /react/, primary UI)
- Legacy vanilla JS frontend (mounted at /app/, compatibility only)
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

# Ensure project root is in path for lighting_engine imports
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from .routers import results, jobs, reviews, exports, recluster, analysis, duplicate_groups

logger = logging.getLogger("studio-api")

app = FastAPI(
    title="Dataset Intelligence Studio — Bridge API",
    description="Bridges the lighting_engine pipeline output to a REST API for the web UI.",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers (registered before static mount so they take priority)
app.include_router(results.router, prefix="/api/v1")
app.include_router(jobs.router, prefix="/api/v1")
app.include_router(reviews.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")
app.include_router(recluster.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")
app.include_router(duplicate_groups.router, prefix="/api/v1")


@app.middleware("http")
async def disable_frontend_cache(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path == "/app" or path.startswith("/app/") or path == "/react" or path.startswith("/react/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.get("/api/v1/health")
async def health_check():
    """API health check."""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/")
async def root_redirect():
    """Redirect root to the React V2 frontend."""
    return RedirectResponse(url="/react/")


# ── Static frontend (mounted at /app/ to avoid catching API routes) ──
FRONTEND_DIR = _PROJECT_ROOT / "studio" / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    logger.warning(f"Frontend directory not found at {FRONTEND_DIR}. Create it for the web UI.")
    app.mount("/app", StaticFiles(directory=str(_PROJECT_ROOT), html=False), name="frontend")

# ── React frontend build (mounted at /react/ for SPA) ──
REACT_DIST_DIR = _PROJECT_ROOT / "studio" / "frontend_react" / "dist"
if REACT_DIST_DIR.is_dir():
    app.mount("/react/assets", StaticFiles(directory=str(REACT_DIST_DIR / "assets")), name="react_assets")

    from fastapi.responses import FileResponse

    @app.get("/react")
    @app.get("/react/{full_path:path}")
    async def serve_react(full_path: str = ""):
        """Serve React SPA — all unknown paths return index.html."""
        index_path = REACT_DIST_DIR / "index.html"
        if not index_path.exists():
            return {"error": "React build not found"}
        return FileResponse(str(index_path))
else:
    logger.info("React frontend build not found at %s (this is OK in dev mode)", REACT_DIST_DIR)


@app.on_event("startup")
async def startup():
    """Log available job outputs on startup."""
    outputs_dir = _PROJECT_ROOT
    outputs = [p.name for p in outputs_dir.iterdir()
               if p.is_dir() and "_output" in p.name and p.name != "lighting_outputs"]
    logger.info(f"Studio API starting. Available outputs: {len(outputs)} runs found")
    for o in outputs[:5]:
        logger.info(f"  - {o}")
