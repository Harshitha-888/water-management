"""
AquaAI Python 3 MapReduce Worker (Hadoop Streaming Engine)
Reads HDFS block splits from stdin, runs per-split mapper(),
performs hash partitioning + sorted shuffle, and executes reducer()
across each partition.
"""

import json
import math
import sys
import time
from collections import defaultdict


def fnv1a_hash(key: str, mod: int) -> int:
    h = 2166136261
    for ch in key:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h % mod


# ---------------------------------------------------------------------------
# MAPPER IMPLEMENTATIONS
# ---------------------------------------------------------------------------

def run_mapper_for_record(job_type: str, rec: dict, params: dict, emit):
    district_filter = (params.get("district") or "").strip().lower()
    search_filter = (params.get("search") or "").strip().lower()
    quality_filter = (params.get("quality") or "").strip().lower()
    min_shortage = float(params.get("minShortage") or 0)

    if job_type == "district_water_balance":
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        if dist:
            emit(dist, rec)

    elif job_type == "area_consumption_rollup":
        dist = str(rec.get("district") or "").strip()
        area = str(rec.get("area") or dist).strip()
        if district_filter and dist.lower() != district_filter:
            return
        if search_filter:
            hay = f"{dist} {area} {rec.get('water_quality', '')}".lower()
            if search_filter not in hay:
                return
        emit(f"{area}::{dist}", rec)

    elif job_type == "shortage_hotspots":
        demand = float(rec.get("water_demand") or 0)
        supply = float(rec.get("water_supply") or 0)
        shortage = max(demand - supply, 0.0)
        if shortage < min_shortage:
            return
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        coverage = round((supply / demand) * 100, 1) if demand > 0 else 100.0
        if shortage <= 0:
            tier = "Sufficient"
        elif coverage < 60:
            tier = "Critical Deficit"
        elif coverage < 80:
            tier = "High Deficit"
        else:
            tier = "Moderate Deficit"
        enriched = dict(rec)
        enriched["shortage"] = shortage
        enriched["coveragePct"] = coverage
        emit(tier, enriched)

    elif job_type == "usage_period_rollup":
        cutoff_ts = float(params.get("cutoffTsMs") or 0)
        latest_ts = float(params.get("latestTsMs") or 0)
        rec_ts = float(rec.get("_tsMs") or 0)
        if latest_ts > 0 and rec_ts < cutoff_ts:
            return
        date_bucket = str(rec.get("recorded_at") or rec.get("uploaded_at") or "")[:10]
        emit(date_bucket or "unscheduled", rec)

    elif job_type == "distributed_retrieval":
        demand = float(rec.get("water_demand") or 0)
        supply = float(rec.get("water_supply") or 0)
        shortage = max(demand - supply, 0.0)
        if shortage < min_shortage:
            return
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        qual = str(rec.get("water_quality") or "")
        if quality_filter and quality_filter not in qual.lower():
            return
        if search_filter:
            hay = f"{dist} {rec.get('area', '')} {qual}".lower()
            if search_filter not in hay:
                return
        enriched = dict(rec)
        enriched["shortage"] = shortage
        emit(f"{dist}::{rec.get('area', '')}", enriched)

    elif job_type == "basin_reservoir_summary":
        basin = str(rec.get("basin") or "Unassigned Basin").strip()
        emit(basin, rec)

    elif job_type == "reservoir_level_avg":
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        if search_filter:
            hay = f"{rec.get('reservoir_name', '')} {dist} {rec.get('river', '')} {rec.get('basin', '')}".lower()
            if search_filter not in hay:
                return
        name = str(rec.get("reservoir_name") or "").strip()
        if name:
            emit(name, rec)

    elif job_type == "emergency_area_summary":
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        if search_filter:
            hay = f"{rec.get('area', '')} {dist} {rec.get('emergency_type', '')} {rec.get('description', '')}".lower()
            if search_filter not in hay:
                return
        emit(f"{str(rec.get('area') or '').strip()}::{dist}", rec)

    elif job_type == "transport_delivery_summary":
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        if search_filter:
            hay = f"{rec.get('tanker_id', '')} {rec.get('driver_name', '')} {rec.get('starting_location', '')} {rec.get('destination_area', '')} {dist}".lower()
            if search_filter not in hay:
                return
        emit(f"{str(rec.get('destination_area') or '').strip()}::{dist}", rec)

    elif job_type == "maintenance_priority_summary":
        dist = str(rec.get("district") or "").strip()
        if district_filter and dist.lower() != district_filter:
            return
        if search_filter:
            hay = f"{rec.get('task_code', '')} {rec.get('asset_name', '')} {rec.get('maintenance_type', '')} {rec.get('area', '')} {dist}".lower()
            if search_filter not in hay:
                return
        mtype = str(rec.get("maintenance_type") or "General Maintenance").strip()
        emit(mtype, rec)


