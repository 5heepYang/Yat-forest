/**
 * 树种插画：把「树种名」映射到一张图
 *
 * 背景：原来林地页的展示图是硬编码的 palm.png（大王椰），
 * 结果香樟、木棉、水杉全都长成了椰子树。
 *
 * 三层兜底，保证任何树种都不会退化成"又是椰子树"：
 *   1. 精确 / 同义词（大王椰子、香樟、木棉…）→ 该树种的专属插画
 *   2. 认不出具体品种时按形态族归类（棕榈 / 针叶塔形 / 开花乔木 / 常绿阔叶 / 落叶阔叶）
 *      → 用该族代表插画，形状对得上，不会一眼假
 *   3. 连形态都归不了（AI 返回"未识别"、或者生僻种）→ 通用阔叶树
 *
 * 图片规格：512×512 扁平插画、纯白底、暖棕细描边，总 452 KB。
 * 加新树种的两种办法：
 *   a. 往 static/illus/species/ 放一张同名 png，在 ALIAS 里加一行映射（要重新发版）
 *   b. 以后接云端图库：路径可预测（/species/<slug>.png），拖图进云存储即可，不用改代码
 */
const DIR = '/static/illus/species/'
const GENERIC = 'generic-tree'

/** 精确匹配 + 同义词：命中就直接用，不再往下猜 */
const ALIAS = {
  // 棕榈族
  '大王椰子': 'coconut-palm',
  '大王椰': 'coconut-palm',
  '椰子': 'coconut-palm',
  '棕榈': 'coconut-palm',
  '棕竹': 'coconut-palm',
  '蒲葵': 'coconut-palm',
  '假槟榔': 'coconut-palm',
  '苏铁': 'coconut-palm',
  // 常绿阔叶
  '细叶榕': 'banyan',
  '小叶榕': 'banyan',
  '榕树': 'banyan',
  '高山榕': 'banyan',
  '垂叶榕': 'banyan',
  '香樟': 'camphor',
  '樟树': 'camphor',
  '樟': 'camphor',
  '阴香': 'camphor',
  // 落叶 / 开花
  '白玉兰': 'magnolia',
  '玉兰': 'magnolia',
  '紫玉兰': 'magnolia',
  '广玉兰': 'magnolia',
  '木棉': 'kapok',
  '英雄树': 'kapok',
  '美丽异木棉': 'kapok',
  // 针叶
  '水杉': 'dawn-redwood',
  '落羽杉': 'dawn-redwood',
  '池杉': 'dawn-redwood',
  // 桉类
  '柠檬桉': 'lemon-gum',
  '桉树': 'lemon-gum',
  '大叶桉': 'lemon-gum',
  '白千层': 'lemon-gum',
  // 层状分枝
  '小叶榄仁': 'sea-almond',
  '榄仁': 'sea-almond',
  '大叶榄仁': 'sea-almond'
}

/**
 * 形态族：按汉字特征猜形状。
 * 顺序有讲究——"水杉"里的"杉"必须先于"槐/柳"这类落叶判断，否则会被抢走。
 */
const FORMS = [
  { re: /椰|棕|榈|葵|槟榔|苏铁|蒲/, slug: 'coconut-palm' },
  { re: /杉|松|柏|桧|针叶/, slug: 'dawn-redwood' },
  { re: /棉|凤凰木|蓝花楹|紫荆|樱|桃|梅|紫薇|鸡蛋花|刺桐|黄槐|决明|木荷|羊蹄甲/, slug: 'kapok' },
  { re: /榕|樟|桂|楠|杜英|冬青|芒果|荔枝|龙眼|橄榄|女贞|石栗|重阳木|枇杷|杨梅|白兰/, slug: 'camphor' },
  { re: /银杏|枫|梧桐|白蜡|朴|合欢|柳|榆|榉|槐|紫叶李|栾/, slug: 'magnolia' }
]

/** 去掉括号里的学名、空格、标点，避免"香樟（Cinnamomum camphora）"匹配不上 */
function normalize(species) {
  return String(species || '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s·・,，。;；:：\/]/g, '')
    .trim()
}

/** 归一化后的树种名 → 图片 slug（结果缓存，列表页会反复调） */
const slugCache = {}

function speciesSlug(species) {
  const key = normalize(species)
  if (key === '') return GENERIC
  if (slugCache[key]) return slugCache[key]

  let slug = ALIAS[key] || ''
  if (slug === '') {
    let i = 0
    while (i < FORMS.length) {
      if (FORMS[i].re.test(key)) {
        slug = FORMS[i].slug
        break
      }
      i++
    }
  }
  if (slug === '') slug = GENERIC

  slugCache[key] = slug
  return slug
}

/** 树种名 → 可直接放进 <image src> 的本地路径 */
function speciesArt(species) {
  return DIR + speciesSlug(species) + '.png'
}

/** 认不出具体品种、只用形态族兜底时为 true（页面可以据此弱化树种文案） */
function isGenericSpecies(species) {
  const slug = speciesSlug(species)
  return slug === GENERIC
}

/**
 * 历史上这些路径被当成"树的图片"写进了 trees.image，
 * 其实只是占位图，不能当作实拍照片展示，否则又回到"全员椰子树"。
 */
const PLACEHOLDERS = [
  '/static/illus/palm.png',
  '/static/illus/species/generic-tree.png',
  '/static/illus/stage1.png',
  '/static/illus/stage2.png',
  '/static/illus/stage3.png',
  '/static/illus/tree-'
]

function isPlaceholder(img) {
  const s = String(img || '')
  if (s === '') return true
  if (s.indexOf('cloud://') === 0) return false
  let i = 0
  while (i < PLACEHOLDERS.length) {
    if (s.indexOf(PLACEHOLDERS[i]) === 0) return true
    i++
  }
  return false
}

/**
 * 一棵树该显示哪张图。
 * 有真实照片（用户新增树时拍的）就用照片；否则按树种给插画。
 */
function treeCover(tree) {
  const t = tree || {}
  const img = String(t.image || '')
  if (isPlaceholder(img)) return speciesArt(t.species)
  return img
}

module.exports = {
  speciesArt,
  speciesSlug,
  isGenericSpecies,
  isPlaceholder,
  treeCover,
  GENERIC_ART: DIR + GENERIC + '.png'
}
