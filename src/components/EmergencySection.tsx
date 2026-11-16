import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  GitBranch,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  EmergencyRequest,
  EmergencyStatus,
  HivePreset,
  HiveQueryResult,
  MapReduceJobTrace,
} from '../types';
import { formatDateTime, formatLitres } from '../utils/format';

interface EmergencySectionProps {
  requests: EmergencyRequest[];
  districtsList: string[];
  onRefreshRequests: () => Promise<void>;
  onOpenTracking: (requestId: number) => void;
}

type ToolTab = 'mapreduce' | 'hive' | 'storage';

interface SqlSummaryResponse {
  success: boolean;
  engine: string;
  db_path: string;
  total_rows: number;
  status_breakdown: Record<string, number>;
  recent_rows: Array<Record<string, unknown>>;
}

function getLocalDateTimeValue(): string {
  const d = new Date();
  const offsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
}

function normalizeStatusGroup(
  status: EmergencyStatus
): 'Pending' | 'Approved' | 'Completed' | 'Other' {
  if (status === 'Pending' || status === 'Requested') return 'Pending';
  if (status === 'Approved' || status === 'Assigned' || status === 'In Transit') {
    return 'Approved';
  }
  if (status === 'Completed' || status === 'Delivered') return 'Completed';
  return 'Other';
}

const DEFAULT_ROW_LIMIT = 8;

