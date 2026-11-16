import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface WaterRecordEntity {
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
}

export interface ReservoirEntity {
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

export interface EmergencyRequestEntity {
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
}

export interface TransportDeliveryEntity {
  id: number;
  tanker_id: string;
  vehicle_reg: string;
  driver_name: string;
  driver_phone: string;
  starting_location: string;
  destination_area: string;
  district: string;
  water_quantity_l: number;
  delivery_status: 'Scheduled' | 'Dispatched' | 'In Transit' | 'Delivered';
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
}

export type DatasetCategory =
  | 'Rainfall data'
  | 'Water consumption data'
  | 'Groundwater data'
  | 'Reservoir data'
  | 'Water distribution data';

export interface DatasetFileRecordEntity {
  id: number;
  dataset_id: number;
  dataset_filename: string;
  category: DatasetCategory;
  district: string;
  station_or_area: string;
  observation_date: string;
  metric_primary: number;
  metric_secondary: number;
  unit: string;
  status_note: string;
  [key: string]: unknown;
}

export interface UploadedDatasetEntity {
  id: number;
  filename: string;
  filepath: string;
  category: DatasetCategory;
  uploaded_at: string;
  row_count: number;
  storage_status?: string;
  size_bytes?: number;
  replication_factor?: number;
  collection_ref?: StorageCollection;
  block_ids: string[];
}

export interface StorageNodeConfig {
  id: string;
  name: string;
  region: string;
  host: string;
  status: 'online' | 'offline';
  lastHeartbeat: string;
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

export interface MaintenanceTaskEntity {
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
}

export type StorageCollection =
  | 'water_records'
  | 'reservoirs'
  | 'emergency_requests'
  | 'transport_deliveries'
  | 'dataset_files'
  | 'maintenance_tasks';

export interface StorageBlockMeta {
  blockId: string;
  collection: StorageCollection;
  shardIndex: number;
  primaryNode: string;
  replicaNodes: string[];
  recordCount: number;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface ClusterManifest {
  clusterName: string;
  replicationFactor: number;
  blockSizeRecords: number;
  nextIds: {
    water_records: number;
    reservoirs: number;
    emergency_requests: number;
    uploaded_datasets: number;
    transport_deliveries?: number;
    dataset_files?: number;
    maintenance_tasks?: number;
  };
  nodes: StorageNodeConfig[];
  blocks: StorageBlockMeta[];
  allDistrictsSeeded?: boolean;
  multiAreaSeeded?: boolean;
  reservoirHistorySeeded?: boolean;
  emergencyHistorySeeded?: boolean;
  transportHistorySeeded?: boolean;
  datasetCatalogSeeded?: boolean;
  maintenanceHistorySeeded?: boolean;
  usageHistoryForecastSeeded?: boolean;
}

export const KARNATAKA_DISTRICTS = [
  'Bagalkot', 'Ballari', 'Belagavi', 'Bengaluru Rural',
  'Bengaluru Urban', 'Bidar', 'Chamarajanagar',
  'Chikkaballapur', 'Chikkamagaluru', 'Chitradurga',
  'Dakshina Kannada', 'Davanagere', 'Dharwad',
  'Gadag', 'Hassan', 'Haveri', 'Kalaburagi',
  'Kodagu', 'Kolar', 'Koppal', 'Mandya',
  'Mysuru', 'Raichur', 'Ramanagara', 'Shivamogga',
  'Tumakuru', 'Udupi', 'Uttara Kannada',
  'Vijayanagara', 'Vijayapura', 'Yadgir',
];

const DATA_ROOT = path.resolve(process.cwd(), 'data');
const CLUSTER_DIR = path.join(DATA_ROOT, 'cluster');
const META_DIR = path.join(DATA_ROOT, 'meta');
export const UPLOAD_DIR = path.join(DATA_ROOT, 'uploads');

const MANIFEST_FILE = path.join(META_DIR, 'cluster_manifest.json');
const EMERGENCY_FILE = path.join(META_DIR, 'emergency_requests.json');
const DATASETS_FILE = path.join(META_DIR, 'uploaded_datasets.json');
const TRANSPORT_FILE = path.join(META_DIR, 'transport_deliveries.json');
const MAINTENANCE_FILE = path.join(META_DIR, 'maintenance_tasks.json');

const DEFAULT_NODES: StorageNodeConfig[] = [
  {
    id: 'node-01',
    name: 'Bengaluru Primary',
    region: 'South-East Grid',
    host: '10.24.1.11:9001',
    status: 'online',
    lastHeartbeat: new Date().toISOString(),
  },
  {
    id: 'node-02',
    name: 'Mysuru Basin Node',
    region: 'Cauvery Grid',
    host: '10.24.1.12:9002',
    status: 'online',
    lastHeartbeat: new Date().toISOString(),
  },
  {
    id: 'node-03',
    name: 'Hubballi North Node',
    region: 'Malaprabha Grid',
    host: '10.24.1.13:9003',
    status: 'online',
    lastHeartbeat: new Date().toISOString(),
  },
  {
    id: 'node-04',
    name: 'Kalaburagi East Node',
    region: 'Krishna Grid',
    host: '10.24.1.14:9004',
    status: 'online',
    lastHeartbeat: new Date().toISOString(),
  },
];

function ensureDirs() {
  fs.mkdirSync(CLUSTER_DIR, { recursive: true });
  fs.mkdirSync(META_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  for (const node of DEFAULT_NODES) {
    fs.mkdirSync(path.join(CLUSTER_DIR, node.id), { recursive: true });
  }
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashPartitionIndex(key: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function createInitialSeedData() {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const isoDay = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * dayMs).toISOString();

  const waterRecords: WaterRecordEntity[] = [
    {
      id: 1,
      district: 'Bengaluru Urban',
      area: 'Yelahanka Zone',
      water_demand: 2450000,
      water_supply: 1980000,
      water_consumed: 1910000,
      water_level: 68,
      water_quality: 'Good',
      recorded_at: isoDay(0),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 2,
      district: 'Bengaluru Urban',
      area: 'Mahadevapura East',
      water_demand: 3100000,
      water_supply: 2150000,
      water_consumed: 2090000,
      water_level: 52,
      water_quality: 'Moderate TDS',
      recorded_at: isoDay(1),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 3,
      district: 'Mysuru',
      area: 'Hunsur Town',
      water_demand: 920000,
      water_supply: 890000,
      water_consumed: 845000,
      water_level: 84,
      water_quality: 'Good',
      recorded_at: isoDay(0),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 4,
      district: 'Mandya',
      area: 'Srirangapatna Ward',
      water_demand: 760000,
      water_supply: 785000,
      water_consumed: 710000,
      water_level: 88,
      water_quality: 'Good',
      recorded_at: isoDay(1),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 5,
      district: 'Kalaburagi',
      area: 'Aland Block',
      water_demand: 1420000,
      water_supply: 790000,
      water_consumed: 775000,
      water_level: 34,
      water_quality: 'Needs Testing',
      recorded_at: isoDay(0),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 6,
      district: 'Raichur',
      area: 'Sindhanur Cluster',
      water_demand: 1180000,
      water_supply: 680000,
      water_consumed: 660000,
      water_level: 39,
      water_quality: 'Hard Water',
      recorded_at: isoDay(2),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 7,
      district: 'Kolar',
      area: 'Mulbagal Rural',
      water_demand: 980000,
      water_supply: 510000,
      water_consumed: 498000,
      water_level: 28,
      water_quality: 'High Fluoride Alert',
      recorded_at: isoDay(0),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 8,
      district: 'Chikkaballapur',
      area: 'Gauribidanur',
      water_demand: 840000,
      water_supply: 495000,
      water_consumed: 482000,
      water_level: 31,
      water_quality: 'Needs Testing',
      recorded_at: isoDay(3),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 9,
      district: 'Belagavi',
      area: 'Gokak Basin',
      water_demand: 1560000,
      water_supply: 1490000,
      water_consumed: 1380000,
      water_level: 79,
      water_quality: 'Good',
      recorded_at: isoDay(1),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 10,
      district: 'Dharwad',
      area: 'Hubballi South',
      water_demand: 1640000,
      water_supply: 1320000,
      water_consumed: 1265000,
      water_level: 63,
      water_quality: 'Good',
      recorded_at: isoDay(2),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 11,
      district: 'Dakshina Kannada',
      area: 'Mangaluru Coastal',
      water_demand: 1480000,
      water_supply: 1520000,
      water_consumed: 1390000,
      water_level: 91,
      water_quality: 'Good',
      recorded_at: isoDay(0),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 12,
      district: 'Shivamogga',
      area: 'Bhadravathi Sector',
      water_demand: 1050000,
      water_supply: 1040000,
      water_consumed: 980000,
      water_level: 86,
      water_quality: 'Good',
      recorded_at: isoDay(4),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 13,
      district: 'Tumakuru',
      area: 'Sira Dry Belt',
      water_demand: 1120000,
      water_supply: 670000,
      water_consumed: 655000,
      water_level: 41,
      water_quality: 'Moderate TDS',
      recorded_at: isoDay(5),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 14,
      district: 'Vijayapura',
      area: 'Indi Sector',
      water_demand: 1290000,
      water_supply: 780000,
      water_consumed: 750000,
      water_level: 44,
      water_quality: 'Moderate TDS',
      recorded_at: isoDay(6),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 15,
      district: 'Ballari',
      area: 'Sandur Zone',
      water_demand: 1340000,
      water_supply: 940000,
      water_consumed: 910000,
      water_level: 54,
      water_quality: 'Moderate TDS',
      recorded_at: isoDay(10),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 16,
      district: 'Hassan',
      area: 'Arsikere Block',
      water_demand: 890000,
      water_supply: 810000,
      water_consumed: 770000,
      water_level: 74,
      water_quality: 'Good',
      recorded_at: isoDay(12),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 17,
      district: 'Bidar',
      area: 'Basavakalyan',
      water_demand: 960000,
      water_supply: 580000,
      water_consumed: 565000,
      water_level: 37,
      water_quality: 'Needs Testing',
      recorded_at: isoDay(15),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
    {
      id: 18,
      district: 'Kodagu',
      area: 'Madikeri Catchment',
      water_demand: 520000,
      water_supply: 610000,
      water_consumed: 490000,
      water_level: 94,
      water_quality: 'Good',
      recorded_at: isoDay(18),
      uploaded_at: isoDay(0),
      source_filename: 'karnataka_grid_baseline.csv',
    },
  ];

  const todayStr = now.toISOString().slice(0, 10);
  const reservoirs: ReservoirEntity[] = [
    {
      id: 1,
      reservoir_name: 'Krishna Raja Sagara (KRS)',
      district: 'Mandya',
      river: 'Cauvery',
      basin: 'Cauvery Basin',
      monitoring_date: todayStr,
      percentage_full: 74.6,
      reservoir_level: 118.4,
      design_capacity: 49.45,
      gross_capacity: 49.45,
      live_capacity: 36.88,
      inflow: 6820,
      outflow: 4350,
      canal_withdrawal: 2900,
      evaporation: 185,
    },
    {
      id: 2,
      reservoir_name: 'Almatti Dam (Lal Bahadur Shastri)',
      district: 'Vijayapura',
      river: 'Krishna',
      basin: 'Krishna Basin',
      monitoring_date: todayStr,
      percentage_full: 68.2,
      reservoir_level: 516.8,
      design_capacity: 123.08,
      gross_capacity: 123.08,
      live_capacity: 83.94,
      inflow: 11400,
      outflow: 7200,
      canal_withdrawal: 4100,
      evaporation: 320,
    },
    {
      id: 3,
      reservoir_name: 'Tungabhadra Reservoir',
      district: 'Vijayanagara',
      river: 'Tungabhadra',
      basin: 'Krishna Basin',
      monitoring_date: todayStr,
      percentage_full: 53.8,
      reservoir_level: 1621.2,
      design_capacity: 105.79,
      gross_capacity: 105.79,
      live_capacity: 56.91,
      inflow: 4890,
      outflow: 5120,
      canal_withdrawal: 3600,
      evaporation: 270,
    },
    {
      id: 4,
      reservoir_name: 'Kabini Reservoir',
      district: 'Mysuru',
      river: 'Kabini',
      basin: 'Cauvery Basin',
      monitoring_date: todayStr,
      percentage_full: 82.4,
      reservoir_level: 2279.6,
      design_capacity: 19.52,
      gross_capacity: 19.52,
      live_capacity: 16.08,
      inflow: 3420,
      outflow: 2150,
      canal_withdrawal: 1250,
      evaporation: 95,
    },
    {
      id: 5,
      reservoir_name: 'Linganamakki Dam',
      district: 'Shivamogga',
      river: 'Sharavathi',
      basin: 'West Flowing Rivers',
      monitoring_date: todayStr,
      percentage_full: 79.1,
      reservoir_level: 1811.4,
      design_capacity: 151.75,
      gross_capacity: 151.75,
      live_capacity: 120.03,
      inflow: 5900,
      outflow: 3480,
      canal_withdrawal: 420,
      evaporation: 210,
    },
    {
      id: 6,
      reservoir_name: 'Harangi Reservoir',
      district: 'Kodagu',
      river: 'Harangi',
      basin: 'Cauvery Basin',
      monitoring_date: todayStr,
      percentage_full: 86.5,
      reservoir_level: 2854.2,
      design_capacity: 8.5,
      gross_capacity: 8.5,
      live_capacity: 7.35,
      inflow: 1920,
      outflow: 1240,
      canal_withdrawal: 680,
      evaporation: 42,
    },
  ];

  const emergencyRequests: EmergencyRequestEntity[] = [
    {
      id: 1,
      district: 'Kolar',
      area: 'Mulbagal Rural Ward 4',
      emergency_type: 'No Water Supply',
      description: 'Municipal borewell and overhead tank dry for 48 hours; 320 households without drinking water.',
      requester_name: 'Ramesh Gowda',
      contact: '+91 98450 22190',
      required_quantity: 45000,
      priority: 'Critical',
      source_location: 'Bengaluru, Karnataka',
      destination_location: 'Mulbagal Ward 4, Kolar, Karnataka',
      status: 'Pending',
      created_at: isoDay(0),
    },
    {
      id: 2,
      district: 'Kalaburagi',
      area: 'Aland Block',
      emergency_type: 'Severe Water Scarcity',
      description: 'Low groundwater pressure in Aland Town Supply Point; hospital and school reserve depleted.',
      requester_name: 'Sharanabasava Patil',
      contact: '+91 94481 77412',
      required_quantity: 30000,
      priority: 'High',
      source_location: 'Kalaburagi, Karnataka',
      destination_location: 'Aland Town Supply Point, Kalaburagi, Karnataka',
      status: 'Approved',
      tanker_id: 'AQUA-T002',
      created_at: isoDay(1),
    },
  ];

  const uploadedDatasets: UploadedDatasetEntity[] = [
    {
      id: 1,
      filename: 'karnataka_grid_baseline.csv',
      filepath: '',
      category: 'Water consumption data',
      uploaded_at: isoDay(0),
      row_count: waterRecords.length,
      collection_ref: 'water_records',
      block_ids: [],
    },
  ];

  return { waterRecords, reservoirs, emergencyRequests, uploadedDatasets };
}

export class DistributedStorageEngine {
  private manifest!: ClusterManifest;

  constructor() {
    ensureDirs();
    if (!fs.existsSync(MANIFEST_FILE)) {
      this.bootstrapCluster();
    } else {
      this.loadManifest();
    }
  }

  private loadManifest() {
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf-8');
    this.manifest = JSON.parse(raw) as ClusterManifest;
    for (const node of this.manifest.nodes) {
      fs.mkdirSync(path.join(CLUSTER_DIR, node.id), { recursive: true });
    }
    if (!this.manifest.multiAreaSeeded) {
      this.ensureAllDistrictsSeeded();
    }
    if (!this.manifest.reservoirHistorySeeded) {
      this.ensureReservoirHistorySeeded();
    }
    if (!this.manifest.emergencyHistorySeeded) {
      this.ensureEmergencyHistorySeeded();
    }
    if (!this.manifest.transportHistorySeeded) {
      this.ensureTransportHistorySeeded();
    }
    if (!this.manifest.datasetCatalogSeeded) {
      this.ensureDatasetCatalogSeeded();
    }
    if (!this.manifest.maintenanceHistorySeeded) {
      this.ensureMaintenanceHistorySeeded();
    }
    if (!this.manifest.usageHistoryForecastSeeded) {
      this.ensureUsageHistoryForecastSeeded();
    }
  }

  private ensureMaintenanceHistorySeeded() {
    if (!this.manifest.nextIds.maintenance_tasks) {
      this.manifest.nextIds.maintenance_tasks = 1;
    }
    const existing = this.getMaintenanceTasks();
    if (existing.length > 0) {
      this.writeShardedCollection('maintenance_tasks', existing, true);
      this.manifest.maintenanceHistorySeeded = true;
      this.saveManifest();
      return;
    }

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const isoOffset = (daysDelta: number) =>
      new Date(now + daysDelta * dayMs).toISOString();
    const dateOffset = (daysDelta: number) => isoOffset(daysDelta).slice(0, 10);

    const seeds: Array<Omit<MaintenanceTaskEntity, 'id'>> = [
      {
        task_code: 'MNT-101',
        district: 'Bengaluru Urban',
        area: 'Mahadevapura East',
        asset_name: 'Mahadevapura 400mm DI Feeder Main',
        asset_type: 'Pipeline / Main',
        maintenance_type: 'Pipeline Leak Repair',
        priority: 'Critical',
        status: 'In Progress',
        assigned_crew: 'BWSSB Rapid Leak Unit A',
        scheduled_date: dateOffset(0),
        completed_at: null,
        estimated_cost_inr: 68500,
        water_saved_lpd: 145000,
        telemetry_source: 'HDFS Quality / Shortage Alert',
        notes: 'Pressure telemetry drop detected near ITPL junction; ultrasonic leak pinpointing active.',
        created_at: isoOffset(-1),
      },
      {
        task_code: 'MNT-102',
        district: 'Kolar',
        area: 'Mulbagal Rural',
        asset_name: 'Mulbagal RO & Fluoride Treatment Plant',
        asset_type: 'Filtration / WTP',
        maintenance_type: 'Water Quality & Chlorination',
        priority: 'Critical',
        status: 'Scheduled',
        assigned_crew: 'Kolar Water Quality Squad',
        scheduled_date: dateOffset(0),
        completed_at: null,
        estimated_cost_inr: 44000,
        water_saved_lpd: 85000,
        telemetry_source: 'HDFS Quality / Shortage Alert',
        notes: 'High fluoride alert in Mulbagal Rural distribution network; replace activated alumina cartridges.',
        created_at: isoOffset(-1),
      },
      {
        task_code: 'MNT-103',
        district: 'Vijayanagara',
        area: 'Tungabhadra Reservoir',
        asset_name: 'Tungabhadra Spillway Radial Gate #4',
        asset_type: 'Reservoir Gate',
        maintenance_type: 'Reservoir Desilting',
        priority: 'High',
        status: 'In Progress',
        assigned_crew: 'Tungabhadra Dam Hydro Engineers',
        scheduled_date: dateOffset(1),
        completed_at: null,
        estimated_cost_inr: 125000,
        water_saved_lpd: 310000,
        telemetry_source: 'NWDP Live Reservoir',
        notes: 'Reservoir level below 55% advisory; conducting intake silt clearance and rubber seal inspection.',
        created_at: isoOffset(-2),
      },
      {
        task_code: 'MNT-104',
        district: 'Kalaburagi',
        area: 'Aland Block',
        asset_name: 'Aland Booster Pump Station #2',
        asset_type: 'Pumping Station',
        maintenance_type: 'Pump Overhaul',
        priority: 'High',
        status: 'Scheduled',
        assigned_crew: 'North Karnataka Electromechanical Team',
        scheduled_date: dateOffset(1),
        completed_at: null,
        estimated_cost_inr: 52000,
        water_saved_lpd: 96000,
        telemetry_source: 'Live Open-Meteo Weather',
        notes: 'Dry weather & elevated ambient temp driving peak pumping load; bearing lubrication & VFD check.',
        created_at: isoOffset(-2),
      },
      {
        task_code: 'MNT-105',
        district: 'Bagalkot',
        area: 'Narayanpur D/s Station',
        asset_name: 'Krishna Basin Rapid Sand Filter Bay 3',
        asset_type: 'Filtration / WTP',
        maintenance_type: 'Filter Media Flush',
        priority: 'Medium',
        status: 'Scheduled',
        assigned_crew: 'Bagalkot Treatment Operations',
        scheduled_date: dateOffset(2),
        completed_at: null,
        estimated_cost_inr: 28000,
        water_saved_lpd: 62000,
        telemetry_source: 'NWDP Live Water Quality',
        notes: 'KSPCB water quality monitoring recorded 9 NTU turbidity; backwash cycle & alum dosing calibration.',
        created_at: isoOffset(-3),
      },
      {
        task_code: 'MNT-106',
        district: 'Raichur',
        area: 'Sindhanur Cluster',
        asset_name: 'Sindhanur Canal Crossing Sluice Valve',
        asset_type: 'Pipeline / Main',
        maintenance_type: 'Valve Replacement',
        priority: 'High',
        status: 'Completed',
        assigned_crew: 'Raichur Distribution Maintenance',
        scheduled_date: dateOffset(-2),
        completed_at: isoOffset(-1),
        estimated_cost_inr: 39500,
        water_saved_lpd: 112000,
        telemetry_source: 'Field Inspection',
        notes: 'Replaced fractured 250mm sluice valve and restored 100% downstream pressure.',
        created_at: isoOffset(-4),
      },
      {
        task_code: 'MNT-107',
        district: 'Chikkaballapur',
        area: 'Gauribidanur',
        asset_name: 'Gauribidanur Ward 3 Borewell Array',
        asset_type: 'Borewell / Aquifer',
        maintenance_type: 'Pump Overhaul',
        priority: 'Medium',
        status: 'Completed',
        assigned_crew: 'Chikkaballapur Borewell Unit',
        scheduled_date: dateOffset(-3),
        completed_at: isoOffset(-2),
        estimated_cost_inr: 31000,
        water_saved_lpd: 54000,
        telemetry_source: 'HDFS Quality / Shortage Alert',
        notes: 'Lowered submersible assembly by 12m and flushed silt screen.',
        created_at: isoOffset(-5),
      },
      {
        task_code: 'MNT-108',
        district: 'Mandya',
        area: 'Srirangapatna Ward',
        asset_name: 'Srirangapatna 500KL Overhead Tank',
        asset_type: 'Overhead Tank',
        maintenance_type: 'Water Quality & Chlorination',
        priority: 'Low',
        status: 'Completed',
        assigned_crew: 'Cauvery Sanitation Crew',
        scheduled_date: dateOffset(-5),
        completed_at: isoOffset(-4),
        estimated_cost_inr: 14500,
        water_saved_lpd: 25000,
        telemetry_source: 'Field Inspection',
        notes: 'Scheduled quarterly tank scouring, residual chlorine dosing, and hatch sealing complete.',
        created_at: isoOffset(-6),
      },
    ];

    const ids = this.allocateIds('maintenance_tasks', seeds.length);
    const records: MaintenanceTaskEntity[] = seeds.map((s, idx) => ({
      id: ids[idx],
      ...s,
    }));

    this.saveMaintenanceTasks(records);
    this.manifest.maintenanceHistorySeeded = true;
    this.saveManifest();
  }

  private ensureDatasetCatalogSeeded() {
    if (!this.manifest.nextIds.dataset_files) {
      this.manifest.nextIds.dataset_files = 1;
    }

    const existing = this.getUploadedDatasets().map((ds) => ({
      ...ds,
      category: ds.category || ('Water consumption data' as DatasetCategory),
      collection_ref: ds.collection_ref || ('water_records' as StorageCollection),
    }));

    const existingFilenames = new Set(existing.map((d) => d.filename.toLowerCase()));
    const dayMs = 24 * 60 * 60 * 1000;
    const isoDay = (daysAgo: number) =>
      new Date(Date.now() - daysAgo * dayMs).toISOString();
    const dateOnly = (daysAgo: number) => isoDay(daysAgo).slice(0, 10);

    // Ensure baseline consumption dataset reflects full seeded count
    const waterRecords = this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
    const waterBlocks = this.getBlocks('water_records');
    const baseline = existing.find(
      (d) => d.filename.toLowerCase() === 'karnataka_grid_baseline.csv'
    );
    if (baseline) {
      baseline.category = 'Water consumption data';
      baseline.row_count = waterRecords.filter(
        (r) => r.source_filename === 'karnataka_grid_baseline.csv'
      ).length || waterRecords.length;
      baseline.collection_ref = 'water_records';
      baseline.block_ids = waterBlocks.map((b) => b.blockId);
    }

    const datasetFileRows: DatasetFileRecordEntity[] = [];
    const newDatasets: UploadedDatasetEntity[] = [];

    // 1. Rainfall data
    if (!existingFilenames.has('karnataka_monsoon_rainfall_2026.csv')) {
      const dsId = this.allocateIds('uploaded_datasets', 1)[0];
      const rainfallSamples = [
        { district: 'Kodagu', station: 'Madikeri Gauge', mm: 184.6, anomaly: 14.2, note: 'Heavy Monsoon' },
        { district: 'Dakshina Kannada', station: 'Mangaluru Coastal', mm: 162.4, anomaly: 11.8, note: 'Surplus' },
        { district: 'Shivamogga', station: 'Agumbe Observatory', mm: 218.0, anomaly: 19.5, note: 'Very Heavy' },
        { district: 'Udupi', station: 'Kundapura Basin', mm: 151.2, anomaly: 8.4, note: 'Normal' },
        { district: 'Chikkamagaluru', station: 'Mudigere Catchment', mm: 138.5, anomaly: 6.1, note: 'Normal' },
        { district: 'Hassan', station: 'Sakleshpur Ridge', mm: 112.8, anomaly: 3.4, note: 'Moderate' },
        { district: 'Mysuru', station: 'Hunsur Station', mm: 54.2, anomaly: -4.1, note: 'Light Rain' },
        { district: 'Bengaluru Urban', station: 'Yelahanka AWS', mm: 48.6, anomaly: -6.3, note: 'Moderate' },
        { district: 'Kolar', station: 'Mulbagal Station', mm: 18.4, anomaly: -24.5, note: 'Rain Deficit' },
        { district: 'Chitradurga', station: 'Challakere Rain Gauge', mm: 12.1, anomaly: -31.2, note: 'Dry Spell' },
        { district: 'Kalaburagi', station: 'Aland Observatory', mm: 21.5, anomaly: -19.8, note: 'Deficit' },
        { district: 'Raichur', station: 'Sindhanur Station', mm: 26.8, anomaly: -15.4, note: 'Below Normal' },
      ];
      const rowIds = this.allocateIds('dataset_files', rainfallSamples.length);
      rainfallSamples.forEach((s, idx) => {
        datasetFileRows.push({
          id: rowIds[idx],
          dataset_id: dsId,
          dataset_filename: 'karnataka_monsoon_rainfall_2026.csv',
          category: 'Rainfall data',
          district: s.district,
          station_or_area: s.station,
          observation_date: dateOnly(idx % 5),
          metric_primary: s.mm,
          metric_secondary: s.anomaly,
          unit: 'mm',
          status_note: s.note,
          rainfall_mm: s.mm,
          departure_pct: s.anomaly,
        });
      });
      newDatasets.push({
        id: dsId,
        filename: 'karnataka_monsoon_rainfall_2026.csv',
        filepath: '',
        category: 'Rainfall data',
        uploaded_at: isoDay(1),
        row_count: rainfallSamples.length,
        collection_ref: 'dataset_files',
        block_ids: [],
      });
    }

    // 2. Groundwater data
    if (!existingFilenames.has('karnataka_groundwater_tables_2026.csv')) {
      const dsId = this.allocateIds('uploaded_datasets', 1)[0];
      const gwSamples = [
        { district: 'Kolar', station: 'Mulbagal Piezometer', depthM: 38.4, rechargePct: 24.0, note: 'Over-Exploited' },
        { district: 'Chikkaballapur', station: 'Bagepalli Well-09', depthM: 41.2, rechargePct: 21.5, note: 'Critical Depletion' },
        { district: 'Tumakuru', station: 'Pavagada Borewell', depthM: 34.8, rechargePct: 28.4, note: 'Critical' },
        { district: 'Bengaluru Rural', station: 'Hoskote Station', depthM: 29.6, rechargePct: 36.2, note: 'Semi-Critical' },
        { district: 'Bengaluru Urban', station: 'Whitefield Aquifer', depthM: 27.9, rechargePct: 39.0, note: 'Semi-Critical' },
        { district: 'Chitradurga', station: 'Hiriyur Aquifer', depthM: 26.5, rechargePct: 42.8, note: 'Moderate Stress' },
        { district: 'Kalaburagi', station: 'Aland Observation Well', depthM: 22.4, rechargePct: 48.0, note: 'Watch' },
        { district: 'Mandya', station: 'Maddur Canal Well', depthM: 8.6, rechargePct: 84.5, note: 'Safe Recharge' },
        { district: 'Mysuru', station: 'Nanjangud Basin', depthM: 10.2, rechargePct: 79.4, note: 'Safe' },
        { district: 'Belagavi', station: 'Gokak Aquifer', depthM: 11.8, rechargePct: 76.2, note: 'Safe' },
        { district: 'Dakshina Kannada', station: 'Bantwal Coastal Well', depthM: 6.4, rechargePct: 91.0, note: 'Healthy' },
        { district: 'Kodagu', station: 'Madikeri Foothills', depthM: 5.8, rechargePct: 94.2, note: 'Healthy' },
      ];
      const rowIds = this.allocateIds('dataset_files', gwSamples.length);
      gwSamples.forEach((s, idx) => {
        datasetFileRows.push({
          id: rowIds[idx],
          dataset_id: dsId,
          dataset_filename: 'karnataka_groundwater_tables_2026.csv',
          category: 'Groundwater data',
          district: s.district,
          station_or_area: s.station,
          observation_date: dateOnly(idx % 7),
          metric_primary: s.depthM,
          metric_secondary: s.rechargePct,
          unit: 'm bgl',
          status_note: s.note,
          water_table_depth_m: s.depthM,
          recharge_index_pct: s.rechargePct,
        });
      });
      newDatasets.push({
        id: dsId,
        filename: 'karnataka_groundwater_tables_2026.csv',
        filepath: '',
        category: 'Groundwater data',
        uploaded_at: isoDay(2),
        row_count: gwSamples.length,
        collection_ref: 'dataset_files',
        block_ids: [],
      });
    }

    // 3. Reservoir data
    if (!existingFilenames.has('karnataka_reservoir_levels_2026.csv')) {
      const dsId = this.allocateIds('uploaded_datasets', 1)[0];
      const resRows = this.readAllRecordsIgnoringOffline<ReservoirEntity>('reservoirs');
      const resBlocks = this.getBlocks('reservoirs');
      newDatasets.push({
        id: dsId,
        filename: 'karnataka_reservoir_levels_2026.csv',
        filepath: '',
        category: 'Reservoir data',
        uploaded_at: isoDay(3),
        row_count: resRows.length,
        collection_ref: 'reservoirs',
        block_ids: resBlocks.map((b) => b.blockId),
      });
    }

    // 4. Water distribution data
    if (!existingFilenames.has('karnataka_tanker_distribution_2026.csv')) {
      const dsId = this.allocateIds('uploaded_datasets', 1)[0];
      const trnRows = this.getTransportDeliveries();
      const trnBlocks = this.getBlocks('transport_deliveries');
      newDatasets.push({
        id: dsId,
        filename: 'karnataka_tanker_distribution_2026.csv',
        filepath: '',
        category: 'Water distribution data',
        uploaded_at: isoDay(1),
        row_count: trnRows.length,
        collection_ref: 'transport_deliveries',
        block_ids: trnBlocks.map((b) => b.blockId),
      });
    }

    if (datasetFileRows.length > 0) {
      const createdBlocks = this.appendRecordsToCollection('dataset_files', datasetFileRows);
      for (const ds of newDatasets) {
        if (ds.collection_ref === 'dataset_files') {
          const matchingBlockIds = new Set<string>();
          // Inspect newly created blocks for records belonging to this dataset
          for (const b of createdBlocks) {
            const inspected = this.readBlockWithFailover<DatasetFileRecordEntity>(b);
            if (inspected.records.some((r) => r.dataset_id === ds.id)) {
              matchingBlockIds.add(b.blockId);
            }
          }
          ds.block_ids = Array.from(matchingBlockIds);
        }
      }
    }

    const combined = [...newDatasets, ...existing];
    this.saveUploadedDatasets(combined);
    this.manifest.datasetCatalogSeeded = true;
    this.saveManifest();
  }

  private ensureUsageHistoryForecastSeeded() {
    if (!this.manifest.nextIds.dataset_files) {
      this.manifest.nextIds.dataset_files = 1;
    }
    const existing = this.getUploadedDatasets();
    const historyFilename = 'karnataka_monthly_water_usage_history_2026.csv';
    if (existing.some((d) => d.filename.toLowerCase() === historyFilename)) {
      this.manifest.usageHistoryForecastSeeded = true;
      this.saveManifest();
      return;
    }

    const allWater = this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
    const latestAreaMap = new Map<string, WaterRecordEntity>();
    for (const r of allWater) {
      const key = `${r.district.trim().toLowerCase()}::${(r.area || r.district).trim().toLowerCase()}`;
      const prev = latestAreaMap.get(key);
      if (!prev || r.id > prev.id) {
        latestAreaMap.set(key, r);
      }
    }

    const districtTotals = new Map<
      string,
      { demand: number; supply: number; consumed: number }
    >();
    for (const r of latestAreaMap.values()) {
      const dist = r.district.trim();
      const cur = districtTotals.get(dist) || { demand: 0, supply: 0, consumed: 0 };
      cur.demand += r.water_demand || 0;
      cur.supply += r.water_supply || 0;
      cur.consumed += r.water_consumed ?? Math.round((r.water_supply || 0) * 0.92);
      districtTotals.set(dist, cur);
    }

    const now = new Date();
    // Build 5 prior monthly dates anchored relative to current month (June..Oct 2026 when current is Nov 2026)
    const priorMonths: Array<{ obsDate: string; stepIndex: number }> = [];
    for (let offset = 5; offset >= 1; offset--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 15));
      priorMonths.push({
        obsDate: d.toISOString().slice(0, 10),
        stepIndex: 5 - offset, // 0..4 for 5 historical months before current month 5
      });
    }

    const dsId = this.allocateIds('uploaded_datasets', 1)[0];
    const rows: DatasetFileRecordEntity[] = [];
    const sortedDistricts = Array.from(districtTotals.keys()).sort((a, b) =>
      a.localeCompare(b)
    );

    const totalCount = sortedDistricts.length * priorMonths.length;
    const rowIds = this.allocateIds('dataset_files', totalCount);
    let cursor = 0;

    sortedDistricts.forEach((district, distIdx) => {
      const base = districtTotals.get(district)!;
      const coverage = base.demand > 0 ? base.supply / base.demand : 1;
      const isStressed = coverage < 0.92;
      const jitterSeed = ((distIdx * 17 + district.length * 7) % 11) - 5; // deterministic -5..+5

      priorMonths.forEach(({ obsDate, stepIndex }) => {
        // stepIndex goes 0 (5 months ago) -> 4 (1 month ago); current month is 5
        const monthsBack = 5 - stepIndex;
        // Demand rises smoothly toward current month in stressed urban/dry districts
        const demandTrendFactor = isStressed
          ? 1 - monthsBack * 0.024 + (jitterSeed * 0.002 * ((stepIndex % 2) - 0.5))
          : 1 - monthsBack * 0.008 + (jitterSeed * 0.0015 * ((stepIndex % 2) - 0.5));
        // Monsoon peak around 3-4 months ago (Jul-Aug), tapering post-monsoon into Nov
        const monsoonBump =
          stepIndex === 1 || stepIndex === 2 ? 0.065 : stepIndex === 3 ? 0.03 : 0.01;
        const supplyTrendFactor = isStressed
          ? 1 + monthsBack * 0.028 + monsoonBump
          : 1 + monthsBack * 0.006 + monsoonBump * 0.6;

        const demandLpd = Math.max(100000, Math.round(base.demand * demandTrendFactor));
        const supplyLpd = Math.max(100000, Math.round(base.supply * supplyTrendFactor));
        const consumedLpd = Math.min(
          supplyLpd,
          Math.round(supplyLpd * (isStressed ? 0.95 : 0.91))
        );

        rows.push({
          id: rowIds[cursor++],
          dataset_id: dsId,
          dataset_filename: historyFilename,
          category: 'Water consumption data',
          district,
          station_or_area: `${district} Aggregate Meter`,
          observation_date: obsDate,
          metric_primary: demandLpd,
          metric_secondary: supplyLpd,
          unit: 'L/day',
          status_note: supplyLpd < demandLpd ? 'Deficit Period' : 'Surplus Period',
          water_demand_lpd: demandLpd,
          water_supply_lpd: supplyLpd,
          water_consumed_lpd: consumedLpd,
        });
      });
    });

    const createdBlocks = this.appendRecordsToCollection('dataset_files', rows);
    const matchingBlockIds = new Set<string>();
    for (const b of createdBlocks) {
      const inspected = this.readBlockWithFailover<DatasetFileRecordEntity>(b);
      if (inspected.records.some((r) => r.dataset_id === dsId)) {
        matchingBlockIds.add(b.blockId);
      }
    }

    const newDataset: UploadedDatasetEntity = {
      id: dsId,
      filename: historyFilename,
      filepath: '',
      category: 'Water consumption data',
      uploaded_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      row_count: rows.length,
      collection_ref: 'dataset_files',
      block_ids: Array.from(matchingBlockIds),
    };

    this.saveUploadedDatasets([newDataset, ...existing]);
    this.manifest.usageHistoryForecastSeeded = true;
    this.saveManifest();
  }

  private ensureTransportHistorySeeded() {
    if (!this.manifest.nextIds.transport_deliveries) {
      this.manifest.nextIds.transport_deliveries = 1;
    }
    const existing = this.getTransportDeliveries();
    if (existing.length > 0) {
      this.writeShardedCollection('transport_deliveries', existing, true);
      this.manifest.transportHistorySeeded = true;
      this.saveManifest();
      return;
    }

    const now = Date.now();
    const minMs = 60 * 1000;
    const hourMs = 60 * minMs;
    const tsAgo = (hours: number, mins = 0) =>
      new Date(now - hours * hourMs - mins * minMs).toISOString();

    const seeds: Array<Omit<TransportDeliveryEntity, 'id'>> = [
      {
        tanker_id: 'AQUA-T001',
        vehicle_reg: 'KA-01-G-4412',
        driver_name: 'Mahesh Gowda',
        driver_phone: '+91 98451 11204',
        starting_location: 'Yelahanka Depot, Bengaluru',
        destination_area: 'Mulbagal Rural Ward 4',
        district: 'Kolar',
        water_quantity_l: 25000,
        delivery_status: 'In Transit',
        estimated_minutes: 95,
        dispatched_at: tsAgo(0, 42),
        delivered_at: null,
        source_lat: 13.1007,
        source_lon: 77.5963,
        current_lat: 13.135,
        current_lon: 78.021,
        dest_lat: 13.1636,
        dest_lon: 78.3936,
        distance_km: 88.4,
        emergency_request_id: 1,
      },
      {
        tanker_id: 'AQUA-T002',
        vehicle_reg: 'KA-32-G-1908',
        driver_name: 'Sharanappa Biradar',
        driver_phone: '+91 94480 55319',
        starting_location: 'Kalaburagi Central Tank',
        destination_area: 'Aland Block',
        district: 'Kalaburagi',
        water_quantity_l: 30000,
        delivery_status: 'In Transit',
        estimated_minutes: 62,
        dispatched_at: tsAgo(0, 28),
        delivered_at: null,
        source_lat: 17.3297,
        source_lon: 76.8343,
        current_lat: 17.448,
        current_lon: 76.701,
        dest_lat: 17.5644,
        dest_lon: 76.5685,
        distance_km: 41.2,
        emergency_request_id: 2,
      },
      {
        tanker_id: 'AQUA-T004',
        vehicle_reg: 'KA-06-G-7821',
        driver_name: 'Prakash Naik',
        driver_phone: '+91 98804 29410',
        starting_location: 'Tumakuru Depot',
        destination_area: 'Pavagada Arid Zone',
        district: 'Tumakuru',
        water_quantity_l: 25000,
        delivery_status: 'Dispatched',
        estimated_minutes: 115,
        dispatched_at: tsAgo(0, 15),
        delivered_at: null,
        source_lat: 13.3379,
        source_lon: 77.1173,
        current_lat: 13.52,
        current_lon: 77.185,
        dest_lat: 14.1011,
        dest_lon: 77.2797,
        distance_km: 98.6,
        emergency_request_id: 4,
      },
      {
        tanker_id: 'AQUA-T005',
        vehicle_reg: 'KA-01-G-9134',
        driver_name: 'Venkatesh Murthy',
        driver_phone: '+91 99002 64811',
        starting_location: 'Rajajinagar Reservoir, Bengaluru',
        destination_area: 'Whitefield Corridor',
        district: 'Bengaluru Urban',
        water_quantity_l: 20000,
        delivery_status: 'In Transit',
        estimated_minutes: 48,
        dispatched_at: tsAgo(0, 22),
        delivered_at: null,
        source_lat: 12.9982,
        source_lon: 77.553,
        current_lat: 12.981,
        current_lon: 77.665,
        dest_lat: 12.9698,
        dest_lon: 77.75,
        distance_km: 24.8,
        emergency_request_id: 3,
      },
      {
        tanker_id: 'AQUA-T006',
        vehicle_reg: 'KA-36-G-5502',
        driver_name: 'Mallikarjun Reddy',
        driver_phone: '+91 94491 72014',
        starting_location: 'Raichur Water Treatment Plant',
        destination_area: 'Sindhanur Cluster',
        district: 'Raichur',
        water_quantity_l: 35000,
        delivery_status: 'Delivered',
        estimated_minutes: 85,
        dispatched_at: tsAgo(6, 0),
        delivered_at: tsAgo(4, 35),
        source_lat: 16.2076,
        source_lon: 77.3463,
        current_lat: 15.7746,
        current_lon: 76.7574,
        dest_lat: 15.7746,
        dest_lon: 76.7574,
        distance_km: 79.3,
        emergency_request_id: 6,
      },
      {
        tanker_id: 'AQUA-T007',
        vehicle_reg: 'KA-07-G-3318',
        driver_name: 'Srinivas Shetty',
        driver_phone: '+91 98458 19033',
        starting_location: 'Kolar Town Tank',
        destination_area: 'Mulbagal Rural Ward 4',
        district: 'Kolar',
        water_quantity_l: 30000,
        delivery_status: 'Delivered',
        estimated_minutes: 42,
        dispatched_at: tsAgo(14, 0),
        delivered_at: tsAgo(13, 18),
        source_lat: 13.1362,
        source_lon: 78.1291,
        current_lat: 13.1636,
        current_lon: 78.3936,
        dest_lat: 13.1636,
        dest_lon: 78.3936,
        distance_km: 30.5,
        emergency_request_id: 7,
      },
      {
        tanker_id: 'AQUA-T008',
        vehicle_reg: 'KA-09-G-6045',
        driver_name: 'Harish Kumar',
        driver_phone: '+91 97401 44890',
        starting_location: 'KRS Headworks, Mandya',
        destination_area: 'Mahadevapura East',
        district: 'Bengaluru Urban',
        water_quantity_l: 20000,
        delivery_status: 'Delivered',
        estimated_minutes: 145,
        dispatched_at: tsAgo(22, 0),
        delivered_at: tsAgo(19, 30),
        source_lat: 12.4255,
        source_lon: 76.5724,
        current_lat: 12.9915,
        current_lon: 77.6873,
        dest_lat: 12.9915,
        dest_lon: 77.6873,
        distance_km: 146.0,
        emergency_request_id: 8,
      },
    ];

    const ids = this.allocateIds('transport_deliveries', seeds.length);
    const records: TransportDeliveryEntity[] = seeds.map((s, idx) => ({
      id: ids[idx],
      ...s,
    }));

    this.saveTransportDeliveries(records);
    this.manifest.transportHistorySeeded = true;
    this.saveManifest();
  }

  private ensureEmergencyHistorySeeded() {
    const existing = this.getEmergencyRequests();
    const byId = new Map<number, EmergencyRequestEntity>();
    for (const item of existing) {
      // Backfill emergency_type & description on legacy items if missing
      const normalizedStatus =
        item.status === 'Requested'
          ? 'Pending'
          : item.status === 'Assigned'
          ? 'Approved'
          : item.status === 'Delivered'
          ? 'Completed'
          : item.status;
      byId.set(item.id, {
        ...item,
        emergency_type: item.emergency_type || 'No Water Supply',
        description:
          item.description ||
          `Area water deficit reported for ${item.area}, ${item.district}.`,
        status: normalizedStatus,
      });
    }

    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const tsAgo = (days: number, hours = 0) =>
      new Date(now - days * dayMs - hours * hourMs).toISOString();

    const extraSeeds: Array<Omit<EmergencyRequestEntity, 'id'>> = [
      {
        district: 'Bengaluru Urban',
        area: 'Whitefield Corridor',
        emergency_type: 'No Water Supply',
        description: 'Main feeder line shut for emergency valve repair; residential block without piped water.',
        requester_name: 'Kavitha Rao',
        contact: '+91 99001 45210',
        required_quantity: 40000,
        priority: 'Critical',
        source_location: 'Yelahanka Depot, Bengaluru',
        destination_location: 'Whitefield Main Rd, Bengaluru Urban, Karnataka',
        status: 'Pending',
        created_at: tsAgo(0, 3),
      },
      {
        district: 'Tumakuru',
        area: 'Pavagada Arid Zone',
        emergency_type: 'No Water Supply',
        description: 'Community storage sump empty; immediate drinking water tanker requested.',
        requester_name: 'Nagaraj M',
        contact: '+91 98802 61309',
        required_quantity: 50000,
        priority: 'Critical',
        source_location: 'Tumakuru Depot, Karnataka',
        destination_location: 'Pavagada Ward 2, Tumakuru, Karnataka',
        status: 'Approved',
        tanker_id: 'AQUA-T004',
        created_at: tsAgo(1, 5),
        updated_at: tsAgo(1, 2),
      },
      {
        district: 'Chikkaballapur',
        area: 'Bagepalli Rural',
        emergency_type: 'Contamination / Quality Alert',
        description: 'Elevated fluoride levels detected in local borewell; alternate potable supply needed.',
        requester_name: 'Lakshmi Devi',
        contact: '+91 97410 88234',
        required_quantity: 25000,
        priority: 'High',
        source_location: 'Chikkaballapur Water Plant',
        destination_location: 'Bagepalli Gram Panchayat, Chikkaballapur, Karnataka',
        status: 'Pending',
        created_at: tsAgo(2, 4),
      },
      {
        district: 'Raichur',
        area: 'Sindhanur Cluster',
        emergency_type: 'Pipeline Burst',
        description: 'Distribution pipe rupture near canal crossing causing severe pressure drop.',
        requester_name: 'Basavaraj K',
        contact: '+91 94495 31088',
        required_quantity: 35000,
        priority: 'High',
        source_location: 'Raichur, Karnataka',
        destination_location: 'Sindhanur Sector 3, Raichur, Karnataka',
        status: 'Completed',
        tanker_id: 'AQUA-T006',
        created_at: tsAgo(4, 6),
        updated_at: tsAgo(3, 18),
      },
      {
        district: 'Kolar',
        area: 'Mulbagal Rural Ward 4',
        emergency_type: 'No Water Supply',
        description: 'Previous week dry spell replenishment completed for school and primary clinic.',
        requester_name: 'Ramesh Gowda',
        contact: '+91 98450 22190',
        required_quantity: 30000,
        priority: 'Medium',
        source_location: 'Kolar Town Tank',
        destination_location: 'Mulbagal Primary Health Center, Kolar, Karnataka',
        status: 'Completed',
        tanker_id: 'AQUA-T007',
        created_at: tsAgo(6, 2),
        updated_at: tsAgo(5, 14),
      },
      {
        district: 'Bengaluru Urban',
        area: 'Mahadevapura East',
        emergency_type: 'Low Pressure / Scarcity',
        description: 'Tail-end apartments receiving less than 20 minutes of supply per day.',
        requester_name: 'Suresh Iyer',
        contact: '+91 98455 77102',
        required_quantity: 20000,
        priority: 'Medium',
        source_location: 'Rajajinagar Reservoir, Bengaluru',
        destination_location: 'Mahadevapura East, Bengaluru Urban, Karnataka',
        status: 'Completed',
        tanker_id: 'AQUA-T008',
        created_at: tsAgo(8, 4),
        updated_at: tsAgo(7, 20),
      },
    ];

    const existingKeys = new Set(
      Array.from(byId.values()).map(
        (r) =>
          `${r.district.toLowerCase()}::${r.area.toLowerCase()}::${(r.description || '').slice(0, 24).toLowerCase()}`
      )
    );

    const toInsert = extraSeeds.filter((s) => {
      const k = `${s.district.toLowerCase()}::${s.area.toLowerCase()}::${(s.description || '').slice(0, 24).toLowerCase()}`;
      return !existingKeys.has(k);
    });

    if (toInsert.length > 0) {
      const ids = this.allocateIds('emergency_requests', toInsert.length);
      toInsert.forEach((item, idx) => {
        byId.set(ids[idx], { id: ids[idx], ...item });
      });
    }

    const merged = Array.from(byId.values()).sort((a, b) => b.id - a.id);
    fs.writeFileSync(EMERGENCY_FILE, JSON.stringify(merged, null, 2));
    this.writeShardedCollection('emergency_requests', merged, true);
    this.manifest.emergencyHistorySeeded = true;
    this.saveManifest();
  }

  private ensureReservoirHistorySeeded() {
    const existing = this.readAllRecordsIgnoringOffline<ReservoirEntity>('reservoirs');
    const seen = new Set(
      existing.map(
        (r) =>
          `${r.reservoir_name.trim().toLowerCase()}::${String(r.monitoring_date || '').slice(0, 10)}`
      )
    );

    const dayMs = 24 * 60 * 60 * 1000;
    const now = new Date();
    const dateStr = (daysAgo: number) =>
      new Date(now.getTime() - daysAgo * dayMs).toISOString().slice(0, 10);

    // Fix Tungabhadra initial today reading if needed? Keep existing today entries untouched,
    // and ensure 8 major Karnataka reservoirs with 5 historical snapshots each (including low-level alerts < 55%)
    const reservoirBlueprints: Array<{
      reservoir_name: string;
      district: string;
      river: string;
      basin: string;
      design_capacity: number;
      gross_capacity: number;
      base_level: number;
      history: Array<{
        daysAgo: number;
        pct: number;
        inflow: number;
        outflow: number;
        canal: number;
        evap: number;
      }>;
    }> = [
      {
        reservoir_name: 'Krishna Raja Sagara (KRS)',
        district: 'Mandya',
        river: 'Cauvery',
        basin: 'Cauvery Basin',
        design_capacity: 49.45,
        gross_capacity: 49.45,
        base_level: 102,
        history: [
          { daysAgo: 28, pct: 64.2, inflow: 4210, outflow: 3890, canal: 2450, evap: 195 },
          { daysAgo: 21, pct: 66.8, inflow: 4850, outflow: 3920, canal: 2520, evap: 190 },
          { daysAgo: 14, pct: 69.5, inflow: 5410, outflow: 4100, canal: 2680, evap: 188 },
          { daysAgo: 7, pct: 72.1, inflow: 6180, outflow: 4280, canal: 2810, evap: 186 },
          { daysAgo: 0, pct: 74.6, inflow: 6820, outflow: 4350, canal: 2900, evap: 185 },
        ],
      },
      {
        reservoir_name: 'Almatti Dam (Lal Bahadur Shastri)',
        district: 'Vijayapura',
        river: 'Krishna',
        basin: 'Krishna Basin',
        design_capacity: 123.08,
        gross_capacity: 123.08,
        base_level: 505,
        history: [
          { daysAgo: 28, pct: 58.4, inflow: 7900, outflow: 6450, canal: 3650, evap: 340 },
          { daysAgo: 21, pct: 61.0, inflow: 8820, outflow: 6680, canal: 3800, evap: 335 },
          { daysAgo: 14, pct: 63.7, inflow: 9650, outflow: 6900, canal: 3920, evap: 328 },
          { daysAgo: 7, pct: 66.1, inflow: 10540, outflow: 7050, canal: 4010, evap: 324 },
          { daysAgo: 0, pct: 68.2, inflow: 11400, outflow: 7200, canal: 4100, evap: 320 },
        ],
      },
      {
        reservoir_name: 'Tungabhadra Reservoir',
        district: 'Vijayanagara',
        river: 'Tungabhadra',
        basin: 'Krishna Basin',
        design_capacity: 105.79,
        gross_capacity: 105.79,
        base_level: 1608,
        history: [
          { daysAgo: 28, pct: 55.6, inflow: 3920, outflow: 4680, canal: 3450, evap: 290 },
          { daysAgo: 21, pct: 52.4, inflow: 3650, outflow: 4820, canal: 3510, evap: 285 },
          { daysAgo: 14, pct: 49.1, inflow: 3380, outflow: 4950, canal: 3560, evap: 280 },
          { daysAgo: 7, pct: 45.8, inflow: 3120, outflow: 5040, canal: 3590, evap: 274 },
          { daysAgo: 3, pct: 43.9, inflow: 2980, outflow: 5100, canal: 3600, evap: 272 },
        ],
      },
      {
        reservoir_name: 'Kabini Reservoir',
        district: 'Mysuru',
        river: 'Kabini',
        basin: 'Cauvery Basin',
        design_capacity: 19.52,
        gross_capacity: 19.52,
        base_level: 2262,
        history: [
          { daysAgo: 28, pct: 75.2, inflow: 2680, outflow: 2040, canal: 1120, evap: 102 },
          { daysAgo: 21, pct: 77.1, inflow: 2890, outflow: 2080, canal: 1150, evap: 99 },
          { daysAgo: 14, pct: 79.0, inflow: 3110, outflow: 2110, canal: 1190, evap: 97 },
          { daysAgo: 7, pct: 80.8, inflow: 3290, outflow: 2130, canal: 1220, evap: 96 },
          { daysAgo: 0, pct: 82.4, inflow: 3420, outflow: 2150, canal: 1250, evap: 95 },
        ],
      },
      {
        reservoir_name: 'Linganamakki Dam',
        district: 'Shivamogga',
        river: 'Sharavathi',
        basin: 'West Flowing Rivers',
        design_capacity: 151.75,
        gross_capacity: 151.75,
        base_level: 1796,
        history: [
          { daysAgo: 28, pct: 70.4, inflow: 4600, outflow: 3250, canal: 380, evap: 225 },
          { daysAgo: 21, pct: 72.8, inflow: 4950, outflow: 3310, canal: 390, evap: 220 },
          { daysAgo: 14, pct: 75.1, inflow: 5320, outflow: 3380, canal: 400, evap: 216 },
          { daysAgo: 7, pct: 77.3, inflow: 5640, outflow: 3420, canal: 410, evap: 213 },
          { daysAgo: 0, pct: 79.1, inflow: 5900, outflow: 3480, canal: 420, evap: 210 },
        ],
      },
      {
        reservoir_name: 'Harangi Reservoir',
        district: 'Kodagu',
        river: 'Harangi',
        basin: 'Cauvery Basin',
        design_capacity: 8.5,
        gross_capacity: 8.5,
        base_level: 2839,
        history: [
          { daysAgo: 28, pct: 78.6, inflow: 1450, outflow: 1120, canal: 610, evap: 48 },
          { daysAgo: 21, pct: 80.9, inflow: 1590, outflow: 1160, canal: 630, evap: 46 },
          { daysAgo: 14, pct: 82.8, inflow: 1710, outflow: 1190, canal: 650, evap: 45 },
          { daysAgo: 7, pct: 84.7, inflow: 1840, outflow: 1220, canal: 665, evap: 43 },
          { daysAgo: 0, pct: 86.5, inflow: 1920, outflow: 1240, canal: 680, evap: 42 },
        ],
      },
      {
        reservoir_name: 'Narayanpur Dam (Basava Sagara)',
        district: 'Yadgir',
        river: 'Krishna',
        basin: 'Krishna Basin',
        design_capacity: 37.65,
        gross_capacity: 37.65,
        base_level: 484,
        history: [
          { daysAgo: 28, pct: 48.2, inflow: 2450, outflow: 3310, canal: 2150, evap: 210 },
          { daysAgo: 21, pct: 45.0, inflow: 2210, outflow: 3380, canal: 2200, evap: 215 },
          { daysAgo: 14, pct: 41.8, inflow: 1980, outflow: 3420, canal: 2240, evap: 220 },
          { daysAgo: 7, pct: 38.9, inflow: 1790, outflow: 3490, canal: 2280, evap: 225 },
          { daysAgo: 0, pct: 36.4, inflow: 1620, outflow: 3540, canal: 2310, evap: 230 },
        ],
      },
      {
        reservoir_name: 'Vanivilas Sagar (Mari Kanive)',
        district: 'Chitradurga',
        river: 'Vedavathi',
        basin: 'Krishna Basin',
        design_capacity: 30.42,
        gross_capacity: 30.42,
        base_level: 632,
        history: [
          { daysAgo: 28, pct: 52.1, inflow: 980, outflow: 1410, canal: 890, evap: 145 },
          { daysAgo: 21, pct: 50.4, inflow: 910, outflow: 1430, canal: 910, evap: 148 },
          { daysAgo: 14, pct: 48.9, inflow: 860, outflow: 1460, canal: 920, evap: 150 },
          { daysAgo: 7, pct: 47.4, inflow: 810, outflow: 1490, canal: 940, evap: 152 },
          { daysAgo: 0, pct: 46.2, inflow: 760, outflow: 1520, canal: 960, evap: 155 },
        ],
      },
    ];

    const toAppend: ReservoirEntity[] = [];
    for (const bp of reservoirBlueprints) {
      for (const h of bp.history) {
        const mDate = dateStr(h.daysAgo);
        const key = `${bp.reservoir_name.trim().toLowerCase()}::${mDate}`;
        if (seen.has(key)) continue;
        seen.add(key);
        toAppend.push({
          id: 0, // assigned below
          reservoir_name: bp.reservoir_name,
          district: bp.district,
          river: bp.river,
          basin: bp.basin,
          monitoring_date: mDate,
          percentage_full: h.pct,
          reservoir_level: Number((bp.base_level + h.pct * 0.22).toFixed(1)),
          design_capacity: bp.design_capacity,
          gross_capacity: bp.gross_capacity,
          live_capacity: Number(((bp.gross_capacity * h.pct) / 100).toFixed(2)),
          inflow: h.inflow,
          outflow: h.outflow,
          canal_withdrawal: h.canal,
          evaporation: h.evap,
        });
      }
    }

    if (toAppend.length > 0) {
      const ids = this.allocateIds('reservoirs', toAppend.length);
      toAppend.forEach((rec, idx) => {
        rec.id = ids[idx];
      });
      this.appendRecordsToCollection('reservoirs', toAppend);
    }

    this.manifest.reservoirHistorySeeded = true;
    this.saveManifest();
  }

  private ensureAllDistrictsSeeded() {
    const existing = this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
    const coveredAreaKeys = new Set(
      existing.map(
        (r) => `${r.district.trim().toLowerCase()}::${r.area.trim().toLowerCase()}`
      )
    );
    const nowIso = new Date().toISOString();

    const districtAreasCatalog: Record<
      string,
      Array<{
        area: string;
        demand: number;
        supply: number;
        consumed: number;
        level: number;
        quality: string;
      }>
    > = {
      Bagalkot: [
        { area: 'Jamkhandi Town', demand: 940000, supply: 690000, consumed: 665000, level: 48, quality: 'Moderate TDS' },
        { area: 'Bagalkot Navanagar', demand: 1120000, supply: 980000, consumed: 930000, level: 74, quality: 'Good' },
        { area: 'Mudhol Basin', demand: 880000, supply: 790000, consumed: 745000, level: 68, quality: 'Good' },
        { area: 'Badami Heritage Zone', demand: 760000, supply: 430000, consumed: 415000, level: 34, quality: 'Hard Water' },
      ],
      Ballari: [
        { area: 'Sandur Zone', demand: 1340000, supply: 940000, consumed: 910000, level: 54, quality: 'Moderate TDS' },
        { area: 'Ballari Urban Ward', demand: 1680000, supply: 1120000, consumed: 1080000, level: 49, quality: 'Moderate TDS' },
        { area: 'Siruguppa Canal', demand: 950000, supply: 910000, consumed: 860000, level: 82, quality: 'Good' },
        { area: 'Kurugodu Rural', demand: 820000, supply: 460000, consumed: 445000, level: 31, quality: 'Needs Testing' },
      ],
      Belagavi: [
        { area: 'Gokak Basin', demand: 1560000, supply: 1490000, consumed: 1380000, level: 79, quality: 'Good' },
        { area: 'Belagavi City North', demand: 2150000, supply: 1960000, consumed: 1880000, level: 76, quality: 'Good' },
        { area: 'Athani Dry Block', demand: 1240000, supply: 690000, consumed: 665000, level: 38, quality: 'Moderate TDS' },
        { area: 'Chikkodi Sector', demand: 1080000, supply: 940000, consumed: 895000, level: 72, quality: 'Good' },
        { area: 'Bailhongal Ward', demand: 910000, supply: 730000, consumed: 700000, level: 62, quality: 'Good' },
      ],
      'Bengaluru Rural': [
        { area: 'Devanahalli Block', demand: 1080000, supply: 740000, consumed: 715000, level: 46, quality: 'Good' },
        { area: 'Doddaballapura Industrial', demand: 1320000, supply: 760000, consumed: 735000, level: 41, quality: 'Moderate TDS' },
        { area: 'Hoskote East', demand: 1190000, supply: 680000, consumed: 655000, level: 36, quality: 'Hard Water' },
        { area: 'Nelamangala West', demand: 980000, supply: 820000, consumed: 785000, level: 66, quality: 'Good' },
      ],
      'Bengaluru Urban': [
        { area: 'Yelahanka Zone', demand: 2450000, supply: 1980000, consumed: 1910000, level: 68, quality: 'Good' },
        { area: 'Mahadevapura East', demand: 3100000, supply: 2150000, consumed: 2090000, level: 52, quality: 'Moderate TDS' },
        { area: 'Whitefield Corridor', demand: 2850000, supply: 1620000, consumed: 1580000, level: 42, quality: 'Hard Water' },
        { area: 'Bommanahalli South', demand: 2240000, supply: 1510000, consumed: 1465000, level: 49, quality: 'Moderate TDS' },
        { area: 'Rajajinagar West', demand: 1920000, supply: 1790000, consumed: 1690000, level: 79, quality: 'Good' },
        { area: 'Kengeri Satellite Town', demand: 1640000, supply: 1480000, consumed: 1410000, level: 74, quality: 'Good' },
      ],
      Bidar: [
        { area: 'Basavakalyan', demand: 960000, supply: 580000, consumed: 565000, level: 37, quality: 'Needs Testing' },
        { area: 'Bidar Old Town', demand: 1180000, supply: 890000, consumed: 845000, level: 61, quality: 'Good' },
        { area: 'Bhalki Block', demand: 870000, supply: 650000, consumed: 625000, level: 55, quality: 'Moderate TDS' },
        { area: 'Humnabad Sector', demand: 920000, supply: 510000, consumed: 495000, level: 33, quality: 'Hard Water' },
      ],
      Chamarajanagar: [
        { area: 'Kollegal Ward', demand: 780000, supply: 520000, consumed: 495000, level: 43, quality: 'Moderate TDS' },
        { area: 'Chamarajanagar Town', demand: 860000, supply: 690000, consumed: 655000, level: 63, quality: 'Good' },
        { area: 'Gundlupet Dry Zone', demand: 740000, supply: 410000, consumed: 398000, level: 30, quality: 'Needs Testing' },
        { area: 'Yelandur Basin', demand: 590000, supply: 565000, consumed: 530000, level: 81, quality: 'Good' },
      ],
      Chikkaballapur: [
        { area: 'Gauribidanur', demand: 840000, supply: 495000, consumed: 482000, level: 31, quality: 'Needs Testing' },
        { area: 'Chikkaballapur Town', demand: 1020000, supply: 610000, consumed: 590000, level: 39, quality: 'High Fluoride Alert' },
        { area: 'Chintamani Block', demand: 950000, supply: 530000, consumed: 515000, level: 35, quality: 'Hard Water' },
        { area: 'Bagepalli Rural', demand: 720000, supply: 380000, consumed: 368000, level: 27, quality: 'High Fluoride Alert' },
      ],
      Chikkamagaluru: [
        { area: 'Kadur Sector', demand: 720000, supply: 745000, consumed: 685000, level: 82, quality: 'Good' },
        { area: 'Chikkamagaluru Town', demand: 940000, supply: 920000, consumed: 860000, level: 88, quality: 'Good' },
        { area: 'Tarikere Block', demand: 780000, supply: 690000, consumed: 650000, level: 74, quality: 'Good' },
        { area: 'Mudigere Catchment', demand: 560000, supply: 610000, consumed: 535000, level: 93, quality: 'Good' },
      ],
      Chitradurga: [
        { area: 'Hiriyur Zone', demand: 990000, supply: 560000, consumed: 540000, level: 35, quality: 'Hard Water' },
        { area: 'Chitradurga Fort Ward', demand: 1180000, supply: 810000, consumed: 775000, level: 51, quality: 'Moderate TDS' },
        { area: 'Challakere Dry Belt', demand: 940000, supply: 490000, consumed: 475000, level: 29, quality: 'High Fluoride Alert' },
        { area: 'Hosadurga Block', demand: 760000, supply: 590000, consumed: 560000, level: 61, quality: 'Good' },
      ],
      'Dakshina Kannada': [
        { area: 'Mangaluru Coastal', demand: 1480000, supply: 1520000, consumed: 1390000, level: 91, quality: 'Good' },
        { area: 'Bantwal Block', demand: 890000, supply: 910000, consumed: 840000, level: 89, quality: 'Good' },
        { area: 'Puttur Town', demand: 820000, supply: 785000, consumed: 740000, level: 84, quality: 'Good' },
        { area: 'Belthangady Basin', demand: 670000, supply: 710000, consumed: 645000, level: 92, quality: 'Good' },
        { area: 'Sullia Sector', demand: 590000, supply: 560000, consumed: 525000, level: 85, quality: 'Good' },
      ],
      Davanagere: [
        { area: 'Harihar Block', demand: 1150000, supply: 980000, consumed: 920000, level: 71, quality: 'Good' },
        { area: 'Davanagere Vidyanagar', demand: 1460000, supply: 1290000, consumed: 1220000, level: 76, quality: 'Good' },
        { area: 'Channagiri Sector', demand: 880000, supply: 740000, consumed: 705000, level: 68, quality: 'Good' },
        { area: 'Jagalur Dry Zone', demand: 790000, supply: 440000, consumed: 425000, level: 33, quality: 'Moderate TDS' },
      ],
      Dharwad: [
        { area: 'Hubballi South', demand: 1640000, supply: 1320000, consumed: 1265000, level: 63, quality: 'Good' },
        { area: 'Dharwad Urban', demand: 1420000, supply: 1280000, consumed: 1210000, level: 75, quality: 'Good' },
        { area: 'Kalghatgi Block', demand: 740000, supply: 660000, consumed: 625000, level: 72, quality: 'Good' },
        { area: 'Kundgol Rural', demand: 830000, supply: 495000, consumed: 480000, level: 38, quality: 'Moderate TDS' },
      ],
      Gadag: [
        { area: 'Ron Dry Belt', demand: 860000, supply: 490000, consumed: 472000, level: 32, quality: 'Needs Testing' },
        { area: 'Gadag-Betageri Town', demand: 1140000, supply: 790000, consumed: 760000, level: 54, quality: 'Moderate TDS' },
        { area: 'Mundargi Sector', demand: 730000, supply: 430000, consumed: 415000, level: 34, quality: 'Hard Water' },
        { area: 'Nargund Basin', demand: 680000, supply: 590000, consumed: 555000, level: 69, quality: 'Good' },
      ],
      Hassan: [
        { area: 'Arsikere Block', demand: 890000, supply: 810000, consumed: 770000, level: 74, quality: 'Good' },
        { area: 'Hassan City Central', demand: 1120000, supply: 1060000, consumed: 995000, level: 83, quality: 'Good' },
        { area: 'Channarayapatna', demand: 840000, supply: 690000, consumed: 655000, level: 65, quality: 'Good' },
        { area: 'Sakleshpur Catchment', demand: 580000, supply: 640000, consumed: 555000, level: 94, quality: 'Good' },
      ],
      Haveri: [
        { area: 'Ranebennur Zone', demand: 890000, supply: 730000, consumed: 695000, level: 64, quality: 'Good' },
        { area: 'Haveri Town', demand: 940000, supply: 810000, consumed: 770000, level: 72, quality: 'Good' },
        { area: 'Byadgi Sector', demand: 690000, supply: 530000, consumed: 505000, level: 59, quality: 'Moderate TDS' },
        { area: 'Savanur Rural', demand: 740000, supply: 460000, consumed: 445000, level: 41, quality: 'Needs Testing' },
      ],
      Kalaburagi: [
        { area: 'Aland Block', demand: 1420000, supply: 790000, consumed: 775000, level: 34, quality: 'Needs Testing' },
        { area: 'Kalaburagi North', demand: 1850000, supply: 1320000, consumed: 1270000, level: 56, quality: 'Moderate TDS' },
        { area: 'Jewargi Sector', demand: 1080000, supply: 610000, consumed: 590000, level: 36, quality: 'Hard Water' },
        { area: 'Sedam Town', demand: 920000, supply: 790000, consumed: 750000, level: 71, quality: 'Good' },
      ],
      Kodagu: [
        { area: 'Madikeri Catchment', demand: 520000, supply: 610000, consumed: 490000, level: 94, quality: 'Good' },
        { area: 'Virajpet Block', demand: 480000, supply: 520000, consumed: 455000, level: 91, quality: 'Good' },
        { area: 'Kushalnagar Town', demand: 640000, supply: 615000, consumed: 580000, level: 86, quality: 'Good' },
        { area: 'Somwarpet Basin', demand: 460000, supply: 495000, consumed: 440000, level: 92, quality: 'Good' },
      ],
      Kolar: [
        { area: 'Mulbagal Rural', demand: 980000, supply: 510000, consumed: 498000, level: 28, quality: 'High Fluoride Alert' },
        { area: 'Kolar Town', demand: 1260000, supply: 740000, consumed: 715000, level: 38, quality: 'High Fluoride Alert' },
        { area: 'Bangarapet Block', demand: 940000, supply: 580000, consumed: 560000, level: 42, quality: 'Hard Water' },
        { area: 'Malur Industrial', demand: 1080000, supply: 690000, consumed: 665000, level: 47, quality: 'Moderate TDS' },
      ],
      Koppal: [
        { area: 'Gangavathi Ward', demand: 1020000, supply: 680000, consumed: 650000, level: 45, quality: 'Moderate TDS' },
        { area: 'Koppal Town', demand: 1140000, supply: 890000, consumed: 850000, level: 67, quality: 'Good' },
        { area: 'Kushtagi Dry Zone', demand: 860000, supply: 480000, consumed: 465000, level: 33, quality: 'Needs Testing' },
        { area: 'Yelburga Rural', demand: 750000, supply: 440000, consumed: 425000, level: 35, quality: 'Hard Water' },
      ],
      Mandya: [
        { area: 'Srirangapatna Ward', demand: 760000, supply: 785000, consumed: 710000, level: 88, quality: 'Good' },
        { area: 'Mandya City', demand: 1240000, supply: 1180000, consumed: 1110000, level: 84, quality: 'Good' },
        { area: 'Maddur Canal Zone', demand: 880000, supply: 860000, consumed: 810000, level: 82, quality: 'Good' },
        { area: 'Nagamangala Dry Belt', demand: 790000, supply: 510000, consumed: 490000, level: 46, quality: 'Moderate TDS' },
      ],
      Mysuru: [
        { area: 'Hunsur Town', demand: 920000, supply: 890000, consumed: 845000, level: 84, quality: 'Good' },
        { area: 'Mysuru City Central', demand: 1950000, supply: 1840000, consumed: 1740000, level: 81, quality: 'Good' },
        { area: 'Nanjangud Industrial', demand: 1140000, supply: 980000, consumed: 930000, level: 74, quality: 'Good' },
        { area: 'T. Narasipura Basin', demand: 820000, supply: 805000, consumed: 760000, level: 86, quality: 'Good' },
        { area: 'Periyapatna Block', demand: 740000, supply: 590000, consumed: 565000, level: 63, quality: 'Moderate TDS' },
      ],
      Raichur: [
        { area: 'Sindhanur Cluster', demand: 1180000, supply: 680000, consumed: 660000, level: 39, quality: 'Hard Water' },
        { area: 'Raichur City', demand: 1520000, supply: 1090000, consumed: 1040000, level: 55, quality: 'Moderate TDS' },
        { area: 'Manvi Canal Block', demand: 960000, supply: 810000, consumed: 770000, level: 70, quality: 'Good' },
        { area: 'Lingsugur Rural', demand: 990000, supply: 540000, consumed: 525000, level: 34, quality: 'Needs Testing' },
      ],
      Ramanagara: [
        { area: 'Channapatna Town', demand: 850000, supply: 720000, consumed: 685000, level: 67, quality: 'Good' },
        { area: 'Ramanagara Urban', demand: 960000, supply: 780000, consumed: 745000, level: 64, quality: 'Good' },
        { area: 'Kanakapura Basin', demand: 880000, supply: 830000, consumed: 785000, level: 79, quality: 'Good' },
        { area: 'Magadi Dry Block', demand: 790000, supply: 490000, consumed: 472000, level: 40, quality: 'Moderate TDS' },
      ],
      Shivamogga: [
        { area: 'Bhadravathi Sector', demand: 1050000, supply: 1040000, consumed: 980000, level: 86, quality: 'Good' },
        { area: 'Shivamogga City', demand: 1480000, supply: 1450000, consumed: 1360000, level: 89, quality: 'Good' },
        { area: 'Sagar Catchment', demand: 740000, supply: 780000, consumed: 710000, level: 93, quality: 'Good' },
        { area: 'Shikaripura Block', demand: 820000, supply: 690000, consumed: 655000, level: 71, quality: 'Good' },
      ],
      Tumakuru: [
        { area: 'Sira Dry Belt', demand: 1120000, supply: 670000, consumed: 655000, level: 41, quality: 'Moderate TDS' },
        { area: 'Tumakuru City', demand: 1620000, supply: 1290000, consumed: 1230000, level: 64, quality: 'Good' },
        { area: 'Tiptur Town', demand: 890000, supply: 710000, consumed: 680000, level: 62, quality: 'Good' },
        { area: 'Pavagada Arid Zone', demand: 940000, supply: 460000, consumed: 445000, level: 26, quality: 'High Fluoride Alert' },
      ],
      Udupi: [
        { area: 'Kundapura Coastal', demand: 880000, supply: 920000, consumed: 845000, level: 90, quality: 'Good' },
        { area: 'Udupi Manipal', demand: 1180000, supply: 1150000, consumed: 1080000, level: 88, quality: 'Good' },
        { area: 'Karkala Basin', demand: 720000, supply: 740000, consumed: 685000, level: 91, quality: 'Good' },
        { area: 'Kaup Block', demand: 640000, supply: 615000, consumed: 580000, level: 84, quality: 'Good' },
      ],
      'Uttara Kannada': [
        { area: 'Karwar Basin', demand: 790000, supply: 830000, consumed: 760000, level: 89, quality: 'Good' },
        { area: 'Sirsi Catchment', demand: 680000, supply: 720000, consumed: 655000, level: 93, quality: 'Good' },
        { area: 'Kumta Coastal', demand: 620000, supply: 590000, consumed: 555000, level: 82, quality: 'Good' },
        { area: 'Haliyal Block', demand: 710000, supply: 640000, consumed: 605000, level: 76, quality: 'Good' },
      ],
      Vijayanagara: [
        { area: 'Hosapete Sector', demand: 1120000, supply: 890000, consumed: 850000, level: 68, quality: 'Good' },
        { area: 'Hagaribommanahalli', demand: 840000, supply: 580000, consumed: 555000, level: 49, quality: 'Moderate TDS' },
        { area: 'Kudligi Dry Belt', demand: 890000, supply: 490000, consumed: 475000, level: 34, quality: 'Hard Water' },
        { area: 'Harapanahalli Ward', demand: 780000, supply: 630000, consumed: 600000, level: 61, quality: 'Good' },
      ],
      Vijayapura: [
        { area: 'Indi Sector', demand: 1290000, supply: 780000, consumed: 750000, level: 44, quality: 'Moderate TDS' },
        { area: 'Vijayapura City', demand: 1640000, supply: 1210000, consumed: 1160000, level: 58, quality: 'Moderate TDS' },
        { area: 'Sindagi Dry Block', demand: 1080000, supply: 590000, consumed: 570000, level: 35, quality: 'Needs Testing' },
        { area: 'Muddebihal Ward', demand: 860000, supply: 690000, consumed: 655000, level: 63, quality: 'Good' },
      ],
      Yadgir: [
        { area: 'Shahapur Block', demand: 950000, supply: 540000, consumed: 520000, level: 36, quality: 'Needs Testing' },
        { area: 'Yadgir Town', demand: 1080000, supply: 760000, consumed: 730000, level: 54, quality: 'Moderate TDS' },
        { area: 'Shorapur Basin', demand: 920000, supply: 790000, consumed: 750000, level: 70, quality: 'Good' },
        { area: 'Gurmitkal Rural', demand: 780000, supply: 430000, consumed: 415000, level: 31, quality: 'Hard Water' },
      ],
    };

    const missing: Array<{
      district: string;
      area: string;
      demand: number;
      supply: number;
      consumed: number;
      level: number;
      quality: string;
    }> = [];

    for (const [district, areas] of Object.entries(districtAreasCatalog)) {
      for (const item of areas) {
        const key = `${district.trim().toLowerCase()}::${item.area.trim().toLowerCase()}`;
        if (!coveredAreaKeys.has(key)) {
          missing.push({ district, ...item });
        }
      }
    }

    if (missing.length > 0) {
      const ids = this.allocateIds('water_records', missing.length);
      const toAppend: WaterRecordEntity[] = missing.map((item, idx) => ({
        id: ids[idx],
        district: item.district,
        area: item.area,
        water_demand: item.demand,
        water_supply: item.supply,
        water_consumed: item.consumed,
        water_level: item.level,
        water_quality: item.quality,
        recorded_at: nowIso,
        uploaded_at: nowIso,
        source_filename: 'karnataka_grid_baseline.csv',
      }));
      this.appendRecordsToCollection('water_records', toAppend);
    }

    this.manifest.allDistrictsSeeded = true;
    this.manifest.multiAreaSeeded = true;
    this.saveManifest();
  }

  private saveManifest() {
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(this.manifest, null, 2));
  }

  private bootstrapCluster() {
    const seed = createInitialSeedData();
    this.manifest = {
      clusterName: 'AquaAI-Karnataka-HDFS',
      replicationFactor: 2,
      blockSizeRecords: 6,
      nextIds: {
        water_records: seed.waterRecords.length + 1,
        reservoirs: seed.reservoirs.length + 1,
        emergency_requests: seed.emergencyRequests.length + 1,
        uploaded_datasets: seed.uploadedDatasets.length + 1,
        transport_deliveries: 1,
        dataset_files: 1,
        maintenance_tasks: 1,
      },
      nodes: DEFAULT_NODES.map((n) => ({ ...n })),
      blocks: [],
      allDistrictsSeeded: true,
      multiAreaSeeded: true,
      reservoirHistorySeeded: true,
      emergencyHistorySeeded: true,
      transportHistorySeeded: false,
      datasetCatalogSeeded: false,
      maintenanceHistorySeeded: false,
    };

    const waterBlocks = this.writeShardedCollection(
      'water_records',
      seed.waterRecords,
      false
    );
    this.writeShardedCollection('reservoirs', seed.reservoirs, false);

    seed.uploadedDatasets[0].block_ids = waterBlocks.map((b) => b.blockId);
    fs.writeFileSync(
      EMERGENCY_FILE,
      JSON.stringify(seed.emergencyRequests, null, 2)
    );
    fs.writeFileSync(
      DATASETS_FILE,
      JSON.stringify(seed.uploadedDatasets, null, 2)
    );
    this.saveManifest();
    this.ensureAllDistrictsSeeded();
    this.ensureReservoirHistorySeeded();
    this.ensureEmergencyHistorySeeded();
    this.ensureTransportHistorySeeded();
    this.ensureDatasetCatalogSeeded();
    this.ensureMaintenanceHistorySeeded();
    this.ensureUsageHistoryForecastSeeded();
  }

  private clearCollectionBlocks(collection: StorageCollection) {
    const remaining: StorageBlockMeta[] = [];
    for (const block of this.manifest.blocks) {
      if (block.collection === collection) {
        const allNodes = [block.primaryNode, ...block.replicaNodes];
        for (const nodeId of allNodes) {
          const blockPath = path.join(
            CLUSTER_DIR,
            nodeId,
            `${block.blockId}.json`
          );
          if (fs.existsSync(blockPath)) {
            fs.unlinkSync(blockPath);
          }
        }
      } else {
        remaining.push(block);
      }
    }
    this.manifest.blocks = remaining;
  }

  private writeBlockFiles(
    blockId: string,
    collection: StorageCollection,
    shardIndex: number,
    records: unknown[]
  ): StorageBlockMeta {
    const nodes = this.manifest.nodes;
    const rf = Math.min(this.manifest.replicationFactor, nodes.length);
    const startIdx = hashPartitionIndex(blockId, nodes.length);
    const assignedNodes: string[] = [];

    for (let offset = 0; offset < nodes.length && assignedNodes.length < rf; offset++) {
      const candidate = nodes[(startIdx + offset) % nodes.length];
      if (candidate.status === 'online') {
        assignedNodes.push(candidate.id);
      }
    }
    // Fallback to any node if too many are offline during write
    if (assignedNodes.length === 0) {
      assignedNodes.push(nodes[startIdx].id);
    }
    for (let offset = 0; offset < nodes.length && assignedNodes.length < rf; offset++) {
      const candidate = nodes[(startIdx + offset) % nodes.length];
      if (!assignedNodes.includes(candidate.id)) {
        assignedNodes.push(candidate.id);
      }
    }

    const payload = JSON.stringify({
      blockId,
      collection,
      shardIndex,
      createdAt: new Date().toISOString(),
      records,
    });
    const checksum = sha256(payload);
    const sizeBytes = Buffer.byteLength(payload, 'utf-8');

    for (const nodeId of assignedNodes) {
      const nodeDir = path.join(CLUSTER_DIR, nodeId);
      fs.mkdirSync(nodeDir, { recursive: true });
      fs.writeFileSync(path.join(nodeDir, `${blockId}.json`), payload);
    }

    return {
      blockId,
      collection,
      shardIndex,
      primaryNode: assignedNodes[0],
      replicaNodes: assignedNodes.slice(1),
      recordCount: records.length,
      sizeBytes,
      checksum,
      createdAt: new Date().toISOString(),
    };
  }

  public writeShardedCollection<T>(
    collection: StorageCollection,
    records: T[],
    replaceExisting = true
  ): StorageBlockMeta[] {
    if (replaceExisting) {
      this.clearCollectionBlocks(collection);
    }

    const chunkSize = this.manifest.blockSizeRecords;
    const prefix =
      collection === 'water_records'
        ? 'blk_wr'
        : collection === 'reservoirs'
        ? 'blk_res'
        : collection === 'transport_deliveries'
        ? 'blk_trn'
        : collection === 'dataset_files'
        ? 'blk_ds'
        : collection === 'maintenance_tasks'
        ? 'blk_mnt'
        : 'blk_emg';
    const createdBlocks: StorageBlockMeta[] = [];

    for (let i = 0; i < records.length; i += chunkSize) {
      const slice = records.slice(i, i + chunkSize);
      const shardIndex = Math.floor(i / chunkSize);
      const uniqueSuffix = crypto.randomBytes(3).toString('hex');
      const blockId = `${prefix}_${String(shardIndex).padStart(3, '0')}_${uniqueSuffix}`;
      const meta = this.writeBlockFiles(blockId, collection, shardIndex, slice);
      this.manifest.blocks.push(meta);
      createdBlocks.push(meta);
    }

    this.saveManifest();
    return createdBlocks;
  }

  public appendRecordsToCollection<T>(
    collection: StorageCollection,
    newRecords: T[]
  ): StorageBlockMeta[] {
    const chunkSize = this.manifest.blockSizeRecords;
    const existingCount = this.manifest.blocks.filter(
      (b) => b.collection === collection
    ).length;
    const prefix =
      collection === 'water_records'
        ? 'blk_wr'
        : collection === 'reservoirs'
        ? 'blk_res'
        : collection === 'transport_deliveries'
        ? 'blk_trn'
        : collection === 'dataset_files'
        ? 'blk_ds'
        : collection === 'maintenance_tasks'
        ? 'blk_mnt'
        : 'blk_emg';
    const createdBlocks: StorageBlockMeta[] = [];

    for (let i = 0; i < newRecords.length; i += chunkSize) {
      const slice = newRecords.slice(i, i + chunkSize);
      const shardIndex = existingCount + Math.floor(i / chunkSize);
      const uniqueSuffix = crypto.randomBytes(3).toString('hex');
      const blockId = `${prefix}_${String(shardIndex).padStart(3, '0')}_${uniqueSuffix}`;
      const meta = this.writeBlockFiles(blockId, collection, shardIndex, slice);
      this.manifest.blocks.push(meta);
      createdBlocks.push(meta);
    }

    this.saveManifest();
    return createdBlocks;
  }

  public readBlockWithFailover<T>(blockMeta: StorageBlockMeta): {
    records: T[];
    nodeServed: string;
    usedReplicaFailover: boolean;
    status: 'completed' | 'unavailable';
    error?: string;
  } {
    const nodeMap = new Map(this.manifest.nodes.map((n) => [n.id, n]));
    const candidates = [blockMeta.primaryNode, ...blockMeta.replicaNodes];

    for (let idx = 0; idx < candidates.length; idx++) {
      const nodeId = candidates[idx];
      const node = nodeMap.get(nodeId);
      if (!node || node.status !== 'online') {
        continue;
      }

      const filePath = path.join(CLUSTER_DIR, nodeId, `${blockMeta.blockId}.json`);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as { records: T[] };
        node.lastHeartbeat = new Date().toISOString();
        return {
          records: parsed.records || [],
          nodeServed: nodeId,
          usedReplicaFailover: idx > 0,
          status: 'completed',
        };
      } catch {
        continue;
      }
    }

    return {
      records: [],
      nodeServed: 'none',
      usedReplicaFailover: false,
      status: 'unavailable',
      error: `All replicas offline or unreachable (${candidates.join(', ')})`,
    };
  }

