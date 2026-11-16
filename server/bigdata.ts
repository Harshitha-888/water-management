import crypto from 'crypto';
import {
  distributedStore,
  KARNATAKA_DISTRICTS,
  WaterRecordEntity,
} from './distributedStore';

// ==========================================================
// 1. DISTRIBUTED DATA PROFILER & ANOMALY SCANNER
// ==========================================================

export interface NumericProfile {
  field: string;
  count: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  p50: number;
  p95: number;
}

export interface AnomalyRecord {
  id: number;
  district: string;
  area: string;
  issue: string;
  metric: string;
}

export interface DataProfileReport {
  generatedAt: string;
  durationMs: number;
  totalBlocksScanned: number;
  totalRecords: number;
  nullConsumptionCount: number;
  completenessPct: number;
  numericProfiles: NumericProfile[];
  qualityDistribution: Array<{ quality: string; count: number }>;
  anomalies: AnomalyRecord[];
}

function computeStats(field: string, values: number[]): NumericProfile {
  if (values.length === 0) {
    return { field, count: 0, min: 0, max: 0, mean: 0, stdDev: 0, p50: 0, p95: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / sorted.length;
  const variance =
    sorted.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

  return {
    field,
    count: sorted.length,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
    p50: Math.round(p50 * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
  };
}

export function runDistributedDataProfiler(): DataProfileReport {
  const start = performance.now();
  const blocks = distributedStore.getBlocks('water_records');
  const records: WaterRecordEntity[] = [];

  for (const block of blocks) {
    const read = distributedStore.readBlockWithFailover<WaterRecordEntity>(block);
    if (read.status === 'completed') {
      records.push(...read.records);
    }
  }

  const demands = records.map((r) => r.water_demand || 0);
  const supplies = records.map((r) => r.water_supply || 0);
  const levels = records.map((r) => r.water_level || 0);
  const shortages = records.map((r) =>
    Math.max((r.water_demand || 0) - (r.water_supply || 0), 0)
  );
  const nullConsumptionCount = records.filter(
    (r) => r.water_consumed === null || r.water_consumed === undefined
  ).length;

  const qualityCounts = new Map<string, number>();
  const anomalies: AnomalyRecord[] = [];

  for (const r of records) {
    const q = (r.water_quality || 'Not recorded').trim();
    qualityCounts.set(q, (qualityCounts.get(q) || 0) + 1);

    const demand = r.water_demand || 0;
    const supply = r.water_supply || 0;
    if (demand > 0 && supply / demand < 0.6) {
      anomalies.push({
        id: r.id,
        district: r.district,
        area: r.area,
        issue: 'Severe Supply Deficit (<60% coverage)',
        metric: `${Math.round((supply / demand) * 100)}% coverage`,
      });
    }
    if (
      q.toLowerCase().includes('fluoride') ||
      q.toLowerCase().includes('testing') ||
      q.toLowerCase().includes('hard')
    ) {
      anomalies.push({
        id: r.id,
        district: r.district,
        area: r.area,
        issue: `Water Quality Flag (${q})`,
        metric: `Level ${r.water_level}%`,
      });
    }
  }

  const totalFields = records.length * 8;
  const completenessPct =
    totalFields > 0
      ? Math.round(((totalFields - nullConsumptionCount) / totalFields) * 1000) / 10
      : 100;

  return {
    generatedAt: new Date().toISOString(),
    durationMs: Number((performance.now() - start).toFixed(2)),
    totalBlocksScanned: blocks.length,
    totalRecords: records.length,
    nullConsumptionCount,
    completenessPct,
    numericProfiles: [
      computeStats('water_demand (L)', demands),
      computeStats('water_supply (L)', supplies),
      computeStats('shortage (L)', shortages),
      computeStats('water_level (%)', levels),
    ],
    qualityDistribution: Array.from(qualityCounts.entries())
      .map(([quality, count]) => ({ quality, count }))
      .sort((a, b) => b.count - a.count),
    anomalies: anomalies.slice(0, 20),
  };
}

// ==========================================================
// 2. MAPREDUCE INVERTED INDEX BUILDER & QUERY
// ==========================================================

export interface InvertedPosting {
  recordId: number;
  blockId: string;
  district: string;
  area: string;
  quality: string;
  shortage: number;
}

export interface InvertedIndexResponse {
  durationMs: number;
  totalTerms: number;
  totalPostings: number;
  query: string;
  matchedTerms: Array<{
    term: string;
    docFrequency: number;
    postings: InvertedPosting[];
  }>;
  sampleTopTerms: Array<{ term: string; docFrequency: number }>;
}

export function runInvertedIndexQuery(query: string): InvertedIndexResponse {
  const start = performance.now();
  const blocks = distributedStore.getBlocks('water_records');
  const index = new Map<string, InvertedPosting[]>();

  // Map: tokenize district, area, and water_quality per block; Reduce: group postings by term
  for (const block of blocks) {
    const read = distributedStore.readBlockWithFailover<WaterRecordEntity>(block);
    if (read.status !== 'completed') continue;

    for (const rec of read.records) {
      const shortage = Math.max(
        (rec.water_demand || 0) - (rec.water_supply || 0),
        0
      );
      const text = `${rec.district} ${rec.area} ${rec.water_quality} ${
        shortage > 0 ? 'shortage deficit' : 'sufficient'
      }`.toLowerCase();
      const tokens = Array.from(
        new Set(text.split(/[^a-z0-9]+/).filter((t) => t.length >= 2))
      );

      for (const term of tokens) {
        const list = index.get(term);
        const posting: InvertedPosting = {
          recordId: rec.id,
          blockId: block.blockId,
          district: rec.district,
          area: rec.area,
          quality: rec.water_quality,
          shortage: Math.round(shortage),
        };
        if (list) list.push(posting);
        else index.set(term, [posting]);
      }
    }
  }

  let totalPostings = 0;
  for (const list of index.values()) {
    totalPostings += list.length;
  }

  const qTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

  const matchedTerms = Array.from(index.entries())
    .filter(([term]) =>
      qTokens.length === 0
        ? false
        : qTokens.some((qt) => term.includes(qt))
    )
    .map(([term, postings]) => ({
      term,
      docFrequency: postings.length,
      postings,
    }))
    .sort((a, b) => b.docFrequency - a.docFrequency)
    .slice(0, 12);

  const sampleTopTerms = Array.from(index.entries())
    .map(([term, postings]) => ({ term, docFrequency: postings.length }))
    .sort((a, b) => b.docFrequency - a.docFrequency)
    .slice(0, 18);

  return {
    durationMs: Number((performance.now() - start).toFixed(2)),
    totalTerms: index.size,
    totalPostings,
    query,
    matchedTerms,
    sampleTopTerms,
  };
}

// ==========================================================
// 3. PARTITION SKEW & BLOOM FILTER SHARD PRUNING
// ==========================================================

export interface PartitionSkewReport {
  numPartitions: number;
  totalKeys: number;
  skewRatio: number;
  partitions: Array<{
    partitionId: number;
    recordCount: number;
    districts: string[];
  }>;
  bloomFilter: {
    bitArraySize: number;
    hashFunctions: number;
    setBits: number;
    fillRatioPct: number;
    lookupKey: string;
    mightContain: boolean;
    blocksPruned: number;
    totalBlocks: number;
  };
}

function fnvHash(str: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function analyzeSkewAndBloom(
  numPartitions = 4,
  lookupDistrict = 'Bengaluru Urban'
): PartitionSkewReport {
  const safePartitions = Math.max(2, Math.min(8, numPartitions));
  const blocks = distributedStore.getBlocks('water_records');
  const partMap = Array.from({ length: safePartitions }, () => ({
    recordCount: 0,
    districts: new Set<string>(),
  }));

  const bitSize = 256;
  const hashCount = 3;
  const blockFilters = new Map<string, Uint8Array>();
  const globalFilter = new Uint8Array(bitSize);

  for (const block of blocks) {
    const read = distributedStore.readBlockWithFailover<WaterRecordEntity>(block);
    if (read.status !== 'completed') continue;

    const bf = new Uint8Array(bitSize);
    for (const rec of read.records) {
      const pIdx = fnvHash(rec.district.toLowerCase(), 0) % safePartitions;
      partMap[pIdx].recordCount++;
      partMap[pIdx].districts.add(rec.district);

      const key = rec.district.trim().toLowerCase();
      for (let k = 0; k < hashCount; k++) {
        const bit = fnvHash(key, (k + 1) * 97) % bitSize;
        bf[bit] = 1;
        globalFilter[bit] = 1;
      }
    }
    blockFilters.set(block.blockId, bf);
  }

  const counts = partMap.map((p) => p.recordCount);
  const avg = counts.reduce((s, c) => s + c, 0) / safePartitions || 1;
  const maxCount = Math.max(...counts);
  const skewRatio = Number((maxCount / avg).toFixed(2));

  const normLookup = lookupDistrict.trim().toLowerCase();
  const checkBloom = (bf: Uint8Array) => {
    if (!normLookup) return false;
    for (let k = 0; k < hashCount; k++) {
      const bit = fnvHash(normLookup, (k + 1) * 97) % bitSize;
      if (bf[bit] !== 1) return false;
    }
    return true;
  };

  let matchingBlocks = 0;
  for (const bf of blockFilters.values()) {
    if (checkBloom(bf)) matchingBlocks++;
  }

  const setBits = globalFilter.reduce((s, b) => s + b, 0);

  return {
    numPartitions: safePartitions,
    totalKeys: counts.reduce((s, c) => s + c, 0),
    skewRatio,
    partitions: partMap.map((p, idx) => ({
      partitionId: idx,
      recordCount: p.recordCount,
      districts: Array.from(p.districts),
    })),
    bloomFilter: {
      bitArraySize: bitSize,
      hashFunctions: hashCount,
      setBits,
      fillRatioPct: Number(((setBits / bitSize) * 100).toFixed(1)),
      lookupKey: lookupDistrict,
      mightContain: checkBloom(globalFilter),
      blocksPruned: Math.max(0, blocks.length - matchingBlocks),
      totalBlocks: blocks.length,
    },
  };
}

// ==========================================================
// 4. BATCH TELEMETRY INGESTION (FOR BIG DATA SCALE TESTING)
// ==========================================================

export function ingestSyntheticBatch(count = 12) {
  const safeCount = Math.max(1, Math.min(100, count));
  const ids = distributedStore.allocateIds('water_records', safeCount);
  const now = new Date().toISOString();
  const qualities = ['Good', 'Moderate TDS', 'Hard Water', 'Needs Testing'];
  const wards = ['North Sector', 'Central Ward', 'Canal Zone', 'Rural Block', 'East Grid'];

  const records: WaterRecordEntity[] = ids.map((id, i) => {
    const dist = KARNATAKA_DISTRICTS[(id + i) % KARNATAKA_DISTRICTS.length];
    const ward = wards[(id + i) % wards.length];
    const demand = 600000 + ((id * 17389) % 1800000);
    const ratio = 0.45 + (((id * 37) % 60) / 100);
    const supply = Math.round(demand * ratio);
    const consumed = Math.round(supply * 0.94);

    return {
      id,
      district: dist,
      area: `${dist} ${ward}`,
      water_demand: demand,
      water_supply: supply,
      water_consumed: consumed,
      water_level: 25 + ((id * 19) % 70),
      water_quality: qualities[(id + i) % qualities.length],
      recorded_at: now,
      uploaded_at: now,
      source_filename: `batch_stream_${crypto.randomBytes(2).toString('hex')}.jsonl`,
    };
  });

  const blocks = distributedStore.appendRecordsToCollection('water_records', records);
  return {
    recordsCreated: records.length,
    blocksCreated: blocks.length,
    blockIds: blocks.map((b) => b.blockId),
  };
}
