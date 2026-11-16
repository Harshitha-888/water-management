import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "meta", "aqua_transport.db")
DELIVERIES_JSON = os.path.join(BASE_DIR, "data", "meta", "transport_deliveries.json")


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vehicles (
            tanker_id TEXT PRIMARY KEY,
            vehicle_reg TEXT NOT NULL,
            driver_name TEXT NOT NULL,
            driver_phone TEXT,
            capacity_l REAL NOT NULL,
            home_depot TEXT,
            status TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tanker_deliveries (
            id INTEGER PRIMARY KEY,
            tanker_id TEXT NOT NULL,
            starting_location TEXT NOT NULL,
            destination_area TEXT NOT NULL,
            district TEXT NOT NULL,
            water_quantity_l REAL NOT NULL,
            delivery_status TEXT NOT NULL,
            estimated_minutes REAL NOT NULL,
            dispatched_at TEXT NOT NULL,
            delivered_at TEXT,
            current_lat REAL,
            current_lon REAL,
            distance_km REAL,
            emergency_request_id INTEGER
        )
        """
    )
    return conn


def sync_from_json():
    if not os.path.exists(DELIVERIES_JSON):
        return 0, 0
    with open(DELIVERIES_JSON, "r", encoding="utf-8") as f:
        items = json.load(f)

    conn = get_conn()
    try:
        conn.execute("DELETE FROM tanker_deliveries")
        conn.execute("DELETE FROM vehicles")
        seen_vehicles = {}

        for r in items:
            tid = str(r.get("tanker_id") or "")
            if tid:
                seen_vehicles[tid] = {
                    "tanker_id": tid,
                    "vehicle_reg": str(r.get("vehicle_reg") or "KA-01-G-0000"),
                    "driver_name": str(r.get("driver_name") or "Assigned Driver"),
                    "driver_phone": str(r.get("driver_phone") or ""),
                    "capacity_l": max(float(r.get("water_quantity_l") or 20000), 20000.0),
                    "home_depot": str(r.get("starting_location") or ""),
                    "status": "Active" if r.get("delivery_status") != "Delivered" else "Standby",
                }

            conn.execute(
                """
                INSERT INTO tanker_deliveries (
                    id, tanker_id, starting_location, destination_area, district,
                    water_quantity_l, delivery_status, estimated_minutes,
                    dispatched_at, delivered_at, current_lat, current_lon,
                    distance_km, emergency_request_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(r.get("id") or 0),
                    tid,
                    str(r.get("starting_location") or ""),
                    str(r.get("destination_area") or ""),
                    str(r.get("district") or ""),
                    float(r.get("water_quantity_l") or 0),
                    str(r.get("delivery_status") or "Dispatched"),
                    float(r.get("estimated_minutes") or 0),
                    str(r.get("dispatched_at") or ""),
                    r.get("delivered_at"),
                    float(r.get("current_lat") or 0),
                    float(r.get("current_lon") or 0),
                    float(r.get("distance_km") or 0),
                    r.get("emergency_request_id"),
                ),
            )

        for v in seen_vehicles.values():
            conn.execute(
                """
                INSERT INTO vehicles (
                    tanker_id, vehicle_reg, driver_name, driver_phone,
                    capacity_l, home_depot, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    v["tanker_id"],
                    v["vehicle_reg"],
                    v["driver_name"],
                    v["driver_phone"],
                    v["capacity_l"],
                    v["home_depot"],
                    v["status"],
                ),
            )

        conn.commit()
        return len(items), len(seen_vehicles)
    finally:
        conn.close()


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def process_tracking():
    t0 = time.perf_counter()
    deliveries_synced, vehicles_synced = sync_from_json()

    items = []
    if os.path.exists(DELIVERIES_JSON):
        with open(DELIVERIES_JSON, "r", encoding="utf-8") as f:
            items = json.load(f)

    now = datetime.now(timezone.utc)
    processed_vehicles = []
    total_delivered_l = 0.0
    total_in_transit_l = 0.0
    eta_samples = []

    for r in items:
        status = str(r.get("delivery_status") or "Dispatched")
        qty = float(r.get("water_quantity_l") or 0)
        est_min = float(r.get("estimated_minutes") or 0)
        dist_km = float(r.get("distance_km") or 0)
        if dist_km <= 0:
            dist_km = haversine_km(
                float(r.get("source_lat") or 12.97),
                float(r.get("source_lon") or 77.59),
                float(r.get("dest_lat") or 12.97),
                float(r.get("dest_lon") or 77.59),
            )

        progress_pct = 100.0 if status == "Delivered" else 0.0
        remaining_min = 0.0 if status == "Delivered" else est_min

        if status in ("In Transit", "Dispatched"):
            total_in_transit_l += qty
            eta_samples.append(est_min)
            try:
                disp = datetime.fromisoformat(str(r.get("dispatched_at")).replace("Z", "+00:00"))
                elapsed_min = max((now - disp).total_seconds() / 60.0, 0.0)
                if est_min > 0:
                    ratio = min(max(elapsed_min / est_min, 0.12), 0.92)
                    progress_pct = round(ratio * 100.0, 1)
                    remaining_min = round(max(est_min * (1.0 - ratio), 5.0), 1)
            except Exception:
                progress_pct = 45.0
                remaining_min = round(est_min * 0.55, 1)
        elif status == "Delivered":
            total_delivered_l += qty
            eta_samples.append(est_min)
        else:
            eta_samples.append(est_min)

        avg_speed_kmh = round((dist_km / (est_min / 60.0)), 1) if est_min > 0 else 42.0

        processed_vehicles.append({
            "id": int(r.get("id") or 0),
            "tanker_id": str(r.get("tanker_id") or ""),
            "driver_name": str(r.get("driver_name") or ""),
            "destination_area": str(r.get("destination_area") or ""),
            "delivery_status": status,
            "water_quantity_l": round(qty),
            "distance_km": round(dist_km, 1),
            "progress_pct": progress_pct,
            "remaining_eta_min": remaining_min,
            "avg_speed_kmh": avg_speed_kmh,
        })

    conn = get_conn()
    try:
        cur = conn.cursor()
        sql_deliveries = cur.execute("SELECT COUNT(*) FROM tanker_deliveries").fetchone()[0]
        sql_vehicles = cur.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0]
        status_breakdown = {
            row["delivery_status"]: row["cnt"]
            for row in cur.execute(
                "SELECT delivery_status, COUNT(*) AS cnt FROM tanker_deliveries GROUP BY delivery_status"
            ).fetchall()
        }
    finally:
        conn.close()

    avg_eta = round(sum(eta_samples) / len(eta_samples), 1) if eta_samples else 0.0

    print(
        json.dumps(
            {
                "success": True,
                "engine": f"Python {sys.version.split()[0]} + SQLite {sqlite3.sqlite_version}",
                "duration_ms": round((time.perf_counter() - t0) * 1000, 2),
                "db_path": "data/meta/aqua_transport.db",
                "sql_tables": {
                    "vehicles": sql_vehicles,
                    "tanker_deliveries": sql_deliveries,
                    "status_breakdown": status_breakdown,
                },
                "deliveries_synced": deliveries_synced,
                "vehicles_synced": vehicles_synced,
                "total_delivered_l": round(total_delivered_l),
                "total_in_transit_l": round(total_in_transit_l),
                "avg_estimated_minutes": avg_eta,
                "processed_telemetry": processed_vehicles,
            }
        )
    )


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "process"
    if cmd == "sync":
        d_cnt, v_cnt = sync_from_json()
        print(json.dumps({"success": True, "deliveries_synced": d_cnt, "vehicles_synced": v_cnt}))
    else:
        process_tracking()
