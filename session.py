"""
In-memory session manager for storing DataFrames, uploaded metadata,
and transformation logs during a user session.
"""
import uuid
from typing import Any, Dict

_SESSIONS: Dict[str, Any] = {}

def new_session() -> str:
    sid = str(uuid.uuid4())
    _SESSIONS[sid] = {
        "files": {},      # filename -> pd.DataFrame
        "log": {},        # filename -> list of log strings
        "conflicts": [],  # relationship dicts
    }
    return sid

def get_session(session_id: str) -> dict:
    if session_id not in _SESSIONS:
        raise KeyError("Session not found")
    return _SESSIONS[session_id]

def add_file(session_id: str, filename: str, df):
    s = get_session(session_id)
    s["files"][filename] = df
    if filename not in s["log"]:
        s["log"][filename] = []

def get_df(session_id: str, filename: str):
    s = get_session(session_id)
    if filename not in s["files"]:
        raise KeyError(f"File '{filename}' not found in session")
    return s["files"][filename]

def set_df(session_id: str, filename: str, df):
    s = get_session(session_id)
    s["files"][filename] = df

def log(session_id: str, filename: str, message: str):
    s = get_session(session_id)
    if filename not in s["log"]:
        s["log"][filename] = []
    s["log"][filename].append(message)
