export interface WaterRecord {
  id: number;
  district: string;
  area: string;
  water_demand: number;
  water_supply: number;
  water_consumed: number | null;
  water_level: number;
  water_quality: string;
  recorded_at: string;
  uploaded_at: string;
  source_filename: string;
  block_id?: string;
  hdfs_node?: string;
}

export interface ReservoirRecord {
  id: number;
  reservoir_name: string;
  district: string;
  river: string;
  basin: string;
  monitoring_date: string;
  percentage_full: number;
  reservoir_level: number;
  design_capacity: number;
  gross_capacity: number;
  live_capacity: number;
  inflow: number;
  outflow: number;
  canal_withdrawal: number;
  evaporation: number;
  block_id?: string;
  hdfs_node?: string;
}

export type EmergencyStatus =
  | 'Pending'
  | 'Approved'
  | 'Completed'
  | 'Requested'
  | 'Assigned'
  | 'In Transit'
  | 'Delivered'
  | 'Cancelled';

export interface EmergencyRequest {
  id: number;
  district: string;
  area: string;
  emergency_type?: string;
  description?: string;
  requester_name: string;
  contact: string;
  required_quantity: number;
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  source_location: string;
  destination_location: string;
  status: EmergencyStatus;
  created_at: string;
  updated_at?: string;
  tanker_id?: string;
  distance_km?: number;
  duration_minutes?: number;
  route_geometry?: {
    type: string;
    coordinates: [number, number][];
  } | null;
  start_time?: number | null;
  block_id?: string;
  hdfs_node?: string;
}

export type TransportDeliveryStatus =
  | 'Scheduled'
  | 'Dispatched'
  | 'In Transit'
  | 'Delivered';

export interface TransportDelivery {
  id: number;
  tanker_id: string;
  vehicle_reg: string;
  driver_name: string;
  driver_phone: string;
  starting_location: string;
  destination_area: string;
  district: string;
  water_quantity_l: number;
  delivery_status: TransportDeliveryStatus;
  estimated_minutes: number;
  dispatched_at: string;
  delivered_at?: string | null;
  current_lat: number;
  current_lon: number;
  source_lat: number;
  source_lon: number;
  dest_lat: number;
  dest_lon: number;
  distance_km: number;
  emergency_request_id?: number | null;
  block_id?: string;
  hdfs_node?: string;
}

export interface TransportPythonTelemetry {
  id: number;
  tanker_id: string;
  driver_name: string;
  destination_area: string;
  delivery_status: string;
  water_quantity_l: number;
  distance_km: number;
  progress_pct: number;
  remaining_eta_min: number;
  avg_speed_kmh: number;
}

export interface TransportPythonReport {
  success: boolean;
  engine: string;
  duration_ms: number;
  db_path: string;
  sql_tables: {
    vehicles: number;
    tanker_deliveries: number;
    status_breakdown: Record<string, number>;
  };
  deliveries_synced: number;
  vehicles_synced: number;
  total_delivered_l: number;
  total_in_transit_l: number;
  avg_estimated_minutes: number;
  processed_telemetry: TransportPythonTelemetry[];
}

export type DatasetCategory =
  | 'Rainfall data'
  | 'Water consumption data'
  | 'Groundwater data'
  | 'Reservoir data'
  | 'Water distribution data';

export interface UploadedDataset {
  id: number;
  filename: string;
  category: DatasetCategory;
  uploaded_at: string;
  row_count: number;
  storage_status: string;
  size_bytes?: number;
  replication_factor?: number;
  collection_ref?: string;
  block_ids?: string[];
}

