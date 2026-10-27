import io
import json
import logging
import re
from pathlib import Path
from typing import List, Optional
import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

# ── Project modules ─────────────────────────────────────────────────
import config  # noqa: F401  — loads .env, must be imported FIRST
import session as sess
import supabase_storage as storage
from preprocessing import apply_preprocessing, suggest_actions
from schema import detect_relationships, profile_dataframe

logger = logging.getLogger("dag_mile")

app = FastAPI(title="DAG-MILE API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Log Supabase status at startup
@app.on_event("startup")
def _log_config():
    if storage.is_configured():
        logger.info("✓ Supabase Storage is configured (bucket: %s)", storage.SUPABASE_BUCKET)
    else:
        logger.info("ℹ Supabase Storage is NOT configured — files will be kept in-memory only")

PROJECT_DIR = Path(__file__).resolve().parent

@app.get("/", include_in_schema=False)
def home():
    return FileResponse(PROJECT_DIR / "index.html")

@app.get("/style.css", include_in_schema=False)
def style():
    return FileResponse(PROJECT_DIR / "style.css", media_type="text/css")

@app.get("/app.js", include_in_schema=False)
def javascript():
    return FileResponse(PROJECT_DIR / "app.js", media_type="application/javascript")


def standardize_col_name(col: str, keep_units: bool = False) -> str:
    """Standardizes parameter column headers by fixing typos, extra underscores, and spacing."""
    col_str = str(col).replace("\xa0", " ").strip()
    
    # Clean multiple underscores (e.g. NO2__BHATAGAON -> NO2_BHATAGAON)
    col_str = re.sub(r"_+", "_", col_str)
    
    # Standardize spaces in common parameter names
    col_str = re.sub(r"\bHUM\s+BHATAGAON\b", "HUM_BHATAGAON", col_str, flags=re.IGNORECASE)
    col_str = re.sub(r"\bNO\s+BHATAGAON\b", "NO_BHATAGAON", col_str, flags=re.IGNORECASE)
    col_str = re.sub(r"\bPM2\s*5\b", "PM2_5", col_str, flags=re.IGNORECASE)
    
    # If keep_units is False (for merging/concatenating), strip unit parenthetical e.g. (ug/m3), (mg/m3)
    if not keep_units and "(" in col_str and ")" in col_str:
        col_str = re.sub(r"\s*\([^)]*\)", "", col_str).strip()
    else:
        col_str = re.sub(r"\s*\(\s*", " (", col_str)
        col_str = re.sub(r"\s*\)\s*", ")", col_str)
    
    return col_str


def clean_dcr_excel(raw_bytes: bytes) -> pd.DataFrame:
    """
    Intelligently parses DCR environmental station Excel reports by:
    1. Finding the true header row ('Date & Time' or parameter names)
    2. Combining parameter names + units (e.g. 'NO_BHATAGAON (ug/m3)')
    3. Standardizing parameter column names to match across datasets
    4. Converting sensor flags ('Invalid', 'Pw.Off', 'Callb.') to NaN
    5. Merging all daily sheet tabs (01..31) if multiple exist
    """
    xl = pd.ExcelFile(io.BytesIO(raw_bytes))
    all_dfs = []
    
    STATUS_FLAGS = [
        "Invalid", "Pw.Off", "Callb.", "Z.Ref", "Link F", "Data F", 
        "Wm. Up", "Power Off", "Calibration", "Maintenance", "Link Fail", "Data Fail"
    ]

    # Prefer daily numbered sheets (01..31) — skip MONTHLY to avoid duplicate timestamps.
    # MONTHLY sheet contains daily averages that share the same 01:00 timestamps as hourly data.
    daily_sheets = [s for s in xl.sheet_names if s.strip().isdigit()]
    monthly_sheets = [s for s in xl.sheet_names if "MONTHLY" in s.upper()]

    if daily_sheets:
        sheets_to_read = daily_sheets          # Only hourly daily sheets
    elif monthly_sheets:
        sheets_to_read = monthly_sheets        # Fallback: only monthly summary
    else:
        sheets_to_read = xl.sheet_names        # Fallback: all sheets

    for sheet in sheets_to_read:
        raw_df = xl.parse(sheet, header=None)
        
        header_idx = None
        for i, row in raw_df.iterrows():
            row_vals = [str(c).replace("\xa0", " ").strip().lower() for c in row if pd.notna(c)]
            if "date & time" in row_vals or any(c.startswith(("no_", "pm", "so2_", "co_", "o3_", "nh3_")) for c in row_vals):
                header_idx = i
                break
                
        if header_idx is None:
            for i, row in raw_df.iterrows():
                row_vals = [str(c).replace("\xa0", " ").strip().lower() for c in row if pd.notna(c)]
                if any("date" in c for c in row_vals) and not any("station" in c for c in row_vals):
                    header_idx = i
                    break

        if header_idx is None:
            header_idx = 0
            
        param_row = raw_df.iloc[header_idx].fillna("").astype(str).str.replace("\xa0", " ").str.strip()
        
        unit_row = []
        if header_idx + 1 < len(raw_df):
            next_row = raw_df.iloc[header_idx + 1].fillna("").astype(str).str.replace("\xa0", " ").str.strip()
            if any(u in cell.lower() for cell in next_row for u in ["ug/m3", "ppb", "mg/m3", "m/sec", "deg", "%", "degree"]):
                unit_row = next_row
        
        offset = 2 if len(unit_row) > 0 else 1
        
        clean_headers = []
        for idx, p in enumerate(param_row):
            u = unit_row[idx] if idx < len(unit_row) else ""
            if p and u and u.lower() not in ["date & time", "date", "time", "nan"]:
                raw_header = f"{p} ({u})"
            elif p:
                raw_header = p
            else:
                raw_header = None  # Mark truly empty header columns for removal
                
            clean_headers.append(standardize_col_name(raw_header, keep_units=True) if raw_header else None)
                
        data_df = raw_df.iloc[header_idx + offset:].copy()
        data_df.columns = clean_headers
        
        # Drop columns that had no header (None) — these are trailing empty Excel columns like Column_17
        data_df = data_df.loc[:, [c for c in data_df.columns if c is not None]]
        
        data_df = data_df.dropna(how="all")
        
        # Drop columns that are entirely NaN — sensor may not measure this parameter
        data_df = data_df.dropna(axis=1, how="all")
        
        first_col = data_df.columns[0]
        data_df = data_df[data_df[first_col].astype(str).str.contains(r"\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}", regex=True, na=False)]
        
        all_dfs.append(data_df)

    if not all_dfs:
        return pd.DataFrame()

    final_df = pd.concat(all_dfs, ignore_index=True)
    
    with pd.option_context("future.no_silent_downcasting", True):
        final_df = final_df.replace(STATUS_FLAGS, np.nan)
    
    for col in final_df.columns:
        if "date" not in col.lower() and "time" not in col.lower():
            final_df[col] = pd.to_numeric(final_df[col], errors="coerce")
            
    return final_df


def _read_any(filename: str, raw: bytes) -> pd.DataFrame:
    name = filename.lower()

    if name.endswith(".csv"):
        df = pd.read_csv(io.BytesIO(raw))
        df.columns = [standardize_col_name(c, keep_units=True) for c in df.columns]
        return df

    if name.endswith(".tsv"):
        df = pd.read_csv(io.BytesIO(raw), sep="\t")
        df.columns = [standardize_col_name(c, keep_units=True) for c in df.columns]
        return df

    if name.endswith(".json"):
        df = pd.read_json(io.BytesIO(raw))
        df.columns = [standardize_col_name(c, keep_units=True) for c in df.columns]
        return df

    if name.endswith((".xlsx", ".xlsm", ".xlsb", ".ods", ".xls")):
        try:
            return clean_dcr_excel(raw)
        except Exception as e:
            try:
                df = pd.read_excel(io.BytesIO(raw))
                df.columns = [standardize_col_name(c, keep_units=True) for c in df.columns]
                return df
            except Exception:
                raise ValueError(f"Could not read spreadsheet '{filename}': {str(e)}")

    raise ValueError(f"Unsupported file type: {filename}")


def _file_summary(filename: str, df: pd.DataFrame) -> dict:
    return {
        "filename": filename,
        "rows": int(df.shape[0]),
        "cols": int(df.shape[1]),
        "columns": list(df.columns.astype(str)),
    }


def _find_col(df: pd.DataFrame, target_name: str) -> str:
    """Safely finds a column name in df despite whitespace, non-breaking spaces, or casing differences."""
    if target_name in df.columns:
        return target_name
    
    clean_target = standardize_col_name(target_name, keep_units=False).lower()
    for col in df.columns:
        if standardize_col_name(col, keep_units=False).lower() == clean_target:
            return col
            
    for col in df.columns:
        if clean_target in standardize_col_name(col, keep_units=False).lower():
            return col

    raise HTTPException(
        status_code=400,
        detail=f"Column '{target_name}' not found in dataset. Available columns: {list(df.columns.astype(str))}"
    )


@app.post("/api/upload")
async def upload(files: List[UploadFile] = File(...), session_id: Optional[str] = Form(None)):
    if not session_id:
        session_id = sess.new_session()
    else:
        try:
            sess.get_session(session_id)
        except KeyError:
            session_id = sess.new_session()

    summaries = []
    errors = []
    for f in files:
        raw = await f.read()
        try:
            df = _read_any(f.filename, raw)
        except Exception as e:
            errors.append({"filename": f.filename, "error": str(e)})
            continue

        # ── Supabase backup (non-blocking, best-effort) ─────────
        supabase_info = await storage.upload_file(session_id, f.filename, raw)

        sess.add_file(session_id, f.filename, df)
        sess.log(session_id, f.filename, f"File loaded: {df.shape[0]} rows x {df.shape[1]} columns")
        if supabase_info:
            sess.log(session_id, f.filename,
                     f"☁ Backed up to Supabase Storage: {supabase_info['path']}")

        summary = _file_summary(f.filename, df)
        if supabase_info:
            summary["supabase_path"] = supabase_info["path"]
            summary["supabase_url"] = supabase_info["public_url"]
        summaries.append(summary)

    return {"session_id": session_id, "files": summaries, "errors": errors}


@app.get("/api/analyze/{session_id}")
def analyze(session_id: str):
    try:
        s = sess.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found")

    if not s["files"]:
        raise HTTPException(400, "No files uploaded in this session yet")

    profiles = {fname: profile_dataframe(df) for fname, df in s["files"].items()}
    relationships = detect_relationships(s["files"]) if len(s["files"]) > 1 else []
    s["conflicts"] = relationships

    return {
        "session_id": session_id,
        "profiles": profiles,
        "relationships": relationships,
    }


class ResolveConflictBody(BaseModel):
    file_a: str
    column_a: str
    file_b: str
    column_b: str
    decision: str
    new_name: Optional[str] = None


@app.post("/api/resolve-conflict/{session_id}")
def resolve_conflict(session_id: str, body: ResolveConflictBody):
    try:
        sess.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found")

    if body.decision == "keep_separate":
        sess.log(session_id, body.file_a,
                  f"⚠ '{body.column_a}' kept separate from '{body.column_b}' in {body.file_b}")
        return {"status": "ok", "action": "kept_separate"}

    if body.decision in ("rename_a", "rename_b") and body.new_name:
        target_file = body.file_a if body.decision == "rename_a" else body.file_b
        target_col = body.column_a if body.decision == "rename_a" else body.column_b
        df = sess.get_df(session_id, target_file)
        real_col = _find_col(df, target_col)
        df = df.rename(columns={real_col: body.new_name})
        sess.set_df(session_id, target_file, df)
        sess.log(session_id, target_file, f"✓ Column renamed: '{real_col}' → '{body.new_name}'")
        return {"status": "ok", "action": "renamed", "file": target_file, "new_name": body.new_name}

    raise HTTPException(400, "Unrecognized decision / missing new_name")


class MergeBody(BaseModel):
    operation: str
    file_a: str
    file_b: str
    column_a: Optional[str] = None
    column_b: Optional[str] = None
    how: Optional[str] = "outer"
    new_name: str


@app.post("/api/merge/{session_id}")
def merge(session_id: str, body: MergeBody):
    try:
        sess.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found")

    df_a = sess.get_df(session_id, body.file_a).copy()
    df_b = sess.get_df(session_id, body.file_b).copy()

    # Standardize column headers without unit label mismatches so parameters match 1:1
    df_a.columns = [standardize_col_name(c, keep_units=False) for c in df_a.columns]
    df_b.columns = [standardize_col_name(c, keep_units=False) for c in df_b.columns]

    if body.operation == "join":
        if not body.column_a or not body.column_b:
            raise HTTPException(400, "column_a and column_b are required for a join")
        
        col_a = _find_col(df_a, body.column_a)
        col_b = _find_col(df_b, body.column_b)

        # Harmonize join key data types if dates/timestamps
        if "date" in col_a.lower() or "time" in col_a.lower() or "date" in col_b.lower() or "time" in col_b.lower():
            df_a[col_a] = pd.to_datetime(df_a[col_a], errors="coerce")
            df_b[col_b] = pd.to_datetime(df_b[col_b], errors="coerce")

            # Filter out NaT/null dates before merging to prevent Cartesian product of empty dates!
            df_a = df_a[df_a[col_a].notna()].copy()
            df_b = df_b[df_b[col_b].notna()].copy()

        merged = df_a.merge(
            df_b, left_on=col_a, right_on=col_b,
            how=body.how or "outer", suffixes=("_a", "_b"),
        )

        # Coalesce overlapping columns that differed only by _a / _b suffix
        cols_to_drop = []
        # Coalesce overlapping columns: e.g. RG_BHATAGAON_a + RG_BHATAGAON_b → RG_BHATAGAON
        import re as _re
        cols_to_drop = []
        for col in list(merged.columns):
            # Only match columns that end EXACTLY with _a or _b (not _0.0 or other suffixes)
            if _re.search(r'_a$', col):
                base = col[:-2]
                col_b_pair = f"{base}_b"
                if col_b_pair in merged.columns:
                    merged[base] = merged[col].combine_first(merged[col_b_pair])
                    cols_to_drop.extend([col, col_b_pair])

        if cols_to_drop:
            merged = merged.drop(columns=cols_to_drop)

        # Drop columns that are completely empty after merge
        merged = merged.dropna(axis=1, how="all")

        # Sort by date/time if present
        if col_a in merged.columns and pd.api.types.is_datetime64_any_dtype(merged[col_a]):
            merged = merged.sort_values(by=col_a).reset_index(drop=True)

        note = f"JOIN of {body.file_a} and {body.file_b} on '{col_a}'/'{col_b}' ({body.how}) → {merged.shape[0]} rows"

    elif body.operation == "concat":
        # Drop rows where Date & Time is missing before concat
        date_col_a = [c for c in df_a.columns if "date" in c.lower() or "time" in c.lower()]
        date_col_b = [c for c in df_b.columns if "date" in c.lower() or "time" in c.lower()]
        
        if date_col_a:
            df_a = df_a[df_a[date_col_a[0]].notna()].copy()
        if date_col_b:
            df_b = df_b[df_b[date_col_b[0]].notna()].copy()

        merged = pd.concat([df_a, df_b], axis=0, ignore_index=True)
        note = f"CONCAT of {body.file_a} and {body.file_b} → {merged.shape[0]} rows"
    else:
        raise HTTPException(400, "operation must be 'join' or 'concat'")

    # Drop rows where ALL measurement columns (non-datetime) are NaN
    # These are sensor-off / power-off hours in the original Excel that have a timestamp but no data
    date_cols_in_merged = [c for c in merged.columns if "date" in c.lower() or "time" in c.lower()]
    measure_cols = [c for c in merged.columns if c not in date_cols_in_merged]
    if measure_cols:
        before_drop = len(merged)
        merged = merged.dropna(subset=measure_cols, how="all").reset_index(drop=True)
        dropped = before_drop - len(merged)
        if dropped:
            sess.log(session_id, body.new_name, f"⚠ {dropped} rows with no sensor data (all-NaN measurements) removed after merge")

    sess.add_file(session_id, body.new_name, merged)
    sess.log(session_id, body.new_name, f"✓ {note}")

    return {"status": "ok", "new_file": _file_summary(body.new_name, merged)}


@app.get("/api/preprocess-suggestions/{session_id}/{filename:path}")
def preprocess_suggestions(session_id: str, filename: str):
    try:
        df = sess.get_df(session_id, filename)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return suggest_actions(df)


class PreprocessBody(BaseModel):
    drop_duplicates: bool = True
    columns: dict = {}


@app.post("/api/preprocess/{session_id}/{filename:path}")
def preprocess(session_id: str, filename: str, body: PreprocessBody):
    try:
        df = sess.get_df(session_id, filename)
    except KeyError as e:
        raise HTTPException(404, str(e))

    config_data = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    new_df, log_lines = apply_preprocessing(df, config_data)
    sess.set_df(session_id, filename, new_df)
    for line in log_lines:
        sess.log(session_id, filename, line)

    return {
        "status": "ok",
        "filename": filename,
        "shape": list(new_df.shape),
        "log": log_lines,
        "profile": profile_dataframe(new_df),
    }


@app.get("/api/download/{session_id}/{filename:path}")
def download(session_id: str, filename: str):
    try:
        df = sess.get_df(session_id, filename)
    except KeyError as e:
        raise HTTPException(404, str(e))
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    out_name = filename.rsplit(".", 1)[0] + "_cleaned.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{out_name}"'},
    )


@app.get("/api/download-log/{session_id}")
def download_log(session_id: str):
    try:
        s = sess.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found")
    lines = ["DAG-MILE Transformation Log", "=" * 40, ""]
    for fname, entries in s["log"].items():
        lines.append(f"[{fname}]")
        lines.extend(f"  {e}" for e in entries)
        lines.append("")
    text = "\n".join(lines)
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": 'attachment; filename="transformation_log.txt"'},
    )


@app.get("/api/session/{session_id}")
def session_state(session_id: str):
    try:
        s = sess.get_session(session_id)
    except KeyError:
        raise HTTPException(404, "Session not found")
    return {
        "session_id": session_id,
        "files": [_file_summary(f, df) for f, df in s["files"].items()],
        "log": s["log"],
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "supabase_configured": storage.is_configured(),
        "host": config.HOST,
        "port": config.PORT,
    }


if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host=config.HOST, port=config.PORT)
