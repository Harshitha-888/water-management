import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  Database,
  Play,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  DistrictShortageForecast,
  ShortageForecastResponse,
  ShortageRiskLevel,
} from '../types';
import { formatBytes, formatLitres, formatNumber } from '../utils/format';

interface ShortageForecastSectionProps {
  districtsList: string[];
  onNavigate: (tab: string) => void;
}

type RiskFilter = 'all' | 'at_risk' | 'Critical Shortage' | 'Moderate Deficit' | 'Surplus / Safe';

const DEFAULT_ROW_LIMIT = 10;

function riskColorClass(risk: ShortageRiskLevel): string {
  if (risk === 'Critical Shortage') return 'text-red-700';
  if (risk === 'Moderate Deficit') return 'text-amber-700';
  if (risk === 'Watch') return 'text-blue-700';
  return 'text-emerald-700';
}

function formatSlope(slope: number): string {
  const rounded = Math.round(slope);
  const sign = rounded >= 0 ? '+' : '-';
  return `${sign}${formatLitres(Math.abs(rounded))}/mo`;
}

export const ShortageForecastSection: React.FC<ShortageForecastSectionProps> = ({
  districtsList,
  onNavigate,
}) => {
  const [selectedDistrict, setSelectedDistrict] = useState<string>('all');
  const [forecast, setForecast] = useState<ShortageForecastResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [search, setSearch] = useState<string>('');
  const [showAllRows, setShowAllRows] = useState<boolean>(false);

  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  const loadForecast = useCallback(async (districtScope: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        districtScope && districtScope !== 'all'
          ? `?district=${encodeURIComponent(districtScope)}`
          : '';
      const res = await fetch(`/api/forecast/shortage${qs}`);
      const data = (await res.json()) as ShortageForecastResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Unable to compute shortage forecast');
      }
      setForecast(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forecast request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForecast(selectedDistrict);
  }, [selectedDistrict, loadForecast]);

  // Render Chart.js OLS Regression & Forecast Timeline
  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas || !forecast?.timeline?.length) return;
    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const labels = forecast.timeline.map((pt) => pt.label);
    const actualDemand = forecast.timeline.map((pt) => pt.actual_demand_lpd);
    const actualSupply = forecast.timeline.map((pt) => pt.actual_supply_lpd);
    const regDemand = forecast.timeline.map((pt) => pt.regression_demand_lpd);
    const regSupply = forecast.timeline.map((pt) => pt.regression_supply_lpd);

    chartInstanceRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Actual Demand (HDFS)',
            data: actualDemand,
            borderColor: '#1e293b',
            backgroundColor: '#1e293b',
            borderWidth: 2,
            pointRadius: 3.5,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: 'OLS Demand Forecast',
            data: regDemand,
            borderColor: '#dc2626',
            backgroundColor: '#dc2626',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: forecast.timeline.map((pt) => (pt.is_forecast ? 5.5 : 0)),
            pointHoverRadius: 5,
            tension: 0,
          },
          {
            label: 'Actual Supply (HDFS)',
            data: actualSupply,
            borderColor: '#1677df',
            backgroundColor: '#1677df',
            borderWidth: 2,
            pointRadius: 3.5,
            tension: 0.15,
            spanGaps: false,
          },
          {
            label: 'OLS Supply Forecast',
            data: regSupply,
            borderColor: '#18a878',
            backgroundColor: '#18a878',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: forecast.timeline.map((pt) => (pt.is_forecast ? 5.5 : 0)),
            pointHoverRadius: 5,
            tension: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.raw === null || ctx.raw === undefined) return '';
                return `${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString('en-IN')} L/d`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            beginAtZero: false,
            ticks: {
              font: { size: 11 },
              callback: (val) => {
                const n = Number(val);
                if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M L`;
                return `${Math.round(n / 1000)}K L`;
              },
            },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [forecast]);

  const filteredDistricts = useMemo(() => {
    const rows = forecast?.districts || [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (riskFilter === 'at_risk') {
        if (row.risk_level !== 'Critical Shortage' && row.risk_level !== 'Moderate Deficit') {
          return false;
        }
      } else if (riskFilter !== 'all' && row.risk_level !== riskFilter) {
        return false;
      }
      if (!q) return true;
      return (
        row.district.toLowerCase().includes(q) ||
        row.risk_level.toLowerCase().includes(q)
      );
    });
  }, [forecast?.districts, riskFilter, search]);

  const visibleDistricts: DistrictShortageForecast[] = showAllRows
    ? filteredDistricts
    : filteredDistricts.slice(0, DEFAULT_ROW_LIMIT);

  const availableDistrictOptions = useMemo(() => {
    if (forecast?.districts?.length) {
      return forecast.districts.map((d) => d.district).sort((a, b) => a.localeCompare(b));
    }
    return [...districtsList].sort((a, b) => a.localeCompare(b));
  }, [forecast?.districts, districtsList]);

  const activeGapSlope = forecast
    ? forecast.model.demand_slope_lpd - forecast.model.supply_slope_lpd
    : 0;

  return (
    <div className="space-y-5">
      {/* Header Toolbar */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
              Upcoming Month Supply Shortage Forecast
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {forecast ? (
                <>
                  <span>{forecast.engine}</span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono-data">
                    {forecast.hdfs_metadata.blocks_read} HDFS blocks
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono-data">
                    {formatBytes(forecast.hdfs_metadata.bytes_scanned)}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {forecast.hdfs_metadata.window_start} – {forecast.hdfs_metadata.window_end}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span className="font-mono-data">{forecast.duration_ms} ms</span>
                </>
              ) : (
                'Reading historical water consumption blocks from HDFS via Python 3...'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <select
              aria-label="Filter forecast by district"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Karnataka (31 Districts)</option>
              {availableDistrictOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => loadForecast(selectedDistrict)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {loading ? 'Running OLS...' : 'Run Regression'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {error}
        </div>
      )}

      {/* 4 KPI Summary Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>
              {forecast ? `${forecast.forecast_label} Shortage` : 'Predicted Shortage'}
            </span>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </div>
          <p className="mt-2 font-mono-data text-2xl font-bold text-red-700">
            {forecast ? `${formatLitres(forecast.model.predicted_shortage_lpd)}/d` : '—'}
          </p>
          <p className="mt-1.5 font-mono-data text-[11px] text-slate-500">
            {forecast
              ? `${formatNumber(forecast.model.predicted_monthly_shortage_ml)} ML / 30 days · ${forecast.scope}`
              : 'Computing projection'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Districts At Deficit Risk</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 font-mono-data text-2xl font-bold text-slate-900">
            {forecast
              ? `${forecast.summary.at_risk_districts} / ${forecast.summary.total_districts}`
              : '—'}
          </p>
          <p className="mt-1.5 text-[11px] text-slate-500">
            <span className="font-mono-data font-semibold text-red-700">
              {forecast?.summary.critical_districts ?? 0}
            </span>{' '}
            critical (&lt;60% or ≥1M L/d gap)
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Predicted Supply / Demand</span>
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 font-mono-data text-2xl font-bold text-slate-900">
            {forecast
              ? `${
                  forecast.model.predicted_demand_lpd > 0
                    ? Math.round(
                        (forecast.model.predicted_supply_lpd /
                          forecast.model.predicted_demand_lpd) *
                          1000
                      ) / 10
                    : 100
                }%`
              : '—'}
          </p>
          <p className="mt-1.5 font-mono-data text-[11px] text-slate-500 truncate">
            {forecast
              ? `${formatLitres(forecast.model.predicted_supply_lpd)} / ${formatLitres(
                  forecast.model.predicted_demand_lpd
                )}`
              : 'Demand vs supply ratio'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>OLS Model Fit (R²)</span>
            <Database className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-mono-data text-2xl font-bold text-slate-900">
            {forecast ? `${(forecast.model.demand_r2 * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="mt-1.5 font-mono-data text-[11px] text-slate-500">
            {forecast
              ? `Supply R² ${(forecast.model.supply_r2 * 100).toFixed(1)}% · ${
                  forecast.hdfs_metadata.online_nodes
                }/${forecast.hdfs_metadata.total_nodes} DataNodes`
              : 'Least-squares fit'}
          </p>
        </div>
      </section>

      {/* Chart + OLS Regression Parameters */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Historical HDFS Usage &amp; Linear Regression Projection —{' '}
                {forecast?.scope || 'All Karnataka'}
              </h2>
              <p className="text-[11px] text-slate-500">
                Solid lines show actual monthly usage stored in HDFS blocks; dashed lines show
                Python OLS fit extended to {forecast?.forecast_label || 'next month'}.
              </p>
            </div>
            {selectedDistrict !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedDistrict('all')}
                className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap shrink-0"
              >
                Reset to All Districts
              </button>
            )}
          </div>

          <div className="relative h-72 w-full">
            {loading && !forecast ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                Executing Python simple linear regression on HDFS blocks...
              </div>
            ) : (
              <canvas ref={chartCanvasRef} />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Linear Regression Parameters
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {forecast?.model.algorithm || 'Ordinary Least Squares (y = m*x + b)'}
            </p>

            {forecast ? (
              <div className="mt-4 space-y-3 text-xs">
                <div className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Demand Trend Slope (m)</span>
                    <span className="font-mono-data font-semibold text-red-700">
                      {formatSlope(forecast.model.demand_slope_lpd)}
                    </span>
                  </div>
                  <div className="mt-1 font-mono-data text-[11px] text-slate-500">
                    y = {formatNumber(forecast.model.demand_slope_lpd)}·x +{' '}
                    {formatNumber(forecast.model.demand_intercept_lpd)}
                  </div>
                </div>

                <div className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Supply Trend Slope (m)</span>
                    <span
                      className={`font-mono-data font-semibold ${
                        forecast.model.supply_slope_lpd < 0
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {formatSlope(forecast.model.supply_slope_lpd)}
                    </span>
                  </div>
                  <div className="mt-1 font-mono-data text-[11px] text-slate-500">
                    y = {formatNumber(forecast.model.supply_slope_lpd)}·x +{' '}
                    {formatNumber(forecast.model.supply_intercept_lpd)}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Monthly Gap Drift</span>
                    <span
                      className={`font-mono-data font-semibold ${
                        activeGapSlope > 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatSlope(activeGapSlope)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Demand RMSE</span>
                    <span className="font-mono-data text-slate-800">
                      ±{formatLitres(forecast.model.demand_rmse_lpd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Supply RMSE</span>
                    <span className="font-mono-data text-slate-800">
                      ±{formatLitres(forecast.model.supply_rmse_lpd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">HDFS Rows Scanned</span>
                    <span className="font-mono-data text-slate-800">
                      {formatNumber(
                        forecast.hdfs_metadata.water_records_scanned +
                          forecast.hdfs_metadata.usage_history_rows_scanned
                      )}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-xs text-slate-400">Loading coefficients...</p>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => onNavigate('emergency')}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50/60 whitespace-nowrap shrink-0"
            >
              Pre-stage Tankers
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('datasets')}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              HDFS Data
            </button>
          </div>
        </section>
      </div>

      {/* District-by-District Upcoming Month Shortage Forecast Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              District-Wise {forecast?.forecast_label || 'Upcoming Month'} Shortage Predictions
            </h2>
            <p className="text-[11px] text-slate-500">
              Click any district row to plot its 6-month HDFS linear regression curve above.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search district..."
                aria-label="Search districts in shortage forecast"
                className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'at_risk', label: 'At Risk' },
                  { id: 'Critical Shortage', label: 'Critical' },
                  { id: 'Surplus / Safe', label: 'Safe' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRiskFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    riskFilter === tab.id
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
                <th className="py-2 pr-3 font-medium">District</th>
                <th className="py-2 px-2.5 text-right font-medium">Current Shortage</th>
                <th className="py-2 px-2.5 text-right font-medium">Predicted Demand</th>
                <th className="py-2 px-2.5 text-right font-medium">Predicted Supply</th>
                <th className="py-2 px-2.5 text-right font-medium">
                  Next-Mo Shortage
                </th>
                <th className="py-2 px-2.5 text-right font-medium">30-Day Deficit</th>
                <th className="py-2 px-2.5 text-right font-medium">Coverage</th>
                <th className="py-2 px-2.5 text-right font-medium">Demand Slope</th>
                <th className="py-2 pl-2.5 text-right font-medium">Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDistricts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-500">
                    No districts match the active filter.
                  </td>
                </tr>
              ) : (
                visibleDistricts.map((row) => {
                  const isFocused =
                    selectedDistrict.toLowerCase() === row.district.toLowerCase();
                  return (
                    <tr
                      key={row.district}
                      onClick={() => setSelectedDistrict(row.district)}
                      className={`cursor-pointer transition-colors ${
                        isFocused ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-slate-900 whitespace-nowrap">
                        {row.district}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-600 whitespace-nowrap">
                        {row.current_shortage_lpd > 0
                          ? `${formatLitres(row.current_shortage_lpd)}/d`
                          : '0 L/d'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-900 whitespace-nowrap">
                        {formatLitres(row.predicted_demand_lpd)}/d
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-blue-700 whitespace-nowrap">
                        {formatLitres(row.predicted_supply_lpd)}/d
                      </td>
                      <td
                        className={`py-2.5 px-2.5 text-right font-mono-data font-semibold whitespace-nowrap ${
                          row.predicted_shortage_lpd > 0 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {row.predicted_shortage_lpd > 0
                          ? `${formatLitres(row.predicted_shortage_lpd)}/d`
                          : '0 L/d'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-700 whitespace-nowrap">
                        {row.predicted_monthly_shortage_ml > 0
                          ? `${formatNumber(row.predicted_monthly_shortage_ml)} ML`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-800 whitespace-nowrap">
                        {formatNumber(row.predicted_coverage_pct)}%
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data text-slate-600 whitespace-nowrap">
                        {formatSlope(row.demand_slope_lpd)}
                      </td>
                      <td
                        className={`py-2.5 pl-2.5 text-right font-semibold whitespace-nowrap ${riskColorClass(
                          row.risk_level
                        )}`}
                      >
                        {row.risk_level}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredDistricts.length > DEFAULT_ROW_LIMIT && (
          <div className="mt-3 flex justify-center border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap shrink-0"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAllRows ? 'rotate-180' : ''}`}
              />
              {showAllRows
                ? 'Show top 10 districts'
                : `Show all ${filteredDistricts.length} districts`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
