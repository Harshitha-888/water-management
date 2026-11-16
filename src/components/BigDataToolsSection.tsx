import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Database,
  DatabaseZap,
  Filter,
  Layers,
  Search,
  Sparkles,
} from 'lucide-react';
import { formatNumber } from '../utils/format';

interface BigDataToolsSectionProps {
  districtsList: string[];
  onDataMutated: () => Promise<void>;
}

interface DataProfileReport {
  generatedAt: string;
  durationMs: number;
  totalBlocksScanned: number;
  totalRecords: number;
  nullConsumptionCount: number;
  completenessPct: number;
  numericProfiles: Array<{
    field: string;
    count: number;
    min: number;
    max: number;
    mean: number;
    stdDev: number;
    p50: number;
    p95: number;
  }>;
  qualityDistribution: Array<{ quality: string; count: number }>;
  anomalies: Array<{
    id: number;
    district: string;
    area: string;
    issue: string;
    metric: string;
  }>;
}

interface InvertedIndexResponse {
  durationMs: number;
  totalTerms: number;
  totalPostings: number;
  query: string;
  matchedTerms: Array<{
    term: string;
    docFrequency: number;
    postings: Array<{
      recordId: number;
      blockId: string;
      district: string;
      area: string;
      quality: string;
      shortage: number;
    }>;
  }>;
  sampleTopTerms: Array<{ term: string; docFrequency: number }>;
}

interface SkewBloomAnalysis {
  numPartitions: number;
  totalKeys: number;
  skewRatio: number;
  partitions: Array<{
    partitionId: number;
    recordCount: number;
    districts: string[];
  }>;
  bloomFilter: {
    bitArraySize: number;
    hashFunctions: number;
    setBits: number;
    fillRatioPct: number;
    lookupKey: string;
    mightContain: boolean;
    blocksPruned: number;
    totalBlocks: number;
  };
}

type ToolTab = 'profiler' | 'index' | 'skew' | 'batch';

