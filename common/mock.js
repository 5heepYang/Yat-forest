/**
 * 1.0 内置 Mock 数据包
 * 队员 A 采集到真实树木照片后，只需把 static/illus 下的图替换即可，字段结构不用改。
 */

function mockUser() {
  return {
    userId: 'u_001',
    nickname: '中大护林员小李',
    avatar: '/static/illus/avatar.png',
    availablePoints: 520,
    totalGrowthScore: 1850,
    badgeCount: 3,
    days: 108
  }
}

function emptyTree() {
  return {
    treeId: '', name: '', species: '', posX: 0, posY: 0,
    ownerId: '', ownerName: '', level: 0, growthScore: 0,
    status: 'normal', hazardText: '', age: '', distance: 0
  }
}

function mockTrees() {
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

function mockTasks() {
  return [
    {
      taskId: 'task_201', slot: '08:00', title: '搭公交/步行去教学楼',
      desc: '校巴乘车码 · 少排 140 g CO₂e', basePoints: 50, done: true, carbonSavedG: 140,
      aiComment: '识别到乘车凭证！少排 140 g CO₂e，你的小树又长高了一截~'
    },
    {
      taskId: 'task_202', slot: '12:00', title: '食堂光盘行动',
      desc: '拍一张空盘子', basePoints: 30, done: false,
      carbonSavedG: 0, aiComment: ''
    },
    {
      taskId: 'task_203', slot: '15:00', title: '骑共享单车回宿舍',
      desc: '骑行记录截图', basePoints: 40, done: false,
      carbonSavedG: 0, aiComment: ''
    },
    {
      taskId: 'task_204', slot: '19:00', title: '双面打印 / 无纸化笔记',
      desc: '笔记截图', basePoints: 20, done: false,
      carbonSavedG: 0, aiComment: ''
    }
  ]
}

function mockGoods() {
  return [
    {
      itemId: 's_301', name: '中大古树帆布袋', costPoints: 300, stock: 25,
      image: '/static/illus/bag.png', desc: '古树年轮印花 · 限量 25 份'
    },
    {
      itemId: 's_302', name: '校巴搪瓷杯', costPoints: 220, stock: 12,
      image: '/static/illus/cup.png', desc: '森系插画 · 附树种科普卡'
    },
    {
      itemId: 's_303', name: '实木树牌挂名权', costPoints: 800, stock: 5,
      image: '/static/illus/stage3.png', desc: '把名字挂在你认养的树上'
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

function mockRanks() {
  return [
    { name: '陈校友', score: 920, treeName: '怀士堂前 · 老榕树', me: false },
    { name: '中大护林员小李（我）', score: 680, treeName: '逸仙大道08号 · 大王椰', me: true },
    { name: '阿樟', score: 700, treeName: '中山楼后 · 香樟', me: false },
    { name: '榕榕', score: 410, treeName: '北门草坪 · 木棉', me: false }
  ]
}

module.exports = {
  mockUser, emptyTree, mockTrees, mockTasks,
  mockGoods, mockBadges, mockWeekBars, mockRanks
}
