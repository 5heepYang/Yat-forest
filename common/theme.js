/** 设计 token（取自视觉稿 v5 实际像素取色） */

const C_BG = '#FAF7F0' // 页面暖白底
const C_CARD = '#FFFFFF'
const C_DEEP = '#245A41' // 深绿：标题/主文字
const C_GREEN = '#3E7D5C' // 主绿：按钮/选中
const C_GREEN_MID = '#6BB98A' // 进度条填充
const C_SOFT = '#E9F2E4' // 浅绿面/胶囊底
const C_SOFT2 = '#F3F9EF' // 更浅绿卡面
const C_MAP = '#E7F0D8' // 地图底
const C_MAP_DEEP = '#CFE3BC' // 草坪
const C_LAKE = '#CBE3DE'
const C_CREAM = '#F1EBDC' // 建筑/土黄
const C_MUTED = '#9AA394' // 次要文字
const C_MUTED2 = '#B4BCAF' // 三级文字
const C_TEXT = '#1F2B24'

const C_TAG_BG = '#FBF0D9'
const C_TAG_TX = '#8A6A3B'

const C_WARN_BG = '#FFF6F2'
const C_WARN = '#E07A5F'
const C_WARN_TX = '#B4553F'

const C_GOLD_BG = '#FBF3DF'
const C_GOLD = '#D99C2B'
const C_PINK_BG = '#FBEDEA'
const C_PINK = '#DE8B84'

/** 数值 */
const ADOPT_COST = 300
const WATER_COST = 10
const WATER_GAIN = 20
const FERT_COST = 20
const FERT_GAIN = 50
const HAZARD_REWARD = 100
/** 养护附带发的护林币（林地页赚，个人页补给站花） */
const COIN_WATER = 2
const COIN_FERT = 5

module.exports = {
  C_BG, C_CARD, C_DEEP, C_GREEN, C_GREEN_MID, C_SOFT, C_SOFT2,
  C_MAP, C_MAP_DEEP, C_LAKE, C_CREAM, C_MUTED, C_MUTED2, C_TEXT,
  C_TAG_BG, C_TAG_TX, C_WARN_BG, C_WARN, C_WARN_TX,
  C_GOLD_BG, C_GOLD, C_PINK_BG, C_PINK,
  ADOPT_COST, WATER_COST, WATER_GAIN, FERT_COST, FERT_GAIN, HAZARD_REWARD,
  COIN_WATER, COIN_FERT
}
