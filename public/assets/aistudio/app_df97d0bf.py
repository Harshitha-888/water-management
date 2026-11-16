from flask import Flask, render_template, jsonify, request, Response
import sqlite3
import os
import io
import csv
import json
import time
import requests
import pandas as pd

from datetime import datetime, date
from werkzeug.utils import secure_filename


# ==========================================================
# AQUAAI CONFIGURATION
# ==========================================================

app = Flask(__name__)
app.secret_key = "aquaai_local_development_key"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "users.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}

KARNATAKA_DISTRICTS = [
    "Bagalkot", "Ballari", "Belagavi", "Bengaluru Rural",
    "Bengaluru Urban", "Bidar", "Chamarajanagar",
    "Chikkaballapur", "Chikkamagaluru", "Chitradurga",
    "Dakshina Kannada", "Davanagere", "Dharwad",
    "Gadag", "Hassan", "Haveri", "Kalaburagi",
    "Kodagu", "Kolar", "Koppal", "Mandya",
    "Mysuru", "Raichur", "Ramanagara", "Shivamogga",
    "Tumakuru", "Udupi", "Uttara Kannada",
    "Vijayanagara", "Vijayapura", "Yadgir"
]


# ==========================================================
# DATABASE CONNECTION AND INITIALIZATION
# ==========================================================

def get_db():
    conn = sqlite3.connect(DATABASE, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def column_exists(conn, table, column):
    columns = conn.execute(
        f"PRAGMA table_info({table})"
    ).fetchall()

    return any(row["name"] == column for row in columns)


def add_column_if_missing(conn, table, column, definition):
    if not column_exists(conn, table, column):
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN {column} {definition}"
        )
        print(f"Added database column: {table}.{column}")


def init_db():
    conn = get_db()

    try:
        cursor = conn.cursor()

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS water_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                district TEXT,
                area TEXT,
                water_demand REAL DEFAULT 0,
                water_supply REAL DEFAULT 0,
                water_level REAL DEFAULT 0,
                water_quality TEXT,
                recorded_at TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reservoirs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reservoir_name TEXT,
                district TEXT,
                river TEXT,
                basin TEXT,
                monitoring_date TEXT,
                percentage_full REAL DEFAULT 0,
                reservoir_level REAL DEFAULT 0,
                design_capacity REAL DEFAULT 0,
                gross_capacity REAL DEFAULT 0,
                live_capacity REAL DEFAULT 0,
                inflow REAL DEFAULT 0,
                outflow REAL DEFAULT 0,
                canal_withdrawal REAL DEFAULT 0,
                evaporation REAL DEFAULT 0
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS emergency_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                district TEXT,
                area TEXT,
                requester_name TEXT,
                contact TEXT,
                required_quantity REAL DEFAULT 0,
                priority TEXT DEFAULT 'Medium',
                source_location TEXT,
                destination_location TEXT,
                status TEXT DEFAULT 'Requested',
                created_at TEXT
            )
        """)

        cursor.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_datasets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT,
                filepath TEXT,
                uploaded_at TEXT,
                row_count INTEGER DEFAULT 0
            )
        """)

        # Migrate existing water_records table.
        water_columns = [
            ("district", "TEXT"),
            ("area", "TEXT"),
            ("water_demand", "REAL DEFAULT 0"),
            ("water_supply", "REAL DEFAULT 0"),
            ("water_level", "REAL DEFAULT 0"),
            ("water_quality", "TEXT"),
            ("recorded_at", "TEXT"),
            ("uploaded_at", "TEXT"),
            ("water_consumed", "REAL DEFAULT NULL"),
            ("source_filename", "TEXT")
        ]

        for column, definition in water_columns:
            add_column_if_missing(
                conn, "water_records", column, definition
            )

        # Migrate existing emergency_requests table.
        emergency_columns = [
            ("district", "TEXT"),
            ("area", "TEXT"),
            ("requester_name", "TEXT"),
            ("contact", "TEXT"),
            ("required_quantity", "REAL DEFAULT 0"),
            ("priority", "TEXT DEFAULT 'Medium'"),
            ("source_location", "TEXT"),
            ("destination_location", "TEXT"),
            ("status", "TEXT DEFAULT 'Requested'"),
            ("created_at", "TEXT"),
            ("tanker_id", "TEXT"),
            ("distance_km", "REAL DEFAULT 0"),
            ("duration_minutes", "REAL DEFAULT 0"),
            ("route_geometry", "TEXT"),
            ("start_time", "REAL")
        ]

        for column, definition in emergency_columns:
            add_column_if_missing(
                conn, "emergency_requests", column, definition
            )

        # Migrate existing reservoir table.
        reservoir_columns = [
            ("reservoir_name", "TEXT"),
            ("district", "TEXT"),
            ("river", "TEXT"),
            ("basin", "TEXT"),
            ("monitoring_date", "TEXT"),
            ("percentage_full", "REAL DEFAULT 0"),
            ("reservoir_level", "REAL DEFAULT 0"),
            ("design_capacity", "REAL DEFAULT 0"),
            ("gross_capacity", "REAL DEFAULT 0"),
            ("live_capacity", "REAL DEFAULT 0"),
            ("inflow", "REAL DEFAULT 0"),
            ("outflow", "REAL DEFAULT 0"),
            ("canal_withdrawal", "REAL DEFAULT 0"),
            ("evaporation", "REAL DEFAULT 0")
        ]

        for column, definition in reservoir_columns:
            add_column_if_missing(
                conn, "reservoirs", column, definition
            )

        dataset_columns = [
            ("filename", "TEXT"),
            ("filepath", "TEXT"),
            ("uploaded_at", "TEXT"),
            ("row_count", "INTEGER DEFAULT 0")
        ]

        for column, definition in dataset_columns:
            add_column_if_missing(
                conn, "uploaded_datasets", column, definition
            )

        conn.commit()
        print("AquaAI database initialized successfully.")

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


