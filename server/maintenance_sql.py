import json
import os
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "meta", "aqua_maintenance.db")
MAINTENANCE_JSON = os.path.join(BASE_DIR, "data", "meta", "maintenance_tasks.json")


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS water_maintenance_tasks (
            id INTEGER PRIMARY KEY,
            task_code TEXT NOT NULL,
            district TEXT NOT NULL,
            area TEXT NOT NULL,
            asset_name TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            maintenance_type TEXT NOT NULL,
            priority TEXT NOT NULL,
            status TEXT NOT NULL,
            assigned_crew TEXT,
            scheduled_date TEXT NOT NULL,
            completed_at TEXT,
            estimated_cost_inr REAL NOT NULL,
            water_saved_lpd REAL NOT NULL,
            telemetry_source TEXT NOT NULL,
            notes TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    return conn


def sync_from_json():
    if not os.path.exists(MAINTENANCE_JSON):
        return 0
    with open(MAINTENANCE_JSON, "r", encoding="utf-8") as f:
        items = json.load(f)

    conn = get_conn()
    try:
        conn.execute("DELETE FROM water_maintenance_tasks")
        for t in items:
            conn.execute(
                """
                INSERT INTO water_maintenance_tasks (
                    id, task_code, district, area, asset_name, asset_type,
                    maintenance_type, priority, status, assigned_crew,
                    scheduled_date, completed_at, estimated_cost_inr,
                    water_saved_lpd, telemetry_source, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(t.get("id") or 0),
                    str(t.get("task_code") or f"MNT-{t.get('id')}"),
                    str(t.get("district") or ""),
                    str(t.get("area") or ""),
                    str(t.get("asset_name") or ""),
                    str(t.get("asset_type") or "Pipeline / Main"),
                    str(t.get("maintenance_type") or "Pipeline Leak Repair"),
                    str(t.get("priority") or "Medium"),
                    str(t.get("status") or "Scheduled"),
                    str(t.get("assigned_crew") or "Unassigned"),
                    str(t.get("scheduled_date") or ""),
                    str(t.get("completed_at") or ""),
                    float(t.get("estimated_cost_inr") or 0),
                    float(t.get("water_saved_lpd") or 0),
                    str(t.get("telemetry_source") or "Field Inspection"),
                    str(t.get("notes") or ""),
                    str(t.get("created_at") or ""),
                ),
            )
        conn.commit()
        return len(items)
    finally:
        conn.close()


def summary():
    synced = sync_from_json()
    conn = get_conn()
    try:
        cur = conn.cursor()
        total = cur.execute("SELECT COUNT(*) FROM water_maintenance_tasks").fetchone()[0]
        by_status = {
            row["status"]: row["cnt"]
            for row in cur.execute(
                "SELECT status, COUNT(*) AS cnt FROM water_maintenance_tasks GROUP BY status"
            ).fetchall()
        }
        by_category = [
            dict(row)
            for row in cur.execute(
                """
                SELECT maintenance_type,
                       COUNT(*) AS task_count,
                       SUM(water_saved_lpd) AS total_water_saved_lpd,
                       SUM(estimated_cost_inr) AS total_cost_inr
                FROM water_maintenance_tasks
                GROUP BY maintenance_type
                ORDER BY total_water_saved_lpd DESC
                """
            ).fetchall()
        ]
        by_crew = [
            dict(row)
            for row in cur.execute(
                """
                SELECT assigned_crew,
                       COUNT(*) AS assigned_count,
                       SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed_count,
                       SUM(CASE WHEN priority IN ('Critical', 'High') AND status != 'Completed' THEN 1 ELSE 0 END) AS urgent_open
                FROM water_maintenance_tasks
                GROUP BY assigned_crew
                ORDER BY urgent_open DESC, assigned_count DESC
                """
            ).fetchall()
        ]
        totals_row = cur.execute(
            """
            SELECT COALESCE(SUM(estimated_cost_inr), 0) AS total_budget_inr,
                   COALESCE(SUM(water_saved_lpd), 0) AS total_water_saved_lpd,
                   COALESCE(SUM(CASE WHEN status != 'Completed' AND priority = 'Critical' THEN 1 ELSE 0 END), 0) AS open_critical
            FROM water_maintenance_tasks
            """
        ).fetchone()

        print(
            json.dumps(
                {
                    "success": True,
                    "engine": f"Python {sqlite3.sqlite_version} + SQLite (Table: water_maintenance_tasks)",
                    "db_path": "data/meta/aqua_maintenance.db",
                    "synced_rows": synced,
                    "total_tasks": total,
                    "open_critical": totals_row["open_critical"],
                    "total_budget_inr": round(totals_row["total_budget_inr"]),
                    "total_water_saved_lpd": round(totals_row["total_water_saved_lpd"]),
                    "status_breakdown": by_status,
                    "category_breakdown": by_category,
                    "crew_workload": by_crew,
                }
            )
        )
    finally:
        conn.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "summary"
    if cmd == "sync":
        count = sync_from_json()
        print(json.dumps({"success": True, "synced_rows": count}))
    else:
        summary()
