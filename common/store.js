/**
 * 全局状态（唯一数据源）
 *
 * 原版用 uvue 的 reactive 做响应式；小程序没有这个机制，改成「普通对象 + 页面手动 sync」：
 *   - 页面 onShow / 每次写操作之后调用 refresh()，从 state 重新生成 data
 *   - 所有写操作仍然收敛在本文件，数值口径不变
 *
 * 真实后端接入时，把这些函数内部换成 wx.request 即可，页面无需改动。
 */
const { mockUser, mockTrees, mockTasks, mockGoods, mockBadges, mockWeekBars, mockRanks } = require('./mock')
const { ADOPT_COST, WATER_COST, WATER_GAIN, FERT_COST, FERT_GAIN } = require('./theme')
const { stamp } = require('./util')

function seedLogs() {
  return [
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
  ]
}

/** 全局唯一状态。直接改这里的字段，然后在页面里 sync()。 */
const state = {
  user: mockUser(),
  trees: mockTrees(),
  tasks: mockTasks(),
  logs: seedLogs(),
  goods: mockGoods(),
  badges: mockBadges(),
  ranks: mockRanks(),
  weekBars: mockWeekBars(),
  adoptedTreeId: 't_101',
  carbonGoal: 100,
  records: [
    '中大古树帆布袋 · SYSU-483920',
    '中大古树帆布袋 · SYSU-771203'
  ]
}

/** 按 id 找树 */
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

/** 今日已得碳积分 */
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
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
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
  if (t.growthScore >= 1000 && t.level < 4) {
    t.level = 4
  }
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
      return ''
    }
    i++
  }
  return '任务不存在'
}

function addGrowthLog(image, desc) {
  const t = myTree()
  const log = {
    logId: 'log_' + (state.logs.length + 501).toFixed(0),
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
}

function reportHazard(r, desc) {
  const t = myTree()
  if (t.treeId === '') {
    return '先认养一棵树，再来上报隐患'
  }
  const log = {
    logId: 'log_' + (state.logs.length + 601).toFixed(0),
    treeId: t.treeId,
    kind: 'hazard',
    imageUrl: '/static/illus/palm.png',
    description: desc,
    aiAnalysis: '【' + r.level + '预警】' + r.analysis,
    rewardPoints: r.reward,
    createdAt: stamp()
  }
  state.logs.push(log)
  state.user.availablePoints = state.user.availablePoints + r.reward
  state.user.totalGrowthScore = state.user.totalGrowthScore + r.reward
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
      if (state.user.availablePoints < g.costPoints) {
        return { ok: false, code: '', msg: '积分不足，再做几个任务吧' }
      }
      state.user.availablePoints = state.user.availablePoints - g.costPoints
      g.stock = g.stock - 1
      const code = 'SYSU-' + Math.floor(100000 + Math.random() * 899999).toFixed(0)
      state.records.push(g.name + ' · ' + code)
      return { ok: true, code: code, msg: '' }
    }
    i++
  }
  return { ok: false, code: '', msg: '商品不存在' }
}

module.exports = {
  state,
  treeById, myTree,
  todayCarbon, todayPoints, doneCount, progressPct, unownedCount,
  adoptTree, water, fertilize, completeTask,
  addGrowthLog, reportHazard, exchange
}