  public getBlocks(collection: StorageCollection): StorageBlockMeta[] {
    return this.manifest.blocks.filter((b) => b.collection === collection);
  }

  public readAllRecords<T>(collection: StorageCollection): T[] {
    const blocks = this.getBlocks(collection);
    const out: T[] = [];
    for (const block of blocks) {
      const res = this.readBlockWithFailover<T>(block);
      if (res.status === 'completed') {
        out.push(...res.records);
      }
    }
    return out;
  }

  public readAllRecordsWithBlocks<T extends object>(
    collection: StorageCollection
  ): Array<T & { block_id: string; hdfs_node: string }> {
    const blocks = this.getBlocks(collection);
    const out: Array<T & { block_id: string; hdfs_node: string }> = [];
    for (const block of blocks) {
      const res = this.readBlockWithFailover<T>(block);
      if (res.status === 'completed') {
        for (const rec of res.records) {
          out.push({
            ...rec,
            block_id: block.blockId,
            hdfs_node: res.nodeServed,
          });
        }
      }
    }
    return out;
  }

  public readAllRecordsIgnoringOffline<T>(
    collection: StorageCollection
  ): T[] {
    const blocks = this.getBlocks(collection);
    const out: T[] = [];
    for (const block of blocks) {
      const candidates = [block.primaryNode, ...block.replicaNodes];
      for (const nodeId of candidates) {
        const filePath = path.join(CLUSTER_DIR, nodeId, `${block.blockId}.json`);
        if (fs.existsSync(filePath)) {
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
            records: T[];
          };
          out.push(...(parsed.records || []));
          break;
        }
      }
    }
    return out;
  }

