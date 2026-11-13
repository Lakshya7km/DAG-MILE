"""
LLM Service module for DAG-MILE using free-tier Groq API.
Handles:
1. Zero-shot spreadsheet header & sentinel null detection (Chen & Cafarella, 2013)
2. Cross-file column synonym matching & canonical normalization (Valentine/Ditto, 2021)
3. Safe fallback if API key is missing or rate limits occur.
"""

import io
import json
import logging
import os
from typing import Any, Dict, List, Optional
import pandas as pd

import config

logger = logging.getLogger("dag_mile.llm")

# Check if Groq client can be initialized
_groq_client = None

def is_configured() -> bool:
    """Returns True if GROQ_API_KEY is present."""
    return bool(config.GROQ_API_KEY)


def get_client():
    global _groq_client
    if _groq_client is None and is_configured():
        try:
            from groq import Groq
            _groq_client = Groq(api_key=config.GROQ_API_KEY)
        except Exception as e:
            logger.error("Failed to initialize Groq client: %s", e)
            return None
    return _groq_client


def extract_top_raw_lines(raw_bytes: bytes, filename: str, max_lines: int = 15) -> str:
    """Extracts first N lines of text representation for LLM inspection."""
    ext = os.path.splitext(filename.lower())[1]
    
    if ext in [".csv", ".tsv"]:
        sep = "\t" if ext == ".tsv" else ","
        try:
            sample = pd.read_csv(io.BytesIO(raw_bytes), sep=sep, header=None, nrows=max_lines)
            return sample.to_string(index=True)
        except Exception:
            return raw_bytes[:2048].decode("utf-8", errors="replace")

    if ext in [".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"]:
        try:
            xl = pd.ExcelFile(io.BytesIO(raw_bytes))
            sheet = xl.sheet_names[0]
            raw_df = xl.parse(sheet, header=None, nrows=max_lines)
            return raw_df.to_string(index=True)
        except Exception:
            return ""

    if ext == ".json":
        try:
            sample = pd.read_json(io.BytesIO(raw_bytes))
            return sample.head(max_lines).to_string(index=True)
        except Exception:
            return ""

    return ""


async def inspect_spreadsheet_structure(raw_bytes: bytes, filename: str) -> Optional[Dict[str, Any]]:
    """
    Asks the LLM to locate true column headers, units, and sentinel null codes
    from raw rows before pandas parses it.
    """
    client = get_client()
    if not client:
        return None

    raw_sample = extract_top_raw_lines(raw_bytes, filename, max_lines=14)
    if not raw_sample.strip():
        return None

    prompt = f"""You are an expert data parsing assistant. Inspect the top raw rows of the spreadsheet '{filename}'.
Identify:
1. "header_row": 0-indexed row index containing the actual column headers (skipping human title banners, dates, notes).
2. "unit_row": 0-indexed row index containing measurement units if separate, otherwise null.
3. "data_start_row": 0-indexed row where the data records begin.
4. "sentinel_nulls": A list of custom text tokens indicating missing/error values (e.g. "Invalid", "Pw.Off", "Callb.", "-999", "N/A", "---").

Raw snippet:
{raw_sample}

Respond ONLY with valid JSON in this exact structure:
{{
  "header_row": int,
  "unit_row": int or null,
  "data_start_row": int,
  "sentinel_nulls": [string]
}}"""

    try:
        completion = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a specialized tabular data parser. Output valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=300
        )
        data = json.loads(completion.choices[0].message.content)
        logger.info("LLM spreadsheet inspection success for %s: %s", filename, data)
        return data
    except Exception as e:
        logger.warning("LLM spreadsheet inspection failed for %s: %s", filename, e)
        return None


async def harmonize_cross_file_schema(files_dict: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
    """
    Cross-file semantic schema alignment using Valentine/Ditto principles.
    Identifies column synonyms (e.g. 'NO2' vs 'nitrogen dioxide') and recommends join keys.
    """
    client = get_client()
    if not client:
        return {
            "configured": False,
            "message": "Groq API key not configured in .env",
            "matches": [],
            "suggested_join_keys": []
        }

    # Build schema summary with sample values for context
    summary = {}
    for fname, df in files_dict.items():
        cols_summary = []
        for col in df.columns[:30]:  # limit to top 30 cols to save tokens
            sample_vals = [str(v) for v in df[col].dropna().head(3).tolist()]
            cols_summary.append({
                "name": str(col),
                "samples": sample_vals
            })
        summary[fname] = cols_summary

    prompt = f"""You are an expert in tabular schema matching (Valentine / Ditto methodology).
Analyze the column names and sample values from multiple uploaded datasets:

{json.dumps(summary, indent=2)}

Task:
1. Identify column synonyms across different files that refer to the SAME real-world feature (e.g., 'NO2' vs 'nitrogen dioxide' vs 'NO2_BHATAGAON (ug/m3)', or 'Cust_ID' vs 'client_num').
2. Provide a standard, clean snake_case 'canonical_name' for each matched group.
3. Suggest the best primary/join keys (e.g., timestamps, IDs, station names) common across these files.

Respond ONLY with valid JSON with this exact structure:
{{
  "domain_detected": string,
  "matches": [
    {{
      "canonical_name": string,
      "columns_by_file": {{ "file_name": "column_name" }},
      "confidence": float,
      "reason": string
    }}
  ],
  "suggested_join_keys": [string]
}}"""

    try:
        completion = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a schema matching and entity resolution expert. Output valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
            max_tokens=800
        )
        result = json.loads(completion.choices[0].message.content)
        result["configured"] = True
        return result
    except Exception as e:
        logger.error("LLM schema harmonization failed: %s", e)
        return {
            "configured": True,
            "error": str(e),
            "matches": [],
            "suggested_join_keys": []
        }
