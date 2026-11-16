import 'dotenv/config';
import { execFile, spawn } from 'child_process';
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { promisify } from 'util';
import * as XLSX from 'xlsx';

const execFileAsync = promisify(execFile);
import {
  DatasetCategory,
  DatasetFileRecordEntity,
  distributedStore,
  EmergencyRequestEntity,
  KARNATAKA_DISTRICTS,
  MaintenanceTaskEntity,
  ReservoirEntity,
  StorageCollection,
  TransportDeliveryEntity,
  UPLOAD_DIR,
  WaterRecordEntity,
} from './server/distributedStore';
import {
  getMapReduceJobHistory,
  getYarnClusterStatus,
  MapReduceJobType,
  runWaterMapReduceJob,
  runWaterMapReduceJobWithPython,
} from './server/mapreduce';
import {
  analyzeSkewAndBloom,
  ingestSyntheticBatch,
  runDistributedDataProfiler,
  runInvertedIndexQuery,
} from './server/bigdata';
import {
  DATASET_HIVE_PRESETS,
  EMERGENCY_HIVE_PRESETS,
  executeHiveQuery,
  HIVE_PRESETS,
  MAINTENANCE_HIVE_PRESETS,
  MAPREDUCE_HIVE_PRESETS,
  RESERVOIR_HIVE_PRESETS,
} from './server/hive';
import {
  extractLatestNwdpReservoirs,
  getAllPublicWaterData,
  getLiveWeatherData,
  GOVERNMENT_DATASETS,
  NWDP_WEBSITE,
  PUBLIC_CACHE_SECONDS,
} from './server/liveFeeds';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '10mb' }));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});

function safeFloat(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeNullableFloat(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getLatestDistrictSnapshot(records: WaterRecordEntity[]): WaterRecordEntity[] {
  const latest = new Map<string, WaterRecordEntity>();
  for (const rec of records) {
    const district = (rec.district || 'Unknown').trim();
    const area = (rec.area || district).trim();
    const key = `${district.toLowerCase()}::${area.toLowerCase()}`;
    const existing = latest.get(key);
    const currDate = rec.recorded_at || rec.uploaded_at || '';
    const prevDate = existing ? existing.recorded_at || existing.uploaded_at || '' : '';
    if (
      !existing ||
      currDate > prevDate ||
      (currDate === prevDate && rec.id > existing.id)
    ) {
      latest.set(key, rec);
    }
  }
  return Array.from(latest.values());
}

// ==========================================================
// HEALTH & CLUSTER STORAGE ENDPOINTS
// ==========================================================

app.get('/api/health', (_req: Request, res: Response) => {
  const cluster = distributedStore.getClusterStatus();
  res.json({
    status: 'running',
    application: 'AquaAI',
    storage: 'Distributed Shard Store',
    healthyNodes: cluster.healthyNodes,
    totalNodes: cluster.totalNodes,
    totalBlocks: cluster.totalBlocks,
  });
});

app.get('/api/cluster/status', (_req: Request, res: Response) => {
  res.json(distributedStore.getClusterStatus());
});

app.post('/api/cluster/nodes/:nodeId/toggle', (req: Request, res: Response) => {
  const nodeId = String(req.params.nodeId);
  const updated = distributedStore.toggleNodeStatus(nodeId);
  if (!updated) {
    res.status(404).json({ success: false, message: 'Storage node not found' });
    return;
  }
  res.json({
    success: true,
    node: updated,
    cluster: distributedStore.getClusterStatus(),
  });
});

app.post('/api/cluster/rebalance', (req: Request, res: Response) => {
  const { replicationFactor, blockSizeRecords } = req.body || {};
  const status = distributedStore.rebalanceCluster(
    replicationFactor ? Number(replicationFactor) : undefined,
    blockSizeRecords ? Number(blockSizeRecords) : undefined
  );
  res.json({ success: true, cluster: status });
});

app.get('/api/cluster/blocks/:blockId', (req: Request, res: Response) => {
  const blockId = String(req.params.blockId);
  const inspected = distributedStore.inspectBlock(blockId);
  if (!inspected) {
    res.status(404).json({ success: false, message: 'Block not found' });
    return;
  }
  res.json({ success: true, ...inspected });
});

// ==========================================================
// MAPREDUCE ENGINE ENDPOINTS
// ==========================================================

app.post('/api/mapreduce/run', async (req: Request, res: Response) => {
  const {
    jobType = 'district_water_balance',
    district,
    search,
    minShortage,
    quality,
    period,
    numReducers,
    engine = 'python',
  } = req.body || {};

  const validTypes: MapReduceJobType[] = [
    'district_water_balance',
    'area_consumption_rollup',
    'shortage_hotspots',
    'usage_period_rollup',
    'distributed_retrieval',
    'basin_reservoir_summary',
    'reservoir_level_avg',
    'emergency_area_summary',
    'transport_delivery_summary',
    'maintenance_priority_summary',
  ];

  if (!validTypes.includes(jobType)) {
    res.status(400).json({ success: false, message: 'Unsupported MapReduce job type' });
    return;
  }

  try {
    const trace = await runWaterMapReduceJobWithPython({
      jobType,
      district,
      search,
      minShortage: minShortage !== undefined ? Number(minShortage) : undefined,
      quality,
      period,
      numReducers: numReducers !== undefined ? Number(numReducers) : 4,
      engine: engine === 'native' ? 'native' : 'python',
    });

    res.json({ success: true, job: trace });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'MapReduce execution failed',
    });
  }
});

app.get('/api/mapreduce/jobs', (_req: Request, res: Response) => {
  res.json({
    success: true,
    jobs: getMapReduceJobHistory(),
    yarn: getYarnClusterStatus(),
  });
});

app.get('/api/yarn/status', (_req: Request, res: Response) => {
  res.json({ success: true, ...getYarnClusterStatus() });
});

app.get('/api/mapreduce/worker-source', (_req: Request, res: Response) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'mr_worker.py');
    const source = fs.readFileSync(scriptPath, 'utf-8');
    res.json({
      success: true,
      language: 'Python 3',
      file: 'server/mr_worker.py',
      source,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Unable to read worker source',
    });
  }
});

// ==========================================================
// BIG DATA ENGINEERING TOOLS
// ==========================================================

app.get('/api/bigdata/profile', (_req: Request, res: Response) => {
  res.json({ success: true, report: runDistributedDataProfiler() });
});

app.get('/api/python-analysis', async (_req: Request, res: Response) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'analyze_water.py');
    const { stdout } = await execFileAsync('python3', [scriptPath], {
      timeout: 10000,
    });
    const parsed = JSON.parse(stdout);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Python analysis failed',
    });
  }
});

app.get('/api/forecast/shortage', async (req: Request, res: Response) => {
  try {
    const district = String(req.query.district || 'all').trim() || 'all';
    const scriptPath = path.resolve(process.cwd(), 'server', 'forecast_shortage.py');
    const { stdout } = await execFileAsync(
      'python3',
      [scriptPath, '--district', district],
      { timeout: 10000 }
    );
    const parsed = JSON.parse(stdout);
    res.json(parsed);
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Python shortage forecast failed',
    });
  }
});

app.get('/api/bigdata/inverted-index', (req: Request, res: Response) => {
  const query = String(req.query.q || 'shortage');
  res.json({ success: true, index: runInvertedIndexQuery(query) });
});

app.get('/api/bigdata/skew-bloom', (req: Request, res: Response) => {
  const partitions = req.query.partitions ? Number(req.query.partitions) : 4;
  const district = String(req.query.district || 'Bengaluru Urban');
  res.json({ success: true, analysis: analyzeSkewAndBloom(partitions, district) });
});

app.post('/api/bigdata/ingest-batch', (req: Request, res: Response) => {
  const count = req.body?.count ? Number(req.body.count) : 12;
  const result = ingestSyntheticBatch(count);
  res.json({ success: true, ...result });
});

// ==========================================================
// WATER DATA & SUMMARY (BACKED BY DISTRIBUTED STORE + MAPREDUCE)
// ==========================================================

app.get('/api/hive/presets', (req: Request, res: Response) => {
  const table = String(req.query.table || '').toLowerCase();
  res.json({
    success: true,
    presets:
      table === 'reservoirs'
        ? RESERVOIR_HIVE_PRESETS
        : table === 'emergency'
        ? EMERGENCY_HIVE_PRESETS
        : table === 'datasets'
        ? DATASET_HIVE_PRESETS
        : table === 'mapreduce'
        ? MAPREDUCE_HIVE_PRESETS
        : table === 'maintenance'
        ? MAINTENANCE_HIVE_PRESETS
        : HIVE_PRESETS,
  });
});

