/**
 * 全局状态（唯一数据源）
 *
 * 架构：内存状态 + 自动持久化（离线优先）
 *
 *   - 页面照旧同步读 state、同步调写函数，界面立即响应，不需要 await
 *   - 每次写操作之后自动落库（测试号 -> Storage，正式环境 -> 云数据库）
 *   - 启动时 db.pull() 拉一次远端数据覆盖内存，页面用 await store.ready() 等它到位
 *
 * 这样做的原因：小程序没有 reactive，硬改成全异步会让四个页面的交互都要加 loading，
 * 演示时反而卡顿。同步改内存 + 后台落库，体验最好，也最不容易写错。
 */
const { mockUser, mockTrees, mockTasks, mockGoods, mockBadges, mockWeekBars } = require('./mock')
const { ADOPT_COST, WATER_COST, WATER_GAIN, FERT_COST, FERT_GAIN, COIN_WATER, COIN_FERT } = require('./theme')
const { stamp } = require('./util')
const db = require('./db')

/** 全局唯一状态。直接改这里的字段，改完调 persist([...])。 */
const state = {
  user: mockUser(),
  trees: mockTrees(),
  tasks: mockTasks(),
  logs: [
    {
      logId: 'log_501', treeId: 't_101', kind: 'growth', imageUrl: '/static/illus/stage1.png',
      description: '第一次线下实拍：刚认养时的春芽', aiAnalysis: '', rewardPoints: 0, createdAt: '08-01'
    },
    {
      logId: 'log_502', treeId: 't_101', kind: 'growth', imageUrl: '/static/illus/stage2.png',
      description: '三个月后，新叶抽了 6 片', aiAnalysis: '', rewardPoints: 0, createdAt: '09-20'
    },
    {
      logId: 'log_503', treeId: 't_101', kind: 'growth', imageUrl: '/static/illus/stage3.png',
      description: '今天无风，我的叶子有点痒', aiAnalysis: '', rewardPoints: 0, createdAt: '11-02'
    }
  ],
  goods: mockGoods(),
  // 勋章墙、周柱状图都是静态展示数据，不落库、不隔离（没有对应集合），每端各持一份
  badges: mockBadges(),
  weekBars: mockWeekBars(),
  adoptedTreeId: 't_101',
  carbonGoal: 100,
  records: [
    '中大古树帆布袋 · SYSU-483920',
    '中大古树帆布袋 · SYSU-771203'
  ]
}

let hydrated = false
let resolveReady = null
const readyPromise = new Promise(function (resolve) {
  resolveReady = resolve
})

/** 启动即拉一次远端数据。拉完把内存状态覆盖掉，页面会通过 ready() 感知。 */
function bootstrap() {
  db.pull()
    .then(function (data) {
      if (data) {
        Object.assign(state, data)
        // 云端会返回明确的字符串（新用户是 ''），这里只兜"字段不存在"
        if (typeof state.adoptedTreeId !== 'string') {
          state.adoptedTreeId = ''
        }
        syncGoods()
      }
    })
    .catch(function (e) {
      console.warn('[store] 初始化拉取失败，使用内置数据', e)
    })
    .then(function () {
      hydrated = true
      resolveReady(state)
    })
}

/**
 * 商品版本同步：缓存/云端里的 goods 还是旧版（换过图或名字）时整组替换。
 * 判断依据是商品上的 goodsV 版本号（mock.js 里改商品时 +1），
 * 这样兑换扣的库存不受影响——只有版本对不上才刷新。
 */
function syncGoods() {
  const fresh = mockGoods()
  const cur = state.goods && state.goods[0]
  if (cur && cur.goodsV === fresh[0].goodsV) {
    return
  }
  state.goods = fresh
  persist(['goods'])
}

/** 页面在 onShow 里 await 它，保证读到的不是内置假数据 */
function ready() {
  return readyPromise
}

/**
 * 落库。不阻塞界面，失败了本地也已经存住。
 *
 * @param {Array} only 本次改动涉及的集合名，如 ['trees','users']。
 *                     不传则 6 个集合全写（慢，别这么干）。
 *                     集合名对照：users / trees / tasks / tree_logs / goods / records
 *
 * 队友新增写函数时，照抄下面任意一个函数末尾的 persist([...]) 即可，
 * 把你改到的字段所在的集合列出来。
 */
function persist(only) {
  if (!hydrated) {
    // 还没拉到远端数据就写，会把种子数据覆盖到云端，必须拦住
    return
  }
  db.save(state, only)
}

bootstrap()

/* ------------------------------------------------------------------ */
/* 读                                                                  */
/* ------------------------------------------------------------------ */

function treeById(id) {
  let i = 0
  while (i < state.trees.length) {
    if (state.trees[i].treeId === id) {
      return state.trees[i]
    }
    i++
  }
  return null
}

/** 我认养的那棵树（1.0 每人一棵，简化交互） */
function myTree() {
  const t = treeById(state.adoptedTreeId)
  if (t === null) {
    return {
      treeId: '', name: '还没有认养的树', species: '', posX: 0, posY: 0,
      ownerId: '', ownerName: '', level: 0, growthScore: 0,
      status: 'normal', hazardText: '', age: '', distance: 0
    }
  }
  return t
}

