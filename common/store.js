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
const { mockUser, mockTrees, mockTasks, mockGoods, mockBadges, mockWeekBars, today } = require('./mock')
const { ADOPT_COST, WATER_COST, WATER_GAIN, FERT_COST, FERT_GAIN } = require('./theme')
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

/** 空树占位：没有认养任何树时用它兜底，页面不用到处判空 */
function emptyTree() {
  return {
    treeId: '', name: '还没有认养的树', species: '', posX: 0, posY: 0,
    ownerId: '', ownerName: '', level: 0, growthScore: 0,
    status: 'normal', hazardText: '', age: '', distance: 0
  }
}

/**
 * 我认养的全部树（多树模型）。
 * 事实来源就是 trees 里 ownerId === 我的 userId，不需要额外存 id 列表，
 * 因此认养第二棵不会影响第一棵，也不存在"id 列表和树归属不一致"的脏数据。
 * 排序：等级高的在前，同级按成长值，方便林地页切换条直接展示。
 */
function myTrees() {
  const me = state.user.userId
  const out = []
  let i = 0
  while (i < state.trees.length) {
    if (state.trees[i].ownerId === me) {
      out.push(state.trees[i])
    }
    i++
  }
  out.sort(function (a, b) {
    if (a.level !== b.level) return b.level - a.level
    return b.growthScore - a.growthScore
  })
  return out
}

/**
 * 当前正在养护的那棵树。
 * adoptedTreeId 的语义从"我认养的树"变成"我当前选中的树"：
 * 它指向的树若已不属于我（或不存在），自动退化成我最好的一棵。
 */
function myTree() {
  let t = treeById(state.adoptedTreeId)
  if (t === null || t.ownerId !== state.user.userId) {
    const mine = myTrees()
    t = mine.length > 0 ? mine[0] : null
  }
  return t === null ? emptyTree() : t
}

/** 切换当前养护的树，只允许切自己的树 */
function selectTree(treeId) {
  const t = treeById(treeId)
  if (t === null || t.ownerId !== state.user.userId) return false
  if (state.adoptedTreeId === treeId) return true
  state.adoptedTreeId = treeId
  persist(['users'])
  return true
}

/**
 * 浇水/施肥的作用对象：
 *   不传 treeId      -> 当前选中的那棵
 *   传了 treeId      -> 必须是自己的树，否则返回 null（调用方报错，不静默改到别的树上）
 */
function careTarget(treeId) {
  if (!treeId) return myTree()
  const t = treeById(treeId)
  if (t === null || t.ownerId !== state.user.userId) return null
  return t
}

function todayCarbon() {
  const td = today()
  let sum = 0
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.done && t.date === td) {
      sum = sum + t.carbonSavedG
    }
    i++
  }
  return sum
}

function todayPoints() {
  const td = today()
  let sum = 0
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.done && t.date === td) {
      sum = sum + t.basePoints
    }
    i++
  }
  return sum
}

/** 累计减碳量：全部已完成任务的减碳克数之和（含历史天） */
function totalCarbon() {
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

function doneCount() {
  const td = today()
  let c = 0
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.done && t.date === td) {
      c++
    }
    i++
  }
  return c
}

/** 今日任务总数（AI 管家口径用） */
function todayTaskCount() {
  const td = today()
  let c = 0
  let i = 0
  while (i < state.tasks.length) {
    if (state.tasks[i].date === td) {
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

function water(treeId) {
  if (state.user.availablePoints < WATER_COST) {
    return '积分不足，去低碳日程攒一点吧'
  }
  const t = careTarget(treeId)
  if (t === null) {
    return '这不是你认养的树'
  }
  if (t.treeId === '') {
    return '先认养一棵树吧'
  }
  state.user.availablePoints = state.user.availablePoints - WATER_COST
  t.growthScore = t.growthScore + WATER_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + WATER_GAIN
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  persist(['trees', 'users'])
  return ''
}

function fertilize(treeId) {
  if (state.user.availablePoints < FERT_COST) {
    return '积分不足，去低碳日程攒一点吧'
  }
  const t = careTarget(treeId)
  if (t === null) {
    return '这不是你认养的树'
  }
  if (t.treeId === '') {
    return '先认养一棵树吧'
  }
  state.user.availablePoints = state.user.availablePoints - FERT_COST
  t.growthScore = t.growthScore + FERT_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + FERT_GAIN
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  persist(['trees', 'users'])
  return ''
}

function completeTask(taskId, carbon, comment, extra) {
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
      t.reviewStatus = 'approved'
      if (extra) {
        if (extra.proofImage) {
          t.proofImage = extra.proofImage
        }
        if (extra.proofText) {
          t.proofText = extra.proofText
        }
      }
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

/** 按 key 合并更新一条日程的字段 */
function updateTask(taskId, patch) {
  let i = 0
  while (i < state.tasks.length) {
    const t = state.tasks[i]
    if (t.taskId === taskId) {
      Object.keys(patch).forEach(function (k) {
        t[k] = patch[k]
      })
      persist(['tasks'])
      return true
    }
    i++
  }
  return false
}

/** 直接改用户字段（加货币、改名等） */
function updateUser(patch) {
  Object.keys(patch).forEach(function (k) {
    state.user[k] = patch[k]
  })
  persist(['users'])
}

module.exports = {
  state,
  ready,
  persist,

  treeById, myTree, myTrees, selectTree, careTarget,
  todayCarbon, todayPoints, totalCarbon, doneCount, todayTaskCount, progressPct, unownedCount, myTreeCount,

  adoptTree, water, fertilize, completeTask,
  addGrowthLog, reportHazard, exchange,
  addTree, updateTree, addTask, updateTask, updateUser
}