export const EmergencySection: React.FC<EmergencySectionProps> = ({
  requests,
  districtsList,
  onRefreshRequests,
  onOpenTracking,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [form, setForm] = useState({
    district: '',
    area: '',
    emergency_type: 'No Water Supply',
    description: '',
    requester_name: '',
    contact: '',
    required_quantity: '',
    priority: 'High' as 'Low' | 'Medium' | 'High' | 'Critical',
    source_location: '',
    destination_location: '',
    created_at: getLocalDateTimeValue(),
  });
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Analytics & Storage Tabs
  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('mapreduce');
  const [mrJob, setMrJob] = useState<MapReduceJobTrace | null>(null);
  const [mrLoading, setMrLoading] = useState(false);

  const [hivePresets, setHivePresets] = useState<HivePreset[]>([]);
  const [hiveQuery, setHiveQuery] = useState<string>(
    'SELECT id, district, area, emergency_type, priority, status, required_quantity, created_at FROM aqua_emergency_requests ORDER BY id DESC LIMIT 25'
  );
  const [hiveResult, setHiveResult] = useState<HiveQueryResult | null>(null);
  const [hiveLoading, setHiveLoading] = useState(false);

  const [sqlSummary, setSqlSummary] = useState<SqlSummaryResponse | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);

  const counts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let completed = 0;
    for (const r of requests) {
      const grp = normalizeStatusGroup(r.status);
      if (grp === 'Pending') pending++;
      else if (grp === 'Approved') approved++;
      else if (grp === 'Completed') completed++;
    }
    return {
      total: requests.length,
      pending,
      approved,
      completed,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (statusFilter !== 'all') {
        const grp = normalizeStatusGroup(r.status).toLowerCase();
        if (grp !== statusFilter) return false;
      }
      if (!q) return true;
      const hay = `${r.district} ${r.area} ${r.destination_location} ${r.emergency_type || ''} ${r.description || ''} ${r.requester_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [requests, search, statusFilter]);

  const visibleRequests = showAllRows
    ? filteredRequests
    : filteredRequests.slice(0, DEFAULT_ROW_LIMIT);

  const runEmergencyMapReduce = useCallback(async () => {
    setMrLoading(true);
    try {
      const res = await fetch('/api/mapreduce/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobType: 'emergency_area_summary', numReducers: 4 }),
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

  const loadSqlSummary = useCallback(async () => {
    setSqlLoading(true);
    try {
      const res = await fetch('/api/emergency-sql-summary');
      const data = await res.json();
      if (data?.success) {
        setSqlSummary(data);
      }
    } catch {
      // ignore
    } finally {
      setSqlLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeToolTab === 'mapreduce' && !mrJob) {
      runEmergencyMapReduce();
    } else if (activeToolTab === 'hive') {
      if (!hivePresets.length) {
        fetch('/api/hive/presets?table=emergency')
          .then((r) => r.json())
          .then((d) => {
            if (d?.presets) setHivePresets(d.presets);
          })
          .catch(() => {});
      }
      if (!hiveResult) {
        runHiveQuery(hiveQuery);
      }
    } else if (activeToolTab === 'storage' && !sqlSummary) {
      loadSqlSummary();
    }
  }, [
    activeToolTab,
    mrJob,
    hivePresets.length,
    hiveResult,
    hiveQuery,
    sqlSummary,
    runEmergencyMapReduce,
    runHiveQuery,
    loadSqlSummary,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/emergency-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          required_quantity: Number(form.required_quantity),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to submit emergency request');
      }
      setNotice({
        type: 'success',
        text: `Request #${data.request_id} submitted (${form.emergency_type}) and synced to SQL & HDFS.`,
      });
      setForm({
        district: '',
        area: '',
        emergency_type: 'No Water Supply',
        description: '',
        requester_name: '',
        contact: '',
        required_quantity: '',
        priority: 'High',
        source_location: '',
        destination_location: '',
        created_at: getLocalDateTimeValue(),
      });
      setShowForm(false);
      await onRefreshRequests();
      if (activeToolTab === 'mapreduce') runEmergencyMapReduce();
      if (activeToolTab === 'storage') loadSqlSummary();
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Submission error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: number, status: EmergencyStatus) => {
    setUpdatingId(id);
    try {
      const res = await fetch(`/api/emergency-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setNotice({
          type: 'success',
          text: `Request #${id} updated to ${status}.`,
        });
        await onRefreshRequests();
        if (activeToolTab === 'mapreduce') runEmergencyMapReduce();
        if (activeToolTab === 'storage') loadSqlSummary();
      }
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  };

  const hdfsBlocksSummary = useMemo(() => {
    const map = new Map<string, { blockId: string; node: string; count: number }>();
    for (const r of requests) {
      if (!r.block_id) continue;
      const existing = map.get(r.block_id);
      if (existing) {
        existing.count++;
      } else {
        map.set(r.block_id, {
          blockId: r.block_id,
          node: r.hdfs_node || 'node-01',
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [requests]);

  return (
    <div className="space-y-4">
      {/* Header + 4 Icon-Accented KPI Cards */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Emergency Water Requests
          </h1>
          <span className="text-xs text-slate-500">
            {counts.pending} pending · {counts.approved} active
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          {showForm ? 'Close Form' : 'Submit Emergency'}
        </button>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Total Requests</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-slate-900">
              {counts.total}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Pending</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-amber-700">
              {counts.pending}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Approved</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-blue-700">
              {counts.approved}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <ShieldCheck className="h-4 w-4" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Completed</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-emerald-700">
              {counts.completed}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>
      </section>

      {/* Collapsible Submit Form */}
      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            New Emergency Dispatch Request
          </h2>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <select
              required
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">District *</option>
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
              placeholder="Area / Ward *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />

            <input
              required
              value={form.destination_location}
              onChange={(e) =>
                setForm({ ...form, destination_location: e.target.value })
              }
              placeholder="Location landmark *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />

            <select
              required
              value={form.emergency_type}
              onChange={(e) =>
                setForm({ ...form, emergency_type: e.target.value })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="No Water Supply">No Water Supply</option>
              <option value="Severe Water Scarcity">Severe Water Scarcity</option>
              <option value="Contamination / Quality Alert">
                Contamination / Quality Alert
              </option>
              <option value="Pipeline Burst">Pipeline Burst</option>
              <option value="Low Pressure / Scarcity">
                Low Pressure / Scarcity
              </option>
            </select>

            <select
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value as EmergencyRequest['priority'],
                })
              }
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="Low">Priority: Low</option>
              <option value="Medium">Priority: Medium</option>
              <option value="High">Priority: High</option>
              <option value="Critical">Priority: Critical</option>
            </select>

            <input
              required
              type="number"
              min={1}
              step="any"
              value={form.required_quantity}
              onChange={(e) =>
                setForm({ ...form, required_quantity: e.target.value })
              }
              placeholder="Required Litres *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />

            <input
              type="datetime-local"
              value={form.created_at}
              onChange={(e) => setForm({ ...form, created_at: e.target.value })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data text-slate-900 focus:border-blue-500 focus:outline-none"
            />

            <div className="grid grid-cols-2 gap-2">
              <input
                value={form.requester_name}
                onChange={(e) =>
                  setForm({ ...form, requester_name: e.target.value })
                }
                placeholder="Requester"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <input
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                placeholder="+91..."
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <input
                required
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Problem description (e.g. No municipal supply for 48 hours) *"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
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

      {/* 2. Request History Queue */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
          <h2 className="text-sm font-semibold text-slate-900">
            Emergency Request Queue
          </h2>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowAllRows(false);
                }}
                placeholder="Search area, district, issue..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none sm:w-52"
              />
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'pending', label: 'Pending' },
                  { id: 'approved', label: 'Approved' },
                  { id: 'completed', label: 'Completed' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab.id);
                    setShowAllRows(false);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    statusFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">ID · Time</th>
                <th className="py-2 px-2.5 font-medium">Area · Location</th>
                <th className="py-2 px-2.5 font-medium">Emergency</th>
                <th className="py-2 px-2.5 text-right font-medium">Qty</th>
                <th className="py-2 px-2.5 font-medium">Priority</th>
                <th className="py-2 px-2.5 font-medium">Status</th>
                <th className="py-2 pl-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No matching emergency requests found.
                  </td>
                </tr>
              ) : (
                visibleRequests.map((item) => {
                  const statusGroup = normalizeStatusGroup(item.status);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-mono-data font-semibold text-slate-900">
                          #{item.id}
                        </span>
                        <span className="ml-1.5 font-mono-data text-[11px] text-slate-400">
                          {formatDateTime(item.created_at)}
                        </span>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <p className="font-medium text-slate-900 whitespace-nowrap">
                          {item.area}, {item.district}
                        </p>
                        <p className="text-[11px] text-slate-500 max-w-[180px] truncate">
                          {item.destination_location}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5 max-w-[230px]">
                        <p className="font-medium text-slate-900 truncate">
                          {item.emergency_type || 'No Water Supply'}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {item.description || '—'}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-800 whitespace-nowrap">
                        {formatLitres(item.required_quantity)}
                      </td>
                      <td
                        className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${
                          item.priority === 'Critical'
                            ? 'text-red-700'
                            : item.priority === 'High'
                            ? 'text-amber-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {item.priority}
                      </td>
                      <td
                        className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${
                          statusGroup === 'Completed'
                            ? 'text-emerald-700'
                            : statusGroup === 'Approved'
                            ? 'text-blue-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {item.status}
                        {item.tanker_id && (
                          <span className="ml-1.5 font-mono-data text-[11px] font-normal text-slate-400">
                            · {item.tanker_id}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <select
                            aria-label={`Update status for request ${item.id}`}
                            disabled={updatingId === item.id}
                            value={item.status}
                            onChange={(e) =>
                              updateStatus(item.id, e.target.value as EmergencyStatus)
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 focus:border-blue-500 focus:outline-none"
                          >
                            <option value="Pending">Pending</option>
                            <option value="Approved">Approved</option>
                            <option value="In Transit">In Transit</option>
                            <option value="Completed">Completed</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => onOpenTracking(item.id)}
                            className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            Track
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredRequests.length > DEFAULT_ROW_LIMIT && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>
              Showing {visibleRequests.length} of {filteredRequests.length} requests
            </span>
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
            >
              {showAllRows ? 'Show top 8' : `Show all (${filteredRequests.length})`}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAllRows ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        )}
      </section>

      {/* 3. Compact Tabbed Analytics & Storage */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-slate-900">
            Emergency Analytics &amp; Storage
          </h2>

          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'mapreduce', label: 'MapReduce (By Area)', icon: GitBranch },
                { id: 'hive', label: 'Hive Reports', icon: Terminal },
                { id: 'storage', label: 'SQL & HDFS', icon: Database },
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

        {activeToolTab === 'mapreduce' && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
              <span>
                {mrJob ? (
                  <>
                    Job <span className="font-mono-data font-semibold text-slate-900">{mrJob.jobId}</span> ·{' '}
                    {mrJob.recordsScanned} requests · {mrJob.durationMs} ms
                  </>
                ) : (
                  'Analyzing emergency requests by area...'
                )}
              </span>
              <button
                type="button"
                onClick={runEmergencyMapReduce}
                disabled={mrLoading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {mrLoading ? 'Running...' : 'Re-run'}
              </button>
            </div>

            {mrJob && (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Area · District</th>
                      <th className="py-2 px-2.5 text-right font-medium">Total</th>
                      <th className="py-2 px-2.5 text-right font-medium">Pending</th>
                      <th className="py-2 px-2.5 text-right font-medium">Approved</th>
                      <th className="py-2 px-2.5 text-right font-medium">Done</th>
                      <th className="py-2 px-2.5 text-right font-medium">Required</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Top Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mrJob.results.slice(0, 10).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/70">
                        <td className="py-2 pr-3 font-medium text-slate-900 whitespace-nowrap">
                          {String(r.area)}{' '}
                          <span className="font-normal text-slate-400">· {String(r.district)}</span>
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-slate-900">
                          {String(r.request_count)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-amber-700">
                          {String(r.pending_count)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-blue-700">
                          {String(r.approved_count)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-emerald-700">
                          {String(r.completed_count)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-data text-slate-800 whitespace-nowrap">
                          {formatLitres(Number(r.total_required_l))}
                        </td>
                        <td className="py-2 pl-2.5 text-right text-slate-600 whitespace-nowrap">
                          {String(r.top_emergency_type)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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

        {activeToolTab === 'storage' && (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-700">
                  SQLite Table (emergency_requests)
                </h3>
                <button
                  type="button"
                  onClick={loadSqlSummary}
                  disabled={sqlLoading}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  {sqlLoading ? 'Syncing...' : 'Sync SQL'}
                </button>
              </div>
              {sqlSummary ? (
                <div className="space-y-2.5 text-xs">
                  <p className="text-slate-600">
                    {sqlSummary.engine} ·{' '}
                    <span className="font-mono-data font-semibold text-slate-900">
                      {sqlSummary.total_rows}
                    </span>{' '}
                    rows
                  </p>
                  <div className="flex flex-wrap gap-4 border-y border-slate-100 py-2">
                    {Object.entries(sqlSummary.status_breakdown).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-slate-500">{k}: </span>
                        <span className="font-mono-data font-semibold text-slate-900">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Loading SQL table summary...</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                HDFS Emergency Shards
              </h3>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-1.5 pr-3 font-medium">Block ID</th>
                      <th className="py-1.5 px-2.5 font-medium">Node</th>
                      <th className="py-1.5 pl-2.5 text-right font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {hdfsBlocksSummary.map((b) => (
                      <tr key={b.blockId}>
                        <td className="py-1.5 pr-3 font-mono-data text-slate-800">
                          {b.blockId}
                        </td>
                        <td className="py-1.5 px-2.5 font-mono-data text-slate-600">
                          {b.node}
                        </td>
                        <td className="py-1.5 pl-2.5 text-right font-mono-data text-slate-900">
                          {b.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
