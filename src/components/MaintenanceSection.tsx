import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Database,
  Droplets,
  IndianRupee,
  Play,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import type {
  HivePreset,
  HiveQueryResult,
  LiveMaintenanceFeedsResponse,
  LiveMaintenanceTrigger,
  MaintenanceAssetType,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenancePythonSummary,
  MaintenanceStatus,
  MaintenanceTask,
  MapReduceJobTrace,
} from '../types';
import { formatDate, formatLitres, formatNumber } from '../utils/format';

interface MaintenanceSectionProps {
  tasks: MaintenanceTask[];
  districtsList: string[];
  liveFeeds: LiveMaintenanceFeedsResponse | null;
  onRefreshTasks: () => Promise<void>;
  onRefreshLiveFeeds: (force?: boolean) => Promise<void>;
}

type MainSectionTab = 'orders' | 'triggers' | 'analytics';
type WorkbenchTab = 'mapreduce' | 'python' | 'hive';

const ASSET_TYPES: MaintenanceAssetType[] = [
  'Pipeline / Main',
  'Pumping Station',
  'Filtration / WTP',
  'Overhead Tank',
  'Reservoir Gate',
  'Borewell / Aquifer',
];

const MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  'Pipeline Leak Repair',
  'Pump Overhaul',
  'Water Quality & Chlorination',
  'Filter Media Flush',
  'Valve Replacement',
  'Reservoir Desilting',
];

const PRIORITIES: MaintenancePriority[] = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES: MaintenanceStatus[] = ['Scheduled', 'In Progress', 'Completed', 'Deferred'];

const DEFAULT_ROW_LIMIT = 8;

function priorityTextClass(p: MaintenancePriority): string {
  if (p === 'Critical') return 'text-red-700';
  if (p === 'High') return 'text-amber-700';
  if (p === 'Medium') return 'text-blue-700';
  return 'text-slate-600';
}

function statusTextClass(s: MaintenanceStatus): string {
  if (s === 'Completed') return 'text-emerald-700';
  if (s === 'In Progress') return 'text-blue-700';
  if (s === 'Scheduled') return 'text-amber-700';
  return 'text-slate-500';
}

