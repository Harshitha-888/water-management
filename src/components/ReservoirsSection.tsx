import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Database,
  Droplets,
  Gauge,
  Play,
  Plus,
  RefreshCw,
  Terminal,
  TrendingUp,
} from 'lucide-react';
import type {
  HivePreset,
  HiveQueryResult,
  LiveNwdpReservoirSnapshot,
  MapReduceJobTrace,
  PythonAnalysisReport,
  ReservoirRecord,
} from '../types';
import { formatDate, formatNumber } from '../utils/format';

interface ReservoirsSectionProps {
  reservoirs: ReservoirRecord[];
  districtsList: string[];
  liveNwdpDams?: LiveNwdpReservoirSnapshot[];
  onRefreshReservoirs: () => Promise<void>;
}

type TableTab = 'stored' | 'nwdp';
type ToolTab = 'history' | 'mapreduce' | 'hive' | 'python';

const CHART_PALETTE = [
  '#1677df',
  '#18a878',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#475569',
  '#db2777',
];

const DEFAULT_ROW_LIMIT = 8;

export const ReservoirsSection: React.FC<ReservoirsSectionProps> = ({
  reservoirs,
  districtsList,
  liveNwdpDams = [],
  onRefreshReservoirs,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [tableTab, setTableTab] = useState<TableTab>('stored');
  const [showAllReservoirs, setShowAllReservoirs] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [selectedHistoryReservoir, setSelectedHistoryReservoir] = useState<string>('all');
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('history');
  const [syncingNwdp, setSyncingNwdp] = useState(false);
  const [syncedDams, setSyncedDams] = useState<LiveNwdpReservoirSnapshot[]>([]);

  const [form, setForm] = useState({
    reservoir_name: '',
    district: '',
    river: '',
    basin: '',
    monitoring_date: new Date().toISOString().slice(0, 10),
    percentage_full: '',
    reservoir_level: '',
    gross_capacity: '',
    live_capacity: '',
    inflow: '',
    outflow: '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [mrJob, setMrJob] = useState<MapReduceJobTrace | null>(null);
  const [mrLoading, setMrLoading] = useState(false);

  const [hivePresets, setHivePresets] = useState<HivePreset[]>([]);
  const [hiveQuery, setHiveQuery] = useState<string>(
    'SELECT reservoir_name, district, gross_capacity AS capacity_tmc, live_capacity AS available_tmc, percentage_full AS current_level_pct, inflow, outflow FROM aqua_reservoirs ORDER BY percentage_full ASC LIMIT 20'
  );
  const [hiveResult, setHiveResult] = useState<HiveQueryResult | null>(null);
  const [hiveLoading, setHiveLoading] = useState(false);

  const [pythonReport, setPythonReport] = useState<PythonAnalysisReport | null>(null);
  const [pythonLoading, setPythonLoading] = useState(false);

  const capacityChartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capacityChartInstanceRef = useRef<Chart | null>(null);

  const historyChartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyChartInstanceRef = useRef<Chart | null>(null);

  const latestReservoirs = useMemo(() => {
    const map = new Map<string, ReservoirRecord>();
    for (const r of reservoirs) {
      if (!map.has(r.reservoir_name)) {
        map.set(r.reservoir_name, r);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.percentage_full - b.percentage_full);
  }, [reservoirs]);

  const reservoirNames = useMemo(
    () => latestReservoirs.map((r) => r.reservoir_name).sort((a, b) => a.localeCompare(b)),
    [latestReservoirs]
  );

  const kpis = useMemo(() => {
    const totalCapacity = latestReservoirs.reduce(
      (s, r) => s + (r.gross_capacity || r.design_capacity || 0),
      0
    );
    const availableWater = latestReservoirs.reduce(
      (s, r) => s + (r.live_capacity || 0),
      0
    );
    const totalInflow = latestReservoirs.reduce((s, r) => s + (r.inflow || 0), 0);
    const totalOutflow = latestReservoirs.reduce((s, r) => s + (r.outflow || 0), 0);
    const avgFillPct = latestReservoirs.length
      ? latestReservoirs.reduce((s, r) => s + (r.percentage_full || 0), 0) /
        latestReservoirs.length
      : 0;
    const avgElevation = latestReservoirs.length
      ? latestReservoirs.reduce((s, r) => s + (r.reservoir_level || 0), 0) /
        latestReservoirs.length
      : 0;
    const lowAlerts = latestReservoirs.filter((r) => (r.percentage_full || 0) < 55);

    return {
      count: latestReservoirs.length,
      totalCapacity: Math.round(totalCapacity * 100) / 100,
      availableWater: Math.round(availableWater * 100) / 100,
      avgFillPct: Math.round(avgFillPct * 10) / 10,
      avgElevation: Math.round(avgElevation * 10) / 10,
      totalInflow: Math.round(totalInflow),
      totalOutflow: Math.round(totalOutflow),
      netInflow: Math.round(totalInflow - totalOutflow),
      lowAlerts,
    };
  }, [latestReservoirs]);

  const filteredHistory = useMemo(() => {
    if (selectedHistoryReservoir === 'all') return reservoirs;
    return reservoirs.filter((r) => r.reservoir_name === selectedHistoryReservoir);
  }, [reservoirs, selectedHistoryReservoir]);

  const nwdpList = syncedDams.length ? syncedDams : liveNwdpDams;
  const visibleReservoirs = showAllReservoirs
    ? latestReservoirs
    : latestReservoirs.slice(0, DEFAULT_ROW_LIMIT);
  const visibleAlerts = showAllAlerts
    ? kpis.lowAlerts
    : kpis.lowAlerts.slice(0, 5);
  const visibleHistory = showAllHistory
    ? filteredHistory
    : filteredHistory.slice(0, DEFAULT_ROW_LIMIT);

  const runReservoirMapReduce = useCallback(async () => {
    setMrLoading(true);
    try {
      const res = await fetch('/api/mapreduce/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType: 'reservoir_level_avg', numReducers: 4 }),
      });
      const data = await res.json();
      if (data?.success && data.job) {
        setMrJob(data.job);
      }
    } catch {
      // ignore
    } finally {
      setMrLoading(false);
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
      const data = await res.json();
      setHiveResult(data);
    } catch {
      // ignore
    } finally {
      setHiveLoading(false);
    }
  }, []);

  const runPythonAnalysis = useCallback(async () => {
    setPythonLoading(true);
    try {
      const res = await fetch('/api/python-analysis');
      const data = await res.json();
      if (data?.success) {
        setPythonReport(data);
      }
    } catch {
      // ignore
    } finally {
      setPythonLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeToolTab === 'mapreduce' && !mrJob) {
      runReservoirMapReduce();
    } else if (activeToolTab === 'hive') {
      if (!hivePresets.length) {
        fetch('/api/hive/presets?table=reservoirs')
          .then((r) => r.json())
          .then((d) => {
            if (d?.presets) setHivePresets(d.presets);
          })
          .catch(() => {});
      }
      if (!hiveResult) {
        runHiveQuery(hiveQuery);
      }
    } else if (activeToolTab === 'python' && !pythonReport) {
      runPythonAnalysis();
    }
  }, [
    activeToolTab,
    mrJob,
    hivePresets.length,
    hiveResult,
    hiveQuery,
    pythonReport,
    runReservoirMapReduce,
    runHiveQuery,
    runPythonAnalysis,
  ]);

  // Chart.js 1: Total Capacity vs Available Water (TMC)
  useEffect(() => {
    const canvas = capacityChartCanvasRef.current;
    if (!canvas) return;
    if (capacityChartInstanceRef.current) capacityChartInstanceRef.current.destroy();

    capacityChartInstanceRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: latestReservoirs.map((r) => r.reservoir_name.split('(')[0].trim()),
        datasets: [
          {
            label: 'Capacity (TMC)',
            data: latestReservoirs.map((r) => r.gross_capacity || r.design_capacity || 0),
            backgroundColor: '#cbd5e1',
            borderRadius: 4,
          },
          {
            label: 'Available (TMC)',
            data: latestReservoirs.map((r) => r.live_capacity || 0),
            backgroundColor: latestReservoirs.map((r) =>
              (r.percentage_full || 0) < 40
                ? '#dc2626'
                : (r.percentage_full || 0) < 55
                ? '#d97706'
                : '#1677df'
            ),
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const item = latestReservoirs[ctx.dataIndex];
                return item ? `Current level: ${item.percentage_full}%` : '';
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'TMC', font: { size: 10 } },
            ticks: { font: { size: 10 } },
          },
        },
      },
    });

    return () => {
      if (capacityChartInstanceRef.current) {
        capacityChartInstanceRef.current.destroy();
        capacityChartInstanceRef.current = null;
      }
    };
  }, [latestReservoirs]);

  // Chart.js 2: Historical Water Levels (%)
  useEffect(() => {
    const canvas = historyChartCanvasRef.current;
    if (!canvas) return;
    if (historyChartInstanceRef.current) historyChartInstanceRef.current.destroy();

    const allDates = Array.from(
      new Set(reservoirs.map((r) => String(r.monitoring_date || '').slice(0, 10)))
    )
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const targetNames =
      selectedHistoryReservoir === 'all'
        ? reservoirNames.slice(0, 6)
        : [selectedHistoryReservoir];

    const datasets = targetNames.map((name, idx) => {
      const dateToPct = new Map<string, number>();
      for (const rec of reservoirs) {
        if (rec.reservoir_name === name) {
          dateToPct.set(
            String(rec.monitoring_date || '').slice(0, 10),
            rec.percentage_full || 0
          );
        }
      }
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      return {
        label: name.split('(')[0].trim(),
        data: allDates.map((d) => (dateToPct.has(d) ? dateToPct.get(d)! : null)),
        borderColor: color,
        backgroundColor: color,
        tension: 0.25,
        spanGaps: true,
        pointRadius: 3,
      };
    });

    historyChartInstanceRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: allDates.map((d) => formatDate(d)),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, font: { size: 11 } },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            min: 0,
            max: 100,
            ticks: { font: { size: 10 }, callback: (v) => `${v}%` },
          },
        },
      },
    });

    return () => {
      if (historyChartInstanceRef.current) {
        historyChartInstanceRef.current.destroy();
        historyChartInstanceRef.current = null;
      }
    };
  }, [reservoirs, reservoirNames, selectedHistoryReservoir]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const gross = Number(form.gross_capacity || 0);
      const pct = Number(form.percentage_full || 0);
      const computedLive =
        form.live_capacity !== ''
          ? Number(form.live_capacity)
          : Number(((gross * pct) / 100).toFixed(2));

      const res = await fetch('/api/reservoirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          design_capacity: gross,
          live_capacity: computedLive,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to save reservoir record');
      }
      setMessage({
        type: 'success',
        text: 'Observation stored across HDFS reservoir shards.',
      });
      setForm({
        reservoir_name: '',
        district: '',
        river: '',
        basin: '',
        monitoring_date: new Date().toISOString().slice(0, 10),
        percentage_full: '',
        reservoir_level: '',
        gross_capacity: '',
        live_capacity: '',
        inflow: '',
        outflow: '',
      });
      setShowAddForm(false);
      await onRefreshReservoirs();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Save error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Compact Header + Action Buttons */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Reservoirs &amp; Water Levels
          </h1>
          <span className="text-xs text-slate-500">
            {kpis.count} reservoirs · {kpis.lowAlerts.length} low alerts
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={syncingNwdp}
            onClick={async () => {
              setSyncingNwdp(true);
              setMessage(null);
              try {
                const res = await fetch('/api/reservoirs/sync-live-nwdp', {
                  method: 'POST',
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                  throw new Error(data.message || 'NWDP live sync failed');
                }
                if (Array.isArray(data.dams)) setSyncedDams(data.dams);
                setMessage({ type: 'success', text: data.message });
                await onRefreshReservoirs();
              } catch (err) {
                setMessage({
                  type: 'error',
                  text: err instanceof Error ? err.message : 'NWDP sync error',
                });
              } finally {
                setSyncingNwdp(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingNwdp ? 'animate-spin' : ''}`} />
            {syncingNwdp ? 'Syncing NWDP...' : 'Sync Live NWDP'}
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            {showAddForm ? 'Close' : 'Add Observation'}
          </button>
        </div>
      </div>

      {/* 2. 5 Icon-Badged KPI Cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Total Capacity</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Database className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-slate-900">
            {formatNumber(kpis.totalCapacity)} TMC
          </p>
          <p className="mt-1.5 text-[11px] text-slate-500">
            {kpis.count} monitored dams
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Current Level</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Gauge className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-blue-700">
            {kpis.avgFillPct}%
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${Math.min(100, kpis.avgFillPct)}%` }}
              />
            </div>
            <span className="font-mono-data text-[11px] text-slate-500">
              {formatNumber(kpis.avgElevation)} ft
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Available Water</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Droplets className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-emerald-700">
            {formatNumber(kpis.availableWater)} TMC
          </p>
          <p className="mt-1.5 text-[11px] text-slate-500">Live storage on hand</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Inflow / Outflow</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-base font-bold text-slate-900">
            <span className="text-emerald-700">+{formatNumber(kpis.totalInflow)}</span>
            <span className="mx-1 text-slate-300">/</span>
            <span className="text-amber-700">-{formatNumber(kpis.totalOutflow)}</span>
          </p>
          <p className="mt-2 font-mono-data text-[11px] text-slate-500">
            Net {kpis.netInflow >= 0 ? `+${formatNumber(kpis.netInflow)}` : formatNumber(kpis.netInflow)} cusecs
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Low Alerts</span>
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                kpis.lowAlerts.length > 0
                  ? 'bg-red-50 text-red-600'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
          </div>
          <p
            className={`mt-2 font-mono-data text-xl font-bold ${
              kpis.lowAlerts.length > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {kpis.lowAlerts.length}
          </p>
          <p className="mt-1.5 text-[11px] text-slate-500">Below 55% threshold</p>
        </div>
      </section>

      {/* Collapsible Add Observation Form */}
      {showAddForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Add Reservoir Observation
          </h2>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <input
              required
              value={form.reservoir_name}
              onChange={(e) => setForm({ ...form, reservoir_name: e.target.value })}
              placeholder="Reservoir name *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select district</option>
              {districtsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              value={form.river}
              onChange={(e) => setForm({ ...form, river: e.target.value })}
              placeholder="River"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="date"
              value={form.monitoring_date}
              onChange={(e) => setForm({ ...form, monitoring_date: e.target.value })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              type="number"
              step="any"
              value={form.gross_capacity}
              onChange={(e) => setForm({ ...form, gross_capacity: e.target.value })}
              placeholder="Total capacity (TMC) *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              type="number"
              min={0}
              max={100}
              step="any"
              value={form.percentage_full}
              onChange={(e) => setForm({ ...form, percentage_full: e.target.value })}
              placeholder="Current level (%) *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="number"
              step="any"
              value={form.inflow}
              onChange={(e) => setForm({ ...form, inflow: e.target.value })}
              placeholder="Inflow (cusecs)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                value={form.outflow}
                onChange={(e) => setForm({ ...form, outflow: e.target.value })}
                placeholder="Outflow (cusecs)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </section>
      )}

      {message && (
        <p
          className={`rounded-lg px-3.5 py-2 text-xs font-medium ${
            message.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 3. Dual Chart.js Water-Level Graphs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Capacity vs. Available Storage (TMC)
            </h2>
            <BarChart3 className="h-4 w-4 text-slate-400 shrink-0" />
          </div>
          <div className="relative h-52 w-full">
            <canvas ref={capacityChartCanvasRef} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Historical Levels (%)
            </h2>
            <select
              value={selectedHistoryReservoir}
              onChange={(e) => setSelectedHistoryReservoir(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-800 sm:w-44"
            >
              <option value="all">All Major Reservoirs</option>
              {reservoirNames.map((name) => (
                <option key={name} value={name}>
                  {name.split('(')[0].trim()}
                </option>
              ))}
            </select>
          </div>
          <div className="relative h-52 w-full">
            <canvas ref={historyChartCanvasRef} />
          </div>
        </section>
      </div>

      {/* 4. Unified Reservoir & Live NWDP Table + Low-Level Alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTableTab('stored')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  tableTab === 'stored'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Reservoirs ({latestReservoirs.length})
              </button>
              <button
                type="button"
                onClick={() => setTableTab('nwdp')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                  tableTab === 'nwdp'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Live NWDP Dams ({nwdpList.length})
              </button>
            </div>
            <span className="text-[11px] text-slate-400">
              {tableTab === 'stored' ? 'TMC & cusecs' : 'nwdp.nwic.gov.in'}
            </span>
          </div>

          {tableTab === 'stored' ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Reservoir · District</th>
                      <th className="py-2 px-2.5 text-right font-medium">Available / Cap</th>
                      <th className="py-2 px-2.5 font-medium">Level</th>
                      <th className="py-2 px-2.5 text-right font-medium">In / Out</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleReservoirs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-500">
                          No reservoir records available.
                        </td>
                      </tr>
                    ) : (
                      visibleReservoirs.map((item) => {
                        const cap = item.gross_capacity || item.design_capacity || 0;
                        const pct = item.percentage_full || 0;
                        const isCritical = pct < 40;
                        const isLow = pct < 55;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="py-2 pr-3 whitespace-nowrap">
                              <span className="font-medium text-slate-900">
                                {item.reservoir_name.split('(')[0].trim()}
                              </span>
                              <span className="text-slate-400"> · {item.district || '—'}</span>
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                              <span className="font-semibold text-slate-900">
                                {formatNumber(item.live_capacity)}
                              </span>{' '}
                              / {formatNumber(cap)}
                            </td>
                            <td className="py-2 px-2.5 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-full rounded-full ${
                                      isCritical
                                        ? 'bg-red-600'
                                        : isLow
                                        ? 'bg-amber-500'
                                        : 'bg-blue-600'
                                    }`}
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                                <span className="font-mono-data font-semibold text-slate-800">
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data whitespace-nowrap">
                              <span className="text-emerald-700">+{formatNumber(item.inflow)}</span>
                              <span className="mx-1 text-slate-300">/</span>
                              <span className="text-amber-700">-{formatNumber(item.outflow)}</span>
                            </td>
                            <td
                              className={`py-2 pl-2.5 text-right font-semibold whitespace-nowrap ${
                                isCritical
                                  ? 'text-red-700'
                                  : isLow
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {isCritical ? 'Critical' : isLow ? 'Low' : 'Normal'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {latestReservoirs.length > DEFAULT_ROW_LIMIT && (
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                  <span>
                    Showing {visibleReservoirs.length} of {latestReservoirs.length} reservoirs
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllReservoirs((v) => !v)}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
                  >
                    {showAllReservoirs
                      ? 'Show top 8'
                      : `Show all (${latestReservoirs.length})`}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${
                        showAllReservoirs ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Dam · District</th>
                    <th className="py-2 px-2.5 font-medium">Date</th>
                    <th className="py-2 px-2.5 text-right font-medium">Live %</th>
                    <th className="py-2 px-2.5 text-right font-medium">Storage (TMC)</th>
                    <th className="py-2 pl-2.5 text-right font-medium">In / Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {nwdpList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Click &ldquo;Sync Live NWDP&rdquo; to fetch upstream readings.
                      </td>
                    </tr>
                  ) : (
                    nwdpList.slice(0, DEFAULT_ROW_LIMIT).map((dam) => (
                      <tr key={dam.reservoir_name} className="hover:bg-slate-50/70">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="font-medium text-slate-900">
                            {dam.reservoir_name}
                          </span>
                          <span className="text-slate-400"> · {dam.district}</span>
                        </td>
                        <td className="py-2 px-2.5 font-mono-data text-slate-600 whitespace-nowrap">
                          {formatDate(dam.monitoring_date)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-blue-700">
                          {dam.percentage_full}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                          {formatNumber(dam.live_capacity)} / {formatNumber(dam.gross_capacity)}
                        </td>
                        <td className="py-2 pl-2.5 text-right font-mono-data whitespace-nowrap">
                          <span className="text-emerald-700">+{formatNumber(dam.inflow)}</span>
                          <span className="mx-1 text-slate-300">/</span>
                          <span className="text-amber-700">-{formatNumber(dam.outflow)}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Low-Water-Level Alerts Panel */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Low-Level Alerts (&lt;55%)
                </h2>
              </div>
              <span className="font-mono-data text-xs font-semibold text-red-700">
                {kpis.lowAlerts.length}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {kpis.lowAlerts.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  All reservoirs are above 55% storage.
                </p>
              ) : (
                visibleAlerts.map((alert) => {
                  const cap = alert.gross_capacity || alert.design_capacity || 0;
                  const net = Math.round((alert.inflow || 0) - (alert.outflow || 0));
                  const critical = alert.percentage_full < 40;
                  return (
                    <div key={alert.id} className="py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 truncate">
                          {alert.reservoir_name.split('(')[0].trim()}
                        </span>
                        <span
                          className={`shrink-0 font-mono-data font-semibold ${
                            critical ? 'text-red-700' : 'text-amber-700'
                          }`}
                        >
                          {alert.percentage_full}%
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="truncate">
                          {alert.district} · {formatNumber(alert.live_capacity)}/{formatNumber(cap)} TMC
                        </span>
                        <span
                          className={`font-mono-data font-medium shrink-0 ${
                            net < 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {net >= 0 ? `+${formatNumber(net)}` : formatNumber(net)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {kpis.lowAlerts.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllAlerts((v) => !v)}
              className="mt-3 w-full border-t border-slate-100 pt-2.5 text-center text-xs font-semibold text-blue-600 hover:underline"
            >
              {showAllAlerts ? 'Show top 5' : `View all ${kpis.lowAlerts.length} alerts`}
            </button>
          )}
        </section>
      </div>

      {/* 5. Compact Tabbed Distributed Tools */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-slate-900">
            Reservoir Analytics &amp; HDFS
          </h2>

          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'history', label: 'HDFS History', icon: Database },
                { id: 'mapreduce', label: 'MapReduce Avg', icon: TrendingUp },
                { id: 'hive', label: 'HiveQL', icon: Terminal },
                { id: 'python', label: 'Python Analysis', icon: BarChart3 },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveToolTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    activeToolTab === tab.id
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
        </div>

        {/* Tab 1: HDFS History */}
        {activeToolTab === 'history' && (
          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                <span className="font-mono-data font-semibold text-slate-800">
                  {filteredHistory.length}
                </span>{' '}
                observations across HDFS reservoir shards
              </span>
              <select
                value={selectedHistoryReservoir}
                onChange={(e) => {
                  setSelectedHistoryReservoir(e.target.value);
                  setShowAllHistory(false);
                }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800"
              >
                <option value="all">All Reservoirs</option>
                {reservoirNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 px-2.5 font-medium">Reservoir</th>
                    <th className="py-2 px-2.5 text-right font-medium">Fill %</th>
                    <th className="py-2 px-2.5 text-right font-medium">Level (ft)</th>
                    <th className="py-2 px-2.5 text-right font-medium">Available</th>
                    <th className="py-2 px-2.5 text-right font-medium">In / Out</th>
                    <th className="py-2 pl-2.5 text-right font-medium">HDFS Block</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleHistory.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-2 pr-3 font-mono-data text-slate-600 whitespace-nowrap">
                        {formatDate(row.monitoring_date)}
                      </td>
                      <td className="py-2 px-2.5 font-medium text-slate-900 whitespace-nowrap">
                        {row.reservoir_name.split('(')[0].trim()}
                      </td>
                      <td
                        className={`py-2 px-2.5 text-right font-mono-data font-semibold whitespace-nowrap ${
                          row.percentage_full < 40
                            ? 'text-red-700'
                            : row.percentage_full < 55
                            ? 'text-amber-700'
                            : 'text-blue-700'
                        }`}
                      >
                        {row.percentage_full}%
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                        {formatNumber(row.reservoir_level)}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                        {formatNumber(row.live_capacity)} TMC
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono-data whitespace-nowrap">
                        <span className="text-emerald-700">+{formatNumber(row.inflow)}</span>
                        <span className="mx-1 text-slate-300">/</span>
                        <span className="text-amber-700">-{formatNumber(row.outflow)}</span>
                      </td>
                      <td className="py-2 pl-2.5 text-right font-mono-data text-[11px] text-slate-500 whitespace-nowrap">
                        {row.block_id || 'blk_res'} {row.hdfs_node ? `(${row.hdfs_node})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredHistory.length > DEFAULT_ROW_LIMIT && (
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
                <span>
                  Showing {visibleHistory.length} of {filteredHistory.length} records
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllHistory((v) => !v)}
                  className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
                >
                  {showAllHistory ? 'Show top 8' : `Show all (${filteredHistory.length})`}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${
                      showAllHistory ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: MapReduce Average */}
        {activeToolTab === 'mapreduce' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                {mrJob ? (
                  <>
                    Job <span className="font-mono-data font-semibold text-slate-900">{mrJob.jobId}</span> ·{' '}
                    {mrJob.inputSplits} splits · {mrJob.recordsScanned} records · {mrJob.durationMs} ms
                  </>
                ) : (
                  'Computing MapReduce reservoir level averages...'
                )}
              </span>
              <button
                type="button"
                onClick={runReservoirMapReduce}
                disabled={mrLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {mrLoading ? 'Running...' : 'Recalculate'}
              </button>
            </div>

            {mrJob && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Reservoir</th>
                      <th className="py-2 px-2.5 text-right font-medium">Obs</th>
                      <th className="py-2 px-2.5 text-right font-medium">Current %</th>
                      <th className="py-2 px-2.5 text-right font-medium">Avg %</th>
                      <th className="py-2 px-2.5 text-right font-medium">Min / Max %</th>
                      <th className="py-2 px-2.5 text-right font-medium">Avg Level (ft)</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Avg In / Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJob.results.slice(0, 10).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/70">
                        <td className="py-2 pr-3 font-medium text-slate-900 whitespace-nowrap">
                          {String(r.reservoir_name).split('(')[0].trim()}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-600">
                          {String(r.observation_count)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-blue-700">
                          {String(r.current_fill_pct)}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-slate-900">
                          {String(r.avg_fill_pct)}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-600 whitespace-nowrap">
                          {String(r.min_fill_pct)}% / {String(r.max_fill_pct)}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-700">
                          {formatNumber(Number(r.avg_level_ft))}
                        </td>
                        <td className="py-2 pl-2.5 text-right font-mono-data whitespace-nowrap">
                          <span className="text-emerald-700">+{formatNumber(Number(r.avg_inflow))}</span>
                          <span className="mx-1 text-slate-300">/</span>
                          <span className="text-amber-700">-{formatNumber(Number(r.avg_outflow))}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: HiveQL */}
        {activeToolTab === 'hive' && (
          <div className="mt-4 space-y-3">
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
                onClick={() => runHiveQuery(hiveQuery)}
                disabled={hiveLoading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                {hiveLoading ? 'Running...' : 'Run HiveQL'}
              </button>
            </div>

            {hiveResult && !hiveResult.success && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {hiveResult.error}
              </p>
            )}

            {hiveResult?.success && (
              <div>
                <p className="mb-2 text-xs text-slate-500">
                  {hiveResult.table} · {hiveResult.hdfsBlocksScanned} HDFS blocks ·{' '}
                  {hiveResult.rowsReturned} rows ({hiveResult.durationMs} ms)
                </p>
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-200 text-slate-500">
                        {hiveResult.columns.map((col) => (
                          <th key={col} className="py-2 px-2.5 font-medium whitespace-nowrap">
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
                              className="py-2 px-2.5 font-mono-data text-slate-700 whitespace-nowrap"
                            >
                              {row[col] !== null && row[col] !== undefined
                                ? String(row[col])
                                : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Python Water-Level Analysis */}
        {activeToolTab === 'python' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-600">
                {pythonReport
                  ? `${pythonReport.engine} · ${pythonReport.reservoirs_analyzed} records · ${pythonReport.duration_ms} ms`
                  : 'Running Python water-level statistics...'}
              </p>
              <button
                type="button"
                onClick={runPythonAnalysis}
                disabled={pythonLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {pythonLoading ? 'Analyzing...' : 'Re-run Python'}
              </button>
            </div>

            {pythonReport?.reservoir_analysis && (
              <>
                <div className="grid grid-cols-2 gap-3 border-y border-slate-100 py-2.5 sm:grid-cols-4 text-xs">
                  <div>
                    <span className="text-slate-500">Mean Fill</span>
                    <p className="font-mono-data text-sm font-bold text-blue-700">
                      {pythonReport.reservoir_analysis.mean_fill_pct}%
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Median Fill</span>
                    <p className="font-mono-data text-sm font-bold text-slate-900">
                      {pythonReport.reservoir_analysis.median_fill_pct}%
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Std Dev</span>
                    <p className="font-mono-data text-sm font-bold text-slate-900">
                      {pythonReport.reservoir_analysis.stdev_fill_pct}%
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Net Basin Inflow</span>
                    <p
                      className={`font-mono-data text-sm font-bold ${
                        pythonReport.reservoir_analysis.net_inflow_cusecs >= 0
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {pythonReport.reservoir_analysis.net_inflow_cusecs >= 0
                        ? `+${formatNumber(pythonReport.reservoir_analysis.net_inflow_cusecs)}`
                        : formatNumber(pythonReport.reservoir_analysis.net_inflow_cusecs)}{' '}
                      cusecs
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-medium">Reservoir</th>
                        <th className="py-2 px-2.5 text-right font-medium">Current %</th>
                        <th className="py-2 px-2.5 text-right font-medium">Avg %</th>
                        <th className="py-2 px-2.5 text-right font-medium">Trend</th>
                        <th className="py-2 px-2.5 text-right font-medium">Available / Cap</th>
                        <th className="py-2 pl-2.5 text-right font-medium">Net Flow</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pythonReport.reservoir_analysis.reservoir_stats.slice(0, 10).map((row) => (
                        <tr key={row.reservoir_name} className="hover:bg-slate-50/70">
                          <td className="py-2 pr-3 font-medium text-slate-900 whitespace-nowrap">
                            {row.reservoir_name.split('(')[0].trim()}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-blue-700">
                            {row.current_fill_pct}%
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-slate-700">
                            {row.avg_fill_pct}%
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono-data font-semibold ${
                              row.trend_delta_pct >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {row.trend_delta_pct >= 0
                              ? `+${row.trend_delta_pct}%`
                              : `${row.trend_delta_pct}%`}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                            {formatNumber(row.available_tmc)} / {formatNumber(row.capacity_tmc)}
                          </td>
                          <td
                            className={`py-2 pl-2.5 text-right font-mono-data whitespace-nowrap ${
                              row.net_inflow_cusecs >= 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {row.net_inflow_cusecs >= 0
                              ? `+${formatNumber(row.net_inflow_cusecs)}`
                              : formatNumber(row.net_inflow_cusecs)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