  public allocateIds(
    collection: keyof ClusterManifest['nextIds'],
    count = 1
  ): number[] {
    const ids: number[] = [];
    let current = this.manifest.nextIds[collection] ?? 1;
    for (let i = 0; i < count; i++) {
      ids.push(current++);
    }
    this.manifest.nextIds[collection] = current;
    this.saveManifest();
    return ids;
  }

  public deleteWaterRecord(recordId: number): boolean {
    const all = this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
    const filtered = all.filter((r) => r.id !== recordId);
    if (filtered.length === all.length) {
      return false;
    }
    this.writeShardedCollection('water_records', filtered, true);
    return true;
  }

  public toggleNodeStatus(nodeId: string): StorageNodeConfig | null {
    const node = this.manifest.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    node.status = node.status === 'online' ? 'offline' : 'online';
    node.lastHeartbeat = new Date().toISOString();
    this.saveManifest();
    return node;
  }

  public rebalanceCluster(replicationFactor?: number, blockSizeRecords?: number) {
    if (replicationFactor && replicationFactor >= 1 && replicationFactor <= 3) {
      this.manifest.replicationFactor = replicationFactor;
    }
    if (blockSizeRecords && blockSizeRecords >= 2 && blockSizeRecords <= 50) {
      this.manifest.blockSizeRecords = blockSizeRecords;
    }
    const allWater =
      this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
    const allReservoirs =
      this.readAllRecordsIgnoringOffline<ReservoirEntity>('reservoirs');
    const allEmergencies = this.getEmergencyRequests();
    const allDeliveries = this.getTransportDeliveries();
    const allDatasetFiles =
      this.readAllRecordsIgnoringOffline<DatasetFileRecordEntity>('dataset_files');
    const allMaintenance = this.getMaintenanceTasks();

    this.writeShardedCollection('water_records', allWater, true);
    this.writeShardedCollection('reservoirs', allReservoirs, true);
    this.writeShardedCollection('emergency_requests', allEmergencies, true);
    this.writeShardedCollection('transport_deliveries', allDeliveries, true);
    this.writeShardedCollection('dataset_files', allDatasetFiles, true);
    this.writeShardedCollection('maintenance_tasks', allMaintenance, true);
    this.saveManifest();
    return this.getClusterStatus();
  }

