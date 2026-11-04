/**
 * 1.0 内置 Mock 数据包
 *
 * 字段结构 = 云端集合的 schema，改造后端时不用重新设计。
 * 队员 A 采集到真实树木照片和经纬度后，直接改这里的 lat/lng/image 即可。
 */
const { posToLatLng } = require('./geo')

/**
 * 中性兜底图：树上没有真实照片、树种也认不出来时用它。
 * 以前这里是 palm.png（大王椰），导致所有树都长成了椰子树 —— 别再改回去。
 */
const DEFAULT_TREE_IMG = '/static/illus/species/generic-tree.png'

function mockUser() {
  return {
    userId: 'u_001',
    nickname: '中大护林员小李',
    avatar: '/static/illus/avatar.png',
    bio: '',                  // 个人签名（个人页资料弹层编辑）
    availablePoints: 520,     // 碳积分（日程页赚）
    coins: 120,               // 护林币（林地页赚，个人页花）
    totalGrowthScore: 1850,
    badgeCount: 3,
    days: 108
  }
}

/**
 * 新用户注册用：云端查不到"我的"文档时，用这个开号。
 * 初始送 520 积分 + 120 护林币，保证新用户进来就能认养、浇水、兑换，演示不冷场。
 */
function newUser() {
  const u = mockUser()
  u.userId = 'u_' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
  u.nickname = '护林员' + Math.floor(1000 + Math.random() * 9000)
  u.totalGrowthScore = 0
  u.badgeCount = 0
  u.days = 1
  return u
}

function emptyTree() {
  return {
    treeId: '', name: '', species: '', posX: 0, posY: 0, lat: 0, lng: 0,
    ownerId: '', ownerName: '', level: 0, growthScore: 0,
    status: 'normal', hazardText: '', age: '', distance: 0,
    reviewStatus: 'approved', image: '', createdBy: ''
  }
}

/** 原始树数据（只写业务字段，坐标和审核状态由 withGeo 统一补齐） */
function rawTrees() {
  return [
    {
      treeId: 't_101', name: '逸仙大道08号 · 大王椰', species: '大王椰子',
      posX: 36, posY: 24, ownerId: 'u_001', ownerName: '中大护林员小李',
      level: 3, growthScore: 680, status: 'normal', hazardText: '',
      age: '26 年', distance: 120
    },
    {
      treeId: 't_102', name: '怀士堂前 · 老榕树', species: '细叶榕',
      posX: 66, posY: 28, ownerId: 'u_018', ownerName: '陈校友',
      level: 4, growthScore: 920, status: 'normal', hazardText: '',
      age: '112 年', distance: 340
    },
    {
      treeId: 't_103', name: '图书馆西侧 · 柠檬桉', species: '柠檬桉',
      posX: 16, posY: 42, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'normal', hazardText: '',
      age: '21 年', distance: 260
    },
    {
      treeId: 't_104', name: '北门草坪 · 木棉', species: '木棉',
      posX: 78, posY: 36, ownerId: 'u_022', ownerName: '榕榕',
      level: 2, growthScore: 410, status: 'normal', hazardText: '',
      age: '45 年', distance: 480
    },
    {
      treeId: 't_105', name: '逸仙路南 · 大王椰', species: '大王椰子',
      posX: 48, posY: 50, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'hazard',
      hazardText: '顶部巨大枯叶悬垂，路过有砸人风险',
      age: '33 年', distance: 90
    },
    {
      treeId: 't_106', name: '中山楼后 · 香樟', species: '香樟',
      posX: 26, posY: 30, ownerId: 'u_031', ownerName: '阿樟',
      level: 3, growthScore: 700, status: 'normal', hazardText: '',
      age: '60 年', distance: 520
    },
    {
      treeId: 't_107', name: '东湖岸边 · 水杉', species: '水杉',
      posX: 84, posY: 56, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'normal', hazardText: '',
      age: '27 年', distance: 610
    },
    {
      treeId: 't_108', name: '一号楼前 · 白玉兰', species: '白玉兰',
      posX: 10, posY: 60, ownerId: 'u_045', ownerName: '兰亭',
      level: 1, growthScore: 240, status: 'normal', hazardText: '',
      age: '18 年', distance: 700
    },
    {
      treeId: 't_109', name: '校医院旁 · 老榕', species: '细叶榕',
      posX: 56, posY: 64, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'hazard',
      hazardText: '树干基部发现白蚁活动痕迹',
      age: '75 年', distance: 380
    },
    {
      treeId: 't_110', name: '西门 · 大王椰', species: '大王椰子',
      posX: 70, posY: 60, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'normal', hazardText: '',
      age: '30 年', distance: 820
    },
    {
      treeId: 't_111', name: '图书馆广场 · 小叶榄仁', species: '小叶榄仁',
      posX: 42, posY: 26, ownerId: 'u_009', ownerName: '图书馆钉子户',
      level: 2, growthScore: 520, status: 'normal', hazardText: '',
      age: '24 年', distance: 300
    },
    {
      treeId: 't_112', name: '游泳馆路 · 凤凰木', species: '凤凰木',
      posX: 88, posY: 32, ownerId: '', ownerName: '',
      level: 0, growthScore: 0, status: 'hazard',
      hazardText: '台风后有断枝悬挂在树上',
      age: '40 年', distance: 900
    }
  ]
}

