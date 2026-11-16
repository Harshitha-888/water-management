import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  Droplets,
  GitBranch,
  LayoutGrid,
  MapPin,
  Menu,
  RefreshCw,
  TrendingUp,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { AreaManagementSection } from './components/AreaManagementSection';
import { BigDataToolsSection } from './components/BigDataToolsSection';
import { ClusterStorageSection } from './components/ClusterStorageSection';
import { CriticalNotificationsSidebar } from './components/CriticalNotificationsSidebar';
import { DataManagementSection } from './components/DataManagementSection';
import { EmergencySection } from './components/EmergencySection';
import { MaintenanceSection } from './components/MaintenanceSection';
import { MapReduceSection } from './components/MapReduceSection';
import { OverviewSection } from './components/OverviewSection';
import { ReservoirsSection } from './components/ReservoirsSection';
import { ShortageForecastSection } from './components/ShortageForecastSection';
import { TransportTrackingSection } from './components/TransportTrackingSection';
import type {
  ClusterStatus,
  DistrictCoverage,
  EmergencyRequest,
  LiveMaintenanceFeedsResponse,
  LiveWeatherResponse,
  MaintenanceTask,
  PublicDatasetInfo,
  PublicWaterResponse,
  ReservoirRecord,
  UploadedDataset,
  WaterRecord,
  WaterSummary,
} from './types';

type TabId =
  | 'overview'
  | 'areas'
  | 'reservoirs'
  | 'forecast'
  | 'emergency'
  | 'transport'
  | 'maintenance'
  | 'datasets'
  | 'mapreduce_hub';

type BigDataSubTab = 'mapreduce' | 'cluster' | 'bigdata';

interface NavItem {
  id: TabId;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', title: 'Overview', icon: LayoutGrid },
  { id: 'areas', label: 'Area Management', title: 'District & Area Management', icon: MapPin },
  { id: 'reservoirs', label: 'Reservoirs', title: 'Reservoir Management', icon: Activity },
  { id: 'forecast', label: 'Shortage Forecast', title: 'Shortage Forecast (Python OLS)', icon: TrendingUp },
  { id: 'emergency', label: 'Emergency Requests', title: 'Emergency Water Requests', icon: AlertTriangle },
  { id: 'transport', label: 'Transport & Tracking', title: 'Transportation Map & Tracking', icon: Truck },
  { id: 'maintenance', label: 'Water Maintenance', title: 'Water Infrastructure Maintenance', icon: Wrench },
  { id: 'datasets', label: 'Data Management', title: 'Data Management', icon: Database },
  { id: 'mapreduce_hub', label: 'MapReduce & Big Data', title: 'MapReduce & Big Data Tools', icon: GitBranch },
];

