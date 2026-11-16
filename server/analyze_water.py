import json
import os
import statistics
import sys
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(BASE_DIR, "data", "meta", "cluster_manifest.json")
CLUSTER_DIR = os.path.join(BASE_DIR, "data", "cluster")


def load_hdfs_blocks():
    if not os.path.exists(MANIFEST_PATH):
        return [], [], {}

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    online_nodes = {
        n["id"] for n in manifest.get("nodes", []) if n.get("status") == "online"
    }

    water_records = []
    reservoirs = []
    blocks_read = 0

    for block in manifest.get("blocks", []):
        block_id = block["blockId"]
        collection = block["collection"]
        candidates = [block["primaryNode"]] + block.get("replicaNodes", [])
        payload = None

        for node_id in candidates:
            if node_id not in online_nodes:
                continue
            block_file = os.path.join(CLUSTER_DIR, node_id, f"{block_id}.json")
            if os.path.exists(block_file):
                with open(block_file, "r", encoding="utf-8") as bf:
                    payload = json.load(bf)
                blocks_read += 1
                break

        if payload:
            if collection == "water_records":
                water_records.extend(payload.get("records", []))
            elif collection == "reservoirs":
                reservoirs.extend(payload.get("records", []))

    return water_records, reservoirs, {
        "blocks_read": blocks_read,
        "online_nodes": len(online_nodes),
        "total_nodes": len(manifest.get("nodes", [])),
        "replication_factor": manifest.get("replicationFactor", 2),
    }