export const MaintenanceSection: React.FC<MaintenanceSectionProps> = ({
  tasks,
  districtsList,
  liveFeeds,
  onRefreshTasks,
  onRefreshLiveFeeds,
}) => {
  const [sectionTab, setSectionTab] = useState<MainSectionTab>('orders');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showAllTriggers, setShowAllTriggers] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [form, setForm] = useState({
    district: districtsList[0] || 'Bengaluru Urban',
    area: '',
    asset_name: '',
    asset_type: 'Pipeline / Main' as MaintenanceAssetType,
    maintenance_type: 'Pipeline Leak Repair' as MaintenanceCategory,
    priority: 'High' as MaintenancePriority,
    assigned_crew: 'Rapid Leak Response Team',
    scheduled_date: new Date().toISOString().slice(0, 10),
    estimated_cost_inr: '45000',
    water_saved_lpd: '120000',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [syncingAlerts, setSyncingAlerts] = useState(false);
  const [creatingTriggerId, setCreatingTriggerId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Workbench tabs
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('mapreduce');
  const [mrJob, setMrJob] = useState<MapReduceJobTrace | null>(null);
  const [mrLoading, setMrLoading] = useState(false);

  const [pythonSummary, setPythonSummary] = useState<MaintenancePythonSummary | null>(null);
  const [pythonLoading, setPythonLoading] = useState(false);

  const [hivePresets, setHivePresets] = useState<HivePreset[]>([]);
  const [hiveQuery, setHiveQuery] = useState<string>(
    "SELECT task_code, district, area, maintenance_type, priority, status, water_saved_lpd, estimated_cost_inr FROM aqua_maintenance_tasks WHERE status != 'Completed' ORDER BY water_saved_lpd DESC LIMIT 20"
  );
  const [hiveResult, setHiveResult] = useState<HiveQueryResult | null>(null);
  const [hiveLoading, setHiveLoading] = useState(false);

  const categoryChartRef = useRef<HTMLCanvasElement | null>(null);
  const categoryChartInstance = useRef<Chart | null>(null);
  const statusChartRef = useRef<HTMLCanvasElement | null>(null);
  const statusChartInstance = useRef<Chart | null>(null);

  const kpis = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'Completed');
    const urgent = open.filter((t) => t.priority === 'Critical' || t.priority === 'High');
    const waterSavedLpd = tasks.reduce((s, t) => s + (t.water_saved_lpd || 0), 0);
    const totalBudgetInr = tasks.reduce((s, t) => s + (t.estimated_cost_inr || 0), 0);
    const completedCount = tasks.filter((t) => t.status === 'Completed').length;
    return {
      total: tasks.length,
      openCount: open.length,
      urgentCount: urgent.length,
      waterSavedLpd,
      totalBudgetInr,
      completedCount,
    };
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (districtFilter !== 'all' && t.district.toLowerCase() !== districtFilter.toLowerCase()) {
        return false;
      }
      if (!q) return true;
      const hay = `${t.task_code} ${t.district} ${t.area} ${t.asset_name} ${t.maintenance_type} ${t.assigned_crew} ${t.telemetry_source} ${t.notes}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, statusFilter, districtFilter, search]);

  const triggers = liveFeeds?.detected_alerts || [];
  const visibleTasks = showAllOrders ? filteredTasks : filteredTasks.slice(0, DEFAULT_ROW_LIMIT);
  const visibleTriggers = showAllTriggers ? triggers : triggers.slice(0, DEFAULT_ROW_LIMIT);

  const runMaintenanceMapReduce = useCallback(async () => {
    setMrLoading(true);
    try {
      const res = await fetch('/api/mapreduce/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'maintenance_priority_summary',
          numReducers: 4,
          engine: 'python',
        }),
      });
      const data = await res.json();
      if (data?.success && data.job) setMrJob(data.job);
    } catch {
      // ignore
    } finally {
      setMrLoading(false);
    }
  }, []);

  const loadPythonSummary = useCallback(async () => {
    setPythonLoading(true);
    try {
      const res = await fetch('/api/maintenance/python-summary');
      const data = (await res.json()) as MaintenancePythonSummary;
      if (data?.success) setPythonSummary(data);
    } catch {
      // ignore
    } finally {
      setPythonLoading(false);
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
    if (sectionTab !== 'analytics') return;
    if (activeTab === 'mapreduce' && !mrJob) {
      runMaintenanceMapReduce();
    } else if (activeTab === 'python' && !pythonSummary) {
      loadPythonSummary();
    } else if (activeTab === 'hive') {
      if (hivePresets.length === 0) {
        fetch('/api/hive/presets?table=maintenance')
          .then((r) => r.json())
          .then((d) => {
            if (d?.presets) setHivePresets(d.presets);
          })
          .catch(() => {});
      }
      if (!hiveResult) runHiveQuery(hiveQuery);
    }
  }, [
    sectionTab,
    activeTab,
    mrJob,
    pythonSummary,
    hivePresets.length,
    hiveResult,
    hiveQuery,
    runMaintenanceMapReduce,
    loadPythonSummary,
    runHiveQuery,
  ]);

  // Chart 1: Water Saved & Cost by Maintenance Category
  useEffect(() => {
    if (sectionTab !== 'analytics') return;
    const canvas = categoryChartRef.current;
    if (!canvas) return;
    if (categoryChartInstance.current) categoryChartInstance.current.destroy();

    const grouped = new Map<string, { waterSaved: number; costK: number }>();
    for (const t of tasks) {
      const cur = grouped.get(t.maintenance_type) || { waterSaved: 0, costK: 0 };
      cur.waterSaved += (t.water_saved_lpd || 0) / 1000;
      cur.costK += (t.estimated_cost_inr || 0) / 1000;
      grouped.set(t.maintenance_type, cur);
    }
    const labels = Array.from(grouped.keys());

    categoryChartInstance.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.map((l) => l.replace('Water Quality & ', '')),
        datasets: [
          {
            label: 'Water Saved (KL/d)',
            data: labels.map((l) => Math.round(grouped.get(l)?.waterSaved || 0)),
            backgroundColor: '#1677df',
            borderRadius: 4,
          },
          {
            label: 'Cost (INR k)',
            data: labels.map((l) => Math.round(grouped.get(l)?.costK || 0)),
            backgroundColor: '#18a878',
            borderRadius: 4,
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

    return () => {
      if (categoryChartInstance.current) {
        categoryChartInstance.current.destroy();
        categoryChartInstance.current = null;
      }
    };
  }, [tasks, sectionTab]);

  // Chart 2: Work Orders by Status & Priority
  useEffect(() => {
    if (sectionTab !== 'analytics') return;
    const canvas = statusChartRef.current;
    if (!canvas) return;
    if (statusChartInstance.current) statusChartInstance.current.destroy();

    const statusCounts = STATUSES.map(
      (st) => tasks.filter((t) => t.status === st).length
    );

    statusChartInstance.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: STATUSES,
        datasets: [
          {
            label: 'Critical',
            data: STATUSES.map(
              (st) =>
                tasks.filter((t) => t.status === st && t.priority === 'Critical').length
            ),
            backgroundColor: '#dc2626',
            borderRadius: 4,
          },
          {
            label: 'High',
            data: STATUSES.map(
              (st) => tasks.filter((t) => t.status === st && t.priority === 'High').length
            ),
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
          {
            label: 'Medium / Low',
            data: STATUSES.map(
              (st) =>
                tasks.filter(
                  (t) =>
                    t.status === st &&
                    (t.priority === 'Medium' || t.priority === 'Low')
                ).length
            ),
            backgroundColor: '#1677df',
            borderRadius: 4,
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
                return `Total ${STATUSES[idx]}: ${statusCounts[idx]} orders`;
              },
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
        },
      },
    });

    return () => {
      if (statusChartInstance.current) {
        statusChartInstance.current.destroy();
        statusChartInstance.current = null;
      }
    };
  }, [tasks, sectionTab]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/maintenance/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimated_cost_inr: Number(form.estimated_cost_inr || 0),
          water_saved_lpd: Number(form.water_saved_lpd || 0),
          telemetry_source: 'Manual Dispatch',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to create work order');
      }
      setNotice({
        type: 'success',
        text: `Work order ${data.record?.task_code} created and persisted to SQLite & HDFS.`,
      });
      setForm({ ...form, area: '', asset_name: '', notes: '' });
      setShowAddForm(false);
      await onRefreshTasks();
      if (activeTab === 'python') loadPythonSummary();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Save error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncLiveAlerts = async () => {
    setSyncingAlerts(true);
    setNotice(null);
    try {
      const res = await fetch('/api/maintenance/sync-live-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Live telemetry sync failed');
      }
      setNotice({
        type: 'success',
        text:
          data.created_count > 0
            ? `Created ${data.created_count} work orders from ${data.total_detected_alerts} live triggers.`
            : `Scanned ${data.total_detected_alerts} live triggers — all active issues covered.`,
      });
      await Promise.all([onRefreshTasks(), onRefreshLiveFeeds(true)]);
      if (activeTab === 'python') loadPythonSummary();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setSyncingAlerts(false);
    }
  };

  const handleCreateFromTrigger = async (trigger: LiveMaintenanceTrigger) => {
    setCreatingTriggerId(trigger.trigger_id);
    setNotice(null);
    try {
      const res = await fetch('/api/maintenance/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: trigger.district,
          area: trigger.area,
          asset_name: trigger.asset_name,
          asset_type: trigger.asset_type,
          maintenance_type: trigger.maintenance_type,
          priority: trigger.priority,
          assigned_crew: `${trigger.district} Rapid Maintenance Team`,
          estimated_cost_inr: trigger.estimated_cost_inr,
          water_saved_lpd: trigger.water_saved_lpd,
          telemetry_source: trigger.source,
          notes: trigger.reason,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to create work order from alert');
      }
      setNotice({
        type: 'success',
        text: `Scheduled ${data.record?.task_code} (${trigger.asset_name}).`,
      });
      await onRefreshTasks();
      if (activeTab === 'python') loadPythonSummary();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Create failed',
      });
    } finally {
      setCreatingTriggerId(null);
    }
  };

  const handleStatusChange = async (id: number, status: MaintenanceStatus) => {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/maintenance/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        await onRefreshTasks();
        if (activeTab === 'python') loadPythonSummary();
      }
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteTask = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/maintenance/tasks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmDeleteId(null);
        await onRefreshTasks();
        if (activeTab === 'python') loadPythonSummary();
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Action Controls */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Water Infrastructure Maintenance
          </h1>
          <span className="text-xs text-slate-500">
            {kpis.openCount} active · {triggers.length} live triggers
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSyncLiveAlerts}
            disabled={syncingAlerts}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncingAlerts ? 'animate-spin' : ''}`} />
            {syncingAlerts ? 'Syncing...' : 'Sync Live Alerts'}
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            {showAddForm ? 'Close' : 'New Work Order'}
          </button>
        </div>
      </div>

      {/* 4 Icon-Accented KPI Cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Open Orders</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-slate-900">
              {formatNumber(kpis.openCount)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {kpis.completedCount} done · {kpis.total} total
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Wrench className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Critical / High</p>
            <p
              className={`mt-1 font-mono-data text-xl font-bold ${
                kpis.urgentCount > 0 ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {formatNumber(kpis.urgentCount)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Urgent field tasks</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Water Saved</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-blue-700">
              {formatLitres(kpis.waterSavedLpd)}/d
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Leak &amp; WTP recovery</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Droplets className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Allocation</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-emerald-700">
              ₹{formatNumber(kpis.totalBudgetInr)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">SQLite + HDFS budget</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <IndianRupee className="h-4 w-4" />
          </div>
        </div>
      </section>

      {/* Collapsible Create Form */}
      {showAddForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Schedule Maintenance Work Order
          </h2>
          <form
            onSubmit={handleCreateTask}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <select
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
            >
              {districtsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              required
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="Area / Zone *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
            />
            <input
              required
              value={form.asset_name}
              onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
              placeholder="Asset / Station Name *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
            />
            <select
              value={form.asset_type}
              onChange={(e) =>
                setForm({ ...form, asset_type: e.target.value as MaintenanceAssetType })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={form.maintenance_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  maintenance_type: e.target.value as MaintenanceCategory,
                })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
            >
              {MAINTENANCE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={form.priority}
              onChange={(e) =>
                setForm({ ...form, priority: e.target.value as MaintenancePriority })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  Priority: {p}
                </option>
              ))}
            </select>
            <input
              value={form.assigned_crew}
              onChange={(e) => setForm({ ...form, assigned_crew: e.target.value })}
              placeholder="Assigned Crew"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
            />
            <input
              type="date"
              value={form.scheduled_date}
              onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900"
            />
            <input
              type="number"
              min={0}
              value={form.water_saved_lpd}
              onChange={(e) => setForm({ ...form, water_saved_lpd: e.target.value })}
              placeholder="Est. Saved (L/day)"
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900"
            />
            <input
              type="number"
              min={0}
              value={form.estimated_cost_inr}
              onChange={(e) => setForm({ ...form, estimated_cost_inr: e.target.value })}
              placeholder="Est. Cost (INR)"
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900"
            />
            <div className="sm:col-span-2 flex gap-2">
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Diagnostic notes"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {saving ? 'Saving...' : 'Create Order'}
              </button>
            </div>
          </form>
        </section>
      )}

      {notice && (
        <p
          className={`rounded-lg px-3.5 py-2 text-xs font-medium ${
            notice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* Primary View Switcher: Work Orders | Live Telemetry Triggers | Charts & Big Data */}
      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
        {(
          [
            { id: 'orders', label: `Work Orders (${tasks.length})`, icon: Wrench },
            { id: 'triggers', label: `Live Triggers (${triggers.length})`, icon: Activity },
            { id: 'analytics', label: 'Charts & Big Data', icon: BarChart3 },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSectionTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                sectionTab === tab.id
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

      {/* TAB 1: WORK ORDERS */}
      {sectionTab === 'orders' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['all', ...STATUSES] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setStatusFilter(st);
                    setShowAllOrders(false);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'all' ? `All (${tasks.length})` : st}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={districtFilter}
                onChange={(e) => {
                  setDistrictFilter(e.target.value);
                  setShowAllOrders(false);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
              >
                <option value="all">All Districts</option>
                {districtsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setShowAllOrders(false);
                  }}
                  placeholder="Search asset, crew, code..."
                  className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Order · Date</th>
                  <th className="py-2 px-2.5 font-medium">Asset &amp; Crew</th>
                  <th className="py-2 px-2.5 font-medium">Category</th>
                  <th className="py-2 px-2.5 font-medium">Priority</th>
                  <th className="py-2 px-2.5 text-right font-medium">Saved / Cost</th>
                  <th className="py-2 px-2.5 font-medium">Status</th>
                  <th className="py-2 pl-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleTasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No maintenance work orders match the active filters.
                    </td>
                  </tr>
                ) : (
                  visibleTasks.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <p className="font-mono-data font-semibold text-slate-900">{t.task_code}</p>
                        <p className="font-mono-data text-[11px] text-slate-400">
                          {formatDate(t.scheduled_date)}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <p className="font-medium text-slate-900">{t.asset_name}</p>
                        <p className="text-[11px] text-slate-500">
                          {t.area}, {t.district} · {t.assigned_crew}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <p className="text-slate-800">{t.maintenance_type}</p>
                        <p className="text-[11px] text-slate-400">{t.telemetry_source}</p>
                      </td>
                      <td className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${priorityTextClass(t.priority)}`}>
                        {t.priority}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data whitespace-nowrap">
                        <p className="font-semibold text-blue-700">
                          {formatLitres(t.water_saved_lpd)}/d
                        </p>
                        <p className="text-[11px] text-slate-500">
                          ₹{formatNumber(t.estimated_cost_inr)}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <select
                          value={t.status}
                          disabled={updatingId === t.id}
                          onChange={(e) =>
                            handleStatusChange(t.id, e.target.value as MaintenanceStatus)
                          }
                          className={`rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold ${statusTextClass(
                            t.status
                          )}`}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s} className="text-slate-900">
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                        {confirmDeleteId === t.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={deletingId === t.id}
                              onClick={() => handleDeleteTask(t.id)}
                              className="text-[11px] font-semibold text-red-700 hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[11px] text-slate-500 hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete ${t.task_code}`}
                            onClick={() => setConfirmDeleteId(t.id)}
                            className="inline-flex items-center text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filteredTasks.length > DEFAULT_ROW_LIMIT && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span>
                Showing {visibleTasks.length} of {filteredTasks.length} orders
              </span>
              <button
                type="button"
                onClick={() => setShowAllOrders((v) => !v)}
                className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
              >
                {showAllOrders ? 'Show top 8' : `Show all (${filteredTasks.length})`}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showAllOrders ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: LIVE TELEMETRY TRIGGERS */}
      {sectionTab === 'triggers' && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-blue-600" />
              Live Telemetry Anomalies (Open-Meteo · NWDP · HDFS)
            </h2>
            {liveFeeds?.checked_at && (
              <span className="font-mono-data text-[11px] text-slate-400">
                Scanned {formatDate(liveFeeds.checked_at)}
              </span>
            )}
          </div>

          {triggers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Fetching live Open-Meteo and NWDP feeds — click &ldquo;Sync Live Alerts&rdquo; to refresh.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 px-2.5 font-medium">District · Area</th>
                      <th className="py-2 px-2.5 font-medium">Recommended Work</th>
                      <th className="py-2 px-2.5 font-medium">Detected Reason</th>
                      <th className="py-2 px-2.5 font-medium">Priority</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Dispatch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleTriggers.map((tr) => {
                      const alreadyScheduled = tasks.some(
                        (t) =>
                          t.status !== 'Completed' &&
                          t.district.toLowerCase() === tr.district.toLowerCase() &&
                          t.area.toLowerCase() === tr.area.toLowerCase() &&
                          t.maintenance_type === tr.maintenance_type
                      );
                      return (
                        <tr key={tr.trigger_id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 pr-3 font-medium text-blue-700 whitespace-nowrap">
                            {tr.source}
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <span className="font-medium text-slate-900">{tr.district}</span>
                            <span className="text-slate-400"> · {tr.area}</span>
                          </td>
                          <td className="py-2.5 px-2.5 text-slate-800 whitespace-nowrap">
                            {tr.maintenance_type}
                          </td>
                          <td
                            className="py-2.5 px-2.5 text-slate-600 max-w-xs truncate"
                            title={tr.reason}
                          >
                            {tr.reason}
                          </td>
                          <td className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${priorityTextClass(tr.priority)}`}>
                            {tr.priority}
                          </td>
                          <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                            {alreadyScheduled ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Active
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={creatingTriggerId === tr.trigger_id}
                                onClick={() => handleCreateFromTrigger(tr)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                <Wrench className="h-3 w-3 text-blue-600" />
                                {creatingTriggerId === tr.trigger_id ? 'Creating...' : 'Create Order'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {triggers.length > DEFAULT_ROW_LIMIT && (
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span>
                    Showing {visibleTriggers.length} of {triggers.length} triggers
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllTriggers((v) => !v)}
                    className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
                  >
                    {showAllTriggers ? 'Show top 8' : `Show all (${triggers.length})`}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${showAllTriggers ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* TAB 3: CHARTS & BIG DATA WORKBENCH */}
      {sectionTab === 'analytics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Water Saved &amp; Cost by Category
              </h2>
              <div className="relative h-52 w-full">
                <canvas ref={categoryChartRef} />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Work Orders by Status &amp; Priority
              </h2>
              <div className="relative h-52 w-full">
                <canvas ref={statusChartRef} />
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
              <h2 className="text-sm font-semibold text-slate-900">
                MapReduce, Python SQLite &amp; HiveQL
              </h2>
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
                {(
                  [
                    { id: 'mapreduce', label: 'MapReduce', icon: TrendingUp },
                    { id: 'python', label: 'Python & SQLite', icon: Terminal },
                    { id: 'hive', label: 'Apache HiveQL', icon: Database },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                        activeTab === tab.id
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

            {activeTab === 'mapreduce' && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span>
                    {mrJob ? (
                      <>
                        <strong className="font-mono-data text-slate-900">{mrJob.jobId}</strong> ·{' '}
                        {mrJob.recordsScanned} tasks · {mrJob.durationMs} ms
                      </>
                    ) : (
                      'Ready to run MapReduce aggregation'
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={runMaintenanceMapReduce}
                    disabled={mrLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {mrLoading ? 'Running...' : 'Re-run'}
                  </button>
                </div>

                {mrJob && mrJob.results.length > 0 && (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-medium">District</th>
                          <th className="py-2 px-2.5 text-right font-medium">Orders</th>
                          <th className="py-2 px-2.5 text-right font-medium">Active</th>
                          <th className="py-2 px-2.5 text-right font-medium">Done</th>
                          <th className="py-2 px-2.5 text-right font-medium">Urgent</th>
                          <th className="py-2 px-2.5 text-right font-medium">Saved/d</th>
                          <th className="py-2 pl-2.5 text-right font-medium">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {mrJob.results.map((r, i) => (
                          <tr key={i} className="hover:bg-slate-50/70">
                            <td className="py-2 pr-3 font-medium text-slate-900 whitespace-nowrap">
                              {String(r.district)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {String(r.total_tasks)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data text-blue-700">
                              {Number(r.scheduled || 0) + Number(r.in_progress || 0)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data text-emerald-700">
                              {String(r.completed)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-red-700">
                              {String(r.critical_or_high_open)}
                            </td>
                            <td className="py-2 px-2.5 text-right font-mono-data">
                              {formatLitres(Number(r.total_water_saved_lpd || 0))}
                            </td>
                            <td className="py-2 pl-2.5 text-right font-mono-data">
                              ₹{formatNumber(Number(r.total_estimated_cost_inr || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'python' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>
                    {pythonSummary
                      ? `${pythonSummary.engine} · ${pythonSummary.synced_rows} SQLite rows`
                      : 'Running Python SQLite maintenance analytics...'}
                  </span>
                  <button
                    type="button"
                    onClick={loadPythonSummary}
                    disabled={pythonLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${pythonLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {pythonSummary && (
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <div className="overflow-x-auto">
                      <h3 className="mb-2 text-xs font-semibold text-slate-700">
                        Category Breakdown
                      </h3>
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">Category</th>
                            <th className="py-1.5 px-2 text-right font-medium">Tasks</th>
                            <th className="py-1.5 px-2 text-right font-medium">Saved</th>
                            <th className="py-1.5 pl-2 text-right font-medium">Budget</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pythonSummary.category_breakdown.map((c) => (
                            <tr key={c.maintenance_type}>
                              <td className="py-1.5 pr-3 font-medium text-slate-900">
                                {c.maintenance_type}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-data">{c.task_count}</td>
                              <td className="py-1.5 px-2 text-right font-mono-data text-blue-700">
                                {formatLitres(c.total_water_saved_lpd)}/d
                              </td>
                              <td className="py-1.5 pl-2 text-right font-mono-data">
                                ₹{formatNumber(c.total_cost_inr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="overflow-x-auto">
                      <h3 className="mb-2 text-xs font-semibold text-slate-700">
                        Crew Workload
                      </h3>
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500">
                            <th className="py-1.5 pr-3 font-medium">Crew</th>
                            <th className="py-1.5 px-2 text-right font-medium">Total</th>
                            <th className="py-1.5 px-2 text-right font-medium">Urgent</th>
                            <th className="py-1.5 pl-2 text-right font-medium">Done</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pythonSummary.crew_workload.map((w) => (
                            <tr key={w.assigned_crew}>
                              <td className="py-1.5 pr-3 font-medium text-slate-900">
                                {w.assigned_crew}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-data">
                                {w.assigned_count}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-data text-red-700">
                                {w.urgent_open}
                              </td>
                              <td className="py-1.5 pl-2 text-right font-mono-data text-emerald-700">
                                {w.completed_count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'hive' && (
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
          </section>
        </div>
      )}
    </div>
  );
};
