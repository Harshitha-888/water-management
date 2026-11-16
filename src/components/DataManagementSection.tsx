import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  Globe,
  HardDrive,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ClusterStatus,
  DatasetCategory,
  DatasetPythonPreprocessReport,
  DatasetStorageInfo,
  HivePreset,
  HiveQueryResult,
  PublicDatasetInfo,
  PublicWaterResponse,
  UploadedDataset,
} from '../types';
import { formatBytes, formatDate, formatNumber } from '../utils/format';

interface DataManagementSectionProps {
  datasets: UploadedDataset[];
  clusterStatus: ClusterStatus | null;
  dataSourceStatus: Record<string, string> | null;
  publicCatalogue: PublicDatasetInfo[];
  publicWater: PublicWaterResponse | null;
  onRefreshPublic: () => Promise<void>;
  onDatasetUploaded: () => Promise<void>;
}

const DATASET_CATEGORIES: DatasetCategory[] = [
  'Rainfall data',
  'Water consumption data',
  'Groundwater data',
  'Reservoir data',
  'Water distribution data',
];

const CATEGORY_SHORT_LABEL: Record<DatasetCategory, string> = {
  'Rainfall data': 'Rainfall',
  'Water consumption data': 'Consumption',
  'Groundwater data': 'Groundwater',
  'Reservoir data': 'Reservoir',
  'Water distribution data': 'Distribution',
};

const CATEGORY_COLOR: Record<DatasetCategory, string> = {
  'Rainfall data': '#0284c7',
  'Water consumption data': '#1677df',
  'Groundwater data': '#0d9488',
  'Reservoir data': '#4f46e5',
  'Water distribution data': '#d97706',
};

type WorkbenchTab = 'storage' | 'python' | 'hive' | 'nwdp';
type ChartMode = 'categories' | 'nodes';

const DEFAULT_ROW_LIMIT = 8;

