"""
Supabase Storage helper — uploads raw file bytes to a Supabase Storage
bucket and returns the public/signed URL.

This module is 100 % optional.  If the SUPABASE_URL or
SUPABASE_SERVICE_ROLE_KEY env-vars are missing, every function
silently returns None so the rest of the app keeps working.
"""

import logging
import os
import uuid
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger("dag_mile.supabase")

# ── Configuration (read once at import time) ────────────────────────
SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL") or None
SUPABASE_SERVICE_KEY: Optional[str] = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None
SUPABASE_ANON_KEY: Optional[str] = os.getenv("SUPABASE_ANON_KEY") or None
SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "dag-mile-uploads")


def is_configured() -> bool:
    """Return True when Supabase credentials are present."""
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _storage_url() -> str:
    """Base URL for the Supabase Storage REST API."""
    url = SUPABASE_URL.rstrip("/")  # type: ignore[union-attr]
    return f"{url}/storage/v1"


def _auth_headers() -> dict:
    """Headers required by the Supabase Storage REST API."""
    return {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "apikey": SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY or "",
    }


def _build_object_path(session_id: str, filename: str) -> str:
    """
    Build a unique object path inside the bucket:
        <session_id>/<timestamp>_<short-uuid>_<filename>
    This avoids collisions even if the same file name is uploaded twice.
    """
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    short_id = uuid.uuid4().hex[:8]
    safe_name = filename.replace(" ", "_")
    return f"{session_id}/{ts}_{short_id}_{safe_name}"


# ── Mime-type helper ────────────────────────────────────────────────
_EXT_MIME = {
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".json": "application/json",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
    ".xlsb": "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
}


def _guess_mime(filename: str) -> str:
    ext = ("." + filename.rsplit(".", 1)[-1]).lower() if "." in filename else ""
    return _EXT_MIME.get(ext, "application/octet-stream")


# ── Public API ──────────────────────────────────────────────────────

async def upload_file(
    session_id: str,
    filename: str,
    raw_bytes: bytes,
) -> Optional[dict]:
    """
    Upload *raw_bytes* to Supabase Storage under the session folder.

    Returns a dict with ``path`` and ``public_url`` on success,
    or ``None`` when Supabase is not configured or the upload fails.
    """
    if not is_configured():
        return None

    object_path = _build_object_path(session_id, filename)
    url = f"{_storage_url()}/object/{SUPABASE_BUCKET}/{object_path}"
    mime = _guess_mime(filename)

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers={
                    **_auth_headers(),
                    "Content-Type": mime,
                    # "x-upsert": "true"  ← uncomment to allow overwrites
                },
                content=raw_bytes,
            )

        if resp.status_code in (200, 201):
            public_url = (
                f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/"  # type: ignore[union-attr]
                f"{SUPABASE_BUCKET}/{object_path}"
            )
            logger.info("Uploaded %s → %s", filename, public_url)
            return {"path": object_path, "public_url": public_url}

        # Non-fatal: log the error, return None, app continues
        logger.warning(
            "Supabase upload failed for %s — HTTP %s: %s",
            filename, resp.status_code, resp.text[:300],
        )
        return None

    except Exception:
        logger.exception("Supabase upload error for %s", filename)
        return None


async def delete_file(object_path: str) -> bool:
    """Delete a single object from the bucket.  Returns True on success."""
    if not is_configured():
        return False

    url = f"{_storage_url()}/object/{SUPABASE_BUCKET}/{object_path}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(url, headers=_auth_headers())
        return resp.status_code in (200, 204)
    except Exception:
        logger.exception("Supabase delete error for %s", object_path)
        return False
