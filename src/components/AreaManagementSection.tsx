import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Droplets,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { DistrictCoverage, WaterRecord } from '../types';
import {
  formatLitres,
  formatNumber,
  getWaterStatus,
  statusTextClass,
} from '../utils/format';

interface AreaManagementSectionProps {
  waterRecords: WaterRecord[];
  districts: DistrictCoverage[];
  onRefreshData: () => Promise<void>;
  onDeleteRecord: (id: number) => Promise<void>;
}

const DEFAULT_ROW_LIMIT = 10;

export const AreaManagementSection: React.FC<AreaManagementSectionProps> = ({
  waterRecords,
  districts,
  onRefreshData,
  onDeleteRecord,
}) => {
  const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const areaInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    district: '',
    area: '',
    water_demand: '',
    water_supply: '',
    water_consumed: '',
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (
        areaInputWrapperRef.current &&
        !areaInputWrapperRef.current.contains(e.target as Node)
      ) {
        setAreaDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const districtAreas = useMemo(() => {
    const seen = new Map<string, WaterRecord>();
    for (const row of waterRecords) {
      if (
        selectedDistrict !== 'all' &&
        row.district.toLowerCase() !== selectedDistrict.toLowerCase()
      ) {
        continue;
      }
      const key = `${row.district.toLowerCase()}::${row.area.toLowerCase()}`;
      const existing = seen.get(key);
      if (!existing || row.id > existing.id) {
        seen.set(key, row);
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.area.localeCompare(b.area)
    );
  }, [waterRecords, selectedDistrict]);

  const matchingAreaOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return districtAreas;
    return districtAreas.filter(
      (r) =>
        r.area.toLowerCase().includes(q) ||
        r.district.toLowerCase().includes(q)
    );
  }, [districtAreas, search]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return waterRecords
      .filter((row) => {
        if (
          selectedDistrict !== 'all' &&
          row.district.toLowerCase() !== selectedDistrict.toLowerCase()
        ) {
          return false;
        }
        const matchesQuery =
          !q ||
          row.district.toLowerCase().includes(q) ||
          row.area.toLowerCase().includes(q);
        if (!matchesQuery) return false;
        if (statusFilter === 'all') return true;
        const status = getWaterStatus(row.water_demand, row.water_supply);
        return status.label.toLowerCase() === statusFilter;
      })
      .sort((a, b) => {
        const sA = Math.max((a.water_demand || 0) - (a.water_supply || 0), 0);
        const sB = Math.max((b.water_demand || 0) - (b.water_supply || 0), 0);
        return sB - sA;
      });
  }, [waterRecords, selectedDistrict, search, statusFilter]);

  const totals = useMemo(() => {
    const consumed = filtered.reduce(
      (s, r) => s + (r.water_consumed ?? Math.round((r.water_supply || 0) * 0.92)),
      0
    );
    const shortage = filtered.reduce(
      (s, r) => s + Math.max((r.water_demand || 0) - (r.water_supply || 0), 0),
      0
    );
    return { count: filtered.length, consumed, shortage };
  }, [filtered]);

  const visibleRows = showAllRows ? filtered : filtered.slice(0, DEFAULT_ROW_LIMIT);

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/water-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          district: form.district,
          area: form.area,
          water_demand: Number(form.water_demand || 0),
          water_supply: Number(form.water_supply || 0),
          water_consumed: form.water_consumed
            ? Number(form.water_consumed)
            : null,
          water_level: 65,
          water_quality: 'Good',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to save record');
      }
      setNotice(`Added ${form.area} (${form.district}) to HDFS block ${data.blockId || 'shard'}.`);
      setForm({
        district: '',
        area: '',
        water_demand: '',
        water_supply: '',
        water_consumed: '',
      });
      setShowAddForm(false);
      await onRefreshData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Save error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + 3 Sleek Metric Tiles */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            District &amp; Area Water Coverage
          </h1>
          <span className="text-xs text-slate-500">
            {districts.length} districts · {formatNumber(waterRecords.length)} area records
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          {showAddForm ? 'Close' : 'Add Area'}
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Matching Areas</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-slate-900">
              {formatNumber(totals.count)}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <MapPin className="h-4 w-4" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Water Consumption</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-blue-700">
              {formatLitres(totals.consumed)}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Droplets className="h-4 w-4" />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Total Shortage</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-red-700">
              {formatLitres(totals.shortage)}
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
        </div>
      </section>

      {/* Main Directory Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        {showAddForm && (
          <form
            onSubmit={handleAddRecord}
            className="mb-4 grid grid-cols-1 gap-2.5 border-b border-slate-100 pb-4 sm:grid-cols-2 lg:grid-cols-6"
          >
            <select
              required
              value={form.district}
              onChange={(e) => setForm({ ...form, district: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">District *</option>
              {districts.map((d) => (
                <option key={d.district} value={d.district}>
                  {d.district}
                </option>
              ))}
            </select>
            <input
              required
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="Area name *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            <input
              required
              type="number"
              min={0}
              value={form.water_demand}
              onChange={(e) => setForm({ ...form, water_demand: e.target.value })}
              placeholder="Demand (L) *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data"
            />
            <input
              required
              type="number"
              min={0}
              value={form.water_supply}
              onChange={(e) => setForm({ ...form, water_supply: e.target.value })}
              placeholder="Supply (L) *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data"
            />
            <input
              type="number"
              min={0}
              value={form.water_consumed}
              onChange={(e) =>
                setForm({ ...form, water_consumed: e.target.value })
              }
              placeholder="Consumption (L)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono-data"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Area'}
            </button>
          </form>
        )}

        {notice && (
          <p className="mb-4 rounded-lg bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800">
            {notice}
          </p>
        )}

        {/* Filter Bar */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center flex-1">
            <select
              value={selectedDistrict}
              onChange={(e) => {
                setSelectedDistrict(e.target.value);
                setSearch('');
                setShowAllRows(false);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 sm:w-52"
            >
              <option value="all">All Districts ({districts.length})</option>
              {districts.map((d) => (
                <option key={d.district} value={d.district}>
                  {d.district} ({d.record_count ?? 0})
                </option>
              ))}
            </select>

            <div
              ref={areaInputWrapperRef}
              className="relative flex-1 max-w-sm"
            >
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onFocus={() => setAreaDropdownOpen(true)}
                onClick={() => setAreaDropdownOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setAreaDropdownOpen(true);
                  setShowAllRows(false);
                }}
                placeholder={
                  selectedDistrict === 'all'
                    ? `Search area (${districtAreas.length})...`
                    : `Select area in ${selectedDistrict} (${districtAreas.length})...`
                }
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear area filter"
                  onClick={() => {
                    setSearch('');
                    setAreaDropdownOpen(true);
                  }}
                  className="absolute right-2.5 top-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}

              {areaDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setAreaDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-50 ${
                      !search ? 'bg-blue-50/60 font-semibold text-blue-700' : 'text-slate-700'
                    }`}
                  >
                    <span>
                      {selectedDistrict === 'all'
                        ? 'All Areas'
                        : `All Areas in ${selectedDistrict}`}
                    </span>
                    <span className="font-mono-data text-[11px] text-slate-400">
                      {districtAreas.length}
                    </span>
                  </button>

                  {matchingAreaOptions.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">No matching areas</p>
                  ) : (
                    matchingAreaOptions.map((item) => {
                      const active =
                        search.trim().toLowerCase() === item.area.toLowerCase();
                      const shortage = Math.max(
                        (item.water_demand || 0) - (item.water_supply || 0),
                        0
                      );
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSearch(item.area);
                            setAreaDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 ${
                            active
                              ? 'bg-blue-50 font-semibold text-blue-700'
                              : 'text-slate-800'
                          }`}
                        >
                          <span className="truncate">
                            {item.area}
                            {selectedDistrict === 'all' && (
                              <span className="ml-1.5 text-[11px] text-slate-400">
                                · {item.district}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono-data text-[11px] text-slate-500">
                            {shortage > 0
                              ? `-${formatLitres(shortage)}`
                              : 'Sufficient'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {[
              { id: 'all', label: 'All' },
              { id: 'shortage', label: 'Shortage' },
              { id: 'moderate', label: 'Moderate' },
              { id: 'sufficient', label: 'Sufficient' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setShowAllRows(false);
                }}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
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

        {/* Single-row scrollable quick-pick strip when a district is selected */}
        {selectedDistrict !== 'all' && districtAreas.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setSearch('')}
              className={`rounded-md border px-2.5 py-1 font-medium whitespace-nowrap shrink-0 transition-colors ${
                !search
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              All ({districtAreas.length})
            </button>
            {districtAreas.map((item) => {
              const active =
                search.trim().toLowerCase() === item.area.toLowerCase();
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSearch(active ? '' : item.area)}
                  className={`rounded-md border px-2.5 py-1 font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {item.area}
                </button>
              );
            })}
          </div>
        )}

        {/* Concise Area Table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Area · District</th>
                <th className="py-2 px-2.5 text-right font-medium">Demand</th>
                <th className="py-2 px-2.5 text-right font-medium">Supply</th>
                <th className="py-2 px-2.5 text-right font-medium">Consumed</th>
                <th className="py-2 px-2.5 text-right font-medium">Shortage</th>
                <th className="py-2 px-2.5 font-medium">Coverage</th>
                <th className="py-2 px-2.5 font-medium">Status</th>
                <th className="py-2 pl-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No matching areas found.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const shortage = Math.max(
                    (row.water_demand || 0) - (row.water_supply || 0),
                    0
                  );
                  const consumed =
                    row.water_consumed ??
                    Math.round((row.water_supply || 0) * 0.92);
                  const coverage =
                    row.water_demand > 0
                      ? Math.min(100, Math.round((row.water_supply / row.water_demand) * 100))
                      : 100;
                  const status = getWaterStatus(
                    row.water_demand,
                    row.water_supply
                  );
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-medium text-slate-900">{row.area}</span>
                        <span className="text-slate-400"> · {row.district}</span>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-600 whitespace-nowrap">
                        {formatLitres(row.water_demand)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-900 whitespace-nowrap">
                        {formatLitres(row.water_supply)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data font-medium text-blue-700 whitespace-nowrap">
                        {formatLitres(consumed)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data font-semibold text-red-700 whitespace-nowrap">
                        {shortage > 0 ? formatLitres(shortage) : '0 L'}
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                coverage < 60
                                  ? 'bg-red-500'
                                  : coverage < 90
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{ width: `${coverage}%` }}
                            />
                          </div>
                          <span className="font-mono-data text-[11px] text-slate-600">
                            {coverage}%
                          </span>
                        </div>
                      </td>
                      <td
                        className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${statusTextClass(
                          status.tone
                        )}`}
                      >
                        {status.label}
                      </td>
                      <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                        {confirmDeleteId === row.id ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await onDeleteRecord(row.id);
                                setConfirmDeleteId(null);
                              }}
                              className="text-xs font-semibold text-red-700 hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs text-slate-500 hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete ${row.area}`}
                            onClick={() => setConfirmDeleteId(row.id)}
                            className="inline-flex items-center text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > DEFAULT_ROW_LIMIT && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>
              Showing {visibleRows.length} of {filtered.length} areas
            </span>
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
            >
              {showAllRows ? 'Show top 10' : `Show all (${filtered.length})`}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAllRows ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