# ---------------------------------------------------------------------------
# REDUCER IMPLEMENTATIONS
# ---------------------------------------------------------------------------

def run_reducer_for_key(job_type: str, key: str, values: list):
    if not values:
        return None

    if job_type == "district_water_balance":
        latest_by_area = {}
        for rec in values:
            area_key = str(rec.get("area") or rec.get("district") or "").strip().lower()
            prev = latest_by_area.get(area_key)
            curr_date = str(rec.get("recorded_at") or rec.get("uploaded_at") or "")
            prev_date = str(prev.get("recorded_at") or prev.get("uploaded_at") or "") if prev else ""
            if not prev or curr_date > prev_date or (curr_date == prev_date and int(rec.get("id") or 0) > int(prev.get("id") or 0)):
                latest_by_area[area_key] = rec
        latest = list(latest_by_area.values())
        demand = sum(float(r.get("water_demand") or 0) for r in latest)
        supply = sum(float(r.get("water_supply") or 0) for r in latest)
        shortage = sum(max(float(r.get("water_demand") or 0) - float(r.get("water_supply") or 0), 0.0) for r in latest)
        consumed_vals = [float(r["water_consumed"]) for r in latest if r.get("water_consumed") is not None]
        consumed = round(sum(consumed_vals)) if consumed_vals else None
        coverage = round((supply / demand) * 100, 1) if demand > 0 else 0.0
        status = (
            "No Demand Data" if demand <= 0
            else "Sufficient" if coverage >= 90
            else "Moderate" if coverage >= 60
            else "Shortage"
        )
        return {
            "district": key,
            "areas_count": len(latest),
            "total_records": len(values),
            "total_demand": round(demand),
            "total_supply": round(supply),
            "shortage": round(shortage),
            "total_consumed": consumed,
            "coverage_pct": coverage,
            "status": status,
        }

    elif job_type == "area_consumption_rollup":
        latest = max(
            values,
            key=lambda r: (str(r.get("recorded_at") or r.get("uploaded_at") or ""), int(r.get("id") or 0)),
        )
        total_consumed = sum(
            float(r["water_consumed"]) if r.get("water_consumed") is not None else round(float(r.get("water_supply") or 0) * 0.92)
            for r in values
        )
        latest_consumed = (
            float(latest["water_consumed"]) if latest.get("water_consumed") is not None else round(float(latest.get("water_supply") or 0) * 0.92)
        )
        demand = float(latest.get("water_demand") or 0)
        supply = float(latest.get("water_supply") or 0)
        shortage = max(demand - supply, 0.0)
        coverage = round((supply / demand) * 100, 1) if demand > 0 else 100.0
        status = (
            "No Demand Data" if demand <= 0
            else "Sufficient" if coverage >= 90
            else "Moderate" if coverage >= 60
            else "Shortage"
        )
        return {
            "area": latest.get("area"),
            "district": latest.get("district"),
            "water_consumption_l": round(latest_consumed),
            "cumulative_consumption_l": round(total_consumed),
            "water_demand_l": round(demand),
            "water_supply_l": round(supply),
            "shortage_l": round(shortage),
            "coverage_pct": coverage,
            "observations": len(values),
            "status": status,
        }

    elif job_type == "shortage_hotspots":
        total_shortage = sum(float(r.get("shortage") or 0) for r in values)
        total_demand = sum(float(r.get("water_demand") or 0) for r in values)
        total_supply = sum(float(r.get("water_supply") or 0) for r in values)
        top_areas = sorted(values, key=lambda r: float(r.get("shortage") or 0), reverse=True)[:5]
        return {
            "severity_tier": key,
            "area_count": len(values),
            "total_demand": round(total_demand),
            "total_supply": round(total_supply),
            "total_shortage": round(total_shortage),
            "top_hotspots": [
                {
                    "id": r.get("id"),
                    "district": r.get("district"),
                    "area": r.get("area"),
                    "shortage": round(float(r.get("shortage") or 0)),
                    "coverage_pct": r.get("coveragePct"),
                    "quality": r.get("water_quality"),
                }
                for r in top_areas
            ],
        }

    elif job_type == "usage_period_rollup":
        demand = sum(float(r.get("water_demand") or 0) for r in values)
        supply = sum(float(r.get("water_supply") or 0) for r in values)
        shortage = sum(max(float(r.get("water_demand") or 0) - float(r.get("water_supply") or 0), 0.0) for r in values)
        consumed_vals = [float(r["water_consumed"]) for r in values if r.get("water_consumed") is not None]
        consumed = round(sum(consumed_vals)) if consumed_vals else None
        return {
            "observation_date": key,
            "records_count": len(values),
            "demand_litres": round(demand),
            "supply_litres": round(supply),
            "consumed_litres": consumed,
            "shortage_litres": round(shortage),
            "coverage_pct": round((supply / demand) * 100, 1) if demand > 0 else 0.0,
        }

    elif job_type == "distributed_retrieval":
        latest = max(values, key=lambda r: int(r.get("id") or 0))
        demand = float(latest.get("water_demand") or 0)
        supply = float(latest.get("water_supply") or 0)
        coverage = round((supply / demand) * 100, 1) if demand > 0 else 0.0
        return {
            "id": latest.get("id"),
            "district": latest.get("district"),
            "area": latest.get("area"),
            "water_demand": demand,
            "water_supply": supply,
            "shortage": round(float(latest.get("shortage") or 0)),
            "water_consumed": latest.get("water_consumed"),
            "water_level": latest.get("water_level"),
            "water_quality": latest.get("water_quality"),
            "coverage_pct": coverage,
            "recorded_at": latest.get("recorded_at"),
        }

    elif job_type == "basin_reservoir_summary":
        total_live = sum(float(r.get("live_capacity") or 0) for r in values)
        total_gross = sum(float(r.get("gross_capacity") or 0) for r in values)
        total_inflow = sum(float(r.get("inflow") or 0) for r in values)
        total_outflow = sum(float(r.get("outflow") or 0) for r in values)
        avg_fill = sum(float(r.get("percentage_full") or 0) for r in values) / len(values)
        return {
            "basin": key,
            "reservoir_count": len(values),
            "avg_percentage_full": round(avg_fill, 1),
            "total_live_capacity": round(total_live, 2),
            "total_gross_capacity": round(total_gross, 2),
            "total_inflow_cusecs": round(total_inflow),
            "total_outflow_cusecs": round(total_outflow),
            "net_balance_cusecs": round(total_inflow - total_outflow),
        }

    elif job_type == "reservoir_level_avg":
        sorted_recs = sorted(
            values,
            key=lambda r: (str(r.get("monitoring_date") or ""), int(r.get("id") or 0)),
            reverse=True,
        )
        latest = sorted_recs[0]
        pcts = [float(r.get("percentage_full") or 0) for r in values]
        curr_pct = float(latest.get("percentage_full") or 0)
        alert_status = (
            "Critical Low" if curr_pct < 40 else "Low Level" if curr_pct < 55 else "Normal"
        )
        return {
            "reservoir_name": key,
            "district": latest.get("district"),
            "river": latest.get("river"),
            "basin": latest.get("basin"),
            "observations": len(values),
            "capacity_tmc": round(float(latest.get("gross_capacity") or latest.get("design_capacity") or 0), 2),
            "available_tmc": round(float(latest.get("live_capacity") or 0), 2),
            "current_fill_pct": round(curr_pct, 1),
            "avg_fill_pct": round(sum(pcts) / len(pcts), 1),
            "min_fill_pct": round(min(pcts), 1),
            "max_fill_pct": round(max(pcts), 1),
            "avg_water_level": round(sum(float(r.get("reservoir_level") or 0) for r in values) / len(values), 1),
            "avg_inflow_cusecs": round(sum(float(r.get("inflow") or 0) for r in values) / len(values)),
            "avg_outflow_cusecs": round(sum(float(r.get("outflow") or 0) for r in values) / len(values)),
            "latest_date": latest.get("monitoring_date"),
            "alert_status": alert_status,
        }

    elif job_type == "emergency_area_summary":
        parts = key.split("::", 1)
        area = parts[0]
        district = parts[1] if len(parts) > 1 else ""
        pending_count = sum(1 for r in values if r.get("status") in ("Pending", "Requested"))
        approved_count = sum(1 for r in values if r.get("status") in ("Approved", "Assigned", "In Transit"))
        completed_count = sum(1 for r in values if r.get("status") in ("Completed", "Delivered"))
        total_qty = sum(float(r.get("required_quantity") or 0) for r in values)
        type_counts = defaultdict(int)
        for r in values:
            type_counts[str(r.get("emergency_type") or "No Water Supply")] += 1
        top_type = max(type_counts.items(), key=lambda kv: kv[1])[0]
        rank = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
        highest_priority = max(values, key=lambda r: rank.get(str(r.get("priority") or "Medium"), 0)).get("priority", "Medium")
        latest_ts = max(str(r.get("created_at") or "") for r in values)
        return {
            "area": area,
            "district": district,
            "request_count": len(values),
            "pending_count": pending_count,
            "approved_count": approved_count,
            "completed_count": completed_count,
            "total_required_l": round(total_qty),
            "top_emergency_type": top_type,
            "highest_priority": highest_priority,
            "latest_request_at": latest_ts,
        }

    elif job_type == "transport_delivery_summary":
        parts = key.split("::", 1)
        dest = parts[0]
        district = parts[1] if len(parts) > 1 else ""
        delivered_count = sum(1 for r in values if r.get("delivery_status") == "Delivered")
        active_count = sum(1 for r in values if r.get("delivery_status") in ("In Transit", "Dispatched"))
        total_water = sum(float(r.get("water_quantity_l") or 0) for r in values)
        avg_eta = sum(float(r.get("estimated_minutes") or 0) for r in values) / len(values)
        total_km = sum(float(r.get("distance_km") or 0) for r in values)
        tankers = ", ".join(dict.fromkeys(str(r.get("tanker_id") or "") for r in values if r.get("tanker_id")))
        return {
            "destination_area": dest,
            "district": district,
            "delivery_count": len(values),
            "active_count": active_count,
            "delivered_count": delivered_count,
            "total_water_l": round(total_water),
            "avg_eta_min": round(avg_eta),
            "total_distance_km": round(total_km, 1),
            "tankers_assigned": tankers,
        }

    elif job_type == "maintenance_priority_summary":
        open_count = sum(1 for r in values if r.get("status") != "Completed")
        completed_count = sum(1 for r in values if r.get("status") == "Completed")
        critical_count = sum(1 for r in values if r.get("priority") in ("Critical", "High") and r.get("status") != "Completed")
        total_saved = sum(float(r.get("water_saved_lpd") or 0) for r in values)
        total_cost = sum(float(r.get("estimated_cost_inr") or 0) for r in values)
        districts = ", ".join(dict.fromkeys(str(r.get("district") or "") for r in values if r.get("district")))
        return {
            "maintenance_type": key,
            "total_tasks": len(values),
            "open_tasks": open_count,
            "completed_tasks": completed_count,
            "urgent_open": critical_count,
            "water_saved_lpd": round(total_saved),
            "estimated_cost_inr": round(total_cost),
            "districts_covered": districts,
        }

    return None


