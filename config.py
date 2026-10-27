"""
Centralised configuration for DAG-MILE.

Reads from a ``.env`` file (if present) via ``python-dotenv``, then
falls back to sensible defaults so the app always starts.
"""

import os
from pathlib import Path

# ── Load .env (must happen before any os.getenv calls elsewhere) ────
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=env_path, override=False)
except ImportError:
    # python-dotenv is optional; env vars can be set by the OS / Docker
    pass


# ── Server ──────────────────────────────────────────────────────────
HOST: str = os.getenv("HOST", "127.0.0.1")
PORT: int = int(os.getenv("PORT", "8000"))

# ── CORS ────────────────────────────────────────────────────────────
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS: list[str] = [
    o.strip() for o in _raw_origins.split(",") if o.strip()
]