  public inspectBlock(blockId: string) {
    const meta = this.manifest.blocks.find((b) => b.blockId === blockId);
    if (!meta) return null;
    const read = this.readBlockWithFailover(meta);
    return {
      meta,
      readStatus: read.status,
      nodeServed: read.nodeServed,
      usedReplicaFailover: read.usedReplicaFailover,
      error: read.error,
      records: read.records,
    };
  }

  public getClusterStatus() {
    const nodeStats = this.manifest.nodes.map((node) => {
      let blockCount = 0;
      let primaryBlocks = 0;
      let replicaBlocks = 0;
      let recordCount = 0;
      let storageBytes = 0;

      for (const block of this.manifest.blocks) {
        const isPrimary = block.primaryNode === node.id;
        const isReplica = block.replicaNodes.includes(node.id);
        if (isPrimary || isReplica) {
          blockCount++;
          if (isPrimary) primaryBlocks++;
          if (isReplica) replicaBlocks++;
          recordCount += block.recordCount;
          storageBytes += block.sizeBytes;
        }
      }

      return {
        ...node,
        blockCount,
        primaryBlocks,
        replicaBlocks,
        recordCount,
        storageBytes,
      };
    });

    const totalRecords = this.manifest.blocks.reduce(
      (sum, b) => sum + b.recordCount,
      0
    );
    const totalStorageBytes = this.manifest.blocks.reduce(
      (sum, b) => sum + b.sizeBytes,
      0
    );

    return {
      clusterName: this.manifest.clusterName,
      replicationFactor: this.manifest.replicationFactor,
      blockSizeRecords: this.manifest.blockSizeRecords,
      totalBlocks: this.manifest.blocks.length,
      totalRecords,
      totalStorageBytes,
      healthyNodes: this.manifest.nodes.filter((n) => n.status === 'online')
        .length,
      totalNodes: this.manifest.nodes.length,
      nodes: nodeStats,
      blocks: this.manifest.blocks,
    };
  }