export const BigDataToolsSection: React.FC<BigDataToolsSectionProps> = ({
  districtsList,
  onDataMutated,
}) => {
  const [activeTool, setActiveTool] = useState<ToolTab>('profiler');

  const [profile, setProfile] = useState<DataProfileReport | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [indexQuery, setIndexQuery] = useState('shortage');
  const [indexResult, setIndexResult] = useState<InvertedIndexResponse | null>(null);

  const [skewPartitions, setSkewPartitions] = useState(4);
  const [bloomDistrict, setBloomDistrict] = useState('Bengaluru Urban');
  const [skewResult, setSkewResult] = useState<SkewBloomAnalysis | null>(null);

  const [batchCount, setBatchCount] = useState(12);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);

  const loadProfiler = async () => {
    setProfileLoading(true);
    try {
      const res = await fetch('/api/bigdata/profile');
      const data = await res.json();
      if (data.success) setProfile(data.report);
    } finally {
      setProfileLoading(false);
    }
  };

  const runIndexSearch = async (term?: string) => {
    const q = term ?? indexQuery;
    const res = await fetch(`/api/bigdata/inverted-index?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (data.success) setIndexResult(data.index);
  };

  const runSkewBloom = async (parts?: number, dist?: string) => {
    const p = parts ?? skewPartitions;
    const d = dist ?? bloomDistrict;
    const res = await fetch(
      `/api/bigdata/skew-bloom?partitions=${p}&district=${encodeURIComponent(d)}`
    );
    const data = await res.json();
    if (data.success) setSkewResult(data.analysis);
  };

  const handleIngestBatch = async () => {
    setBatchBusy(true);
    setBatchNotice(null);
    try {
      const res = await fetch('/api/bigdata/ingest-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: batchCount }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error('Batch ingestion failed');
      }
      setBatchNotice(
        `Ingested ${data.recordsCreated} records across ${data.blocksCreated} shards.`
      );
      await onDataMutated();
      await Promise.all([loadProfiler(), runIndexSearch(), runSkewBloom()]);
    } catch (err) {
      setBatchNotice(err instanceof Error ? err.message : 'Batch ingestion failed');
    } finally {
      setBatchBusy(false);
    }
  };

  useEffect(() => {
    loadProfiler();
    runIndexSearch('shortage');
    runSkewBloom(4, 'Bengaluru Urban');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-center">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Big Data Engineering Suite
          </h2>
          <p className="text-xs text-slate-500">
            Statistical profiling, inverted indexing, skew/Bloom pruning, and batch streaming
          </p>
        </div>
        <div className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'profiler', label: 'ETL Profiler', icon: Activity },
            { id: 'index', label: 'Inverted Index', icon: Search },
            { id: 'skew', label: 'Skew & Bloom', icon: Filter },
            { id: 'batch', label: 'Batch Ingest', icon: DatabaseZap },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTool(tab.id as ToolTab)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  activeTool === tab.id
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

      {/* 1. ETL DATA PROFILER */}
      {activeTool === 'profiler' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div>
                  <p className="text-[11px] text-slate-500">Shards</p>
                  <p className="font-mono-data text-lg font-bold text-slate-900">
                    {profile?.totalBlocksScanned ?? 0}
                  </p>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Layers className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div>
                  <p className="text-[11px] text-slate-500">Records</p>
                  <p className="font-mono-data text-lg font-bold text-slate-900">
                    {formatNumber(profile?.totalRecords ?? 0)}
                  </p>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Database className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div>
                  <p className="text-[11px] text-slate-500">Completeness</p>
                  <p className="font-mono-data text-lg font-bold text-emerald-700">
                    {profile?.completenessPct ?? 100}%
                  </p>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div>
                  <p className="text-[11px] text-slate-500">Latency</p>
                  <p className="font-mono-data text-lg font-bold text-blue-700">
                    {profile?.durationMs ?? 0} ms
                  </p>
                </div>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Clock className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={loadProfiler}
              disabled={profileLoading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              {profileLoading ? 'Profiling...' : 'Re-run'}
            </button>
          </div>

          <div className="overflow-x-auto border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-xs font-semibold text-slate-700">
              Numeric Distribution (P50 / P95 / StdDev)
            </h3>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Metric</th>
                  <th className="py-2 px-2.5 text-right font-medium">Count</th>
                  <th className="py-2 px-2.5 text-right font-medium">Min</th>
                  <th className="py-2 px-2.5 text-right font-medium">P50</th>
                  <th className="py-2 px-2.5 text-right font-medium">Mean</th>
                  <th className="py-2 px-2.5 text-right font-medium">P95</th>
                  <th className="py-2 px-2.5 text-right font-medium">Max</th>
                  <th className="py-2 pl-2.5 text-right font-medium">StdDev</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono-data">
                {(profile?.numericProfiles || []).map((row) => (
                  <tr key={row.field}>
                    <td className="py-2 pr-3 font-sans font-medium text-slate-900">
                      {row.field}
                    </td>
                    <td className="py-2 px-2.5 text-right text-slate-700">{row.count}</td>
                    <td className="py-2 px-2.5 text-right text-slate-700">
                      {formatNumber(row.min)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-semibold text-blue-700">
                      {formatNumber(row.p50)}
                    </td>
                    <td className="py-2 px-2.5 text-right text-slate-900">
                      {formatNumber(row.mean)}
                    </td>
                    <td className="py-2 px-2.5 text-right font-semibold text-amber-700">
                      {formatNumber(row.p95)}
                    </td>
                    <td className="py-2 px-2.5 text-right text-slate-700">
                      {formatNumber(row.max)}
                    </td>
                    <td className="py-2 pl-2.5 text-right text-slate-500">
                      {formatNumber(row.stdDev)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                Top Supply Anomalies
              </h3>
              <div className="divide-y divide-slate-100 text-xs">
                {(profile?.anomalies || []).slice(0, 5).map((a, idx) => (
                  <div
                    key={`${a.id}-${idx}`}
                    className="flex items-center justify-between py-1.5"
                  >
                    <div>
                      <p className="font-medium text-slate-900">
                        {a.area}, {a.district}
                      </p>
                      <p className="text-[11px] text-amber-700">{a.issue}</p>
                    </div>
                    <span className="font-mono-data text-slate-600">{a.metric}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold text-slate-700">
                Water Quality Distribution
              </h3>
              <div className="space-y-2 text-xs">
                {(profile?.qualityDistribution || []).map((q) => {
                  const pct = profile?.totalRecords
                    ? Math.round((q.count / profile.totalRecords) * 100)
                    : 0;
                  return (
                    <div key={q.quality}>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-800">{q.quality}</span>
                        <span className="font-mono-data text-slate-600">
                          {q.count} ({pct}%)
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-600"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. MAPREDUCE INVERTED INDEX */}
      {activeTool === 'index' && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={indexQuery}
                onChange={(e) => setIndexQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runIndexSearch()}
                placeholder="Query term (e.g. bengaluru, fluoride, shortage, good)..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => runIndexSearch()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              Search Index
            </button>
          </div>

          {indexResult && (
            <>
              <div className="flex flex-wrap items-center gap-5 border-b border-slate-100 pb-3 text-xs text-slate-600">
                <span>
                  Vocabulary: <strong className="font-mono-data text-slate-900">{indexResult.totalTerms}</strong> terms
                </span>
                <span>
                  Postings: <strong className="font-mono-data text-slate-900">{indexResult.totalPostings}</strong>
                </span>
                <span>
                  Latency: <strong className="font-mono-data text-blue-700">{indexResult.durationMs} ms</strong>
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {indexResult.sampleTopTerms.slice(0, 12).map((t) => (
                  <button
                    key={t.term}
                    type="button"
                    onClick={() => {
                      setIndexQuery(t.term);
                      runIndexSearch(t.term);
                    }}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono-data text-[11px] text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                  >
                    {t.term} ({t.docFrequency})
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {indexResult.matchedTerms.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-500">
                    No postings matched &ldquo;{indexResult.query}&rdquo;.
                  </p>
                ) : (
                  indexResult.matchedTerms.slice(0, 3).map((match) => (
                    <div
                      key={match.term}
                      className="rounded-lg border border-slate-200 p-3.5"
                    >
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-mono-data font-bold text-blue-700">
                          term:&ldquo;{match.term}&rdquo;
                        </span>
                        <span className="font-mono-data text-slate-500">
                          df = {match.docFrequency}
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-48 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-100 text-slate-500">
                            <tr>
                              <th className="py-1.5 pr-3 font-medium">Block</th>
                              <th className="py-1.5 px-2.5 font-medium">ID</th>
                              <th className="py-1.5 px-2.5 font-medium">District · Area</th>
                              <th className="py-1.5 pl-2.5 text-right font-medium">Shortage</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50 font-mono-data">
                            {match.postings.slice(0, 8).map((p) => (
                              <tr key={`${match.term}-${p.recordId}`}>
                                <td className="py-1.5 pr-3 text-blue-700">{p.blockId}</td>
                                <td className="py-1.5 px-2.5 text-slate-600">#{p.recordId}</td>
                                <td className="py-1.5 px-2.5 font-sans text-slate-900">
                                  {p.district} · <span className="text-slate-500">{p.area}</span>
                                </td>
                                <td className="py-1.5 pl-2.5 text-right text-slate-900">
                                  {formatNumber(p.shortage)} L
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 3. PARTITION SKEW & BLOOM FILTER */}
      {activeTool === 'skew' && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                Hash Partitions
              </label>
              <select
                value={skewPartitions}
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setSkewPartitions(p);
                  runSkewBloom(p, bloomDistrict);
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono-data text-xs"
              >
                {[2, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>
                    {n} Partitions
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                Bloom Probe District
              </label>
              <select
                value={bloomDistrict}
                onChange={(e) => {
                  setBloomDistrict(e.target.value);
                  runSkewBloom(skewPartitions, e.target.value);
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                {districtsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => runSkewBloom()}
              className="w-full rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Analyze Skew &amp; Pruning
            </button>
          </div>

          {skewResult && (
            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700">
                    Partition Key Distribution
                  </h3>
                  <span className="font-mono-data text-xs font-semibold text-slate-900">
                    Skew: {skewResult.skewRatio}x
                  </span>
                </div>
                <div className="space-y-2.5 text-xs">
                  {skewResult.partitions.map((p) => {
                    const pct = skewResult.totalKeys
                      ? Math.round((p.recordCount / skewResult.totalKeys) * 100)
                      : 0;
                    return (
                      <div key={p.partitionId}>
                        <div className="flex justify-between">
                          <span className="font-mono-data font-medium text-slate-900">
                            P#{p.partitionId}
                          </span>
                          <span className="font-mono-data text-slate-600">
                            {p.recordCount} ({pct}%)
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/50 p-4 text-xs">
                <h3 className="text-xs font-semibold text-slate-700">
                  Per-Shard Bloom Filter Pruning
                </h3>
                <div className="grid grid-cols-2 gap-2.5 font-mono-data">
                  <div>
                    <span className="block font-sans text-slate-500">Bit Vector</span>
                    <strong className="text-slate-900">
                      {skewResult.bloomFilter.bitArraySize}b ({skewResult.bloomFilter.hashFunctions}h)
                    </strong>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-500">Saturation</span>
                    <strong className="text-slate-900">
                      {skewResult.bloomFilter.setBits} ({skewResult.bloomFilter.fillRatioPct}%)
                    </strong>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-500">Probe Key</span>
                    <strong className="font-sans text-slate-900">
                      {skewResult.bloomFilter.lookupKey}
                    </strong>
                  </div>
                  <div>
                    <span className="block font-sans text-slate-500">Membership</span>
                    <strong
                      className={
                        skewResult.bloomFilter.mightContain
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }
                    >
                      {skewResult.bloomFilter.mightContain ? 'Possible Match' : 'Definite Miss'}
                    </strong>
                  </div>
                </div>
                <p className="border-t border-slate-200 pt-2 text-slate-600">
                  Prunes{' '}
                  <span className="font-mono-data font-bold text-blue-700">
                    {skewResult.bloomFilter.blocksPruned}/{skewResult.bloomFilter.totalBlocks}
                  </span>{' '}
                  blocks before Map execution.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. BATCH STREAM INGESTION */}
      {activeTool === 'batch' && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label className="block text-[11px] font-medium text-slate-500">
                Batch Size
              </label>
              <select
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                className="mt-1 w-48 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono-data text-xs"
              >
                <option value={10}>10 records</option>
                <option value={25}>25 records</option>
                <option value={50}>50 records</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleIngestBatch}
              disabled={batchBusy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {batchBusy ? 'Sharding...' : 'Stream Batch into Cluster'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Generates multi-district telemetry records, shards them into replicated HDFS blocks, and refreshes the MapReduce index.
          </p>
          {batchNotice && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
              {batchNotice}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
