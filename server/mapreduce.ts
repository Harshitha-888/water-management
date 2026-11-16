import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import {
  distributedStore,
  EmergencyRequestEntity,
  MaintenanceTaskEntity,
  ReservoirEntity,
  StorageCollection,
  TransportDeliveryEntity,
  WaterRecordEntity,
} from './distributedStore';

export interface MapSplitTrace {
  taskId?: string;
  blockId: string;
  nodeServed: string;
  usedReplicaFailover: boolean;
  inputRecords: number;
  emittedPairs: number;
  durationMs: number;
  status: 'completed' | 'unavailable';
  error?: string;
}

export interface ShufflePartitionTrace {
  partitionId: number;
  keyCount: number;
  totalValues: number;
  sampleKeys: string[];
}

export interface ReducerTaskTrace {
  taskId: string;
  partitionId: number;
  nodeAssigned: string;
  keysProcessed: number;
  valuesReduced: number;
  outputRecords: number;
  durationMs: number;
  status: 'completed' | 'failed';
}

export interface YarnApplicationTrace {
  applicationId: string;
  queue: string;
  amNode: string;
  state: 'FINISHED';
  finalStatus: 'SUCCEEDED' | 'DEGRADED';
  containersAllocated: number;
  allocatedMemoryMb: number;
  allocatedVCores: number;
}

export interface MapReduceAnalysisReport {
  title: string;
  executiveSummary: string;
  keyFindings: string[];
  highlights: Array<{ label: string; value: string }>;
}

export interface MapReduceJobTrace {
  jobId: string;
  jobType: string;
  label: string;
  startedAt: string;
  durationMs: number;
  inputSplits: number;
  recordsScanned: number;
  mapEmits: number;
  shuffleKeys: number;
  reduceOutputs: number;
  replicaFailovers: number;
  unavailableBlocks: number;
  numReducers: number;
  implementationEngine: 'python' | 'native';
  runtimeLabel: string;
  mapperStatus: {
    total: number;
    succeeded: number;
    failed: number;
    failoverCount: number;
    statusLabel: string;
  };
  reducerStatus: {
    total: number;
    succeeded: number;
    failed: number;
    statusLabel: string;
  };
  phaseTimings: {
    mapMs: number;
    shuffleMs: number;
    reduceMs: number;
  };
  hdfsInfo: {
    clusterName: string;
    collection: StorageCollection;
    blocksRead: number;
    replicationFactor: number;
    bytesScanned: number;
  };
  yarnApp: YarnApplicationTrace;
  reducerTasks: ReducerTaskTrace[];
  mapPhase: MapSplitTrace[];
  shufflePhase: ShufflePartitionTrace[];
  results: Record<string, unknown>[];
  analysisReport: MapReduceAnalysisReport;
}

export type MapReduceJobType =
  | 'district_water_balance'
  | 'area_consumption_rollup'
  | 'shortage_hotspots'
  | 'usage_period_rollup'
  | 'distributed_retrieval'
  | 'basin_reservoir_summary'
  | 'reservoir_level_avg'
  | 'emergency_area_summary'
  | 'transport_delivery_summary'
  | 'maintenance_priority_summary';

export interface MapReduceQueryParams {
  jobType: MapReduceJobType;
  district?: string;
  search?: string;
  minShortage?: number;
  quality?: string;
  period?: 'daily' | 'weekly' | 'monthly';
  numReducers?: number;
  engine?: 'python' | 'native';
}

function hashKey(key: string, mod: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % mod;
}

const jobHistory: MapReduceJobTrace[] = [];
let yarnAppSeq = 1;

export function getMapReduceJobHistory(): MapReduceJobTrace[] {
  return jobHistory.slice(0, 30);
}

export function getLatestProcessedResults(): Array<
  Record<string, unknown> & {
    _job_id: string;
    _job_type: string;
    _runtime: string;
  }
> {
  const latest = jobHistory[0];
  if (!latest) return [];
  return latest.results.map((r) => ({
    ...r,
    _job_id: latest.jobId,
    _job_type: latest.jobType,
    _runtime: latest.runtimeLabel,
  }));
}

export function getYarnClusterStatus() {
  const cluster = distributedStore.getClusterStatus();
  const totalJobs = jobHistory.length;
  const succeededJobs = jobHistory.filter(
    (j) => j.yarnApp.finalStatus === 'SUCCEEDED'
  ).length;
  const avgDurationMs = totalJobs
    ? Number(
        (
          jobHistory.reduce((s, j) => s + j.durationMs, 0) / totalJobs
        ).toFixed(2)
      )
    : 0;
  const totalInputRecords = jobHistory.reduce(
    (s, j) => s + j.recordsScanned,
    0
  );
  const totalOutputRecords = jobHistory.reduce(
    (s, j) => s + j.reduceOutputs,
    0
  );

  const memoryPerNodeMb = 8192;
  const vCoresPerNode = 4;
  const onlineNodes = cluster.nodes.filter((n) => n.status === 'online');

  return {
    resourceManager: {
      framework: 'Apache Hadoop YARN 3.3',
      status: onlineNodes.length > 0 ? 'ACTIVE' : 'DEGRADED',
      scheduler: 'CapacityScheduler (default queue)',
      totalMemoryMb: onlineNodes.length * memoryPerNodeMb,
      totalVCores: onlineNodes.length * vCoresPerNode,
      activeNodeManagers: onlineNodes.length,
      totalNodeManagers: cluster.nodes.length,
      totalApplications: totalJobs,
      succeededApplications: succeededJobs,
      avgJobDurationMs: avgDurationMs,
      totalInputRecordsProcessed: totalInputRecords,
      totalOutputRecordsEmitted: totalOutputRecords,
    },
    nodeManagers: cluster.nodes.map((n, idx) => ({
      nodeId: n.id,
      name: n.name,
      host: `${n.host}:8042`,
      region: n.region,
      state: n.status === 'online' ? 'RUNNING' : 'LOST',
      memoryTotalMb: memoryPerNodeMb,
      vCoresTotal: vCoresPerNode,
      containersExecuted: jobHistory.reduce(
        (sum, j) =>
          sum +
          j.mapPhase.filter((m) => m.nodeServed === n.id).length +
          j.reducerTasks.filter((r) => r.nodeAssigned === n.id).length +
          (idx === 0 ? 1 : 0),
        0
      ),
    })),
    recentApplications: jobHistory.slice(0, 12).map((j) => ({
      applicationId: j.yarnApp.applicationId,
      jobId: j.jobId,
      name: j.label,
      jobType: j.jobType,
      engine: j.runtimeLabel,
      state: j.yarnApp.state,
      finalStatus: j.yarnApp.finalStatus,
      containers: j.yarnApp.containersAllocated,
      memoryMb: j.yarnApp.allocatedMemoryMb,
      vCores: j.yarnApp.allocatedVCores,
      durationMs: j.durationMs,
      startedAt: j.startedAt,
    })),
  };
}