  // Emergency requests & datasets metadata helpers
  public getEmergencyRequests(): EmergencyRequestEntity[] {
    if (!fs.existsSync(EMERGENCY_FILE)) return [];
    const items = JSON.parse(
      fs.readFileSync(EMERGENCY_FILE, 'utf-8')
    ) as EmergencyRequestEntity[];
    return items.sort((a, b) => b.id - a.id);
  }

  public saveEmergencyRequests(items: EmergencyRequestEntity[]) {
    const sorted = [...items].sort((a, b) => b.id - a.id);
    fs.writeFileSync(EMERGENCY_FILE, JSON.stringify(sorted, null, 2));
    this.writeShardedCollection('emergency_requests', sorted, true);
  }

  public getTransportDeliveries(): TransportDeliveryEntity[] {
    if (!fs.existsSync(TRANSPORT_FILE)) return [];
    const items = JSON.parse(
      fs.readFileSync(TRANSPORT_FILE, 'utf-8')
    ) as TransportDeliveryEntity[];
    return items.sort((a, b) => b.id - a.id);
  }

  public saveTransportDeliveries(items: TransportDeliveryEntity[]) {
    const sorted = [...items].sort((a, b) => b.id - a.id);
    fs.writeFileSync(TRANSPORT_FILE, JSON.stringify(sorted, null, 2));
    this.writeShardedCollection('transport_deliveries', sorted, true);
  }

