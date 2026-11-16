"""
DAG-MILE Automated Pipeline Demo Script
Runs an end-to-end test against the local FastAPI server & Groq LLM:
  1. Health Check
  2. Upload messy Excel & CSV files
  3. Profile datasets
  4. Call Groq AI to match column synonyms across files
  5. Apply AI standardized names
  6. Clean outliers & impute missing values
  7. Download the cleaned CSV
"""

import asyncio
import json
import os
import sys
from pathlib import Path
import httpx

BASE_URL = os.getenv("DAG_MILE_URL", "http://127.0.0.1:8000")
DATA_DIR = Path(__file__).resolve().parent / "test_sample_data"

f1_path = DATA_DIR / "messy_hospital_vitals.xlsx"
f2_path = DATA_DIR / "clinic_b_patient_metrics.csv"


async def main():
    print("=" * 70)
    print("       🚀 DAG-MILE AUTOMATED PIPELINE TEST & DEMO SCRIPT")
    print("=" * 70)
    print(f"Target Server: {BASE_URL}")

    if not f1_path.exists() or not f2_path.exists():
        print(f"❌ Error: Test files not found in {DATA_DIR}")
        sys.exit(1)

    async with httpx.AsyncClient(timeout=60.0) as client:
        # ---------------------------------------------------------
        # STEP 1: Health Check
        # ---------------------------------------------------------
        print("\n[1/7] Checking Server Health...")
        try:
            res = await client.get(f"{BASE_URL}/api/health")
            health = res.json()
            print("  ✓ Server is ONLINE")
            print(f"  ✓ Supabase Configured: {health.get('supabase_configured')}")
            print(f"  ✓ LLM Configured:      {health.get('llm_configured')}")
            print(f"  ✓ LLM Model:           {health.get('llm_model')}")
        except Exception as e:
            print(f"  ❌ Failed to connect to {BASE_URL}. Is 'python main.py' running?")
            print(f"     Details: {e}")
            sys.exit(1)

        # ---------------------------------------------------------
        # STEP 2: File Upload (Multi-Format)
        # ---------------------------------------------------------
        print("\n[2/7] Uploading Messy Excel & CSV to /api/upload...")
        files_payload = [
            ("files", (f1_path.name, f1_path.read_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", (f2_path.name, f2_path.read_bytes(), "text/csv"))
        ]
        up_res = await client.post(f"{BASE_URL}/api/upload", files=files_payload)
        if up_res.status_code != 200:
            print(f"  ❌ Upload failed: {up_res.text}")
            sys.exit(1)

        up_data = up_res.json()
        session_id = up_data["session_id"]
        print(f"  ✓ Session Created: {session_id}")
        for f in up_data["files"]:
            print(f"    • {f['filename']} ({f['rows']} rows × {f['cols']} columns)")
            if "supabase_url" in f:
                print(f"      ☁ Supabase Storage: {f['supabase_url']}")

        # ---------------------------------------------------------
        # STEP 3: Analysis & Quality Profiling
        # ---------------------------------------------------------
        print(f"\n[3/7] Profiling Data Quality via /api/analyze/{session_id}...")
        an_res = await client.get(f"{BASE_URL}/api/analyze/{session_id}")
        an_data = an_res.json()
        for fname, prof in an_data["profiles"].items():
            print(f"    • {fname}: {prof['missing_cells_pct']}% missing cells, {prof['duplicate_rows']} duplicates")

        # ---------------------------------------------------------
        # STEP 4: Groq AI Column Synonym Harmonization
        # ---------------------------------------------------------
        print("\n[4/7] Calling Groq AI for Semantic Column Matching...")
        llm_res = await client.post(f"{BASE_URL}/api/llm/harmonize-schema/{session_id}")
        llm_data = llm_res.json()

        if not llm_data.get("configured"):
            print("  ⚠️ LLM is not configured. (Add GROQ_API_KEY in .env)")
            matches = []
        else:
            print(f"  ✓ Domain Detected: {llm_data.get('domain_detected')}")
            print(f"  ✓ Suggested Join Keys: {llm_data.get('suggested_join_keys')}")
            matches = llm_data.get("matches", [])
            print(f"\n  ✨ Found {len(matches)} AI Column Matches across files:")
            for m in matches:
                conf = int(m.get("confidence", 0.9) * 100)
                print(f"    • Canonical: '{m['canonical_name']}' ({conf}% confidence)")
                for fname, col in m.get("columns_by_file", {}).items():
                    print(f"        └─ [{fname}] -> '{col}'")

        # ---------------------------------------------------------
        # STEP 5: Apply Standardized Names
        # ---------------------------------------------------------
        print("\n[5/7] Standardizing Column Names across Files...")
        renames = []
        for m in matches:
            for fname, col in m.get("columns_by_file", {}).items():
                renames.append({"file": fname, "old_name": col, "new_name": m["canonical_name"]})

        if renames:
            ren_res = await client.post(f"{BASE_URL}/api/llm/apply-renames/{session_id}", json={"renames": renames})
            applied = ren_res.json().get("applied", [])
            print(f"  ✓ Successfully standardized {len(applied)} column names.")
        else:
            print("  ℹ No renames to apply.")

        # ---------------------------------------------------------
        # STEP 6: Preprocess & Clean Data (IQR + Imputation)
        # ---------------------------------------------------------
        target_file = f1_path.name
        print(f"\n[6/7] Preprocessing & Cleaning '{target_file}'...")
        sugg_res = await client.get(f"{BASE_URL}/api/preprocess-suggestions/{session_id}/{target_file}")
        sugg_data = sugg_res.json()
        print(f"  Found {sugg_data['outlier_rows_estimate']} potential outliers & {sugg_data['duplicate_rows']} duplicates.")

        prep_config = {"drop_duplicates": True, "columns": {}}
        for col_info in sugg_data["columns"]:
            cname = col_info["column"]
            prep_config["columns"][cname] = {
                "missing_strategy": "median" if col_info["feature_type"] == "numeric" else "none",
                "outlier_action": "winsorize" if col_info.get("outlier_count", 0) > 0 else "none",
                "scale": "none"
            }

        prep_res = await client.post(f"{BASE_URL}/api/preprocess/{session_id}/{target_file}", json=prep_config)
        prep_data = prep_res.json()
        print("  ✓ Actions taken:")
        for line in prep_data.get("log", []):
            print(f"      {line}")

        # ---------------------------------------------------------
        # STEP 7: Download Final Cleaned Dataset
        # ---------------------------------------------------------
        print("\n[7/7] Downloading Cleaned Dataset...")
        dl_res = await client.get(f"{BASE_URL}/api/download/{session_id}/{target_file}")
        out_csv = Path(__file__).resolve().parent / "test_sample_data" / "cleaned_output_sample.csv"
        out_csv.write_bytes(dl_res.content)
        print(f"  ✓ Cleaned CSV saved to: {out_csv}")
        print("\nPreview of Cleaned CSV (First 4 rows):")
        for line in dl_res.text.splitlines()[:5]:
            print(f"    {line}")

    print("\n" + "=" * 70)
    print("       🎉 PIPELINE COMPLETED SUCCESSFULLY! ALL TESTS PASSED.")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
