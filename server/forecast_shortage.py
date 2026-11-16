import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(BASE_DIR, "data", "meta", "cluster_manifest.json")
CLUSTER_DIR = os.path.join(BASE_DIR, "data", "cluster")


def load_hdfs_usage_blocks():
    if not os.path.exists(MANIFEST_PATH):
        return [], [], {
            "blocks_read": 0,
            "bytes_scanned": 0,
            "online_nodes": 0,
            "total_nodes": 0,
            "replication_factor": 2,
            "nodes_used": [],
        }

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    online_nodes = {
        n["id"] for n in manifest.get("nodes", []) if n.get("status") == "online"
    }

    water_records = []
    dataset_files = []
    blocks_read = 0
    bytes_scanned = 0
    nodes_used = set()

    for block in manifest.get("blocks", []):
        collection = block.get("collection")
        if collection not in ("water_records", "dataset_files"):
            continue

        block_id = block["blockId"]
        candidates = [block["primaryNode"]] + block.get("replicaNodes", [])
        payload = None

        for node_id in candidates:
            if node_id not in online_nodes:
                continue
            block_file = os.path.join(CLUSTER_DIR, node_id, f"{block_id}.json")
            if os.path.exists(block_file):
                bytes_scanned += os.path.getsize(block_file)
                with open(block_file, "r", encoding="utf-8") as bf:
                    payload = json.load(bf)
                blocks_read += 1
                nodes_used.add(node_id)
                break

        if payload:
            if collection == "water_records":
                water_records.extend(payload.get("records", []))
            elif collection == "dataset_files":
                dataset_files.extend(payload.get("records", []))

    return water_records, dataset_files, {
        "blocks_read": blocks_read,
        "bytes_scanned": bytes_scanned,
        "online_nodes": len(online_nodes),
        "total_nodes": len(manifest.get("nodes", [])),
        "replication_factor": manifest.get("replicationFactor", 2),
        "nodes_used": sorted(nodes_used),
    }


def format_month_label(ym: str) -> str:
    try:
        dt = datetime.strptime(ym + "-01", "%Y-%m-%d")
        return dt.strftime("%b %Y")
    except Exception:
        return ym


def next_month_ym(latest_ym: str) -> str:
    try:
        year, month = map(int, latest_ym.split("-"))
        if month == 12:
            return f"{year + 1:04d}-01"
        return f"{year:04d}-{month + 1:02d}"
    except Exception:
        now = datetime.now(timezone.utc)
        year, month = now.year, now.month
        if month == 12:
            return f"{year + 1:04d}-01"
        return f"{year:04d}-{month + 1:02d}"


def fit_simple_linear_regression(xs, ys):
    n = len(xs)
    if n == 0:
        return {
            "slope": 0.0,
            "intercept": 0.0,
            "r2": 0.0,
            "rmse": 0.0,
            "fitted": [],
            "predict_next": 0.0,
        }
    if n == 1:
        val = float(ys[0])
        return {
            "slope": 0.0,
            "intercept": round(val, 2),
            "r2": 1.0,
            "rmse": 0.0,
            "fitted": [round(val, 2)],
            "predict_next": round(max(0.0, val), 2),
        }

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    ss_xx = sum((x - mean_x) ** 2 for x in xs)
    ss_xy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))

    slope = (ss_xy / ss_xx) if ss_xx > 0 else 0.0
    intercept = mean_y - slope * mean_x

    fitted = [slope * x + intercept for x in xs]
    ss_res = sum((y - yhat) ** 2 for y, yhat in zip(ys, fitted))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)

    r2 = (1.0 - (ss_res / ss_tot)) if ss_tot > 0 else 1.0
    r2 = max(0.0, min(1.0, r2))
    rmse = math.sqrt(ss_res / max(n - 2, 1)) if n > 2 else math.sqrt(ss_res / n)

    next_x = xs[-1] + 1.0
    predict_next = max(0.0, slope * next_x + intercept)

    return {
        "slope": round(slope, 2),
        "intercept": round(intercept, 2),
        "r2": round(r2, 4),
        "rmse": round(rmse, 2),
        "fitted": [round(max(0.0, v), 2) for v in fitted],
        "predict_next": round(predict_next, 2),
    }


def classify_risk(coverage_pct: float, shortage_lpd: float, gap_slope: float) -> str:
    if shortage_lpd <= 0 and coverage_pct >= 98.0 and gap_slope <= 0:
        return "Surplus / Safe"
    if coverage_pct < 60.0 or shortage_lpd >= 1_000_000:
        return "Critical Shortage"
    if shortage_lpd > 0 and coverage_pct < 90.0:
        return "Moderate Deficit"
    if shortage_lpd > 0 or gap_slope > 20_000:
        return "Watch"
    return "Surplus / Safe"