  public getMaintenanceTasks(): MaintenanceTaskEntity[] {
    if (!fs.existsSync(MAINTENANCE_FILE)) return [];
    const items = JSON.parse(
      fs.readFileSync(MAINTENANCE_FILE, 'utf-8')
    ) as MaintenanceTaskEntity[];
    return items.sort((a, b) => b.id - a.id);
  }

  public saveMaintenanceTasks(items: MaintenanceTaskEntity[]) {
    const sorted = [...items].sort((a, b) => b.id - a.id);
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(sorted, null, 2));
    this.writeShardedCollection('maintenance_tasks', sorted, true);
  }

  public getUploadedDatasets(): UploadedDatasetEntity[] {
    if (!fs.existsSync(DATASETS_FILE)) return [];
    const items = JSON.parse(
      fs.readFileSync(DATASETS_FILE, 'utf-8')
    ) as UploadedDatasetEntity[];
    return items.sort((a, b) => b.id - a.id);
  }

  public getEnrichedUploadedDatasets(): UploadedDatasetEntity[] {
    const items = this.getUploadedDatasets();
    const blockMap = new Map(this.manifest.blocks.map((b) => [b.blockId, b]));
    const onlineNodes = new Set(
      this.manifest.nodes.filter((n) => n.status === 'online').map((n) => n.id)
    );

    return items.map((ds) => {
      const col = ds.collection_ref || 'water_records';
      let blockIds = ds.block_ids && ds.block_ids.length > 0 ? ds.block_ids : [];
      if (col === 'water_records' && ds.filename === 'karnataka_grid_baseline.csv') {
        blockIds = this.getBlocks('water_records').map((b) => b.blockId);
      } else if (col === 'reservoirs') {
        blockIds = this.getBlocks('reservoirs').map((b) => b.blockId);
      } else if (col === 'transport_deliveries') {
        blockIds = this.getBlocks('transport_deliveries').map((b) => b.blockId);
      }

      const matchedBlocks = blockIds
        .map((bid) => blockMap.get(bid))
        .filter((b): b is StorageBlockMeta => Boolean(b));

      const sizeBytes = matchedBlocks.reduce((s, b) => s + b.sizeBytes, 0);
      const anyOfflinePrimary = matchedBlocks.some((b) => !onlineNodes.has(b.primaryNode));
      const allReplicasHealthy = matchedBlocks.every(
        (b) =>
          onlineNodes.has(b.primaryNode) &&
          b.replicaNodes.every((rn) => onlineNodes.has(rn))
      );

      const storageStatus =
        matchedBlocks.length === 0
          ? 'Pending Replication'
          : allReplicasHealthy
          ? `Replicated (RF=${this.manifest.replicationFactor})`
          : anyOfflinePrimary
          ? 'Failover Active (Replica)'
          : 'Degraded Replica';

      return {
        ...ds,
        category: ds.category || 'Water consumption data',
        collection_ref: col,
        block_ids: matchedBlocks.map((b) => b.blockId),
        size_bytes: sizeBytes,
        replication_factor: this.manifest.replicationFactor,
        storage_status: storageStatus,
      };
    });
  }

