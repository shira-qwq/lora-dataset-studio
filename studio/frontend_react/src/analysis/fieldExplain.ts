/**
 * fieldExplain — 面向用户的字段中文解释
 *
 * 每个字段提供：
 * - what: 这代表什么
 * - usage: 你可以用它找什么图
 * - value_hint: 数值怎么理解
 *
 * 格式："这代表什么 / 你可以用它找什么图"
 */

export interface FieldExplain {
  /** 简短中文标题 */
  title: string;
  /** "这代表什么" 部分 */
  what: string;
  /** "你可以用它找什么图" 部分 */
  usage: string;
  /** 数值理解提示 */
  value_hint: string;
}

const EXPLAIN_DICT: Record<string, FieldExplain> = {
  // ============================================================
  // Basic Metadata
  // ============================================================
  width: {
    title: '宽度',
    what: '图片的像素宽度，即横向有多少个像素点。',
    usage: '找宽幅图片或特定比例的素材。',
    value_hint: '值越大图片越宽，单位 px。',
  },
  height: {
    title: '高度',
    what: '图片的像素高度，即纵向有多少个像素点。',
    usage: '找长图或特定比例的素材。',
    value_hint: '值越大图片越高，单位 px。',
  },
  megapixels: {
    title: '像素数',
    what: '图片的总像素数量，按百万像素（Megapixel）计算。',
    usage: '找高分辨率或低分辨率图片，适合筛选素材精度。',
    value_hint: '值越大分辨率越高，1MP ≈ 100 万像素。',
  },
  short_side: {
    title: '短边',
    what: '图片宽度和高度的较小值。',
    usage: '找小尺寸或大尺寸图片的底边。',
    value_hint: '单位 px，值越大短边越长。',
  },
  long_side: {
    title: '长边',
    what: '图片宽度和高度的较大值。',
    usage: '找长边特别长或特别短的图片。',
    value_hint: '单位 px，值越大长边越长。',
  },
  aspect_ratio: {
    title: '宽高比',
    what: '图片宽度与高度的比值，横图 > 1，竖图 < 1，方图 = 1。',
    usage: '快速筛选横图、竖图或方形图片。',
    value_hint: '>1 为横图，<1 为竖图，=1 为方图。',
  },
  file_size_mb: {
    title: '文件大小',
    what: '图片文件在磁盘上占用的存储空间。',
    usage: '找体积异常的大文件（可能未压缩）或小文件（可能缩略图）。',
    value_hint: '单位 MB，值越大文件越大。',
  },
  has_alpha: {
    title: '含 Alpha',
    what: '图片是否包含透明通道（Alpha Channel）。',
    usage: '快速筛选 PNG 透明素材或带透明通道的图片。',
    value_hint: '是/否。',
  },
  transparent_ratio: {
    title: '透明占比',
    what: '图片中透明像素占总像素的比例。',
    usage: '找半透明素材、图标、贴图元素。',
    value_hint: '值越大透明区域越多，100% 为全透明。',
  },
  overexposed_ratio: {
    title: '过曝占比',
    what: '图片中过曝（亮度接近纯白）像素的比例。',
    usage: '找过曝严重、可能有白块或细节丢失的图片。',
    value_hint: '值越大过曝区域越多，可能丢失高光细节。',
  },
  underexposed_ratio: {
    title: '死黑占比',
    what: '图片中死黑（亮度接近纯黑）像素的比例。',
    usage: '找死黑严重的图片，暗部可能缺少可见细节。',
    value_hint: '值越大死黑区域越多，可能丢失阴影细节。',
  },
  clipping_ratio: {
    title: '裁剪占比',
    what: '过曝与死黑像素的总比例，表示动态范围溢出程度。',
    usage: '找动态范围不足、高光和暗部同时丢失细节的图片。',
    value_hint: '值越大动态溢出越严重。',
  },

  // ============================================================
  // Histogram Fields
  // ============================================================
  brightness_dark_ratio: {
    title: '暗部占比',
    what: '直方图中暗部区域（低亮度）像素占全图的比例。',
    usage: '找偏暗的图片，适合夜景、暗背景素材。',
    value_hint: '值越大暗部越多，图片整体偏暗。',
  },
  brightness_bright_ratio: {
    title: '亮部占比',
    what: '直方图中亮部区域（高亮度）像素占全图的比例。',
    usage: '找偏亮的图片，适合白底、日光素材。',
    value_hint: '值越大亮部越多，图片整体偏亮。',
  },
  saturation_low_ratio: {
    title: '低饱和占比',
    what: '图片中低饱和度（接近灰阶）像素的比例。',
    usage: '找低饱和度/黑白风格、褪色效果或灰度图片。',
    value_hint: '值越大颜色越素，接近黑白。',
  },
  saturation_high_ratio: {
    title: '高饱和占比',
    what: '图片中高饱和度（颜色鲜艳）像素的比例。',
    usage: '找色彩鲜艳、高冲击力的图片，适合二次元或强色彩素材。',
    value_hint: '值越大颜色越鲜艳。',
  },
  hue_warm_ratio: {
    title: '暖色调占比',
    what: '图片中暖色（红/橙/黄）像素占总色彩像素的比例。',
    usage: '找暖色倾向的图片，适合日落、灯光、暖调素材。',
    value_hint: '值越大画面越偏暖色。',
  },
  hue_cool_ratio: {
    title: '冷色调占比',
    what: '图片中冷色（蓝/绿/紫）像素占总色彩像素的比例。',
    usage: '找冷色倾向的图片，适合夜景、天空、水面素材。',
    value_hint: '值越大画面越偏冷色。',
  },
  labels: {
    title: '直方图标签',
    what: '直方图形状的自动分类标签，描述亮度分布特征。',
    usage: '按"高调""低调""高对比""平光"等特征快速筛选图片。',
    value_hint: '文本标签，不是数值。',
  },

  // ============================================================
  // Quality Edge Fields
  // ============================================================
  sharpness_score: {
    title: '锐度评分',
    what: '基于拉普拉斯算子计算的图像整体锐度评分。',
    usage: '找清晰图片或模糊图片的初步参考。',
    value_hint: '值越大图片越锐利清晰。',
  },
  blur_laplacian_var: {
    title: '拉普拉斯方差',
    what: '拉普拉斯变换的方差值，衡量图像边缘的清晰程度。',
    usage: '找失焦模糊、运动模糊或压缩模糊的图片。值越小越模糊。',
    value_hint: '值越小越模糊，值越大越清晰。通常 < 100 为模糊。',
  },
  edge_density: {
    title: '边缘密度',
    what: 'Canny 边缘检测算法检测到的边缘像素占全图的比例。',
    usage: '找边缘丰富的图片（高细节）或边缘稀疏的图片（平滑/模糊）。',
    value_hint: '值越大边缘越多，图片细节越丰富。',
  },
  lineart_score_v2: {
    title: '线稿得分',
    what: '检测图片是否偏向线稿/插画风格的综合评分。',
    usage: '找线稿、漫画、结构图等边缘清晰且色彩较少的图片。',
    value_hint: '值越大概率越高，>0.5 可认为偏向线稿风格。',
  },
  high_contrast_score_v2: {
    title: '高对比得分',
    what: '检测图片是否具有高对比度特征的综合评分。',
    usage: '找明暗对比强烈、光影分明的图片。',
    value_hint: '值越大概率越高。',
  },
  flat_color_score: {
    title: '平涂得分',
    what: '检测图片是否偏向平涂/低纹理风格的综合评分。',
    usage: '找平涂风格、卡通渲染或纹理较少的图片。',
    value_hint: '值越大概率越高。',
  },
  local_contrast_p95: {
    title: '局部对比度 P95',
    what: '局部区域对比度的第 95 百分位数，衡量局部细节可见度。',
    usage: '找局部细节丰富的图片或整体偏平的图片。',
    value_hint: '值越大局部对比越强，细节越清晰。',
  },
  hue_coverage: {
    title: '色相覆盖度',
    what: '色相环上非零像素的覆盖范围，0~1。',
    usage: '找色彩丰富（覆盖广）或色彩单一（覆盖窄）的图片。',
    value_hint: '值越大色彩越丰富，值越小色调越单一。',
  },
};

/**
 * 获取字段的中文解释
 */
export function getFieldExplain(key: string): FieldExplain | undefined {
  return EXPLAIN_DICT[key];
}

/**
 * 获取面向用户的简短中文说明（用于 hover tooltip）
 * 格式："这代表什么 / 你可以用它找什么图"
 */
export function getFieldExplainShort(key: string): string {
  const exp = EXPLAIN_DICT[key];
  if (!exp) return '';
  return `${exp.what} ${exp.usage}`;
}

export default EXPLAIN_DICT;