app.post('/api/hive/query', (req: Request, res: Response) => {
  const query = String(req.body?.query || '');
  if (!query.trim()) {
    res.status(400).json({ success: false, error: 'HiveQL query is required' });
    return;
  }
  const result = executeHiveQuery(query);
  res.status(result.success ? 200 : 400).json(result);
});

app.get(['/api/water-data', '/api/water-records'], (_req: Request, res: Response) => {
  const records = distributedStore
    .readAllRecordsWithBlocks<WaterRecordEntity>('water_records')
    .sort((a, b) => {
      const da = a.recorded_at || a.uploaded_at || '';
      const db = b.recorded_at || b.uploaded_at || '';
      if (db !== da) return db.localeCompare(da);
      return b.id - a.id;
    });

  const mapped = records.map((row) => ({
    ...row,
    demand: safeFloat(row.water_demand),
    availability: safeFloat(row.water_supply),
  }));

  res.json(mapped);
});

app.post('/api/water-records', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.district || !body.area) {
    res.status(400).json({ success: false, message: 'District and area are required' });
    return;
  }

  const now = new Date().toISOString();
  const id = distributedStore.allocateIds('water_records', 1)[0];
  const record: WaterRecordEntity = {
    id,
    district: String(body.district).trim(),
    area: String(body.area).trim(),
    water_demand: safeFloat(body.water_demand),
    water_supply: safeFloat(body.water_supply),
    water_consumed: safeNullableFloat(body.water_consumed),
    water_level: safeFloat(body.water_level),
    water_quality: String(body.water_quality || 'Good'),
    recorded_at: body.recorded_at ? String(body.recorded_at) : now,
    uploaded_at: now,
    source_filename: 'manual_entry',
  };

  const blocks = distributedStore.appendRecordsToCollection('water_records', [record]);
  res.json({ success: true, record, blockId: blocks[0]?.blockId });
});

app.delete('/api/water-records/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const removed = distributedStore.deleteWaterRecord(id);
  if (!removed) {
    res.status(404).json({ success: false, message: 'Record not found' });
    return;
  }
  res.json({ success: true });
});

app.get('/api/summary', (_req: Request, res: Response) => {
  const mrTrace = runWaterMapReduceJob({
    jobType: 'district_water_balance',
    numReducers: 4,
  });

  const allRecords = distributedStore.readAllRecords<WaterRecordEntity>('water_records');
  const latest = getLatestDistrictSnapshot(allRecords);

  const totalDemand = latest.reduce((s, r) => s + safeFloat(r.water_demand), 0);
  const totalSupply = latest.reduce((s, r) => s + safeFloat(r.water_supply), 0);
  const totalShortage = latest.reduce(
    (s, r) => s + Math.max(safeFloat(r.water_demand) - safeFloat(r.water_supply), 0),
    0
  );
  const consumedValues = latest
    .map((r) => r.water_consumed)
    .filter((v): v is number => v !== null && v !== undefined);

  res.json({
    total_areas: latest.length,
    total_demand: Math.round(totalDemand * 100) / 100,
    total_supply: Math.round(totalSupply * 100) / 100,
    shortage: Math.round(totalShortage * 100) / 100,
    total_consumed: consumedValues.length
      ? Math.round(consumedValues.reduce((s, v) => s + v, 0) * 100) / 100
      : null,
    consumption_data_available: consumedValues.length > 0,
    supply_percentage:
      totalDemand > 0 ? Math.round((totalSupply / totalDemand) * 10000) / 100 : 0,
    computed_via: mrTrace.jobId,
    job_duration_ms: mrTrace.durationMs,
  });
});

app.get('/api/karnataka-districts', (_req: Request, res: Response) => {
  const records = distributedStore.readAllRecords<WaterRecordEntity>('water_records');
  const counts = new Map<string, number>();
  for (const rec of records) {
    if (!rec.district) continue;
    const key = rec.district.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  res.json(
    KARNATAKA_DISTRICTS.map((district) => {
      const count = counts.get(district.toLowerCase()) || 0;
      return {
        district,
        has_measurements: count > 0,
        record_count: count,
        data_status:
          count > 0 ? 'Uploaded measurements available' : 'No measurements uploaded',
      };
    })
  );
});

// ==========================================================
// DATASET UPLOAD & SHARDING INTO DISTRIBUTED BLOCKS
// ==========================================================

app.post(
  '/api/upload-water-data',
  upload.single('file'),
  (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ success: false, message: 'Please select a file' });
      return;
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      fs.unlinkSync(file.path);
      res.status(400).json({
        success: false,
        message: 'Only CSV, XLSX and XLS files are supported',
      });
      return;
    }

    try {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });

      if (!rawRows.length) {
        res.status(400).json({
          success: false,
          message: 'The uploaded file contains no rows.',
        });
        return;
      }

      const normalizedRows = rawRows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          const nk = k.trim().toLowerCase().replace(/[\s-]+/g, '_');
          out[nk] = v;
        }
        return out;
      });

      const columns = Object.keys(normalizedRows[0]);
      const findCol = (candidates: string[]) =>
        candidates.find((c) => columns.includes(c)) || null;

      const districtCol = findCol(['district', 'district_name']);
      const areaCol = findCol(['area', 'village', 'location', 'city']);
      const demandCol = findCol([
        'water_demand',
        'demand',
        'demand_litres',
        'demand_liters',
      ]);
      const supplyCol = findCol([
        'water_supply',
        'supply',
        'supply_litres',
        'supply_liters',
        'availability',
        'available_water',
        'water_available',
      ]);
      const consumptionCol = findCol([
        'water_consumed',
        'consumption',
        'water_used',
        'used_water',
        'consumed_litres',
      ]);
      const levelCol = findCol([
        'water_level',
        'level',
        'water_level_percentage',
      ]);
      const qualityCol = findCol(['water_quality', 'quality']);
      const dateCol = findCol([
        'recorded_at',
        'observation_date',
        'date',
        'monitoring_date',
      ]);

      const requestedCategory = String(
        req.body?.category || 'Water consumption data'
      ) as DatasetCategory;
      const validCategories: DatasetCategory[] = [
        'Rainfall data',
        'Water consumption data',
        'Groundwater data',
        'Reservoir data',
        'Water distribution data',
      ];
      const category: DatasetCategory = validCategories.includes(requestedCategory)
        ? requestedCategory
        : 'Water consumption data';

      const uploadTime = new Date().toISOString();
      const datasetId = distributedStore.allocateIds('uploaded_datasets', 1)[0];

      // If it contains water consumption columns (district + demand/supply), shard into water_records;
      // otherwise shard into dataset_files so Rainfall, Groundwater, Reservoir, or Distribution CSVs ingest cleanly!
      if (districtCol && (demandCol || supplyCol) && category === 'Water consumption data') {
        const validRows = normalizedRows.filter(
          (r) => r[districtCol] !== null && String(r[districtCol]).trim() !== ''
        );
        const ids = distributedStore.allocateIds('water_records', validRows.length);

        const newRecords: WaterRecordEntity[] = validRows.map((row, idx) => {
          const district = String(row[districtCol]).trim();
          const area =
            areaCol && row[areaCol] ? String(row[areaCol]).trim() : district;

          let recordedAt = uploadTime;
          if (dateCol && row[dateCol]) {
            const parsed = new Date(String(row[dateCol]));
            if (!Number.isNaN(parsed.getTime())) {
              recordedAt = parsed.toISOString();
            }
          }

          return {
            id: ids[idx],
            district,
            area,
            water_demand: demandCol ? safeFloat(row[demandCol]) : 0,
            water_supply: supplyCol ? safeFloat(row[supplyCol]) : 0,
            water_consumed: consumptionCol
              ? safeNullableFloat(row[consumptionCol])
              : null,
            water_level: levelCol ? safeFloat(row[levelCol]) : 0,
            water_quality:
              qualityCol && row[qualityCol]
                ? String(row[qualityCol])
                : 'Not recorded',
            recorded_at: recordedAt,
            uploaded_at: uploadTime,
            source_filename: file.originalname,
          };
        });

        const createdBlocks = distributedStore.appendRecordsToCollection(
          'water_records',
          newRecords
        );
        const existingDatasets = distributedStore.getUploadedDatasets();
        existingDatasets.unshift({
          id: datasetId,
          filename: file.originalname,
          filepath: file.path,
          category,
          uploaded_at: uploadTime,
          row_count: newRecords.length,
          collection_ref: 'water_records',
          block_ids: createdBlocks.map((b) => b.blockId),
        });
        distributedStore.saveUploadedDatasets(existingDatasets);

        res.json({
          success: true,
          dataset_id: datasetId,
          filename: file.originalname,
          category,
          rows: normalizedRows.length,
          water_records_imported: newRecords.length,
          blocks_created: createdBlocks.length,
          block_ids: createdBlocks.map((b) => b.blockId),
          columns,
          message: 'Water dataset imported and sharded across Hadoop DataNodes',
        });
        return;
      }

      // Generic dataset file ingestion across any category into HDFS dataset_files shards
      const dsIds = distributedStore.allocateIds('dataset_files', normalizedRows.length);
      const genericRecords: DatasetFileRecordEntity[] = normalizedRows.map((row, idx) => {
        const numericKeys = columns.filter(
          (c) => row[c] !== null && row[c] !== '' && Number.isFinite(Number(row[c]))
        );
        const pKey = numericKeys[0];
        const sKey = numericKeys[1];
        return {
          ...row,
          id: dsIds[idx],
          dataset_id: datasetId,
          dataset_filename: file.originalname,
          category,
          district: districtCol && row[districtCol] ? String(row[districtCol]).trim() : 'Karnataka',
          station_or_area:
            areaCol && row[areaCol]
              ? String(row[areaCol]).trim()
              : String(row[columns[0]] || `Station-${idx + 1}`),
          observation_date:
            dateCol && row[dateCol]
              ? String(row[dateCol]).slice(0, 10)
              : uploadTime.slice(0, 10),
          metric_primary: pKey ? safeFloat(row[pKey]) : 0,
          metric_secondary: sKey ? safeFloat(row[sKey]) : 0,
          unit:
            category === 'Rainfall data'
              ? 'mm'
              : category === 'Groundwater data'
              ? 'm bgl'
              : 'L',
          status_note: String(row.status || row.status_note || row.quality || 'Ingested'),
        };
      });

      const createdBlocks = distributedStore.appendRecordsToCollection(
        'dataset_files',
        genericRecords
      );
      const existingDatasets = distributedStore.getUploadedDatasets();
      existingDatasets.unshift({
        id: datasetId,
        filename: file.originalname,
        filepath: file.path,
        category,
        uploaded_at: uploadTime,
        row_count: genericRecords.length,
        collection_ref: 'dataset_files' as StorageCollection,
        block_ids: createdBlocks.map((b) => b.blockId),
      });
      distributedStore.saveUploadedDatasets(existingDatasets);

      res.json({
        success: true,
        dataset_id: datasetId,
        filename: file.originalname,
        category,
        rows: normalizedRows.length,
        water_records_imported: genericRecords.length,
        blocks_created: createdBlocks.length,
        block_ids: createdBlocks.map((b) => b.blockId),
        columns,
        message: `${category} dataset imported and sharded across Hadoop DataNodes`,
      });
    } catch (err) {
      res.status(400).json({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to parse file',
      });
    }
  }
);

