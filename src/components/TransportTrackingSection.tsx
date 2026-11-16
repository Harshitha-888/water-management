import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  ChevronDown,
  Clock,
  Database,
  Droplets,
  GitBranch,
  MapPin,
  Navigation,
  Play,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Truck,
} from 'lucide-react';
import type {
  EmergencyRequest,
  MapReduceJobTrace,
  RouteResult,
  TrackingStatus,
  TransportDelivery,
  TransportDeliveryStatus,
  TransportPythonReport,
} from '../types';
import { formatDateTime, formatLitres, formatNumber } from '../utils/format';

interface TransportTrackingSectionProps {
  requests: EmergencyRequest[];
  districtsList: string[];
  selectedTrackingId: number | null;
  onSelectTrackingId: (id: number | null) => void;
  onRefreshRequests: () => Promise<void>;
}

type ToolTab = 'mapreduce' | 'python' | 'storage';

const DEFAULT_ROW_LIMIT = 8;

function statusTextClass(status: TransportDeliveryStatus): string {
  if (status === 'Delivered') return 'text-emerald-700';
  if (status === 'In Transit') return 'text-blue-700';
  if (status === 'Dispatched') return 'text-amber-700';
  return 'text-slate-600';
}

export const TransportTrackingSection: React.FC<TransportTrackingSectionProps> = ({
  requests,
  districtsList,
  selectedTrackingId,
  onSelectTrackingId,
  onRefreshRequests,
}) => {
  const [deliveries, setDeliveries] = useState<TransportDelivery[]>([]);
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [focusedDeliveryId, setFocusedDeliveryId] = useState<number | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mapScope, setMapScope] = useState<'active' | 'all'>('active');
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [form, setForm] = useState({
    tanker_id: 'AQUA-T009',
    vehicle_reg: 'KA-01-G-8840',
    driver_name: '',
    driver_phone: '',
    starting_location: 'Yelahanka Depot, Bengaluru',
    destination_area: '',
    district: districtsList[0] || 'Bengaluru Urban',
    water_quantity_l: '25000',
    estimated_minutes: '65',
    delivery_status: 'Dispatched' as TransportDeliveryStatus,
  });

  const [showRoutePlanner, setShowRoutePlanner] = useState<boolean>(
    Boolean(selectedTrackingId)
  );
  const [sourceInput, setSourceInput] = useState('Mysuru, Karnataka');
  const [destInput, setDestInput] = useState('Mandya, Karnataka');
  const [calculatingRoute, setCalculatingRoute] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);

  const [tracking, setTracking] = useState<TrackingStatus | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);

  const [activeToolTab, setActiveToolTab] = useState<ToolTab>('mapreduce');
  const [mrJob, setMrJob] = useState<MapReduceJobTrace | null>(null);
  const [mrLoading, setMrLoading] = useState(false);
  const [pythonReport, setPythonReport] = useState<TransportPythonReport | null>(null);
  const [pythonLoading, setPythonLoading] = useState(false);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fleetLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);

  const loadDeliveries = useCallback(async () => {
    try {
      const res = await fetch('/api/transport/deliveries');
      const data = await res.json();
      if (Array.isArray(data)) {
        setDeliveries(data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingFleet(false);
    }
  }, []);

  const loadPythonProcess = useCallback(async () => {
    setPythonLoading(true);
    try {
      const res = await fetch('/api/transport/python-process');
      const data = (await res.json()) as TransportPythonReport;
      if (data?.success) {
        setPythonReport(data);
      }
    } catch {
      // ignore
    } finally {
      setPythonLoading(false);
    }
  }, []);

  const runTransportMapReduce = useCallback(async () => {
    setMrLoading(true);
    try {
      const res = await fetch('/api/mapreduce/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobType: 'transport_delivery_summary',
          numReducers: 4,
        }),
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

  useEffect(() => {
    loadDeliveries();
    loadPythonProcess();
  }, [loadDeliveries, loadPythonProcess]);

  useEffect(() => {
    if (activeToolTab === 'mapreduce' && !mrJob) {
      runTransportMapReduce();
    } else if ((activeToolTab === 'python' || activeToolTab === 'storage') && !pythonReport) {
      loadPythonProcess();
    }
  }, [activeToolTab, mrJob, pythonReport, runTransportMapReduce, loadPythonProcess]);

  useEffect(() => {
    if (selectedTrackingId) {
      setShowRoutePlanner(true);
    }
  }, [selectedTrackingId]);

  useEffect(() => {
    if (mapEl.current && !mapRef.current) {
      const map = L.map(mapEl.current).setView([14.6, 76.2], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      fleetLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  const telemetryById = useMemo(() => {
    const map = new Map<number, TransportPythonReport['processed_telemetry'][number]>();
    if (pythonReport?.processed_telemetry) {
      for (const item of pythonReport.processed_telemetry) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [pythonReport]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = fleetLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const visible =
      mapScope === 'active'
        ? deliveries.filter((d) => d.delivery_status !== 'Delivered')
        : deliveries;

    const boundsPts: [number, number][] = [];

    for (const d of visible) {
      const isFocused = focusedDeliveryId === d.id;
      const src: [number, number] = [d.source_lat, d.source_lon];
      const dst: [number, number] = [d.dest_lat, d.dest_lon];
      const cur: [number, number] = [d.current_lat, d.current_lon];
      const telem = telemetryById.get(d.id);

      boundsPts.push(src, dst, cur);

      L.polyline([src, cur, dst], {
        color: d.delivery_status === 'Delivered' ? '#10b981' : isFocused ? '#1d4ed8' : '#64748b',
        weight: isFocused ? 3.5 : 2,
        opacity: isFocused ? 0.9 : 0.45,
        dashArray: d.delivery_status === 'Delivered' ? undefined : '5, 5',
      }).addTo(layer);

      L.circleMarker(src, {
        radius: isFocused ? 6 : 4,
        color: '#15803d',
        fillColor: '#22c55e',
        fillOpacity: 0.9,
        weight: 1.5,
      })
        .bindPopup(`<strong>Depot:</strong> ${d.starting_location}<br/>Tanker: ${d.tanker_id}`)
        .addTo(layer);

      L.circleMarker(dst, {
        radius: isFocused ? 6 : 4,
        color: '#b91c1c',
        fillColor: '#ef4444',
        fillOpacity: 0.9,
        weight: 1.5,
      })
        .bindPopup(
          `<strong>Destination:</strong> ${d.destination_area}, ${d.district}<br/>Qty: ${formatLitres(
            d.water_quantity_l
          )}`
        )
        .addTo(layer);

      const vehicleColor =
        d.delivery_status === 'Delivered'
          ? '#059669'
          : d.delivery_status === 'In Transit'
          ? '#1d4ed8'
          : '#d97706';

      const marker = L.circleMarker(cur, {
        radius: isFocused ? 10 : 7,
        color: '#ffffff',
        fillColor: vehicleColor,
        fillOpacity: 1,
        weight: isFocused ? 3 : 2,
      }).bindPopup(
        `<div style="font-size:12px;line-height:1.45">
          <strong>${d.tanker_id}</strong> (${d.vehicle_reg})<br/>
          Driver: ${d.driver_name} (${d.driver_phone})<br/>
          Route: ${d.starting_location} &rarr; ${d.destination_area}<br/>
          Water: ${formatLitres(d.water_quantity_l)}<br/>
          Status: <strong>${d.delivery_status}</strong> · ETA: ${
            telem ? `${telem.remaining_eta_min} min` : `${d.estimated_minutes} min`
          }
        </div>`
      );
      marker.addTo(layer);
      if (isFocused) {
        marker.openPopup();
        map.fitBounds(L.latLngBounds([src, dst, cur]), { padding: [44, 44], maxZoom: 11 });
      }
    }

    if (!focusedDeliveryId && boundsPts.length > 0 && !routeResult && !tracking?.geometry) {
      map.fitBounds(L.latLngBounds(boundsPts), { padding: [32, 32], maxZoom: 9 });
    }
  }, [deliveries, mapScope, focusedDeliveryId, telemetryById, routeResult, tracking]);

  const drawRoadRouteOnMap = (
    coords: [number, number][],
    tankerPos?: { lat: number; lon: number } | null
  ) => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer || coords.length === 0) return;
    layer.clearLayers();
    const latLngs = coords.map(([lon, lat]) => [lat, lon] as [number, number]);
    const poly = L.polyline(latLngs, { color: '#1677df', weight: 4 }).addTo(layer);

    L.circleMarker(latLngs[0], {
      radius: 6,
      color: '#16a34a',
      fillColor: '#16a34a',
      fillOpacity: 1,
    })
      .bindPopup('Water Source')
      .addTo(layer);

    L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 6,
      color: '#dc2626',
      fillColor: '#dc2626',
      fillOpacity: 1,
    })
      .bindPopup('Delivery Destination')
      .addTo(layer);

    if (tankerPos) {
      L.circleMarker([tankerPos.lat, tankerPos.lon], {
        radius: 8,
        color: '#1d4ed8',
        fillColor: '#3b82f6',
        fillOpacity: 1,
      })
        .bindPopup('Simulated Emergency Tanker')
        .addTo(layer);
    }

    map.fitBounds(poly.getBounds(), { padding: [36, 36] });
  };

  const handleCalculateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalculatingRoute(true);
    setRouteError(null);
    try {
      const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: sourceInput, destination: destInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not calculate road route');
      }
      setRouteResult(data);
      drawRoadRouteOnMap(data.geometry.coordinates);
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Routing failed');
    } finally {
      setCalculatingRoute(false);
    }
  };

  const fetchTrackingStatus = async (reqId: number) => {
    try {
      const res = await fetch(`/api/emergency-requests/${reqId}/tracking`);
      const data = (await res.json()) as TrackingStatus;
      if (res.ok && data.success) {
        setTracking(data);
        if (data.geometry?.coordinates) {
          drawRoadRouteOnMap(data.geometry.coordinates, data.current_position);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!selectedTrackingId) {
      setTracking(null);
      return;
    }
    fetchTrackingStatus(selectedTrackingId);
    const timer = setInterval(() => {
      fetchTrackingStatus(selectedTrackingId);
    }, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrackingId]);

  const handleStartDemoTracking = async () => {
    if (!selectedTrackingId) {
      setTrackingNotice('Please select an emergency request first.');
      return;
    }
    const reqObj = requests.find((r) => r.id === selectedTrackingId);
    if (!reqObj?.source_location || !reqObj?.destination_location) {
      setTrackingNotice('Selected request needs both source and delivery destination.');
      return;
    }

    setTrackingBusy(true);
    setTrackingNotice(null);
    try {
      const res = await fetch(
        `/api/emergency-requests/${selectedTrackingId}/tracking/start-demo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: reqObj.source_location,
            destination: reqObj.destination_location,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Unable to start demo tracking');
      }
      setTrackingNotice(
        `Tracking started for ${data.tanker_id} (${data.distance_km} km road route).`
      );
      await onRefreshRequests();
      await fetchTrackingStatus(selectedTrackingId);
    } catch (err) {
      setTrackingNotice(err instanceof Error ? err.message : 'Tracking startup failed');
    } finally {
      setTrackingBusy(false);
    }
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDispatchBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/transport/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          water_quantity_l: Number(form.water_quantity_l),
          estimated_minutes: Number(form.estimated_minutes),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to dispatch tanker');
      }
      setNotice({
        type: 'success',
        text: `${data.record.tanker_id} dispatched to ${data.record.destination_area} (SQL + HDFS).`,
      });
      setShowDispatchForm(false);
      setFocusedDeliveryId(data.record.id);
      const nextNum = deliveries.length + 10;
      setForm((prev) => ({
        ...prev,
        tanker_id: `AQUA-T${String(nextNum).padStart(3, '0')}`,
        driver_name: '',
        driver_phone: '',
        destination_area: '',
      }));
      await Promise.all([loadDeliveries(), loadPythonProcess()]);
      if (activeToolTab === 'mapreduce') {
        await runTransportMapReduce();
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Dispatch error',
      });
    } finally {
      setDispatchBusy(false);
    }
  };

  const handleStatusUpdate = async (id: number, delivery_status: TransportDeliveryStatus) => {
    setUpdatingId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/transport/deliveries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_status }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Status update failed');
      }
      await Promise.all([loadDeliveries(), loadPythonProcess()]);
      if (activeToolTab === 'mapreduce') {
        await runTransportMapReduce();
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update status',
      });
    } finally {
      setUpdatingId(null);
    }
  };

  const kpis = useMemo(() => {
    const active = deliveries.filter(
      (d) => d.delivery_status === 'In Transit' || d.delivery_status === 'Dispatched'
    );
    const delivered = deliveries.filter((d) => d.delivery_status === 'Delivered');
    const totalWater = deliveries.reduce((s, d) => s + (d.water_quantity_l || 0), 0);
    const avgEta = deliveries.length
      ? Math.round(
          deliveries.reduce((s, d) => s + (d.estimated_minutes || 0), 0) / deliveries.length
        )
      : 0;
    return {
      totalCount: deliveries.length,
      activeCount: active.length,
      deliveredCount: delivered.length,
      totalWater,
      avgEta,
    };
  }, [deliveries]);

  const filteredDeliveries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (statusFilter !== 'all' && d.delivery_status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${d.tanker_id} ${d.vehicle_reg} ${d.driver_name} ${d.driver_phone} ${d.starting_location} ${d.destination_area} ${d.district}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deliveries, search, statusFilter]);

  const visibleDeliveries = showAllRows
    ? filteredDeliveries
    : filteredDeliveries.slice(0, DEFAULT_ROW_LIMIT);

  return (
    <div className="space-y-4">
      {/* Compact Header + Actions */}
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Tanker Fleet &amp; Tracking
          </h1>
          <span className="text-xs text-slate-500">
            {kpis.activeCount} active · {kpis.deliveredCount} delivered
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowRoutePlanner((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Navigation className="h-3.5 w-3.5" />
            {showRoutePlanner ? 'Hide Route Planner' : 'OSRM Route & Demo'}
          </button>
          <button
            type="button"
            onClick={() => setShowDispatchForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            {showDispatchForm ? 'Close' : 'Dispatch Tanker'}
          </button>
        </div>
      </div>

      {/* 4 Icon-Badged KPI Cards */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Total Dispatches</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-slate-900">
              {formatNumber(kpis.totalCount)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {kpis.deliveredCount} completed
            </p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Truck className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Active / In Transit</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-blue-700">
              {formatNumber(kpis.activeCount)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Live on map</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Navigation className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Water Transported</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-teal-700">
              {formatLitres(kpis.totalWater)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Fleet cumulative volume</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            <Droplets className="h-4 w-4" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">Avg Est. Delivery</p>
            <p className="mt-1 font-mono-data text-xl font-bold text-emerald-700">
              {formatNumber(kpis.avgEta)} min
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">Scheduled &amp; active routes</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <Clock className="h-4 w-4" />
          </div>
        </div>
      </section>

      {notice && (
        <div
          className={`rounded-lg px-3.5 py-2 text-xs font-medium ${
            notice.type === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Collapsible Dispatch Tanker Form */}
      {showDispatchForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            Dispatch Water Tanker
          </h2>
          <form
            onSubmit={handleDispatchSubmit}
            className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <input
              required
              value={form.tanker_id}
              onChange={(e) => setForm((p) => ({ ...p, tanker_id: e.target.value }))}
              placeholder="Tanker ID (AQUA-T009) *"
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              value={form.vehicle_reg}
              onChange={(e) => setForm((p) => ({ ...p, vehicle_reg: e.target.value }))}
              placeholder="Vehicle Reg *"
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              value={form.driver_name}
              onChange={(e) => setForm((p) => ({ ...p, driver_name: e.target.value }))}
              placeholder="Driver Name *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              value={form.driver_phone}
              onChange={(e) => setForm((p) => ({ ...p, driver_phone: e.target.value }))}
              placeholder="Driver Phone"
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              value={form.starting_location}
              onChange={(e) => setForm((p) => ({ ...p, starting_location: e.target.value }))}
              placeholder="Starting Location *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <input
              required
              value={form.destination_area}
              onChange={(e) => setForm((p) => ({ ...p, destination_area: e.target.value }))}
              placeholder="Destination Area *"
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={form.district}
              onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {districtsList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                required
                type="number"
                min={1000}
                step={500}
                value={form.water_quantity_l}
                onChange={(e) => setForm((p) => ({ ...p, water_quantity_l: e.target.value }))}
                placeholder="Litres *"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="number"
                min={10}
                value={form.estimated_minutes}
                onChange={(e) => setForm((p) => ({ ...p, estimated_minutes: e.target.value }))}
                placeholder="ETA (m)"
                className="w-20 rounded-lg border border-slate-200 px-2 py-2 font-mono-data text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={dispatchBusy}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                {dispatchBusy ? 'Sending...' : 'Dispatch'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Live Fleet Leaflet Map Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Live Leaflet Fleet &amp; Route Map
          </h2>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setFocusedDeliveryId(null);
                setMapScope('active');
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                mapScope === 'active'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active Fleet
            </button>
            <button
              type="button"
              onClick={() => {
                setFocusedDeliveryId(null);
                setMapScope('all');
              }}
              className={`rounded-md px-2.5 py-1 font-semibold transition-colors ${
                mapScope === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Routes
            </button>
          </div>
        </div>

        {/* Collapsible OSRM Route & Emergency Demo Drawer */}
        {showRoutePlanner && (
          <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
            <form
              onSubmit={handleCalculateRoute}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
            >
              <input
                required
                value={sourceInput}
                onChange={(e) => setSourceInput(e.target.value)}
                placeholder="OSRM Source (e.g. Mysuru)"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <input
                required
                value={destInput}
                onChange={(e) => setDestInput(e.target.value)}
                placeholder="OSRM Destination (e.g. Mandya)"
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={calculatingRoute}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Navigation className="h-3.5 w-3.5" />
                {calculatingRoute ? 'Calculating...' : 'Calculate Road Route'}
              </button>
            </form>

            {routeError && <p className="text-xs font-medium text-red-700">{routeError}</p>}

            {routeResult && (
              <div className="flex flex-wrap items-center gap-5 border-t border-slate-200 pt-2.5 text-xs">
                <span>
                  Distance:{' '}
                  <strong className="font-mono-data text-blue-700">
                    {formatNumber(routeResult.distance_km)} km
                  </strong>
                </span>
                <span>
                  Drive Time:{' '}
                  <strong className="font-mono-data text-slate-900">
                    {formatNumber(routeResult.duration_minutes)} min
                  </strong>
                </span>
              </div>
            )}

            <div className="flex flex-col justify-between gap-2 border-t border-slate-200 pt-2.5 sm:flex-row sm:items-center">
              <span className="text-xs font-medium text-slate-700">
                Emergency Request Demo Tracking
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedTrackingId ?? ''}
                  onChange={(e) =>
                    onSelectTrackingId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select emergency request</option>
                  {requests.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} · {r.area}, {r.district} ({r.status})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleStartDemoTracking}
                  disabled={trackingBusy || !selectedTrackingId}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Play className="h-3 w-3" />
                  {trackingBusy ? 'Starting...' : 'Start Demo'}
                </button>
                {selectedTrackingId && (
                  <button
                    type="button"
                    aria-label="Refresh tracking status"
                    onClick={() => fetchTrackingStatus(selectedTrackingId)}
                    className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {trackingNotice && (
              <p className="text-xs font-medium text-blue-700">{trackingNotice}</p>
            )}

            {tracking && (
              <div className="space-y-1.5 border-t border-slate-200 pt-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    {tracking.tanker_id || `Request #${tracking.request_id}`} ·{' '}
                    <span className="text-blue-700">{tracking.status}</span>
                  </span>
                  <span className="font-mono-data font-semibold text-slate-800">
                    {formatNumber(tracking.progress_percentage)}% ·{' '}
                    {formatNumber(tracking.remaining_minutes)} min
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${tracking.progress_percentage}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div
          ref={mapEl}
          className="h-72 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
        />

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-blue-700" />
              In Transit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-600" />
              Dispatched
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-600" />
              Delivered
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Depot
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              Destination
            </span>
          </div>
          {focusedDeliveryId && (
            <button
              type="button"
              onClick={() => setFocusedDeliveryId(null)}
              className="font-medium text-blue-600 hover:underline"
            >
              Reset Map Bounds
            </button>
          )}
        </div>
      </section>

      {/* Fleet Delivery Log Table */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
          <h2 className="text-sm font-semibold text-slate-900">
            Tanker Fleet &amp; Delivery History
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowAllRows(false);
                }}
                placeholder="Search tanker, driver, area..."
                className="w-52 rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setShowAllRows(false);
              }}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="In Transit">In Transit</option>
              <option value="Dispatched">Dispatched</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Delivered">Delivered</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Tanker</th>
                <th className="py-2 px-2.5 font-medium">Driver</th>
                <th className="py-2 px-2.5 font-medium">Route</th>
                <th className="py-2 px-2.5 text-right font-medium">Qty</th>
                <th className="py-2 px-2.5 font-medium">ETA / Progress</th>
                <th className="py-2 px-2.5 font-medium">Status</th>
                <th className="py-2 pl-2.5 text-right font-medium">Map</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loadingFleet ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading tanker fleet records...
                  </td>
                </tr>
              ) : visibleDeliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No matching tanker delivery records found.
                  </td>
                </tr>
              ) : (
                visibleDeliveries.map((d) => {
                  const telem = telemetryById.get(d.id);
                  const pct =
                    d.delivery_status === 'Delivered' ? 100 : (telem?.progress_pct ?? 45);
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <p className="font-mono-data font-semibold text-slate-900">
                          {d.tanker_id}
                        </p>
                        <p className="font-mono-data text-[11px] text-slate-400">
                          {d.vehicle_reg}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <p className="font-medium text-slate-900">{d.driver_name}</p>
                        <p className="font-mono-data text-[11px] text-slate-400">
                          {d.driver_phone}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5">
                        <p className="font-medium text-slate-900">
                          {d.starting_location.split(',')[0]} &rarr; {d.destination_area}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {d.district} · {d.distance_km} km · {formatDateTime(d.dispatched_at)}
                        </p>
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono-data font-semibold text-slate-900 whitespace-nowrap">
                        {formatLitres(d.water_quantity_l)}
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                d.delivery_status === 'Delivered'
                                  ? 'bg-emerald-600'
                                  : 'bg-blue-600'
                              }`}
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                          <span className="font-mono-data text-slate-700">
                            {d.delivery_status === 'Delivered'
                              ? 'Done'
                              : `${telem ? telem.remaining_eta_min : d.estimated_minutes}m`}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2.5 whitespace-nowrap">
                        <select
                          aria-label={`Update delivery status for ${d.tanker_id}`}
                          disabled={updatingId === d.id}
                          value={d.delivery_status}
                          onChange={(e) =>
                            handleStatusUpdate(
                              d.id,
                              e.target.value as TransportDeliveryStatus
                            )
                          }
                          className={`rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold ${statusTextClass(
                            d.delivery_status
                          )}`}
                        >
                          <option value="Scheduled" className="text-slate-900">
                            Scheduled
                          </option>
                          <option value="Dispatched" className="text-slate-900">
                            Dispatched
                          </option>
                          <option value="In Transit" className="text-slate-900">
                            In Transit
                          </option>
                          <option value="Delivered" className="text-slate-900">
                            Delivered
                          </option>
                        </select>
                      </td>
                      <td className="py-2.5 pl-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setFocusedDeliveryId(d.id);
                            if (d.delivery_status === 'Delivered') {
                              setMapScope('all');
                            }
                            mapEl.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'center',
                            });
                          }}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                            focusedDeliveryId === d.id
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <MapPin className="h-3 w-3" />
                          Locate
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredDeliveries.length > DEFAULT_ROW_LIMIT && (
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
            <span>
              Showing {visibleDeliveries.length} of {filteredDeliveries.length} deliveries
            </span>
            <button
              type="button"
              onClick={() => setShowAllRows((v) => !v)}
              className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
            >
              {showAllRows ? 'Show top 8' : `Show all (${filteredDeliveries.length})`}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showAllRows ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        )}
      </section>

      {/* Compact Tabbed Analytics & Storage Workbench */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex flex-col justify-between gap-2.5 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'mapreduce', label: 'MapReduce (Delivery Log)', icon: GitBranch },
                { id: 'python', label: 'Python Telemetry', icon: Terminal },
                { id: 'storage', label: 'SQL & HDFS Shards', icon: Database },
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

          {activeToolTab === 'mapreduce' && (
            <button
              type="button"
              onClick={runTransportMapReduce}
              disabled={mrLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${mrLoading ? 'animate-spin' : ''}`} />
              {mrLoading ? 'Running...' : 'Re-run'}
            </button>
          )}

          {activeToolTab === 'python' && (
            <button
              type="button"
              onClick={loadPythonProcess}
              disabled={pythonLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${pythonLoading ? 'animate-spin' : ''}`} />
              {pythonLoading ? 'Processing...' : 'Refresh'}
            </button>
          )}
        </div>

        {/* Tab 1: MapReduce */}
        {activeToolTab === 'mapreduce' && (
          <div className="space-y-3">
            {mrJob ? (
              <>
                <div className="flex flex-wrap items-center gap-5 text-xs text-slate-600">
                  <span>
                    Job <strong className="font-mono-data text-slate-900">{mrJob.jobId}</strong>
                  </span>
                  <span>
                    <strong className="font-mono-data">{mrJob.inputSplits}</strong> HDFS splits ·{' '}
                    <strong className="font-mono-data">{mrJob.recordsScanned}</strong> records ·{' '}
                    <strong className="font-mono-data text-blue-700">{mrJob.durationMs} ms</strong>
                  </span>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Destination · District</th>
                        <th className="py-2 px-2.5 text-right font-medium">Count</th>
                        <th className="py-2 px-2.5 text-right font-medium">Active</th>
                        <th className="py-2 px-2.5 text-right font-medium">Delivered</th>
                        <th className="py-2 px-2.5 text-right font-medium">Total Water</th>
                        <th className="py-2 px-2.5 text-right font-medium">Avg ETA</th>
                        <th className="py-2 pl-2.5 font-medium">Tankers</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mrJob.results.slice(0, 10).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="font-medium text-slate-900">
                              {String(row.destination_area)}
                            </span>
                            <span className="text-slate-400"> · {String(row.district)}</span>
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {String(row.delivery_count)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-blue-700">
                            {String(row.active_count)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data text-emerald-700">
                            {String(row.delivered_count)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data font-semibold">
                            {formatLitres(Number(row.total_water_l || 0))}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {String(row.avg_eta_min)}m
                          </td>
                          <td className="py-2 pl-2.5 font-mono-data text-slate-600 whitespace-nowrap">
                            {String(row.tankers_assigned)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">Running MapReduce job on HDFS delivery shards...</p>
            )}
          </div>
        )}

        {/* Tab 2: Python Tracking Telemetry */}
        {activeToolTab === 'python' && (
          <div className="space-y-3">
            {pythonReport ? (
              <>
                <div className="grid grid-cols-2 gap-3 border-b border-slate-100 pb-3 sm:grid-cols-4 text-xs">
                  <div>
                    <span className="text-slate-500">Runtime</span>
                    <p className="font-mono-data font-semibold text-slate-900">
                      {pythonReport.engine}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">In-Transit Volume</span>
                    <p className="font-mono-data font-semibold text-blue-700">
                      {formatLitres(pythonReport.total_in_transit_l)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Delivered Volume</span>
                    <p className="font-mono-data font-semibold text-emerald-700">
                      {formatLitres(pythonReport.total_delivered_l)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Execution</span>
                    <p className="font-mono-data font-semibold text-slate-900">
                      {pythonReport.duration_ms} ms
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Tanker</th>
                        <th className="py-2 px-2.5 font-medium">Driver</th>
                        <th className="py-2 px-2.5 font-medium">Destination</th>
                        <th className="py-2 px-2.5 text-right font-medium">Dist</th>
                        <th className="py-2 px-2.5 text-right font-medium">Speed</th>
                        <th className="py-2 px-2.5 text-right font-medium">Progress</th>
                        <th className="py-2 pl-2.5 text-right font-medium">ETA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pythonReport.processed_telemetry.slice(0, 10).map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50/70">
                          <td className="py-2 pr-3 font-mono-data font-semibold text-slate-900">
                            {t.tanker_id}
                          </td>
                          <td className="py-2 px-2.5 text-slate-700">{t.driver_name}</td>
                          <td className="py-2 px-2.5 text-slate-700">{t.destination_area}</td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {t.distance_km} km
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data">
                            {t.avg_speed_kmh} km/h
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono-data font-semibold text-blue-700">
                            {t.progress_pct}%
                          </td>
                          <td className="py-2 pl-2.5 text-right font-mono-data">
                            {t.delivery_status === 'Delivered'
                              ? 'Arrived'
                              : `${t.remaining_eta_min}m`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">Running Python tracking processor...</p>
            )}
          </div>
        )}

        {/* Tab 3: Relational SQL & HDFS Shards */}
        {activeToolTab === 'storage' && (
          <div className="space-y-3">
            {pythonReport && (
              <div className="grid grid-cols-1 gap-3 border-b border-slate-100 pb-3 sm:grid-cols-3 text-xs">
                <div>
                  <span className="text-slate-500">SQLite Store</span>
                  <p className="font-mono-data font-semibold text-slate-900 truncate">
                    {pythonReport.db_path}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">SQL `vehicles`</span>
                  <p className="font-mono-data font-bold text-slate-900">
                    {pythonReport.sql_tables.vehicles} vehicles
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">SQL `tanker_deliveries`</span>
                  <p className="font-mono-data font-bold text-slate-900">
                    {pythonReport.sql_tables.tanker_deliveries} records
                  </p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Tanker ID</th>
                    <th className="py-2 px-2.5 font-medium">Route</th>
                    <th className="py-2 px-2.5 font-medium">HDFS Block</th>
                    <th className="py-2 pl-2.5 font-medium">Node</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deliveries.slice(0, 10).map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/70">
                      <td className="py-2 pr-3 font-mono-data font-semibold text-slate-900">
                        {d.tanker_id}
                      </td>
                      <td className="py-2 px-2.5 text-slate-700">
                        {d.starting_location.split(',')[0]} &rarr; {d.destination_area}
                      </td>
                      <td className="py-2 px-2.5 font-mono-data text-blue-700">
                        {d.block_id || 'Pending shard'}
                      </td>
                      <td className="py-2 pl-2.5 font-mono-data text-slate-600">
                        {d.hdfs_node || 'node-01'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
