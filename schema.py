"""
Schema analysis, feature type inference, and relationship/conflict detector.
"""
from typing import Any, Dict, List
import pandas as pd
import numpy as np

def infer_feature_type(series: pd.Series) -> str:
    if series.empty:
        return "text"
    
    # Check numeric
    if pd.api.types.is_numeric_dtype(series):
        uniques = series.dropna().unique()
        if len(uniques) <= 2 and set(uniques).issubset({0, 1, 0.0, 1.0}):
            return "boolean"
        return "numeric"
    
    # Check datetime
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    
    # Try parsing datetime if string
    if series.dtype == "object":
        non_na = series.dropna()
        if not non_na.empty and len(non_na) > 5:
            sample = non_na.head(20)
            try:
                pd.to_datetime(sample, format="mixed", errors="raise")
                return "datetime"
            except Exception:
                pass
    
    # Check boolean object
    uniques = series.dropna().unique()
    if len(uniques) <= 2 and set(str(u).lower() for u in uniques).issubset({"true", "false", "yes", "no", "t", "f", "0", "1"}):
        return "boolean"
    
    # Check unique identifiers vs categorical
    n_unique = series.nunique(dropna=True)
    n_total = len(series.dropna())
    
    if n_total > 0 and (n_unique / n_total) > 0.9 and n_unique > 20:
        return "identifier"
        
    if n_unique <= 50 or (n_total > 0 and (n_unique / n_total) < 0.2):
        return "categorical"
        
    return "text"


def profile_dataframe(df: pd.DataFrame) -> Dict[str, Any]:
    n_rows, n_cols = df.shape
    total_cells = n_rows * n_cols
    missing_cells = int(df.isna().sum().sum())
    dup_rows = int(df.duplicated().sum())
    
    columns_info = []
    for col in df.columns:
        s = df[col]
        ftype = infer_feature_type(s)
        missing = int(s.isna().sum())
        columns_info.append({
            "column": str(col),
            "feature_type": ftype,
            "missing_count": missing,
            "missing_pct": round(100 * missing / n_rows, 2) if n_rows > 0 else 0.0,
            "unique_values": int(s.nunique(dropna=True)),
        })
        
    return {
        "n_rows": n_rows,
        "n_cols": n_cols,
        "missing_cells_pct": round(100 * missing_cells / total_cells, 2) if total_cells > 0 else 0.0,
        "duplicate_rows": dup_rows,
        "duplicate_pct": round(100 * dup_rows / n_rows, 2) if n_rows > 0 else 0.0,
        "columns": columns_info,
    }


def detect_relationships(files: Dict[str, pd.DataFrame]) -> List[Dict[str, Any]]:
    relationships = []
    filenames = list(files.keys())
    
    for i in range(len(filenames)):
        for j in range(i + 1, len(filenames)):
            fa, fb = filenames[i], filenames[j]
            df_a, df_b = files[fa], files[fb]
            
            for col_a in df_a.columns:
                for col_b in df_b.columns:
                    str_a, str_b = str(col_a).strip(), str(col_b).strip()
                    
                    if str_a.lower() == str_b.lower():
                        vals_a = set(df_a[col_a].dropna().astype(str))
                        vals_b = set(df_b[col_b].dropna().astype(str))
                        overlap = len(vals_a.intersection(vals_b))
                        
                        if overlap > 0 and len(vals_a) > 0 and len(vals_b) > 0:
                            jaccard = overlap / len(vals_a.union(vals_b))
                            if jaccard > 0.3 or "date" in str_a.lower() or "id" in str_a.lower() or "station" in str_a.lower():
                                relationships.append({
                                    "file_a": fa, "column_a": str(col_a),
                                    "file_b": fb, "column_b": str(col_b),
                                    "relationship": "join_key",
                                    "confidence": min(0.95, round(jaccard + 0.5, 2)),
                                    "files_count": len(filenames),
                                    "note": f"Matching column values ({overlap} overlapping values found).",
                                    "recommendation": f"Use '{col_a}' as JOIN key",
                                })
                            else:
                                relationships.append({
                                    "file_a": fa, "column_a": str(col_a),
                                    "file_b": fb, "column_b": str(col_b),
                                    "relationship": "same_feature",
                                    "confidence": 0.85,
                                    "files_count": len(filenames),
                                    "note": "Same column name across datasets.",
                                    "recommendation": "Merge or concatenate rows",
                                })
                        else:
                            relationships.append({
                                "file_a": fa, "column_a": str(col_a),
                                "file_b": fb, "column_b": str(col_b),
                                "relationship": "conflict",
                                "confidence": 0.75,
                                "files_count": len(filenames),
                                "note": "Same column name but completely different non-overlapping values.",
                                "recommendation": "Rename or keep separate",
                            })
                            
    return relationships