/** 补上经纬度、审核状态、照片、创建人 */
function mockTrees() {
  return rawTrees().map(function (t) {
    const g = posToLatLng(t.posX, t.posY)
    return Object.assign({}, t, {
      lat: g.lat,
      lng: g.lng,
      reviewStatus: 'approved',
      image: '',
      createdBy: 'u_001'
    })
  })
}

function today() {
  const d = new Date()
  const m = ('0' + (d.getMonth() + 1)).slice(-2)
  const day = ('0' + d.getDate()).slice(-2)
  return d.getFullYear() + '-' + m + '-' + day
}

function mockTasks() {
  return [
    {
      taskId: 'task_201', userId: 'u_001', date: today(),
      slot: '08:00', title: '搭公交/步行去教学楼',
      desc: '校巴乘车码 · 少排 140 g CO₂e', basePoints: 50, done: true, carbonSavedG: 140,
      aiComment: '识别到乘车凭证！少排 140 g CO₂e，你的小树又长高了一截~',
      proofImage: '', reviewStatus: 'approved'
    },
    {
      taskId: 'task_202', userId: 'u_001', date: today(),
      slot: '12:00', title: '食堂光盘行动',
      desc: '拍一张空盘子', basePoints: 30, done: false,
      carbonSavedG: 0, aiComment: '',
      proofImage: '', reviewStatus: ''
    },
    {
      taskId: 'task_203', userId: 'u_001', date: today(),
      slot: '15:00', title: '骑共享单车回宿舍',
      desc: '骑行记录截图', basePoints: 40, done: false,
      carbonSavedG: 0, aiComment: '',
      proofImage: '', reviewStatus: ''
    },
    {
      taskId: 'task_204', userId: 'u_001', date: today(),
      slot: '19:00', title: '双面打印 / 无纸化笔记',
      desc: '笔记截图', basePoints: 20, done: false,
      carbonSavedG: 0, aiComment: '',
      proofImage: '', reviewStatus: ''
    }
  ]
}

function mockGoods() {
  // goodsV：商品数据版本号。改商品（换图/换名）时 +1，store 启动时检测到旧版会自动整组刷新
  return [
    {
      itemId: 's_301', name: '中大纪念钥匙扣', costCurrency: 120, stock: 25, goodsV: 2,
      image: '/static/illus/goods-keychain.jpg', desc: '校园绿意随身带 · 限量 25 份'
    },
    {
      itemId: 's_302', name: '校园卡套', costCurrency: 80, stock: 12, goodsV: 2,
      image: '/static/illus/goods-cardholder.jpg', desc: '森系插画 · 吃饭刷卡都好看'
    },
    {
      itemId: 's_303', name: '森友小挂件', costCurrency: 300, stock: 5, goodsV: 2,
      image: '/static/illus/goods-pendant.jpg', desc: '挂在书包上的一片小森林'
    }
  ]
}

function mockBadges() {
  return [
    {
      badgeId: 'b_01', name: '低碳先锋', icon: '/static/ui/badge-medal.png',
      desc: '累计减碳 1000g', unlocked: true
    },
    {
      badgeId: 'b_02', name: '椰林排雷兵', icon: '/static/ui/badge-shield.png',
      desc: '上报 1 次大王椰枯叶隐患', unlocked: true
    },
    {
      badgeId: 'b_03', name: '首棵认养人', icon: '/static/ui/badge-sprout.png',
      desc: '认养第一棵树', unlocked: true
    },
    {
      badgeId: 'b_04', name: '百日护林员', icon: '/static/ui/badge-clock.png',
      desc: '连续护林 100 天', unlocked: false
    },
    {
      badgeId: 'b_05', name: '光盘达人', icon: '/static/ui/badge-medal.png',
      desc: '完成 10 次光盘行动', unlocked: false
    },
    {
      badgeId: 'b_06', name: '早八守护者', icon: '/static/ui/badge-sprout.png',
      desc: '连续 7 天低碳通勤', unlocked: false
    }
  ]
}

function mockWeekBars() {
  return [320, 480, 260, 540, 300, 180, 240]
}

/** 排行榜：按树的成长值排，改自原 PK 擂台 */
function mockRanks() {
  return [
    { rankId: 'r_1', userId: 'u_018', name: '陈校友', score: 920, treeName: '怀士堂前 · 老榕树', me: false },
    { rankId: 'r_2', userId: 'u_001', name: '中大护林员小李（我）', score: 680, treeName: '逸仙大道08号 · 大王椰', me: true },
    { rankId: 'r_3', userId: 'u_031', name: '阿樟', score: 700, treeName: '中山楼后 · 香樟', me: false },
    { rankId: 'r_4', userId: 'u_022', name: '榕榕', score: 410, treeName: '北门草坪 · 木棉', me: false }
  ]
}

module.exports = {
  mockUser, newUser, emptyTree, mockTrees, mockTasks,
  mockGoods, mockBadges, mockWeekBars, mockRanks,
  today, DEFAULT_TREE_IMG
}
