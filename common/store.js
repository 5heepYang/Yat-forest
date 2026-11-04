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
const { ADOPT_COST, WATER_COST, WATER_GAIN, FERT_COST, FERT_GAIN, COIN_WATER, COIN_FERT } = require('./theme')
const { stamp } = require('./util')
const { ADMIN_IDS } = require('./config')
const db = require('./db')
const ai = require('./ai')

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
let resolveSynced = null
const readyPromise = new Promise(function (resolve) {
  resolveReady = resolve
})
/** 云端同步完成（比 ready 晚）。页面想"先秒开再自动更新"就 await 它。 */
const syncedPromise = new Promise(function (resolve) {
  resolveSynced = resolve
})

function applyState(data) {
  if (!data) return
  Object.assign(state, data)
  // 云端会返回明确的字符串（新用户是 ''），这里只兜"字段不存在"
  if (typeof state.adoptedTreeId !== 'string') {
    state.adoptedTreeId = ''
  }
}

/**
 * 启动流程（stale-while-revalidate）：
 *   1. 有本地缓存 -> 立刻灌进内存并 resolve ready()，页面毫秒级出内容
 *   2. 同时后台拉云端 -> 拿到后覆盖内存、resolve synced()，页面自行再刷一次
 * 没有缓存时行为和以前一致（等云端）。
 *
 * 这样地图页第二次进入不再白等 6 个集合的网络往返，而首屏数据仍是上次的真实数据。
 */
