import React, { useState } from 'react';
import {
  ChevronDown,
  Database,
  HardDrive,
  Layers,
  Power,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import type { ClusterStatus, StorageBlockMeta } from '../types';
import { formatBytes, formatDate, formatNumber } from '../utils/format';

interface ClusterStorageSectionProps {
  cluster: ClusterStatus | null;
  onRefreshCluster: () => Promise<void>;
}

interface InspectedBlock {
  meta: StorageBlockMeta;
  readStatus: 'completed' | 'unavailable';
  nodeServed: string;
  usedReplicaFailover: boolean;
  error?: string;
  records: Record<string, unknown>[];
}

const DEFAULT_ROW_LIMIT = 8;

export const ClusterStorageSection: React.FC<ClusterStorageSectionProps> = ({
  cluster,
  onRefreshCluster,
}) => {
  const [rf, setRf] = useState<number>(cluster?.replicationFactor ?? 2);
  const [blockSize, setBlockSize] = useState<number>(cluster?.blockSizeRecords ?? 6);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspected, setInspected] = useState<InspectedBlock | null>(null);
  const [blockFilter, setBlockFilter] = useState('');
  const [showAllBlocks, setShowAllBlocks] = useState(false);

  const handleToggleNode = async (nodeId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/cluster/nodes/${nodeId}/toggle`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Node toggle failed');
      }
      setNotice(
        `Node ${data.node.id} (${data.node.name}) is now ${data.node.status}. Queries fail over automatically.`
      );
      await onRefreshCluster();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Node update failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRebalance = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/cluster/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replicationFactor: rf,
          blockSizeRecords: blockSize,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Rebalance failed');
      }
      setNotice(
        `Cluster rebalanced: RF=${rf}, ${blockSize} rows/shard, ${data.cluster.totalBlocks} blocks.`
      );
      setInspected(null);
      await onRefreshCluster();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Rebalance error');
    } finally {
      setBusy(false);
    }
  };

  const handleInspectBlock = async (blockId: string) => {
    try {
      const res = await fetch(`/api/cluster/blocks/${blockId}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setInspected(data);
      }
    } catch {
      // ignore
    }
  };

  const blocks = (cluster?.blocks || []).filter((b) => {
    if (!blockFilter.trim()) return true;
    const q = blockFilter.toLowerCase();
    return (
      b.blockId.toLowerCase().includes(q) ||
      b.primaryNode.toLowerCase().includes(q) ||
      b.collection.toLowerCase().includes(q) ||
      b.replicaNodes.some((n) => n.toLowerCase().includes(q))
    );
  });

  const visibleBlocks = showAllBlocks ? blocks : blocks.slice(0, DEFAULT_ROW_LIMIT);

  return (
    <div className="space-y-4">
      {/* Compact Rebalance Bar + 4 Icon-Badged KPI Cards */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 lg:flex-row lg:items-center">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Distributed Shard Topology
            </h2>
            <p className="text-xs text-slate-500">
              {cluster?.clusterName || 'AquaAI-Karnataka-HDFS'} · SHA-256 verified shards
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={rf}
              onChange={(e) => setRf(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-data text-xs text-slate-900"
            >
              <option value={1}>RF = 1</option>
              <option value={2}>RF = 2</option>
              <option value={3}>RF = 3</option>
            </select>
            <select
              value={blockSize}
              onChange={(e) => setBlockSize(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono-data text-xs text-slate-900"
            >
              <option value={3}>3 rows/blk</option>
              <option value={6}>6 rows/blk</option>
              <option value={10}>10 rows/blk</option>
              <option value={15}>15 rows/blk</option>
            </select>
            <button
              type="button"
              onClick={handleRebalance}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Rebalance Shards
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div>
              <p className="text-[11px] text-slate-500">Healthy Nodes</p>
              <p className="mt-0.5 font-mono-data text-lg font-bold text-slate-900">
                {cluster?.healthyNodes ?? 0}/{cluster?.totalNodes ?? 0}
              </p>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Server className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div>
              <p className="text-[11px] text-slate-500">Total Blocks</p>
              <p className="mt-0.5 font-mono-data text-lg font-bold text-blue-700">
                {formatNumber(cluster?.totalBlocks ?? 0)}
              </p>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Layers className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div>
              <p className="text-[11px] text-slate-500">Stored Records</p>
              <p className="mt-0.5 font-mono-data text-lg font-bold text-slate-900">
                {formatNumber(cluster?.totalRecords ?? 0)}
              </p>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <Database className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div>
              <p className="text-[11px] text-slate-500">Block Payload</p>
              <p className="mt-0.5 font-mono-data text-lg font-bold text-slate-900">
                {formatBytes(cluster?.totalStorageBytes ?? 0)}
              </p>
            </div>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <HardDrive className="h-3.5 w-3.5" />
            </div>
          </div>
        </div>

        {notice && (
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
            {notice}
          </p>
        )}
      </section>

      {/* Compact Storage Nodes Grid */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {(cluster?.nodes || []).map((node) => {
          const isOnline = node.status === 'online';
          return (
            <div
              key={node.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Server
                      className={`h-4 w-4 ${isOnline ? 'text-blue-600' : 'text-slate-400'}`}
                    />
                    <div>
                      <h3 className="text-xs font-semibold text-slate-900">{node.name}</h3>
                      <p className="font-mono-data text-[11px] text-slate-500">
                        {node.id} · {node.host}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-semibold ${
                      isOnline ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>

                <div className="mt-3 space-y-1 border-t border-slate-100 pt-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Region</span>
                    <span className="text-slate-800">{node.region}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Primary / Replica</span>
                    <span className="font-mono-data text-slate-900">
                      {node.primaryBlocks} / {node.replicaBlocks}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Records / Disk</span>
                    <span className="font-mono-data text-slate-900">
                      {formatNumber(node.recordCount)} · {formatBytes(node.storageBytes)}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => handleToggleNode(node.id)}
                className={`mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isOnline
                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                <Power className="h-3 w-3" />
                {isOnline ? 'Simulate Offline' : 'Bring Online'}
              </button>
            </div>
          );
        })}
      </section>

      {/* Block Manifest + Shard Inspector */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="mb-3 flex flex-col justify-between gap-2.5 sm:flex-row sm:items-center">
            <h3 className="text-sm font-semibold text-slate-900">
              Block Placement Manifest ({blocks.length})
            </h3>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={blockFilter}
                onChange={(e) => {
                  setBlockFilter(e.target.value);
                  setShowAllBlocks(false);
                }}
                placeholder="Filter block or node..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-blue-500 focus:outline-none sm:w-52"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 font-medium">Block ID</th>
                  <th className="py-2 px-2 font-medium">Collection</th>
                  <th className="py-2 px-2 font-medium">Primary · Replicas</th>
                  <th className="py-2 px-2 text-right font-medium">Rows</th>
                  <th className="py-2 pl-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleBlocks.map((block) => (
                  <tr
                    key={block.blockId}
                    onClick={() => handleInspectBlock(block.blockId)}
                    className={`cursor-pointer transition-colors hover:bg-blue-50/50 ${
                      inspected?.meta.blockId === block.blockId ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    <td className="py-2 pr-3 font-mono-data font-medium text-blue-700 whitespace-nowrap">
                      {block.blockId}
                    </td>
                    <td className="py-2 px-2 text-slate-700 whitespace-nowrap">
                      {block.collection}
                    </td>
                    <td className="py-2 px-2 font-mono-data text-slate-700 whitespace-nowrap">
                      {block.primaryNode}
                      {block.replicaNodes.length ? ` (${block.replicaNodes.join(', ')})` : ''}
                    </td>
                    <td className="py-2 px-2 text-right font-mono-data text-slate-900">
                      {block.recordCount}
                    </td>
                    <td className="py-2 pl-2 text-right font-mono-data text-slate-600 whitespace-nowrap">
                      {formatBytes(block.sizeBytes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blocks.length > DEFAULT_ROW_LIMIT && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
              <span>
                Showing {visibleBlocks.length} of {blocks.length} blocks
              </span>
              <button
                type="button"
                onClick={() => setShowAllBlocks((v) => !v)}
                className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline"
              >
                {showAllBlocks ? 'Show top 8' : `Show all (${blocks.length})`}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${
                    showAllBlocks ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          )}
        </section>

        {/* Raw Shard Inspector */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Shard Inspector</h3>
          </div>

          {!inspected ? (
            <p className="py-10 text-center text-xs text-slate-500">
              Click any block in the manifest to inspect payload &amp; SHA-256 checksum.
            </p>
          ) : (
            <div className="space-y-3 text-xs">
              <div className="space-y-1 border-b border-slate-100 pb-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Block</span>
                  <span className="font-mono-data font-semibold text-slate-900">
                    {inspected.meta.blockId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <span
                    className={`font-semibold ${
                      inspected.readStatus === 'completed'
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {inspected.readStatus}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Node</span>
                  <span className="font-mono-data text-slate-900">
                    {inspected.nodeServed}
                    {inspected.usedReplicaFailover ? ' (failover)' : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created</span>
                  <span className="text-slate-700">{formatDate(inspected.meta.createdAt)}</span>
                </div>
                <p className="truncate font-mono-data text-[11px] text-slate-500">
                  SHA-256: {inspected.meta.checksum}
                </p>
              </div>

              {inspected.error ? (
                <p className="rounded-lg bg-red-50 p-3 text-red-700">{inspected.error}</p>
              ) : (
                <pre className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono-data text-[11px] text-slate-800">
                  {JSON.stringify(inspected.records, null, 2)}
                </pre>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