# ==========================================================
# GENERAL HELPERS
# ==========================================================

def allowed_file(filename):
    return (
        "." in filename and
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def safe_float(value, default=0):
    try:
        if value is None or pd.isna(value):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def row_to_dict(row):
    return dict(row) if row else None


def get_latest_water_records():
    conn = get_db()

    try:
        rows = conn.execute("""
            SELECT *
            FROM water_records
            ORDER BY
                COALESCE(recorded_at, uploaded_at, '') DESC,
                id DESC
        """).fetchall()

        return [dict(row) for row in rows]

    finally:
        conn.close()


def get_latest_district_snapshot(records):
    latest = {}

    for record in records:
        district = str(record.get("district") or "Unknown").strip()
        area = str(record.get("area") or district).strip()
        key = (district.lower(), area.lower())

        current_date = (
            record.get("recorded_at")
            or record.get("uploaded_at")
            or ""
        )

        existing = latest.get(key)

        if existing is None:
            latest[key] = record
            continue

        existing_date = (
            existing.get("recorded_at")
            or existing.get("uploaded_at")
            or ""
        )

        if (
            str(current_date), int(record.get("id") or 0)
        ) > (
            str(existing_date), int(existing.get("id") or 0)
        ):
            latest[key] = record

    return list(latest.values())


def get_water_summary():
    records = get_latest_district_snapshot(
        get_latest_water_records()
    )

    total_demand = sum(
        safe_float(row.get("water_demand"))
        for row in records
    )

    total_supply = sum(
        safe_float(row.get("water_supply"))
        for row in records
    )

    total_shortage = sum(
        max(
            safe_float(row.get("water_demand"))
            - safe_float(row.get("water_supply")),
            0
        )
        for row in records
    )

    consumption_values = [
        safe_float(row.get("water_consumed"))
        for row in records
        if row.get("water_consumed") is not None
    ]

    return {
        "total_areas": len(records),
        "total_demand": round(total_demand, 2),
        "total_supply": round(total_supply, 2),
        "shortage": round(total_shortage, 2),
        "total_consumed": (
            round(sum(consumption_values), 2)
            if consumption_values else None
        ),
        "consumption_data_available": bool(consumption_values),
        "supply_percentage": round(
            total_supply / total_demand * 100
            if total_demand > 0 else 0,
            2
        )
    }


def read_dataset_file(path):
    if path.lower().endswith(".csv"):
        return pd.read_csv(path)
    return pd.read_excel(path)


# ==========================================================
# HOME AND HEALTH
# ==========================================================

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify({
        "status": "running",
        "application": "AquaAI",
        "database": "connected",
        "message": "AquaAI backend is working"
    })


# ==========================================================
# WATER DATA
# ==========================================================

@app.route("/api/water-data")
@app.route("/api/water-records")
def water_data():
    records = get_latest_water_records()
    result = []

    for row in records:
        result.append({
            **row,
            "demand": safe_float(row.get("water_demand")),
            "availability": safe_float(row.get("water_supply")),
            "water_consumed": (
                safe_float(row.get("water_consumed"), None)
            ),
            "uploaded_at": row.get("uploaded_at"),
            "source_filename": row.get("source_filename")
        })

    return jsonify(result)


@app.route("/api/summary")
def summary():
    return jsonify(get_water_summary())


@app.route("/api/water-records/<int:record_id>", methods=["DELETE"])
def delete_water_record(record_id):
    conn = get_db()

    try:
        cursor = conn.execute(
            "DELETE FROM water_records WHERE id = ?",
            (record_id,)
        )
        conn.commit()

        if cursor.rowcount == 0:
            return jsonify({
                "success": False,
                "message": "Record not found"
            }), 404

        return jsonify({"success": True})

    finally:
        conn.close()


# ==========================================================
# KARNATAKA DISTRICTS
# ==========================================================

@app.route("/api/karnataka-districts")
def districts():
    records = get_latest_water_records()

    uploaded_districts = {
        str(row["district"]).strip().lower()
        for row in records
        if row.get("district")
    }

    return jsonify([
        {
            "district": district,
            "has_measurements": district.lower() in uploaded_districts,
            "data_status": (
                "Uploaded measurements available"
                if district.lower() in uploaded_districts
                else "No measurements uploaded"
            )
        }
        for district in KARNATAKA_DISTRICTS
    ])


# ==========================================================
# UPLOAD WATER DATASET
# ==========================================================

@app.route("/api/upload-water-data", methods=["POST"])
def upload_water_data():

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "message": "Please select a file"
        }), 400

    file = request.files["file"]

    if not file.filename:
        return jsonify({
            "success": False,
            "message": "No file selected"
        }), 400

    if not allowed_file(file.filename):
        return jsonify({
            "success": False,
            "message": "Only CSV, XLSX and XLS files are supported"
        }), 400

    filename = secure_filename(file.filename)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    saved_name = f"{timestamp}_{filename}"
    filepath = os.path.join(UPLOAD_FOLDER, saved_name)

    file.save(filepath)

    conn = None

    try:
        df = read_dataset_file(filepath)

        df.columns = [
            str(column).strip().lower()
            .replace(" ", "_")
            .replace("-", "_")
            for column in df.columns
        ]

        def find_column(candidates):
            return next(
                (column for column in candidates if column in df.columns),
                None
            )

        district_col = find_column([
            "district", "district_name"
        ])

        area_col = find_column([
            "area", "village", "location", "city"
        ])

        demand_col = find_column([
            "water_demand", "demand",
            "demand_litres", "demand_liters"
        ])

        supply_col = find_column([
            "water_supply", "supply",
            "supply_litres", "supply_liters",
            "availability", "available_water", "water_available"
        ])

        consumption_col = find_column([
            "water_consumed", "consumption",
            "water_used", "used_water", "consumed_litres"
        ])

        level_col = find_column([
            "water_level", "level", "water_level_percentage"
        ])

        quality_col = find_column([
            "water_quality", "quality"
        ])

        date_col = find_column([
            "recorded_at", "observation_date",
            "date", "monitoring_date"
        ])

        if not district_col:
            return jsonify({
                "success": False,
                "message": "Dataset must contain a district column."
            }), 400

        if not demand_col and not supply_col:
            return jsonify({
                "success": False,
                "message": (
                    "Dataset must contain demand or availability/supply."
                )
            }), 400

        conn = get_db()

        upload_time = datetime.now().isoformat()

        cursor = conn.execute("""
            INSERT INTO uploaded_datasets
            (filename, filepath, uploaded_at, row_count)
            VALUES (?, ?, ?, ?)
        """, (
            filename,
            filepath,
            upload_time,
            len(df)
        ))

        dataset_id = cursor.lastrowid
        imported = 0

        for _, row in df.iterrows():
            district_value = row[district_col]

            if pd.isna(district_value):
                continue

            district = str(district_value).strip()

            if area_col and pd.notna(row[area_col]):
                area = str(row[area_col]).strip()
            else:
                area = district

            demand = safe_float(
                row[demand_col] if demand_col else 0
            )

            supply = safe_float(
                row[supply_col] if supply_col else 0
            )

            consumed = (
                safe_float(row[consumption_col], None)
                if consumption_col else None
            )

            level = safe_float(
                row[level_col] if level_col else 0
            )

            quality = (
                str(row[quality_col])
                if quality_col and pd.notna(row[quality_col])
                else "Not recorded"
            )

            recorded_at = upload_time

            if date_col and pd.notna(row[date_col]):
                parsed_date = pd.to_datetime(
                    row[date_col],
                    errors="coerce",
                    dayfirst=True
                )

                if pd.notna(parsed_date):
                    recorded_at = parsed_date.isoformat()

            conn.execute("""
                INSERT INTO water_records (
                    district, area, water_demand, water_supply,
                    water_consumed, water_level, water_quality,
                    recorded_at, uploaded_at, source_filename
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                district, area, demand, supply,
                consumed, level, quality,
                recorded_at, upload_time, filename
            ))

            imported += 1

        conn.commit()

        return jsonify({
            "success": True,
            "dataset_id": dataset_id,
            "filename": filename,
            "rows": len(df),
            "water_records_imported": imported,
            "columns": list(df.columns),
            "detected_columns": {
                "district": district_col,
                "area": area_col,
                "demand": demand_col,
                "availability_as_supply": supply_col,
                "consumption": consumption_col,
                "date": date_col
            },
            "message": "Water dataset imported successfully"
        })

    except Exception as error:
        if conn:
            conn.rollback()

        app.logger.exception("Water dataset upload failed")

        return jsonify({
            "success": False,
            "message": str(error)
        }), 400

    finally:
        if conn:
            conn.close()


# ==========================================================
# DATASET HISTORY, PREVIEW AND ANALYSIS
# ==========================================================

@app.route("/api/datasets")
def datasets():
    conn = get_db()

    try:
        rows = conn.execute("""
            SELECT * FROM uploaded_datasets
            ORDER BY id DESC
        """).fetchall()

        return jsonify([dict(row) for row in rows])

    finally:
        conn.close()


@app.route("/api/upload-history")
def upload_history():
    return datasets()


@app.route("/api/datasets/<int:dataset_id>/preview")
def dataset_preview(dataset_id):
    conn = get_db()

    try:
        dataset = conn.execute("""
            SELECT * FROM uploaded_datasets WHERE id = ?
        """, (dataset_id,)).fetchone()
    finally:
        conn.close()

    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    try:
        df = read_dataset_file(dataset["filepath"])

        return jsonify({
            "columns": list(df.columns),
            "rows": df.head(20).fillna("").to_dict(orient="records"),
            "total_rows": len(df)
        })

    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/datasets/<int:dataset_id>/analysis")
def dataset_analysis(dataset_id):
    conn = get_db()

    try:
        dataset = conn.execute("""
            SELECT * FROM uploaded_datasets WHERE id = ?
        """, (dataset_id,)).fetchone()
    finally:
        conn.close()

    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    try:
        df = read_dataset_file(dataset["filepath"])
        numeric = df.select_dtypes(include="number")

        return jsonify({
            "filename": dataset["filename"],
            "rows": len(df),
            "columns": len(df.columns),
            "missing_values": int(df.isna().sum().sum()),
            "numeric_summary": (
                json.loads(numeric.describe().to_json())
                if not numeric.empty else {}
            ),
            "column_names": list(df.columns)
        })

    except Exception as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/datasets/<int:dataset_id>/water-demand")
def water_demand_analysis(dataset_id):
    conn = get_db()

    try:
        dataset = conn.execute("""
            SELECT * FROM uploaded_datasets WHERE id = ?
        """, (dataset_id,)).fetchone()
    finally:
        conn.close()

    if not dataset:
        return jsonify({"error": "Dataset not found"}), 404

    try:
        df = read_dataset_file(dataset["filepath"])

        df.columns = [
            str(c).strip().lower().replace(" ", "_").replace("-", "_")
            for c in df.columns
        ]

        demand_col = next(
            (c for c in [
                "water_demand", "demand",
                "demand_litres", "demand_liters"
            ] if c in df.columns),
            None
        )

        supply_col = next(
            (c for c in [
                "water_supply", "supply",
                "supply_litres", "availability",
                "available_water"
            ] if c in df.columns),
            None
        )

        district_col = next(
            (c for c in ["district", "district_name"] if c in df.columns),
            None
        )

        if not demand_col:
            return jsonify({
                "error": "No water demand column found"
            }), 400

        demand_values = pd.to_numeric(
            df[demand_col], errors="coerce"
        ).fillna(0)

        supply_values = (
            pd.to_numeric(df[supply_col], errors="coerce").fillna(0)
            if supply_col else pd.Series([0] * len(df))
        )

        areas = []

        if district_col:
            temporary = pd.DataFrame({
                "district": df[district_col].fillna("Unknown"),
                "demand": demand_values,
                "supply": supply_values
            })

            grouped = temporary.groupby("district").agg({
                "demand": "sum",
                "supply": "sum"
            })

            for district, values in grouped.iterrows():
                areas.append({
                    "district": str(district),
                    "demand": float(values["demand"]),
                    "supply": float(values["supply"]),
                    "shortage": float(max(
                        values["demand"] - values["supply"], 0
                    ))
                })

        return jsonify({
            "total_demand": float(demand_values.sum()),
            "total_supply": float(supply_values.sum()),
            "shortage": float(max(
                demand_values.sum() - supply_values.sum(), 0
            )),
            "areas": areas
        })

    except Exception as error:
        return jsonify({"error": str(error)}), 400


# ==========================================================
# RESERVOIR MANAGEMENT
# ==========================================================

@app.route("/api/reservoirs", methods=["GET"])
def get_reservoirs():
    conn = get_db()

    try:
        rows = conn.execute("""
            SELECT * FROM reservoirs
            ORDER BY monitoring_date DESC, id DESC
        """).fetchall()

        return jsonify([dict(row) for row in rows])

    finally:
        conn.close()


@app.route("/api/reservoirs", methods=["POST"])
def add_reservoir():
    data = request.get_json(silent=True) or {}

    name = data.get("reservoir_name")

    if not name:
        return jsonify({
            "success": False,
            "message": "Reservoir name is required"
        }), 400

    conn = get_db()

    try:
        conn.execute("""
            INSERT INTO reservoirs (
                reservoir_name, district, river, basin,
                monitoring_date, percentage_full, reservoir_level,
                design_capacity, gross_capacity, live_capacity,
                inflow, outflow, canal_withdrawal, evaporation
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            name,
            data.get("district", ""),
            data.get("river", ""),
            data.get("basin", ""),
            data.get("monitoring_date", date.today().isoformat()),
            safe_float(data.get("percentage_full")),
            safe_float(data.get("reservoir_level")),
            safe_float(data.get("design_capacity")),
            safe_float(data.get("gross_capacity")),
            safe_float(data.get("live_capacity")),
            safe_float(data.get("inflow")),
            safe_float(data.get("outflow")),
            safe_float(data.get("canal_withdrawal")),
            safe_float(data.get("evaporation"))
        ))

        conn.commit()

        return jsonify({
            "success": True,
            "message": "Reservoir record saved"
        })

    finally:
        conn.close()


