import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Code2,
  Cpu,
  Database,
  Download,
  FileText,
  HardDrive,
  History,
  Play,
  RefreshCw,
  Server,
} from 'lucide-react';
import type {
  ClusterStatus,
  HivePreset,
  HiveQueryResult,
  MapReduceJobTrace,
  YarnClusterStatus,
} from '../types';
import { formatBytes, formatDate, formatNumber } from '../utils/format';

interface MapReduceSectionProps {
  districtsList: string[];
  clusterStatus?: ClusterStatus | null;
  onNavigateCluster?: () => void;
}

type JobPreset =
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

type WorkbenchTab = 'execution' | 'results' | 'hive' | 'python_code' | 'history';
type ChartMode = 'pipeline' | 'history';

const DEFAULT_ROW_LIMIT = 8;

const JOB_PRESETS: Array<{
  id: JobPreset;
  label: string;
  description: string;
}> = [
  {
    id: 'district_water_balance',
    label: 'District Water Balance',
    description:
      'Aggregates latest demand, supply, and shortfall per district from HDFS shards.',
  },
  {
    id: 'area_consumption_rollup',
    label: 'Area Consumption Rollup',
    description:
      'Computes latest and cumulative water consumption and deficit per area.',
  },
  {
    id: 'shortage_hotspots',
    label: 'Shortage Hotspots',
    description:
      'Filters deficits by severity tier and ranks highest-shortage clusters.',
  },
  {
    id: 'usage_period_rollup',
    label: 'Temporal Usage Rollup',
    description:
      'Buckets observations within daily, weekly, or monthly windows.',
  },
  {
    id: 'distributed_retrieval',
    label: 'Distributed Predicate Scan',
    description:
      'Parallel block-level scan matching search, district, quality, and shortage thresholds.',
  },
  {
    id: 'basin_reservoir_summary',
    label: 'Basin Reservoir Summary',
    description:
      'Calculates aggregate live storage, inflow, and outflow balance by basin.',
  },
  {
    id: 'reservoir_level_avg',
    label: 'Reservoir Avg Water Levels',
    description:
      'Computes historical average, min/max fill %, and low-level alerts per dam.',
  },
  {
    id: 'emergency_area_summary',
    label: 'Emergency Requests by Area',
    description:
      'Summarizes pending, approved, and completed emergency requests and litres.',
  },
  {
    id: 'transport_delivery_summary',
    label: 'Tanker Deliveries Summary',
    description:
      'Aggregates dispatched tankers, transported volume, and average ETA by route.',
  },
  {
    id: 'maintenance_priority_summary',
    label: 'Water Maintenance Orders',
    description:
      'Summarizes open/done work orders, critical priorities, water saved, and budget.',
  },
];