def main():
    t_start = time.perf_counter()
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}

    job_type = payload.get("jobType", "district_water_balance")
    num_reducers = max(1, min(8, int(payload.get("numReducers") or 4)))
    params = payload.get("params") or {}
    splits = payload.get("splits") or []

    # PHASE 1: MAPPER (run Python mapper on each HDFS block split)
    map_start = time.perf_counter()
    map_phase = []
    emitted_pairs = []
    records_scanned = 0

    for idx, split in enumerate(splits):
        s_t0 = time.perf_counter()
        if split.get("status") == "unavailable":
            map_phase.append({
                "taskId": f"m_{idx:04d}",
                "blockId": split.get("blockId"),
                "nodeServed": split.get("nodeServed"),
                "usedReplicaFailover": False,
                "inputRecords": int(split.get("inputRecords") or 0),
                "emittedPairs": 0,
                "durationMs": round((time.perf_counter() - s_t0) * 1000, 2),
                "status": "unavailable",
                "error": split.get("error"),
            })
            continue

        split_recs = split.get("records") or []
        split_emits = 0

        def emit_fn(k, v):
            nonlocal split_emits
            emitted_pairs.append((str(k), v))
            split_emits += 1

        for rec in split_recs:
            records_scanned += 1
            run_mapper_for_record(job_type, rec, params, emit_fn)

        map_phase.append({
            "taskId": f"m_{idx:04d}",
            "blockId": split.get("blockId"),
            "nodeServed": split.get("nodeServed"),
            "usedReplicaFailover": bool(split.get("usedReplicaFailover")),
            "inputRecords": len(split_recs),
            "emittedPairs": split_emits,
            "durationMs": round((time.perf_counter() - s_t0) * 1000, 2),
            "status": "completed",
        })

    map_duration_ms = round((time.perf_counter() - map_start) * 1000, 2)

    # PHASE 2: SHUFFLE & SORT
    shuffle_start = time.perf_counter()
    partitions = [defaultdict(list) for _ in range(num_reducers)]
    for k, v in emitted_pairs:
        p_idx = fnv1a_hash(k, num_reducers)
        partitions[p_idx][k].append(v)

    shuffle_phase = []
    for p_idx, bucket in enumerate(partitions):
        sorted_keys = sorted(bucket.keys())
        total_vals = sum(len(bucket[k]) for k in sorted_keys)
        shuffle_phase.append({
            "partitionId": p_idx,
            "keyCount": len(sorted_keys),
            "totalValues": total_vals,
            "sampleKeys": sorted_keys[:5],
        })
    shuffle_duration_ms = round((time.perf_counter() - shuffle_start) * 1000, 2)

    # PHASE 3: REDUCER
    reduce_start = time.perf_counter()
    results = []
    reducer_tasks = []
    node_names = ["node-01", "node-02", "node-03", "node-04"]

    for p_idx, bucket in enumerate(partitions):
        r_t0 = time.perf_counter()
        sorted_keys = sorted(bucket.keys())
        out_count = 0
        total_vals = 0
        for k in sorted_keys:
            vals = bucket[k]
            total_vals += len(vals)
            reduced = run_reducer_for_key(job_type, k, vals)
            if reduced is not None:
                results.append(reduced)
                out_count += 1
        reducer_tasks.append({
            "taskId": f"r_{p_idx:04d}",
            "partitionId": p_idx,
            "nodeAssigned": node_names[p_idx % len(node_names)],
            "keysProcessed": len(sorted_keys),
            "valuesReduced": total_vals,
            "outputRecords": out_count,
            "durationMs": round((time.perf_counter() - r_t0) * 1000, 2),
            "status": "completed",
        })

    reduce_duration_ms = round((time.perf_counter() - reduce_start) * 1000, 2)
    total_duration_ms = round((time.perf_counter() - t_start) * 1000, 2)

    print(json.dumps({
        "success": True,
        "runtime": f"Python {sys.version.split()[0]} (Hadoop Streaming Mapper & Reducer)",
        "recordsScanned": records_scanned,
        "mapEmits": len(emitted_pairs),
        "shuffleKeys": sum(p["keyCount"] for p in shuffle_phase),
        "reduceOutputs": len(results),
        "mapPhase": map_phase,
        "shufflePhase": shuffle_phase,
        "reducerTasks": reducer_tasks,
        "timings": {
            "mapMs": map_duration_ms,
            "shuffleMs": shuffle_duration_ms,
            "reduceMs": reduce_duration_ms,
            "totalPythonMs": total_duration_ms,
        },
        "results": results,
    }))


if __name__ == "__main__":
    main()