def build_monthly_series(water_records, dataset_files):
    # 1. Historical monthly logs stored in HDFS dataset_files ('Water consumption data')
    monthly_by_district = {}
    all_months = set()

    for row in dataset_files:
        if row.get("category") != "Water consumption data":
            continue
        district = str(row.get("district") or "").strip()
        obs_date = str(row.get("observation_date") or "").strip()
        if not district or len(obs_date) < 7:
            continue
        ym = obs_date[:7]
        demand = float(row.get("water_demand_lpd") or row.get("metric_primary") or 0)
        supply = float(row.get("water_supply_lpd") or row.get("metric_secondary") or 0)
        consumed = float(
            row.get("water_consumed_lpd")
            if row.get("water_consumed_lpd") is not None
            else supply * 0.93
        )
        all_months.add(ym)
        bucket = monthly_by_district.setdefault(district, {}).setdefault(
            ym, {"demand": 0.0, "supply": 0.0, "consumed": 0.0, "records": 0}
        )
        bucket["demand"] += demand
        bucket["supply"] += supply
        bucket["consumed"] += consumed
        bucket["records"] += 1

    # 2. Live current-month grid snapshot from HDFS water_records blocks
    latest_area = {}
    latest_ym = None
    for r in water_records:
        district = str(r.get("district") or "").strip()
        area = str(r.get("area") or district).strip()
        if not district:
            continue
        rec_date = str(r.get("recorded_at") or r.get("uploaded_at") or "")
        ym = rec_date[:7] if len(rec_date) >= 7 else datetime.now(timezone.utc).strftime("%Y-%m")
        if latest_ym is None or ym > latest_ym:
            latest_ym = ym
        key = f"{district.lower()}::{area.lower()}"
        prev = latest_area.get(key)
        if not prev or int(r.get("id") or 0) > int(prev.get("id") or 0):
            latest_area[key] = r

    if latest_ym is None:
        latest_ym = datetime.now(timezone.utc).strftime("%Y-%m")

    all_months.add(latest_ym)
    current_totals = {}
    for r in latest_area.values():
        district = str(r.get("district") or "").strip()
        demand = float(r.get("water_demand") or 0)
        supply = float(r.get("water_supply") or 0)
        consumed = float(
            r.get("water_consumed")
            if r.get("water_consumed") is not None
            else supply * 0.92
        )
        cur = current_totals.setdefault(
            district, {"demand": 0.0, "supply": 0.0, "consumed": 0.0, "records": 0}
        )
        cur["demand"] += demand
        cur["supply"] += supply
        cur["consumed"] += consumed
        cur["records"] += 1

    for district, totals in current_totals.items():
        monthly_by_district.setdefault(district, {})[latest_ym] = totals

    ordered_months = sorted(all_months)
    return ordered_months, monthly_by_district


