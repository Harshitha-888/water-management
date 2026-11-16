import json
import math
import statistics
import sys
import time


def is_number(val):
    if isinstance(val, bool) or val is None:
        return False
    if isinstance(val, (int, float)):
        return math.isfinite(val)
    if isinstance(val, str):
        s = val.strip().replace(",", "")
        if not s:
            return False
        try:
            v = float(s)
            return math.isfinite(v)
        except ValueError:
            return False
    return False


def to_float(val):
    if isinstance(val, (int, float)):
        return float(val)
    return float(str(val).strip().replace(",", ""))


def preprocess_rows(payload):
    t0 = time.perf_counter()
    filename = payload.get("filename", "dataset.csv")
    category = payload.get("category", "Water consumption data")
    rows = payload.get("rows", [])

    if not rows:
        return {
            "success": True,
            "engine": f"Python {sys.version.split()[0]} (Data Preprocessing Pipeline)",
            "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
            "filename": filename,
            "category": category,
            "raw_rows": 0,
            "cleaned_rows": 0,
            "duplicates_removed": 0,
            "missing_values_imputed": 0,
            "outliers_flagged": 0,
            "columns": [],
            "numeric_stats": [],
            "cleaned_preview": [],
            "steps": ["Loaded 0 records from HDFS blocks"],
        }

    # Preserve column order, exclude internal HDFS metadata fields from schema analysis
    ignore_cols = {"block_id", "hdfs_node", "dataset_id", "dataset_filename", "category"}
    col_names = []
    seen_cols = set()
    for r in rows:
        for k in r.keys():
            if k not in ignore_cols and k not in seen_cols:
                seen_cols.add(k)
                col_names.append(k)

    # Deduplicate exact records
    unique_rows = []
    seen_sigs = set()
    duplicates_removed = 0
    for r in rows:
        sig = tuple((c, str(r.get(c, "")).strip()) for c in col_names if c != "id")
        if sig in seen_sigs:
            duplicates_removed += 1
        else:
            seen_sigs.add(sig)
            unique_rows.append(dict(r))

    # Classify columns & compute imputation fills
    numeric_cols = []
    text_cols = []
    missing_counts = {c: 0 for c in col_names}

    for c in col_names:
        non_empty = [r.get(c) for r in unique_rows if r.get(c) is not None and str(r.get(c)).strip() != ""]
        missing_counts[c] = len(unique_rows) - len(non_empty)
        if non_empty and all(is_number(v) for v in non_empty):
            numeric_cols.append(c)
        else:
            text_cols.append(c)

    # Mean values for numeric imputation, mode for categorical
    col_means = {}
    for c in numeric_cols:
        vals = [to_float(r.get(c)) for r in unique_rows if r.get(c) is not None and is_number(r.get(c))]
        col_means[c] = round(statistics.mean(vals), 2) if vals else 0.0

    col_modes = {}
    for c in text_cols:
        vals = [str(r.get(c)).strip() for r in unique_rows if r.get(c) is not None and str(r.get(c)).strip() != ""]
        if vals:
            try:
                col_modes[c] = statistics.mode(vals)
            except statistics.StatisticsError:
                col_modes[c] = vals[0]
        else:
            col_modes[c] = "Unknown"

    missing_values_imputed = 0
    cleaned_rows = []
    for r in unique_rows:
        nr = {}
        for c in col_names:
            val = r.get(c)
            if val is None or (isinstance(val, str) and val.strip() == ""):
                missing_values_imputed += 1
                nr[c] = col_means[c] if c in numeric_cols else col_modes[c]
            elif c in numeric_cols:
                nr[c] = round(to_float(val), 2)
            else:
                nr[c] = " ".join(str(val).strip().split())
        cleaned_rows.append(nr)

    # Numeric stats & IQR outlier scan
    numeric_stats = []
    total_outliers = 0
    for c in numeric_cols:
        if c == "id":
            continue
        vals = sorted([float(r[c]) for r in cleaned_rows])
        if not vals:
            continue
        n = len(vals)
        q1 = vals[max(0, int(0.25 * (n - 1)))]
        q3 = vals[min(n - 1, int(0.75 * (n - 1)))]
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        outliers = sum(1 for v in vals if v < lower or v > upper)
        total_outliers += outliers
        numeric_stats.append({
            "column": c,
            "count": n,
            "missing_imputed": missing_counts.get(c, 0),
            "min": round(min(vals), 2),
            "mean": round(statistics.mean(vals), 2),
            "median": round(statistics.median(vals), 2),
            "max": round(max(vals), 2),
            "stdev": round(statistics.stdev(vals), 2) if n > 1 else 0.0,
            "outliers": outliers,
        })

    column_profiles = [
        {
            "name": c,
            "dtype": "numeric" if c in numeric_cols else "string",
            "missing": missing_counts.get(c, 0),
        }
        for c in col_names
    ]

    steps = [
        f"Loaded {len(rows)} raw rows across HDFS DataNode blocks",
        f"Normalized whitespace & typed {len(numeric_cols)} numeric and {len(text_cols)} text columns",
        f"Imputed {missing_values_imputed} missing fields using column mean/mode",
        f"Deduplicated records ({duplicates_removed} duplicate rows removed)",
        f"IQR anomaly scan flagged {total_outliers} numeric outlier values",
    ]

    return {
        "success": True,
        "engine": f"Python {sys.version.split()[0]} (Data Preprocessing Pipeline)",
        "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
        "filename": filename,
        "category": category,
        "raw_rows": len(rows),
        "cleaned_rows": len(cleaned_rows),
        "duplicates_removed": duplicates_removed,
        "missing_values_imputed": missing_values_imputed,
        "outliers_flagged": total_outliers,
        "columns": column_profiles,
        "numeric_stats": numeric_stats,
        "cleaned_preview": cleaned_rows[:6],
        "steps": steps,
    }


if __name__ == "__main__":
    raw_input = sys.stdin.read()
    payload = json.loads(raw_input) if raw_input.strip() else {}
    print(json.dumps(preprocess_rows(payload)))