  public getDatasetRecords(datasetId: number): {
    dataset: UploadedDatasetEntity;
    records: Record<string, unknown>[];
  } | null {
    const datasets = this.getEnrichedUploadedDatasets();
    const ds = datasets.find((d) => d.id === datasetId);
    if (!ds) return null;

    const col = ds.collection_ref || 'water_records';
    let records: Record<string, unknown>[] = [];
    if (col === 'water_records') {
      const all = this.readAllRecordsWithBlocks<WaterRecordEntity>('water_records');
      const filtered = all.filter((r) => r.source_filename === ds.filename);
      records = (
        filtered.length === 0 && ds.filename === 'karnataka_grid_baseline.csv'
          ? all
          : filtered
      ) as unknown as Record<string, unknown>[];
    } else if (col === 'reservoirs') {
      records = this.readAllRecordsWithBlocks<ReservoirEntity>(
        'reservoirs'
      ) as unknown as Record<string, unknown>[];
    } else if (col === 'transport_deliveries') {
      records = this.readAllRecordsWithBlocks<TransportDeliveryEntity>(
        'transport_deliveries'
      ) as unknown as Record<string, unknown>[];
    } else if (col === 'dataset_files') {
      const all = this.readAllRecordsWithBlocks<DatasetFileRecordEntity>('dataset_files');
      records = all.filter(
        (r) => r.dataset_id === ds.id || r.dataset_filename === ds.filename
      );
    }

    return { dataset: ds, records };
  }