def analyze_district(district_name: str, ordered_months, dist_map):
    xs = []
    demands = []
    supplies = []
    consumed_list = []
    months_used = []

    for idx, ym in enumerate(ordered_months):
        point = dist_map.get(ym)
        if not point:
            continue
        xs.append(float(idx))
        demands.append(float(point["demand"]))
        supplies.append(float(point["supply"]))
        consumed_list.append(float(point["consumed"]))
        months_used.append(ym)

    if not xs:
        return None

    # Re-index xs sequentially from 0..k-1 for clean OLS intercept/slope interpretation
    seq_x = [float(i) for i in range(len(xs))]
    demand_reg = fit_simple_linear_regression(seq_x, demands)
    supply_reg = fit_simple_linear_regression(seq_x, supplies)
    consumed_reg = fit_simple_linear_regression(seq_x, consumed_list)

    pred_demand = round(demand_reg["predict_next"])
    pred_supply = round(supply_reg["predict_next"])
    pred_consumed = round(min(pred_supply, consumed_reg["predict_next"]))
    pred_shortage = max(0, pred_demand - pred_supply)
    pred_monthly_shortage_ml = round((pred_shortage * 30) / 1_000_000, 2)
    pred_coverage = round((pred_supply / pred_demand) * 100, 1) if pred_demand > 0 else 100.0

    cur_demand = round(demands[-1])
    cur_supply = round(supplies[-1])
    cur_shortage = max(0, cur_demand - cur_supply)
    shortage_delta = pred_shortage - cur_shortage
    gap_slope = round(demand_reg["slope"] - supply_reg["slope"], 2)

    risk_level = classify_risk(pred_coverage, pred_shortage, gap_slope)
    if gap_slope > 15_000:
        trend_direction = "Widening Deficit"
    elif gap_slope < -15_000:
        trend_direction = "Improving"
    else:
        trend_direction = "Stable"

    return {
        "district": district_name,
        "observations": len(seq_x),
        "current_demand_lpd": cur_demand,
        "current_supply_lpd": cur_supply,
        "current_shortage_lpd": cur_shortage,
        "predicted_demand_lpd": pred_demand,
        "predicted_supply_lpd": pred_supply,
        "predicted_consumed_lpd": pred_consumed,
        "predicted_shortage_lpd": pred_shortage,
        "predicted_monthly_shortage_ml": pred_monthly_shortage_ml,
        "predicted_coverage_pct": pred_coverage,
        "shortage_delta_lpd": shortage_delta,
        "demand_slope_lpd": demand_reg["slope"],
        "supply_slope_lpd": supply_reg["slope"],
        "gap_slope_lpd": gap_slope,
        "r2_demand": demand_reg["r2"],
        "r2_supply": supply_reg["r2"],
        "rmse_demand_lpd": demand_reg["rmse"],
        "rmse_supply_lpd": supply_reg["rmse"],
        "risk_level": risk_level,
        "trend_direction": trend_direction,
        "_series": {
            "months": months_used,
            "demands": demands,
            "supplies": supplies,
            "consumed": consumed_list,
            "demand_reg": demand_reg,
            "supply_reg": supply_reg,
            "consumed_reg": consumed_reg,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="HDFS Linear Regression Water Shortage Forecast")
    parser.add_argument("--district", default="all", help="District name or 'all'")
    args = parser.parse_args()

    t0 = time.perf_counter()
    water_records, dataset_files, cluster_meta = load_hdfs_usage_blocks()
    ordered_months, monthly_by_district = build_monthly_series(water_records, dataset_files)

    if not ordered_months:
        print(json.dumps({
            "success": False,
            "message": "No historical water usage records available in HDFS blocks",
        }))
        return

    forecast_ym = next_month_ym(ordered_months[-1])
    forecast_label = format_month_label(forecast_ym)

    district_results = []
    for dist_name in sorted(monthly_by_district.keys()):
        res = analyze_district(dist_name, ordered_months, monthly_by_district[dist_name])
        if res:
            district_results.append(res)

    # Sort highest predicted shortage first
    district_results.sort(key=lambda x: (-x["predicted_shortage_lpd"], x["predicted_coverage_pct"]))

    selected_district = (args.district or "all").strip()
    focus_obj = None
    if selected_district.lower() != "all":
        for d in district_results:
            if d["district"].lower() == selected_district.lower():
                focus_obj = d
                break

    # Build time-series curve for either selected district or statewide sum across all districts
    if focus_obj:
        s = focus_obj["_series"]
        hist_months = s["months"]
        hist_demands = s["demands"]
        hist_supplies = s["supplies"]
        hist_consumed = s["consumed"]
        d_reg = s["demand_reg"]
        s_reg = s["supply_reg"]
        c_reg = s["consumed_reg"]
        scope_label = focus_obj["district"]
    else:
        hist_months = ordered_months
        hist_demands = []
        hist_supplies = []
        hist_consumed = []
        for ym in hist_months:
            d_sum = sum(monthly_by_district[dist].get(ym, {}).get("demand", 0.0) for dist in monthly_by_district)
            s_sum = sum(monthly_by_district[dist].get(ym, {}).get("supply", 0.0) for dist in monthly_by_district)
            c_sum = sum(monthly_by_district[dist].get(ym, {}).get("consumed", 0.0) for dist in monthly_by_district)
            hist_demands.append(d_sum)
            hist_supplies.append(s_sum)
            hist_consumed.append(c_sum)
        seq_x = [float(i) for i in range(len(hist_months))]
        d_reg = fit_simple_linear_regression(seq_x, hist_demands)
        s_reg = fit_simple_linear_regression(seq_x, hist_supplies)
        c_reg = fit_simple_linear_regression(seq_x, hist_consumed)
        scope_label = "All Karnataka (31 Districts)"

    timeline = []
    for idx, ym in enumerate(hist_months):
        actual_d = round(hist_demands[idx])
        actual_s = round(hist_supplies[idx])
        actual_c = round(hist_consumed[idx])
        timeline.append({
            "month": ym,
            "label": format_month_label(ym),
            "is_forecast": False,
            "actual_demand_lpd": actual_d,
            "actual_supply_lpd": actual_s,
            "actual_consumed_lpd": actual_c,
            "actual_shortage_lpd": max(0, actual_d - actual_s),
            "regression_demand_lpd": round(d_reg["fitted"][idx]) if idx < len(d_reg["fitted"]) else actual_d,
            "regression_supply_lpd": round(s_reg["fitted"][idx]) if idx < len(s_reg["fitted"]) else actual_s,
        })

    pred_d_scope = round(d_reg["predict_next"])
    pred_s_scope = round(s_reg["predict_next"])
    pred_c_scope = round(min(pred_s_scope, c_reg["predict_next"]))
    pred_shortage_scope = max(0, pred_d_scope - pred_s_scope)

    timeline.append({
        "month": forecast_ym,
        "label": f"{forecast_label} (Forecast)",
        "is_forecast": True,
        "actual_demand_lpd": None,
        "actual_supply_lpd": None,
        "actual_consumed_lpd": None,
        "actual_shortage_lpd": None,
        "regression_demand_lpd": pred_d_scope,
        "regression_supply_lpd": pred_s_scope,
        "predicted_consumed_lpd": pred_c_scope,
        "predicted_shortage_lpd": pred_shortage_scope,
    })

    # Clean internal _series before serializing
    clean_districts = []
    for d in district_results:
        copy_d = {k: v for k, v in d.items() if k != "_series"}
        clean_districts.append(copy_d)

    at_risk_count = sum(
        1 for d in clean_districts if d["risk_level"] in ("Critical Shortage", "Moderate Deficit")
    )
    critical_count = sum(1 for d in clean_districts if d["risk_level"] == "Critical Shortage")
    total_pred_shortage_lpd = sum(d["predicted_shortage_lpd"] for d in clean_districts)
    total_pred_monthly_ml = round((total_pred_shortage_lpd * 30) / 1_000_000, 2)
    total_pred_demand_lpd = sum(d["predicted_demand_lpd"] for d in clean_districts)
    total_pred_supply_lpd = sum(d["predicted_supply_lpd"] for d in clean_districts)
    statewide_coverage_pct = (
        round((total_pred_supply_lpd / total_pred_demand_lpd) * 100, 1)
        if total_pred_demand_lpd > 0
        else 100.0
    )

    result = {
        "success": True,
        "engine": f"Python {sys.version.split()[0]} (Simple Linear Regression · OLS)",
        "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "forecast_month": forecast_ym,
        "forecast_label": forecast_label,
        "scope": scope_label,
        "selected_district": selected_district,
        "hdfs_metadata": {
            **cluster_meta,
            "history_months": len(hist_months),
            "window_start": format_month_label(hist_months[0]),
            "window_end": format_month_label(hist_months[-1]),
            "water_records_scanned": len(water_records),
            "usage_history_rows_scanned": sum(
                1 for r in dataset_files if r.get("category") == "Water consumption data"
            ),
        },
        "summary": {
            "total_districts": len(clean_districts),
            "at_risk_districts": at_risk_count,
            "critical_districts": critical_count,
            "total_predicted_shortage_lpd": total_pred_shortage_lpd,
            "total_predicted_monthly_shortage_ml": total_pred_monthly_ml,
            "total_predicted_demand_lpd": total_pred_demand_lpd,
            "total_predicted_supply_lpd": total_pred_supply_lpd,
            "predicted_coverage_pct": statewide_coverage_pct,
        },
        "model": {
            "algorithm": "Ordinary Least Squares (y = m*x + b)",
            "scope": scope_label,
            "demand_slope_lpd": d_reg["slope"],
            "demand_intercept_lpd": d_reg["intercept"],
            "demand_r2": d_reg["r2"],
            "demand_rmse_lpd": d_reg["rmse"],
            "supply_slope_lpd": s_reg["slope"],
            "supply_intercept_lpd": s_reg["intercept"],
            "supply_r2": s_reg["r2"],
            "supply_rmse_lpd": s_reg["rmse"],
            "predicted_demand_lpd": pred_d_scope,
            "predicted_supply_lpd": pred_s_scope,
            "predicted_consumed_lpd": pred_c_scope,
            "predicted_shortage_lpd": pred_shortage_scope,
            "predicted_monthly_shortage_ml": round((pred_shortage_scope * 30) / 1_000_000, 2),
        },
        "timeline": timeline,
        "districts": clean_districts,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
