/**
 * uiDictionary — UI 文案字典（中英双语）
 *
 * 统一管理所有用户可见的文案（页面标题、按钮、空态、错误提示等）。
 * 组件不应再散写中文/英文产品文案。
 *
 * 语言切换：
 *   setLanguage('zh') / setLanguage('en')
 *   会自动保存到 localStorage，刷新后保持。
 */

// ── Language state ──────────────────────────────────────────────

type Lang = 'zh' | 'en';

// Default to Chinese. English UI is not yet fully implemented.
let _lang: Lang = 'zh';

export function setLanguage(lang: Lang): void {
  _lang = lang;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('app_lang', lang);
  }
}

export function getLanguage(): Lang {
  return _lang;
}

export function toggleLanguage(): Lang {
  const next = _lang === 'zh' ? 'en' : 'zh';
  setLanguage(next);
  return next;
}

// ── Chinese dictionary ──────────────────────────────────────────

const ZH: Record<string, string> = {
  // ============================================================
  // 通用
  // ============================================================
  'app.title': 'Dataset Intelligence Studio',
  'app.subtitle': '图片影调自动分组整理工具',
  'common.home': '← Home',
  'common.save': '💾 保存',
  'common.saving': '保存中...',
  'common.export': '📦 导出',
  'common.refresh': '↻ 刷新',
  'common.back': '←',
  'common.loading': '加载中...',
  'common.error': '错误',
  'common.close': '关闭',
  'common.confirm': '确定',
  'common.cancel': '取消',
  'common.langSwitch': 'English',

  // ============================================================
  // 首页
  // ============================================================
  'home.newAnalysis': '新建分析',
  'home.newAnalysis.desc': '提交新图片分析任务，查看实时日志与进度',
  'home.organize': '整理画板',
  'home.organize.desc': '拖拽整理图片到不同簇，保存、导出、重聚类预览',
  'home.analysis': '分析通道',
  'home.analysis.desc': '查看元数据排序、直方图标签、质量评估',
  'home.legacyNote': 'legacy UI 仍可通过 /app/ 访问（仅兼容维护）',

  // ============================================================
  // 新建分析
  // ============================================================
  'newAnalysis.title': '新建分析',
  'newAnalysis.input.title': '📂 1. 输入',
  'newAnalysis.input.imageDir': '图片目录 *',
  'newAnalysis.input.outputDir': '输出目录 *',
  'newAnalysis.input.scan': '扫描',
  'newAnalysis.input.scanning': '扫描中...',
  'newAnalysis.clusterConfig.title': '🧬 2. 聚类配置（只读）',
  'newAnalysis.channels.title': '📊 3. 分析通道（仅排序/筛选，不参与默认聚类）',
  'newAnalysis.channels.basicMetadata': 'Basic metadata — 分辨率、长短边、过曝/死黑',
  'newAnalysis.channels.histogram': 'Histogram — 亮度/饱和度/hue 分布与标签',
  'newAnalysis.channels.qualityEdge': 'Quality-edge — 模糊、锐度、边缘密度、局部对比',
  'newAnalysis.channels.note': '构建策略：聚类运行完成后，根据勾选依次构建 analysis channels。不参与默认聚类，仅用于排序、筛选、review。',
  'newAnalysis.run.title': '🚀 4. 运行与结果',
  'newAnalysis.run.start': '开始分析',
  'newAnalysis.run.starting': '启动中...',
  'newAnalysis.run.analysis': '📊 Analysis',
  'newAnalysis.run.home': '🏠 Home',
  'newAnalysis.run.failed': '任务失败。请检查上方日志获取详细信息，然后调整输入后重试。',
  'newAnalysis.run.running': '运行中，请勿关闭页面。完成后会自动显示结果。',

  // ============================================================
  // 分析通道
  // ============================================================
  'analysis.title': '分析通道',
  'analysis.loadBtn': 'Load Analysis',
  'analysis.channels': 'Analysis Channels',
  'analysis.build': '构建',
  'analysis.building': '构建中...',
  'analysis.ready': '已就绪',
  'analysis.placeholder': 'Enter a job ID above to load analysis data.',
  'analysis.metadata.title': 'Metadata Summary',

  // ============================================================
  // 整理画板 (Organize)
  // ============================================================
  'organize.title': '整理画板',
  'organize.selectJob': 'Organize V2 — Select Job',
  'organize.noJobs': 'No jobs found. Create one in New Analysis first.',
  'organize.loading': 'Loading organize data...',
  'organize.noClusters': 'No clusters found.',
  'organize.back': '←',
  'organize.save': '💾 保存',
  'organize.saving': '保存中...',
  'organize.export': '📦 导出',
  'organize.refresh': '↻ 刷新',
  'organize.expandAll': '⊟ 全部折叠',
  'organize.collapseAll': '⊞ 全部展开',
  'organize.repack': '📌 重新贴合',
  'organize.bestView': '🎯 最佳视角',
  'organize.thumbnail': '缩略图',
  'organize.preview': '🔬 预览',
  'organize.sort': '📊排序 ⏳',
  'organize.selected': '已选',
  'organize.clear': '✕ 清空',

  // ============================================================
  // Channel 信息
  // ============================================================
  'channel.basicMetadata': '基础信息',
  'channel.basicMetadata.desc': '分辨率、长短边、过曝/死黑',
  'channel.histogram': '曝光色彩',
  'channel.histogram.desc': '亮度、饱和度、色温分布',
  'channel.qualityEdge': '质量边缘',
  'channel.qualityEdge.desc': '模糊、锐度、边缘密度、局部对比',

  // ============================================================
  // 分析通道 Panel 分组
  // ============================================================
  'analysis.panel.basicInfo': '基础信息',
  'analysis.panel.basicInfo.desc': '分辨率、尺寸、透明通道、过曝/死黑等基础图片信息',
  'analysis.panel.exposureColor': '曝光 / 色彩',
  'analysis.panel.exposureColor.desc': '亮度分布、饱和度、色温、直方图异常检测',
  'analysis.panel.qualityEdge': '质量 / 边缘',
  'analysis.panel.qualityEdge.desc': '模糊检测、锐度、边缘密度、局部对比度',
  'analysis.panel.duplicateGroups': '重复图检测',
  'analysis.panel.duplicateGroups.desc': '查找完全一致和感知相似的重复图片（即将推出）',
  'analysis.panel.modelPlugins': '可选模型分析',
  'analysis.panel.modelPlugins.desc': '接入第三方模型进行风格/标签/检测分析（即将推出）',

  // ============================================================
  // 分析通道操作
  // ============================================================
  'analysis.debugToggle': '🔬 Debug 视图',
  'analysis.debugToggleOff': '普通视图',
  'analysis.sortAction': '排序',
  'analysis.filterAction': '筛选',
  'analysis.buildAction': '构建通道',
  'analysis.buildingAction': '构建中...',
  'analysis.fieldCount': '{n} 个字段',
  'analysis.sortableCount': '{n} 个可排序',
  'analysis.filterableCount': '{n} 个可筛选',
  'analysis.representativeFields': '代表字段：{fields}',
  'analysis.debugOnlyFields': 'Debug-only：{fields}',
  'analysis.clusterParticipation': '参与默认聚类',
  'analysis.notParticipateClustering': '不参与默认聚类',
  'analysis.comingSoon': '即将推出',
  'analysis.comingSoon.desc': '此功能正在开发中，敬请期待。',
  'analysis.notBuilt': '尚未构建',
  'analysis.notBuilt.desc': '此通道可帮助您按数据集特征进行排序和筛选。点击"构建通道"按钮开始构建。',
  'analysis.notBuildable': '当前版本暂不开放',
  'analysis.notBuildable.desc': '此通道需要后续版本支持。',
  'analysis.viewData': '查看数据',
  'analysis.sourceChannel': '来源：{channel}',
  'analysis.unit': '单位：{unit}',

  // ============================================================
  // 可选插件 (P05-003)
  // ============================================================
  'plugin.title': '可选模型分析',
  'plugin.title.desc': '接入第三方模型进行标签/检测/风格分析（可选，不影响主流程）',
  'plugin.installed': '✅ 已安装',
  'plugin.notInstalled': '❌ 未安装',
  'plugin.available': '✅ 可用',
  'plugin.notAvailable': '⏳ 不可用',
  'plugin.requiresGpu': '需要 GPU',
  'plugin.noGpu': 'CPU 可用',
  'plugin.offlineSupported': '支持离线',
  'plugin.offlineNotSupported': '需要联网',
  'plugin.modelSize': '模型体积：{size} MB',
  'plugin.failureMode': '降级策略：{mode}',
  'plugin.failureMode.skip': '跳过',
  'plugin.version': '版本 {ver}',
  'plugin.notAffectMain': '可选，不影响主流程',
  'plugin.statusNotBuilt': '仅做环境探测，暂不运行模型推理',

  // ============================================================
  // 重复图组
  // ============================================================
  'duplicate.title': '重复图组',
  'duplicate.build': '构建重复图检测',
  'duplicate.building': '哈希计算中...',
  'duplicate.exactGroup': '完全重复',
  'duplicate.perceptualGroup': '近似重复',
  'duplicate.groupCount': '{n} 个重复组',
  'duplicate.imageCount': '{n} 张重复图片',
  'duplicate.totalChecked': '已检查 {n} 张图片',
  'duplicate.hitEvidence': '命中依据：{algorithms}',
  'duplicate.representative': '代表图',
  'duplicate.members': '组成员',
  'duplicate.noGroups': '未发现重复图片',
  'duplicate.noGroups.desc': '所有图片均为唯一',
  'duplicate.action.keep': '✅ 保留',
  'duplicate.action.mark': '🏷️ 标记',
  'duplicate.action.move': '📦 迁移候选',
  'duplicate.action.none': '— 未处理',
  'duplicate.action.keep.hint': '确认这些是重复图片，保留原样',
  'duplicate.action.mark.hint': '标记为需要后续人工审查',
  'duplicate.action.move.hint': '标记为可能的迁移候选（仅逻辑标记，不实际移动文件）',
  'duplicate.blake3.note': '哈希引擎：{note}',
  'duplicate.viewGroups': '查看重复图组',
  'duplicate.filter.exact': '仅完全重复',
  'duplicate.filter.perceptual': '仅近似重复',
  'duplicate.filter.all': '全部重复组',
  'duplicate.algorithm.phash': '感知哈希 (phash)',
  'duplicate.algorithm.dhash': '差异哈希 (dhash)',
  'duplicate.algorithm.whash': '小波哈希 (whash)',
  'duplicate.algorithm.colorhash': '色彩哈希 (colorhash)',
  'duplicate.algorithm.file_size': '文件大小',
  'duplicate.algorithm.sha256': 'SHA-256',
  'duplicate.algorithm.blake3': 'BLAKE2b/3',

  // ============================================================
  // 空态 / 错误
  // ============================================================
  'empty.noData': '暂无数据',
  'empty.noResults': '无匹配结果',
  'error.network': '网络请求失败，请检查后端是否启动',
  'error.loadFailed': '加载失败',
  'error.saveFailed': '保存失败',
  'error.buildFailed': '构建失败',
  'error.unknown': '未知错误',
};

