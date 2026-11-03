/**
 * 林地页「按树分桶」回归测试（本地模式，不联网）
 *
 * 用法：在小程序根目录执行  node tools/kitest.js
 *
 * 验证的是多树后最容易出错的地方：养护状态（任务 / 核验 / 工单 / 照片）
 * 必须按 treeId 隔离，并且老版本单份 kit 的进度在迁移后不能丢。
 */

const memStorage = {}
const toasts = []
global.wx = {
  getAccountInfoSync() { return { miniProgram: { appId: 'touristappid' } } },
  setStorageSync(k, v) { memStorage[k] = JSON.parse(JSON.stringify(v)) },
  getStorageSync(k) { return memStorage[k] },
  showToast(o) { toasts.push(o && o.title) },
  // 设置周期后会申请订阅消息授权，桩里直接当作"用户拒绝"，不影响断言
  requestSubscribeMessage(o) { if (o && o.fail) o.fail({ errMsg: 'stub: not supported' }) },
  getWindowInfo() { return { statusBarHeight: 20 } },
  createMapContext() { return { moveToLocation() {} } }
}

let pageCfg = null
global.Page = function (cfg) { pageCfg = cfg }

const store = require('../common/store.js')
require('../pages/tree/tree.js')

const KIT_KEY = 'tree_kit_v1'
const today = (function () {
  const d = new Date()
  const p = function (n) { const s = String(n); return s.length < 2 ? '0' + s : s }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
})()

let pass = 0
let failCount = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { failCount++; console.log('  FAIL  ' + label + '  ' + (detail == null ? '' : detail)) }
}

function makePage() {
  const inst = Object.assign({}, pageCfg)
  inst.data = JSON.parse(JSON.stringify(pageCfg.data))
  inst.setData = function (o) { Object.assign(this.data, o) }
  return inst
}

;(async () => {
  await store.ready()

  const first = store.myTree().treeId
  check('当前养护树已就绪', !!first, first)

  console.log('===== S1 老格式 kit（单份）迁移到当前树 =====')
  // 模拟老版本：tasks / tickets / careAt 直接挂在根上，且今天已浇水、已核验
  wx.setStorageSync(KIT_KEY, {
    tasks: {
      water: { lastDoneAt: today, lastDoneTs: Date.now() },
      fert: { lastDoneAt: '', lastDoneTs: 0 },
      photo: { lastDoneAt: '', lastDoneTs: 0, periodDays: 14 }
    },
    tickets: [{ id: 'tk_1', ticket: 'HT-001', level: '中', createdAt: today, resolved: false }],
    photos: [{ logId: 'log_501', stage: '新叶', monthText: '8 月' }],
    streak: { days: 5, lastAt: today, lastTs: Date.now(), milestone: 3 },
    dailyBonusAt: '',
    careAt: today
  })

  const p1 = makePage()
  p1.onLoad()
  await p1.onShow()

  // refresh 只读不写，迁移结果先看页面内存里的容器
  check('老进度迁到了当前树的桶里', !!p1.kt.trees[first], Object.keys(p1.kt.trees || {}).join(','))
  check('迁移后不再有待迁移的 legacy', p1.kt.legacy === null)
  check('连续护林天数保留（用户维度，不按树分）', p1.kt.streak.days === 5, p1.kt.streak.days)
  check('浇水任务显示已完成', p1.data.tasks[0].done === true, JSON.stringify(p1.data.tasks[0]))
  check('今天免核验状态被带过来', p1.data.careVerified === true)
  check('工单迁移成功', p1.data.tickets.length === 1, p1.data.tickets.length)

  // 触发一次真正的写入（改拍照周期），确认落到 Storage 的是新容器格式
  p1.setPeriod({ currentTarget: { dataset: { days: 30 } } })
  check('Storage 里已是容器格式', !!memStorage[KIT_KEY].trees && !memStorage[KIT_KEY].tasks,
    JSON.stringify(Object.keys(memStorage[KIT_KEY])))
  check('周期改动写进了当前树的桶', memStorage[KIT_KEY].trees[first].tasks.photo.periodDays === 30,
    memStorage[KIT_KEY].trees[first].tasks.photo.periodDays)

  console.log('===== S2 认养第二棵后切换：新树必须是一张白纸 =====')
  store.updateUser({ availablePoints: 2000 })
  const free = store.state.trees.filter(function (x) { return x.ownerId === '' }).map(function (x) { return x.treeId })
  const second = free[0]
  store.adoptTree(second)

  const p2 = makePage()
  p2.onLoad()
  await p2.onShow()
  check('当前树已切到新认养的那棵', p2.data.tree.name === store.treeById(second).name, p2.data.tree.name)
  check('新树今天没核验过', p2.data.careVerified === false)
  check('新树浇水任务未完成', p2.data.tasks[0].done === false, JSON.stringify(p2.data.tasks[0]))
  check('新树没有继承老工单', p2.data.tickets.length === 0, p2.data.tickets.length)
  check('切换条显示 2 棵树', p2.data.myTrees.length === 2, p2.data.myTrees.length)

  console.log('===== S3 切回第一棵：老进度还在 =====')
  const ok = store.selectTree(first)
  const p3 = makePage()
  p3.onLoad()
  await p3.onShow()
  check('切换成功', ok === true)
  check('第一棵的浇水任务仍是已完成', p3.data.tasks[0].done === true, JSON.stringify(p3.data.tasks[0]))
  check('第一棵今天仍免核验', p3.data.careVerified === true)
  check('第一棵工单还在', p3.data.tickets.length === 1, p3.data.tickets.length)

  console.log('===== S4 两棵树的桶互不覆盖 =====')
  const treesSaved = memStorage[KIT_KEY].trees
  check('两个桶都在 Storage 里', Object.keys(treesSaved).length === 2, Object.keys(treesSaved).join(','))
  check('两桶内容不同（新树无工单）', (treesSaved[first].tickets.length === 1) && (treesSaved[second].tickets.length === 0))

  console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败')
  process.exit(failCount === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('测试异常', e)
  process.exit(1)
})
