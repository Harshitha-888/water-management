import {
  DatasetFileRecordEntity,
  distributedStore,
  EmergencyRequestEntity,
  MaintenanceTaskEntity,
  ReservoirEntity,
  WaterRecordEntity,
} from './distributedStore';
import { getLatestProcessedResults } from './mapreduce';

export interface HivePreset {
  id: string;
  title: string;
  description: string;
  query: string;
}

export interface HiveQueryResult {
  success: boolean;
  engine: string;
  table: string;
  query: string;
  durationMs: number;
  hdfsBlocksScanned: number;
  rowsScanned: number;
  rowsReturned: number;
  executionStages: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  error?: string;
}

export const HIVE_PRESETS: HivePreset[] = [
  {
    id: 'area_shortage_consumption',
    title: 'Area-wise Consumption & Shortage',
    description: 'Group HDFS water records by area and district, summing consumption and water deficit',
    query:
      'SELECT area, district, SUM(water_consumed) AS water_consumption_l, SUM(water_supply) AS supply_l, SUM(water_demand - water_supply) AS shortage_l FROM aqua_water_records GROUP BY area, district ORDER BY shortage_l DESC LIMIT 20',
  },
  {
    id: 'shortage_hotspots',
    title: 'Shortage Hotspots Only',
    description: 'Retrieve areas where supply is strictly below demand, ordered by shortage',
    query:
      'SELECT area, district, water_consumed AS water_consumption_l, water_supply, water_demand, shortage AS shortage_l, water_quality FROM aqua_water_records WHERE water_supply < water_demand ORDER BY shortage_l DESC LIMIT 20',
  },
  {
    id: 'district_rollup',
    title: 'District Consumption Rollup',
    description: 'Aggregate area count, water consumption, and total shortage per district',
    query:
      'SELECT district, COUNT(*) AS area_records, SUM(water_consumed) AS total_consumption_l, SUM(water_demand - water_supply) AS total_shortage_l FROM aqua_water_records GROUP BY district ORDER BY total_shortage_l DESC LIMIT 31',
  },
  {
    id: 'quality_alerts',
    title: 'Water Quality Alert Areas',
    description: 'Retrieve areas with Moderate TDS, Hard Water, Needs Testing, or Fluoride alerts',
    query:
      "SELECT area, district, water_quality, water_consumed, shortage FROM aqua_water_records WHERE water_quality != 'Good' ORDER BY shortage DESC LIMIT 20",
  },
];

export const RESERVOIR_HIVE_PRESETS: HivePreset[] = [
  {
    id: 'reservoir_capacity_levels',
    title: 'Capacity & Current Level',
    description: 'Retrieve reservoir capacity, available live water, and current percentage full',
    query:
      'SELECT reservoir_name, district, gross_capacity AS capacity_tmc, live_capacity AS available_tmc, percentage_full AS current_level_pct, inflow, outflow FROM aqua_reservoirs ORDER BY percentage_full ASC LIMIT 20',
  },
  {
    id: 'reservoir_avg_levels',
    title: 'Average Historical Levels',
    description: 'Group reservoir observations across HDFS shards to calculate average, min, and max fill %',
    query:
      'SELECT reservoir_name, district, COUNT(*) AS observations, AVG(percentage_full) AS avg_level_pct, MIN(percentage_full) AS min_level_pct, MAX(percentage_full) AS max_level_pct, AVG(inflow) AS avg_inflow FROM aqua_reservoirs GROUP BY reservoir_name, district ORDER BY avg_level_pct ASC LIMIT 20',
  },
  {
    id: 'reservoir_low_alerts',
    title: 'Low-Water-Level Alerts (<55%)',
    description: 'Filter historical and current observations below 55% storage capacity',
    query:
      'SELECT reservoir_name, district, monitoring_date, percentage_full, live_capacity, inflow, outflow FROM aqua_reservoirs WHERE percentage_full < 55 ORDER BY percentage_full ASC LIMIT 25',
  },
  {
    id: 'reservoir_hdfs_history',
    title: 'Historical HDFS Block Records',
    description: 'Retrieve historical reservoir water-level logs with HDFS block provenance',
    query:
      'SELECT reservoir_name, monitoring_date, percentage_full, reservoir_level, live_capacity, block_id FROM aqua_reservoirs ORDER BY monitoring_date DESC LIMIT 30',
  },
];