// ── English dictionary ──────────────────────────────────────────

const EN: Record<string, string> = {
  'app.title': 'Dataset Intelligence Studio',
  'app.subtitle': 'Image Tone Clustering & Organization Tool',
  'common.home': '← Home',
  'common.save': '💾 Save',
  'common.saving': 'Saving...',
  'common.export': '📦 Export',
  'common.refresh': '↻ Refresh',
  'common.back': '←',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.close': 'Close',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.langSwitch': '中文',

  'home.newAnalysis': 'New Analysis',
  'home.newAnalysis.desc': 'Submit a new image analysis task, view real-time logs & progress',
  'home.organize': 'Organize Board',
  'home.organize.desc': 'Drag & drop images between clusters, save, export, recluster preview',
  'home.analysis': 'Analysis Channels',
  'home.analysis.desc': 'Browse metadata sorting, histogram labels, quality assessment',
  'home.legacyNote': 'Legacy UI is still accessible at /app/ (compatibility only)',

  'newAnalysis.title': 'New Analysis',
  'newAnalysis.input.title': '📂 1. Input',
  'newAnalysis.input.imageDir': 'Image Directory *',
  'newAnalysis.input.outputDir': 'Output Directory *',
  'newAnalysis.input.scan': 'Scan',
  'newAnalysis.input.scanning': 'Scanning...',
  'newAnalysis.clusterConfig.title': '🧬 2. Cluster Config (read-only)',
  'newAnalysis.channels.title': '📊 3. Analysis Channels (sort/filter only, not in default clustering)',
  'newAnalysis.channels.basicMetadata': 'Basic metadata — resolution, aspect ratio, over/under-exposure',
  'newAnalysis.channels.histogram': 'Histogram — brightness, saturation, hue distribution & labels',
  'newAnalysis.channels.qualityEdge': 'Quality-edge — blur, sharpness, edge density, local contrast',
  'newAnalysis.channels.note': 'Build strategy: channels are built sequentially after clustering completes. Not part of default clustering — only used for sorting, filtering, and review.',
  'newAnalysis.run.title': '🚀 4. Run & Results',
  'newAnalysis.run.start': 'Start Analysis',
  'newAnalysis.run.starting': 'Starting...',
  'newAnalysis.run.analysis': '📊 Analysis',
  'newAnalysis.run.home': '🏠 Home',
  'newAnalysis.run.failed': 'Task failed. Check the log above for details, adjust input and retry.',
  'newAnalysis.run.running': 'Running — do not close the page. Results will appear automatically.',

  'analysis.title': 'Analysis Channels',
  'analysis.loadBtn': 'Load Analysis',
  'analysis.channels': 'Analysis Channels',
  'analysis.build': 'Build',
  'analysis.building': 'Building...',
  'analysis.ready': 'Ready',
  'analysis.placeholder': 'Enter a job ID above to load analysis data.',
  'analysis.metadata.title': 'Metadata Summary',

  'organize.title': 'Organize Board',
  'organize.selectJob': 'Organize V2 — Select Job',
  'organize.noJobs': 'No jobs found. Create one in New Analysis first.',
  'organize.loading': 'Loading organize data...',
  'organize.noClusters': 'No clusters found.',
  'organize.back': '←',
  'organize.save': '💾 Save',
  'organize.saving': 'Saving...',
  'organize.export': '📦 Export',
  'organize.refresh': '↻ Refresh',
  'organize.expandAll': '⊟ Collapse All',
  'organize.collapseAll': '⊞ Expand All',
  'organize.repack': '📌 Repack',
  'organize.bestView': '🎯 Best View',
  'organize.thumbnail': 'Thumbnail',
  'organize.preview': '🔬 Preview',
  'organize.sort': '📊 Sort ⏳',
  'organize.selected': 'Selected',
  'organize.clear': '✕ Clear',

  'channel.basicMetadata': 'Basic Info',
  'channel.basicMetadata.desc': 'Resolution, aspect ratio, over/under-exposure',
  'channel.histogram': 'Exposure & Color',
  'channel.histogram.desc': 'Brightness, saturation, color temperature distribution',
  'channel.qualityEdge': 'Quality & Edge',
  'channel.qualityEdge.desc': 'Blur, sharpness, edge density, local contrast',

  'analysis.panel.basicInfo': 'Basic Info',
  'analysis.panel.basicInfo.desc': 'Resolution, dimensions, alpha channel, over/under-exposure',
  'analysis.panel.exposureColor': 'Exposure / Color',
  'analysis.panel.exposureColor.desc': 'Brightness distribution, saturation, color temperature, histogram anomaly detection',
  'analysis.panel.qualityEdge': 'Quality / Edge',
  'analysis.panel.qualityEdge.desc': 'Blur detection, sharpness, edge density, local contrast',
  'analysis.panel.duplicateGroups': 'Duplicate Detection',
  'analysis.panel.duplicateGroups.desc': 'Find exact and perceptually similar duplicate images',
  'analysis.panel.modelPlugins': 'Optional Model Analysis',
  'analysis.panel.modelPlugins.desc': 'Plug in third-party models for style/tag/detection analysis',

  'analysis.debugToggle': '🔬 Debug View',
  'analysis.debugToggleOff': 'Normal View',
  'analysis.sortAction': 'Sort',
  'analysis.filterAction': 'Filter',
  'analysis.buildAction': 'Build Channel',
  'analysis.buildingAction': 'Building...',
  'analysis.fieldCount': '{n} fields',
  'analysis.sortableCount': '{n} sortable',
  'analysis.filterableCount': '{n} filterable',
  'analysis.representativeFields': 'Representative fields: {fields}',
  'analysis.debugOnlyFields': 'Debug-only: {fields}',
  'analysis.clusterParticipation': 'Participates in default clustering',
  'analysis.notParticipateClustering': 'Does not participate in default clustering',
  'analysis.comingSoon': 'Coming Soon',
  'analysis.comingSoon.desc': 'This feature is under development.',
  'analysis.notBuilt': 'Not Built',
  'analysis.notBuilt.desc': 'Build this channel to sort and filter images by its features.',
  'analysis.notBuildable': 'Not Available',
  'analysis.notBuildable.desc': 'This channel requires a future version.',
  'analysis.viewData': 'View Data',
  'analysis.sourceChannel': 'Source: {channel}',
  'analysis.unit': 'Unit: {unit}',

  'plugin.title': 'Optional Model Analysis',
  'plugin.title.desc': 'Plug in third-party models for tagging, detection, style analysis (optional, does not affect main pipeline)',
  'plugin.installed': '✅ Installed',
  'plugin.notInstalled': '❌ Not Installed',
  'plugin.available': '✅ Available',
  'plugin.notAvailable': '⏳ Unavailable',
  'plugin.requiresGpu': 'GPU Required',
  'plugin.noGpu': 'CPU Available',
  'plugin.offlineSupported': 'Offline',
  'plugin.offlineNotSupported': 'Requires Network',
  'plugin.modelSize': 'Model Size: {size} MB',
  'plugin.failureMode': 'Fallback: {mode}',
  'plugin.failureMode.skip': 'Skip',
  'plugin.version': 'Version {ver}',
  'plugin.notAffectMain': 'Optional, does not affect main pipeline',
  'plugin.statusNotBuilt': 'Environment probe only, no model inference',

  'duplicate.title': 'Duplicate Groups',
  'duplicate.build': 'Build Duplicate Detection',
  'duplicate.building': 'Computing hashes...',
  'duplicate.exactGroup': 'Exact Duplicate',
  'duplicate.perceptualGroup': 'Near Duplicate',
  'duplicate.groupCount': '{n} duplicate groups',
  'duplicate.imageCount': '{n} duplicate images',
  'duplicate.totalChecked': '{n} images checked',
  'duplicate.hitEvidence': 'Match evidence: {algorithms}',
  'duplicate.representative': 'Representative',
  'duplicate.members': 'Members',
  'duplicate.noGroups': 'No duplicate images found',
  'duplicate.noGroups.desc': 'All images are unique',
  'duplicate.action.keep': '✅ Keep',
  'duplicate.action.mark': '🏷️ Mark',
  'duplicate.action.move': '📦 Move Candidate',
  'duplicate.action.none': '— Unprocessed',
  'duplicate.action.keep.hint': 'Confirm these are duplicates, keep as-is',
  'duplicate.action.mark.hint': 'Mark for manual review',
  'duplicate.action.move.hint': 'Mark as move candidate (logical flag only, files not moved)',
  'duplicate.blake3.note': 'Hash engine: {note}',
  'duplicate.viewGroups': 'View Duplicate Groups',
  'duplicate.filter.exact': 'Exact only',
  'duplicate.filter.perceptual': 'Near only',
  'duplicate.filter.all': 'All groups',
  'duplicate.algorithm.phash': 'Perceptual hash (phash)',
  'duplicate.algorithm.dhash': 'Difference hash (dhash)',
  'duplicate.algorithm.whash': 'Wavelet hash (whash)',
  'duplicate.algorithm.colorhash': 'Color hash (colorhash)',
  'duplicate.algorithm.file_size': 'File size',
  'duplicate.algorithm.sha256': 'SHA-256',
  'duplicate.algorithm.blake3': 'BLAKE2b/3',

  'empty.noData': 'No data',
  'empty.noResults': 'No matching results',
  'error.network': 'Network request failed. Is the backend running?',
  'error.loadFailed': 'Load failed',
  'error.saveFailed': 'Save failed',
  'error.buildFailed': 'Build failed',
  'error.unknown': 'Unknown error',
};

// ── Lookup ──────────────────────────────────────────────────────

/**
 * 获取 UI 文案（自动按当前语言返回）
 * @param key 文案 key
 * @param fallback 回退文案（默认返回 key 本身方便调试）
 */
export function t(key: string, fallback?: string): string {
  if (_lang === 'en') {
    return EN[key] ?? ZH[key] ?? fallback ?? key;
  }
  return ZH[key] ?? fallback ?? key;
}

export default ZH;
