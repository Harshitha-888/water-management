import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Droplets,
  Plus,
  Wrench,
  X,
} from 'lucide-react';
import type {
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTask,
  ReservoirRecord,
} from '../types';
import { formatDate, formatLitres, formatNumber } from '../utils/format';

interface CriticalNotificationsSidebarProps {
  reservoirs: ReservoirRecord[];
  maintenanceTasks: MaintenanceTask[];
  onNavigate: (tab: string) => void;
  onRefreshData: () => Promise<void>;
}

type SidebarView = 'reservoirs' | 'maintenance';

const THRESHOLD_OPTIONS = [30, 40, 50] as const;

function priorityOrder(p: MaintenancePriority): number {
  if (p === 'Critical') return 0;
  if (p === 'High') return 1;
  if (p === 'Medium') return 2;
  return 3;
}

function priorityColorClass(p: MaintenancePriority): string {
  if (p === 'Critical') return 'text-red-700';
  if (p === 'High') return 'text-amber-700';
  if (p === 'Medium') return 'text-blue-700';
  return 'text-slate-600';
}

function statusColorClass(s: MaintenanceStatus): string {
  if (s === 'Completed') return 'text-emerald-700';
  if (s === 'In Progress') return 'text-blue-700';
  if (s === 'Scheduled') return 'text-amber-700';
  return 'text-slate-500';
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(dam|reservoir|barrage|lift|sagar|stage)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function taskMatchesReservoir(task: MaintenanceTask, reservoir: ReservoirRecord): boolean {
  const resToken = normalizeToken(reservoir.reservoir_name);
  const resDistrict = reservoir.district.trim().toLowerCase();
  const taskDistrict = task.district.trim().toLowerCase();
  const taskHay = `${task.area} ${task.asset_name} ${task.notes}`.toLowerCase();

  if (resToken.length >= 4 && taskHay.includes(resToken)) {
    return true;
  }
  if (resDistrict && resDistrict !== 'karnataka' && taskDistrict === resDistrict) {
    return true;
  }
  return false;
}

export const CriticalNotificationsSidebar: React.FC<CriticalNotificationsSidebarProps> = ({
  reservoirs,
  maintenanceTasks,
  onNavigate,
  onRefreshData,
}) => {
  const [criticalThreshold, setCriticalThreshold] = useState<number>(40);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<SidebarView>('reservoirs');
  const [dispatchingDam, setDispatchingDam] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Deduplicate latest record per reservoir (reservoirs arrive sorted newest-first)
  const latestReservoirs = useMemo(() => {
    const map = new Map<string, ReservoirRecord>();
    for (const r of reservoirs) {
      if (!map.has(r.reservoir_name)) {
        map.set(r.reservoir_name, r);
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => (a.percentage_full ?? 0) - (b.percentage_full ?? 0)
    );
  }, [reservoirs]);

  // Reservoirs strictly below the active critical threshold
  const criticalReservoirs = useMemo(
    () => latestReservoirs.filter((r) => (r.percentage_full ?? 0) < criticalThreshold),
    [latestReservoirs, criticalThreshold]
  );

  // Open maintenance tasks from live MaintenanceTask state
  const openMaintenanceTasks = useMemo(
    () =>
      maintenanceTasks
        .filter((t) => t.status !== 'Completed')
        .sort((a, b) => {
          const aIsGate = a.asset_type === 'Reservoir Gate' ? 0 : 1;
          const bIsGate = b.asset_type === 'Reservoir Gate' ? 0 : 1;
          if (aIsGate !== bIsGate) return aIsGate - bIsGate;
          return priorityOrder(a.priority) - priorityOrder(b.priority);
        }),
    [maintenanceTasks]
  );

  // Map each critical reservoir to matching live MaintenanceTask items
  const matchedTasksByReservoir = useMemo(() => {
    const map = new Map<string, MaintenanceTask[]>();
    for (const r of criticalReservoirs) {
      const matched = openMaintenanceTasks.filter((t) => taskMatchesReservoir(t, r));
      map.set(r.reservoir_name, matched);
    }
    return map;
  }, [criticalReservoirs, openMaintenanceTasks]);

  const correlatedMaintenanceTasks = useMemo(() => {
    const matchedIds = new Set<number>();
    for (const list of matchedTasksByReservoir.values()) {
      for (const t of list) matchedIds.add(t.id);
    }
    // Include matched reservoir tasks first, then urgent Critical/High or Reservoir Gate tasks
    return [...openMaintenanceTasks].sort((a, b) => {
      const aMatched = matchedIds.has(a.id) ? 0 : 1;
      const bMatched = matchedIds.has(b.id) ? 0 : 1;
      if (aMatched !== bMatched) return aMatched - bMatched;
      const aRes = a.asset_type === 'Reservoir Gate' ? 0 : 1;
      const bRes = b.asset_type === 'Reservoir Gate' ? 0 : 1;
      if (aRes !== bRes) return aRes - bRes;
      return priorityOrder(a.priority) - priorityOrder(b.priority);
    });
  }, [openMaintenanceTasks, matchedTasksByReservoir]);

  const urgentOpenCount = useMemo(
    () =>
      openMaintenanceTasks.filter(
        (t) => t.priority === 'Critical' || t.priority === 'High'
      ).length,
    [openMaintenanceTasks]
  );

  const totalOpenWaterSavedLpd = useMemo(
    () => openMaintenanceTasks.reduce((sum, t) => sum + (t.water_saved_lpd || 0), 0),
    [openMaintenanceTasks]
  );

  // Signature identifies the current set of critical breaches so a new breach triggers automatically
  const breachSignature = useMemo(() => {
    if (criticalReservoirs.length === 0) return '';
    return criticalReservoirs
      .map((r) => `${r.reservoir_name}:${r.percentage_full}`)
      .join('|');
  }, [criticalReservoirs]);

  // Trigger automatically ONLY when reservoir levels drop below the critical threshold
  useEffect(() => {
    if (criticalReservoirs.length === 0) {
      setIsOpen(false);
      setDismissedSignature(null);
      return;
    }
    if (breachSignature && breachSignature !== dismissedSignature) {
      setIsOpen(true);
    }
  }, [criticalReservoirs.length, breachSignature, dismissedSignature]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setDismissedSignature(breachSignature);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, breachSignature]);

  const handleClose = () => {
    setIsOpen(false);
    setDismissedSignature(breachSignature);
  };

  const handleQuickDispatchTask = async (reservoir: ReservoirRecord) => {
    setDispatchingDam(reservoir.reservoir_name);
    setFeedback(null);
    const targetDistrict =
      reservoir.district && reservoir.district !== 'Karnataka'
        ? reservoir.district
        : 'Vijayanagara';
    const isZeroPct = (reservoir.percentage_full ?? 0) <= 15;
    try {
      const res = await fetch('/api/maintenance/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: targetDistrict,
          area: reservoir.reservoir_name,
          asset_name: `${reservoir.reservoir_name} Intake & Sluice Gate`,
          asset_type: 'Reservoir Gate',
          maintenance_type: 'Reservoir Desilting',
          priority: isZeroPct ? 'Critical' : 'High',
          assigned_crew: `${targetDistrict} Dam Hydro Unit`,
          scheduled_date: new Date().toISOString().slice(0, 10),
          estimated_cost_inr: 125000,
          water_saved_lpd: 240000,
          telemetry_source: 'Reservoir Critical Threshold Alert',
          notes: `Triggered at ${reservoir.percentage_full}% fill (threshold < ${criticalThreshold}%). Live storage ${formatNumber(reservoir.live_capacity)} / ${formatNumber(reservoir.gross_capacity || reservoir.design_capacity)} TMC.`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Unable to dispatch maintenance task');
      }
      setFeedback({
        type: 'success',
        text: `Dispatched ${data.record?.task_code || 'task'} for ${reservoir.reservoir_name}.`,
      });
      await onRefreshData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Dispatch error',
      });
    } finally {
      setDispatchingDam(null);
    }
  };

  const handleAdvanceTaskStatus = async (task: MaintenanceTask, nextStatus: MaintenanceStatus) => {
    setUpdatingTaskId(task.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/maintenance/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        throw new Error('Failed to update task status');
      }
      setFeedback({
        type: 'success',
        text: `${task.task_code} marked ${nextStatus}.`,
      });
      await onRefreshData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Update error',
      });
    } finally {
      setUpdatingTaskId(null);
    }
  };

  // Do not render floating notifications when no reservoir breaches the critical threshold
  if (criticalReservoirs.length === 0) {
    return null;
  }

  // Minimized floating trigger when user collapses the critical sidebar
  if (!isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={`Open critical reservoir notifications (${criticalReservoirs.length} reservoirs below ${criticalThreshold}%)`}
          className="inline-flex items-center gap-2.5 rounded-xl border border-red-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-900 shadow-lg transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 whitespace-nowrap shrink-0"
        >
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <span className="font-mono-data text-red-700">{criticalReservoirs.length}</span>
          <span>Critical Reservoirs</span>
          <span className="text-slate-300">·</span>
          <span className="font-mono-data text-slate-600">
            {openMaintenanceTasks.length} Open Tasks
          </span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Critical Reservoir & Maintenance Notifications"
      className="fixed top-20 right-4 z-40 flex w-[calc(100vw-2rem)] max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:w-[396px]"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-red-50/60 px-4 py-3.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
            <Bell className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="font-display text-sm font-bold text-slate-900 truncate">
                Critical Level Alerts
              </h2>
              <span className="font-mono-data text-xs font-semibold text-red-700">
                &lt;{criticalThreshold}%
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-600">
              <span className="font-mono-data font-semibold text-red-700">
                {criticalReservoirs.length}
              </span>{' '}
              of {latestReservoirs.length} reservoirs critical ·{' '}
              <span className="font-mono-data font-semibold text-slate-900">
                {openMaintenanceTasks.length}
              </span>{' '}
              open maintenance
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          aria-label="Minimize critical notifications sidebar"
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Live Threshold & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          <button
            type="button"
            onClick={() => setActiveView('reservoirs')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'reservoirs'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Droplets className="h-3 w-3 text-red-600" />
            Reservoirs ({criticalReservoirs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('maintenance')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'maintenance'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Wrench className="h-3 w-3 text-amber-600" />
            Tasks ({openMaintenanceTasks.length})
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span>Trigger</span>
          <select
            aria-label="Critical reservoir fill threshold"
            value={criticalThreshold}
            onChange={(e) => {
              setCriticalThreshold(Number(e.target.value));
              setDismissedSignature(null);
            }}
            className="rounded-md border border-slate-200 bg-white px-1.5 py-1 font-mono-data text-[11px] font-semibold text-slate-800 focus:border-blue-500 focus:outline-none"
          >
            {THRESHOLD_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                &lt; {opt}%
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Live Maintenance Summary Strip */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-[11px]">
        <div className="pr-2">
          <div className="text-slate-500">Critical Dams</div>
          <div className="font-mono-data font-bold text-red-700">
            {criticalReservoirs.length}
          </div>
        </div>
        <div className="px-2">
          <div className="text-slate-500">Urgent Tasks</div>
          <div className="font-mono-data font-bold text-amber-700">
            {urgentOpenCount}
          </div>
        </div>
        <div className="pl-2">
          <div className="text-slate-500">Recovery Est.</div>
          <div className="font-mono-data font-bold text-slate-900 truncate">
            {formatLitres(totalOpenWaterSavedLpd)}/d
          </div>
        </div>
      </div>

      {/* Inline Action Feedback */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-2 border-b px-4 py-2 text-[11px] font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <span className="truncate">{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification feedback"
            className="shrink-0 text-current opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Scrollable Live Feed */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {activeView === 'reservoirs' ? (
          criticalReservoirs.map((r) => {
            const pct = Math.max(0, Math.min(100, r.percentage_full ?? 0));
            const capacityTmc = r.gross_capacity || r.design_capacity || 0;
            const netFlow = Math.round((r.inflow || 0) - (r.outflow || 0));
            const linkedTasks = matchedTasksByReservoir.get(r.reservoir_name) || [];
            const isDispatching = dispatchingDam === r.reservoir_name;

            return (
              <div key={r.reservoir_name} className="px-4 py-3 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <span className="text-xs font-semibold text-slate-900 truncate">
                        {r.reservoir_name}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                      {r.district}
                      {r.river ? ` · ${r.river}` : ''} · {formatDate(r.monitoring_date)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono-data text-xs font-bold text-red-700">
                      {formatNumber(pct)}%
                    </div>
                    <div className="font-mono-data text-[10px] text-slate-500">
                      {formatNumber(r.live_capacity)} / {formatNumber(capacityTmc)} TMC
                    </div>
                  </div>
                </div>

                {/* Fill Level Bar */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-red-600 transition-all"
                    style={{ width: `${Math.max(pct, 3)}%` }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span className="font-mono-data">
                    In {formatNumber(r.inflow)} · Out {formatNumber(r.outflow)} cusecs
                  </span>
                  <span
                    className={`font-mono-data font-medium ${
                      netFlow < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    Net {netFlow >= 0 ? `+${formatNumber(netFlow)}` : formatNumber(netFlow)}
                  </span>
                </div>

                {/* Correlated MaintenanceTask Link or Dispatch Action */}
                <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                  {linkedTasks.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveView('maintenance')}
                      className="flex min-w-0 items-center gap-1.5 text-left text-[11px] text-slate-700 hover:text-blue-700"
                    >
                      <Wrench className="h-3 w-3 text-blue-600 shrink-0" />
                      <span className="font-mono-data font-semibold shrink-0">
                        {linkedTasks[0].task_code}
                      </span>
                      <span className="truncate">{linkedTasks[0].asset_name}</span>
                      <span className={`font-semibold shrink-0 ${statusColorClass(linkedTasks[0].status)}`}>
                        · {linkedTasks[0].status}
                      </span>
                    </button>
                  ) : (
                    <>
                      <span className="text-[11px] text-slate-500">
                        No open maintenance order
                      </span>
                      <button
                        type="button"
                        disabled={isDispatching}
                        onClick={() => handleQuickDispatchTask(r)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3 w-3 text-blue-600" />
                        {isDispatching ? 'Dispatching...' : 'Dispatch Order'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        ) : correlatedMaintenanceTasks.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
            <p className="mt-2 text-xs font-semibold text-slate-800">
              All maintenance work orders completed
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Dispatch an order from a critical reservoir or open Water Maintenance.
            </p>
          </div>
        ) : (
          correlatedMaintenanceTasks.map((task) => {
            const matchedDam = criticalReservoirs.find((r) =>
              taskMatchesReservoir(task, r)
            );
            const isUpdating = updatingTaskId === task.id;
            const nextStatus: MaintenanceStatus =
              task.status === 'Scheduled' ? 'In Progress' : 'Completed';

            return (
              <div key={task.id} className="px-4 py-3 hover:bg-slate-50/70 transition-colors">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-mono-data font-bold text-slate-900">
                        {task.task_code}
                      </span>
                      <span className={`font-semibold ${priorityColorClass(task.priority)}`}>
                        {task.priority}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className={`font-semibold ${statusColorClass(task.status)}`}>
                        {task.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs font-semibold text-slate-900 truncate">
                      {task.asset_name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                      {task.district} · {task.area}
                    </p>
                  </div>
                  <span className="font-mono-data text-[11px] font-semibold text-emerald-700 shrink-0">
                    +{formatLitres(task.water_saved_lpd)}/d
                  </span>
                </div>

                {matchedDam && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-700">
                    <Droplets className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      Linked to {matchedDam.reservoir_name} ({formatNumber(matchedDam.percentage_full)}%)
                    </span>
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500 truncate">
                    {task.assigned_crew}
                  </span>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => handleAdvanceTaskStatus(task, nextStatus)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 whitespace-nowrap shrink-0"
                  >
                    {isUpdating
                      ? 'Saving...'
                      : nextStatus === 'In Progress'
                      ? 'Start Work'
                      : 'Mark Done'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <button
          type="button"
          onClick={() => onNavigate('reservoirs')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
        >
          Reservoirs
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onNavigate('maintenance')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0"
        >
          Water Maintenance
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
};