export const EMERGENCY_HIVE_PRESETS: HivePreset[] = [
  {
    id: 'emergency_all_reports',
    title: 'All Emergency Reports',
    description: 'Retrieve emergency request history with type, status, priority, and timestamp',
    query:
      'SELECT id, district, area, emergency_type, priority, status, required_quantity, created_at FROM aqua_emergency_requests ORDER BY id DESC LIMIT 25',
  },
  {
    id: 'emergency_by_area',
    title: 'Requests by Area',
    description: 'Group HDFS emergency records by area and district with total water requested',
    query:
      'SELECT area, district, COUNT(*) AS request_count, SUM(required_quantity) AS total_required_l FROM aqua_emergency_requests GROUP BY area, district ORDER BY request_count DESC LIMIT 20',
  },
  {
    id: 'emergency_pending',
    title: 'Pending Emergency Cases',
    description: 'Retrieve all Pending requests awaiting administrator approval',
    query:
      "SELECT id, area, district, emergency_type, description, priority, created_at FROM aqua_emergency_requests WHERE status = 'Pending' ORDER BY id DESC LIMIT 20",
  },
  {
    id: 'emergency_no_supply',
    title: 'No Water Supply Incidents',
    description: 'Filter emergency datasets for areas reporting No Water Supply',
    query:
      "SELECT id, area, district, status, priority, required_quantity, block_id FROM aqua_emergency_requests WHERE emergency_type LIKE '%No Water%' ORDER BY id DESC LIMIT 20",
  },
];

export const DATASET_HIVE_PRESETS: HivePreset[] = [
  {
    id: 'ds_rainfall_records',
    title: 'Rainfall Dataset (HDFS)',
    description: 'Query sharded rainfall observations across Karnataka weather gauges',
    query:
      "SELECT district, station_or_area, observation_date, metric_primary AS rainfall_mm, metric_secondary AS departure_pct, status_note, block_id FROM aqua_dataset_files WHERE category = 'Rainfall data' ORDER BY rainfall_mm DESC LIMIT 20",
  },
  {
    id: 'ds_groundwater_records',
    title: 'Groundwater Dataset (HDFS)',
    description: 'Query aquifer water-table depth & recharge index from DataNode blocks',
    query:
      "SELECT district, station_or_area, observation_date, metric_primary AS depth_m_bgl, metric_secondary AS recharge_pct, status_note, block_id FROM aqua_dataset_files WHERE category = 'Groundwater data' ORDER BY depth_m_bgl DESC LIMIT 20",
  },
  {
    id: 'ds_consumption_rollup',
    title: 'Consumption by District',
    description: 'Aggregate sharded water consumption datasets by district',
    query:
      'SELECT district, COUNT(*) AS areas, SUM(water_consumed) AS total_consumed_l, SUM(water_demand - water_supply) AS shortage_l FROM aqua_water_records GROUP BY district ORDER BY shortage_l DESC LIMIT 25',
  },
  {
    id: 'ds_reservoir_summary',
    title: 'Reservoir Storage Snapshot',
    description: 'Retrieve reservoir capacity & current percentage full from HDFS blocks',
    query:
      'SELECT reservoir_name, district, gross_capacity AS capacity_tmc, live_capacity AS available_tmc, percentage_full, block_id FROM aqua_reservoirs ORDER BY percentage_full ASC LIMIT 20',
  },
];

export const MAPREDUCE_HIVE_PRESETS: HivePreset[] = [
  {
    id: 'mr_processed_output',
    title: 'Latest MapReduce Output',
    description: 'Query processed output emitted by the latest MapReduce Reducer stage',
    query:
      'SELECT * FROM aqua_mapreduce_results LIMIT 20',
  },
  {
    id: 'mr_district_shortage',
    title: 'Processed District Deficits',
    description: 'Aggregate water demand, supply, and deficit across districts via HiveQL',
    query:
      'SELECT district, COUNT(*) AS area_records, SUM(water_demand) AS total_demand, SUM(water_supply) AS total_supply, SUM(water_demand - water_supply) AS shortage FROM aqua_water_records GROUP BY district ORDER BY shortage DESC LIMIT 20',
  },
  {
    id: 'mr_area_consumption',
    title: 'Area Consumption (HiveQL)',
    description: 'Cross-check processed area consumption and shortage across HDFS shards',
    query:
      'SELECT area, district, SUM(water_consumed) AS consumed_l, SUM(water_demand - water_supply) AS shortage_l FROM aqua_water_records GROUP BY area, district ORDER BY shortage_l DESC LIMIT 20',
  },
  {
    id: 'mr_reservoir_levels',
    title: 'Processed Reservoir Summary',
    description: 'Query average reservoir fill percentages from HDFS shards',
    query:
      'SELECT reservoir_name, district, AVG(percentage_full) AS avg_fill_pct, AVG(inflow) AS avg_inflow FROM aqua_reservoirs GROUP BY reservoir_name, district ORDER BY avg_fill_pct ASC LIMIT 15',
  },
];