  public getDatasetStorageInfo(datasetId: number) {
    const datasets = this.getEnrichedUploadedDatasets();
    const ds = datasets.find((d) => d.id === datasetId);
    if (!ds) return null;

    const blockMap = new Map(this.manifest.blocks.map((b) => [b.blockId, b]));
    const nodeMap = new Map(this.manifest.nodes.map((n) => [n.id, n]));
    const blocks = (ds.block_ids || [])
      .map((id) => blockMap.get(id))
      .filter((b): b is StorageBlockMeta => Boolean(b))
      .map((b) => ({
        blockId: b.blockId,
        collection: b.collection,
        shardIndex: b.shardIndex,
        primaryNode: b.primaryNode,
        primaryNodeStatus: nodeMap.get(b.primaryNode)?.status || 'online',
        replicaNodes: b.replicaNodes,
        recordCount: b.recordCount,
        sizeBytes: b.sizeBytes,
        checksum: b.checksum,
        createdAt: b.createdAt,
      }));

    return {
      success: true,
      dataset: ds,
      hadoop_framework: 'Apache Hadoop HDFS (NameNode + Replicated DataNodes)',
      namenode: {
        cluster_name: this.manifest.clusterName,
        replication_factor: this.manifest.replicationFactor,
        block_size_records: this.manifest.blockSizeRecords,
        storage_status: ds.storage_status || `Replicated (RF=${this.manifest.replicationFactor})`,
        total_blocks: blocks.length,
        total_bytes: blocks.reduce((s, b) => s + b.sizeBytes, 0),
      },
      blocks,
    };
  }

  public deleteDataset(datasetId: number): boolean {
    const datasets = this.getUploadedDatasets();
    const target = datasets.find((d) => d.id === datasetId);
    if (!target) return false;

    const remaining = datasets.filter((d) => d.id !== datasetId);
    this.saveUploadedDatasets(remaining);

    if (target.filepath && fs.existsSync(target.filepath)) {
      try {
        fs.unlinkSync(target.filepath);
      } catch {
        // ignore cleanup error
      }
    }

    const col = target.collection_ref || 'water_records';
    if (col === 'dataset_files') {
      const allDsRecords =
        this.readAllRecordsIgnoringOffline<DatasetFileRecordEntity>('dataset_files');
      const filtered = allDsRecords.filter(
        (r) => r.dataset_id !== target.id && r.dataset_filename !== target.filename
      );
      this.writeShardedCollection('dataset_files', filtered, true);
    } else if (col === 'water_records' && target.filename !== 'karnataka_grid_baseline.csv') {
      const allWater =
        this.readAllRecordsIgnoringOffline<WaterRecordEntity>('water_records');
      const filtered = allWater.filter((r) => r.source_filename !== target.filename);
      if (filtered.length !== allWater.length) {
        this.writeShardedCollection('water_records', filtered, true);
      }
    }

    return true;
  }

  public saveUploadedDatasets(items: UploadedDatasetEntity[]) {
    fs.writeFileSync(DATASETS_FILE, JSON.stringify(items, null, 2));
  }
}

export const distributedStore = new DistributedStorageEngine();
