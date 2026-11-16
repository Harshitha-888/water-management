import json
import os
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(BASE_DIR, "data", "meta", "aqua_emergency.db")
EMERGENCY_JSON = os.path.join(BASE_DIR, "data", "meta", "emergency_requests.json")


def get_conn():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS emergency_requests (
            id INTEGER PRIMARY KEY,
            district TEXT NOT NULL,
            area TEXT NOT NULL,
            emergency_type TEXT NOT NULL,
            description TEXT NOT NULL,
            requester_name TEXT,
            contact TEXT,
            required_quantity REAL NOT NULL,
            priority TEXT NOT NULL,
            source_location TEXT,
            destination_location TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            tanker_id TEXT
        )
        """
    )
    return conn


def sync_from_json():
    if not os.path.exists(EMERGENCY_JSON):
        return 0
    with open(EMERGENCY_JSON, "r", encoding="utf-8") as f:
        items = json.load(f)

    conn = get_conn()
    try:
        conn.execute("DELETE FROM emergency_requests")
        for r in items:
            conn.execute(
                """
                INSERT INTO emergency_requests (
                    id, district, area, emergency_type, description,
                    requester_name, contact, required_quantity, priority,
                    source_location, destination_location, status,
                    created_at, updated_at, tanker_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    int(r.get("id") or 0),
                    str(r.get("district") or ""),
                    str(r.get("area") or ""),
                    str(r.get("emergency_type") or "No Water Supply"),
                    str(r.get("description") or ""),
                    str(r.get("requester_name") or ""),
                    str(r.get("contact") or ""),
                    float(r.get("required_quantity") or 0),
                    str(r.get("priority") or "Medium"),
                    str(r.get("source_location") or ""),
                    str(r.get("destination_location") or ""),
                    str(r.get("status") or "Pending"),
                    str(r.get("created_at") or ""),
                    str(r.get("updated_at") or ""),
                    str(r.get("tanker_id") or ""),
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
        total = cur.execute("SELECT COUNT(*) FROM emergency_requests").fetchone()[0]
        by_status = {
            row["status"]: row["cnt"]
            for row in cur.execute(
                "SELECT status, COUNT(*) AS cnt FROM emergency_requests GROUP BY status"
            ).fetchall()
        }
        recent = [
            dict(row)
            for row in cur.execute(
                """
                SELECT id, district, area, emergency_type, priority, status,
                       required_quantity, created_at
                FROM emergency_requests
                ORDER BY id DESC
                LIMIT 10
                """
            ).fetchall()
        ]
        print(
            json.dumps(
                {
                    "success": True,
                    "engine": f"SQLite {sqlite3.sqlite_version} (Relational SQL Table: emergency_requests)",
                    "db_path": "data/meta/aqua_emergency.db",
                    "synced_rows": synced,
                    "total_rows": total,
                    "status_breakdown": by_status,
                    "recent_rows": recent,
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