export const MAINTENANCE_HIVE_PRESETS: HivePreset[] = [
  {
    id: 'mnt_all_tasks',
    title: 'Active Maintenance Work Orders',
    description: 'Retrieve water infrastructure maintenance orders with asset, priority, and water saved',
    query:
      'SELECT task_code, district, area, asset_type, maintenance_type, priority, status, water_saved_lpd, telemetry_source FROM aqua_maintenance_tasks ORDER BY water_saved_lpd DESC LIMIT 25',
  },
  {
    id: 'mnt_by_category',
    title: 'Cost & Water Saved by Category',
    description: 'Aggregate maintenance work orders by category across HDFS blocks',
    query:
      'SELECT maintenance_type, COUNT(*) AS work_orders, SUM(water_saved_lpd) AS total_water_saved_lpd, SUM(estimated_cost_inr) AS total_cost_inr FROM aqua_maintenance_tasks GROUP BY maintenance_type ORDER BY total_water_saved_lpd DESC LIMIT 15',
  },
  {
    id: 'mnt_critical_open',
    title: 'Open Critical & High Priority',
    description: 'Filter scheduled or in-progress critical maintenance tasks',
    query:
      "SELECT task_code, district, asset_name, priority, status, assigned_crew, scheduled_date, block_id FROM aqua_maintenance_tasks WHERE status != 'Completed' ORDER BY water_saved_lpd DESC LIMIT 20",
  },
  {
    id: 'mnt_by_district',
    title: 'District Maintenance Backlog',
    description: 'Group maintenance tasks by Karnataka district and compute water saved',
    query:
      'SELECT district, COUNT(*) AS tasks, SUM(water_saved_lpd) AS water_saved_lpd, SUM(estimated_cost_inr) AS budget_inr FROM aqua_maintenance_tasks GROUP BY district ORDER BY water_saved_lpd DESC LIMIT 25',
  },
];

type EnrichedRow = Record<string, unknown>;

function getFieldValue(row: EnrichedRow, expr: string): unknown {
  const clean = expr.trim();
  const lower = clean.toLowerCase();

  if (lower === 'water_demand - water_supply' || lower === '(water_demand - water_supply)') {
    return row.shortage;
  }
  if (lower === 'shortage' || lower === 'shortage_l') {
    return row.shortage;
  }
  if (lower === 'water_consumed' || lower === 'water_consumption_l') {
    return row.effective_consumed;
  }
  if (lower === 'coverage_pct') {
    return row.coverage_pct;
  }
  if (lower === 'capacity' || lower === 'capacity_tmc') {
    return row.gross_capacity ?? row.design_capacity;
  }
  if (lower === 'available_water' || lower === 'available_tmc') {
    return row.live_capacity;
  }
  if (lower === 'current_level' || lower === 'current_level_pct') {
    return row.percentage_full;
  }
  if (clean in row) {
    return row[clean];
  }
  return undefined;
}