export const DataManagementSection: React.FC<DataManagementSectionProps> = ({
  datasets,
  clusterStatus,
  dataSourceStatus,
  publicCatalogue,
  publicWater,
  onRefreshPublic,
  onDatasetUploaded,
}) => {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [showAllDatasets, setShowAllDatasets] = useState(false);
  const [showAllBlocks, setShowAllBlocks] = useState(false);

  const [uploadCategory, setUploadCategory] = useState<DatasetCategory>('Rainfall data');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [chartMode, setChartMode] = useState<ChartMode>('categories');
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const [activeTab, setActiveTab] = useState<WorkbenchTab>('storage');
  const [storageInfo, setStorageInfo] = useState<DatasetStorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [togglingNodeId, setTogglingNodeId] = useState<string | null>(null);

  const [preprocessReport, setPreprocessReport] =
    useState<DatasetPythonPreprocessReport | null>(null);
  const [preprocessLoading, setPreprocessLoading] = useState(false);

  const [hivePresets, setHivePresets] = useState<HivePreset[]>([]);
  const [hiveQuery, setHiveQuery] = useState<string>(
    "SELECT district, station_or_area, observation_date, metric_primary AS rainfall_mm, metric_secondary AS departure_pct, status_note, block_id FROM aqua_dataset_files WHERE category = 'Rainfall data' ORDER BY rainfall_mm DESC LIMIT 20"
  );
  const [hiveResult, setHiveResult] = useState<HiveQueryResult | null>(null);
  const [hiveLoading, setHiveLoading] = useState(false);

  const [checkingPortal, setCheckingPortal] = useState(false);
  const [ingestingKey, setIngestingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDatasetId && datasets.length > 0) {
      setSelectedDatasetId(datasets[0].id);
    } else if (
      selectedDatasetId &&
      datasets.length > 0 &&
      !datasets.some((d) => d.id === selectedDatasetId)
    ) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const loadStorageInfo = useCallback(async (id: number) => {
    setStorageLoading(true);
    try {
      const res = await fetch(`/api/datasets/${id}/storage`);
      const data = (await res.json()) as DatasetStorageInfo;
      if (res.ok && data.success) {
        setStorageInfo(data);
      }
    } catch {
      // ignore
    } finally {
      setStorageLoading(false);
    }
  }, []);

  const runPythonPreprocess = useCallback(async (id: number) => {
    setPreprocessLoading(true);
    try {
      const res = await fetch(`/api/datasets/${id}/preprocess`);
      const data = (await res.json()) as DatasetPythonPreprocessReport;
      if (res.ok && data.success) {
        setPreprocessReport(data);
      }
    } catch {
      // ignore
    } finally {
      setPreprocessLoading(false);
    }
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
    if (selectedDatasetId && activeTab === 'storage') {
      loadStorageInfo(selectedDatasetId);
    } else if (selectedDatasetId && activeTab === 'python') {
      runPythonPreprocess(selectedDatasetId);
    }
  }, [selectedDatasetId, activeTab, loadStorageInfo, runPythonPreprocess]);

  useEffect(() => {
    if (activeTab === 'hive') {
      if (hivePresets.length === 0) {
        fetch('/api/hive/presets?table=datasets')
          .then((r) => r.json())
          .then((d) => {
            if (d?.presets) setHivePresets(d.presets);
          })
          .catch(() => {});
      }
      if (!hiveResult) {
        runHiveQuery(hiveQuery);
      }
    }
  }, [activeTab, hivePresets.length, hiveResult, hiveQuery, runHiveQuery]);

  // Chart.js Overview Visualization
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    if (chartMode === 'categories') {
      const categoryTotals = DATASET_CATEGORIES.map((cat) => {
        const matching = datasets.filter((d) => d.category === cat);
        return {
          cat,
          label: CATEGORY_SHORT_LABEL[cat],
          rows: matching.reduce((s, d) => s + (d.row_count || 0), 0),
          blocks: matching.reduce((s, d) => s + (d.block_ids?.length || 0), 0),
          kb: Number(
            (matching.reduce((s, d) => s + (d.size_bytes || 0), 0) / 1024).toFixed(1)
          ),
        };
      });

      chartInstanceRef.current = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: categoryTotals.map((c) => c.label),
          datasets: [
            {
              label: 'Records Indexed',
              data: categoryTotals.map((c) => c.rows),
              backgroundColor: categoryTotals.map((c) => CATEGORY_COLOR[c.cat]),
              borderRadius: 5,
              barPercentage: 0.56,
            },
            {
              label: 'HDFS Blocks',
              data: categoryTotals.map((c) => c.blocks),
              backgroundColor: '#cbd5e1',
              borderRadius: 5,
              barPercentage: 0.56,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const idx = items[0]?.dataIndex ?? 0;
                  return `HDFS Footprint: ${categoryTotals[idx]?.kb ?? 0} KB`;
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
      const nodes = clusterStatus?.nodes || [];
      chartInstanceRef.current = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: nodes.map((n) => `${n.id} (${n.name.split(' ')[0]})`),
          datasets: [
            {
              label: 'Primary Blocks',
              data: nodes.map((n) => n.primaryBlocks),
              backgroundColor: '#1677df',
              borderRadius: 4,
              barPercentage: 0.52,
            },
            {
              label: 'Replica Blocks',
              data: nodes.map((n) => n.replicaBlocks),
              backgroundColor: '#94a3b8',
              borderRadius: 4,
              barPercentage: 0.52,
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
            x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
            y: { stacked: true, beginAtZero: true, ticks: { font: { size: 10 } } },
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
  }, [chartMode, datasets, clusterStatus]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setNotice({ type: 'error', text: 'Please select a CSV or Excel dataset file.' });
      return;
    }

    setUploading(true);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', uploadCategory);
      const res = await fetch('/api/upload-water-data', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Dataset upload failed');
      }
      setNotice({
        type: 'success',
        text: `${data.filename} (${data.category}) sharded into ${data.blocks_created} HDFS blocks.`,
      });
      setFile(null);
      setShowUploadForm(false);
      await onDatasetUploaded();
      if (data.dataset_id) {
        setSelectedDatasetId(data.dataset_id);
        setActiveTab('storage');
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDataset = async (id: number) => {
    setDeletingId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/datasets/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to delete dataset');
      }
      setNotice({
        type: 'success',
        text: 'Dataset removed from NameNode and HDFS DataNodes.',
      });
      setConfirmDeleteId(null);
      if (selectedDatasetId === id) {
        setSelectedDatasetId(null);
        setStorageInfo(null);
        setPreprocessReport(null);
      }
      await onDatasetUploaded();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Delete failed',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleDataNode = async (nodeId: string) => {
    setTogglingNodeId(nodeId);
    try {
      const res = await fetch(`/api/cluster/nodes/${nodeId}/toggle`, {
        method: 'POST',
      });
      if (res.ok) {
        await onDatasetUploaded();
        if (selectedDatasetId) {
          await loadStorageInfo(selectedDatasetId);
        }
      }
    } catch {
      // ignore
    } finally {
      setTogglingNodeId(null);
    }
  };

  const filteredDatasets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return datasets.filter((ds) => {
      if (categoryFilter !== 'all' && ds.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${ds.filename} ${ds.category} ${ds.storage_status || ''} ${(
        ds.block_ids || []
      ).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [datasets, search, categoryFilter]);

  const visibleDatasets = showAllDatasets
    ? filteredDatasets
    : filteredDatasets.slice(0, DEFAULT_ROW_LIMIT);

  const maxBlockCount = useMemo(
    () => Math.max(1, ...datasets.map((d) => d.block_ids?.length || 0)),
    [datasets]
  );

  const maxNodeBytes = useMemo(
    () => Math.max(1, ...(clusterStatus?.nodes || []).map((n) => n.storageBytes || 0)),
    [clusterStatus]
  );

  const kpis = useMemo(() => {
    const totalRows = datasets.reduce((s, d) => s + (d.row_count || 0), 0);
    const categoriesCount = new Set(datasets.map((d) => d.category)).size;
    return {
      datasetCount: datasets.length,
      totalRows,
      categoriesCount,
      totalBlocks: clusterStatus?.totalBlocks ?? 0,
      replicationFactor: clusterStatus?.replicationFactor ?? 2,
      healthyNodes: clusterStatus?.healthyNodes ?? 4,
      totalNodes: clusterStatus?.totalNodes ?? 4,
      totalBytes: clusterStatus?.totalStorageBytes ?? 0,
    };
  }, [datasets, clusterStatus]);

  return (
    <div className="space-y-4">
      {/* Compact Page Title + Upload Controls */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Data Lake &amp; HDFS Storage
          </h1>
          <span className="text-xs text-slate-500">
            {kpis.datasetCount} datasets · {formatNumber(kpis.totalBlocks)} blocks
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="/sample-csv"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            Sample CSV
          </a>
          <button
            type="button"
            onClick={() => setShowUploadForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            {showUploadForm ? 'Close' : 'Upload Dataset'}
          </button>
        </div>
      </div>

      {/* Collapsible Upload & HDFS Shard Form */}
      {showUploadForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Ingest &amp; Shard Dataset into HDFS
          </h2>
          <form
            onSubmit={handleUpload}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700">Category</label>
              <select
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value as DatasetCategory)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                {DATASET_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                CSV / XLSX File
              </label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium"
              />
            </div>
            <button
              type="submit"
              disabled={uploading || !file}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Sharding...' : 'Ingest & Shard'}
            </button>
          </form>
        </section>
      )}

      {notice && (
        <div
          className={`rounded-lg border px-3.5 py-2 text-xs font-medium ${
            notice.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Top Split: Chart.js Distribution + Compact Hadoop Namespace Card */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-stretch">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8 flex flex-col justify-between">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              HDFS Storage Distribution
            </h2>
            <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs">
              <button
                type="button"
                onClick={() => setChartMode('categories')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                  chartMode === 'categories'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                By Category
              </button>
              <button
                type="button"
                onClick={() => setChartMode('nodes')}
                className={`rounded-md px-2.5 py-1 font-semibold transition-colors whitespace-nowrap ${
                  chartMode === 'nodes'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                DataNode Load
              </button>
            </div>
          </div>

          <div className="relative h-48 w-full">
            <canvas ref={chartCanvasRef} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h2 className="text-sm font-semibold text-slate-900">
                Apache Hadoop Namespace
              </h2>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Layers className="h-3.5 w-3.5" />
              </div>
            </div>

            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Datasets</dt>
                <dd className="font-mono-data font-bold text-slate-900">
                  {formatNumber(kpis.datasetCount)} files · {kpis.categoriesCount} cats
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">Indexed Rows</dt>
                <dd className="font-mono-data font-bold text-slate-900">
                  {formatNumber(kpis.totalRows)}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">NameNode Blocks</dt>
                <dd className="font-mono-data font-bold text-blue-700">
                  {formatNumber(kpis.totalBlocks)} (RF={kpis.replicationFactor})
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-slate-500">DataNodes Online</dt>
                <dd className="font-mono-data font-bold text-emerald-700">
                  {kpis.healthyNodes}/{kpis.totalNodes} ({formatBytes(kpis.totalBytes)})
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Dataset Catalog */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('all');
                setShowAllDatasets(false);
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                categoryFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({datasets.length})
            </button>
            {DATASET_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  setCategoryFilter(cat);
                  setShowAllDatasets(false);
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  categoryFilter === cat
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {CATEGORY_SHORT_LABEL[cat]}
              </button>
            ))}
          </div>

          <div className="relative w-full lg:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowAllDatasets(false);
              }}
              placeholder="Search filename, block ID..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Dataset &amp; Footprint</th>
                <th className="py-2 px-2.5 font-medium">Category</th>
                <th className="py-2 px-2.5 font-medium">Uploaded</th>
                <th className="py-2 px-2.5 text-right font-medium">Rows</th>
                <th className="py-2 px-2.5 font-medium">Status</th>
                <th className="py-2 pl-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDatasets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No datasets match the active filter.
                  </td>
                </tr>
              ) : (
                visibleDatasets.map((ds) => {
                  const isSelected = selectedDatasetId === ds.id;
                  const blockCount = ds.block_ids?.length || 0;
                  const blockPct = Math.max(8, Math.round((blockCount / maxBlockCount) * 100));
                  const healthy = ds.storage_status?.includes('Replicated');
                  return (
                    <tr
                      key={ds.id}
                      onClick={() => setSelectedDatasetId(ds.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-50/45' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold text-slate-900">{ds.filename}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${blockPct}%`,
                                backgroundColor: CATEGORY_COLOR[ds.category] || '#1677df',
                              }}
                            />
                          </div>
                          <span className="font-mono-data text-[11px] text-slate-500">
                            {blockCount} blks · {formatBytes(ds.size_bytes || 0)}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-700 font-medium whitespace-nowrap">
                        {CATEGORY_SHORT_LABEL[ds.category] || ds.category}
                      </td>
                      <td className="py-2.5 px-2.5 font-mono-data text-slate-600 whitespace-nowrap">
                        {formatDate(ds.uploaded_at)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data font-semibold text-slate-900">
                        {formatNumber(ds.row_count)}
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            healthy ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {healthy ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {ds.storage_status || 'HDFS Sharded'}
                        </span>
                      </td>
                      <td
                        className="py-2.5 pl-2.5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDatasetId(ds.id);
                              setActiveTab('storage');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <HardDrive className="h-3 w-3 text-blue-600" />
                            Blocks
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDatasetId(ds.id);
                              setActiveTab('python');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Terminal className="h-3 w-3 text-slate-600" />
                            Clean
                          </button>
                          <a
                            href={`/api/datasets/${ds.id}/download`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3 text-emerald-700" />
                            CSV
                          </a>
                          {confirmDeleteId === ds.id ? (
                            <button
                              type="button"
                              disabled={deletingId === ds.id}
                              onClick={() => handleDeleteDataset(ds.id)}
                              className="inline-flex items-center rounded-md bg-red-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                            >
                              {deletingId === ds.id ? '...' : 'Confirm'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Delete ${ds.filename}`}
                              onClick={() => setConfirmDeleteId(ds.id)}
                              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredDatasets.length > DEFAULT_ROW_LIMIT && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
            <span>
              Showing {visibleDatasets.length} of {filteredDatasets.length} datasets
            </span>
            <button
              type="button"
              onClick={() => setShowAllDatasets((v) => !v)}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
            >
              {showAllDatasets ? 'Show top 8' : `Show all (${filteredDatasets.length})`}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  showAllDatasets ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        )}
      </section>

      {/* Consolidated 4-Tab Workbench: NameNode/DataNodes | Python | HiveQL | Live NWDP Feeds */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-col justify-between gap-2.5 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'storage', label: 'NameNode & DataNodes', icon: Server },
                { id: 'python', label: 'Python Preprocess', icon: Terminal },
                { id: 'hive', label: 'HiveQL', icon: Database },
                { id: 'nwdp', label: `Live NWDP Feeds (${publicCatalogue.length})`, icon: Globe },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
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

          {selectedDatasetId && (activeTab === 'storage' || activeTab === 'python') && (
            <span className="text-xs text-slate-500">
              Dataset:{' '}
              <strong className="font-mono-data text-slate-900">
                {datasets.find((d) => d.id === selectedDatasetId)?.filename ||
                  `#${selectedDatasetId}`}
              </strong>
            </span>
          )}
        </div>

        {/* Tab 1: NameNode & DataNodes */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(clusterStatus?.nodes || []).map((node) => {
                const pct = Math.max(8, Math.round((node.storageBytes / maxNodeBytes) * 100));
                const online = node.status === 'online';
                return (
                  <div
                    key={node.id}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 p-3.5 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono-data font-bold text-slate-900">
                          {node.id}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            online ? 'text-emerald-700' : 'text-red-600'
                          }`}
                        >
                          {online ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <p className="mt-0.5 font-medium text-slate-800">{node.name}</p>
                      <p className="font-mono-data text-[11px] text-slate-500">
                        {node.primaryBlocks}P / {node.replicaBlocks}R · {formatBytes(node.storageBytes)}
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            online ? 'bg-blue-600' : 'bg-slate-300'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={togglingNodeId === node.id}
                      onClick={() => handleToggleDataNode(node.id)}
                      className="mt-3 w-full rounded-md border border-slate-200 bg-white py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {togglingNodeId === node.id
                        ? 'Updating...'
                        : online
                        ? 'Simulate Offline'
                        : 'Bring Online'}
                    </button>
                  </div>
                );
              })}
            </div>

            {storageLoading ? (
              <p className="py-3 text-xs text-slate-500">Querying NameNode metadata...</p>
            ) : storageInfo ? (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                  <span>
                    <strong className="font-mono-data text-slate-900">
                      {storageInfo.namenode.cluster_name}
                    </strong>{' '}
                    · <span className="text-emerald-700 font-semibold">{storageInfo.namenode.storage_status}</span>
                  </span>
                  <span className="font-mono-data">
                    {storageInfo.namenode.total_blocks} blocks ({storageInfo.namenode.block_size_records} rows/blk · RF={storageInfo.namenode.replication_factor})
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Block ID</th>
                        <th className="py-2 px-2.5 font-medium">Primary</th>
                        <th className="py-2 px-2.5 font-medium">Replicas</th>
                        <th className="py-2 px-2.5 text-right font-medium">Rows</th>
                        <th className="py-2 px-2.5 text-right font-medium">Size</th>
                        <th className="py-2 pl-2.5 font-medium">Checksum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(showAllBlocks
                        ? storageInfo.blocks
                        : storageInfo.blocks.slice(0, DEFAULT_ROW_LIMIT)
                      ).map((b) => (
                        <tr key={b.blockId} className="hover:bg-slate-50/70">
                          <td className="py-2 pr-3 font-mono-data font-semibold text-blue-700">
                            {b.blockId}
                          </td>
                          <td className="py-2 px-2.5 font-mono-data text-slate-800">
                            {b.primaryNode} ({b.primaryNodeStatus})
                          </td>
                          <td className="py-2 px-2.5 font-mono-data text-slate-600">
                            {b.replicaNodes.join(', ') || '—'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {b.recordCount}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {formatBytes(b.sizeBytes)}
                          </td>
                          <td className="py-2 pl-2.5 font-mono-data text-[11px] text-slate-500">
                            {b.checksum.slice(0, 14)}…
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {storageInfo.blocks.length > DEFAULT_ROW_LIMIT && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowAllBlocks((v) => !v)}
                      className="text-xs font-semibold text-blue-600 hover:underline"
                    >
                      {showAllBlocks
                        ? 'Show top 8 blocks'
                        : `Show all ${storageInfo.blocks.length} blocks`}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Tab 2: Python Preprocessing */}
        {activeTab === 'python' && (
          <div className="space-y-4">
            {preprocessLoading ? (
              <p className="py-4 text-xs text-slate-500">
                Running Python dataset preprocessing...
              </p>
            ) : preprocessReport ? (
              <>
                <div className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-3 text-xs sm:grid-cols-5">
                  <div>
                    <span className="text-slate-500">Raw / Clean Rows</span>
                    <p className="font-mono-data font-bold text-slate-900">
                      {preprocessReport.raw_rows} / {preprocessReport.cleaned_rows}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Missing Imputed</span>
                    <p className="font-mono-data font-bold text-slate-900">
                      {preprocessReport.missing_values_imputed}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Duplicates</span>
                    <p className="font-mono-data font-bold text-slate-900">
                      {preprocessReport.duplicates_removed}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">IQR Outliers</span>
                    <p className="font-mono-data font-bold text-amber-700">
                      {preprocessReport.outliers_flagged}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Runtime</span>
                    <p className="font-mono-data font-bold text-blue-700">
                      {preprocessReport.duration_ms} ms
                    </p>
                  </div>
                </div>

                {preprocessReport.numeric_stats.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Column</th>
                          <th className="py-2 px-2.5 text-right font-medium">Min</th>
                          <th className="py-2 px-2.5 text-right font-medium">Mean</th>
                          <th className="py-2 px-2.5 text-right font-medium">Median</th>
                          <th className="py-2 px-2.5 text-right font-medium">Max</th>
                          <th className="py-2 px-2.5 text-right font-medium">StdDev</th>
                          <th className="py-2 pl-2.5 text-right font-medium">Outliers</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preprocessReport.numeric_stats.map((st) => (
                          <tr key={st.column}>
                            <td className="py-2 pr-3 font-medium text-slate-900">
                              {st.column}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatNumber(st.min)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatNumber(st.mean)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatNumber(st.median)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatNumber(st.max)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatNumber(st.stdev)}
                            </td>
                            <td className="py-2 pl-2.5 text-right font-mono-data text-amber-700">
                              {st.outliers}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {preprocessReport.cleaned_preview.length > 0 && (
                  <div className="overflow-x-auto border-t border-slate-100 pt-3">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          {Object.keys(preprocessReport.cleaned_preview[0])
                            .slice(0, 6)
                            .map((col) => (
                              <th key={col} className="py-2 pr-3 font-medium">
                                {col}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {preprocessReport.cleaned_preview.slice(0, 6).map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/70">
                            {Object.keys(preprocessReport.cleaned_preview[0])
                              .slice(0, 6)
                              .map((col) => (
                                <td
                                  key={col}
                                  className="py-2 pr-3 font-mono-data text-slate-700 whitespace-nowrap"
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
                )}
              </>
            ) : (
              <p className="py-4 text-xs text-slate-500">
                Select any dataset above and click Clean to inspect preprocessing stats.
              </p>
            )}
          </div>
        )}

        {/* Tab 3: Apache Hive Querying */}
        {activeTab === 'hive' && (
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

        {/* Tab 4: Live NWDP External Feeds */}
        {activeTab === 'nwdp' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {dataSourceStatus
                  ? `${dataSourceStatus.kwris_api || 'NWDP Feed'} · ${
                      dataSourceStatus.weather || 'Open-Meteo'
                    }`
                  : 'Real-time HTTP CSV feeds from nwdp.nwic.gov.in'}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href="https://nwdp.nwic.gov.in/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Portal
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  disabled={checkingPortal}
                  onClick={async () => {
                    setCheckingPortal(true);
                    await onRefreshPublic();
                    setCheckingPortal(false);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingPortal ? 'animate-spin' : ''}`} />
                  Refresh Feeds
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Dataset</th>
                    <th className="py-2 px-2.5 font-medium">Frequency</th>
                    <th className="py-2 px-2.5 font-medium">Live Status</th>
                    <th className="py-2 pl-2.5 text-right font-medium">HDFS Ingest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {publicCatalogue.map((item) => {
                    const live = publicWater?.datasets?.[item.key];
                    return (
                      <tr key={item.key}>
                        <td className="py-2 pr-3 font-medium text-slate-900">{item.name}</td>
                        <td className="py-2 px-2.5 text-slate-600">{item.frequency}</td>
                        <td className="py-2 px-2.5 font-mono-data whitespace-nowrap">
                          {!live ? (
                            <span className="text-slate-400">Checking...</span>
                          ) : live.available ? (
                            <span className="font-semibold text-emerald-700">
                              {formatNumber(live.record_count)} rows
                            </span>
                          ) : live.reachable && !live.error ? (
                            <span className="text-slate-500">0 rows</span>
                          ) : (
                            <span className="text-amber-700">Unreachable</span>
                          )}
                        </td>
                        <td className="py-2 pl-2.5 text-right whitespace-nowrap">
                          {live?.available ? (
                            <button
                              type="button"
                              disabled={ingestingKey === item.key}
                              onClick={async () => {
                                setIngestingKey(item.key);
                                setNotice(null);
                                try {
                                  const res = await fetch('/api/datasets/ingest-live-nwdp', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: item.key }),
                                  });
                                  const data = await res.json();
                                  if (!res.ok || !data.success) {
                                    throw new Error(data.message || 'Live ingestion failed');
                                  }
                                  setNotice({ type: 'success', text: data.message });
                                  await onDatasetUploaded();
                                } catch (err) {
                                  setNotice({
                                    type: 'error',
                                    text:
                                      err instanceof Error
                                        ? err.message
                                        : 'Live ingestion error',
                                  });
                                } finally {
                                  setIngestingKey(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50/70 disabled:opacity-60"
                            >
                              <HardDrive className="h-3 w-3" />
                              {ingestingKey === item.key ? 'Sharding...' : 'Shard to HDFS'}
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">—</span>
                          )}
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