def main():
    t0 = time.perf_counter()
    water_records, reservoirs, cluster_meta = load_hdfs_blocks()

    demands = [float(r.get("water_demand") or 0) for r in water_records]
    supplies = [float(r.get("water_supply") or 0) for r in water_records]
    consumed = [
        float(r["water_consumed"])
        for r in water_records
        if r.get("water_consumed") is not None
    ]
    shortages = [
        max(float(r.get("water_demand") or 0) - float(r.get("water_supply") or 0), 0.0)
        for r in water_records
    ]

    critical_alerts = []
    for r in water_records:
        d = float(r.get("water_demand") or 0)
        s = float(r.get("water_supply") or 0)
        if d > 0 and (s / d) < 0.75:
            critical_alerts.append({
                "district": r.get("district"),
                "area": r.get("area"),
                "coverage_pct": round((s / d) * 100, 1),
                "deficit_litres": round(d - s),
            })

    critical_alerts.sort(key=lambda x: x["coverage_pct"])

    res_fills = [float(r.get("percentage_full") or 0) for r in reservoirs]

    # Area-wise Python data processing (deduplicated latest snapshot per area + consumption share & severity)
    latest_by_area = {}
    for r in water_records:
        district = str(r.get("district") or "Unknown").strip()
        area = str(r.get("area") or district).strip()
        key = f"{district.lower()}::{area.lower()}"
        prev = latest_by_area.get(key)
        if not prev or int(r.get("id") or 0) > int(prev.get("id") or 0):
            latest_by_area[key] = r

    area_rows = list(latest_by_area.values())
    total_area_consumed = sum(
        float(r.get("water_consumed") if r.get("water_consumed") is not None else float(r.get("water_supply") or 0) * 0.92)
        for r in area_rows
    )
    area_shortages = [
        max(float(r.get("water_demand") or 0) - float(r.get("water_supply") or 0), 0.0)
        for r in area_rows
    ]
    mean_area_shortage = statistics.mean(area_shortages) if area_shortages else 0.0
    stdev_area_shortage = statistics.stdev(area_shortages) if len(area_shortages) > 1 else 0.0
    outlier_threshold = mean_area_shortage + stdev_area_shortage

    area_rankings = []
    outlier_areas = []
    for r in area_rows:
        d = float(r.get("water_demand") or 0)
        s = float(r.get("water_supply") or 0)
        c = float(r.get("water_consumed") if r.get("water_consumed") is not None else s * 0.92)
        shortage_val = max(d - s, 0.0)
        coverage_pct = round((s / d) * 100, 1) if d > 0 else 100.0
        share_pct = round((c / total_area_consumed) * 100, 1) if total_area_consumed > 0 else 0.0
        severity_index = round(max(0.0, (100.0 - coverage_pct) * (1.0 + shortage_val / 1000000.0)), 1)
        status = "Sufficient" if coverage_pct >= 90 else ("Moderate" if coverage_pct >= 60 else "Shortage")
        entry = {
            "district": str(r.get("district") or ""),
            "area": str(r.get("area") or ""),
            "water_demand_l": round(d),
            "water_supply_l": round(s),
            "water_consumed_l": round(c),
            "shortage_l": round(shortage_val),
            "coverage_pct": coverage_pct,
            "consumption_share_pct": share_pct,
            "severity_index": severity_index,
            "status": status,
        }
        area_rankings.append(entry)
        if shortage_val > outlier_threshold and shortage_val > 0:
            outlier_areas.append(f"{entry['area']} ({entry['district']})")

    area_rankings.sort(key=lambda x: (-x["shortage_l"], -x["water_consumed_l"]))

    # Reservoir Python statistical & trend analysis
    res_by_name = {}
    for r in reservoirs:
        name = str(r.get("reservoir_name") or "").strip()
        if not name:
            continue
        res_by_name.setdefault(name, []).append(r)

    reservoir_stats = []
    low_level_alerts = []
    latest_fills = []
    total_capacity_tmc = 0.0
    available_water_tmc = 0.0
    total_inflow = 0.0
    total_outflow = 0.0

    for name, obs in res_by_name.items():
        obs_sorted = sorted(
            obs,
            key=lambda x: (str(x.get("monitoring_date") or ""), int(x.get("id") or 0)),
        )
        earliest = obs_sorted[0]
        latest = obs_sorted[-1]
        pcts = [float(o.get("percentage_full") or 0) for o in obs_sorted]
        curr_pct = float(latest.get("percentage_full") or 0)
        cap_tmc = float(latest.get("gross_capacity") or latest.get("design_capacity") or 0)
        avail_tmc = float(latest.get("live_capacity") or 0)
        inflow_val = float(latest.get("inflow") or 0)
        outflow_val = float(latest.get("outflow") or 0)
        trend_delta = round(curr_pct - float(earliest.get("percentage_full") or 0), 1)

        latest_fills.append(curr_pct)
        total_capacity_tmc += cap_tmc
        available_water_tmc += avail_tmc
        total_inflow += inflow_val
        total_outflow += outflow_val

        reservoir_stats.append({
            "reservoir_name": name,
            "district": str(latest.get("district") or ""),
            "river": str(latest.get("river") or ""),
            "capacity_tmc": round(cap_tmc, 2),
            "available_tmc": round(avail_tmc, 2),
            "current_fill_pct": round(curr_pct, 1),
            "avg_fill_pct": round(statistics.mean(pcts), 1) if pcts else 0.0,
            "min_fill_pct": round(min(pcts), 1) if pcts else 0.0,
            "max_fill_pct": round(max(pcts), 1) if pcts else 0.0,
            "trend_delta_pct": trend_delta,
            "net_inflow_cusecs": round(inflow_val - outflow_val),
            "observations": len(obs_sorted),
        })

        if curr_pct < 55.0:
            low_level_alerts.append({
                "reservoir_name": name,
                "district": str(latest.get("district") or ""),
                "percentage_full": round(curr_pct, 1),
                "available_tmc": round(avail_tmc, 2),
                "capacity_tmc": round(cap_tmc, 2),
                "net_inflow_cusecs": round(inflow_val - outflow_val),
                "severity": "Critical" if curr_pct < 40.0 else "Low",
            })

    reservoir_stats.sort(key=lambda x: x["current_fill_pct"])
    low_level_alerts.sort(key=lambda x: x["percentage_full"])

    result = {
        "success": True,
        "engine": f"Python {sys.version.split()[0]} (statistics)",
        "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
        "cluster_meta": cluster_meta,
        "records_analyzed": len(water_records),
        "reservoirs_analyzed": len(reservoirs),
        "mean_demand_l": round(statistics.mean(demands), 2) if demands else 0,
        "mean_supply_l": round(statistics.mean(supplies), 2) if supplies else 0,
        "mean_consumed_l": round(statistics.mean(consumed), 2) if consumed else 0,
        "median_shortage_l": round(statistics.median(shortages), 2) if shortages else 0,
        "stdev_shortage_l": (
            round(statistics.stdev(shortages), 2) if len(shortages) > 1 else 0
        ),
        "avg_reservoir_fill_pct": (
            round(statistics.mean(res_fills), 1) if res_fills else 0
        ),
        "critical_deficit_count": len(critical_alerts),
        "top_alerts": critical_alerts[:5],
        "area_processing": {
            "unique_areas": len(area_rankings),
            "shortage_areas_count": sum(1 for a in area_rankings if a["shortage_l"] > 0),
            "total_consumption_l": round(total_area_consumed),
            "mean_area_shortage_l": round(mean_area_shortage, 2),
            "outlier_threshold_l": round(outlier_threshold, 2),
            "outlier_areas": outlier_areas,
            "rankings": area_rankings,
        },
        "reservoir_analysis": {
            "unique_reservoirs": len(reservoir_stats),
            "historical_observations": len(reservoirs),
            "total_capacity_tmc": round(total_capacity_tmc, 2),
            "available_water_tmc": round(available_water_tmc, 2),
            "total_inflow_cusecs": round(total_inflow),
            "total_outflow_cusecs": round(total_outflow),
            "net_inflow_cusecs": round(total_inflow - total_outflow),
            "mean_fill_pct": round(statistics.mean(latest_fills), 1) if latest_fills else 0.0,
            "median_fill_pct": round(statistics.median(latest_fills), 1) if latest_fills else 0.0,
            "stdev_fill_pct": round(statistics.stdev(latest_fills), 2) if len(latest_fills) > 1 else 0.0,
            "low_level_count": len(low_level_alerts),
            "low_level_alerts": low_level_alerts,
            "reservoir_stats": reservoir_stats,
        },
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