export interface DatasetStorageBlockDetail {
  blockId: string;
  collection: string;
  shardIndex: number;
  primaryNode: string;
  primaryNodeStatus: string;
  replicaNodes: string[];
  recordCount: number;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface DatasetStorageInfo {
  success: boolean;
  dataset: UploadedDataset;
  hadoop_framework: string;
  namenode: {
    cluster_name: string;
    replication_factor: number;
    block_size_records: number;
    storage_status: string;
    total_blocks: number;
    total_bytes: number;
  };
  blocks: DatasetStorageBlockDetail[];
}

export interface DatasetPythonPreprocessReport {
  success: boolean;
  engine: string;
  duration_ms: number;
  filename: string;
  category: string;
  raw_rows: number;
  cleaned_rows: number;
  duplicates_removed: number;
  missing_values_imputed: number;
  outliers_flagged: number;
  columns: Array<{ name: string; dtype: string; missing: number }>;
  numeric_stats: Array<{
    column: string;
    count: number;
    missing_imputed: number;
    min: number;
    mean: number;
    median: number;
    max: number;
    stdev: number;
    outliers: number;
  }>;
  cleaned_preview: Record<string, unknown>[];
  steps: string[];
}

export interface WaterSummary {
  total_areas: number;
  total_demand: number;
  total_supply: number;
  shortage: number;
  total_consumed: number | null;
  consumption_data_available: boolean;
  supply_percentage: number;
  computed_via?: string;
  job_duration_ms?: number;
}

export interface DistrictCoverage {
  district: string;
  has_measurements: boolean;
  data_status: string;
  record_count?: number;
}

export interface ClusterNode {
  id: string;
  name: string;
  region: string;
  host: string;
  status: 'online' | 'offline';
  blockCount: number;
  primaryBlocks: number;
  replicaBlocks: number;
  recordCount: number;
  storageBytes: number;
  lastHeartbeat: string;
}

export interface StorageBlockMeta {
  blockId: string;
  collection:
    | 'water_records'
    | 'reservoirs'
    | 'emergency_requests'
    | 'transport_deliveries'
    | 'dataset_files'
    | 'maintenance_tasks';
  shardIndex: number;
  primaryNode: string;
  replicaNodes: string[];
  recordCount: number;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface ClusterStatus {
  clusterName: string;
  replicationFactor: number;
  blockSizeRecords: number;
  totalBlocks: number;
  totalRecords: number;
  totalStorageBytes: number;
  healthyNodes: number;
  totalNodes: number;
  nodes: ClusterNode[];
  blocks: StorageBlockMeta[];
}

export interface MapSplitTrace {
  taskId?: string;
  blockId: string;
  nodeServed: string;
  usedReplicaFailover: boolean;
  inputRecords: number;
  emittedPairs: number;
  durationMs: number;
  status: 'completed' | 'unavailable';
  error?: string;
}

export interface ShufflePartitionTrace {
  partitionId: number;
  keyCount: number;
  totalValues: number;
  sampleKeys: string[];
}

export interface ReducerTaskTrace {
  taskId: string;
  partitionId: number;
  nodeAssigned: string;
  keysProcessed: number;
  valuesReduced: number;
  outputRecords: number;
  durationMs: number;
  status: 'completed' | 'failed';
}

export interface YarnApplicationTrace {
  applicationId: string;
  queue: string;
  amNode: string;
  state: 'FINISHED';
  finalStatus: 'SUCCEEDED' | 'DEGRADED';
  containersAllocated: number;
  allocatedMemoryMb: number;
  allocatedVCores: number;
}

export interface MapReduceAnalysisReport {
  title: string;
  executiveSummary: string;
  keyFindings: string[];
  highlights: Array<{ label: string; value: string }>;
}

export interface MapReduceJobTrace {
  jobId: string;
  jobType: string;
  label: string;
  startedAt: string;
  durationMs: number;
  inputSplits: number;
  recordsScanned: number;
  mapEmits: number;
  shuffleKeys: number;
  reduceOutputs: number;
  replicaFailovers: number;
  unavailableBlocks: number;
  numReducers: number;
  implementationEngine: 'python' | 'native';
  runtimeLabel: string;
  mapperStatus: {
    total: number;
    succeeded: number;
    failed: number;
    failoverCount: number;
    statusLabel: string;
  };
  reducerStatus: {
    total: number;
    succeeded: number;
    failed: number;
    statusLabel: string;
  };
  phaseTimings: {
    mapMs: number;
    shuffleMs: number;
    reduceMs: number;
  };
  hdfsInfo: {
    clusterName: string;
    collection: string;
    blocksRead: number;
    replicationFactor: number;
    bytesScanned: number;
  };
  yarnApp: YarnApplicationTrace;
  reducerTasks: ReducerTaskTrace[];
  mapPhase: MapSplitTrace[];
  shufflePhase: ShufflePartitionTrace[];
  results: Record<string, unknown>[];
  analysisReport: MapReduceAnalysisReport;
}

export interface YarnClusterStatus {
  resourceManager: {
    framework: string;
    status: string;
    scheduler: string;
    totalMemoryMb: number;
    totalVCores: number;
    activeNodeManagers: number;
    totalNodeManagers: number;
    totalApplications: number;
    succeededApplications: number;
    avgJobDurationMs: number;
    totalInputRecordsProcessed: number;
    totalOutputRecordsEmitted: number;
  };
  nodeManagers: Array<{
    nodeId: string;
    name: string;
    host: string;
    region: string;
    state: string;
    memoryTotalMb: number;
    vCoresTotal: number;
    containersExecuted: number;
  }>;
  recentApplications: Array<{
    applicationId: string;
    jobId: string;
    name: string;
    jobType: string;
    engine: string;
    state: string;
    finalStatus: string;
    containers: number;
    memoryMb: number;
    vCores: number;
    durationMs: number;
    startedAt: string;
  }>;
}

export interface RouteResult {
  success: boolean;
  source: { lat: number; lon: number; display_name: string };
  destination: { lat: number; lon: number; display_name: string };
  distance_km: number;
  duration_minutes: number;
  geometry: {
    type: string;
    coordinates: [number, number][];
  };
  message?: string;
}

export interface TrackingStatus {
  success: boolean;
  request_id: number;
  status: string;
  tanker_id: string | null;
  tracking_mode: string;
  progress_percentage: number;
  total_distance_km: number;
  remaining_distance_km: number;
  total_duration_minutes: number;
  remaining_minutes: number;
  current_position: { lat: number; lon: number } | null;
  geometry: {
    type: string;
    coordinates: [number, number][];
  } | null;
  source: string;
  destination: string;
}

export interface PublicDatasetInfo {
  key: string;
  name: string;
  title: string;
  frequency: string;
  description: string;
  source: string;
  page_url: string;
  dataset_url: string;
  refresh_seconds: number;
}

export interface PublicDatasetResult {
  key: string;
  title: string;
  dataset_name?: string;
  available: boolean;
  reachable?: boolean;
  record_count: number;
  display_record_count?: number;
  records: Record<string, unknown>[];
  observation_date: string | null;
  dataset_url: string;
  page_url: string;
  source: string;
  frequency?: string;
  message: string;
  error: string | null;
}

export interface PublicWaterResponse {
  success: boolean;
  source: string;
  source_url: string;
  checked_at: string;
  dataset_count: number;
  available_count: number;
  reachable_count?: number;
  datasets: Record<string, PublicDatasetResult>;
  note: string;
}

export interface LiveWeatherCity {
  city: string;
  district: string;
  weather: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    daily_avg_rainfall_mm?: number;
    weather_code?: number;
  } | null;
  maintenance_advisory: string;
  advisory_severity: 'Critical' | 'High' | 'Medium' | 'Normal';
  source: string;
}

export interface LiveWeatherResponse {
  success: boolean;
  fetched_at: string;
  average_rainfall_mm: number;
  avg_temperature_c: number | null;
  avg_humidity_pct: number | null;
  data: LiveWeatherCity[];
  note: string;
}

export type MaintenanceStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Deferred';
export type MaintenancePriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type MaintenanceAssetType =
  | 'Pipeline / Main'
  | 'Pumping Station'
  | 'Filtration / WTP'
  | 'Overhead Tank'
  | 'Reservoir Gate'
  | 'Borewell / Aquifer';
export type MaintenanceCategory =
  | 'Pipeline Leak Repair'
  | 'Pump Overhaul'
  | 'Water Quality & Chlorination'
  | 'Filter Media Flush'
  | 'Valve Replacement'
  | 'Reservoir Desilting';

export interface MaintenanceTask {
  id: number;
  task_code: string;
  district: string;
  area: string;
  asset_name: string;
  asset_type: MaintenanceAssetType;
  maintenance_type: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assigned_crew: string;
  scheduled_date: string;
  completed_at?: string | null;
  estimated_cost_inr: number;
  water_saved_lpd: number;
  telemetry_source: string;
  notes: string;
  created_at: string;
  updated_at?: string;
  block_id?: string;
  hdfs_node?: string;
}

export interface MaintenancePythonSummary {
  success: boolean;
  engine: string;
  db_path: string;
  synced_rows: number;
  total_tasks: number;
  open_critical: number;
  total_budget_inr: number;
  total_water_saved_lpd: number;
  status_breakdown: Record<string, number>;
  category_breakdown: Array<{
    maintenance_type: string;
    task_count: number;
    total_water_saved_lpd: number;
    total_cost_inr: number;
  }>;
  crew_workload: Array<{
    assigned_crew: string;
    assigned_count: number;
    completed_count: number;
    urgent_open: number;
  }>;
}

export interface LiveMaintenanceTrigger {
  trigger_id: string;
  source: string;
  district: string;
  area: string;
  asset_name: string;
  asset_type: MaintenanceAssetType;
  maintenance_type: MaintenanceCategory;
  priority: MaintenancePriority;
  water_saved_lpd: number;
  estimated_cost_inr: number;
  reason: string;
  observed_at: string;
}

export interface LiveNwdpReservoirSnapshot {
  reservoir_name: string;
  district: string;
  river: string;
  basin: string;
  monitoring_date: string;
  percentage_full: number;
  reservoir_level: number;
  design_capacity: number;
  gross_capacity: number;
  live_capacity: number;
  inflow: number;
  outflow: number;
  canal_withdrawal: number;
  evaporation: number;
}

export interface LiveMaintenanceFeedsResponse {
  success: boolean;
  checked_at: string;
  weather: LiveWeatherResponse;
  nwdp: PublicWaterResponse;
  nwdp_reservoirs: LiveNwdpReservoirSnapshot[];
  detected_alerts: LiveMaintenanceTrigger[];
}

export interface PythonAnalysisReport {
  success: boolean;
  engine: string;
  duration_ms: number;
  cluster_meta: {
    blocks_read: number;
    online_nodes: number;
    total_nodes: number;
    replication_factor: number;
  };
  records_analyzed: number;
  reservoirs_analyzed: number;
  mean_demand_l: number;
  mean_supply_l: number;
  mean_consumed_l: number;
  median_shortage_l: number;
  stdev_shortage_l: number;
  avg_reservoir_fill_pct: number;
  critical_deficit_count: number;
  top_alerts: Array<{
    district: string;
    area: string;
    coverage_pct: number;
    deficit_litres: number;
  }>;
  area_processing?: {
    unique_areas: number;
    shortage_areas_count: number;
    total_consumption_l: number;
    mean_area_shortage_l: number;
    outlier_threshold_l: number;
    outlier_areas: string[];
    rankings: Array<{
      district: string;
      area: string;
      water_demand_l: number;
      water_supply_l: number;
      water_consumed_l: number;
      shortage_l: number;
      coverage_pct: number;
      consumption_share_pct: number;
      severity_index: number;
      status: string;
    }>;
  };
  reservoir_analysis?: {
    unique_reservoirs: number;
    historical_observations: number;
    total_capacity_tmc: number;
    available_water_tmc: number;
    total_inflow_cusecs: number;
    total_outflow_cusecs: number;
    net_inflow_cusecs: number;
    mean_fill_pct: number;
    median_fill_pct: number;
    stdev_fill_pct: number;
    low_level_count: number;
    low_level_alerts: Array<{
      reservoir_name: string;
      district: string;
      percentage_full: number;
      available_tmc: number;
      capacity_tmc: number;
      net_inflow_cusecs: number;
      severity: string;
    }>;
    reservoir_stats: Array<{
      reservoir_name: string;
      district: string;
      river: string;
      capacity_tmc: number;
      available_tmc: number;
      current_fill_pct: number;
      avg_fill_pct: number;
      min_fill_pct: number;
      max_fill_pct: number;
      trend_delta_pct: number;
      net_inflow_cusecs: number;
      observations: number;
    }>;
  };
}

export interface HivePreset {
  id: string;
  title: string;
  description: string;
  query: string;
}

export interface HiveQueryResult {
  success: boolean;
  engine: string;
  table: string;
  query: string;
  durationMs: number;
  hdfsBlocksScanned: number;
  rowsScanned: number;
  rowsReturned: number;
  executionStages: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  error?: string;
}

export interface ForecastTimelinePoint {
  month: string;
  label: string;
  is_forecast: boolean;
  actual_demand_lpd: number | null;
  actual_supply_lpd: number | null;
  actual_consumed_lpd: number | null;
  actual_shortage_lpd: number | null;
  regression_demand_lpd: number;
  regression_supply_lpd: number;
  predicted_consumed_lpd?: number;
  predicted_shortage_lpd?: number;
}

export type ShortageRiskLevel =
  | 'Critical Shortage'
  | 'Moderate Deficit'
  | 'Watch'
  | 'Surplus / Safe';

export interface DistrictShortageForecast {
  district: string;
  observations: number;
  current_demand_lpd: number;
  current_supply_lpd: number;
  current_shortage_lpd: number;
  predicted_demand_lpd: number;
  predicted_supply_lpd: number;
  predicted_consumed_lpd: number;
  predicted_shortage_lpd: number;
  predicted_monthly_shortage_ml: number;
  predicted_coverage_pct: number;
  shortage_delta_lpd: number;
  demand_slope_lpd: number;
  supply_slope_lpd: number;
  gap_slope_lpd: number;
  r2_demand: number;
  r2_supply: number;
  rmse_demand_lpd: number;
  rmse_supply_lpd: number;
  risk_level: ShortageRiskLevel;
  trend_direction: 'Widening Deficit' | 'Improving' | 'Stable';
}

export interface ShortageForecastResponse {
  success: boolean;
  engine: string;
  duration_ms: number;
  generated_at: string;
  forecast_month: string;
  forecast_label: string;
  scope: string;
  selected_district: string;
  hdfs_metadata: {
    blocks_read: number;
    bytes_scanned: number;
    online_nodes: number;
    total_nodes: number;
    replication_factor: number;
    nodes_used: string[];
    history_months: number;
    window_start: string;
    window_end: string;
    water_records_scanned: number;
    usage_history_rows_scanned: number;
  };
  summary: {
    total_districts: number;
    at_risk_districts: number;
    critical_districts: number;
    total_predicted_shortage_lpd: number;
    total_predicted_monthly_shortage_ml: number;
    total_predicted_demand_lpd: number;
    total_predicted_supply_lpd: number;
    predicted_coverage_pct: number;
  };
  model: {
    algorithm: string;
    scope: string;
    demand_slope_lpd: number;
    demand_intercept_lpd: number;
    demand_r2: number;
    demand_rmse_lpd: number;
    supply_slope_lpd: number;
    supply_intercept_lpd: number;
    supply_r2: number;
    supply_rmse_lpd: number;
    predicted_demand_lpd: number;
    predicted_supply_lpd: number;
    predicted_consumed_lpd: number;
    predicted_shortage_lpd: number;
    predicted_monthly_shortage_ml: number;
  };
  timeline: ForecastTimelinePoint[];
  districts: DistrictShortageForecast[];
  message?: string;
}