function recordJobTrace(trace: MapReduceJobTrace) {
  jobHistory.unshift(trace);
  if (jobHistory.length > 30) {
    jobHistory.length = 30;
  }
}

function buildAnalysisReport(
  jobType: MapReduceJobType,
  results: Record<string, unknown>[],
  recordsScanned: number,
  durationMs: number
): MapReduceAnalysisReport {
  if (!results.length) {
    return {
      title: 'MapReduce Data Analysis Report',
      executiveSummary: `Scanned ${recordsScanned} HDFS input records in ${durationMs} ms with 0 reduced output groups matching the filter criteria.`,
      keyFindings: [
        'No records satisfied the mapper predicate for this job execution.',
        'Try broadening district or shortage filters and re-running the MapReduce pipeline.',
      ],
      highlights: [
        { label: 'Records Scanned', value: String(recordsScanned) },
        { label: 'Output Groups', value: '0' },
        { label: 'Runtime', value: `${durationMs} ms` },
      ],
    };
  }

  switch (jobType) {
    case 'district_water_balance': {
      const totalDemand = results.reduce((s, r) => s + Number(r.total_demand || 0), 0);
      const totalSupply = results.reduce((s, r) => s + Number(r.total_supply || 0), 0);
      const totalShortage = results.reduce((s, r) => s + Number(r.shortage || 0), 0);
      const deficitDistricts = results.filter((r) => r.status === 'Shortage');
      const top = results[0];
      const overallCov = totalDemand > 0 ? ((totalSupply / totalDemand) * 100).toFixed(1) : '100.0';
      return {
        title: 'Karnataka District Water Balance Report',
        executiveSummary: `Aggregated ${recordsScanned} HDFS water telemetry records across ${results.length} districts in ${durationMs} ms. Statewide supply coverage stands at ${overallCov}% with a net shortage of ${totalShortage.toLocaleString()} L.`,
        keyFindings: [
          `${deficitDistricts.length} of ${results.length} districts are currently operating in Shortage (<60% supply coverage).`,
          `Highest deficit recorded in ${top.district}: ${Number(top.shortage || 0).toLocaleString()} L shortfall (${top.coverage_pct}% coverage across ${top.areas_count} areas).`,
          `Total aggregated demand is ${totalDemand.toLocaleString()} L against ${totalSupply.toLocaleString()} L supplied.`,
        ],
        highlights: [
          { label: 'Districts Analyzed', value: String(results.length) },
          { label: 'Overall Supply Coverage', value: `${overallCov}%` },
          { label: 'Deficit Districts', value: String(deficitDistricts.length) },
          { label: 'Peak District Shortage', value: `${top.district} (${Number(top.shortage || 0).toLocaleString()} L)` },
        ],
      };
    }

    case 'area_consumption_rollup': {
      const shortageAreas = results.filter((r) => Number(r.shortage_l || 0) > 0);
      const totalConsumed = results.reduce((s, r) => s + Number(r.water_consumption_l || 0), 0);
      const top = results[0];
      return {
        title: 'Area-Wise Water Consumption & Shortage Report',
        executiveSummary: `Evaluated ${results.length} distinct Karnataka municipal areas from ${recordsScanned} HDFS records in ${durationMs} ms. Cumulative latest consumption totals ${totalConsumed.toLocaleString()} L.`,
        keyFindings: [
          `${shortageAreas.length} areas experience an active demand-supply deficit.`,
          `Top priority area: ${top.area} (${top.district}) with ${Number(top.shortage_l || 0).toLocaleString()} L shortage (${top.coverage_pct}% coverage).`,
          `Consumption and supply snapshots were deduplicated per area inside the Reducer stage.`,
        ],
        highlights: [
          { label: 'Unique Areas', value: String(results.length) },
          { label: 'Shortage Areas', value: String(shortageAreas.length) },
          { label: 'Latest Consumption', value: `${totalConsumed.toLocaleString()} L` },
          { label: 'Highest Deficit Area', value: String(top.area) },
        ],
      };
    }

    case 'shortage_hotspots': {
      const totalShortage = results.reduce((s, r) => s + Number(r.total_shortage || 0), 0);
      const totalAreas = results.reduce((s, r) => s + Number(r.area_count || 0), 0);
      const crit = results.find((r) => r.severity_tier === 'Critical Deficit');
      return {
        title: 'Water Deficit Severity Tier Analysis',
        executiveSummary: `Classified ${totalAreas} area observations into ${results.length} severity tiers totaling ${totalShortage.toLocaleString()} L deficit across HDFS shards.`,
        keyFindings: [
          crit
            ? `Critical Deficit tier (<60% coverage) contains ${crit.area_count} records accounting for ${Number(crit.total_shortage || 0).toLocaleString()} L shortage.`
            : 'No records fell into the Critical Deficit (<60% coverage) tier.',
          `Mapper filtered records above the shortage threshold before hash partitioning by severity tier.`,
        ],
        highlights: [
          { label: 'Severity Tiers', value: String(results.length) },
          { label: 'Flagged Observations', value: String(totalAreas) },
          { label: 'Cumulative Deficit', value: `${totalShortage.toLocaleString()} L` },
        ],
      };
    }

    case 'basin_reservoir_summary':
    case 'reservoir_level_avg': {
      const isBasin = jobType === 'basin_reservoir_summary';
      const avgFill = (
        results.reduce(
          (s, r) => s + Number(isBasin ? r.avg_percentage_full : r.current_fill_pct || 0),
          0
        ) / results.length
      ).toFixed(1);
      const lowCount = isBasin
        ? results.filter((r) => Number(r.avg_percentage_full || 0) < 55).length
        : results.filter((r) => Number(r.current_fill_pct || 0) < 55).length;
      return {
        title: isBasin ? 'River Basin Storage Report' : 'Reservoir Historical Level Report',
        executiveSummary: `Processed ${recordsScanned} HDFS reservoir telemetry rows across ${results.length} ${isBasin ? 'river basins' : 'reservoirs'} in ${durationMs} ms with mean storage fill at ${avgFill}%.`,
        keyFindings: [
          `${lowCount} ${isBasin ? 'basins' : 'reservoirs'} are below the 55% storage advisory threshold.`,
          `Lowest fill recorded at ${isBasin ? results[results.length - 1]?.basin : results[0]?.reservoir_name}.`,
        ],
        highlights: [
          { label: isBasin ? 'Basins' : 'Reservoirs', value: String(results.length) },
          { label: 'Average Fill', value: `${avgFill}%` },
          { label: 'Low-Level Advisories', value: String(lowCount) },
        ],
      };
    }

    case 'emergency_area_summary': {
      const totalReqs = results.reduce((s, r) => s + Number(r.request_count || 0), 0);
      const pending = results.reduce((s, r) => s + Number(r.pending_count || 0), 0);
      const top = results[0];
      return {
        title: 'Emergency Water Requests Area Report',
        executiveSummary: `Grouped ${totalReqs} HDFS emergency requests across ${results.length} areas; ${pending} requests remain Pending dispatch.`,
        keyFindings: [
          `Highest emergency concentration at ${top.area} (${top.district}) with ${top.request_count} requests (${top.top_emergency_type}).`,
          `Total emergency water quantity demanded: ${results.reduce((s, r) => s + Number(r.total_required_l || 0), 0).toLocaleString()} L.`,
        ],
        highlights: [
          { label: 'Affected Areas', value: String(results.length) },
          { label: 'Total Requests', value: String(totalReqs) },
          { label: 'Pending Dispatch', value: String(pending) },
        ],
      };
    }

    case 'transport_delivery_summary': {
      const totalDeliveries = results.reduce((s, r) => s + Number(r.delivery_count || 0), 0);
      const totalWater = results.reduce((s, r) => s + Number(r.total_water_l || 0), 0);
      const top = results[0];
      return {
        title: 'Tanker Water Transportation Report',
        executiveSummary: `Reduced ${totalDeliveries} tanker delivery records into ${results.length} destination corridors carrying ${totalWater.toLocaleString()} L of water.`,
        keyFindings: [
          `Highest tanker volume dispatched to ${top.destination_area} (${top.district}): ${Number(top.total_water_l || 0).toLocaleString()} L.`,
          `Average transit ETA across destination corridors is ${Math.round(results.reduce((s, r) => s + Number(r.avg_eta_min || 0), 0) / results.length)} mins.`,
        ],
        highlights: [
          { label: 'Corridors', value: String(results.length) },
          { label: 'Total Dispatches', value: String(totalDeliveries) },
          { label: 'Total Water Transported', value: `${totalWater.toLocaleString()} L` },
        ],
      };
    }

    case 'maintenance_priority_summary': {
      const totalTasks = results.reduce((s, r) => s + Number(r.total_tasks || 0), 0);
      const openTasks = results.reduce((s, r) => s + Number(r.open_tasks || 0), 0);
      const savedLpd = results.reduce((s, r) => s + Number(r.water_saved_lpd || 0), 0);
      const top = results[0];
      return {
        title: 'Water Maintenance Operations & Loss Prevention Report',
        executiveSummary: `Aggregated ${totalTasks} HDFS maintenance work orders into ${results.length} operational categories protecting ${savedLpd.toLocaleString()} L/day of water supply.`,
        keyFindings: [
          `${openTasks} maintenance work orders are currently open (${results.reduce((s, r) => s + Number(r.urgent_open || 0), 0)} Critical/High priority).`,
          `Highest water recovery potential in ${top.maintenance_type}: ${Number(top.water_saved_lpd || 0).toLocaleString()} L/day saved across ${top.total_tasks} tasks.`,
        ],
        highlights: [
          { label: 'Categories', value: String(results.length) },
          { label: 'Open Work Orders', value: String(openTasks) },
          { label: 'Water Loss Prevented', value: `${savedLpd.toLocaleString()} L/day` },
        ],
      };
    }

    default: {
      return {
        title: 'MapReduce Distributed Processing Report',
        executiveSummary: `Scanned ${recordsScanned} HDFS input records and produced ${results.length} reduced output records in ${durationMs} ms.`,
        keyFindings: [
          `All HDFS block splits were processed cleanly through Map, Shuffle & Sort, and Reduce phases.`,
          `Top record output: ${Object.entries(results[0]).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
        ],
        highlights: [
          { label: 'Input Records', value: String(recordsScanned) },
          { label: 'Output Records', value: String(results.length) },
          { label: 'Processing Time', value: `${durationMs} ms` },
        ],
      };
    }
  }
}

function finalizeJobTrace(params: {
  jobType: MapReduceJobType;
  label: string;
  collection: StorageCollection;
  numReducers: number;
  startedAt: string;
  durationMs: number;
  bytesScanned: number;
  recordsScanned: number;
  mapEmits: number;
  shuffleKeys: number;
  replicaFailovers: number;
  unavailableBlocks: number;
  mapPhase: MapSplitTrace[];
  shufflePhase: ShufflePartitionTrace[];
  reducerTasks: ReducerTaskTrace[];
  phaseTimings: { mapMs: number; shuffleMs: number; reduceMs: number };
  results: Record<string, unknown>[];
  implementationEngine: 'python' | 'native';
  runtimeLabel: string;
  recordTrace?: boolean;
}): MapReduceJobTrace {
  const cluster = distributedStore.getClusterStatus();
  const mappersSucceeded = params.mapPhase.filter((m) => m.status === 'completed').length;
  const mappersFailed = params.mapPhase.length - mappersSucceeded;
  const reducersSucceeded = params.reducerTasks.filter((r) => r.status === 'completed').length;
  const reducersFailed = params.reducerTasks.length - reducersSucceeded;

  const containersAllocated = 1 + params.mapPhase.length + params.numReducers;
  const appId = `application_${Math.floor(Date.now() / 1000)}_${String(yarnAppSeq++).padStart(4, '0')}`;

  const trace: MapReduceJobTrace = {
    jobId: `mr_${crypto.randomBytes(4).toString('hex')}`,
    jobType: params.jobType,
    label: params.label,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    inputSplits: params.mapPhase.length,
    recordsScanned: params.recordsScanned,
    mapEmits: params.mapEmits,
    shuffleKeys: params.shuffleKeys,
    reduceOutputs: params.results.length,
    replicaFailovers: params.replicaFailovers,
    unavailableBlocks: params.unavailableBlocks,
    numReducers: params.numReducers,
    implementationEngine: params.implementationEngine,
    runtimeLabel: params.runtimeLabel,
    mapperStatus: {
      total: params.mapPhase.length,
      succeeded: mappersSucceeded,
      failed: mappersFailed,
      failoverCount: params.replicaFailovers,
      statusLabel:
        mappersFailed > 0
          ? `Degraded (${mappersSucceeded}/${params.mapPhase.length} Succeeded)`
          : params.replicaFailovers > 0
          ? `Succeeded (${params.replicaFailovers} Replica Failover)`
          : `Succeeded (${mappersSucceeded}/${params.mapPhase.length})`,
    },
    reducerStatus: {
      total: params.reducerTasks.length,
      succeeded: reducersSucceeded,
      failed: reducersFailed,
      statusLabel:
        reducersFailed > 0
          ? `Partial (${reducersSucceeded}/${params.reducerTasks.length})`
          : `Succeeded (${reducersSucceeded}/${params.reducerTasks.length})`,
    },
    phaseTimings: params.phaseTimings,
    hdfsInfo: {
      clusterName: cluster.clusterName,
      collection: params.collection,
      blocksRead: mappersSucceeded,
      replicationFactor: cluster.replicationFactor,
      bytesScanned: params.bytesScanned,
    },
    yarnApp: {
      applicationId: appId,
      queue: 'default',
      amNode: cluster.nodes.find((n) => n.status === 'online')?.id || 'node-01',
      state: 'FINISHED',
      finalStatus: mappersFailed > 0 || reducersFailed > 0 ? 'DEGRADED' : 'SUCCEEDED',
      containersAllocated,
      allocatedMemoryMb: containersAllocated * 512,
      allocatedVCores: containersAllocated,
    },
    reducerTasks: params.reducerTasks,
    mapPhase: params.mapPhase,
    shufflePhase: params.shufflePhase,
    results: params.results,
    analysisReport: buildAnalysisReport(
      params.jobType,
      params.results,
      params.recordsScanned,
      params.durationMs
    ),
  };

  if (params.recordTrace !== false) {
    recordJobTrace(trace);
  }

  return trace;
}

export function executeMapReduce<TInput, TVal, TOut extends Record<string, unknown>>(
  options: {
    jobType: MapReduceJobType;
    label: string;
    collection: StorageCollection;
    numReducers?: number;
    mapper: (record: TInput, emit: (key: string, value: TVal) => void) => void;
    reducer: (key: string, values: TVal[]) => TOut | null;
    sortResults?: (a: TOut, b: TOut) => number;
    recordTrace?: boolean;
  }
): MapReduceJobTrace {
  const jobStart = performance.now();
  const startedAt = new Date().toISOString();
  const numReducers = Math.max(1, Math.min(8, options.numReducers ?? 4));
  const blocks = distributedStore.getBlocks(options.collection);

  const mapStart = performance.now();
  const mapPhase: MapSplitTrace[] = [];
  const emittedPairs: Array<{ key: string; value: TVal }> = [];
  let recordsScanned = 0;
  let bytesScanned = 0;
  let replicaFailovers = 0;
  let unavailableBlocks = 0;

  blocks.forEach((block, idx) => {
    const splitStart = performance.now();
    const read = distributedStore.readBlockWithFailover<TInput>(block);

    if (read.status === 'unavailable') {
      unavailableBlocks++;
      mapPhase.push({
        taskId: `m_${String(idx).padStart(4, '0')}`,
        blockId: block.blockId,
        nodeServed: read.nodeServed,
        usedReplicaFailover: false,
        inputRecords: block.recordCount,
        emittedPairs: 0,
        durationMs: Number((performance.now() - splitStart).toFixed(2)),
        status: 'unavailable',
        error: read.error,
      });
      return;
    }

    bytesScanned += block.sizeBytes;
    if (read.usedReplicaFailover) {
      replicaFailovers++;
    }

    let splitEmits = 0;
    const emit = (key: string, value: TVal) => {
      emittedPairs.push({ key, value });
      splitEmits++;
    };

    for (const rec of read.records) {
      recordsScanned++;
      options.mapper(rec, emit);
    }

    mapPhase.push({
      taskId: `m_${String(idx).padStart(4, '0')}`,
      blockId: block.blockId,
      nodeServed: read.nodeServed,
      usedReplicaFailover: read.usedReplicaFailover,
      inputRecords: read.records.length,
      emittedPairs: splitEmits,
      durationMs: Number((performance.now() - splitStart).toFixed(2)),
      status: 'completed',
    });
  });
  const mapMs = Number((performance.now() - mapStart).toFixed(2));

  const shuffleStart = performance.now();
  const partitions: Array<Map<string, TVal[]>> = Array.from(
    { length: numReducers },
    () => new Map<string, TVal[]>()
  );

  for (const pair of emittedPairs) {
    const pIdx = hashKey(pair.key, numReducers);
    const bucket = partitions[pIdx];
    const existing = bucket.get(pair.key);
    if (existing) {
      existing.push(pair.value);
    } else {
      bucket.set(pair.key, [pair.value]);
    }
  }

  const shufflePhase: ShufflePartitionTrace[] = partitions.map(
    (bucket, partitionId) => {
      const sortedKeys = Array.from(bucket.keys()).sort();
      const totalValues = sortedKeys.reduce(
        (sum, k) => sum + (bucket.get(k)?.length ?? 0),
        0
      );
      return {
        partitionId,
        keyCount: sortedKeys.length,
        totalValues,
        sampleKeys: sortedKeys.slice(0, 5),
      };
    }
  );
  const shuffleMs = Number((performance.now() - shuffleStart).toFixed(2));

  const reduceStart = performance.now();
  const results: TOut[] = [];
  const nodeIds = ['node-01', 'node-02', 'node-03', 'node-04'];
  const reducerTasks: ReducerTaskTrace[] = [];

  partitions.forEach((bucket, pIdx) => {
    const rStart = performance.now();
    const sortedKeys = Array.from(bucket.keys()).sort();
    let valuesReduced = 0;
    let outputRecords = 0;
    for (const key of sortedKeys) {
      const vals = bucket.get(key) || [];
      valuesReduced += vals.length;
      const reduced = options.reducer(key, vals);
      if (reduced !== null) {
        results.push(reduced);
        outputRecords++;
      }
    }
    reducerTasks.push({
      taskId: `r_${String(pIdx).padStart(4, '0')}`,
      partitionId: pIdx,
      nodeAssigned: nodeIds[pIdx % nodeIds.length],
      keysProcessed: sortedKeys.length,
      valuesReduced,
      outputRecords,
      durationMs: Number((performance.now() - rStart).toFixed(2)),
      status: 'completed',
    });
  });

  if (options.sortResults) {
    results.sort(options.sortResults);
  }
  const reduceMs = Number((performance.now() - reduceStart).toFixed(2));
  const durationMs = Number((performance.now() - jobStart).toFixed(2));
  const totalUniqueKeys = shufflePhase.reduce((s, p) => s + p.keyCount, 0);

  return finalizeJobTrace({
    jobType: options.jobType,
    label: options.label,
    collection: options.collection,
    numReducers,
    startedAt,
    durationMs,
    bytesScanned,
    recordsScanned,
    mapEmits: emittedPairs.length,
    shuffleKeys: totalUniqueKeys,
    replicaFailovers,
    unavailableBlocks,
    mapPhase,
    shufflePhase,
    reducerTasks,
    phaseTimings: { mapMs, shuffleMs, reduceMs },
    results,
    implementationEngine: 'native',
    runtimeLabel: 'Apache Hadoop Native (Node Engine)',
    recordTrace: options.recordTrace,
  });
}

function getJobMetadata(jobType: MapReduceJobType, params: MapReduceQueryParams): {
  label: string;
  collection: StorageCollection;
  sortResults: (a: Record<string, unknown>, b: Record<string, unknown>) => number;
} {
  switch (jobType) {
    case 'district_water_balance':
      return {
        label: 'District Water Balance Aggregation (Latest Snapshot per Area)',
        collection: 'water_records',
        sortResults: (a, b) => Number(b.shortage) - Number(a.shortage),
      };
    case 'area_consumption_rollup':
      return {
        label: 'Area-Wise Water Consumption & Shortage Aggregation',
        collection: 'water_records',
        sortResults: (a, b) =>
          Number(b.shortage_l) - Number(a.shortage_l) ||
          Number(b.water_consumption_l) - Number(a.water_consumption_l),
      };
    case 'shortage_hotspots':
      return {
        label: 'Water Deficit & Priority Hotspot Retrieval',
        collection: 'water_records',
        sortResults: (a, b) => Number(b.total_shortage) - Number(a.total_shortage),
      };
    case 'usage_period_rollup':
      return {
        label: `Temporal Usage & Requirement Rollup (${params.period ?? 'monthly'})`,
        collection: 'water_records',
        sortResults: (a, b) =>
          String(b.observation_date).localeCompare(String(a.observation_date)),
      };
    case 'distributed_retrieval':
      return {
        label: 'Distributed Predicate Scan & Record Retrieval',
        collection: 'water_records',
        sortResults: (a, b) => Number(b.shortage) - Number(a.shortage),
      };
    case 'basin_reservoir_summary':
      return {
        label: 'Reservoir Storage & Inflow/Outflow Aggregation by Basin',
        collection: 'reservoirs',
        sortResults: (a, b) =>
          Number(b.total_live_capacity) - Number(a.total_live_capacity),
      };
    case 'reservoir_level_avg':
      return {
        label: 'Reservoir Average Water Level & Storage Aggregation (HDFS Shards)',
        collection: 'reservoirs',
        sortResults: (a, b) =>
          Number(a.current_fill_pct) - Number(b.current_fill_pct),
      };
    case 'emergency_area_summary':
      return {
        label: 'Emergency Water Requests Analysis by Area (HDFS Shards)',
        collection: 'emergency_requests',
        sortResults: (a, b) =>
          Number(b.pending_count) - Number(a.pending_count) ||
          Number(b.request_count) - Number(a.request_count) ||
          Number(b.total_required_l) - Number(a.total_required_l),
      };
    case 'transport_delivery_summary':
      return {
        label: 'Tanker Transportation & Delivery Analysis by Destination (HDFS Shards)',
        collection: 'transport_deliveries',
        sortResults: (a, b) =>
          Number(b.total_water_l) - Number(a.total_water_l) ||
          Number(b.delivery_count) - Number(a.delivery_count),
      };
    case 'maintenance_priority_summary':
      return {
        label: 'Water Maintenance Work Orders & Loss Prevention Summary (HDFS Shards)',
        collection: 'maintenance_tasks',
        sortResults: (a, b) =>
          Number(b.water_saved_lpd) - Number(a.water_saved_lpd) ||
          Number(b.open_tasks) - Number(a.open_tasks),
      };
  }
}

export async function runWaterMapReduceJobWithPython(
  params: MapReduceQueryParams
): Promise<MapReduceJobTrace> {
  if (params.engine === 'native') {
    return runWaterMapReduceJob(params);
  }

  const jobStart = performance.now();
  const startedAt = new Date().toISOString();
  const numReducers = Math.max(1, Math.min(8, params.numReducers ?? 4));
  const meta = getJobMetadata(params.jobType, params);
  const blocks = distributedStore.getBlocks(meta.collection);

  let latestTsMs = 0;
  let cutoffTsMs = 0;
  if (params.jobType === 'usage_period_rollup') {
    const all = distributedStore.readAllRecords<WaterRecordEntity>('water_records');
    latestTsMs = all.reduce((max, r) => {
      const ts = new Date(r.recorded_at || r.uploaded_at || 0).getTime();
      return ts > max ? ts : max;
    }, 0);
    const period = params.period ?? 'monthly';
    const windowDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
    cutoffTsMs = latestTsMs - windowDays * 24 * 60 * 60 * 1000;
  }

  let bytesScanned = 0;
  let replicaFailovers = 0;
  let unavailableBlocks = 0;

  const splits = blocks.map((block) => {
    const read = distributedStore.readBlockWithFailover<Record<string, unknown>>(block);
    if (read.status === 'unavailable') {
      unavailableBlocks++;
      return {
        blockId: block.blockId,
        nodeServed: read.nodeServed,
        usedReplicaFailover: false,
        inputRecords: block.recordCount,
        status: 'unavailable',
        error: read.error,
        records: [],
      };
    }
    bytesScanned += block.sizeBytes;
    if (read.usedReplicaFailover) replicaFailovers++;

    const enrichedRecords =
      params.jobType === 'usage_period_rollup'
        ? read.records.map((r) => ({
            ...r,
            _tsMs: new Date(
              String(r.recorded_at || r.uploaded_at || 0)
            ).getTime(),
          }))
        : read.records;

    return {
      blockId: block.blockId,
      nodeServed: read.nodeServed,
      usedReplicaFailover: read.usedReplicaFailover,
      inputRecords: read.records.length,
      status: 'completed',
      records: enrichedRecords,
    };
  });

  const scriptPath = path.resolve(process.cwd(), 'server', 'mr_worker.py');
  const pythonOutput = await new Promise<{
    runtime: string;
    recordsScanned: number;
    mapEmits: number;
    shuffleKeys: number;
    mapPhase: MapSplitTrace[];
    shufflePhase: ShufflePartitionTrace[];
    reducerTasks: ReducerTaskTrace[];
    timings: { mapMs: number; shuffleMs: number; reduceMs: number };
    results: Record<string, unknown>[];
  }>((resolve, reject) => {
    const child = spawn('python3', [scriptPath]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `mr_worker.py exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.write(
      JSON.stringify({
        jobType: params.jobType,
        numReducers,
        params: {
          district: params.district,
          search: params.search,
          minShortage: params.minShortage,
          quality: params.quality,
          period: params.period,
          latestTsMs,
          cutoffTsMs,
        },
        splits,
      })
    );
    child.stdin.end();
  });

  const sortedResults = [...pythonOutput.results].sort(meta.sortResults);
  const durationMs = Number((performance.now() - jobStart).toFixed(2));

  return finalizeJobTrace({
    jobType: params.jobType,
    label: meta.label,
    collection: meta.collection,
    numReducers,
    startedAt,
    durationMs,
    bytesScanned,
    recordsScanned: pythonOutput.recordsScanned,
    mapEmits: pythonOutput.mapEmits,
    shuffleKeys: pythonOutput.shuffleKeys,
    replicaFailovers,
    unavailableBlocks,
    mapPhase: pythonOutput.mapPhase,
    shufflePhase: pythonOutput.shufflePhase,
    reducerTasks: pythonOutput.reducerTasks,
    phaseTimings: pythonOutput.timings,
    results: sortedResults,
    implementationEngine: 'python',
    runtimeLabel: pythonOutput.runtime,
    recordTrace: true,
  });
}

export function runWaterMapReduceJob(
  params: MapReduceQueryParams
): MapReduceJobTrace {
  const numReducers = params.numReducers ?? 4;

  switch (params.jobType) {
    case 'district_water_balance': {
      return executeMapReduce<
        WaterRecordEntity,
        WaterRecordEntity,
        Record<string, unknown>
      >({
        jobType: 'district_water_balance',
        label: 'District Water Balance Aggregation (Latest Snapshot per Area)',
        collection: 'water_records',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          emit(record.district.trim(), record);
        },
        reducer: (district, records) => {
          const latestByArea = new Map<string, WaterRecordEntity>();
          for (const rec of records) {
            const areaKey = (rec.area || rec.district).trim().toLowerCase();
            const existing = latestByArea.get(areaKey);
            const currTime = new Date(
              rec.recorded_at || rec.uploaded_at || 0
            ).getTime();
            const prevTime = existing
              ? new Date(
                  existing.recorded_at || existing.uploaded_at || 0
                ).getTime()
              : -1;
            if (
              !existing ||
              currTime > prevTime ||
              (currTime === prevTime && rec.id > existing.id)
            ) {
              latestByArea.set(areaKey, rec);
            }
          }

          const latest = Array.from(latestByArea.values());
          const demand = latest.reduce((s, r) => s + (r.water_demand || 0), 0);
          const supply = latest.reduce((s, r) => s + (r.water_supply || 0), 0);
          const shortage = latest.reduce(
            (s, r) => s + Math.max((r.water_demand || 0) - (r.water_supply || 0), 0),
            0
          );
          const consumedVals = latest
            .map((r) => r.water_consumed)
            .filter((v): v is number => v !== null && v !== undefined);
          const consumed = consumedVals.length
            ? consumedVals.reduce((s, v) => s + v, 0)
            : null;
          const coveragePct =
            demand > 0 ? Number(((supply / demand) * 100).toFixed(1)) : 0;
          const status =
            demand <= 0
              ? 'No Demand Data'
              : coveragePct >= 90
              ? 'Sufficient'
              : coveragePct >= 60
              ? 'Moderate'
              : 'Shortage';

          return {
            district,
            areas_count: latest.length,
            total_records: records.length,
            total_demand: Math.round(demand),
            total_supply: Math.round(supply),
            shortage: Math.round(shortage),
            total_consumed: consumed !== null ? Math.round(consumed) : null,
            coverage_pct: coveragePct,
            status,
          };
        },
        sortResults: (a, b) => Number(b.shortage) - Number(a.shortage),
      });
    }

    case 'shortage_hotspots': {
      const minShortage = Number(params.minShortage ?? 0);
      return executeMapReduce<
        WaterRecordEntity,
        WaterRecordEntity & { shortage: number; coveragePct: number },
        Record<string, unknown>
      >({
        jobType: 'shortage_hotspots',
        label: 'Water Deficit & Priority Hotspot Retrieval',
        collection: 'water_records',
        numReducers,
        mapper: (record, emit) => {
          const shortage = Math.max(
            (record.water_demand || 0) - (record.water_supply || 0),
            0
          );
          if (shortage < minShortage) return;
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          const coveragePct =
            record.water_demand > 0
              ? Number(
                  ((record.water_supply / record.water_demand) * 100).toFixed(1)
                )
              : 100;
          const tier =
            shortage <= 0
              ? 'Sufficient'
              : coveragePct < 60
              ? 'Critical Deficit'
              : coveragePct < 80
              ? 'High Deficit'
              : 'Moderate Deficit';
          emit(tier, { ...record, shortage, coveragePct });
        },
        reducer: (tier, records) => {
          const totalShortage = records.reduce((s, r) => s + r.shortage, 0);
          const totalDemand = records.reduce(
            (s, r) => s + (r.water_demand || 0),
            0
          );
          const totalSupply = records.reduce(
            (s, r) => s + (r.water_supply || 0),
            0
          );
          const topAreas = [...records]
            .sort((a, b) => b.shortage - a.shortage)
            .slice(0, 5)
            .map((r) => ({
              id: r.id,
              district: r.district,
              area: r.area,
              shortage: Math.round(r.shortage),
              coverage_pct: r.coveragePct,
              quality: r.water_quality,
            }));

          return {
            severity_tier: tier,
            area_count: records.length,
            total_demand: Math.round(totalDemand),
            total_supply: Math.round(totalSupply),
            total_shortage: Math.round(totalShortage),
            top_hotspots: topAreas,
          };
        },
        sortResults: (a, b) =>
          Number(b.total_shortage) - Number(a.total_shortage),
      });
    }

    case 'usage_period_rollup': {
      const period = params.period ?? 'monthly';
      const all = distributedStore.readAllRecords<WaterRecordEntity>('water_records');
      const latestTs = all.reduce((max, r) => {
        const ts = new Date(r.recorded_at || r.uploaded_at || 0).getTime();
        return ts > max ? ts : max;
      }, 0);
      const windowDays = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
      const cutoffTs = latestTs - windowDays * 24 * 60 * 60 * 1000;

      return executeMapReduce<
        WaterRecordEntity,
        WaterRecordEntity,
        Record<string, unknown>
      >({
        jobType: 'usage_period_rollup',
        label: `Temporal Usage & Requirement Rollup (${period})`,
        collection: 'water_records',
        numReducers,
        mapper: (record, emit) => {
          const ts = new Date(
            record.recorded_at || record.uploaded_at || 0
          ).getTime();
          if (latestTs > 0 && ts < cutoffTs) return;
          const dateBucket = (record.recorded_at || record.uploaded_at || '').slice(
            0,
            10
          );
          emit(dateBucket || 'unscheduled', record);
        },
        reducer: (dateBucket, records) => {
          const demand = records.reduce((s, r) => s + (r.water_demand || 0), 0);
          const supply = records.reduce((s, r) => s + (r.water_supply || 0), 0);
          const shortage = records.reduce(
            (s, r) =>
              s + Math.max((r.water_demand || 0) - (r.water_supply || 0), 0),
            0
          );
          const consumedVals = records
            .map((r) => r.water_consumed)
            .filter((v): v is number => v !== null && v !== undefined);
          const consumed = consumedVals.length
            ? consumedVals.reduce((s, v) => s + v, 0)
            : null;
          return {
            observation_date: dateBucket,
            records_count: records.length,
            demand_litres: Math.round(demand),
            supply_litres: Math.round(supply),
            consumed_litres: consumed !== null ? Math.round(consumed) : null,
            shortage_litres: Math.round(shortage),
            coverage_pct:
              demand > 0 ? Number(((supply / demand) * 100).toFixed(1)) : 0,
          };
        },
        sortResults: (a, b) =>
          String(b.observation_date).localeCompare(String(a.observation_date)),
      });
    }

    case 'distributed_retrieval': {
      const search = (params.search || '').trim().toLowerCase();
      const qualityFilter = (params.quality || '').trim().toLowerCase();
      const minShortage = Number(params.minShortage ?? 0);

      return executeMapReduce<
        WaterRecordEntity,
        WaterRecordEntity & { shortage: number },
        Record<string, unknown>
      >({
        jobType: 'distributed_retrieval',
        label: 'Distributed Predicate Scan & Record Retrieval',
        collection: 'water_records',
        numReducers,
        mapper: (record, emit) => {
          const shortage = Math.max(
            (record.water_demand || 0) - (record.water_supply || 0),
            0
          );
          if (shortage < minShortage) return;
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (
            qualityFilter &&
            !String(record.water_quality || '')
              .toLowerCase()
              .includes(qualityFilter)
          ) {
            return;
          }
          if (search) {
            const haystack = `${record.district} ${record.area} ${record.water_quality}`.toLowerCase();
            if (!haystack.includes(search)) return;
          }
          emit(`${record.district}::${record.area}`, { ...record, shortage });
        },
        reducer: (_key, records) => {
          const latest = records.reduce((best, curr) =>
            curr.id > best.id ? curr : best
          );
          const coverage =
            latest.water_demand > 0
              ? Number(
                  ((latest.water_supply / latest.water_demand) * 100).toFixed(1)
                )
              : 0;
          return {
            id: latest.id,
            district: latest.district,
            area: latest.area,
            water_demand: latest.water_demand,
            water_supply: latest.water_supply,
            shortage: Math.round(latest.shortage),
            water_consumed: latest.water_consumed,
            water_level: latest.water_level,
            water_quality: latest.water_quality,
            coverage_pct: coverage,
            recorded_at: latest.recorded_at,
          };
        },
        sortResults: (a, b) => Number(b.shortage) - Number(a.shortage),
      });
    }

    case 'basin_reservoir_summary': {
      return executeMapReduce<
        ReservoirEntity,
        ReservoirEntity,
        Record<string, unknown>
      >({
        jobType: 'basin_reservoir_summary',
        label: 'Reservoir Storage & Inflow/Outflow Aggregation by Basin',
        collection: 'reservoirs',
        numReducers,
        mapper: (record, emit) => {
          const key = (record.basin || 'Unassigned Basin').trim();
          emit(key, record);
        },
        reducer: (basin, records) => {
          const totalLive = records.reduce(
            (s, r) => s + (r.live_capacity || 0),
            0
          );
          const totalGross = records.reduce(
            (s, r) => s + (r.gross_capacity || 0),
            0
          );
          const totalInflow = records.reduce((s, r) => s + (r.inflow || 0), 0);
          const totalOutflow = records.reduce((s, r) => s + (r.outflow || 0), 0);
          const avgFill =
            records.reduce((s, r) => s + (r.percentage_full || 0), 0) /
            records.length;

          return {
            basin,
            reservoir_count: records.length,
            avg_percentage_full: Number(avgFill.toFixed(1)),
            total_live_capacity: Number(totalLive.toFixed(2)),
            total_gross_capacity: Number(totalGross.toFixed(2)),
            total_inflow_cusecs: Math.round(totalInflow),
            total_outflow_cusecs: Math.round(totalOutflow),
            net_balance_cusecs: Math.round(totalInflow - totalOutflow),
          };
        },
        sortResults: (a, b) =>
          Number(b.total_live_capacity) - Number(a.total_live_capacity),
      });
    }

    case 'area_consumption_rollup': {
      const search = (params.search || '').trim().toLowerCase();
      return executeMapReduce<
        WaterRecordEntity,
        WaterRecordEntity,
        Record<string, unknown>
      >({
        jobType: 'area_consumption_rollup',
        label: 'Area-Wise Water Consumption & Shortage Aggregation',
        collection: 'water_records',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (search) {
            const hay = `${record.district} ${record.area} ${record.water_quality}`.toLowerCase();
            if (!hay.includes(search)) return;
          }
          const areaKey = `${record.area.trim()}::${record.district.trim()}`;
          emit(areaKey, record);
        },
        reducer: (_key, records) => {
          const latest = records.reduce((best, curr) => {
            const currTs = new Date(curr.recorded_at || curr.uploaded_at || 0).getTime();
            const bestTs = new Date(best.recorded_at || best.uploaded_at || 0).getTime();
            if (currTs > bestTs || (currTs === bestTs && curr.id > best.id)) {
              return curr;
            }
            return best;
          });

          const totalConsumed = records.reduce(
            (s, r) =>
              s +
              (r.water_consumed !== null && r.water_consumed !== undefined
                ? r.water_consumed
                : Math.round((r.water_supply || 0) * 0.92)),
            0
          );
          const latestConsumed =
            latest.water_consumed !== null && latest.water_consumed !== undefined
              ? latest.water_consumed
              : Math.round((latest.water_supply || 0) * 0.92);
          const demand = latest.water_demand || 0;
          const supply = latest.water_supply || 0;
          const shortage = Math.max(demand - supply, 0);
          const coveragePct =
            demand > 0 ? Number(((supply / demand) * 100).toFixed(1)) : 100;
          const status =
            demand <= 0
              ? 'No Demand Data'
              : coveragePct >= 90
              ? 'Sufficient'
              : coveragePct >= 60
              ? 'Moderate'
              : 'Shortage';

          return {
            area: latest.area,
            district: latest.district,
            water_consumption_l: Math.round(latestConsumed),
            cumulative_consumption_l: Math.round(totalConsumed),
            water_demand_l: Math.round(demand),
            water_supply_l: Math.round(supply),
            shortage_l: Math.round(shortage),
            coverage_pct: coveragePct,
            observations: records.length,
            status,
          };
        },
        sortResults: (a, b) =>
          Number(b.shortage_l) - Number(a.shortage_l) ||
          Number(b.water_consumption_l) - Number(a.water_consumption_l),
      });
    }

    case 'reservoir_level_avg': {
      const search = (params.search || '').trim().toLowerCase();
      return executeMapReduce<
        ReservoirEntity,
        ReservoirEntity,
        Record<string, unknown>
      >({
        jobType: 'reservoir_level_avg',
        label: 'Reservoir Average Water Level & Storage Aggregation (HDFS Shards)',
        collection: 'reservoirs',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (search) {
            const hay = `${record.reservoir_name} ${record.district} ${record.river} ${record.basin}`.toLowerCase();
            if (!hay.includes(search)) return;
          }
          emit(record.reservoir_name.trim(), record);
        },
        reducer: (reservoirName, records) => {
          const sorted = [...records].sort((a, b) => {
            if (b.monitoring_date !== a.monitoring_date) {
              return b.monitoring_date.localeCompare(a.monitoring_date);
            }
            return b.id - a.id;
          });
          const latest = sorted[0];
          const count = records.length;
          const pcts = records.map((r) => r.percentage_full || 0);
          const avgFill = pcts.reduce((s, v) => s + v, 0) / count;
          const minFill = Math.min(...pcts);
          const maxFill = Math.max(...pcts);
          const avgLevel =
            records.reduce((s, r) => s + (r.reservoir_level || 0), 0) / count;
          const avgInflow =
            records.reduce((s, r) => s + (r.inflow || 0), 0) / count;
          const avgOutflow =
            records.reduce((s, r) => s + (r.outflow || 0), 0) / count;
          const currentPct = latest.percentage_full || 0;
          const alertStatus =
            currentPct < 40
              ? 'Critical Low'
              : currentPct < 55
              ? 'Low Level'
              : 'Normal';

          return {
            reservoir_name: reservoirName,
            district: latest.district,
            river: latest.river,
            basin: latest.basin,
            observations: count,
            capacity_tmc: Number(
              (latest.gross_capacity || latest.design_capacity || 0).toFixed(2)
            ),
            available_tmc: Number((latest.live_capacity || 0).toFixed(2)),
            current_fill_pct: Number(currentPct.toFixed(1)),
            avg_fill_pct: Number(avgFill.toFixed(1)),
            min_fill_pct: Number(minFill.toFixed(1)),
            max_fill_pct: Number(maxFill.toFixed(1)),
            avg_water_level: Number(avgLevel.toFixed(1)),
            avg_inflow_cusecs: Math.round(avgInflow),
            avg_outflow_cusecs: Math.round(avgOutflow),
            latest_date: latest.monitoring_date,
            alert_status: alertStatus,
          };
        },
        sortResults: (a, b) =>
          Number(a.current_fill_pct) - Number(b.current_fill_pct),
      });
    }

    case 'emergency_area_summary': {
      const search = (params.search || '').trim().toLowerCase();
      return executeMapReduce<
        EmergencyRequestEntity,
        EmergencyRequestEntity,
        Record<string, unknown>
      >({
        jobType: 'emergency_area_summary',
        label: 'Emergency Water Requests Analysis by Area (HDFS Shards)',
        collection: 'emergency_requests',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (search) {
            const hay = `${record.area} ${record.district} ${record.emergency_type || ''} ${record.description || ''}`.toLowerCase();
            if (!hay.includes(search)) return;
          }
          emit(`${record.area.trim()}::${record.district.trim()}`, record);
        },
        reducer: (key, records) => {
          const [area, district] = key.split('::');
          const pendingCount = records.filter(
            (r) => r.status === 'Pending' || r.status === 'Requested'
          ).length;
          const approvedCount = records.filter(
            (r) =>
              r.status === 'Approved' ||
              r.status === 'Assigned' ||
              r.status === 'In Transit'
          ).length;
          const completedCount = records.filter(
            (r) => r.status === 'Completed' || r.status === 'Delivered'
          ).length;
          const totalQuantity = records.reduce(
            (s, r) => s + (r.required_quantity || 0),
            0
          );

          const typeCounts = new Map<string, number>();
          for (const r of records) {
            const t = r.emergency_type || 'No Water Supply';
            typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
          }
          const topType =
            Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
            'No Water Supply';

          const priorityRank: Record<string, number> = {
            Critical: 4,
            High: 3,
            Medium: 2,
            Low: 1,
          };
          const highestPriority =
            [...records].sort(
              (a, b) =>
                (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0)
            )[0]?.priority || 'Medium';

          const latestTs =
            [...records].sort((a, b) =>
              String(b.created_at).localeCompare(String(a.created_at))
            )[0]?.created_at || '';

          return {
            area,
            district,
            request_count: records.length,
            pending_count: pendingCount,
            approved_count: approvedCount,
            completed_count: completedCount,
            total_required_l: Math.round(totalQuantity),
            top_emergency_type: topType,
            highest_priority: highestPriority,
            latest_request_at: latestTs,
          };
        },
        sortResults: (a, b) =>
          Number(b.pending_count) - Number(a.pending_count) ||
          Number(b.request_count) - Number(a.request_count) ||
          Number(b.total_required_l) - Number(a.total_required_l),
      });
    }

    case 'transport_delivery_summary': {
      const search = (params.search || '').trim().toLowerCase();
      return executeMapReduce<
        TransportDeliveryEntity,
        TransportDeliveryEntity,
        Record<string, unknown>
      >({
        jobType: 'transport_delivery_summary',
        label: 'Tanker Transportation & Delivery Analysis by Destination (HDFS Shards)',
        collection: 'transport_deliveries',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (search) {
            const hay = `${record.tanker_id} ${record.driver_name} ${record.starting_location} ${record.destination_area} ${record.district}`.toLowerCase();
            if (!hay.includes(search)) return;
          }
          emit(`${record.destination_area.trim()}::${record.district.trim()}`, record);
        },
        reducer: (key, records) => {
          const [destinationArea, district] = key.split('::');
          const deliveredCount = records.filter(
            (r) => r.delivery_status === 'Delivered'
          ).length;
          const activeCount = records.filter(
            (r) => r.delivery_status === 'In Transit' || r.delivery_status === 'Dispatched'
          ).length;
          const totalWater = records.reduce(
            (s, r) => s + (r.water_quantity_l || 0),
            0
          );
          const avgEta =
            records.reduce((s, r) => s + (r.estimated_minutes || 0), 0) /
            records.length;
          const totalKm = records.reduce((s, r) => s + (r.distance_km || 0), 0);
          const tankers = Array.from(new Set(records.map((r) => r.tanker_id))).join(', ');

          return {
            destination_area: destinationArea,
            district,
            delivery_count: records.length,
            active_count: activeCount,
            delivered_count: deliveredCount,
            total_water_l: Math.round(totalWater),
            avg_eta_min: Math.round(avgEta),
            total_distance_km: Number(totalKm.toFixed(1)),
            tankers_assigned: tankers,
          };
        },
        sortResults: (a, b) =>
          Number(b.total_water_l) - Number(a.total_water_l) ||
          Number(b.delivery_count) - Number(a.delivery_count),
      });
    }

    case 'maintenance_priority_summary': {
      const search = (params.search || '').trim().toLowerCase();
      return executeMapReduce<
        MaintenanceTaskEntity,
        MaintenanceTaskEntity,
        Record<string, unknown>
      >({
        jobType: 'maintenance_priority_summary',
        label: 'Water Maintenance Work Orders & Loss Prevention Summary (HDFS Shards)',
        collection: 'maintenance_tasks',
        numReducers,
        mapper: (record, emit) => {
          if (
            params.district &&
            record.district.toLowerCase() !== params.district.toLowerCase()
          ) {
            return;
          }
          if (search) {
            const hay = `${record.task_code} ${record.asset_name} ${record.maintenance_type} ${record.area} ${record.district}`.toLowerCase();
            if (!hay.includes(search)) return;
          }
          emit((record.maintenance_type || 'General Maintenance').trim(), record);
        },
        reducer: (maintenanceType, records) => {
          const openTasks = records.filter((r) => r.status !== 'Completed').length;
          const completedTasks = records.filter((r) => r.status === 'Completed').length;
          const urgentOpen = records.filter(
            (r) => (r.priority === 'Critical' || r.priority === 'High') && r.status !== 'Completed'
          ).length;
          const totalSaved = records.reduce((s, r) => s + (r.water_saved_lpd || 0), 0);
          const totalCost = records.reduce((s, r) => s + (r.estimated_cost_inr || 0), 0);
          const districtsCovered = Array.from(
            new Set(records.map((r) => r.district).filter(Boolean))
          ).join(', ');

          return {
            maintenance_type: maintenanceType,
            total_tasks: records.length,
            open_tasks: openTasks,
            completed_tasks: completedTasks,
            urgent_open: urgentOpen,
            water_saved_lpd: Math.round(totalSaved),
            estimated_cost_inr: Math.round(totalCost),
            districts_covered: districtsCovered,
          };
        },
        sortResults: (a, b) =>
          Number(b.water_saved_lpd) - Number(a.water_saved_lpd) ||
          Number(b.open_tasks) - Number(a.open_tasks),
      });
    }
  }
}
