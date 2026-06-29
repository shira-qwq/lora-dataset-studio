/**
 * inspectionDictionary — 图片巡检切片文案（中英双语）
 *
 * 所有面向用户的切片名称、说明和提示在此定义。
 * 组件只引用 ID，所有可见文案通过本字典输出。
 */

import { getLanguage } from '../i18n/uiDictionary';

export interface SliceCopy {
  /** 切片中文名称（简短，适合 chip/button） */
  label_zh: string;
  /** 切片英文名称 */
  label_en?: string;
  /** 切片中文说明（详细，适合 tooltip/description） */
  description_zh: string;
  /** 切片英文说明 */
  description_en?: string;
  /** 空态标题（中文） */
  emptyStateTitle: string;
  /** 空态标题（英文） */
  emptyStateTitleEn?: string;
  /** 空态说明（中文） */
  emptyStateDescription: string;
  /** 空态说明（英文） */
  emptyStateDescriptionEn?: string;
  /** 通道未构建时的不可用提示（中文） */
  unavailableReason: string;
  /** 通道未构建时的不可用提示（英文） */
  unavailableReasonEn?: string;
}

/** 按当前语言返回 label */
export function getSliceLabel(sliceId: string): string {
  const copy = DICT[sliceId];
  if (!copy) return sliceId;
  if (getLanguage() === 'en' && copy.label_en) return copy.label_en;
  return copy.label_zh;
}

/** 按当前语言返回 description */
export function getSliceDescription(sliceId: string): string {
  const copy = DICT[sliceId];
  if (!copy) return '';
  if (getLanguage() === 'en' && copy.description_en) return copy.description_en;
  return copy.description_zh;
}

/**
 * 获取切片的中文文案（原始数据，不含语言切换——使用 getSliceCopyWithLang 进行语言切换）
 */
export function getSliceCopy(sliceId: string): SliceCopy | undefined {
  return DICT[sliceId];
}

/**
 * 获取切片文案（按当前语言）
 */
export function getSliceCopyWithLang(sliceId: string): SliceCopy | undefined {
  const copy = DICT[sliceId];
  if (!copy) return undefined;
  if (getLanguage() === 'en') {
    return {
      ...copy,
      label_zh: copy.label_en || copy.label_zh,
      description_zh: copy.description_en || copy.description_zh,
      emptyStateTitle: copy.emptyStateTitleEn || copy.emptyStateTitle,
      emptyStateDescription: copy.emptyStateDescriptionEn || copy.emptyStateDescription,
      unavailableReason: copy.unavailableReasonEn || copy.unavailableReason,
    };
  }
  return copy;
}