app.get(['/api/datasets', '/api/upload-history'], (_req: Request, res: Response) => {
  res.json(distributedStore.getEnrichedUploadedDatasets());
});

app.get('/api/datasets/:id/download', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const found = distributedStore.getDatasetRecords(id);
  if (!found) {
    res.status(404).json({ success: false, message: 'Dataset not found' });
    return;
  }

  const { dataset, records } = found;
  const ignoreCols = new Set(['block_id', 'hdfs_node', 'dataset_id', 'dataset_filename']);
  const headers: string[] = [];
  for (const row of records) {
    for (const k of Object.keys(row)) {
      if (!ignoreCols.has(k) && !headers.includes(k)) {
        headers.push(k);
      }
    }
  }

  const escapeCsv = (val: unknown) => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(','),
    ...records.map((r) => headers.map((h) => escapeCsv(r[h])).join(',')),
  ];

  const downloadName = dataset.filename.endsWith('.csv')
    ? dataset.filename
    : `${dataset.filename.replace(/\.[^.]+$/, '')}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.send(lines.join('\n'));
});

app.get('/api/datasets/:id/storage', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const info = distributedStore.getDatasetStorageInfo(id);
  if (!info) {
    res.status(404).json({ success: false, message: 'Dataset not found' });
    return;
  }
  res.json(info);
});

app.get('/api/datasets/:id/preprocess', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const found = distributedStore.getDatasetRecords(id);
  if (!found) {
    res.status(404).json({ success: false, message: 'Dataset not found' });
    return;
  }

  const scriptPath = path.resolve(process.cwd(), 'server', 'preprocess_dataset.py');
  const child = spawn('python3', [scriptPath]);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('close', (code) => {
    if (code !== 0) {
      res.status(500).json({
        success: false,
        message: stderr || 'Python dataset preprocessing failed',
      });
      return;
    }
    try {
      res.json(JSON.parse(stdout));
    } catch {
      res.status(500).json({ success: false, message: 'Invalid output from Python preprocessor' });
    }
  });

  child.stdin.write(
    JSON.stringify({
      filename: found.dataset.filename,
      category: found.dataset.category,
      rows: found.records,
    })
  );
  child.stdin.end();
});

app.delete('/api/datasets/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const removed = distributedStore.deleteDataset(id);
  if (!removed) {
    res.status(404).json({ success: false, message: 'Dataset not found' });
    return;
  }
  res.json({ success: true, message: 'Dataset removed from NameNode & HDFS blocks' });
});

app.get('/api/datasets/:id/analysis', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const found = distributedStore.getDatasetRecords(id);
  if (!found) {
    res.status(404).json({ error: 'Dataset not found' });
    return;
  }

  const { dataset: ds, records: matching } = found;
  const demands = matching.map((r) => safeFloat(r.water_demand));
  const supplies = matching.map((r) => safeFloat(r.water_supply));
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  res.json({
    filename: ds.filename,
    rows: ds.row_count,
    blocks: ds.block_ids || [],
    columns: matching.length ? Object.keys(matching[0]).length : 0,
    missing_values: matching.filter((r) => r.water_consumed === null).length,
    column_names: matching.length ? Object.keys(matching[0]) : [],
    numeric_summary: {
      water_demand: {
        count: demands.length,
        mean: Math.round(avg(demands)),
        min: demands.length ? Math.min(...demands) : 0,
        max: demands.length ? Math.max(...demands) : 0,
      },
      water_supply: {
        count: supplies.length,
        mean: Math.round(avg(supplies)),
        min: supplies.length ? Math.min(...supplies) : 0,
        max: supplies.length ? Math.max(...supplies) : 0,
      },
    },
  });
});

// ==========================================================
// RESERVOIR MANAGEMENT
// ==========================================================

app.get('/api/reservoirs', (_req: Request, res: Response) => {
  const rows = distributedStore
    .readAllRecordsWithBlocks<ReservoirEntity>('reservoirs')
    .sort((a, b) => {
      if (b.monitoring_date !== a.monitoring_date) {
        return b.monitoring_date.localeCompare(a.monitoring_date);
      }
      return b.id - a.id;
    });
  res.json(rows);
});

app.post('/api/reservoirs', (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.reservoir_name) {
    res
      .status(400)
      .json({ success: false, message: 'Reservoir name is required' });
    return;
  }

  const id = distributedStore.allocateIds('reservoirs', 1)[0];
  const record: ReservoirEntity = {
    id,
    reservoir_name: String(body.reservoir_name),
    district: String(body.district || ''),
    river: String(body.river || ''),
    basin: String(body.basin || ''),
    monitoring_date: String(
      body.monitoring_date || new Date().toISOString().slice(0, 10)
    ),
    percentage_full: safeFloat(body.percentage_full),
    reservoir_level: safeFloat(body.reservoir_level),
    design_capacity: safeFloat(body.design_capacity),
    gross_capacity: safeFloat(body.gross_capacity),
    live_capacity: safeFloat(body.live_capacity),
    inflow: safeFloat(body.inflow),
    outflow: safeFloat(body.outflow),
    canal_withdrawal: safeFloat(body.canal_withdrawal),
    evaporation: safeFloat(body.evaporation),
  };

  distributedStore.appendRecordsToCollection('reservoirs', [record]);
  res.json({ success: true, message: 'Reservoir record saved to cluster', record });
});

// ==========================================================
// EMERGENCY WATER REQUESTS
// ==========================================================

async function syncEmergencySqlStore() {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'emergency_sql.py');
    await execFileAsync('python3', [scriptPath, 'sync'], { timeout: 8000 });
  } catch {
    // non-fatal if sqlite sync skipped
  }
}

app.get('/api/emergency-requests', (_req: Request, res: Response) => {
  const hdfsRows =
    distributedStore.readAllRecordsWithBlocks<EmergencyRequestEntity>(
      'emergency_requests'
    );
  if (hdfsRows.length > 0) {
    res.json(hdfsRows.sort((a, b) => b.id - a.id));
    return;
  }
  res.json(distributedStore.getEmergencyRequests());
});

app.get('/api/emergency-sql-summary', async (_req: Request, res: Response) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'emergency_sql.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, 'summary'], {
      timeout: 8000,
    });
    res.json(JSON.parse(stdout));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'SQL summary failed',
    });
  }
});

app.post('/api/emergency-request', async (req: Request, res: Response) => {
  const body = req.body || {};
  const required = [
    'district',
    'area',
    'required_quantity',
    'destination_location',
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      res.status(400).json({
        success: false,
        message: `${field.replace(/_/g, ' ')} is required`,
      });
      return;
    }
  }

  const qty = safeFloat(body.required_quantity, -1);
  if (qty <= 0) {
    res.status(400).json({
      success: false,
      message: 'Required quantity must be greater than zero',
    });
    return;
  }

  let createdAt = new Date().toISOString();
  if (body.created_at) {
    const parsedDate = new Date(String(body.created_at));
    if (!Number.isNaN(parsedDate.getTime())) {
      createdAt = parsedDate.toISOString();
    }
  }

  const id = distributedStore.allocateIds('emergency_requests', 1)[0];
  const items = distributedStore.getEmergencyRequests();
  const newItem: EmergencyRequestEntity = {
    id,
    district: String(body.district).trim(),
    area: String(body.area).trim(),
    emergency_type: String(body.emergency_type || 'No Water Supply').trim(),
    description: String(
      body.description ||
        `${String(body.emergency_type || 'Water supply issue')} reported at ${String(body.area).trim()}.`
    ).trim(),
    requester_name: String(body.requester_name || '').trim(),
    contact: String(body.contact || '').trim(),
    required_quantity: qty,
    priority: body.priority || 'Medium',
    source_location: String(body.source_location || '').trim(),
    destination_location: String(body.destination_location).trim(),
    status: 'Pending',
    created_at: createdAt,
  };

  items.unshift(newItem);
  distributedStore.saveEmergencyRequests(items);
  await syncEmergencySqlStore();

  res.json({
    success: true,
    request_id: id,
    record: newItem,
    message: 'Emergency request submitted and stored in SQL & HDFS shards',
  });
});

app.patch('/api/emergency-requests/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, tanker_id } = req.body || {};
  const allowed = [
    'Pending',
    'Approved',
    'Completed',
    'Requested',
    'Assigned',
    'In Transit',
    'Delivered',
    'Cancelled',
  ];
  if (status && !allowed.includes(status)) {
    res.status(400).json({ success: false, message: 'Invalid status' });
    return;
  }

  const items = distributedStore.getEmergencyRequests();
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  if (status) {
    items[idx].status = status;
    items[idx].updated_at = new Date().toISOString();
    if (
      (status === 'Approved' || status === 'Assigned') &&
      !items[idx].tanker_id &&
      tanker_id === undefined
    ) {
      items[idx].tanker_id = `AQUA-T${String(id).padStart(3, '0')}`;
    }
  }
  if (tanker_id !== undefined) items[idx].tanker_id = tanker_id;
  distributedStore.saveEmergencyRequests(items);
  await syncEmergencySqlStore();
  res.json({ success: true, message: 'Request status updated' });
});

// ==========================================================
// WATER TRANSPORT & TANKER TRACKING (SQLite + Python + HDFS)
// ==========================================================

const KARNATAKA_COORD_LOOKUP: Record<string, [number, number]> = {
  bagalkot: [16.1691, 75.6615],
  ballari: [15.1394, 76.9214],
  belagavi: [15.8497, 74.4977],
  'bengaluru rural': [13.2846, 77.6078],
  'bengaluru urban': [12.9716, 77.5946],
  bengaluru: [12.9716, 77.5946],
  yelahanka: [13.1007, 77.5963],
  whitefield: [12.9698, 77.75],
  mahadevapura: [12.9915, 77.6873],
  rajajinagar: [12.9982, 77.553],
  bidar: [17.9104, 77.5199],
  chamarajanagar: [11.9261, 76.9437],
  chikkaballapur: [13.4355, 77.7315],
  chikkamagaluru: [13.3161, 75.772],
  chitradurga: [14.2251, 76.398],
  'dakshina kannada': [12.9141, 74.856],
  mangaluru: [12.9141, 74.856],
  davanagere: [14.4644, 75.9218],
  dharwad: [15.4589, 75.0078],
  hubballi: [15.3647, 75.124],
  gadag: [15.4315, 75.6355],
  hassan: [13.0033, 76.1004],
  haveri: [14.7951, 75.3991],
  kalaburagi: [17.3297, 76.8343],
  aland: [17.5644, 76.5685],
  kodagu: [12.4244, 75.7382],
  kolar: [13.1362, 78.1291],
  mulbagal: [13.1636, 78.3936],
  koppal: [15.3505, 76.1548],
  mandya: [12.5218, 76.8951],
  krs: [12.4255, 76.5724],
  mysuru: [12.2958, 76.6394],
  raichur: [16.2076, 77.3463],
  sindhanur: [15.7746, 76.7574],
  ramanagara: [12.715, 77.2814],
  shivamogga: [13.9299, 75.5681],
  tumakuru: [13.3379, 77.1173],
  pavagada: [14.1011, 77.2797],
  udupi: [13.3409, 74.7421],
  'uttara kannada': [14.7937, 74.6869],
  vijayanagara: [15.2689, 76.3909],
  vijayapura: [16.8302, 75.71],
  yadgir: [16.7702, 77.1376],
};

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return Math.round(r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function lookupLocalCoords(text: string, fallbackDistrict?: string): [number, number] | null {
  const hay = `${text} ${fallbackDistrict || ''}`.toLowerCase();
  for (const [key, coords] of Object.entries(KARNATAKA_COORD_LOOKUP)) {
    if (hay.includes(key)) {
      return coords;
    }
  }
  return null;
}

async function syncTransportSqlStore() {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'transport_processor.py');
    await execFileAsync('python3', [scriptPath, 'sync'], { timeout: 8000 });
  } catch {
    // non-fatal if sqlite sync skipped
  }
}

app.get('/api/transport/deliveries', (_req: Request, res: Response) => {
  const hdfsRows =
    distributedStore.readAllRecordsWithBlocks<TransportDeliveryEntity>(
      'transport_deliveries'
    );
  const rows = hdfsRows.length > 0 ? hdfsRows : distributedStore.getTransportDeliveries();
  rows.sort((a, b) => {
    const cmp = String(b.dispatched_at || '').localeCompare(String(a.dispatched_at || ''));
    return cmp !== 0 ? cmp : b.id - a.id;
  });
  res.json(rows);
});

app.post('/api/transport/deliveries', async (req: Request, res: Response) => {
  const body = req.body || {};
  const required = [
    'tanker_id',
    'driver_name',
    'starting_location',
    'destination_area',
    'district',
    'water_quantity_l',
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      res.status(400).json({
        success: false,
        message: `${field.replace(/_/g, ' ')} is required`,
      });
      return;
    }
  }

  const qty = safeFloat(body.water_quantity_l, -1);
  if (qty <= 0) {
    res.status(400).json({
      success: false,
      message: 'Water quantity must be greater than zero',
    });
    return;
  }

  const district = String(body.district).trim();
  const startingLocation = String(body.starting_location).trim();
  const destinationArea = String(body.destination_area).trim();
  const status: TransportDeliveryEntity['delivery_status'] =
    body.delivery_status === 'Scheduled' ||
    body.delivery_status === 'Dispatched' ||
    body.delivery_status === 'In Transit' ||
    body.delivery_status === 'Delivered'
      ? body.delivery_status
      : 'Dispatched';

  let srcCoords = lookupLocalCoords(startingLocation, district);
  let dstCoords = lookupLocalCoords(destinationArea, district);

  if (!srcCoords) {
    const geo = await geocodeLocation(`${startingLocation}, Karnataka`);
    srcCoords = geo ? [geo.lat, geo.lon] : [12.9716, 77.5946];
  }
  if (!dstCoords) {
    const geo = await geocodeLocation(`${destinationArea}, ${district}, Karnataka`);
    dstCoords = geo ? [geo.lat, geo.lon] : [srcCoords[0] + 0.18, srcCoords[1] + 0.14];
  }

  // Slight deterministic jitter if source and dest resolve to identical district center
  if (Math.abs(srcCoords[0] - dstCoords[0]) < 0.01 && Math.abs(srcCoords[1] - dstCoords[1]) < 0.01) {
    dstCoords = [dstCoords[0] + 0.075, dstCoords[1] + 0.065];
  }

  const distKm = Math.max(
    haversineDistanceKm(srcCoords[0], srcCoords[1], dstCoords[0], dstCoords[1]),
    6.5
  );
  const estMin =
    safeFloat(body.estimated_minutes) > 0
      ? Math.round(safeFloat(body.estimated_minutes))
      : Math.max(Math.round((distKm / 42) * 60), 20);

  const progressFraction =
    status === 'Delivered' ? 1 : status === 'In Transit' ? 0.45 : status === 'Dispatched' ? 0.12 : 0;
  const currentLat = Number(
    (srcCoords[0] + (dstCoords[0] - srcCoords[0]) * progressFraction).toFixed(4)
  );
  const currentLon = Number(
    (srcCoords[1] + (dstCoords[1] - srcCoords[1]) * progressFraction).toFixed(4)
  );

  const nowIso = new Date().toISOString();
  const id = distributedStore.allocateIds('transport_deliveries', 1)[0];
  const record: TransportDeliveryEntity = {
    id,
    tanker_id: String(body.tanker_id).trim().toUpperCase(),
    vehicle_reg: String(body.vehicle_reg || `KA-01-G-${1000 + id}`).trim().toUpperCase(),
    driver_name: String(body.driver_name).trim(),
    driver_phone: String(body.driver_phone || '+91 98450 00000').trim(),
    starting_location: startingLocation,
    destination_area: destinationArea,
    district,
    water_quantity_l: Math.round(qty),
    delivery_status: status,
    estimated_minutes: estMin,
    dispatched_at: nowIso,
    delivered_at: status === 'Delivered' ? nowIso : null,
    source_lat: srcCoords[0],
    source_lon: srcCoords[1],
    current_lat: currentLat,
    current_lon: currentLon,
    dest_lat: dstCoords[0],
    dest_lon: dstCoords[1],
    distance_km: distKm,
    emergency_request_id: body.emergency_request_id ? Number(body.emergency_request_id) : null,
  };

  const items = distributedStore.getTransportDeliveries();
  items.unshift(record);
  distributedStore.saveTransportDeliveries(items);
  await syncTransportSqlStore();

  res.json({
    success: true,
    record,
    message: 'Tanker dispatch stored in SQL & HDFS shards',
  });
});

app.patch('/api/transport/deliveries/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { delivery_status, estimated_minutes } = req.body || {};
  const allowed: TransportDeliveryEntity['delivery_status'][] = [
    'Scheduled',
    'Dispatched',
    'In Transit',
    'Delivered',
  ];
  if (delivery_status && !allowed.includes(delivery_status)) {
    res.status(400).json({ success: false, message: 'Invalid delivery status' });
    return;
  }

  const items = distributedStore.getTransportDeliveries();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) {
    res.status(404).json({ success: false, message: 'Delivery record not found' });
    return;
  }

  const target = items[idx];
  if (delivery_status) {
    target.delivery_status = delivery_status;
    if (delivery_status === 'Delivered') {
      target.delivered_at = new Date().toISOString();
      target.current_lat = target.dest_lat;
      target.current_lon = target.dest_lon;
    } else if (delivery_status === 'In Transit') {
      target.delivered_at = null;
      target.current_lat = Number(((target.source_lat + target.dest_lat) / 2).toFixed(4));
      target.current_lon = Number(((target.source_lon + target.dest_lon) / 2).toFixed(4));
    } else if (delivery_status === 'Dispatched') {
      target.delivered_at = null;
      target.current_lat = Number(
        (target.source_lat + (target.dest_lat - target.source_lat) * 0.15).toFixed(4)
      );
      target.current_lon = Number(
        (target.source_lon + (target.dest_lon - target.source_lon) * 0.15).toFixed(4)
      );
    }
  }
  if (estimated_minutes !== undefined && safeFloat(estimated_minutes) > 0) {
    target.estimated_minutes = Math.round(safeFloat(estimated_minutes));
  }

  distributedStore.saveTransportDeliveries(items);
  await syncTransportSqlStore();
  res.json({ success: true, record: target });
});

app.get('/api/transport/python-process', async (_req: Request, res: Response) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'transport_processor.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, 'process'], {
      timeout: 8000,
    });
    res.json(JSON.parse(stdout));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Python tracking processing failed',
    });
  }
});

// ==========================================================
// GEOCODING, ROAD ROUTING & TANKER DEMO TRACKING
// ==========================================================

async function geocodeLocation(location: string) {
  if (!location) return null;
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', location);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'AquaAI-WaterManagement-App/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    const results = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    if (!results.length) return null;
    return {
      lat: Number(results[0].lat),
      lon: Number(results[0].lon),
      display_name: results[0].display_name,
    };
  } catch {
    return null;
  }
}

async function getRoadRoute(
  source: { lat: number; lon: number },
  destination: { lat: number; lon: number }
) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${source.lon},${source.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const result = (await response.json()) as {
      code: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { type: string; coordinates: [number, number][] };
      }>;
    };
    if (result.code !== 'Ok' || !result.routes?.length) return null;
    const route = result.routes[0];
    return {
      distance_km: Math.round((route.distance / 1000) * 100) / 100,
      duration_minutes: Math.round((route.duration / 60) * 100) / 100,
      geometry: route.geometry,
    };
  } catch {
    return null;
  }
}

app.post('/api/route', async (req: Request, res: Response) => {
  const { source: sourceName, destination: destName } = req.body || {};
  if (!sourceName || !destName) {
    res
      .status(400)
      .json({ success: false, message: 'Source and destination are required' });
    return;
  }

  const [source, destination] = await Promise.all([
    geocodeLocation(sourceName),
    geocodeLocation(destName),
  ]);

  if (!source || !destination) {
    res.status(404).json({
      success: false,
      message: 'Could not locate the source or destination',
    });
    return;
  }

  const route = await getRoadRoute(source, destination);
  if (!route) {
    res.status(502).json({
      success: false,
      message: 'Road route could not be calculated',
    });
    return;
  }

  res.json({
    success: true,
    source,
    destination,
    distance_km: route.distance_km,
    duration_minutes: route.duration_minutes,
    geometry: route.geometry,
    message: 'Route calculated. Live traffic delays are not included.',
  });
});

app.post(
  '/api/emergency-requests/:id/tracking/start-demo',
  async (req: Request, res: Response) => {
    const requestId = Number(req.params.id);
    const items = distributedStore.getEmergencyRequests();
    const idx = items.findIndex((i) => i.id === requestId);
    if (idx === -1) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }

    const body = req.body || {};
    const sourceName = body.source || items[idx].source_location;
    const destName = body.destination || items[idx].destination_location;

    if (!sourceName || !destName) {
      res.status(400).json({
        success: false,
        message: 'Source and destination are required',
      });
      return;
    }

    const [source, destination] = await Promise.all([
      geocodeLocation(sourceName),
      geocodeLocation(destName),
    ]);

    if (!source || !destination) {
      res.status(404).json({
        success: false,
        message: 'Could not locate route endpoints',
      });
      return;
    }

    const route = await getRoadRoute(source, destination);
    if (!route) {
      res.status(502).json({
        success: false,
        message: 'Unable to calculate road route',
      });
      return;
    }

    const tankerId = body.tanker_id || `AQUA-T${String(requestId).padStart(3, '0')}`;
    items[idx] = {
      ...items[idx],
      source_location: sourceName,
      destination_location: destName,
      status: 'In Transit',
      tanker_id: tankerId,
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      route_geometry: route.geometry,
      start_time: Date.now() / 1000,
    };

    distributedStore.saveEmergencyRequests(items);
    res.json({
      success: true,
      request_id: requestId,
      tanker_id: tankerId,
      distance_km: route.distance_km,
      duration_minutes: route.duration_minutes,
      geometry: route.geometry,
      tracking_mode: 'SIMULATED DEMO',
      message: 'Simulated tanker tracking started',
    });
  }
);

app.get('/api/emergency-requests/:id/tracking', (req: Request, res: Response) => {
  const requestId = Number(req.params.id);
  const items = distributedStore.getEmergencyRequests();
  const idx = items.findIndex((i) => i.id === requestId);
  if (idx === -1) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  const record = items[idx];
  const distance = safeFloat(record.distance_km);
  const duration = safeFloat(record.duration_minutes);
  const startTime = record.start_time;

  let progress = 0;
  let remainingDistance = distance;
  let remainingMinutes = duration;
  let currentPosition: { lat: number; lon: number } | null = null;
  const geometry = record.route_geometry || null;

  if (startTime && duration > 0) {
    const elapsedMinutes = Math.max((Date.now() / 1000 - startTime) / 60, 0);
    progress = Math.min(elapsedMinutes / duration, 1);
    remainingDistance = distance * (1 - progress);
    remainingMinutes = Math.max(duration - elapsedMinutes, 0);

    if (geometry?.coordinates?.length && geometry.coordinates.length >= 2) {
      const coords = geometry.coordinates;
      const coordIndex = Math.min(
        Math.floor(progress * (coords.length - 1)),
        coords.length - 1
      );
      currentPosition = {
        lon: coords[coordIndex][0],
        lat: coords[coordIndex][1],
      };
    }

    if (progress >= 1 && record.status === 'In Transit') {
      items[idx].status = 'Delivered';
      distributedStore.saveEmergencyRequests(items);
      record.status = 'Delivered';
    }
  }

  res.json({
    success: true,
    request_id: requestId,
    status: record.status,
    tanker_id: record.tanker_id || null,
    tracking_mode: startTime ? 'SIMULATED DEMO' : 'NOT STARTED',
    progress_percentage: Math.round(progress * 10000) / 100,
    total_distance_km: Math.round(distance * 100) / 100,
    remaining_distance_km: Math.round(Math.max(remainingDistance, 0) * 100) / 100,
    total_duration_minutes: Math.round(duration * 100) / 100,
    remaining_minutes: Math.round(Math.max(remainingMinutes, 0) * 100) / 100,
    current_position: currentPosition,
    geometry,
    source: record.source_location,
    destination: record.destination_location,
  });
});

// ==========================================================
// WATER MAINTENANCE OPERATIONS & LIVE TELEMETRY TRIGGERS
// ==========================================================

async function syncMaintenanceSqlStore() {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'maintenance_sql.py');
    await execFileAsync('python3', [scriptPath, 'sync'], { timeout: 8000 });
  } catch {
    // non-fatal
  }
}

interface LiveMaintenanceTrigger {
  trigger_id: string;
  source: string;
  district: string;
  area: string;
  asset_name: string;
  asset_type: MaintenanceTaskEntity['asset_type'];
  maintenance_type: MaintenanceTaskEntity['maintenance_type'];
  priority: MaintenanceTaskEntity['priority'];
  water_saved_lpd: number;
  estimated_cost_inr: number;
  reason: string;
  observed_at: string;
}

async function computeLiveMaintenanceAlerts(forceRefresh = false): Promise<{
  checked_at: string;
  weather: Awaited<ReturnType<typeof getLiveWeatherData>>;
  nwdp: Awaited<ReturnType<typeof getAllPublicWaterData>>;
  nwdp_reservoirs: ReturnType<typeof extractLatestNwdpReservoirs>;
  detected_alerts: LiveMaintenanceTrigger[];
}> {
  const [weather, nwdp] = await Promise.all([
    getLiveWeatherData(forceRefresh),
    getAllPublicWaterData(forceRefresh),
  ]);

  const detected: LiveMaintenanceTrigger[] = [];

  // 1. Live Open-Meteo Weather Triggers (heat / dry spell / heavy rain)
  for (const st of weather.data) {
    if (!st.weather) continue;
    const temp = Number(st.weather.temperature_2m ?? 0);
    const rain = Number(st.weather.daily_avg_rainfall_mm ?? 0);
    const precip = Number(st.weather.precipitation ?? 0);

    if (precip >= 10 || rain >= 15) {
      detected.push({
        trigger_id: `wx-rain-${st.city.toLowerCase()}`,
        source: 'Live Open-Meteo Weather',
        district: st.district,
        area: `${st.city} Zone`,
        asset_name: `${st.city} Stormwater & Intake Silt Trap`,
        asset_type: 'Filtration / WTP',
        maintenance_type: 'Filter Media Flush',
        priority: 'High',
        water_saved_lpd: 95000,
        estimated_cost_inr: 32000,
        reason: `Live rainfall (${precip} mm current, ${rain} mm 3-day avg) increases raw turbidity.`,
        observed_at: st.weather.time || weather.fetched_at,
      });
    } else if (temp >= 28 && rain < 0.5) {
      detected.push({
        trigger_id: `wx-dry-${st.city.toLowerCase()}`,
        source: 'Live Open-Meteo Weather',
        district: st.district,
        area: `${st.city} Supply Network`,
        asset_name: `${st.city} Booster Station & Trunk Valve Check`,
        asset_type: 'Pumping Station',
        maintenance_type: 'Pump Overhaul',
        priority: temp >= 32 ? 'High' : 'Medium',
        water_saved_lpd: 82000,
        estimated_cost_inr: 38000,
        reason: `Live ${temp}°C, ${st.weather.relative_humidity_2m ?? 0}% RH, 0 mm rain — elevated evaporation & pump load.`,
        observed_at: st.weather.time || weather.fetched_at,
      });
    }
  }

  // 2. Live NWDP Reservoir Low-Fill Triggers
  const nwdpReservoirs = extractLatestNwdpReservoirs(nwdp.datasets?.reservoir);
  for (const dam of nwdpReservoirs) {
    if (dam.percentage_full > 0 && dam.percentage_full < 55) {
      detected.push({
        trigger_id: `nwdp-res-${dam.reservoir_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        source: 'NWDP Live Reservoir',
        district: dam.district,
        area: dam.reservoir_name,
        asset_name: `${dam.reservoir_name} Intake Gate & Silt Channel`,
        asset_type: 'Reservoir Gate',
        maintenance_type: 'Reservoir Desilting',
        priority: dam.percentage_full < 40 ? 'Critical' : 'High',
        water_saved_lpd: 240000,
        estimated_cost_inr: 95000,
        reason: `Live NWDP telemetry shows ${dam.percentage_full}% storage (${dam.live_capacity} TMC) as of ${dam.monitoring_date}.`,
        observed_at: dam.monitoring_date,
      });
    }
  }

  // 3. Live NWDP Water Quality Triggers (turbidity, TDS, fluoride, pH)
  const wqRecords = nwdp.datasets?.water_quality?.records || [];
  const recentWq = wqRecords.slice(-15);
  for (const row of recentWq) {
    const dist = String(row['DistrictName'] || '').trim();
    const loc = String(row['LocationName'] || '').trim();
    if (!dist || !loc) continue;
    const turb = Number(row['Turbidity (NTU)'] ?? 0);
    const tds = Number(row['Solids, Total Dissolved (mg/L)'] ?? 0);
    const fluoride = Number(row['Fluoride (mg/L)'] ?? 0);
    if (turb > 5 || tds > 500 || fluoride > 1.0) {
      detected.push({
        trigger_id: `nwdp-wq-${dist.toLowerCase()}-${String(row['Location Code'] || loc.slice(0, 10))}`,
        source: 'NWDP Live Water Quality',
        district: dist,
        area: loc.slice(0, 48),
        asset_name: `${dist} Water Treatment & Chlorination Unit`,
        asset_type: 'Filtration / WTP',
        maintenance_type: turb > 5 ? 'Filter Media Flush' : 'Water Quality & Chlorination',
        priority: fluoride > 1.2 || tds > 800 ? 'Critical' : 'Medium',
        water_saved_lpd: 68000,
        estimated_cost_inr: 34000,
        reason: `NWDP KSPCB reading: Turbidity ${turb} NTU, TDS ${tds} mg/L, Fluoride ${fluoride} mg/L.`,
        observed_at: String(row['Year'] || 'NWDP KSPCB'),
      });
      if (detected.filter((d) => d.source === 'NWDP Live Water Quality').length >= 3) {
        break;
      }
    }
  }

  // 4. HDFS Water Deficit & Quality Alerts
  const waterRows = distributedStore.readAllRecords<WaterRecordEntity>('water_records');
  const latestAreas = getLatestDistrictSnapshot(waterRows);
  for (const r of latestAreas) {
    const cov = r.water_demand > 0 ? (r.water_supply / r.water_demand) * 100 : 100;
    if (cov < 58 || /fluoride|needs testing/i.test(r.water_quality || '')) {
      detected.push({
        trigger_id: `hdfs-wr-${r.district.toLowerCase()}-${r.area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        source: 'HDFS Quality / Shortage Alert',
        district: r.district,
        area: r.area,
        asset_name: `${r.area} Distribution Main & Quality Valve`,
        asset_type: cov < 58 ? 'Pipeline / Main' : 'Filtration / WTP',
        maintenance_type: cov < 58 ? 'Pipeline Leak Repair' : 'Water Quality & Chlorination',
        priority: cov < 55 || /fluoride/i.test(r.water_quality) ? 'Critical' : 'High',
        water_saved_lpd: Math.max(Math.round((r.water_demand - r.water_supply) * 0.25), 45000),
        estimated_cost_inr: 48000,
        reason: `Area supply coverage ${cov.toFixed(1)}% · Quality flag: ${r.water_quality}.`,
        observed_at: r.recorded_at,
      });
      if (detected.filter((d) => d.source === 'HDFS Quality / Shortage Alert').length >= 4) {
        break;
      }
    }
  }

  return {
    checked_at: new Date().toISOString(),
    weather,
    nwdp,
    nwdp_reservoirs: nwdpReservoirs,
    detected_alerts: detected,
  };
}

app.get('/api/maintenance/tasks', (_req: Request, res: Response) => {
  const hdfsRows =
    distributedStore.readAllRecordsWithBlocks<MaintenanceTaskEntity>('maintenance_tasks');
  const rows = hdfsRows.length > 0 ? hdfsRows : distributedStore.getMaintenanceTasks();
  rows.sort((a, b) => b.id - a.id);
  res.json(rows);
});

app.post('/api/maintenance/tasks', async (req: Request, res: Response) => {
  const body = req.body || {};
  if (!body.district || !body.area || !body.asset_name) {
    res.status(400).json({
      success: false,
      message: 'District, area, and asset name are required',
    });
    return;
  }

  const id = distributedStore.allocateIds('maintenance_tasks', 1)[0];
  const nowIso = new Date().toISOString();
  const status: MaintenanceTaskEntity['status'] =
    body.status === 'In Progress' ||
    body.status === 'Completed' ||
    body.status === 'Deferred'
      ? body.status
      : 'Scheduled';

  const newTask: MaintenanceTaskEntity = {
    id,
    task_code: String(body.task_code || `MNT-${100 + id}`),
    district: String(body.district).trim(),
    area: String(body.area).trim(),
    asset_name: String(body.asset_name).trim(),
    asset_type: body.asset_type || 'Pipeline / Main',
    maintenance_type: body.maintenance_type || 'Pipeline Leak Repair',
    priority: body.priority || 'High',
    status,
    assigned_crew: String(body.assigned_crew || 'District Rapid Maintenance Unit').trim(),
    scheduled_date: String(body.scheduled_date || nowIso.slice(0, 10)),
    completed_at: status === 'Completed' ? nowIso : null,
    estimated_cost_inr: Math.max(0, Math.round(safeFloat(body.estimated_cost_inr, 35000))),
    water_saved_lpd: Math.max(0, Math.round(safeFloat(body.water_saved_lpd, 50000))),
    telemetry_source: String(body.telemetry_source || 'Field Inspection'),
    notes: String(body.notes || '').trim(),
    created_at: nowIso,
  };

  const items = distributedStore.getMaintenanceTasks();
  items.unshift(newTask);
  distributedStore.saveMaintenanceTasks(items);
  await syncMaintenanceSqlStore();

  res.json({
    success: true,
    record: newTask,
    message: 'Maintenance work order saved to SQL & HDFS shards',
  });
});

app.patch('/api/maintenance/tasks/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, priority, assigned_crew, notes } = req.body || {};
  const allowedStatus = ['Scheduled', 'In Progress', 'Completed', 'Deferred'];
  if (status && !allowedStatus.includes(status)) {
    res.status(400).json({ success: false, message: 'Invalid maintenance status' });
    return;
  }

  const items = distributedStore.getMaintenanceTasks();
  const idx = items.findIndex((t) => t.id === id);
  if (idx === -1) {
    res.status(404).json({ success: false, message: 'Maintenance task not found' });
    return;
  }

  const nowIso = new Date().toISOString();
  if (status) {
    items[idx].status = status;
    items[idx].completed_at = status === 'Completed' ? nowIso : null;
  }
  if (priority) items[idx].priority = priority;
  if (assigned_crew !== undefined) items[idx].assigned_crew = String(assigned_crew).trim();
  if (notes !== undefined) items[idx].notes = String(notes).trim();
  items[idx].updated_at = nowIso;

  distributedStore.saveMaintenanceTasks(items);
  await syncMaintenanceSqlStore();

  res.json({ success: true, record: items[idx] });
});

app.delete('/api/maintenance/tasks/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const items = distributedStore.getMaintenanceTasks();
  const filtered = items.filter((t) => t.id !== id);
  if (filtered.length === items.length) {
    res.status(404).json({ success: false, message: 'Maintenance task not found' });
    return;
  }
  distributedStore.saveMaintenanceTasks(filtered);
  await syncMaintenanceSqlStore();
  res.json({ success: true });
});

app.post('/api/maintenance/sync-live-alerts', async (req: Request, res: Response) => {
  try {
    const force = Boolean(req.body?.refresh);
    const live = await computeLiveMaintenanceAlerts(force);
    const existing = distributedStore.getMaintenanceTasks();

    const activeKeys = new Set(
      existing
        .filter((t) => t.status !== 'Completed')
        .map(
          (t) =>
            `${t.district.toLowerCase()}::${t.maintenance_type.toLowerCase()}::${t.area.toLowerCase()}`
        )
    );

    const created: MaintenanceTaskEntity[] = [];
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);

    for (const alert of live.detected_alerts) {
      const key = `${alert.district.toLowerCase()}::${alert.maintenance_type.toLowerCase()}::${alert.area.toLowerCase()}`;
      if (activeKeys.has(key)) continue;
      activeKeys.add(key);

      const id = distributedStore.allocateIds('maintenance_tasks', 1)[0];
      const newTask: MaintenanceTaskEntity = {
        id,
        task_code: `MNT-${100 + id}`,
        district: alert.district,
        area: alert.area,
        asset_name: alert.asset_name,
        asset_type: alert.asset_type,
        maintenance_type: alert.maintenance_type,
        priority: alert.priority,
        status: 'Scheduled',
        assigned_crew: `${alert.district} Rapid Maintenance Team`,
        scheduled_date: todayStr,
        completed_at: null,
        estimated_cost_inr: alert.estimated_cost_inr,
        water_saved_lpd: alert.water_saved_lpd,
        telemetry_source: alert.source,
        notes: alert.reason,
        created_at: nowIso,
      };
      created.push(newTask);
      existing.unshift(newTask);
      if (created.length >= 4) break;
    }

    if (created.length > 0) {
      distributedStore.saveMaintenanceTasks(existing);
      await syncMaintenanceSqlStore();
    }

    res.json({
      success: true,
      created_count: created.length,
      created_tasks: created,
      total_detected_alerts: live.detected_alerts.length,
      checked_at: live.checked_at,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Live alert sync failed',
    });
  }
});

app.get('/api/maintenance/python-summary', async (_req: Request, res: Response) => {
  try {
    const scriptPath = path.resolve(process.cwd(), 'server', 'maintenance_sql.py');
    const { stdout } = await execFileAsync('python3', [scriptPath, 'summary'], {
      timeout: 8000,
    });
    res.json(JSON.parse(stdout));
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Python maintenance SQL failed',
    });
  }
});

// ==========================================================
// LIVE WEATHER (OPEN-METEO) & LIVE MAINTENANCE FEEDS
// ==========================================================

app.get('/api/live-weather', async (req: Request, res: Response) => {
  const forceRefresh = ['1', 'true', 'yes'].includes(
    String(req.query.refresh || '').toLowerCase()
  );
  const payload = await getLiveWeatherData(forceRefresh);
  res.json(payload);
});

app.get('/api/live-maintenance-feeds', async (req: Request, res: Response) => {
  const forceRefresh = ['1', 'true', 'yes'].includes(
    String(req.query.refresh || '').toLowerCase()
  );
  const feeds = await computeLiveMaintenanceAlerts(forceRefresh);
  res.json({
    success: true,
    ...feeds,
  });
});

// ==========================================================
// OFFICIAL GOVERNMENT WATER DATA - NWDP
// ==========================================================

app.get('/api/public-data-catalogue', (_req: Request, res: Response) => {
  const catalogue = Object.entries(GOVERNMENT_DATASETS).map(([key, cfg]) => ({
    key,
    name: cfg.name,
    title: cfg.title,
    frequency: cfg.frequency,
    description: cfg.description,
    source: NWDP_WEBSITE,
    page_url: cfg.page,
    dataset_url: cfg.url,
    refresh_seconds: PUBLIC_CACHE_SECONDS,
  }));

  res.json({ success: true, catalogue, datasets: catalogue });
});

app.get('/api/public-water-data', async (req: Request, res: Response) => {
  const forceRefresh = ['1', 'true', 'yes'].includes(
    String(req.query.refresh || '').toLowerCase()
  );
  const data = await getAllPublicWaterData(forceRefresh);
  res.json(data);
});

app.post('/api/reservoirs/sync-live-nwdp', async (_req: Request, res: Response) => {
  try {
    const publicData = await getAllPublicWaterData(true);
    const liveDams = extractLatestNwdpReservoirs(publicData.datasets?.reservoir);
    if (!liveDams.length) {
      res.status(502).json({
        success: false,
        message: 'NWDP live reservoir feed returned no records to sync.',
      });
      return;
    }

    const existing = distributedStore.readAllRecordsIgnoringOffline<ReservoirEntity>('reservoirs');
    const seen = new Set(
      existing.map(
        (r) =>
          `${r.reservoir_name.trim().toLowerCase()}::${String(r.monitoring_date || '').slice(0, 10)}`
      )
    );

    const toInsert = liveDams.filter(
      (d) =>
        !seen.has(
          `${d.reservoir_name.trim().toLowerCase()}::${String(d.monitoring_date || '').slice(0, 10)}`
        )
    );

    if (toInsert.length > 0) {
      const ids = distributedStore.allocateIds('reservoirs', toInsert.length);
      const entities: ReservoirEntity[] = toInsert.map((d, idx) => ({
        id: ids[idx],
        ...d,
      }));
      distributedStore.appendRecordsToCollection('reservoirs', entities);
    }

    res.json({
      success: true,
      synced_count: toInsert.length,
      live_dams_inspected: liveDams.length,
      dams: liveDams,
      checked_at: publicData.checked_at,
      message:
        toInsert.length > 0
          ? `Synced ${toInsert.length} live NWDP Karnataka reservoir snapshots into HDFS shards.`
          : `All ${liveDams.length} latest NWDP reservoir snapshots are already up to date in HDFS.`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'NWDP reservoir sync failed',
    });
  }
});

app.post('/api/datasets/ingest-live-nwdp', async (req: Request, res: Response) => {
  const key = String(req.body?.key || 'water_quality');
  if (!GOVERNMENT_DATASETS[key]) {
    res.status(400).json({ success: false, message: 'Unknown NWDP dataset key' });
    return;
  }

  try {
    const publicData = await getAllPublicWaterData(false);
    const feed = publicData.datasets?.[key];
    if (!feed || !feed.available || !feed.records.length) {
      res.status(400).json({
        success: false,
        message: `Live NWDP feed "${key}" currently has 0 rows available to ingest.`,
      });
      return;
    }

    const catMap: Record<string, DatasetCategory> = {
      reservoir: 'Reservoir data',
      rainfall: 'Rainfall data',
      discharge: 'Water distribution data',
      groundwater: 'Groundwater data',
      water_quality: 'Water consumption data',
    };
    const category = catMap[key] || 'Reservoir data';
    const uploadTime = new Date().toISOString();
    const filename = `nwdp_live_${key}_${uploadTime.slice(0, 10)}.csv`;
    const datasetId = distributedStore.allocateIds('uploaded_datasets', 1)[0];
    const rowIds = distributedStore.allocateIds('dataset_files', feed.records.length);

    const rows: DatasetFileRecordEntity[] = feed.records.map((raw, idx) => {
      const dist = String(
        raw['DistrictName'] || raw['District'] || raw['Basin'] || 'Karnataka'
      ).trim();
      const station = String(
        raw['Reservoir Name'] ||
          raw['LocationName'] ||
          raw['Location Name'] ||
          raw['Block'] ||
          raw['Station Code'] ||
          `Station-${idx + 1}`
      ).trim();
      const dateVal = String(
        raw['Monitoring Date'] || raw['Date'] || uploadTime.slice(0, 10)
      ).slice(0, 10);
      const numericVals = Object.values(raw)
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n));
      return {
        ...raw,
        id: rowIds[idx],
        dataset_id: datasetId,
        dataset_filename: filename,
        category,
        district: dist,
        station_or_area: station,
        observation_date: dateVal,
        metric_primary: numericVals[0] ?? 0,
        metric_secondary: numericVals[1] ?? 0,
        unit: key === 'groundwater' ? 'm bgl' : key === 'reservoir' ? '%' : 'units',
        status_note: `Live NWDP (${feed.title})`,
      };
    });

    const createdBlocks = distributedStore.appendRecordsToCollection('dataset_files', rows);
    const existingDatasets = distributedStore.getUploadedDatasets();
    existingDatasets.unshift({
      id: datasetId,
      filename,
      filepath: '',
      category,
      uploaded_at: uploadTime,
      row_count: rows.length,
      collection_ref: 'dataset_files',
      block_ids: createdBlocks.map((b) => b.blockId),
    });
    distributedStore.saveUploadedDatasets(existingDatasets);

    res.json({
      success: true,
      dataset_id: datasetId,
      filename,
      category,
      rows: rows.length,
      blocks_created: createdBlocks.length,
      message: `Ingested ${rows.length} live NWDP observations into ${createdBlocks.length} HDFS blocks.`,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Live NWDP ingestion failed',
    });
  }
});

app.get('/api/live-data-status', (_req: Request, res: Response) => {
  const cluster = distributedStore.getClusterStatus();
  res.json({
    success: true,
    database: `Distributed Shard Store (${cluster.totalBlocks} blocks across ${cluster.healthyNodes}/${cluster.totalNodes} nodes)`,
    weather: 'Open-Meteo Live Forecast API (6 Karnataka stations)',
    road_routing: 'OSRM + OpenStreetMap Nominatim',
    reservoir_data: 'HDFS Reservoir Shards + Live NWDP Dam Sync',
    maintenance_engine: 'HDFS Maintenance Shards + SQLite + Live Weather/NWDP Triggers',
    kwris_api: 'National Water Data Portal (nwdp.nwic.gov.in) Live CSV Feed',
    gps_tracking: 'Simulated Demo Route Progress',
    demo_tracking: 'Enabled on Emergency Tanker Requests',
  });
});

// ==========================================================
// SAMPLE CSV DOWNLOAD
// ==========================================================

app.get('/sample-csv', (_req: Request, res: Response) => {
  const csv = [
    'district,area,demand,availability,water_consumed,water_level,water_quality,observation_date',
    'Bengaluru Urban,Electronic City Phase 1,1850000,1420000,1390000,61,Moderate TDS,2026-11-15',
    'Mysuru,Nanjangud Ward,950000,910000,870000,82,Good,2026-11-15',
    'Koppal,Gangavathi Cluster,1240000,720000,705000,36,Needs Testing,2026-11-15',
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename=aquaai_sample.csv'
  );
  res.send(csv);
});

// ==========================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVE
// ==========================================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AquaAI Distributed MapReduce server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
