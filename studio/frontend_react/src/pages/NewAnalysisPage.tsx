/**
 * NewAnalysisPage — Pipeline Runner / 新建光影分析
 *
 * P09-005: 升级为现代 pipeline runner 布局。
 * 左侧步骤流程（来源→输出→聚类→通道→启动），右侧状态面板。
 *
 * 所有 API flow / outputLockedRef / polling / auto channel build 行为不变。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchJobSchema, scanFolder, submitJob, getJobStatus, getJobLogText,
  fetchAnalysisStatus, buildAnalysisChannel,
} from '../api/client';
import PageHeader from '../components/layout/PageHeader';
import SourceCard from '../components/new-analysis/SourceCard';
import OutputCard from '../components/new-analysis/OutputCard';
import ClusteringPresetCard from '../components/new-analysis/ClusteringPresetCard';
import AnalysisChannelCards from '../components/new-analysis/AnalysisChannelCards';
import RunStatusPanel from '../components/new-analysis/RunStatusPanel';
import { getPresetById, DEFAULT_PRESET_ID } from '../config/runConfig';
import type { AnalysisRunConfig } from '../config/runConfig';
import { FEATURE_SCHEMA, getFeatureKeys } from '../config/featureSchema';
import Button from '../components/ui/Button';

const DEFAULT_CHANNELS = {
  basic_metadata: true,
  histogram: true,
  quality_edge: true,
  duplicate_groups: true,
};

const CHANNEL_ORDER = ['basic_metadata', 'histogram', 'quality_edge', 'duplicate_groups'] as const;
const NEW_ANALYSIS_STATE_KEY = 'newAnalysis.configBundle:v1';

function suggestOutputDir(input: string): string {
  return input.trim().replace(/[/\\]+$/, '') + '-output';
}

function buildDefaultRunConfig(): AnalysisRunConfig {
  return getPresetById(DEFAULT_PRESET_ID)?.buildConfig() as AnalysisRunConfig;
}

function cloneRunConfig(config: AnalysisRunConfig): AnalysisRunConfig {
  return JSON.parse(JSON.stringify(config)) as AnalysisRunConfig;
}

function normalizeImportedRunConfig(raw: any): { config: AnalysisRunConfig; warnings: string[] } {
  const source = raw?.run_config || raw?.config?.run_config || raw;
  const base = cloneRunConfig(buildDefaultRunConfig());
  const warnings: string[] = [];
  if (!source || typeof source !== 'object') {
    warnings.push('未找到 run_config，已使用默认配置补齐。');
    return { config: base, warnings };
  }
  const next = cloneRunConfig(base);
  if (typeof source.clustering_preset_id === 'string') next.clustering_preset_id = source.clustering_preset_id;
  if (source.clustering && typeof source.clustering === 'object') {
    if (source.clustering.umap && typeof source.clustering.umap === 'object') {
      next.clustering.umap = { ...next.clustering.umap, ...source.clustering.umap };
    }
    if (source.clustering.hdbscan && typeof source.clustering.hdbscan === 'object') {
      next.clustering.hdbscan = { ...next.clustering.hdbscan, ...source.clustering.hdbscan };
    }
    if (source.clustering.feature_weights && typeof source.clustering.feature_weights === 'object') {
      const validKeys = new Set(getFeatureKeys());
      const weights: Record<string, number> = { ...next.clustering.feature_weights };
      Object.entries(source.clustering.feature_weights).forEach(([key, value]) => {
        if (!validKeys.has(key)) {
          warnings.push(`未知特征 key 已忽略：${key}`);
          return;
        }
        const numeric = Number(value);
        weights[key] = Number.isFinite(numeric) ? numeric : 1;
      });
      next.clustering.feature_weights = weights;
    }
  }
  if (source.analysis_channels && typeof source.analysis_channels === 'object') {
    next.analysis_channels = { ...next.analysis_channels, ...source.analysis_channels };
  }
  if (source.output && typeof source.output === 'object') {
    next.output = { ...next.output, ...source.output };
  }
  next.version = 1;
  next.clustering_preset_id = 'custom';
  return { config: next, warnings };
}

/**
 * 从 DataTransfer 中提取文件夹路径。
 */
