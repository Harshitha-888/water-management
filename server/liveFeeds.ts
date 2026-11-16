import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

export const NWDP_WEBSITE = 'https://nwdp.nwic.gov.in';
export const PUBLIC_CACHE_SECONDS = 900;

export interface GovernmentDatasetConfig {
  title: string;
  name: string;
  page: string;
  url: string;
  frequency: string;
  description: string;
}

export const GOVERNMENT_DATASETS: Record<string, GovernmentDatasetConfig> = {
  reservoir: {
    title: 'Karnataka Reservoir Observations',
    name: 'Reservoir Data (Manual Daily) Karnataka 1990-2026',
    page: 'https://nwdp.nwic.gov.in/dataset/reservoir-data-karnataka',
    url: 'https://nwdp.nwic.gov.in/dataset/e35dc28a-6f9c-486d-b598-87a21397018e/resource/26800982-045c-41de-821d-b1ca080a79a8/download/karnataka_man_reservoir_data.csv',
    frequency: 'Daily',
    description: 'Official Karnataka reservoir observations.',
  },
  rainfall: {
    title: 'Karnataka Rainfall Observations',
    name: 'Rainfall Manual Daily Karnataka 2026-2030',
    page: 'https://nwdp.nwic.gov.in/dataset/rainfall-manual-daily-karnataka',
    url: 'https://nwdp.nwic.gov.in/dataset/fde650de-0c37-4864-972d-6bfcfd5fb200/resource/3e875159-28ef-4196-af0e-fafb4540f280/download/karnataka_rainfall_data_2026_2030.csv',
    frequency: 'Daily',
    description: 'Official Karnataka rainfall observations.',
  },
  discharge: {
    title: 'Karnataka River Discharge',
    name: 'Discharge Gauge Manual Daily Karnataka 2021-2025',
    page: 'https://nwdp.nwic.gov.in/dataset/kwris-discharge-gauge-daily',
    url: 'https://nwdp.nwic.gov.in/dataset/f5b49998-6208-4627-b88f-4d3b75238d78/resource/d1bf65de-1010-47e5-beb6-23ff7ac82888/download/karnataka_discharge_gauge_daily_2021_2025.csv',
    frequency: 'Daily',
    description: 'Official river and stream discharge observations.',
  },
  groundwater: {
    title: 'Karnataka Groundwater Levels',
    name: 'Ground Water Level Manual Monthly Karnataka 2026-2030',
    page: 'https://nwdp.nwic.gov.in/dataset/ground-water-level-manual-daily-karnataka',
    url: 'https://nwdp.nwic.gov.in/dataset/1cbc78e5-42e2-4140-a584-ec752c994955/resource/4e393536-9a75-4ae8-a246-64a2530e16a9/download/karnataka_man_gw_wl_monthly_data_2026_2030.csv',
    frequency: 'Monthly',
    description: 'Official groundwater-level observations.',
  },
  water_quality: {
    title: 'Karnataka Water Quality',
    name: 'Water Quality Karnataka KSPCB 2005-2022',
    page: 'https://nwdp.nwic.gov.in/dataset/water-quality-manual-karnataka',
    url: 'https://nwdp.nwic.gov.in/dataset/ec1592da-829b-48b8-810e-b85538624a77/resource/ec197a09-d702-4657-9ad6-4c55b4fdedcc/download/water_quality_karnataka_2005_2022.csv',
    frequency: 'Historical observations',
    description: 'Official Karnataka water-quality observations.',
  },
};

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

const META_DIR = path.resolve(process.cwd(), 'data', 'meta');
const NWDP_CACHE_FILE = path.join(META_DIR, 'nwdp_live_cache.json');
const WEATHER_CACHE_FILE = path.join(META_DIR, 'weather_live_cache.json');

const publicMemoryCache = new Map<
  string,
  { cachedAt: number; data: PublicDatasetResult }
>();

let diskCacheHydrated = false;