export const MapReduceSection: React.FC<MapReduceSectionProps> = ({
  districtsList,
  clusterStatus,
  onNavigateCluster,
}) => {
  const [jobType, setJobType] = useState<JobPreset>('district_water_balance');
  const [engine, setEngine] = useState<'python' | 'native'>('python');
  const [district, setDistrict] = useState('');
  const [search, setSearch] = useState('');
  const [minShortage, setMinShortage] = useState('');
  const [quality, setQuality] = useState('');
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [numReducers, setNumReducers] = useState(4);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<MapReduceJobTrace | null>(null);
  const [history, setHistory] = useState<MapReduceJobTrace[]>([]);
  const [yarnStatus, setYarnStatus] = useState<YarnClusterStatus | null>(null);
  const [showAllResults, setShowAllResults] = useState(false);
  const [showAllMappers, setShowAllMappers] = useState(false);

  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('execution');
  const [chartMode, setChartMode] = useState<ChartMode>('pipeline');
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const [hivePresets, setHivePresets] = useState<HivePreset[]>([]);
  const [hiveQuery, setHiveQuery] = useState('SELECT * FROM aqua_mapreduce_results LIMIT 20');
  const [hiveResult, setHiveResult] = useState<HiveQueryResult | null>(null);
  const [hiveLoading, setHiveLoading] = useState(false);

  const [workerSource, setWorkerSource] = useState<{
    file: string;
    language: string;
    source: string;
  } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  const loadHistoryAndYarn = useCallback(async () => {
    try {
      const res = await fetch('/api/mapreduce/jobs');
      const data = await res.json();
      if (data.jobs) setHistory(data.jobs);
      if (data.yarn) setYarnStatus(data.yarn);
    } catch {
      // ignore
    }
  }, []);

  const runJob = useCallback(
    async (overridePreset?: JobPreset) => {
      const targetJob = overridePreset ?? jobType;
      setRunning(true);
      setError(null);
      setShowAllResults(false);
      setShowAllMappers(false);
      try {
        const res = await fetch('/api/mapreduce/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobType: targetJob,
            engine,
            district: district || undefined,
            search: search || undefined,
            minShortage: minShortage ? Number(minShortage) : undefined,
            quality: quality || undefined,
            period,
            numReducers,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'MapReduce execution failed');
        }
        setActiveJob(data.job);
        await loadHistoryAndYarn();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Execution error');
      } finally {
        setRunning(false);
      }
    },
    [jobType, engine, district, search, minShortage, quality, period, numReducers, loadHistoryAndYarn]
  );

  useEffect(() => {
    runJob('district_water_balance');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runHiveQuery = useCallback(async (queryToRun: string) => {
    setHiveLoading(true);
    try {
      const res = await fetch('/api/hive/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryToRun }),
      });
      const data = (await res.json()) as HiveQueryResult;
      setHiveResult(data);
    } catch {
      // ignore
    } finally {
      setHiveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (workbenchTab === 'hive') {
      if (hivePresets.length === 0) {
        fetch('/api/hive/presets?table=mapreduce')
          .then((r) => r.json())
          .then((d) => {
            if (d?.presets) setHivePresets(d.presets);
          })
          .catch(() => {});
      }
      if (!hiveResult) {
        runHiveQuery(hiveQuery);
      }
    } else if (workbenchTab === 'python_code' && !workerSource) {
      setSourceLoading(true);
      fetch('/api/mapreduce/worker-source')
        .then((r) => r.json())
        .then((d) => {
          if (d?.success) {
            setWorkerSource({
              file: d.file,
              language: d.language,
              source: d.source,
            });
          }
        })
        .catch(() => {})
        .finally(() => setSourceLoading(false));
    }
  }, [workbenchTab, hivePresets.length, hiveResult, hiveQuery, runHiveQuery, workerSource]);

  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    if (chartMode === 'pipeline' && activeJob) {
      chartInstanceRef.current = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: ['HDFS Input', 'Mapper Emits', 'Shuffle Keys', 'Reducer Out'],
          datasets: [
            {
              label: 'Records',
              data: [
                activeJob.recordsScanned,
                activeJob.mapEmits,
                activeJob.shuffleKeys,
                activeJob.reduceOutputs,
              ],
              backgroundColor: ['#0f172a', '#1677df', '#0d9488', '#16a34a'],
              borderRadius: 6,
              barPercentage: 0.48,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  if (ctx.dataIndex === 0) return `Splits: ${activeJob.inputSplits} HDFS blocks`;
                  if (ctx.dataIndex === 1) return `Map Time: ${activeJob.phaseTimings?.mapMs ?? 0} ms`;
                  if (ctx.dataIndex === 2) return `Shuffle Time: ${activeJob.phaseTimings?.shuffleMs ?? 0} ms`;
                  return `Reduce Time: ${activeJob.phaseTimings?.reduceMs ?? 0} ms`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          },
        },
      });
    } else {
      const recent = [...history].slice(0, 8).reverse();
      chartInstanceRef.current = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: recent.map((j) => j.jobId.slice(0, 9)),
          datasets: [
            {
              label: 'Runtime (ms)',
              data: recent.map((j) => j.durationMs),
              backgroundColor: '#1677df',
              borderRadius: 4,
              barPercentage: 0.55,
            },
            {
              label: 'Outputs',
              data: recent.map((j) => j.reduceOutputs),
              backgroundColor: '#0d9488',
              borderRadius: 4,
              barPercentage: 0.55,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { beginAtZero: true, ticks: { font: { size: 10 } } },
          },
        },
      });
    }

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [chartMode, activeJob, history]);

  const exportResultsCsv = () => {
    if (!activeJob?.results?.length) return;
    const cols = Object.keys(activeJob.results[0]);
    const csvLines = [
      cols.join(','),
      ...activeJob.results.map((row) =>
        cols
          .map((c) => {
            const val = row[c];
            const str =
              typeof val === 'object' && val !== null
                ? JSON.stringify(val)
                : String(val ?? '');
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(',')
      ),
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeJob.jobType}_${activeJob.jobId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAnalysisReport = () => {
    if (!activeJob) return;
    const reportLines = [
      `AquaAI — ${activeJob.analysisReport.title}`,
      `Job ID: ${activeJob.jobId} | YARN Application: ${activeJob.yarnApp?.applicationId}`,
      `Engine: ${activeJob.runtimeLabel}`,
      `Execution Time: ${activeJob.durationMs} ms`,
      '',
      'Executive Summary:',
      activeJob.analysisReport.executiveSummary,
      '',
      'Key Findings:',
      ...activeJob.analysisReport.keyFindings.map((f, idx) => `${idx + 1}. ${f}`),
    ];
    const blob = new Blob([reportLines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${activeJob.jobType}_${activeJob.jobId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedMeta = JOB_PRESETS.find((p) => p.id === jobType);
  const resultColumns = activeJob?.results?.length ? Object.keys(activeJob.results[0]) : [];
  const visibleResults = activeJob
    ? showAllResults
      ? activeJob.results
      : activeJob.results.slice(0, DEFAULT_ROW_LIMIT)
    : [];
  const visibleMappers = activeJob
    ? showAllMappers
      ? activeJob.mapPhase
      : activeJob.mapPhase.slice(0, 6)
    : [];

  const summaryStats = useMemo(() => {
    const rm = yarnStatus?.resourceManager;
    return {
      totalJobs: rm?.totalApplications ?? history.length,
      succeededJobs: rm?.succeededApplications ?? history.length,
      avgDurationMs: rm?.avgJobDurationMs ?? activeJob?.durationMs ?? 0,
      totalMemoryMb: rm?.totalMemoryMb ?? 32768,
      totalVCores: rm?.totalVCores ?? 16,
      activeNodeManagers: rm?.activeNodeManagers ?? clusterStatus?.healthyNodes ?? 4,
      totalNodeManagers: rm?.totalNodeManagers ?? clusterStatus?.totalNodes ?? 4,
      hdfsBlocks: clusterStatus?.totalBlocks ?? 0,
      hdfsBytes: clusterStatus?.totalStorageBytes ?? 0,
      rf: clusterStatus?.replicationFactor ?? 2,
    };
  }, [yarnStatus, history.length, activeJob, clusterStatus]);

  return (
    <div className="space-y-4">
      {/* 1. Compact Top Split: Chart.js Pipeline Flow + Hadoop/YARN/HDFS Status */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 flex flex-col justify-between">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">
                MapReduce &amp; YARN Pipeline Telemetry
              </h1>
              <p className="text-[11px] text-slate-500">
                {activeJob
                  ? `${activeJob.runtimeLabel} · ${activeJob.yarnApp?.applicationId || activeJob.jobId}`
                  : 'Distributed execution across HDFS shards'}
              </p>
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setChartMode('pipeline')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                  chartMode === 'pipeline'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Input / Output
              </button>
              <button
                type="button"
                onClick={() => setChartMode('history')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                  chartMode === 'history'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Job Runtimes
              </button>
            </div>
          </div>

          <div className="relative h-48 w-full">
            <canvas ref={chartCanvasRef} />
          </div>

          {activeJob && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
              <div className="flex flex-wrap items-center gap-4">
                <span>
                  Map:{' '}
                  <strong className="font-mono-data text-slate-900">
                    {activeJob.phaseTimings?.mapMs ?? 0} ms
                  </strong>
                </span>
                <span>
                  Shuffle:{' '}
                  <strong className="font-mono-data text-slate-900">
                    {activeJob.phaseTimings?.shuffleMs ?? 0} ms
                  </strong>
                </span>
                <span>
                  Reduce:{' '}
                  <strong className="font-mono-data text-slate-900">
                    {activeJob.phaseTimings?.reduceMs ?? 0} ms
                  </strong>
                </span>
              </div>
              <span className="font-mono-data font-semibold text-blue-700">
                Total: {activeJob.durationMs} ms
              </span>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 flex flex-col justify-between">
          <div>
            <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Hadoop, YARN &amp; HDFS
              </h2>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Cpu className="h-3.5 w-3.5" />
              </div>
            </div>

            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500">MapReduce Jobs</dt>
                <dd className="font-mono-data font-bold text-slate-900">
                  {formatNumber(summaryStats.totalJobs)} ({summaryStats.succeededJobs} ok)
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500">Mappers / Reducers</dt>
                <dd className="inline-flex items-center gap-1 font-mono-data font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>
                    {activeJob?.mapperStatus?.statusLabel || 'Ready'} ·{' '}
                    {activeJob?.reducerStatus?.statusLabel || 'Ready'}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500">In → Out Records</dt>
                <dd className="font-mono-data font-bold text-slate-900">
                  {formatNumber(activeJob?.recordsScanned ?? 0)} →{' '}
                  {formatNumber(activeJob?.reduceOutputs ?? 0)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500">YARN Cluster</dt>
                <dd className="font-mono-data font-semibold text-slate-900">
                  {summaryStats.activeNodeManagers}/{summaryStats.totalNodeManagers} NM ·{' '}
                  {Math.round(summaryStats.totalMemoryMb / 1024)}GB/{summaryStats.totalVCores}c
                </dd>
              </div>
              <div className="flex items-center justify-between py-2">
                <dt className="text-slate-500">HDFS Storage</dt>
                <dd className="font-mono-data font-semibold text-slate-900">
                  {formatNumber(summaryStats.hdfsBlocks)} blk (RF={summaryStats.rf}) ·{' '}
                  {formatBytes(summaryStats.hdfsBytes)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-3 flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => runJob()}
              disabled={running}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" />
              {running ? 'Running...' : 'Run MapReduce Job'}
            </button>
            {onNavigateCluster && (
              <button
                type="button"
                onClick={onNavigateCluster}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <HardDrive className="h-3.5 w-3.5" />
                Nodes
              </button>
            )}
          </div>
        </section>
      </div>

      {/* 2. Compact Job Configuration Bar */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500">
              MapReduce Pipeline
            </label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value as JobPreset)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {JOB_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500">Engine</label>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as 'python' | 'native')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="python">Python 3 (Streaming)</option>
              <option value="native">Hadoop Native (Node)</option>
            </select>
          </div>

          {jobType !== 'basin_reservoir_summary' && jobType !== 'usage_period_rollup' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                District
              </label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All Districts</option>
                {districtsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {jobType === 'usage_period_rollup' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Window</label>
              <select
                value={period}
                onChange={(e) =>
                  setPeriod(e.target.value as 'daily' | 'weekly' | 'monthly')
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="daily">Daily (24h)</option>
                <option value="weekly">Weekly (7d)</option>
                <option value="monthly">Monthly (30d)</option>
              </select>
            </div>
          )}

          {jobType === 'distributed_retrieval' && (
            <>
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  Keyword
                </label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Area or district..."
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500">
                  Quality
                </label>
                <input
                  type="text"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  placeholder="e.g. Good"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </>
          )}

          {(jobType === 'shortage_hotspots' || jobType === 'distributed_retrieval') && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                Min Shortage (L)
              </label>
              <input
                type="number"
                min={0}
                value={minShortage}
                onChange={(e) => setMinShortage(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-slate-500">
              Reducers
            </label>
            <select
              value={numReducers}
              onChange={(e) => setNumReducers(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {[1, 2, 4, 6, 8].map((n) => (
                <option key={n} value={n}>
                  {n} Reducer{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-500">
          <span>{selectedMeta?.description}</span>
          <button
            type="button"
            onClick={() => runJob()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
          >
            <Play className="h-3 w-3" />
            {running ? 'Executing...' : 'Execute Pipeline'}
          </button>
        </div>

        {error && (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">
            {error}
          </p>
        )}
      </section>

      {/* 3. Unified 5-Tab Workbench (Includes Job History to eliminate extra stacked table) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-col justify-between gap-2.5 border-b border-slate-100 pb-3 lg:flex-row lg:items-center">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'execution', label: 'Mapper, Reducer & YARN', icon: Server },
                { id: 'results', label: 'Results & Report', icon: FileText },
                { id: 'hive', label: 'Apache Hive', icon: Database },
                { id: 'python_code', label: 'Python Worker', icon: Code2 },
                { id: 'history', label: `Job History (${history.length})`, icon: History },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = workbenchTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setWorkbenchTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeJob && (
            <span className="font-mono-data text-xs text-slate-500">
              {activeJob.jobId} · {activeJob.label}
            </span>
          )}
        </div>

        {/* TAB 1: Mapper, Reducer & YARN */}
        {workbenchTab === 'execution' && activeJob && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <span className="text-slate-500">YARN App</span>
                <p className="font-mono-data font-semibold text-blue-700 truncate">
                  {activeJob.yarnApp?.applicationId}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Containers</span>
                <p className="font-mono-data font-semibold text-slate-900">
                  {activeJob.yarnApp?.containersAllocated} ({activeJob.yarnApp?.allocatedMemoryMb} MB)
                </p>
              </div>
              <div>
                <span className="text-slate-500">Queue / AM</span>
                <p className="font-mono-data font-semibold text-slate-900">
                  {activeJob.yarnApp?.queue} · {activeJob.yarnApp?.amNode}
                </p>
              </div>
              <div>
                <span className="text-slate-500">HDFS Collection</span>
                <p className="font-mono-data font-semibold text-slate-900">
                  {activeJob.hdfsInfo?.collection} ({activeJob.hdfsInfo?.blocksRead} blks)
                </p>
              </div>
              <div>
                <span className="text-slate-500">Bytes Scanned</span>
                <p className="font-mono-data font-semibold text-slate-900">
                  {formatBytes(activeJob.hdfsInfo?.bytesScanned ?? 0)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Status</span>
                <p
                  className={`inline-flex items-center gap-1 font-mono-data font-semibold ${
                    activeJob.yarnApp?.finalStatus === 'SUCCEEDED'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {activeJob.yarnApp?.finalStatus === 'SUCCEEDED' ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {activeJob.yarnApp?.finalStatus}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Mapper Tasks ({activeJob.mapperStatus?.statusLabel})
                  </h3>
                  <span className="font-mono-data text-[11px] text-slate-500">
                    {activeJob.phaseTimings?.mapMs ?? 0} ms
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Mapper</th>
                        <th className="py-1.5 px-2 font-medium">Block · Node</th>
                        <th className="py-1.5 px-2 font-medium">Status</th>
                        <th className="py-1.5 pl-2 text-right font-medium">In → Emit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono-data">
                      {visibleMappers.map((split, idx) => (
                        <tr key={split.blockId} className="hover:bg-slate-50/70">
                          <td className="py-1.5 pr-2 text-slate-700">
                            {split.taskId || `m_${String(idx).padStart(4, '0')}`}
                          </td>
                          <td className="py-1.5 px-2 text-slate-700">
                            <span className="text-blue-700">{split.blockId}</span> ·{' '}
                            {split.status === 'unavailable' ? '—' : split.nodeServed}
                          </td>
                          <td className="py-1.5 px-2">
                            <span
                              className={`font-semibold ${
                                split.status === 'completed'
                                  ? 'text-emerald-700'
                                  : 'text-red-700'
                              }`}
                            >
                              {split.status === 'completed' ? 'OK' : 'FAIL'}
                            </span>
                          </td>
                          <td className="py-1.5 pl-2 text-right text-slate-900">
                            {split.inputRecords} → {split.emittedPairs}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {activeJob.mapPhase.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllMappers((v) => !v)}
                    className="mt-2 text-[11px] font-semibold text-blue-600 hover:underline"
                  >
                    {showAllMappers
                      ? 'Show top 6 mappers'
                      : `Show all ${activeJob.mapPhase.length} mappers`}
                  </button>
                )}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Reducer Tasks ({activeJob.reducerStatus?.statusLabel})
                  </h3>
                  <span className="font-mono-data text-[11px] text-slate-500">
                    {activeJob.phaseTimings?.reduceMs ?? 0} ms
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-1.5 pr-2 font-medium">Reducer</th>
                        <th className="py-1.5 px-2 font-medium">Node</th>
                        <th className="py-1.5 px-2 font-medium">Status</th>
                        <th className="py-1.5 px-2 text-right font-medium">Out</th>
                        <th className="py-1.5 pl-2 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono-data">
                      {(activeJob.reducerTasks || []).map((task) => (
                        <tr key={task.taskId} className="hover:bg-slate-50/70">
                          <td className="py-1.5 pr-2 text-slate-900">
                            {task.taskId} (P#{task.partitionId})
                          </td>
                          <td className="py-1.5 px-2 text-slate-700">{task.nodeAssigned}</td>
                          <td className="py-1.5 px-2 font-semibold text-emerald-700">
                            {task.status === 'completed' ? 'OK' : 'FAIL'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-semibold text-blue-700">
                            {task.outputRecords}
                          </td>
                          <td className="py-1.5 pl-2 text-right text-slate-500">
                            {task.durationMs} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {yarnStatus?.nodeManagers && (
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
                    {yarnStatus.nodeManagers.map((nm) => (
                      <div
                        key={nm.nodeId}
                        className="rounded-lg border border-slate-200 p-2.5 text-[11px]"
                      >
                        <div className="flex items-center justify-between font-mono-data">
                          <strong className="text-slate-900">{nm.nodeId}</strong>
                          <span
                            className={`font-semibold ${
                              nm.state === 'RUNNING' ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {nm.state}
                          </span>
                        </div>
                        <p className="mt-0.5 font-mono-data text-slate-500">
                          {nm.vCoresTotal}c · {nm.memoryTotalMb / 1024}GB · {nm.containersExecuted} runs
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Processing Results & Data Analysis Report */}
        {workbenchTab === 'results' && activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col justify-between gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {activeJob.analysisReport?.title || 'Analysis Report'}
                </h3>
                <p className="text-xs text-slate-600">
                  {activeJob.analysisReport?.executiveSummary}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={exportAnalysisReport}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  Report
                </button>
                <button
                  type="button"
                  onClick={exportResultsCsv}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </button>
              </div>
            </div>

            {activeJob.analysisReport?.highlights && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                {activeJob.analysisReport.highlights.map((hl) => (
                  <div key={hl.label} className="rounded-lg border border-slate-100 bg-slate-50/70 p-2.5">
                    <span className="text-slate-500">{hl.label}</span>
                    <p className="mt-0.5 font-mono-data font-bold text-slate-900">
                      {hl.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {visibleResults.length > 0 && (
              <div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        {resultColumns.map((col) => (
                          <th key={col} className="py-2 pr-3 font-medium whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleResults.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70">
                          {resultColumns.map((col) => {
                            const val = row[col];
                            const isNum = typeof val === 'number';
                            const display =
                              val === null || val === undefined
                                ? '—'
                                : Array.isArray(val)
                                ? val
                                    .map((v: Record<string, unknown>) =>
                                      v.area
                                        ? `${v.area} (${formatNumber(Number(v.shortage))} L)`
                                        : JSON.stringify(v)
                                    )
                                    .join(' · ')
                                : isNum
                                ? formatNumber(val)
                                : String(val);
                            return (
                              <td
                                key={col}
                                className={`py-2 pr-3 ${
                                  isNum ? 'font-mono-data text-slate-900' : 'text-slate-700'
                                }`}
                              >
                                {display}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {activeJob.results.length > DEFAULT_ROW_LIMIT && (
                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500">
                    <span>
                      Showing {visibleResults.length} of {activeJob.results.length} rows
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAllResults((v) => !v)}
                      className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
                    >
                      {showAllResults
                        ? 'Show top 8'
                        : `Show all (${activeJob.results.length})`}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                          showAllResults ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Apache Hive */}
        {workbenchTab === 'hive' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {hivePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setHiveQuery(preset.query);
                    runHiveQuery(preset.query);
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {preset.title}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={hiveQuery}
                onChange={(e) => setHiveQuery(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={hiveLoading}
                onClick={() => runHiveQuery(hiveQuery)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {hiveLoading ? 'Running...' : 'Run HiveQL'}
              </button>
            </div>

            {hiveResult && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {hiveResult.error ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    {hiveResult.error}
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {hiveResult.hdfsBlocksScanned} HDFS blocks · {hiveResult.rowsReturned}/
                        {hiveResult.rowsScanned} rows · {hiveResult.durationMs} ms
                      </span>
                      <span className="font-mono-data text-[11px]">
                        {hiveResult.executionStages.join(' → ')}
                      </span>
                    </div>

                    <div className="overflow-x-auto max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-white border-b border-slate-200 text-slate-500">
                          <tr>
                            {hiveResult.columns.map((col) => (
                              <th key={col} className="py-2 pr-3 font-medium">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {hiveResult.rows.slice(0, 12).map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/70">
                              {hiveResult.columns.map((col) => (
                                <td
                                  key={col}
                                  className="py-2 pr-3 font-mono-data text-slate-800 whitespace-nowrap"
                                >
                                  {row[col] === null || row[col] === undefined
                                    ? '—'
                                    : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Python Mapper & Reducer Source Code */}
        {workbenchTab === 'python_code' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-900">
                {workerSource?.language || 'Python 3'} Hadoop Streaming Worker ·{' '}
                <code className="font-mono-data font-normal text-slate-600">
                  {workerSource?.file || 'server/mr_worker.py'}
                </code>
              </span>
              <span className="text-slate-500">Executed over HDFS split payloads</span>
            </div>

            {sourceLoading ? (
              <p className="py-6 text-xs text-slate-500">Loading Python source...</p>
            ) : (
              <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-900 p-3.5 font-mono-data text-[11px] leading-relaxed text-slate-100">
                {workerSource?.source || 'Unable to load Python worker source.'}
              </pre>
            )}
          </div>
        )}

        {/* TAB 5: Job Execution History */}
        {workbenchTab === 'history' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Click any executed job to inspect its trace and results</span>
              <button
                type="button"
                onClick={loadHistoryAndYarn}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>

            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Job · YARN App</th>
                    <th className="py-2 px-2.5 font-medium">Pipeline</th>
                    <th className="py-2 px-2.5 font-medium">Engine</th>
                    <th className="py-2 px-2.5 text-right font-medium">In → Out</th>
                    <th className="py-2 px-2.5 text-right font-medium">Runtime</th>
                    <th className="py-2 pl-2.5 text-right font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.slice(0, 12).map((job) => {
                    const selected = activeJob?.jobId === job.jobId;
                    return (
                      <tr
                        key={job.jobId}
                        onClick={() => {
                          setActiveJob(job);
                          setWorkbenchTab('execution');
                        }}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="py-2 pr-3 font-mono-data">
                          <span className="font-semibold text-blue-700">{job.jobId}</span>
                          <p className="text-[11px] text-slate-400">
                            {job.yarnApp?.applicationId}
                          </p>
                        </td>
                        <td className="py-2 px-2.5 font-medium text-slate-900">{job.label}</td>
                        <td className="py-2 px-2.5 text-slate-600">
                          {job.implementationEngine === 'python' ? 'Python 3' : 'Native'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-900 whitespace-nowrap">
                          {formatNumber(job.recordsScanned)} → {formatNumber(job.reduceOutputs)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-slate-700 whitespace-nowrap">
                          {job.durationMs} ms
                        </td>
                        <td className="py-2 pl-2.5 text-right font-mono-data text-slate-500 whitespace-nowrap">
                          {formatDate(job.startedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