function evaluateWhereClause(row: EnrichedRow, whereStr: string): boolean {
  const clauses = whereStr
    .split(/\s+AND\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    // LIKE
    const likeMatch = clause.match(/^([a-zA-Z0-9_]+)\s+LIKE\s+['"](.+?)['"]$/i);
    if (likeMatch) {
      const val = String(getFieldValue(row, likeMatch[1]) ?? '').toLowerCase();
      const pattern = likeMatch[2].toLowerCase().replace(/%/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      if (!regex.test(val)) return false;
      continue;
    }

    // Comparison: col op val (where val can be column, number, or quoted string)
    const cmpMatch = clause.match(
      /^([a-zA-Z0-9_]+)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/
    );
    if (!cmpMatch) continue;

    const leftRaw = getFieldValue(row, cmpMatch[1]);
    const op = cmpMatch[2];
    const rightToken = cmpMatch[3].trim();

    let rightRaw: unknown;
    if (
      (rightToken.startsWith("'") && rightToken.endsWith("'")) ||
      (rightToken.startsWith('"') && rightToken.endsWith('"'))
    ) {
      rightRaw = rightToken.slice(1, -1);
    } else if (!Number.isNaN(Number(rightToken))) {
      rightRaw = Number(rightToken);
    } else {
      rightRaw = getFieldValue(row, rightToken);
    }

    const leftNum = typeof leftRaw === 'number' ? leftRaw : Number(leftRaw);
    const rightNum = typeof rightRaw === 'number' ? rightRaw : Number(rightRaw);
    const bothNumeric =
      leftRaw !== null &&
      leftRaw !== undefined &&
      rightRaw !== null &&
      rightRaw !== undefined &&
      Number.isFinite(leftNum) &&
      Number.isFinite(rightNum) &&
      typeof leftRaw !== 'string' &&
      typeof rightRaw !== 'string';

    if (bothNumeric) {
      if (op === '=' && leftNum !== rightNum) return false;
      if ((op === '!=' || op === '<>') && leftNum === rightNum) return false;
      if (op === '>' && !(leftNum > rightNum)) return false;
      if (op === '<' && !(leftNum < rightNum)) return false;
      if (op === '>=' && !(leftNum >= rightNum)) return false;
      if (op === '<=' && !(leftNum <= rightNum)) return false;
    } else {
      const ls = String(leftRaw ?? '').toLowerCase();
      const rs = String(rightRaw ?? '').toLowerCase();
      if (op === '=' && ls !== rs) return false;
      if ((op === '!=' || op === '<>') && ls === rs) return false;
      if (op === '>' && !(ls > rs)) return false;
      if (op === '<' && !(ls < rs)) return false;
      if (op === '>=' && !(ls >= rs)) return false;
      if (op === '<=' && !(ls <= rs)) return false;
    }
  }

  return true;
}

interface SelectField {
  rawExpr: string;
  alias: string;
  aggFn: 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN' | null;
  innerExpr: string;
}

function parseSelectList(selectPart: string): SelectField[] {
  const parts = selectPart.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.map((part) => {
    const asMatch = part.match(/^(.+?)\s+AS\s+([a-zA-Z0-9_]+)$/i);
    const rawExpr = asMatch ? asMatch[1].trim() : part.trim();
    const explicitAlias = asMatch ? asMatch[2].trim() : null;

    const aggMatch = rawExpr.match(/^(SUM|AVG|COUNT|MAX|MIN)\((.+)\)$/i);
    if (aggMatch) {
      const aggFn = aggMatch[1].toUpperCase() as 'SUM' | 'AVG' | 'COUNT' | 'MAX' | 'MIN';
      const innerExpr = aggMatch[2].trim();
      const defaultAlias = `${aggFn.toLowerCase()}_${innerExpr.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      return {
        rawExpr,
        alias: explicitAlias || defaultAlias,
        aggFn,
        innerExpr,
      };
    }

    const cleanAlias =
      explicitAlias ||
      rawExpr.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_|_$/g, '');
    return {
      rawExpr,
      alias: cleanAlias,
      aggFn: null,
      innerExpr: rawExpr,
    };
  });
}

export function executeHiveQuery(rawQuery: string): HiveQueryResult {
  const t0 = performance.now();
  const normalizedQuery = rawQuery.trim().replace(/;+$/, '').replace(/\s+/g, ' ');

  const match = normalizedQuery.match(
    /^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+(.+?))?(?:\s+GROUP\s+BY\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i
  );

  if (!match) {
    return {
      success: false,
      engine: 'Apache HiveQL Engine (HDFS Block Metastore)',
      table: 'aqua_water_records',
      query: normalizedQuery,
      durationMs: Number((performance.now() - t0).toFixed(2)),
      hdfsBlocksScanned: 0,
      rowsScanned: 0,
      rowsReturned: 0,
      executionStages: [],
      columns: [],
      rows: [],
      error:
        'Invalid HiveQL syntax. Expected: SELECT <cols> FROM aqua_water_records [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT n]',
    };
  }

  const [, selectPart, tableName, wherePart, groupByPart, orderByPart, limitPart] = match;

  const normalizedTable = tableName.toLowerCase();
  if (
    normalizedTable !== 'aqua_water_records' &&
    normalizedTable !== 'aqua_reservoirs' &&
    normalizedTable !== 'aqua_emergency_requests' &&
    normalizedTable !== 'aqua_dataset_files' &&
    normalizedTable !== 'aqua_mapreduce_results' &&
    normalizedTable !== 'aqua_maintenance_tasks'
  ) {
    return {
      success: false,
      engine: 'Apache HiveQL Engine (HDFS Block Metastore)',
      table: tableName,
      query: normalizedQuery,
      durationMs: Number((performance.now() - t0).toFixed(2)),
      hdfsBlocksScanned: 0,
      rowsScanned: 0,
      rowsReturned: 0,
      executionStages: [],
      columns: [],
      rows: [],
      error: `Unknown Hive table "${tableName}". Available HDFS tables: aqua_water_records, aqua_reservoirs, aqua_emergency_requests, aqua_dataset_files, aqua_maintenance_tasks, aqua_mapreduce_results`,
    };
  }

  const isReservoirTable = normalizedTable === 'aqua_reservoirs';
  const isEmergencyTable = normalizedTable === 'aqua_emergency_requests';
  const isDatasetFilesTable = normalizedTable === 'aqua_dataset_files';
  const isMapReduceResultsTable = normalizedTable === 'aqua_mapreduce_results';
  const isMaintenanceTable = normalizedTable === 'aqua_maintenance_tasks';
  const blocks = distributedStore.getBlocks(
    isMaintenanceTable
      ? 'maintenance_tasks'
      : isDatasetFilesTable
      ? 'dataset_files'
      : isEmergencyTable
      ? 'emergency_requests'
      : isReservoirTable
      ? 'reservoirs'
      : 'water_records'
  );

  const enriched: EnrichedRow[] = isMapReduceResultsTable
    ? getLatestProcessedResults()
    : isMaintenanceTable
    ? distributedStore
        .readAllRecordsWithBlocks<MaintenanceTaskEntity>('maintenance_tasks')
        .map((r) => ({ ...r }))
    : isDatasetFilesTable
    ? distributedStore.readAllRecordsWithBlocks<DatasetFileRecordEntity>('dataset_files')
    : isEmergencyTable
    ? distributedStore
        .readAllRecordsWithBlocks<EmergencyRequestEntity>('emergency_requests')
        .map((r) => ({
          ...r,
          emergency_type: r.emergency_type || 'No Water Supply',
          description: r.description || '',
        }))
    : isReservoirTable
    ? distributedStore
        .readAllRecordsWithBlocks<ReservoirEntity>('reservoirs')
        .map((r) => ({
          ...r,
          capacity: r.gross_capacity || r.design_capacity || 0,
          net_inflow: Math.round((r.inflow || 0) - (r.outflow || 0)),
        }))
    : distributedStore
        .readAllRecordsWithBlocks<WaterRecordEntity>('water_records')
        .map((r) => {
          const demand = r.water_demand || 0;
          const supply = r.water_supply || 0;
          const shortage = Math.max(demand - supply, 0);
          const coveragePct =
            demand > 0 ? Number(((supply / demand) * 100).toFixed(1)) : 100;
          const effectiveConsumed =
            r.water_consumed !== null && r.water_consumed !== undefined
              ? r.water_consumed
              : Math.round(supply * 0.92);
          return {
            ...r,
            shortage,
            coverage_pct: coveragePct,
            effective_consumed: effectiveConsumed,
          };
        });

  const filtered = wherePart
    ? enriched.filter((row) => evaluateWhereClause(row, wherePart))
    : enriched;

  let selectFields: SelectField[];
  if (selectPart.trim() === '*') {
    const defaultCols = isMapReduceResultsTable
      ? enriched.length > 0
        ? Object.keys(enriched[0]).filter((k) => !Array.isArray(enriched[0][k]))
        : ['_job_id', '_job_type', '_runtime']
      : isDatasetFilesTable
      ? [
          'id',
          'dataset_filename',
          'category',
          'district',
          'station_or_area',
          'observation_date',
          'metric_primary',
          'metric_secondary',
          'unit',
          'status_note',
          'block_id',
        ]
      : isMaintenanceTable
      ? [
          'id',
          'task_code',
          'district',
          'area',
          'asset_name',
          'maintenance_type',
          'priority',
          'status',
          'water_saved_lpd',
          'estimated_cost_inr',
          'block_id',
        ]
      : isEmergencyTable
      ? [
          'id',
          'district',
          'area',
          'emergency_type',
          'priority',
          'status',
          'required_quantity',
          'created_at',
          'block_id',
        ]
      : isReservoirTable
      ? [
          'id',
          'reservoir_name',
          'district',
          'monitoring_date',
          'gross_capacity',
          'live_capacity',
          'percentage_full',
          'reservoir_level',
          'inflow',
          'outflow',
          'block_id',
        ]
      : [
          'id',
          'district',
          'area',
          'water_demand',
          'water_supply',
          'water_consumed',
          'shortage',
          'water_quality',
          'block_id',
        ];
    selectFields = defaultCols.map((c) => ({
      rawExpr: c,
      alias: c,
      aggFn: null,
      innerExpr: c,
    }));
  } else {
    selectFields = parseSelectList(selectPart);
  }

  const hasAgg = selectFields.some((f) => f.aggFn !== null);
  let outputRows: Record<string, unknown>[] = [];

  if (groupByPart || hasAgg) {
    const groupCols = groupByPart
      ? groupByPart.split(',').map((c) => c.trim()).filter(Boolean)
      : [];

    const groups = new Map<string, EnrichedRow[]>();
    for (const row of filtered) {
      const key = groupCols.length
        ? groupCols.map((c) => String(getFieldValue(row, c) ?? '')).join('::')
        : '__ALL__';
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }

    for (const bucket of groups.values()) {
      const first = bucket[0];
      const out: Record<string, unknown> = {};
      for (const field of selectFields) {
        if (!field.aggFn) {
          out[field.alias] = getFieldValue(first, field.innerExpr) ?? null;
        } else if (field.aggFn === 'COUNT') {
          out[field.alias] = bucket.length;
        } else {
          const nums = bucket.map((r) => Number(getFieldValue(r, field.innerExpr) ?? 0));
          if (field.aggFn === 'SUM') {
            out[field.alias] = Math.round(nums.reduce((s, n) => s + n, 0));
          } else if (field.aggFn === 'AVG') {
            out[field.alias] = nums.length
              ? Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1))
              : 0;
          } else if (field.aggFn === 'MAX') {
            out[field.alias] = nums.length ? Math.max(...nums) : 0;
          } else if (field.aggFn === 'MIN') {
            out[field.alias] = nums.length ? Math.min(...nums) : 0;
          }
        }
      }
      outputRows.push(out);
    }
  } else {
    outputRows = filtered.map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of selectFields) {
        out[field.alias] = getFieldValue(row, field.innerExpr) ?? null;
      }
      return out;
    });
  }

  if (orderByPart) {
    const orderMatch = orderByPart.trim().match(/^([a-zA-Z0-9_]+)(?:\s+(ASC|DESC))?$/i);
    if (orderMatch) {
      const orderCol = orderMatch[1];
      const desc = (orderMatch[2] || 'ASC').toUpperCase() === 'DESC';
      outputRows.sort((a, b) => {
        const av = a[orderCol];
        const bv = b[orderCol];
        if (typeof av === 'number' && typeof bv === 'number') {
          return desc ? bv - av : av - bv;
        }
        return desc
          ? String(bv ?? '').localeCompare(String(av ?? ''))
          : String(av ?? '').localeCompare(String(bv ?? ''));
      });
    }
  }

  const limit = limitPart ? Math.max(1, Math.min(200, Number(limitPart))) : 50;
  outputRows = outputRows.slice(0, limit);

  return {
    success: true,
    engine: 'Apache HiveQL Engine (HDFS Block Metastore)',
    table: normalizedTable,
    query: normalizedQuery,
    durationMs: Number((performance.now() - t0).toFixed(2)),
    hdfsBlocksScanned: blocks.length,
    rowsScanned: enriched.length,
    rowsReturned: outputRows.length,
    executionStages: [
      `HDFS Metastore Lookup (${blocks.length} blocks)`,
      wherePart ? `Map-Side Filter (${wherePart})` : 'Full HDFS Partition Scan',
      groupByPart ? `Hive GroupBy (${groupByPart})` : 'Row Projection',
      orderByPart ? `Distributed Sort (${orderByPart})` : 'Result Output',
    ],
    columns: selectFields.map((f) => f.alias),
    rows: outputRows,
  };
}