# ==========================================================
# EMERGENCY WATER REQUESTS
# ==========================================================

@app.route("/api/emergency-request", methods=["POST"])
def create_emergency_request():
    data = request.get_json(silent=True) or {}

    required_fields = [
        "district", "area",
        "required_quantity", "destination_location"
    ]

    for field in required_fields:
        if data.get(field) in (None, ""):
            return jsonify({
                "success": False,
                "message": f"{field.replace('_', ' ').title()} is required"
            }), 400

    quantity = safe_float(data.get("required_quantity"), None)

    if quantity is None or quantity <= 0:
        return jsonify({
            "success": False,
            "message": "Required quantity must be greater than zero"
        }), 400

    conn = get_db()

    try:
        cursor = conn.execute("""
            INSERT INTO emergency_requests (
                district, area, requester_name, contact,
                required_quantity, priority, source_location,
                destination_location, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("district"),
            data.get("area"),
            data.get("requester_name", ""),
            data.get("contact", ""),
            quantity,
            data.get("priority", "Medium"),
            data.get("source_location", ""),
            data.get("destination_location"),
            "Requested",
            datetime.now().isoformat()
        ))

        request_id = cursor.lastrowid
        conn.commit()

        return jsonify({
            "success": True,
            "request_id": request_id,
            "message": "Emergency request submitted successfully"
        })

    finally:
        conn.close()


@app.route("/api/emergency-requests")
def emergency_requests():
    conn = get_db()

    try:
        rows = conn.execute("""
            SELECT * FROM emergency_requests
            ORDER BY id DESC
        """).fetchall()

        return jsonify([dict(row) for row in rows])

    finally:
        conn.close()


@app.route("/api/emergency-requests/<int:request_id>", methods=["PATCH"])
def update_emergency_request(request_id):
    data = request.get_json(silent=True) or {}

    allowed_statuses = [
        "Requested", "Assigned", "In Transit",
        "Delivered", "Cancelled"
    ]

    status = data.get("status")
    tanker_id = data.get("tanker_id")

    if status and status not in allowed_statuses:
        return jsonify({
            "success": False,
            "message": "Invalid status"
        }), 400

    conn = get_db()

    try:
        existing = conn.execute("""
            SELECT * FROM emergency_requests WHERE id = ?
        """, (request_id,)).fetchone()

        if not existing:
            return jsonify({"error": "Request not found"}), 404

        if status:
            conn.execute("""
                UPDATE emergency_requests SET status = ? WHERE id = ?
            """, (status, request_id))

        if tanker_id is not None:
            conn.execute("""
                UPDATE emergency_requests SET tanker_id = ? WHERE id = ?
            """, (tanker_id, request_id))

        conn.commit()

        return jsonify({
            "success": True,
            "message": "Request updated"
        })

    finally:
        conn.close()


# ==========================================================
# LOCATION GEOCODING AND ROAD ROUTING
# ==========================================================

def geocode_location(location):
    if not location:
        return None

    try:
        response = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": location,
                "format": "json",
                "limit": 1
            },
            headers={
                "User-Agent": "AquaAI-WaterManagement-App"
            },
            timeout=15
        )

        response.raise_for_status()
        results = response.json()

        if not results:
            return None

        return {
            "lat": float(results[0]["lat"]),
            "lon": float(results[0]["lon"]),
            "display_name": results[0]["display_name"]
        }

    except requests.RequestException:
        return None


def get_road_route(source, destination):
    try:
        url = (
            "https://router.project-osrm.org/route/v1/driving/"
            f"{source['lon']},{source['lat']};"
            f"{destination['lon']},{destination['lat']}"
        )

        response = requests.get(
            url,
            params={
                "overview": "full",
                "geometries": "geojson"
            },
            timeout=20
        )

        response.raise_for_status()
        result = response.json()

        if result.get("code") != "Ok" or not result.get("routes"):
            return None

        route = result["routes"][0]

        return {
            "distance_km": round(route["distance"] / 1000, 2),
            "duration_minutes": round(route["duration"] / 60, 2),
            "geometry": route["geometry"]
        }

    except (requests.RequestException, KeyError, IndexError):
        return None


@app.route("/api/route", methods=["POST"])
def calculate_route():
    data = request.get_json(silent=True) or {}

    source_name = data.get("source")
    destination_name = data.get("destination")

    if not source_name or not destination_name:
        return jsonify({
            "success": False,
            "message": "Source and destination are required"
        }), 400

    source = geocode_location(source_name)
    destination = geocode_location(destination_name)

    if not source or not destination:
        return jsonify({
            "success": False,
            "message": "Could not locate the source or destination"
        }), 404

    route = get_road_route(source, destination)

    if not route:
        return jsonify({
            "success": False,
            "message": "Road route could not be calculated"
        }), 502

    return jsonify({
        "success": True,
        "source": source,
        "destination": destination,
        "distance_km": route["distance_km"],
        "duration_minutes": route["duration_minutes"],
        "geometry": route["geometry"],
        "message": "Route calculated. Live traffic delays are not included."
    })


@app.route("/api/emergency-transport-plan", methods=["POST"])
def emergency_transport_plan():
    data = request.get_json(silent=True) or {}

    source_name = data.get("source")
    destination_name = data.get("destination")

    if not source_name or not destination_name:
        return jsonify({
            "success": False,
            "message": "Source and destination are required"
        }), 400

    source = geocode_location(source_name)
    destination = geocode_location(destination_name)

    if not source or not destination:
        return jsonify({
            "success": False,
            "message": "Location not found"
        }), 404

    route = get_road_route(source, destination)

    if not route:
        return jsonify({
            "success": False,
            "message": "Unable to calculate transportation route"
        }), 502

    return jsonify({
        "success": True,
        "source": source,
        "destination": destination,
        "distance_km": route["distance_km"],
        "duration_minutes": route["duration_minutes"],
        "geometry": route["geometry"]
    })


# ==========================================================
# SIMULATED TANKER TRACKING
# ==========================================================

@app.route(
    "/api/emergency-requests/<int:request_id>/tracking/start-demo",
    methods=["POST"]
)
def start_demo_tracking(request_id):
    data = request.get_json(silent=True) or {}
    conn = get_db()

    try:
        emergency = conn.execute("""
            SELECT * FROM emergency_requests WHERE id = ?
        """, (request_id,)).fetchone()

        if not emergency:
            return jsonify({"error": "Request not found"}), 404

        source_name = (
            data.get("source") or emergency["source_location"]
        )

        destination_name = (
            data.get("destination") or emergency["destination_location"]
        )

        if not source_name or not destination_name:
            return jsonify({
                "success": False,
                "message": "Source and destination are required"
            }), 400

        source = geocode_location(source_name)
        destination = geocode_location(destination_name)

        if not source or not destination:
            return jsonify({
                "success": False,
                "message": "Could not locate route endpoints"
            }), 404

        route = get_road_route(source, destination)

        if not route:
            return jsonify({
                "success": False,
                "message": "Unable to calculate road route"
            }), 502

        tanker_id = data.get("tanker_id") or f"AQUA-T{request_id:03d}"

        conn.execute("""
            UPDATE emergency_requests
            SET source_location = ?,
                destination_location = ?,
                status = 'In Transit',
                tanker_id = ?,
                distance_km = ?,
                duration_minutes = ?,
                route_geometry = ?,
                start_time = ?
            WHERE id = ?
        """, (
            source_name,
            destination_name,
            tanker_id,
            route["distance_km"],
            route["duration_minutes"],
            json.dumps(route["geometry"]),
            time.time(),
            request_id
        ))

        conn.commit()

        return jsonify({
            "success": True,
            "request_id": request_id,
            "tanker_id": tanker_id,
            "distance_km": route["distance_km"],
            "duration_minutes": route["duration_minutes"],
            "geometry": route["geometry"],
            "tracking_mode": "SIMULATED DEMO",
            "message": "Simulated tanker tracking started"
        })

    finally:
        conn.close()


@app.route("/api/emergency-requests/<int:request_id>/tracking")
def get_tracking(request_id):
    conn = get_db()

    try:
        emergency = conn.execute("""
            SELECT * FROM emergency_requests WHERE id = ?
        """, (request_id,)).fetchone()

        if not emergency:
            return jsonify({"error": "Request not found"}), 404

        record = dict(emergency)

    finally:
        conn.close()

    distance = safe_float(record.get("distance_km"))
    duration = safe_float(record.get("duration_minutes"))
    start_time = record.get("start_time")

    progress = 0
    remaining_distance = distance
    remaining_minutes = duration
    current_position = None
    geometry = None

    if record.get("route_geometry"):
        try:
            geometry = json.loads(record["route_geometry"])
        except (ValueError, TypeError):
            geometry = None

    if start_time and duration > 0:
        elapsed_minutes = max(
            (time.time() - float(start_time)) / 60,
            0
        )

        progress = min(elapsed_minutes / duration, 1)
        remaining_distance = distance * (1 - progress)
        remaining_minutes = max(duration - elapsed_minutes, 0)

        if geometry and geometry.get("coordinates"):
            coordinates = geometry["coordinates"]

            if len(coordinates) >= 2:
                index = min(
                    int(progress * (len(coordinates) - 1)),
                    len(coordinates) - 1
                )

                current_position = {
                    "lon": coordinates[index][0],
                    "lat": coordinates[index][1]
                }

        if progress >= 1 and record["status"] == "In Transit":
            update_conn = get_db()

            try:
                update_conn.execute("""
                    UPDATE emergency_requests
                    SET status = 'Delivered'
                    WHERE id = ?
                """, (request_id,))
                update_conn.commit()
                record["status"] = "Delivered"

            finally:
                update_conn.close()

    return jsonify({
        "success": True,
        "request_id": request_id,
        "status": record["status"],
        "tanker_id": record.get("tanker_id"),
        "tracking_mode": (
            "SIMULATED DEMO" if start_time else "NOT STARTED"
        ),
        "progress_percentage": round(progress * 100, 2),
        "total_distance_km": round(distance, 2),
        "remaining_distance_km": round(max(remaining_distance, 0), 2),
        "total_duration_minutes": round(duration, 2),
        "remaining_minutes": round(max(remaining_minutes, 0), 2),
        "current_position": current_position,
        "geometry": geometry,
        "source": record.get("source_location"),
        "destination": record.get("destination_location")
    })


# ==========================================================
# LIVE WEATHER
# ==========================================================

@app.route("/api/live-weather")
def live_weather():
    cities = {
        "Bengaluru": (12.9716, 77.5946),
        "Mysuru": (12.2958, 76.6394),
        "Mangaluru": (12.9141, 74.8560),
        "Hubballi": (15.3647, 75.1240),
        "Belagavi": (15.8497, 74.4977),
        "Kalaburagi": (17.3297, 76.8343)
    }

    results = []

    for city, coordinates in cities.items():
        try:
            response = requests.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": coordinates[0],
                    "longitude": coordinates[1],
                    "current": (
                        "temperature_2m,relative_humidity_2m,"
                        "precipitation,weather_code"
                    )
                },
                timeout=12
            )

            response.raise_for_status()
            data = response.json()

            results.append({
                "city": city,
                "weather": data.get("current", {}),
                "source": "Open-Meteo"
            })

        except requests.RequestException:
            results.append({
                "city": city,
                "weather": None,
                "source": "Unavailable"
            })

    return jsonify({
        "success": True,
        "data": results,
        "note": "Weather estimates are not water-level sensor readings."
    })





# ==========================================================
# OFFICIAL GOVERNMENT WATER DATA - NWDP
# Direct official CSV integration
# Does NOT use the broken package_search endpoint
# ==========================================================

from io import BytesIO

NWDP_WEBSITE = "https://nwdp.nwic.gov.in"
PUBLIC_CACHE = {}
PUBLIC_CACHE_SECONDS = 900

GOVERNMENT_DATASETS = {
    "reservoir": {
        "title": "Karnataka Reservoir Observations",
        "name": "Reservoir Data (Manual Daily) Karnataka 1990-2026",
        "page": "https://nwdp.nwic.gov.in/dataset/reservoir-data-karnataka",
        "url": "https://nwdp.nwic.gov.in/dataset/e35dc28a-6f9c-486d-b598-87a21397018e/resource/26800982-045c-41de-821d-b1ca080a79a8/download/karnataka_man_reservoir_data.csv",
        "frequency": "Daily",
        "description": "Official Karnataka reservoir observations."
    },
    "rainfall": {
        "title": "Karnataka Rainfall Observations",
        "name": "Rainfall Manual Daily Karnataka 2026-2030",
        "page": "https://nwdp.nwic.gov.in/dataset/rainfall-manual-daily-karnataka",
        "url": "https://nwdp.nwic.gov.in/dataset/fde650de-0c37-4864-972d-6bfcfd5fb200/resource/3e875159-28ef-4196-af0e-fafb4540f280/download/karnataka_rainfall_data_2026_2030.csv",
        "frequency": "Daily",
        "description": "Official Karnataka rainfall observations."
    },
    "discharge": {
        "title": "Karnataka River Discharge",
        "name": "Discharge Gauge Manual Daily Karnataka 2021-2025",
        "page": "https://nwdp.nwic.gov.in/dataset/kwris-discharge-gauge-daily",
        "url": "https://nwdp.nwic.gov.in/dataset/f5b49998-6208-4627-b88f-4d3b75238d78/resource/d1bf65de-1010-47e5-beb6-23ff7ac82888/download/karnataka_discharge_gauge_daily_2021_2025.csv",
        "frequency": "Daily",
        "description": "Official river and stream discharge observations."
    },
    "groundwater": {
        "title": "Karnataka Groundwater Levels",
        "name": "Ground Water Level Manual Monthly Karnataka 2026-2030",
        "page": "https://nwdp.nwic.gov.in/dataset/ground-water-level-manual-daily-karnataka",
        "url": "https://nwdp.nwic.gov.in/dataset/1cbc78e5-42e2-4140-a584-ec752c994955/resource/4e393536-9a75-4ae8-a246-64a2530e16a9/download/karnataka_man_gw_wl_monthly_data_2026_2030.csv",
        "frequency": "Monthly",
        "description": "Official groundwater-level observations."
    },
    "groundwater_telemetry": {
        "title": "Karnataka Groundwater Telemetry",
        "name": "Ground Water Telemetry Six Hourly Karnataka 2026 Part 2",
        "page": "https://nwdp.nwic.gov.in/dataset/kwris-ground-water-telemetry-six-hourly-karnataka",
        "url": "https://nwdp.nwic.gov.in/dataset/e67cc282-0399-49db-84af-c1416838cd5b/resource/efd53393-7adf-4471-9f8c-9b7eebe3b41d/download/karnataka_tel_gw_wl_six_hourly_data_2026_2.csv",
        "frequency": "Six-hourly",
        "description": "Official six-hour groundwater telemetry observations."
    },
    "water_quality": {
        "title": "Karnataka Water Quality",
        "name": "Water Quality Karnataka KSPCB 2005-2022",
        "page": "https://nwdp.nwic.gov.in/dataset/water-quality-manual-karnataka",
        "url": "https://nwdp.nwic.gov.in/dataset/ec1592da-829b-48b8-810e-b85538624a77/resource/ec197a09-d702-4657-9ad6-4c55b4fdedcc/download/water_quality_karnataka_2005_2022.csv",
        "frequency": "Historical observations",
        "description": "Official Karnataka water-quality observations."
    }
}


def public_json_error(key, message, error=None):
    config = GOVERNMENT_DATASETS[key]

    return {
        "key": key,
        "title": config["title"],
        "available": False,
        "record_count": 0,
        "records": [],
        "observation_date": None,
        "dataset_url": config["url"],
        "page_url": config["page"],
        "source": NWDP_WEBSITE,
        "message": message,
        "error": str(error) if error else None
    }


def find_observation_date(frame):
    date_columns = [
        column for column in frame.columns
        if any(word in str(column).lower()
               for word in ["date", "time", "timestamp", "year"])
    ]

    for column in date_columns:
        try:
            dates = pd.to_datetime(
                frame[column],
                errors="coerce",
                dayfirst=True
            ).dropna()

            if not dates.empty:
                return dates.max().strftime("%Y-%m-%d")
        except Exception:
            continue

    return None


def load_direct_government_dataset(key, force_refresh=False):
    if key not in GOVERNMENT_DATASETS:
        return None

    config = GOVERNMENT_DATASETS[key]
    now = time.time()

    cached = PUBLIC_CACHE.get(key)

    if (
        cached
        and not force_refresh
        and now - cached["cached_at"] < PUBLIC_CACHE_SECONDS
    ):
        return cached["data"]

    try:
        headers = {
            "User-Agent": "AquaAI-Water-Monitor/1.0",
            "Accept": "text/csv,text/plain,*/*"
        }

        response = requests.get(
            config["url"],
            headers=headers,
            timeout=(20, 120)
        )

        response.raise_for_status()

        if not response.content:
            raise ValueError("The government CSV file is empty.")

        content_type = response.headers.get("Content-Type", "").lower()

        if "text/html" in content_type:
            raise ValueError(
                "The government server returned a webpage instead of CSV."
            )

        frame = pd.read_csv(
            BytesIO(response.content),
            low_memory=False
        )

        if frame.empty:
            raise ValueError("The government CSV contains no observations.")

        frame.columns = [
            str(column).strip()
            for column in frame.columns
        ]

        observation_date = find_observation_date(frame)

        # Keep the most recent rows available in the downloaded file.
        display_frame = frame.tail(300).copy()

        # Convert missing values to JSON null, never artificial zero.
        records = json.loads(
            display_frame.to_json(
                orient="records",
                date_format="iso"
            )
        )

        data = {
            "key": key,
            "title": config["title"],
            "dataset_name": config["name"],
            "available": True,
            "record_count": len(frame),
            "display_record_count": len(records),
            "records": records,
            "observation_date": observation_date,
            "dataset_url": config["url"],
            "page_url": config["page"],
            "source": NWDP_WEBSITE,
            "frequency": config["frequency"],
            "message": "Official government observations retrieved successfully.",
            "error": None
        }

        PUBLIC_CACHE[key] = {
            "cached_at": now,
            "data": data
        }

        return data

    except Exception as error:
        return public_json_error(
            key,
            "Could not download this official government dataset.",
            error
        )


def build_public_water_response(force_refresh=False):
    datasets = {}

    for key in GOVERNMENT_DATASETS:
        datasets[key] = load_direct_government_dataset(
            key,
            force_refresh=force_refresh
        )

    available_count = sum(
        1 for item in datasets.values()
        if item and item.get("available")
    )

    return {
        "success": True,
        "source": "National Water Data Portal",
        "source_url": NWDP_WEBSITE,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "dataset_count": len(GOVERNMENT_DATASETS),
        "available_count": available_count,
        "datasets": datasets,
        "alerts": [],
        "note": (
            "Only official government observations are included. "
            "Missing measurements are not replaced with zero. "
            "These datasets do not provide district-wise water demand "
            "or household water supply figures."
        )
    }


# ----------------------------------------------------------
# PUBLIC DATA CATALOGUE
# ----------------------------------------------------------

@app.route("/api/public-data-catalogue")
def public_data_catalogue():
    catalogue = []

    for key, config in GOVERNMENT_DATASETS.items():
        catalogue.append({
            "key": key,
            "name": config["name"],
            "title": config["title"],
            "frequency": config["frequency"],
            "description": config["description"],
            "source": NWDP_WEBSITE,
            "page_url": config["page"],
            "dataset_url": config["url"],
            "refresh_seconds": PUBLIC_CACHE_SECONDS
        })

    return jsonify({
        "success": True,
        "catalogue": catalogue,
        "datasets": catalogue
    })


# ----------------------------------------------------------
# ALL GOVERNMENT WATER DATA
# ----------------------------------------------------------

@app.route("/api/public-water-data")
def public_water_data():
    force_refresh = (
        request.args.get("refresh", "").lower()
        in ["1", "true", "yes"]
    )

    return jsonify(
        build_public_water_response(force_refresh)
    )


# ----------------------------------------------------------
# GOVERNMENT WATER INTELLIGENCE
# ----------------------------------------------------------

@app.route("/api/public-water-intelligence")
def public_water_intelligence():
    force_refresh = (
        request.args.get("refresh", "").lower()
        in ["1", "true", "yes"]
    )

    result = build_public_water_response(force_refresh)

    return jsonify(result)


# ----------------------------------------------------------
# ONE GOVERNMENT DATASET
# ----------------------------------------------------------

@app.route("/api/public-dataset/<dataset_key>")
def public_dataset(dataset_key):
    if dataset_key not in GOVERNMENT_DATASETS:
        return jsonify({
            "success": False,
            "message": "Unknown government dataset."
        }), 404

    force_refresh = (
        request.args.get("refresh", "").lower()
        in ["1", "true", "yes"]
    )

    data = load_direct_government_dataset(
        dataset_key,
        force_refresh
    )

    return jsonify(data)


# ----------------------------------------------------------
# LIVE DATA CONNECTION STATUS
# ----------------------------------------------------------

@app.route("/api/live-data-status")
def live_data_status():
    results = {}

    for key, config in GOVERNMENT_DATASETS.items():
        cached = PUBLIC_CACHE.get(key)

        results[key] = {
            "title": config["title"],
            "connected": bool(
                cached and cached["data"].get("available")
            ),
            "last_checked": (
                datetime.fromtimestamp(
                    cached["cached_at"]
                ).isoformat(timespec="seconds")
                if cached else None
            ),
            "source": NWDP_WEBSITE,
            "dataset_page": config["page"]
        }

    return jsonify({
        "success": True,
        "source": "National Water Data Portal",
        "datasets": results
    })


# ==========================================================
# SAMPLE CSV DOWNLOAD
# ==========================================================

@app.route("/sample-csv")
def sample_csv():
    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "district", "area", "demand",
        "availability", "water_level", "water_quality"
    ])

    writer.writerow([
        "Bengaluru Urban", "Example Area 1",
        10000, 8000, 75, "Good"
    ])

    writer.writerow([
        "Mysuru", "Example Area 2",
        8000, 5000, 55, "Needs testing"
    ])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition":
            "attachment; filename=aquaai_sample.csv"
        }
    )


# ==========================================================
# START APPLICATION
# ==========================================================

if __name__ == "__main__":
    init_db()

    print("\n========================================")
    print("       AQUAAI SMART WATER SYSTEM")
    print("========================================")
    print("Database:", DATABASE)
    print("Server: http://127.0.0.1:5000")
    print("Status: Starting...")
    print("========================================\n")

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )