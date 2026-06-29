/**
 * channelDictionary — 分析通道中文信息
 *
 * 定义每个 analysis channel 的中文名、说明、构建后可用功能。
 * 用于组件展示和 fallback 提示。
 */

export interface ChannelInfo {
  /** 通道 ID (machine key) */
  id: string;
  /** 中文名称 */
  label_zh: string;
  /** 中文说明 */
  description_zh: string;
  /** 通道分组 */
  group: 'brightness' | 'color' | 'quality_edge' | 'file' | 'plugin';
  /** 构建后可用功能的提示 */
  capability_hint: string;
}

const CHANNEL_DICT: Record<string, ChannelInfo> = {
  histogram: {
    id: 'histogram',
    label_zh: '曝光色彩',
    description_zh: '亮度分布、饱和度、色温、直方图标签',
    group: 'brightness',
    capability_hint: '构建后可以按亮度、饱和度、冷暖和主题色巡检图片',
  },
  basic_metadata: {
    id: 'basic_metadata',
    label_zh: '基础信息',
    description_zh: '分辨率、尺寸、透明通道、过曝/死黑',
    group: 'file',
    capability_hint: '构建后可以按文件尺寸、比例、透明度和曝光异常筛选图片',
  },
  quality_edge: {
    id: 'quality_edge',
    label_zh: '质量边缘',
    description_zh: '模糊检测、锐度、边缘密度、线稿识别',
    group: 'quality_edge',
    capability_hint: '构建后可以按模糊度、锐度、边缘密度和线稿特征筛选图片',
  },
  duplicate_groups: {
    id: 'duplicate_groups',
    label_zh: '重复图检测',
    description_zh: '完全一致和感知相似的重复图片',
    group: 'file',
    capability_hint: '构建后可以查看和审查重复图片组',
  },
  model_plugins: {
    id: 'model_plugins',
    label_zh: '模型分析',
    description_zh: '接入第三方模型进行风格/标签/检测分析',
    group: 'plugin',
    capability_hint: '安装插件后可以按风格、标签等维度分析图片',
  },
};

/**
 * 获取通道中文信息
 */
export function getChannelInfo(channelKey: string): ChannelInfo | undefined {
  return CHANNEL_DICT[channelKey];
}

/**
 * 获取通道构建不可用的提示文案
 */
export function getChannelUnavailableReason(channelKey: string): string {
  const info = getChannelInfo(channelKey);
  if (!info) return `需要先构建对应分析通道`;
  return `需要先构建"${info.label_zh}"通道。${info.capability_hint}。`;
}

export default CHANNEL_DICT;