function extractFolderPath(dt: DataTransfer): string | null {
  const items = dt.items;
  if (items && items.length) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry && (entry as any).fullPath) {
          return (entry as any).fullPath.replace(/^[/\\]/, '');
        }
        const f = item.getAsFile?.();
        if (f && (f as any).path) {
          return (f as any).path.replace(/[/\\][^/\\]*$/, '');
        }
      }
    }
  }
  if (dt.files && dt.files.length) {
    const f = dt.files[0];
    if ((f as any).path) return (f as any).path.replace(/[/\\][^/\\]*$/, '');
  }
  return null;
}

export default function NewAnalysisPage() {
  // ── State ──
  const [imageRoot, setImageRoot] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [scanResult, setScanResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [channels, setChannels] = useState(DEFAULT_CHANNELS);
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_PRESET_ID);
  const [customRunConfig, setCustomRunConfig] = useState<AnalysisRunConfig>(() => cloneRunConfig(buildDefaultRunConfig()));
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobLog, setJobLog] = useState('');
  const [, setLogOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [imageCountText, setImageCountText] = useState('');

  // ── Refs (must preserve existing logic) ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputLockedRef = useRef(false);
  const importConfigInputRef = useRef<HTMLInputElement | null>(null);
  const prevRootRef = useRef(imageRoot);
  const channelsRef = useRef(channels);
  channelsRef.current = channels;

  // ── Schema load ──
  useEffect(() => {
    fetchJobSchema().then(() => {}).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NEW_ANALYSIS_STATE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.imageRoot === 'string') setImageRoot(saved.imageRoot);
      if (typeof saved.outputDir === 'string') setOutputDir(saved.outputDir);
      if (typeof saved.outputLocked === 'boolean') outputLockedRef.current = saved.outputLocked;
      if (typeof saved.selectedPresetId === 'string') setSelectedPresetId(saved.selectedPresetId);
      if (saved.channels && typeof saved.channels === 'object') {
        setChannels((prev) => ({ ...prev, ...saved.channels }));
      }
      if (saved.customRunConfig) {
        const normalized = normalizeImportedRunConfig(saved.customRunConfig);
        setCustomRunConfig(normalized.config);
      }
    } catch {
      // Ignore broken localStorage state; the page can rebuild defaults.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NEW_ANALYSIS_STATE_KEY, JSON.stringify({
        imageRoot,
        outputDir,
        outputLocked: outputLockedRef.current,
        selectedPresetId,
        customRunConfig,
        channels,
      }));
    } catch {
      // best-effort only
    }
  }, [imageRoot, outputDir, selectedPresetId, customRunConfig, channels]);

  // ── Auto-fill output dir (locked-aware) ──
  useEffect(() => {
    if (imageRoot !== prevRootRef.current) {
      prevRootRef.current = imageRoot;
      if (imageRoot.trim() && !outputLockedRef.current) {
        setOutputDir(suggestOutputDir(imageRoot));
      }
    }
  }, [imageRoot]);

  // ── Poll job status ──
  const startPolling = useCallback((jid: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let localOffset = 0;
    pollRef.current = setInterval(async () => {
      try {
        const status = await getJobStatus(jid);
        setJobStatus(status.status);

        try {
          const logResult = await getJobLogText(jid, localOffset);
          if (logResult.text) {
            setJobLog((prev) => prev + (prev ? '\n' : '') + logResult.text);
            localOffset = logResult.newOffset;
            setLogOffset(localOffset);
          }
        } catch { /* best-effort */ }

        if (status.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          const currentChannels = channelsRef.current;
          // Build channels silently (status not shown in new UI)
          const doBuild = async () => {
            try {
              const as = await fetchAnalysisStatus(jid);
              for (const ch of CHANNEL_ORDER) {
                if (!currentChannels[ch]) continue;
                const ready = ch === 'basic_metadata'
                  ? as.basic_metadata_ready
                  : ch === 'histogram' ? as.histogram_ready
                    : ch === 'quality_edge' ? as.quality_edge_ready
                      : as.capability?.channels?.duplicate_groups?.built;
                if (ready) continue;
                try {
                  await buildAnalysisChannel(jid, ch, false);
                } catch { /* best-effort */ }
              }
            } catch { /* best-effort */ }
          };
          doBuild();
        }
        if (status.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch { /* ignore */ }
    }, 2000);
  }, []);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Handlers ──

  const handleImageRootChange = useCallback((val: string) => {
    setImageRoot(val);
    setScanResult(null);
  }, []);

  const handleOutputChange = useCallback((val: string) => {
    setOutputDir(val);
    if (val !== suggestOutputDir(imageRoot)) {
      outputLockedRef.current = true;
    } else {
      outputLockedRef.current = false;
    }
  }, [imageRoot]);

  const unlockOutput = useCallback(() => {
    outputLockedRef.current = false;
    if (imageRoot.trim()) {
      setOutputDir(suggestOutputDir(imageRoot));
    }
  }, [imageRoot]);

  const handleScan = useCallback(async () => {
    if (!imageRoot.trim()) return;
    setScanning(true);
    setScanResult(null);
    try {
      const data = await scanFolder(imageRoot.trim());
      if (data.ok) {
        const details = `📂 格式: ${(data.formats || []).join(', ')}`
          + (data.sample_files?.length ? `\n📄 样例: ${data.sample_files.slice(0, 3).join(', ')}${data.sample_files.length > 3 ? '…' : ''}` : '');
        setScanResult({ ok: true, msg: `找到 ${data.image_count} 张图片`, details });
        setImageCountText(`${data.image_count} 张 · ${(data.formats || []).join(', ')}`);
      } else {
        setScanResult({ ok: false, msg: `${data.message || '扫描失败'}`, details: '' });
        setImageCountText('');
      }
    } catch (e: any) {
      setScanResult({ ok: false, msg: `${e.message}`, details: '' });
      setImageCountText('');
    } finally {
      setScanning(false);
    }
  }, [imageRoot]);

  const handleChannelToggle = useCallback((key: string, value: boolean) => {
    setChannels((prev) => ({ ...prev, [key]: value }));
  }, []);

  const buildRunConfigForSubmit = useCallback((): AnalysisRunConfig => {
    const base = selectedPresetId === 'custom'
      ? cloneRunConfig(customRunConfig)
      : cloneRunConfig(getPresetById(selectedPresetId)?.buildConfig() || buildDefaultRunConfig());
    base.clustering_preset_id = selectedPresetId === 'custom' ? 'custom' : base.clustering_preset_id;
    base.analysis_channels = {
      basic_metadata: !!channels.basic_metadata,
      histogram: !!channels.histogram,
      quality_edge: !!channels.quality_edge,
      duplicate_detection: !!(channels as any).duplicate_groups,
    };
    return base;
  }, [channels, customRunConfig, selectedPresetId]);

  const updateCustomWeight = useCallback((key: string, value: number) => {
    setSelectedPresetId('custom');
    setCustomRunConfig((prev) => ({
      ...prev,
      clustering_preset_id: 'custom',
      clustering: {
        ...prev.clustering,
        feature_weights: {
          ...prev.clustering.feature_weights,
          [key]: value,
        },
      },
    }));
  }, []);

  const updateCustomNumber = useCallback((path: 'umap.n_neighbors' | 'umap.min_dist' | 'hdbscan.min_cluster_size' | 'hdbscan.min_samples', value: number) => {
    setSelectedPresetId('custom');
    setCustomRunConfig((prev) => {
      const next = cloneRunConfig(prev);
      next.clustering_preset_id = 'custom';
      if (path === 'umap.n_neighbors') next.clustering.umap = { ...next.clustering.umap, n_neighbors: value };
      if (path === 'umap.min_dist') next.clustering.umap = { ...next.clustering.umap, min_dist: value };
      if (path === 'hdbscan.min_cluster_size') next.clustering.hdbscan = { ...next.clustering.hdbscan, min_cluster_size: value };
      if (path === 'hdbscan.min_samples') next.clustering.hdbscan = { ...next.clustering.hdbscan, min_samples: value };
      return next;
    });
  }, []);

  const handleImportConfigFile = useCallback(async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const normalized = normalizeImportedRunConfig(parsed);
      setCustomRunConfig(normalized.config);
      setSelectedPresetId('custom');
      setConfigMessage(normalized.warnings.length
        ? `配置已导入，已忽略 ${normalized.warnings.length} 个未知字段。`
        : '配置已导入，并切换到自定义。');
    } catch (e: any) {
      setConfigMessage(`配置导入失败：${e.message || e}`);
    } finally {
      if (importConfigInputRef.current) importConfigInputRef.current.value = '';
    }
  }, []);

  const handleExportConfig = useCallback(() => {
    const analysisConfig = {
      version: 1,
      exported_at: new Date().toISOString(),
      run_config: buildRunConfigForSubmit(),
    };
    const blob = new Blob([JSON.stringify(analysisConfig, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'analysis_config.json';
    link.click();
    URL.revokeObjectURL(url);
    setConfigMessage('已导出 analysis_config.json。');
  }, [buildRunConfigForSubmit]);

  const handleSubmit = useCallback(async () => {
    if (!imageRoot.trim()) { setError('请输入图片目录'); return; }
    if (!outputDir.trim()) { setError('请输入输出目录'); return; }
    setError(null);
    setSubmitting(true);
    setJobLog('');
    setLogOffset(0);
    try {
      const run_config = buildRunConfigForSubmit();
      const result = await submitJob({
        input_folders: [imageRoot.trim()],
        output_folder: outputDir.trim(),
        config: {
          analysis_channels: channels,
          preset: selectedPresetId,
          run_config,
        },
      });
      setJobId(result.job_id);
      setJobStatus('pending');
      startPolling(result.job_id);
    } catch (e: any) {
      setError(e.message);
      setSubmitting(false);
    }
  }, [imageRoot, outputDir, channels, selectedPresetId, startPolling, buildRunConfigForSubmit]);

  // ── Paste handler ──
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text');
    if (text && /^[a-zA-Z]:[\\/]/.test(text)) {
      e.preventDefault();
      handleImageRootChange(text.trim());
    }
  }, [handleImageRootChange]);

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // ── Computed ──
  const isRunning = jobStatus && ['pending', 'running'].includes(jobStatus);
  const isJobDone = jobStatus === 'completed';
  const isJobFailed = jobStatus === 'failed';
  const isOutputLocked = outputLockedRef.current;
  const isFormDisabled = !!jobId;

  return (
    <div
      style={styles.page}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const folderPath = extractFolderPath(e.dataTransfer);
        if (folderPath) {
          handleImageRootChange(folderPath);
          return;
        }
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          const first = files[0];
          setScanResult({ ok: false, msg: `拖入文件: ${first.name}`, details: '浏览器无法从拖拽获取完整本地路径。请在输入框中粘贴路径，然后点击"扫描目录"由后端验证。' });
        }
      }}
    >
      <PageHeader
        title="新建光影分析"
        subtitle="选择图片目录，配置聚类方式，然后启动本地分析任务。"
      />

      {/* Drag-over overlay */}
      {isDragOver && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragHint}>
            📂 释放以查看文件名提示（完整路径请粘贴到输入框）
          </div>
        </div>
      )}

      <div style={styles.columns}>
        {/* ═══ Left: Step-by-step form ═══ */}
        <div style={styles.leftCol}>
          {/* Step 1: Source */}
          <SourceCard
            value={imageRoot}
            onChange={handleImageRootChange}
            onScan={handleScan}
            scanning={scanning}
            scanResult={scanResult}
            disabled={isFormDisabled}
            isDragOver={isDragOver}
          />

          {/* Step 2: Output */}
          <OutputCard
            value={outputDir}
            onChange={handleOutputChange}
            suggestedDir={suggestOutputDir(imageRoot)}
            isLocked={isOutputLocked}
            onUnlock={unlockOutput}
            disabled={isFormDisabled}
          />

          {/* Step 3: Clustering */}
          <ClusteringPresetCard
            selectedPresetId={selectedPresetId}
            onSelectPreset={setSelectedPresetId}
            disabled={isFormDisabled}
          />

          <details style={styles.customConfigCard} open={selectedPresetId === 'custom'}>
            <summary style={styles.customConfigSummary}>
              自定义配置包
              <span style={styles.customConfigBadge}>
                {selectedPresetId === 'custom' ? '当前使用' : '可导入 / 可编辑'}
              </span>
            </summary>
            <div style={styles.configActions}>
              <Button variant="ghost" size="sm" onClick={() => setSelectedPresetId('custom')} disabled={isFormDisabled}>
                使用自定义
              </Button>
              <Button variant="ghost" size="sm" onClick={() => importConfigInputRef.current?.click()} disabled={isFormDisabled}>
                导入配置
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportConfig}>
                导出配置
              </Button>
              <input
                ref={importConfigInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => handleImportConfigFile(e.target.files?.[0] || null)}
              />
            </div>
            {configMessage && <div style={styles.configMessage}>{configMessage}</div>}
            <div style={styles.configHint}>
              导入支持旧 job 的 run_config.json 或用户保存的 analysis_config.json。缺失字段会用默认值补齐，未知 feature key 会提示但不会中断。
            </div>

            <div style={styles.paramGrid}>
              <label style={styles.paramField}>
                <span>UMAP 邻居数</span>
                <input
                  type="number"
                  min={5}
                  max={200}
                  value={customRunConfig.clustering.umap?.n_neighbors ?? 15}
                  onChange={(e) => updateCustomNumber('umap.n_neighbors', Number(e.target.value))}
                  style={styles.paramInput}
                  disabled={isFormDisabled}
                />
                <small>调大更看整体，调小更看局部。</small>
              </label>
              <label style={styles.paramField}>
                <span>UMAP 紧凑度</span>
                <input
                  type="number"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={customRunConfig.clustering.umap?.min_dist ?? 0.1}
                  onChange={(e) => updateCustomNumber('umap.min_dist', Number(e.target.value))}
                  style={styles.paramInput}
                  disabled={isFormDisabled}
                />
                <small>调小簇更紧，调大分布更松。</small>
              </label>
              <label style={styles.paramField}>
                <span>最小簇大小</span>
                <input
                  type="number"
                  min={2}
                  max={999}
                  value={customRunConfig.clustering.hdbscan?.min_cluster_size ?? 6}
                  onChange={(e) => updateCustomNumber('hdbscan.min_cluster_size', Number(e.target.value))}
                  style={styles.paramInput}
                  disabled={isFormDisabled}
                />
                <small>调大更少噪点，但可能合并过多。</small>
              </label>
              <label style={styles.paramField}>
                <span>核心样本数</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={customRunConfig.clustering.hdbscan?.min_samples ?? 3}
                  onChange={(e) => updateCustomNumber('hdbscan.min_samples', Number(e.target.value))}
                  style={styles.paramInput}
                  disabled={isFormDisabled}
                />
                <small>调大更保守，调小更容易成簇。</small>
              </label>
            </div>

            <div style={styles.featureWeightGrid}>
              {FEATURE_SCHEMA.map((feature) => (
                <label key={feature.key} style={styles.weightRow}>
                  <span title={feature.description}>{feature.zh_name}</span>
                  <input
                    type="number"
                    min={0}
                    max={3}
                    step={0.1}
                    value={customRunConfig.clustering.feature_weights[feature.key] ?? 1}
                    onChange={(e) => updateCustomWeight(feature.key, Number(e.target.value))}
                    style={styles.weightInput}
                    disabled={isFormDisabled}
                  />
                </label>
              ))}
            </div>
          </details>

          {/* Step 4: Analysis Channels */}
          <AnalysisChannelCards
            channels={channels}
            onChange={handleChannelToggle}
            disabled={isFormDisabled}
          />

          {/* P11-001: Config explanation */}
          <details style={{
            marginTop: 8, marginBottom: 8,
            background: 'var(--surface, #1e1e2e)',
            border: '1px solid var(--border, #2a2a3e)', borderRadius: 6, padding: 8,
            fontSize: 12, color: 'var(--text-muted, #888)',
          }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text, #e0e0e8)' }}>
              📖 配置说明 — 本次分析会生成什么
            </summary>
            <div style={{ marginTop: 8, lineHeight: 1.6 }}>
              <p><strong>🎯 聚类核心 16 维特征</strong></p>
              <p style={{ marginLeft: 8 }}>
                16 维特征由色彩、亮度、纹理等维度组成，用于 UMAP 降维和 HDBSCAN 聚类。
                每一维代表一个视觉属性：如 brightness (亮度)、saturation (饱和度)、
                hue_warm_ratio (暖色比例)、edge_complexity (边缘复杂度) 等。
                所有 16 维共同参与聚类分组。可在运行后查看 <code>features.csv</code> 确认。
              </p>
              <p><strong>📊 分析通道说明</strong></p>
              <ul style={{ marginLeft: 8, paddingLeft: 16 }}>
                <li><strong>基本信息</strong> — 图片尺寸、格式、文件大小、透明通道等 metadata。用于巡检筛选，<em>不参与聚类</em>。</li>
                <li><strong>曝光色彩</strong> — 亮度直方图、色相分布、饱和度统计。参与聚类。</li>
                <li><strong>质量边缘</strong> — 模糊检测、噪点评估、边缘复杂度。参与聚类。</li>
                <li><strong>重复图检测</strong> — perceptual hash 去重，生成重复分组。仅用于巡检，<em>不参与聚类</em>。</li>
                <li><strong>模型分析</strong> — 如 depth estimation、IQA (图像质量评估)。当前部分模型尚在规划中。</li>
              </ul>
              <p><strong>📁 本次任务生成的文件</strong></p>
              <ul style={{ marginLeft: 8, paddingLeft: 16 }}>
                <li><code>features.csv</code> — 每张图的 16 维特征</li>
                <li><code>atlas_points.csv</code> — UMAP 降维坐标</li>
                <li><code>cluster_catalog.csv</code> — 聚类分组结果</li>
                <li><code>thumbnails/</code> — 缩略图缓存</li>
                <li><code>inspection_manifest.json</code> — 巡检切片定义</li>
                <li><code>analysis_channels/*.csv</code> — 各分析通道数据</li>
              </ul>
              <p><strong>🔧 高级聚类参数</strong>（当前版本不可调）</p>
              <p style={{ marginLeft: 8 }}>
                UMAP neighbors、cluster_size_ratio、depth 特征开关等参数位于后端默认配置。
                后续版本将开放 UI 调节。
              </p>
            </div>
          </details>

          {/* Step 5: Run */}
          <div style={styles.runCard}>
            <div style={styles.stepHeader}>
              <span style={styles.stepNum}>5</span>
              <div>
                <div style={styles.stepTitle}>启动分析</div>
                <div style={styles.stepDesc}>确认配置后开始本地分析任务</div>
              </div>
            </div>

            {!jobId ? (
              <div>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !imageRoot.trim() || !outputDir.trim()}
                  loading={submitting}
                  variant="primary"
                  size="md"
                  style={{ width: '100%', padding: '10px 0', fontSize: 14 }}
                >
                  {submitting ? '启动中…' : '开始本地分析'}
                </Button>
                {(!imageRoot.trim() || !outputDir.trim()) && (
                  <div style={styles.runDisabledHint}>
                    {!imageRoot.trim() ? '请先设置图片目录' : '请先设置输出目录'}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={styles.jobBar}>
                  <span style={styles.jobBarLabel}>任务 ID:</span>
                  <code style={styles.jobBarId}>{jobId}</code>
                </div>
                {isRunning && (
                  <div style={styles.runningMsg}>
                    运行中，请勿关闭页面。完成后将自动构建通道。
                  </div>
                )}
                {isJobDone && (
                  <div style={styles.doneMsg}>
                    ✅ 分析已完成，通道构建中
                  </div>
                )}
                {isJobFailed && (
                  <div style={styles.failedMsg}>
                    任务失败。请检查右侧日志获取详细信息，然后调整后重试。
                  </div>
                )}
                {error && (
                  <div style={styles.errorMsg}>❌ {error}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ Right: Status panel ═══ */}
        <div style={styles.rightCol}>
          <RunStatusPanel
            scanResult={scanResult}
            outputDir={outputDir}
            isOutputLocked={isOutputLocked}
            jobId={jobId}
            jobStatus={jobStatus}
            isRunning={!!isRunning}
            isJobDone={isJobDone}
            isJobFailed={isJobFailed}
            jobLog={jobLog}
            error={error}
            imageCountText={imageCountText}
            onOpenOrganize={() => {
              if (jobId) window.location.href = `/react/organize/?job_id=${encodeURIComponent(jobId)}`;
            }}
            onOpenAnalysis={() => {
              if (jobId) window.location.href = `/react/analysis/?job_id=${encodeURIComponent(jobId)}`;
            }}
          />
        </div>
      </div>

      <div style={{ height: 32 }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '0 32px',
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    position: 'relative' as const,
  },
  columns: {
    display: 'flex',
    gap: 24,
    alignItems: 'flex-start',
  },
  leftCol: {
    flex: 1,
    minWidth: 0,
  },
  rightCol: {
    width: 320,
    flexShrink: 0,
  },
  dragOverlay: {
    position: 'fixed' as const,
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(124,155,255,0.08)',
    border: '2px dashed #7c9bff',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none' as const,
  },
  dragHint: {
    background: '#1e1e2e',
    padding: '24px 40px',
    borderRadius: 12,
    border: '2px solid #7c9bff',
    fontSize: 14,
    color: '#7c9bff',
  },
  // Step 5 run card
  runCard: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  customConfigCard: {
    background: 'var(--card-bg, #1e1e2e)',
    border: '1px solid var(--card-border, #2a2a3e)',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  customConfigSummary: {
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text, #e0e0e8)',
  },
  customConfigBadge: {
    marginLeft: 8,
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent, #7c9bff)',
    background: 'var(--accent-soft, rgba(124,155,255,0.14))',
  },
  configActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 12,
  },
  configMessage: {
    marginTop: 8,
    padding: '6px 8px',
    borderRadius: 6,
    fontSize: 11,
    color: 'var(--success, #46f1c5)',
    background: 'rgba(70,241,197,0.07)',
  },
  configHint: {
    marginTop: 8,
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--text-muted, #888)',
  },
  paramGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 10,
    marginTop: 12,
  },
  paramField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  paramInput: {
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--bg, #12121a)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  featureWeightGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 6,
    marginTop: 12,
  },
  weightRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  weightInput: {
    width: 64,
    padding: '4px 6px',
    borderRadius: 5,
    border: '1px solid var(--border, #2a2a3e)',
    background: 'var(--bg, #12121a)',
    color: 'var(--text, #e0e0e8)',
    fontFamily: 'inherit',
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'var(--accent, #7c9bff)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text, #e0e0e8)',
  },
  stepDesc: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    marginTop: 1,
  },
  runDisabledHint: {
    fontSize: 11,
    color: 'var(--warning, #ffd93d)',
    marginTop: 6,
    textAlign: 'center' as const,
  },
  jobBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  jobBarLabel: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
  },
  jobBarId: {
    fontSize: 11,
    color: 'var(--accent, #7c9bff)',
    fontFamily: 'monospace',
  },
  runningMsg: {
    fontSize: 11,
    color: 'var(--text-muted, #888)',
    padding: '6px 8px',
    background: 'rgba(91,192,222,0.06)',
    borderRadius: 4,
    lineHeight: 1.5,
  },
  doneMsg: {
    fontSize: 11,
    color: 'var(--success, #46f1c5)',
    padding: '6px 8px',
    background: 'rgba(70,241,197,0.06)',
    borderRadius: 4,
  },
  failedMsg: {
    fontSize: 11,
    color: 'var(--danger, #ff5a6e)',
    padding: '6px 8px',
    background: 'rgba(255,90,110,0.08)',
    borderRadius: 4,
  },
  errorMsg: {
    fontSize: 11,
    color: 'var(--danger, #ff5a6e)',
    marginTop: 6,
  },
};