function bootstrap() {
  const cached = db.peekLocal()
  if (cached) {
    applyState(cached)
    hydrated = true
    resolveReady(state)
  }

  db.pull()
    .then(function (data) {
      applyState(data)
      syncGoods()
    })
    .catch(function (e) {
      console.warn('[store] 初始化拉取失败，使用内置数据', e)
    })
    .then(function () {
      if (!hydrated) {
        hydrated = true
        resolveReady(state)
      }
      resolveSynced(state)
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
 * 云端同步完成。
 * 页面可以 `store.ready()` 先渲染，再 `store.synced().then(refresh)` 自动追平。
 */
function synced() {
  return syncedPromise
}

/**
 * 重新从云端拉一遍并覆盖内存。
 * 用于「重置演示数据」之后：云端的树/积分都变了，不重拉页面还是旧数据。
 * 走的是和启动时同一条 pull 路径，所以各集合的口径完全一致。
 */
function reload() {
  return db.pull()
    .then(function (data) {
      applyState(data)
      syncGoods()
      return state
    })
    .catch(function (e) {
      console.warn('[store] 重新拉取失败', e)
      return state
    })
}

/* ---------- AI 类写操作的云端入口（本地模式由页面走原逻辑） ---------- */

/** 新增树木：云函数内部做 AI 识别（是不是树 / 什么品种）再写库 */
function cloudAddTree(info) {
  return cloudCall('addTree', info)
}

/**
 * 重置演示数据（答辩前反复演练用）。
 * 危险操作：会删掉用户新增的树、清空日程/日志/兑换记录、把积分归零。
 * 云端按白名单校验身份，调用方必须自己再问一次用户。
 */
function cloudResetDemoData() {
  return cloudCall('resetDemoData', {})
}

/**
 * 清空用户数据，回到"一个用户也没有"的初始状态。
 * 删 users 档案和全部个人记录；树一棵不删，只清认养关系；商品不动。
 * 云端权限：管理员，或"库里只剩自己一个用户"。调用方必须自己再问两次用户。
 */
function cloudWipeData() {
  return cloudCall('wipeData', {})
}

/**
 * 问云端"我是谁"：返回当前 openid。
 * 诊断用——同一个微信号每次进入 openid 应该完全一致；
 * 如果每次预览都变，说明扫码的微信/账号在变，而不是注册逻辑的锅。
 */
function cloudWhoami() {
  return cloudCall('whoami', {})
}

/** 隐患上报：云函数内部做 AI 巡检再记账 */
function cloudReportHazard(info) {
  return cloudCall('reportHazard', info)
}

/** 上传生长实拍：云函数内部做 AI 审核再加成长与护林币 */
function cloudAddGrowthLog(info) {
  return cloudCall('addGrowthLog', info)
}

/** 日程打卡：云函数内部做 AI 凭证核验再加分 */
function cloudCompleteTask(info) {
  return cloudCall('completeTask', info)
}

/** 新增日程：云函数内部做 AI 低碳分析再写库 */
function cloudCreateTask(info) {
  return cloudCall('createTask', info)
}

/** 改资料（昵称/签名/碳目标） */
function cloudUpdateProfile(info) {
  return cloudCall('updateProfile', info)
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

/**
 * 是否演示数据管理员。
 *
 * 人工审核取消后，这个判断只剩一个用途：个人页是否显示「重置演示数据」入口。
 * 真正的权限校验在 actions 云函数里（common/config.js 的名单只控制 UI）。
 */
function isAdmin() {
  return ADMIN_IDS.indexOf(state.user.userId) >= 0
}

/* ------------------------------------------------------------------ */
/* 云端写入通道（actions 云函数）                                       */
/* ------------------------------------------------------------------ */

/**
 * 云端权威写库：所有"要落库"的操作都发给 actions 云函数执行。
 *
 * 客户端仍然先本地乐观执行一遍（界面立刻响应），云函数返回的权威结果再覆盖回来；
 * 云函数拒绝时（余额不足/已认养/AI 不通过），覆盖回来的真值天然把乐观修改纠正掉，
 * 不需要手工回滚。
 *
 * 云函数没部署 / 网络失败时不会崩：返回 { offline:true }，客户端行为退回改造前（只写本地）。
 */
function isCloud() {
  return db.getMode() === db.MODE_CLOUD
}

function mergeUser(u) {
  if (!u) return
  Object.assign(state.user, u)
  if (typeof state.adoptedTreeId !== 'string') state.adoptedTreeId = ''
}

function mergeTree(t) {
  if (!t || !t.treeId) return
  const cur = treeById(t.treeId)
  if (cur) {
    Object.assign(cur, t)
    return
  }
  state.trees.push(t)
}

function mergeGoods(g) {
  if (!g || !g.itemId) return
  let i = 0
  while (i < state.goods.length) {
    if (state.goods[i].itemId === g.itemId) {
      Object.assign(state.goods[i], g)
      return
    }
    i++
  }
}

function mergeTask(t) {
  if (!t || !t.taskId) return
  let i = 0
  while (i < state.tasks.length) {
    if (state.tasks[i].taskId === t.taskId) {
      Object.assign(state.tasks[i], t)
      return
    }
    i++
  }
  state.tasks.push(t)
}

function addRecord(text) {
  if (text && state.records.indexOf(text) < 0) state.records.push(text)
}

/**
 * 把 callFunction 的报错翻译成一句能定位的人话。
 *
 * 原来这里一律吞成"云端未连接，数据只保存在本机"，等于把真正的原因
 * （函数没传、传错环境、函数崩了、超时）全盖住了，只能靠猜。
 * 这几个错误码是排查时最常撞到的，认出来就直接说清楚。
 */
function explainCloudError(e) {
  const raw = String((e && (e.errMsg || e.message)) || e || '')
  const flat = raw.replace(/\s+/g, ' ').trim()

  if (/FunctionName|function not found|-501000/i.test(flat)) {
    return '-501000 云函数 actions 不存在：还没上传部署，或者传到了别的环境'
  }
  if (/ResourceNotFound/i.test(flat)) return '找不到云函数 actions（控制台看看是不是被删了）'
  if (/-504002|execution error|runtime error/i.test(flat)) {
    return '-504002 云函数执行报错：去云开发控制台 → 云函数 → actions → 日志'
  }
  if (/timeout|timed out|超时/i.test(flat)) return '云函数超时（AI 识别太慢，控制台可把超时调大）'
  if (/env|环境/i.test(flat)) return '云环境对不上：db.js 的 CLOUD_ENV 与当前 AppID 不匹配'
  if (/network|errno|offline|断网/i.test(flat)) return '网络不通：检查开发者工具右上角是否断网/未登录'
  if (flat === '') return '调用失败但没有错误信息（多半是云开发未开通或额度用完）'
  return flat.slice(0, 120)
}

/** 云端不可用的完整原因只在本次会话弹一次，避免每次操作都挡一层弹窗 */
let cloudBrokenShown = false

function reportCloudBroken(action, reason) {
  console.error('[store] actions 调用失败 →', action, '|', reason)
  if (cloudBrokenShown) return
  cloudBrokenShown = true
  if (typeof wx === 'undefined' || typeof wx.showModal !== 'function') return
  wx.showModal({
    title: '云端连接失败',
    content: reason + '\n\n当前所有改动只存在本机，换设备/清缓存就没了。排查完请重启小程序。',
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#C0392B'
  })
}

function cloudCall(action, payload) {
  if (!isCloud()) return Promise.resolve({ ok: false, offline: true, msg: '本地模式' })
  if (!wx.cloud || !wx.cloud.callFunction) {
    const reason = '当前基础库没有云能力（wx.cloud 不存在），检查调试基础库版本'
    reportCloudBroken(action, reason)
    return Promise.resolve({ ok: false, offline: true, msg: '云端未连接，数据只保存在本机', detail: reason })
  }
  return wx.cloud.callFunction({
    name: 'actions',
    data: { action: action, payload: payload || {} }
  }).then(function (res) {
    const r = (res && res.result) || {}
    mergeUser(r.user)
    if (r.tree) mergeTree(r.tree)
    if (r.goods) mergeGoods(r.goods)
    if (r.task) mergeTask(r.task)
    if (r.record) addRecord(r.record)
    return r
  }).catch(function (e) {
    const reason = explainCloudError(e)
    reportCloudBroken(action, reason)
    return { ok: false, offline: true, msg: '云端未连接，数据只保存在本机', detail: reason }
  })
}

/** 认养：云端模式下返回 Promise<string>（'' 表示成功），本地模式返回字符串 */
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
  if (t.status === 'pending' || t.reviewStatus === 'pending') {
    return '这棵树还在人工审核中，通过后就能认养了'
  }
  if (t.status === 'rejected' || t.reviewStatus === 'rejected') {
    return '这棵树没有通过审核，暂不可认养'
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

  if (!isCloud()) return ''
  return cloudCall('adopt', { treeId: id }).then(function (r) {
    return r.ok ? '' : (r.msg || '认养失败')
  })
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
  // 虚拟浇水：每天每棵树只能一次，用完扣碳积分
  const td = today()
  if (t.lastWaterAt === td) {
    return '今天已经浇过水了，明天再来'
  }
  state.user.availablePoints = state.user.availablePoints - WATER_COST
  t.growthScore = t.growthScore + WATER_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + WATER_GAIN
  // 养护附带发护林币（林地页赚，个人页补给站花）
  state.user.coins = (state.user.coins || 0) + COIN_WATER
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  t.lastWaterAt = td
  persist(['trees', 'users'])

  if (!isCloud()) return ''
  return cloudCall('water', { treeId: t.treeId }).then(function (r) {
    return r.ok ? '' : (r.msg || '浇水失败')
  })
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
  const tdF = today()
  if (t.lastFertAt === tdF) {
    return '今天已经施过肥了，明天再来'
  }
  state.user.availablePoints = state.user.availablePoints - FERT_COST
  t.growthScore = t.growthScore + FERT_GAIN
  state.user.totalGrowthScore = state.user.totalGrowthScore + FERT_GAIN
  state.user.coins = (state.user.coins || 0) + COIN_FERT
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
  t.lastFertAt = tdF
  persist(['trees', 'users'])

  if (!isCloud()) return ''
  return cloudCall('fertilize', { treeId: t.treeId }).then(function (r) {
    return r.ok ? '' : (r.msg || '施肥失败')
  })
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

/**
 * 上报隐患。
 * treeId 可选：地图页可以对任意一棵树上报（别人的树也算），不传时默认当前养护树。
 */
function reportHazard(r, desc, image, treeId) {
  const t = treeId ? treeById(treeId) : myTree()
  if (t === null || t.treeId === '') {
    return treeId ? '这棵树不存在' : '先认养一棵树，再来上报隐患'
  }
  const log = {
    logId: db.newId('log'),
    treeId: t.treeId,
    kind: 'hazard',
    imageUrl: image || '/static/illus/species/generic-tree.png',
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

      if (isCloud()) {
        return cloudCall('exchange', { itemId: itemId }).then(function (r) {
          return { ok: !!r.ok, code: r.code || '', msg: r.msg || '' }
        })
      }
      return { ok: true, code: code, msg: '' }
    }
    i++
  }
  return { ok: false, code: '', msg: '商品不存在' }
}

/* ------------------------------------------------------------------ */
/* 给地图页 / 新增功能预留的通用写入口                                   */
/* ------------------------------------------------------------------ */

/** 新增一棵树（本地模式用；云端模式由 actions.addTree 以 AI 识别结果落库） */
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
  synced,
  reload,
  isCloud,
  cloudAddTree, cloudReportHazard, cloudAddGrowthLog, cloudCompleteTask, cloudCreateTask, cloudUpdateProfile,
  cloudResetDemoData,
  cloudWipeData,
  cloudWhoami,
  persist,

  treeById, myTree, myTrees, selectTree, careTarget,
  todayCarbon, todayPoints, totalCarbon, doneCount, todayTaskCount, progressPct, unownedCount, myTreeCount,
  badgeState,

  isAdmin,
  adoptTree, water, fertilize, completeTask,
  addGrowthLog, reportHazard, exchange,
  addTree, updateTree, addTask, updateTask, updateUser,
  resetForNewUser
}