function todayCarbon() {
  let sum = 0
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.done) {
      sum = sum + t.carbonSavedG
    }
    i++
  }
  return sum
}

function todayPoints() {
  let sum = 0
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.done) {
      sum = sum + t.basePoints
    }
    i++
  }
  return sum
}

function doneCount() {
  let c = 0
  let i = 0
  while (i < state.tasks.length) {
    if (state.tasks[i].done) {
      c++
    }
    i++
  }
  return c
}

function progressPct() {
  const p = todayPoints() / state.carbonGoal * 100
  return p > 100 ? 100 : p
}

function unownedCount() {
  let c = 0
  let i = 0
  while (i < state.trees.length) {
    if (state.trees[i].ownerId === '') {
      c++
    }
    i++
  }
  return c
}

/** 我认养了几棵树 */
function myTreeCount() {
  let c = 0
  let i = 0
  while (i < state.trees.length) {
    if (state.trees[i].ownerId === state.user.userId) {
      c++
    }
    i++
  }
  return c
}

/**
 * 勋章点亮状态（数据驱动，mockBadges 里的 unlocked 字段已废弃，只当定义表用）。
 * 每次展示前算一遍；顺带把 badgeCount 同步进内存（不单独落库，
 * 下次任何写操作带 users 一起存）。
 */
function badgeState() {
  let carbon = 0
  let i = 0
  while (i < state.tasks.length) {
    if (state.tasks[i].done) {
      carbon = carbon + (state.tasks[i].carbonSavedG || 0)
    }
    i++
  }
  let hazardCount = 0
  i = 0
  while (i < state.logs.length) {
    if (state.logs[i].kind === 'hazard') {
      hazardCount++
    }
    i++
  }

  const rules = {
    b_01: carbon >= 1000,                        // 低碳先锋：累计减碳 1000g
    b_02: hazardCount >= 1,                      // 椰林排雷兵：上报 1 次隐患
    b_03: myTreeCount() >= 1,                    // 首棵认养人：认养第一棵树
    b_04: (state.user.days || 0) >= 100,         // 百日护林员：护林 100 天
    b_05: false,                                 // 光盘达人：暂无数据源，保持未解锁
    b_06: false                                  // 早八守护者：暂无数据源，保持未解锁
  }

  const list = state.badges.map(function (b) {
    return Object.assign({}, b, { unlocked: !!rules[b.badgeId] })
  })

  let n = 0
  i = 0
  while (i < list.length) {
    if (list[i].unlocked) n++
    i++
  }
  state.user.badgeCount = n
  return list
}

/* ------------------------------------------------------------------ */
/* 写（每个函数末尾都要 persist([...])，标明本次动到的集合）           */
/* ------------------------------------------------------------------ */

/** 认养：成功返回空串，失败返回提示语 */
function adoptTree(id) {
  const t = treeById(id)
  if (t === null) {
    return '这棵树不存在'
  }
  if (t.ownerId !== '') {
    return '这棵树已经有认养人了'
  }
  if (t.status === 'hazard') {
    return '该树正在隐患处理中，暂不可认养'
  }
  if (t.status === 'pending') {
    return '这棵树还在人工审核中，通过后就能认养了'
  }
  if (state.user.availablePoints < ADOPT_COST) {
    return '积分不足，去低碳日程做任务攒一点吧'
  }
  state.user.availablePoints = state.user.availablePoints - ADOPT_COST
  t.ownerId = state.user.userId
  t.ownerName = state.user.nickname
  t.level = 1
  t.growthScore = 30
  state.adoptedTreeId = id
  state.user.totalGrowthScore = state.user.totalGrowthScore + 30
  persist(['trees', 'users'])
  return ''
}

function water() {
  if (state.user.availablePoints < WATER_COST) {
    return '积分不足，去低碳日程攒一点吧'
  }
  const t = myTree()
  if (t.treeId === '') {
    return '先认养一棵树吧'
  }
  state.user.availablePoints = state.user.availablePoints - WATER_COST
  t.growthScore = t.growthScore + WATER_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + WATER_GAIN
  // 养护附带发护林币（林地页赚，个人页补给站花）
  state.user.coins = (state.user.coins || 0) + COIN_WATER
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  persist(['trees', 'users'])
  return ''
}

function fertilize() {
  if (state.user.availablePoints < FERT_COST) {
    return '积分不足，去低碳日程攒一点吧'
  }
  const t = myTree()
  if (t.treeId === '') {
    return '先认养一棵树吧'
  }
  state.user.availablePoints = state.user.availablePoints - FERT_COST
  t.growthScore = t.growthScore + FERT_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + FERT_GAIN
  state.user.coins = (state.user.coins || 0) + COIN_FERT
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  persist(['trees', 'users'])
  return ''
}