export default function App() {
  const [enteredDashboard, setEnteredDashboard] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [bigDataSubTab, setBigDataSubTab] = useState<BigDataSubTab>('mapreduce');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [summary, setSummary] = useState<WaterSummary | null>(null);
  const [waterRecords, setWaterRecords] = useState<WaterRecord[]>([]);
  const [districts, setDistricts] = useState<DistrictCoverage[]>([]);
  const [reservoirs, setReservoirs] = useState<ReservoirRecord[]>([]);
  const [emergencyRequests, setEmergencyRequests] = useState<EmergencyRequest[]>([]);
  const [maintenanceTasks, setMaintenanceTasks] = useState<MaintenanceTask[]>([]);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus | null>(null);
  const [datasets, setDatasets] = useState<UploadedDataset[]>([]);
  const [dataSourceStatus, setDataSourceStatus] = useState<Record<string, string> | null>(null);
  const [publicCatalogue, setPublicCatalogue] = useState<PublicDatasetInfo[]>([]);
  const [publicWater, setPublicWater] = useState<PublicWaterResponse | null>(null);
  const [liveWeather, setLiveWeather] = useState<LiveWeatherResponse | null>(null);
  const [liveMaintenanceFeeds, setLiveMaintenanceFeeds] =
    useState<LiveMaintenanceFeedsResponse | null>(null);
  const [avgRainfallMm, setAvgRainfallMm] = useState<number | null>(null);

  const [selectedTrackingId, setSelectedTrackingId] = useState<number | null>(null);

  const loadCoreData = useCallback(async () => {
    try {
      const [
        summaryRes,
        waterRes,
        districtsRes,
        reservoirsRes,
        emergencyRes,
        maintenanceRes,
        clusterRes,
        datasetsRes,
        statusRes,
      ] = await Promise.all([
        fetch('/api/summary').then((r) => r.json()),
        fetch('/api/water-data').then((r) => r.json()),
        fetch('/api/karnataka-districts').then((r) => r.json()),
        fetch('/api/reservoirs').then((r) => r.json()),
        fetch('/api/emergency-requests').then((r) => r.json()),
        fetch('/api/maintenance/tasks').then((r) => r.json()),
        fetch('/api/cluster/status').then((r) => r.json()),
        fetch('/api/datasets').then((r) => r.json()),
        fetch('/api/live-data-status').then((r) => r.json()),
      ]);

      setSummary(summaryRes);
      setWaterRecords(Array.isArray(waterRes) ? waterRes : []);
      setDistricts(Array.isArray(districtsRes) ? districtsRes : []);
      setReservoirs(Array.isArray(reservoirsRes) ? reservoirsRes : []);
      setEmergencyRequests(Array.isArray(emergencyRes) ? emergencyRes : []);
      setMaintenanceTasks(Array.isArray(maintenanceRes) ? maintenanceRes : []);
      setClusterStatus(clusterRes);
      setDatasets(Array.isArray(datasetsRes) ? datasetsRes : []);
      setDataSourceStatus(statusRes);
    } catch {
      // handled gracefully via empty states
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExternalFeeds = useCallback(async (force = false) => {
    try {
      const qs = force ? '?refresh=true' : '';
      const [catalogueRes, weatherRes, liveFeedsRes] = await Promise.all([
        fetch('/api/public-data-catalogue').then((r) => r.json()),
        fetch(`/api/live-weather${qs}`).then((r) => r.json()),
        fetch(`/api/live-maintenance-feeds${qs}`).then((r) => r.json()),
      ]);
      if (catalogueRes?.datasets) setPublicCatalogue(catalogueRes.datasets);
      if (weatherRes?.success) {
        setLiveWeather(weatherRes);
        if (typeof weatherRes.average_rainfall_mm === 'number') {
          setAvgRainfallMm(weatherRes.average_rainfall_mm);
        }
      }
      if (liveFeedsRes?.success) {
        setLiveMaintenanceFeeds(liveFeedsRes);
        if (liveFeedsRes.nwdp?.success) {
          setPublicWater(liveFeedsRes.nwdp);
        }
      }
    } catch {
      // ignore non-blocking errors
    }
  }, []);

  const refreshPublicPortal = useCallback(async () => {
    try {
      const res = await fetch('/api/public-water-data?refresh=true');
      const data = await res.json();
      if (data?.success) setPublicWater(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCoreData();
    loadExternalFeeds();
  }, [loadCoreData, loadExternalFeeds]);

  const handleFullRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCoreData(), loadExternalFeeds(true)]);
    setRefreshing(false);
  };

  const handleDeleteWaterRecord = async (id: number) => {
    const res = await fetch(`/api/water-records/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadCoreData();
    }
  };

  const handleOpenTracking = (requestId: number) => {
    setSelectedTrackingId(requestId);
    setActiveTab('transport');
  };

  const handleEnterDashboard = () => {
    setEnteredDashboard(true);
    setActiveTab('overview');
  };

  const handleReturnLanding = () => {
    setEnteredDashboard(false);
    setMobileMenuOpen(false);
  };

  const districtsList = useMemo(
    () => districts.map((d) => d.district),
    [districts]
  );

  const activeNavMeta = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];

  const handleSelectTab = (tab: string) => {
    if (tab === 'mapreduce' || tab === 'cluster' || tab === 'bigdata') {
      setBigDataSubTab(tab);
      setActiveTab('mapreduce_hub');
    } else {
      setActiveTab(tab as TabId);
    }
    setMobileMenuOpen(false);
  };

  // Initial Landing Screen: Clean AquaAI Title Focus
  if (!enteredDashboard) {
    return (
      <div
        className="relative min-h-screen overflow-hidden flex items-center justify-center p-6"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, rgba(22, 119, 223, 0.12), transparent 38%), radial-gradient(circle at 80% 80%, rgba(24, 168, 120, 0.10), transparent 36%), linear-gradient(145deg, #f3f8ff 0%, #eaf4ff 52%, #f1fbf9 100%)',
        }}
      >
        {/* Subtle decorative concentric water rings */}
        <svg
          aria-hidden="true"
          viewBox="0 0 800 800"
          className="pointer-events-none absolute h-[760px] w-[760px] opacity-35"
        >
          <circle cx="400" cy="400" r="190" fill="none" stroke="#bfdbfe" strokeWidth="1" />
          <circle cx="400" cy="400" r="270" fill="none" stroke="#dbeafe" strokeWidth="1" />
          <circle cx="400" cy="400" r="350" fill="none" stroke="#e0f2fe" strokeWidth="1" />
        </svg>

        <div className="relative z-10 w-full max-w-lg rounded-3xl border border-white/90 bg-white/85 px-8 py-14 text-center shadow-[0_24px_70px_rgba(22,119,223,0.10)] backdrop-blur-md sm:px-14 sm:py-16">
          <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-xs">
            <Droplets className="h-10 w-10" />
          </div>

          <h1 className="font-display text-5xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Aqua<span className="text-blue-600">AI</span>
          </h1>

          <p className="mt-3 text-sm font-medium text-slate-500">
            Smart Water Resource Management
          </p>

          <div className="mt-9">
            <button
              type="button"
              onClick={handleEnterDashboard}
              className="inline-flex items-center gap-2.5 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 hover:-translate-y-0.5 whitespace-nowrap"
            >
              Explore Dashboard
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900 flex">
      {/* Mobile Left Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/25 sm:hidden"
        />
      )}

      {/* Left Navigation Panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 lg:w-64 shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 sm:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5">
          <button
            type="button"
            onClick={handleReturnLanding}
            className="flex items-center gap-3 text-left transition-opacity hover:opacity-80"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <span className="font-display text-lg font-bold tracking-tight text-slate-900">
                AquaAI
              </span>
              <p className="text-[11px] text-slate-500">Water Intelligence</p>
            </div>
          </button>
          <button
            type="button"
            aria-label="Close left navigation panel"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700 sm:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? 'text-blue-600' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 sm:pl-60 lg:pl-64 min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                aria-label="Toggle left navigation panel"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 sm:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 text-sm truncate">
                <span className="text-slate-500">AquaAI</span>
                <span className="text-slate-300">/</span>
                <span className="font-semibold text-slate-900 truncate">
                  {activeNavMeta.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleFullRefresh}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                Refresh Data
              </button>
            </div>
          </div>
        </header>

        {/* Viewport Container */}
        <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8">
          {activeTab === 'overview' && (
            <OverviewSection
              summary={summary}
              waterRecords={waterRecords}
              reservoirs={reservoirs}
              maintenanceTasks={maintenanceTasks}
              liveWeather={liveWeather}
              publicWater={publicWater}
              liveMaintenanceFeeds={liveMaintenanceFeeds}
              avgRainfallMm={avgRainfallMm}
              loading={loading}
              onNavigate={(tab) => handleSelectTab(tab as TabId)}
            />
          )}

          {activeTab === 'areas' && (
            <AreaManagementSection
              waterRecords={waterRecords}
              districts={districts}
              onRefreshData={loadCoreData}
              onDeleteRecord={handleDeleteWaterRecord}
            />
          )}

          {activeTab === 'reservoirs' && (
            <ReservoirsSection
              reservoirs={reservoirs}
              districtsList={districtsList}
              liveNwdpDams={liveMaintenanceFeeds?.nwdp_reservoirs || []}
              onRefreshReservoirs={loadCoreData}
            />
          )}

          {activeTab === 'forecast' && (
            <ShortageForecastSection
              districtsList={districtsList}
              onNavigate={(tab) => handleSelectTab(tab)}
            />
          )}

          {activeTab === 'emergency' && (
            <EmergencySection
              requests={emergencyRequests}
              districtsList={districtsList}
              onRefreshRequests={loadCoreData}
              onOpenTracking={handleOpenTracking}
            />
          )}

          {activeTab === 'transport' && (
            <TransportTrackingSection
              requests={emergencyRequests}
              districtsList={districtsList}
              selectedTrackingId={selectedTrackingId}
              onSelectTrackingId={setSelectedTrackingId}
              onRefreshRequests={loadCoreData}
            />
          )}

          {activeTab === 'maintenance' && (
            <MaintenanceSection
              tasks={maintenanceTasks}
              districtsList={districtsList}
              liveFeeds={liveMaintenanceFeeds}
              onRefreshTasks={loadCoreData}
              onRefreshLiveFeeds={loadExternalFeeds}
            />
          )}

          {activeTab === 'datasets' && (
            <DataManagementSection
              datasets={datasets}
              clusterStatus={clusterStatus}
              dataSourceStatus={dataSourceStatus}
              publicCatalogue={publicCatalogue}
              publicWater={publicWater}
              onRefreshPublic={refreshPublicPortal}
              onDatasetUploaded={loadCoreData}
            />
          )}

          {activeTab === 'mapreduce_hub' && (
            <div className="space-y-4">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
                {(
                  [
                    { id: 'mapreduce', label: 'MapReduce Engine' },
                    { id: 'cluster', label: 'Cluster Storage' },
                    { id: 'bigdata', label: 'Big Data Tools' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setBigDataSubTab(sub.id)}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      bigDataSubTab === sub.id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {bigDataSubTab === 'mapreduce' && (
                <MapReduceSection
                  districtsList={districtsList}
                  clusterStatus={clusterStatus}
                  onNavigateCluster={() => setBigDataSubTab('cluster')}
                />
              )}
              {bigDataSubTab === 'cluster' && (
                <ClusterStorageSection
                  cluster={clusterStatus}
                  onRefreshCluster={loadCoreData}
                />
              )}
              {bigDataSubTab === 'bigdata' && (
                <BigDataToolsSection
                  districtsList={districtsList}
                  onDataMutated={loadCoreData}
                />
              )}
            </div>
          )}

          <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500 sm:flex-row sm:items-center">
            <span>AquaAI · Water Resource Management &amp; Distributed Analytics</span>
            <span>Karnataka 31-District Grid · OpenStreetMap</span>
          </footer>
        </main>
      </div>

      <CriticalNotificationsSidebar
        reservoirs={reservoirs}
        maintenanceTasks={maintenanceTasks}
        onNavigate={handleSelectTab}
        onRefreshData={loadCoreData}
      />
    </div>
  );
}