const DICT: Record<string, SliceCopy> = {
  // ============================================================
  // All
  // ============================================================
  all: {
    label_zh: '全部',
    label_en: 'All',
    description_zh: '显示当前任务的所有图片',
    description_en: 'Show all images in the current task',
    emptyStateTitle: '暂无图片',
    emptyStateTitleEn: 'No Images',
    emptyStateDescription: '当前任务没有包含任何图片，请检查输入目录。',
    emptyStateDescriptionEn: 'No images found. Please check the input directory.',
    unavailableReason: '',
  },

  // ============================================================
  // Brightness group
  // ============================================================
  low_brightness: {
    label_zh: '低亮度',
    label_en: 'Low Brightness',
    description_zh: '这张图整体偏暗，适合查找夜景、暗背景、低调光影素材。',
    description_en: 'Overall dark image — good for finding night scenes, dark backgrounds, low-key lighting.',
    emptyStateTitle: '暂无低亮度图片',
    emptyStateTitleEn: 'No Low-Brightness Images',
    emptyStateDescription: '当前切片没有找到明显偏暗的图片。可以切换到"全部"，或调整亮度筛选范围。',
    emptyStateDescriptionEn: 'No noticeably dark images found. Switch to "All" or adjust brightness filters.',
    unavailableReason: '需要先构建"曝光色彩"通道。构建后可以按亮度巡检图片。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first to inspect by brightness.',
  },
  medium_brightness: {
    label_zh: '中亮度',
    label_en: 'Medium Brightness',
    description_zh: '画面亮度适中，没有明显的过亮或过暗区域。',
    description_en: 'Balanced brightness with no明显 overexposed or underexposed areas.',
    emptyStateTitle: '暂无中亮度图片',
    emptyStateTitleEn: 'No Medium-Brightness Images',
    emptyStateDescription: '当前切片没有找到亮度适中的图片。',
    emptyStateDescriptionEn: 'No evenly-lit images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  high_brightness: {
    label_zh: '高亮度',
    label_en: 'High Brightness',
    description_zh: '画面整体更亮，适合找白底、日光、明亮空间素材。',
    description_en: 'Overall bright image — good for white backgrounds, daylight, bright spaces.',
    emptyStateTitle: '暂无高亮度图片',
    emptyStateTitleEn: 'No High-Brightness Images',
    emptyStateDescription: '当前切片没有找到明显偏亮的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No noticeably bright images found. Switch to "All".',
    unavailableReason: '需要先构建"曝光色彩"通道。构建后可以按亮度巡检图片。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first to inspect by brightness.',
  },
  high_contrast: {
    label_zh: '高对比',
    label_en: 'High Contrast',
    description_zh: '明暗对比强烈，亮部和暗部差异明显。适合找光影分明的素材。',
    description_en: 'Strong light-dark contrast — good for dramatic lighting素材.',
    emptyStateTitle: '暂无高对比图片',
    emptyStateTitleEn: 'No High-Contrast Images',
    emptyStateDescription: '当前切片没有找到高对比的图片。',
    emptyStateDescriptionEn: 'No high-contrast images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  flat_light: {
    label_zh: '平光',
    label_en: 'Flat Lighting',
    description_zh: '画面光照均匀，没有强烈明暗对比。适合找柔和、平光素材。',
    description_en: 'Even lighting with no strong contrast — good for soft, flat-lit素材.',
    emptyStateTitle: '暂无平光图片',
    emptyStateTitleEn: 'No Flat-Lit Images',
    emptyStateDescription: '当前切片没有找到平光图片。',
    emptyStateDescriptionEn: 'No flat-lit images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  strong_highlight: {
    label_zh: '强高光',
    label_en: 'Strong Highlight',
    description_zh: '高光区域明显突出，可能有局部过亮或反光效果。',
    description_en: 'Prominent highlight areas — may have局部 overexposure or reflections.',
    emptyStateTitle: '暂无强高光图片',
    emptyStateTitleEn: 'No Strong-Highlight Images',
    emptyStateDescription: '当前切片没有找到强高光图片。',
    emptyStateDescriptionEn: 'No strong-highlight images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  dark_shadow: {
    label_zh: '暗部多',
    label_en: 'Dark Shadows',
    description_zh: '暗部区域占比较高，可能有大量阴影或深色背景。',
    description_en: 'High proportion of dark areas — may have heavy shadows or dark backgrounds.',
    emptyStateTitle: '暂无暗部多的图片',
    emptyStateTitleEn: 'No Heavy-Shadow Images',
    emptyStateDescription: '当前切片没有找到暗部占比较高的图片。',
    emptyStateDescriptionEn: 'No images with heavy shadows found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },

  // ============================================================
  // Color group
  // ============================================================
  red_theme: {
    label_zh: '红色主题',
    label_en: 'Red Theme',
    description_zh: '画面以红色调为主，适合找红底、红花、红色系素材。',
    description_en: 'Predominantly red tones — red backgrounds, flowers, red-themed素材.',
    emptyStateTitle: '暂无红色主题图片',
    emptyStateTitleEn: 'No Red-Theme Images',
    emptyStateDescription: '当前切片没有找到红色调明显的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No predominantly red images found. Switch to "All".',
    unavailableReason: '需要先构建"曝光色彩"通道。构建后可以按色彩主题巡检图片。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first to inspect by color theme.',
  },
  orange_yellow_theme: {
    label_zh: '橙黄主题',
    label_en: 'Orange-Yellow Theme',
    description_zh: '画面以橙黄色调为主，适合找日落、暖光、秋色素材。',
    description_en: 'Predominantly orange-yellow tones — sunsets, warm light, autumn colors.',
    emptyStateTitle: '暂无橙黄主题图片',
    emptyStateTitleEn: 'No Orange-Yellow Images',
    emptyStateDescription: '当前切片没有找到橙黄色调明显的图片。',
    emptyStateDescriptionEn: 'No predominantly orange-yellow images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  green_theme: {
    label_zh: '绿色主题',
    label_en: 'Green Theme',
    description_zh: '画面以绿色调为主，适合找自然、植物、森林素材。',
    description_en: 'Predominantly green tones — nature, plants, forests.',
    emptyStateTitle: '暂无绿色主题图片',
    emptyStateTitleEn: 'No Green-Theme Images',
    emptyStateDescription: '当前切片没有找到绿色调明显的图片。',
    emptyStateDescriptionEn: 'No predominantly green images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  blue_cyan_theme: {
    label_zh: '青蓝主题',
    label_en: 'Blue-Cyan Theme',
    description_zh: '画面以蓝青色调为主，适合找天空、水面、冷调素材。',
    description_en: 'Predominantly blue-cyan tones — sky, water, cool tones.',
    emptyStateTitle: '暂无青蓝主题图片',
    emptyStateTitleEn: 'No Blue-Cyan Images',
    emptyStateDescription: '当前切片没有找到蓝青色明显的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No predominantly blue-cyan images found. Switch to "All".',
    unavailableReason: '需要先构建"曝光色彩"通道。构建后可以按色彩主题巡检图片。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first to inspect by color theme.',
  },
  purple_theme: {
    label_zh: '紫色主题',
    label_en: 'Purple Theme',
    description_zh: '画面以紫色调为主，适合找紫调、梦幻、氛围感素材。',
    description_en: 'Predominantly purple tones — dreamy, atmospheric素材.',
    emptyStateTitle: '暂无紫色主题图片',
    emptyStateTitleEn: 'No Purple-Theme Images',
    emptyStateDescription: '当前切片没有找到紫色调明显的图片。',
    emptyStateDescriptionEn: 'No predominantly purple images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  warm_tone: {
    label_zh: '暖色倾向',
    label_en: 'Warm Tone',
    description_zh: '画面偏橙黄，暖色占比高。适合找日落、灯光、暖调素材。',
    description_en: 'Warm-toned — high proportion of orange-yellow. Sunsets, lamps, warm ambiance.',
    emptyStateTitle: '暂无暖色倾向图片',
    emptyStateTitleEn: 'No Warm-Tone Images',
    emptyStateDescription: '当前切片没有找到暖色倾斜明显的图片。',
    emptyStateDescriptionEn: 'No warm-toned images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  cool_tone: {
    label_zh: '冷色倾向',
    label_en: 'Cool Tone',
    description_zh: '画面偏蓝青，冷色占比高。适合找夜景、天空、水面素材。',
    description_en: 'Cool-toned — high proportion of blue-cyan. Night scenes, sky, water.',
    emptyStateTitle: '暂无冷色倾向图片',
    emptyStateTitleEn: 'No Cool-Tone Images',
    emptyStateDescription: '当前切片没有找到冷色倾斜明显的图片。',
    emptyStateDescriptionEn: 'No cool-toned images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  low_saturation: {
    label_zh: '低饱和',
    label_en: 'Low Saturation',
    description_zh: '颜色饱和度较低，接近黑白或褪色风格。适合找灰度、素雅素材。',
    description_en: 'Low color saturation —接近 grayscale or faded. Subtle, muted素材.',
    emptyStateTitle: '暂无低饱和图片',
    emptyStateTitleEn: 'No Low-Saturation Images',
    emptyStateDescription: '当前切片没有找到低饱和度图片。',
    emptyStateDescriptionEn: 'No low-saturation images found.',
    unavailableReason: '需要先构建"曝光色彩"通道。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first.',
  },
  high_saturation: {
    label_zh: '高饱和',
    label_en: 'High Saturation',
    description_zh: '颜色鲜艳饱满，色彩冲击力强。适合找二次元、高彩度素材。',
    description_en: 'Vibrant, saturated colors — anime, high-color素材.',
    emptyStateTitle: '暂无高饱和图片',
    emptyStateTitleEn: 'No High-Saturation Images',
    emptyStateDescription: '当前切片没有找到高饱和度图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No high-saturation images found. Switch to "All".',
    unavailableReason: '需要先构建"曝光色彩"通道。构建后可以按饱和度巡检图片。',
    unavailableReasonEn: 'Build the "Exposure & Color" channel first to inspect by saturation.',
  },

  // ============================================================
  // Quality / Edge group
  // ============================================================
  blur_suspect: {
    label_zh: '模糊可疑',
    label_en: 'Blur Suspect',
    description_zh: '细节锐度偏低，可能是失焦、压缩或运动模糊。',
    description_en: 'Low sharpness —可能 out of focus, compression artifacts, or motion blur.',
    emptyStateTitle: '暂无模糊可疑图片',
    emptyStateTitleEn: 'No Blur Suspects',
    emptyStateDescription: '当前切片没有找到明显模糊的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No明显 blurry images found. Switch to "All".',
    unavailableReason: '需要先构建"质量边缘"通道。构建后可以按模糊度巡检图片。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first to inspect by blur.',
  },
  sharp_image: {
    label_zh: '锐利图片',
    label_en: 'Sharp Image',
    description_zh: '图片整体锐度高，边缘清晰。适合找高质量清晰素材。',
    description_en: 'High overall sharpness with clear edges — high-quality素材.',
    emptyStateTitle: '暂无锐利图片',
    emptyStateTitleEn: 'No Sharp Images',
    emptyStateDescription: '当前切片没有找到锐度突出的图片。',
    emptyStateDescriptionEn: 'No exceptionally sharp images found.',
    unavailableReason: '需要先构建"质量边缘"通道。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first.',
  },
  line_art_candidate: {
    label_zh: '线稿候选',
    label_en: 'Lineart Candidate',
    description_zh: '边缘密度较高且色彩较少，可能是线稿、漫画或结构图。',
    description_en: 'High edge density with limited color — line art, manga, or structural drawings.',
    emptyStateTitle: '无线稿候选图片',
    emptyStateTitleEn: 'No Lineart Candidates',
    emptyStateDescription: '当前切片没有找到线稿风格的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No lineart-style images found. Switch to "All".',
    unavailableReason: '需要先构建"质量边缘"通道。构建后可以按线稿特征巡检图片。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first to inspect by lineart特征.',
  },
  flat_color_candidate: {
    label_zh: '平涂候选',
    label_en: 'Flat Color Candidate',
    description_zh: '色彩区域平整，纹理较少，可能是平涂风格或卡通渲染。',
    description_en: 'Flat color regions with limited texture — flat-shaded or cartoon rendering.',
    emptyStateTitle: '无平涂候选图片',
    emptyStateTitleEn: 'No Flat-Color Candidates',
    emptyStateDescription: '当前切片没有找到平涂风格的图片。',
    emptyStateDescriptionEn: 'No flat-color style images found.',
    unavailableReason: '需要先构建"质量边缘"通道。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first.',
  },
  high_edge_density: {
    label_zh: '高边缘密度',
    label_en: 'High Edge Density',
    description_zh: '边缘像素占比较高，细节丰富。适合找纹理丰富的图片。',
    description_en: 'High edge pixel ratio — rich in detail and texture.',
    emptyStateTitle: '暂无高边缘密度图片',
    emptyStateTitleEn: 'No High-Edge-Density Images',
    emptyStateDescription: '当前切片没有找到边缘密度较高的图片。',
    emptyStateDescriptionEn: 'No high-edge-density images found.',
    unavailableReason: '需要先构建"质量边缘"通道。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first.',
  },
  low_detail_image: {
    label_zh: '低细节图片',
    label_en: 'Low Detail Image',
    description_zh: '画面细节较少，边缘稀疏或整体模糊。',
    description_en: 'Limited detail — sparse edges or overall blur.',
    emptyStateTitle: '暂无低细节图片',
    emptyStateTitleEn: 'No Low-Detail Images',
    emptyStateDescription: '当前切片没有找到低细节图片。',
    emptyStateDescriptionEn: 'No low-detail images found.',
    unavailableReason: '需要先构建"质量边缘"通道。',
    unavailableReasonEn: 'Build the "Quality & Edge" channel first.',
  },

  // ============================================================
  // File / Basic Info group
  // ============================================================
  large_image: {
    label_zh: '大尺寸图',
    label_en: 'Large Image',
    description_zh: '图片分辨率较高，适合做印刷、大屏展示等高质量素材。',
    description_en: 'High-resolution image — suitable for print, large displays.',
    emptyStateTitle: '暂无大尺寸图片',
    emptyStateTitleEn: 'No Large Images',
    emptyStateDescription: '当前切片没有找到分辨率明显较大的图片。',
    emptyStateDescriptionEn: 'No noticeably large images found.',
    unavailableReason: '需要先构建"基础信息"通道。',
    unavailableReasonEn: 'Build the "Basic Info" channel first.',
  },
  small_image: {
    label_zh: '小尺寸图',
    label_en: 'Small Image',
    description_zh: '图片分辨率较低，可能需要确认是否用于正式用途。',
    description_en: 'Low-resolution image — verify suitability for正式 use.',
    emptyStateTitle: '暂无小尺寸图片',
    emptyStateTitleEn: 'No Small Images',
    emptyStateDescription: '当前切片没有找到小尺寸图片。',
    emptyStateDescriptionEn: 'No small images found.',
    unavailableReason: '需要先构建"基础信息"通道。',
    unavailableReasonEn: 'Build the "Basic Info" channel first.',
  },
  portrait_image: {
    label_zh: '竖图',
    label_en: 'Portrait',
    description_zh: '高度大于宽度的竖版图片，适合手机壁纸、海报等竖向排版。',
    description_en: 'Taller than wide — phone wallpapers, posters, vertical layouts.',
    emptyStateTitle: '暂无竖图',
    emptyStateTitleEn: 'No Portrait Images',
    emptyStateDescription: '当前切片没有找到竖版图片。',
    emptyStateDescriptionEn: 'No portrait-oriented images found.',
    unavailableReason: '需要先构建"基础信息"通道。',
    unavailableReasonEn: 'Build the "Basic Info" channel first.',
  },
  landscape_image: {
    label_zh: '横图',
    label_en: 'Landscape',
    description_zh: '宽度大于高度的横版图片，适合桌面壁纸、宽屏展示。',
    description_en: 'Wider than tall — desktop wallpapers, widescreen display.',
    emptyStateTitle: '暂无横图',
    emptyStateTitleEn: 'No Landscape Images',
    emptyStateDescription: '当前切片没有找到横版图片。',
    emptyStateDescriptionEn: 'No landscape-oriented images found.',
    unavailableReason: '需要先构建"基础信息"通道。',
    unavailableReasonEn: 'Build the "Basic Info" channel first.',
  },
  square_image: {
    label_zh: '方图',
    label_en: 'Square',
    description_zh: '宽度和高度接近相等的方形图片。',
    description_en: 'Approximately equal width and height.',
    emptyStateTitle: '暂无方图',
    emptyStateTitleEn: 'No Square Images',
    emptyStateDescription: '当前切片没有找到方形图片。',
    emptyStateDescriptionEn: 'No square images found.',
    unavailableReason: '需要先构建"基础信息"通道。',
    unavailableReasonEn: 'Build the "Basic Info" channel first.',
  },
  transparent_image: {
    label_zh: '透明图',
    label_en: 'Transparent',
    description_zh: '图片包含透明通道，适合单独整理贴图、素材、PNG 元素。',
    description_en: 'Contains an alpha channel — textures, PNG elements, overlays.',
    emptyStateTitle: '暂无透明图',
    emptyStateTitleEn: 'No Transparent Images',
    emptyStateDescription: '当前切片没有找到带透明通道的图片。',
    emptyStateDescriptionEn: 'No images with alpha channel found.',
    unavailableReason: '需要先构建"基础信息"通道。构建后可以按透明通道筛选。',
    unavailableReasonEn: 'Build the "Basic Info" channel first to filter by alpha channel.',
  },
  overexposed_suspect: {
    label_zh: '过曝可疑',
    label_en: 'Overexposed Suspect',
    description_zh: '高光区域较多，可能有白块或细节丢失。',
    description_en: 'Large highlight areas —可能 blown-out whites or detail loss.',
    emptyStateTitle: '无过曝可疑图片',
    emptyStateTitleEn: 'No Overexposed Suspects',
    emptyStateDescription: '当前切片没有找到过曝明显的图片。可以切换到"全部"。',
    emptyStateDescriptionEn: 'No明显 overexposed images found. Switch to "All".',
    unavailableReason: '需要先构建"基础信息"通道。构建后可以按过曝比例筛选。',
    unavailableReasonEn: 'Build the "Basic Info" channel first to filter by overexposure ratio.',
  },
  underexposed_suspect: {
    label_zh: '死黑可疑',
    label_en: 'Underexposed Suspect',
    description_zh: '暗部接近纯黑，可能缺少可见细节。',
    description_en: 'Dark areas near pure black —可能 lack visible detail.',
    emptyStateTitle: '无死黑可疑图片',
    emptyStateTitleEn: 'No Underexposed Suspects',
    emptyStateDescription: '当前切片没有找到死黑严重的图片。',
    emptyStateDescriptionEn: 'No severely underexposed images found.',
    unavailableReason: '需要先构建"基础信息"通道。构建后可以按死黑比例筛选。',
    unavailableReasonEn: 'Build the "Basic Info" channel first to filter by underexposure ratio.',
  },

  // ============================================================
  // Duplicate groups
  // ============================================================
  duplicate_groups: {
    label_zh: '重复图检测',
    label_en: 'Duplicate Detection',
    description_zh: '查找完全一致和感知相似的重复图片，按组分开展示。',
    description_en: 'Find exact and perceptually similar duplicates, grouped for review.',
    emptyStateTitle: '暂无重复图数据',
    emptyStateTitleEn: 'No Duplicate Data',
    emptyStateDescription: '先构建重复图检测通道，即可按组浏览重复图片。',
    emptyStateDescriptionEn: 'Build the duplicate detection channel to browse duplicate groups.',
    unavailableReason: '需要先构建"重复图检测"通道。构建后可以按组浏览重复图片。',
    unavailableReasonEn: 'Build the "Duplicate Detection" channel first to browse groups.',
  },
};

/** 获取切片的中文文案 */
export function getSliceCopyRaw(sliceId: string): SliceCopy | undefined {
  return DICT[sliceId];
}

export default DICT;
