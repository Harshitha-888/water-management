import React, { useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CloudRain,
  Database,
  Droplets,
  Gauge,
  Thermometer,
  Wrench,
} from 'lucide-react';
import type {
  LiveMaintenanceFeedsResponse,
  LiveWeatherResponse,
  MaintenanceTask,
  PublicWaterResponse,
  ReservoirRecord,
  WaterRecord,
  WaterSummary,
} from '../types';
import {
  formatDate,
  formatLitres,
  formatNumber,
  getWaterStatus,
  statusTextClass,
} from '../utils/format';

interface OverviewSectionProps {
  summary: WaterSummary | null;
  waterRecords: WaterRecord[];
  reservoirs: ReservoirRecord[];
  maintenanceTasks: MaintenanceTask[];
  liveWeather: LiveWeatherResponse | null;
  publicWater: PublicWaterResponse | null;
  liveMaintenanceFeeds: LiveMaintenanceFeedsResponse | null;
  avgRainfallMm: number | null;
  loading: boolean;
  onNavigate: (tab: string) => void;
}

type ZoneView = 'availability' | 'alerts';

export const OverviewSection: React.FC<OverviewSectionProps> = ({
  summary,
  waterRecords,
  reservoirs,
  maintenanceTasks,
  liveWeather,
  publicWater,
  liveMaintenanceFeeds,
  avgRainfallMm,
  loading,
  onNavigate,
}) => {
  const [zoneView, setZoneView] = useState<ZoneView>('availability');
  const areaChartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const areaChartInstanceRef = useRef<Chart | null>(null);

  const reservoirChartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reservoirChartInstanceRef = useRef<Chart | null>(null);

  const latestAreaRecords = useMemo(() => {
    const map = new Map<string, WaterRecord>();
    for (const rec of waterRecords) {
      const key = `${rec.district.toLowerCase()}::${rec.area.toLowerCase()}`;
      const existing = map.get(key);
      if (!existing || rec.id > existing.id) {
        map.set(key, rec);
      }
    }
    return Array.from(map.values());
  }, [waterRecords]);

  const shortageAlerts = useMemo(() => {
    return latestAreaRecords
      .map((rec) => {
        const demand = rec.water_demand || 0;
        const supply = rec.water_supply || 0;
        const deficit = Math.max(demand - supply, 0);
        const coverage = demand > 0 ? (supply / demand) * 100 : 100;
        return {
          ...rec,
          deficit,
          coverage,
          severity:
            coverage < 60 ? 'Critical' : coverage < 90 ? 'Warning' : 'Nominal',
        };
      })
      .filter((item) => item.deficit > 0)
      .sort((a, b) => a.coverage - b.coverage);
  }, [latestAreaRecords]);

  const reservoirStats = useMemo(() => {
    if (!reservoirs.length) {
      return { count: 0, avgFillPct: 0, totalLiveCapacity: 0, list: [] as ReservoirRecord[] };
    }
    const latestMap = new Map<string, ReservoirRecord>();
    for (const r of reservoirs) {
      if (!latestMap.has(r.reservoir_name)) {
        latestMap.set(r.reservoir_name, r);
      }
    }
    const unique = Array.from(latestMap.values());
    const avgFillPct =
      Math.round(
        (unique.reduce((s, r) => s + (r.percentage_full || 0), 0) / unique.length) *
          10
      ) / 10;
    const totalLiveCapacity =
      Math.round(unique.reduce((s, r) => s + (r.live_capacity || 0), 0) * 100) /
      100;
    return { count: unique.length, avgFillPct, totalLiveCapacity, list: unique };
  }, [reservoirs]);

  // Chart.js: Water Availability vs Consumption by Area
  useEffect(() => {
    const canvas = areaChartCanvasRef.current;
    if (!canvas) return;
    if (areaChartInstanceRef.current) areaChartInstanceRef.current.destroy();

    const topAreas = latestAreaRecords.slice(0, 8);
    areaChartInstanceRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: topAreas.map((r) => `${r.district.split(' ')[0]} · ${r.area.split(' ')[0]}`),
        datasets: [
          {
            label: 'Available (L)',
            data: topAreas.map((r) => r.water_supply || 0),
            backgroundColor: '#1677df',
            borderRadius: 4,
          },
          {
            label: 'Consumed (L)',
            data: topAreas.map(
              (r) => r.water_consumed ?? Math.round((r.water_supply || 0) * 0.92)
            ),
            backgroundColor: '#18a878',
            borderRadius: 4,
          },
          {
            label: 'Demand (L)',
            data: topAreas.map((r) => r.water_demand || 0),
            backgroundColor: '#cbd5e1',
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
              label: (ctx) =>
                `${ctx.dataset.label}: ${Number(ctx.raw || 0).toLocaleString('en-IN')} L`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 10 },
              callback: (val) => `${Math.round(Number(val) / 100000) / 10}M`,
            },
          },
        },
      },
    });

    return () => {
      if (areaChartInstanceRef.current) {
        areaChartInstanceRef.current.destroy();
        areaChartInstanceRef.current = null;
      }
    };
  }, [latestAreaRecords]);

  // Chart.js: Current Reservoir Storage Levels (%)
  useEffect(() => {
    const canvas = reservoirChartCanvasRef.current;
    if (!canvas) return;
    if (reservoirChartInstanceRef.current) reservoirChartInstanceRef.current.destroy();

    const list = reservoirStats.list.slice(0, 8);
    reservoirChartInstanceRef.current = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: list.map((r) => r.reservoir_name.split('(')[0].trim()),
        datasets: [
          {
            label: 'Storage (%)',
            data: list.map((r) => r.percentage_full || 0),
            backgroundColor: list.map((r) =>
              (r.percentage_full || 0) >= 75
                ? '#16a34a'
                : (r.percentage_full || 0) >= 50
                ? '#1677df'
                : '#d97706'
            ),
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => `Storage: ${ctx.raw}% full` },
          },
        },
        scales: {
          x: { min: 0, max: 100, ticks: { font: { size: 10 }, callback: (v) => `${v}%` } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });

    return () => {
      if (reservoirChartInstanceRef.current) {
        reservoirChartInstanceRef.current.destroy();
        reservoirChartInstanceRef.current = null;
      }
    };
  }, [reservoirStats]);

  const totalAvailable = summary?.total_supply ?? 0;
  const totalConsumed = summary?.total_consumed ?? 0;
  const supplyPct = summary?.supply_percentage ?? 0;
  const openMaintenance = maintenanceTasks.filter((t) => t.status !== 'Completed').length;
  const waterSavedLpd = maintenanceTasks.reduce((s, t) => s + (t.water_saved_lpd || 0), 0);

  return (
    <div className="space-y-4">
      {/* 1. Compact Header + 5 Icon-Accented KPI Cards */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Water Resource Overview
          </h1>
          <span className="text-xs text-slate-500">
            {formatNumber(summary?.total_areas ?? 0)} areas · {reservoirStats.count} reservoirs
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('mapreduce')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          Run MapReduce Query
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Available Water</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Droplets className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-slate-900">
            {loading ? '—' : formatLitres(totalAvailable)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${Math.min(100, supplyPct)}%` }}
              />
            </div>
            <span className="font-mono-data text-[11px] font-semibold text-blue-700">
              {supplyPct}%
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Consumption</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Activity className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-slate-900">
            {loading
              ? '—'
              : summary?.consumption_data_available
              ? formatLitres(totalConsumed)
              : '—'}
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            Across {formatNumber(summary?.total_areas ?? 0)} monitored areas
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Reservoirs</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Database className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-slate-900">
            {loading ? '—' : formatNumber(reservoirStats.count)}
          </p>
          <p className="mt-2 font-mono-data text-[11px] text-slate-500">
            {formatNumber(reservoirStats.totalLiveCapacity)} TMC live storage
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Mean Storage</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Gauge className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-emerald-700">
            {loading ? '—' : `${reservoirStats.avgFillPct}%`}
          </p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${Math.min(100, reservoirStats.avgFillPct)}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Avg Rainfall</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
              <CloudRain className="h-3.5 w-3.5" />
            </div>
          </div>
          <p className="mt-2 font-mono-data text-xl font-bold text-slate-900">
            {avgRainfallMm !== null ? `${avgRainfallMm} mm` : '—'}
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            {liveWeather?.data?.length ?? 6} live Karnataka stations
          </p>
        </div>
      </section>

      {/* 2. Dual Chart.js Visuals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Supply vs. Consumption by Area
            </h2>
            <span className="text-[11px] text-slate-400">Top 8 zones (L)</span>
          </div>
          <div className="relative h-56 w-full">
            <canvas ref={areaChartCanvasRef} />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Reservoir Storage Levels (%)
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('reservoirs')}
              className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
            >
              Details →
            </button>
          </div>
          <div className="relative h-56 w-full">
            <canvas ref={reservoirChartCanvasRef} />
          </div>
        </section>
      </div>

      {/* 3. Unified Zone Table/Alerts + Compact Live Weather & Maintenance Card */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setZoneView('availability')}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    zoneView === 'availability'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Area Status
                </button>
                <button
                  type="button"
                  onClick={() => setZoneView('alerts')}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                    zoneView === 'alerts'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <AlertTriangle className="h-3 w-3 text-amber-600" />
                  Shortage Alerts ({shortageAlerts.length})
                </button>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(zoneView === 'alerts' ? 'emergency' : 'areas')}
                className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
              >
                {zoneView === 'alerts' ? 'Dispatch supply →' : 'All areas →'}
              </button>
            </div>

            {zoneView === 'availability' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Area · District</th>
                      <th className="py-2 px-2.5 text-right font-medium">Available</th>
                      <th className="py-2 px-2.5 text-right font-medium">Consumed</th>
                      <th className="py-2 px-2.5 text-right font-medium">Coverage</th>
                      <th className="py-2 pl-2.5 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {latestAreaRecords.slice(0, 6).map((row) => {
                      const pct =
                        row.water_demand > 0
                          ? Math.round((row.water_supply / row.water_demand) * 100)
                          : 0;
                      const status = getWaterStatus(row.water_demand, row.water_supply);
                      return (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="font-medium text-slate-900">{row.area}</span>
                            <span className="text-slate-400"> · {row.district}</span>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-slate-900 whitespace-nowrap">
                            {formatLitres(row.water_supply)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-slate-600 whitespace-nowrap">
                            {row.water_consumed !== null
                              ? formatLitres(row.water_consumed)
                              : '—'}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-slate-700">
                            {pct}%
                          </td>
                          <td
                            className={`py-2 pl-2.5 text-right font-semibold whitespace-nowrap ${statusTextClass(
                              status.tone
                            )}`}
                          >
                            {status.label}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {shortageAlerts.length === 0 ? (
                  <p className="py-6 text-center text-slate-500">
                    No active water shortage alerts.
                  </p>
                ) : (
                  shortageAlerts.slice(0, 6).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">
                          {alert.area}{' '}
                          <span className="font-normal text-slate-500">
                            · {alert.district}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 font-mono-data">
                        <span className="text-slate-600">{alert.coverage.toFixed(0)}%</span>
                        <span className="font-semibold text-red-700">
                          -{formatLitres(alert.deficit)}
                        </span>
                        <span
                          className={`font-sans font-semibold ${
                            alert.severity === 'Critical'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </section>

        {/* Compact Live Weather Grid + Maintenance Telemetry Summary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Thermometer className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Live Weather &amp; Maintenance
                </h2>
              </div>
              {liveWeather?.fetched_at && (
                <span className="font-mono-data text-[11px] text-slate-400">
                  {formatDate(liveWeather.fetched_at)}
                </span>
              )}
            </div>

            {!liveWeather?.data?.length ? (
              <p className="py-4 text-xs text-slate-500">
                Loading Open-Meteo station telemetry...
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {liveWeather.data.slice(0, 6).map((st) => (
                  <div
                    key={st.city}
                    className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-900 truncate">
                        {st.city}
                      </span>
                      <span className="font-mono-data font-bold text-slate-800">
                        {st.weather?.temperature_2m !== undefined
                          ? `${Math.round(st.weather.temperature_2m)}°C`
                          : '—'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-mono-data text-blue-700">
                        {st.weather?.daily_avg_rainfall_mm ?? 0} mm
                      </span>
                      <span
                        className={
                          st.advisory_severity === 'High' ||
                          st.advisory_severity === 'Critical'
                            ? 'font-semibold text-amber-700'
                            : 'text-slate-500'
                        }
                      >
                        {st.advisory_severity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
              <div>
                <span className="text-[11px] text-slate-500">Open Repairs</span>
                <p className="font-mono-data font-bold text-slate-900">
                  {openMaintenance} / {maintenanceTasks.length}
                </p>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Water Saved</span>
                <p className="font-mono-data font-bold text-blue-700">
                  {formatLitres(waterSavedLpd)}/d
                </p>
              </div>
              <div>
                <span className="text-[11px] text-slate-500">Live Feeds</span>
                <p className="font-mono-data font-bold text-emerald-700">
                  {publicWater
                    ? `${publicWater.available_count}/${publicWater.dataset_count} NWDP`
                    : `${liveMaintenanceFeeds?.detected_alerts?.length ?? 0} alerts`}
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('maintenance')}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50/60"
          >
            <Wrench className="h-3.5 w-3.5" />
            Open Water Maintenance →
          </button>
        </section>
      </div>
    </div>
  );
};