function completeTask(taskId, carbon, comment) {
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.taskId === taskId) {
      if (t.done) {
        return '这个任务已经核验过了'
      }
      t.done = true
      t.carbonSavedG = carbon
      t.aiComment = comment
      state.user.availablePoints = state.user.availablePoints + t.basePoints
      state.user.totalGrowthScore = state.user.totalGrowthScore + t.basePoints
      persist(['tasks', 'users'])
      return ''
    }
    i++
  }
  return '任务不存在'
}

function addGrowthLog(image, desc) {
  const t = myTree()
  const log = {
    logId: db.newId('log'),
    treeId: t.treeId,
    kind: 'growth',
    imageUrl: image,
    description: desc,
    aiAnalysis: '',
    rewardPoints: 0,
    createdAt: stamp().substring(5, 16)
  }
  state.logs.push(log)
  state.user.availablePoints = state.user.availablePoints + 20
  state.user.totalGrowthScore = state.user.totalGrowthScore + 10
  persist(['tree_logs', 'users'])
  return log
}

function reportHazard(r, desc, image) {
  const t = myTree()
  if (t.treeId === '') {
    return '先认养一棵树，再来上报隐患'
  }
  const log = {
    logId: db.newId('log'),
    treeId: t.treeId,
    kind: 'hazard',
    imageUrl: image || '/static/illus/palm.png',
    description: desc,
    aiAnalysis: '【' + r.level + '预警】' + r.analysis,
    rewardPoints: r.reward,
    createdAt: stamp()
  }
  state.logs.push(log)
  state.user.availablePoints = state.user.availablePoints + r.reward
  state.user.totalGrowthScore = state.user.totalGrowthScore + r.reward
  persist(['tree_logs', 'users'])
  return ''
}

function exchange(itemId) {
  let i = 0
  while (i < state.goods.length) {
    const g = state.goods[i]
    if (g.itemId === itemId) {
      if (g.stock <= 0) {
        return { ok: false, code: '', msg: '这件纪念品已经兑完了' }
      }
      // 补给站用护林币结算，碳积分不参与
      if ((state.user.coins || 0) < g.costCurrency) {
        return { ok: false, code: '', msg: '护林币不够，去林地浇水做任务攒一点吧' }
      }
      state.user.coins = (state.user.coins || 0) - g.costCurrency
      g.stock = g.stock - 1
      const code = 'SYSU-' + Math.floor(100000 + Math.random() * 899999).toFixed(0)
      state.records.push(g.name + ' · ' + code)
      persist(['goods', 'users', 'records'])
      return { ok: true, code: code, msg: '' }
    }
    i++
  }
  return { ok: false, code: '', msg: '商品不存在' }
}

/* ------------------------------------------------------------------ */
/* 给地图页 / 新增功能预留的通用写入口                                   */
/* ------------------------------------------------------------------ */

/** 新增一棵树（走审核流程：pending -> approved 才会在地图上显示点位） */
function addTree(tree) {
  state.trees.push(tree)
  persist(['trees'])
  return tree
}

/** 更新任意一棵树的字段 */
function updateTree(treeId, patch) {
  const t = treeById(treeId)
  if (!t) return false
  Object.keys(patch).forEach(function (k) {
    t[k] = patch[k]
  })
  persist(['trees'])
  return true
}

/** 新增一条日程 */
function addTask(task) {
  state.tasks.push(task)
  persist(['tasks'])
  return task
}

/** 直接改用户字段（加货币、改名等） */
function updateUser(patch) {
  Object.keys(patch).forEach(function (k) {
    state.user[k] = patch[k]
  })
  persist(['users'])
}

/**
 * 本地模式首次登录用：把内置演示数据重置成干净新号。
 * （云端不需要：每个 openid 自动建档隔离，新用户本来就是干净的；
 *   本地 Storage 里存的是演示账号 u_001，不清就"登录就有树"。）
 * 保留：520 碳积分 + 120 护林币新手礼（够认养一棵树再兑换一件，演示不冷场）。
 */
function resetForNewUser() {
  let i = 0
  while (i < state.trees.length) {
    const t = state.trees[i]
    if (t.ownerId === state.user.userId) {
      // 我名下的树释放回待认养（成长值等级一并归零，世界恢复初始）
      t.ownerId = ''
      t.ownerName = ''
      t.level = 0
      t.growthScore = 0
    }
    i++
  }
  state.user.totalGrowthScore = 0
  state.user.badgeCount = 0
  state.user.days = 1
  // 随机护林员编号开号，头像用默认；改名换头像在个人页（昵称可点 + 资料弹层）
  state.user.nickname = '护林员' + Math.floor(1000 + Math.random() * 9000)
  state.user.avatar = '/static/illus/avatar.png'
  state.adoptedTreeId = ''
  state.tasks = mockTasks()
  state.logs = []
  state.records = []
  persist() // 一次性重置，全量落库
}

module.exports = {
  state,
  ready,
  persist,

  treeById, myTree,
  todayCarbon, todayPoints, doneCount, progressPct, unownedCount, myTreeCount,
  badgeState,

  adoptTree, water, fertilize, completeTask,
  addGrowthLog, reportHazard, exchange,
  addTree, updateTree, addTask, updateUser,
  resetForNewUser
}