function hydratePublicCacheFromDisk() {
  if (diskCacheHydrated) return;
  diskCacheHydrated = true;
  try {
    if (!fs.existsSync(NWDP_CACHE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(NWDP_CACHE_FILE, 'utf-8')) as Record<
      string,
      { cachedAt: number; data: PublicDatasetResult }
    >;
    for (const [k, entry] of Object.entries(raw)) {
      if (entry && entry.data) {
        publicMemoryCache.set(k, entry);
      }
    }
  } catch {
    // ignore corrupt disk cache
  }
}

function persistPublicCacheToDisk() {
  try {
    fs.mkdirSync(META_DIR, { recursive: true });
    const obj: Record<string, { cachedAt: number; data: PublicDatasetResult }> = {};
    for (const [k, v] of publicMemoryCache.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(NWDP_CACHE_FILE, JSON.stringify(obj));
  } catch {
    // ignore disk cache write errors
  }
}

/**
 * Fast CSV tail parser: avoids parsing 125,000+ rows through XLSX.read when we only need
 * the total record count and the latest 60 observations. Falls back to full XLSX parse
 * only if quoted multi-line headers are detected.
 */
function parseCsvTailFast(
  csvText: string,
  tailSize = 60,
  collectLatestPerFirstCol = false
): {
  totalRows: number;
  tailRows: Record<string, unknown>[];
} {
  const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Split cleanly respecting double quotes (handles multi-line headers like "Sub \nBasin")
  const logicalLines: string[] = [];
  let inQuotes = false;
  let lineStart = 0;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      const seg = normalized.slice(lineStart, i);
      if (seg.trim().length > 0) {
        logicalLines.push(seg);
      }
      lineStart = i + 1;
    }
  }
  if (lineStart < normalized.length) {
    const tailSeg = normalized.slice(lineStart);
    if (tailSeg.trim().length > 0) {
      logicalLines.push(tailSeg);
    }
  }

  if (logicalLines.length <= 1) {
    return { totalRows: 0, tailRows: [] };
  }

  const headerLine = logicalLines[0];
  const dataLineCount = logicalLines.length - 1;
  let sliceLines: string[];

  if (collectLatestPerFirstCol) {
    const latestByEntity = new Map<string, string>();
    for (let i = 1; i < logicalLines.length; i++) {
      const line = logicalLines[i];
      const commaIdx = line.indexOf(',');
      const key = (commaIdx > 0 ? line.slice(0, commaIdx) : line)
        .replace(/^"|"$/g, '')
        .trim();
      if (key) {
        latestByEntity.set(key, line);
      }
    }
    const entityLines = Array.from(latestByEntity.values());
    const recentTail = logicalLines.slice(Math.max(1, logicalLines.length - 30));
    const mergedSet = new Set<string>([...recentTail, ...entityLines]);
    sliceLines = Array.from(mergedSet);
  } else {
    sliceLines = logicalLines.slice(Math.max(1, logicalLines.length - tailSize));
  }

  const miniCsv = `${headerLine}\n${sliceLines.join('\n')}`;

  const workbook = XLSX.read(miniCsv, { type: 'string' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const tailRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  return {
    totalRows: dataLineCount,
    tailRows,
  };
}

export async function fetchPublicDataset(
  key: string,
  forceRefresh = false
): Promise<PublicDatasetResult> {
  hydratePublicCacheFromDisk();
  const cfg = GOVERNMENT_DATASETS[key];
  const now = Date.now() / 1000;
  const cached = publicMemoryCache.get(key);
  if (cached && !forceRefresh && now - cached.cachedAt < PUBLIC_CACHE_SECONDS) {
    return cached.data;
  }

  try {
    const response = await fetch(cfg.url, {
      headers: {
        'User-Agent': 'AquaAI-Water-Monitor/1.0',
        Accept: 'text/csv,text/plain,*/*',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error('Upstream returned HTML instead of CSV');
    }

    const csvText = await response.text();
    const { totalRows, tailRows } = parseCsvTailFast(
      csvText,
      60,
      key === 'reservoir'
    );

    // Try extracting latest observation date from last row
    let obsDate: string | null = null;
    if (tailRows.length > 0) {
      const last = tailRows[tailRows.length - 1];
      const rawDate =
        last['Monitoring Date'] || last['Date'] || last['observation_date'] || null;
      if (rawDate !== null && rawDate !== undefined) {
        obsDate = String(rawDate);
      }
    }

    const data: PublicDatasetResult = {
      key,
      title: cfg.title,
      dataset_name: cfg.name,
      available: totalRows > 0,
      reachable: true,
      record_count: totalRows,
      display_record_count: tailRows.length,
      records: tailRows,
      observation_date: obsDate,
      dataset_url: cfg.url,
      page_url: cfg.page,
      source: NWDP_WEBSITE,
      frequency: cfg.frequency,
      message:
        totalRows > 0
          ? 'Official government observations retrieved live.'
          : 'Portal reachable, 0 observations published in this CSV file.',
      error: null,
    };

    publicMemoryCache.set(key, { cachedAt: now, data });
    persistPublicCacheToDisk();
    return data;
  } catch (err) {
    // If we have stale cached data during a transient upstream error, still return error status honestly or cached?
    // Keep honest upstream error reporting, or if cached exists without forceRefresh we already returned above.
    return {
      key,
      title: cfg.title,
      dataset_name: cfg.name,
      available: false,
      reachable: false,
      record_count: 0,
      display_record_count: 0,
      records: [],
      observation_date: null,
      dataset_url: cfg.url,
      page_url: cfg.page,
      source: NWDP_WEBSITE,
      frequency: cfg.frequency,
      message: 'Could not reach upstream National Water Data Portal.',
      error: err instanceof Error ? err.message : 'Request error',
    };
  }
}

export async function getAllPublicWaterData(forceRefresh = false) {
  const keys = Object.keys(GOVERNMENT_DATASETS);
  const results = await Promise.all(
    keys.map((k) => fetchPublicDataset(k, forceRefresh))
  );
  const datasets: Record<string, PublicDatasetResult> = {};
  let availableCount = 0;
  let reachableCount = 0;
  for (const item of results) {
    datasets[item.key] = item;
    if (item.available) availableCount++;
    if (item.reachable) reachableCount++;
  }

  return {
    success: true,
    source: 'National Water Data Portal',
    source_url: NWDP_WEBSITE,
    checked_at: new Date().toISOString(),
    dataset_count: keys.length,
    available_count: availableCount,
    reachable_count: reachableCount,
    datasets,
    note: 'Live official government CSV observations from nwdp.nwic.gov.in. Feeds with 0 upstream rows are reported transparently without placeholder zero-filling.',
  };
}

export interface LiveWeatherCityReading {
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

const KARNATAKA_STATIONS: Array<{
  city: string;
  district: string;
  lat: number;
  lon: number;
}> = [
  { city: 'Bengaluru', district: 'Bengaluru Urban', lat: 12.9716, lon: 77.5946 },
  { city: 'Mysuru', district: 'Mysuru', lat: 12.2958, lon: 76.6394 },
  { city: 'Mangaluru', district: 'Dakshina Kannada', lat: 12.9141, lon: 74.856 },
  { city: 'Hubballi', district: 'Dharwad', lat: 15.3647, lon: 75.124 },
  { city: 'Belagavi', district: 'Belagavi', lat: 15.8497, lon: 74.4977 },
  { city: 'Kalaburagi', district: 'Kalaburagi', lat: 17.3297, lon: 76.8343 },
];

let weatherMemCache: {
  cachedAt: number;
  payload: {
    success: boolean;
    fetched_at: string;
    average_rainfall_mm: number;
    avg_temperature_c: number | null;
    avg_humidity_pct: number | null;
    data: LiveWeatherCityReading[];
    note: string;
  };
} | null = null;

export async function getLiveWeatherData(forceRefresh = false) {
  const nowSec = Date.now() / 1000;
  if (!forceRefresh && weatherMemCache && nowSec - weatherMemCache.cachedAt < 300) {
    return weatherMemCache.payload;
  }

  const results: LiveWeatherCityReading[] = await Promise.all(
    KARNATAKA_STATIONS.map(async (st) => {
      try {
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&daily=precipitation_sum&forecast_days=3&timezone=auto`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!response.ok) throw new Error('Weather unavailable');
        const data = (await response.json()) as {
          current?: Record<string, unknown>;
          daily?: { precipitation_sum?: number[] };
        };
        const dailyRain = data.daily?.precipitation_sum || [];
        const avgDailyRain = dailyRain.length
          ? Math.round(
              (dailyRain.reduce((s, v) => s + (Number(v) || 0), 0) /
                dailyRain.length) *
                100
            ) / 100
          : 0;

        const current: LiveWeatherCityReading['weather'] = data.current
          ? {
              ...(data.current as Record<string, unknown>),
              daily_avg_rainfall_mm: avgDailyRain,
            }
          : null;

        const temp = Number(current?.temperature_2m ?? 0);
        const humidity = Number(current?.relative_humidity_2m ?? 0);
        const precip = Number(current?.precipitation ?? 0);

        let advisory = 'Normal operating conditions';
        let severity: LiveWeatherCityReading['advisory_severity'] = 'Normal';

        if (precip >= 15 || avgDailyRain >= 20) {
          advisory = 'Heavy rain: inspect stormwater drains & turbidity filters';
          severity = 'High';
        } else if (temp >= 32 && avgDailyRain < 0.5) {
          advisory = 'High heat & dry spell: inspect pump thermal load & evaporation';
          severity = 'High';
        } else if (temp >= 28 && humidity <= 40 && avgDailyRain < 0.5) {
          advisory = 'Low humidity & zero rainfall: monitor pipeline pressure & tanks';
          severity = 'Medium';
        }

        return {
          city: st.city,
          district: st.district,
          weather: current as LiveWeatherCityReading['weather'],
          maintenance_advisory: advisory,
          advisory_severity: severity,
          source: 'Open-Meteo',
        };
      } catch {
        return {
          city: st.city,
          district: st.district,
          weather: null,
          maintenance_advisory: 'Station telemetry unreachable',
          advisory_severity: 'Normal',
          source: 'Unavailable',
        };
      }
    })
  );

  const rainSamples = results
    .map((r) => r.weather?.daily_avg_rainfall_mm ?? r.weather?.precipitation ?? null)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const tempSamples = results
    .map((r) => r.weather?.temperature_2m ?? null)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const humSamples = results
    .map((r) => r.weather?.relative_humidity_2m ?? null)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const avgRainfallMm = rainSamples.length
    ? Math.round((rainSamples.reduce((s, v) => s + v, 0) / rainSamples.length) * 100) / 100
    : 0;
  const avgTemp = tempSamples.length
    ? Math.round((tempSamples.reduce((s, v) => s + v, 0) / tempSamples.length) * 10) / 10
    : null;
  const avgHum = humSamples.length
    ? Math.round(humSamples.reduce((s, v) => s + v, 0) / humSamples.length)
    : null;

  const payload = {
    success: true,
    fetched_at: new Date().toISOString(),
    average_rainfall_mm: avgRainfallMm,
    avg_temperature_c: avgTemp,
    avg_humidity_pct: avgHum,
    data: results,
    note: 'Live Open-Meteo weather stations for Karnataka grid maintenance & evaporation monitoring.',
  };

  weatherMemCache = { cachedAt: nowSec, payload };
  try {
    fs.mkdirSync(META_DIR, { recursive: true });
    fs.writeFileSync(WEATHER_CACHE_FILE, JSON.stringify(payload));
  } catch {
    // ignore
  }

  return payload;
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

const DAM_DISTRICT_MAP: Record<string, string> = {
  'krishna raja sagara': 'Mandya',
  krs: 'Mandya',
  almatti: 'Vijayapura',
  tungabhadra: 'Vijayanagara',
  kabini: 'Mysuru',
  linganamakki: 'Shivamogga',
  harangi: 'Kodagu',
  hemavathi: 'Hassan',
  bhadra: 'Chikkamagaluru',
  malaprabha: 'Belagavi',
  ghataprabha: 'Belagavi',
  narayanpur: 'Yadgir',
  vanivilasa: 'Chitradurga',
  supa: 'Uttara Kannada',
  karanja: 'Bidar',
};

function inferDamDistrict(name: string): string {
  const lower = name.toLowerCase();
  for (const [k, d] of Object.entries(DAM_DISTRICT_MAP)) {
    if (lower.includes(k)) return d;
  }
  return 'Karnataka';
}

function getProp(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== undefined) return row[k];
  }
  // fuzzy match normalizing whitespace/newlines
  const normalizedEntries = Object.entries(row).map(([k, v]) => [
    k.replace(/\s+/g, ' ').trim().toLowerCase(),
    v,
  ] as const);
  for (const k of keys) {
    const target = k.replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = normalizedEntries.find(([ek]) => ek === target);
    if (hit && hit[1] !== null && hit[1] !== undefined) return hit[1];
  }
  return null;
}

export function extractLatestNwdpReservoirs(
  publicRes: PublicDatasetResult | undefined
): LiveNwdpReservoirSnapshot[] {
  if (!publicRes || !publicRes.available || !publicRes.records.length) return [];
  const latestByDam = new Map<string, LiveNwdpReservoirSnapshot>();

  for (const raw of publicRes.records) {
    const name = String(getProp(raw, 'Reservoir Name') || '').trim();
    if (!name) continue;

    const pct = Number(getProp(raw, 'Percentage Full') ?? 0);
    const level = Number(getProp(raw, 'Reservoir Level (ft)') ?? 0);
    const designCap = Number(getProp(raw, 'Design Gross Capacity (TMC)') ?? 0);
    const grossCap = Number(getProp(raw, 'Gross Capacity (TMC)') ?? designCap);
    const liveCap = Number(getProp(raw, 'Live Capacity (TMC)') ?? 0);
    const inflow = Number(getProp(raw, 'Inflow (Cusecs)') ?? 0);
    const outflow = Number(getProp(raw, 'Outflow to River (Cusecs)') ?? 0);
    const canal = Number(getProp(raw, 'Canal Withdrawal (Cusecs)') ?? 0);
    const evap = Number(getProp(raw, 'Evaporation (Cusecs)') ?? 0);
    const river = String(getProp(raw, 'River') || 'Karnataka River').trim();
    const basin = String(getProp(raw, 'Basin') || 'Karnataka Basin').trim();
    const monRaw = String(getProp(raw, 'Monitoring Date') || '').trim();
    // Convert DD-MM-YYYY HH:mm:ss -> YYYY-MM-DD
    let monDate = new Date().toISOString().slice(0, 10);
    const dmy = monRaw.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (dmy) {
      monDate = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    } else if (/^\d{4}-\d{2}-\d{2}/.test(monRaw)) {
      monDate = monRaw.slice(0, 10);
    }

    latestByDam.set(name, {
      reservoir_name: name,
      district: inferDamDistrict(name),
      river,
      basin: basin.toLowerCase().includes('basin') ? basin : `${basin} Basin`,
      monitoring_date: monDate,
      percentage_full: Number.isFinite(pct) ? Math.round(pct * 10) / 10 : 0,
      reservoir_level: Number.isFinite(level) ? Math.round(level * 100) / 100 : 0,
      design_capacity: Number.isFinite(designCap) ? designCap : grossCap,
      gross_capacity: Number.isFinite(grossCap) ? grossCap : designCap,
      live_capacity: Number.isFinite(liveCap) ? Math.round(liveCap * 100) / 100 : 0,
      inflow: Number.isFinite(inflow) ? Math.round(inflow) : 0,
      outflow: Number.isFinite(outflow) ? Math.round(outflow) : 0,
      canal_withdrawal: Number.isFinite(canal) ? Math.round(canal) : 0,
      evaporation: Number.isFinite(evap) ? Math.round(evap) : 0,
    });
  }

  return Array.from(latestByDam.values());
}
