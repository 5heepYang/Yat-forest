/**
 * actions 云函数逻辑测试（内存假数据库，不联网、不部署）
 *
 * 用法：在小程序根目录执行  node tools/actionstest.js
 *
 * 为什么需要：actions 是所有写库操作的权威执行者，但它跑在云端，
 * 本地点不到。这里用内存数据库 + 假的 wx-server-sdk 把它 require 进来直接跑，
 * 覆盖认养、浇水每日一次、兑换扣库存、打卡 AI 拒绝、新增树审核、隐患拒绝等分支。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

/* ------------------------------------------------------------------ */
/* 内存数据库                                                          */
/* ------------------------------------------------------------------ */

const db = {
  users: [
    {
      _id: 'u_doc_1',
      _openid: 'openid_A',
      userId: 'u_001',
      nickname: '中大护林员小李',
      avatar: '/static/illus/avatar.png',
      availablePoints: 1000,
      coins: 300,
      totalGrowthScore: 500,
      days: 108,
      adoptedTreeId: 't_101'
    },
    {
      _id: 'u_doc_2',
      _openid: 'openid_B',
      userId: 'u_018',
      nickname: '另一个森友',
      availablePoints: 50,
      coins: 0,
      totalGrowthScore: 10,
      adoptedTreeId: ''
    }
  ],
  trees: [
    {
      _id: 't_doc_broken',
      _openid: 'openid_B',
      treeId: 't_broken',
      name: '坏图测试树',
      species: '樟树',
      ownerId: 'u_018',
      level: 1,
      growthScore: 10,
      status: 'normal',
      reviewStatus: 'approved',
      image: 'cloud://env.bucket/tree_photos/gone.jpg'
    },
    {
      _id: 't_doc_1',
      _openid: 'openid_B',
      treeId: 't_101',
      name: '逸仙大道 08 号 · 大王椰',
      species: '大王椰',
      ownerId: 'u_001',
      ownerName: '中大护林员小李',
      level: 1,
      growthScore: 30,
      status: 'normal',
      reviewStatus: 'approved',
      createdBy: 'u_001'
    },
    {
      _id: 't_doc_2',
      _openid: 'openid_B',
      treeId: 't_1730001112001',
      name: '图书馆西侧 · 柠檬桉',
      species: '柠檬桉',
      ownerId: '',
      ownerName: '',
      level: 0,
      growthScore: 0,
      status: 'normal',
      reviewStatus: 'approved',
      createdBy: 'u_018'
    },
    {
      _id: 't_doc_3',
      _openid: 'openid_B',
      treeId: 't_1730001112002',
      name: '待审核的树',
      species: '樟树',
      ownerId: '',
      level: 0,
      growthScore: 0,
      status: 'pending',
      reviewStatus: 'pending',
      createdBy: 'u_018'
    }
  ],
  tasks: [
    {
      _id: 'task_doc_1',
      _openid: 'openid_A',
      taskId: 'task_201',
      title: '骑共享单车去图书馆',
      basePoints: 40,
      done: false,
      date: '2026-11-04'
    }
  ],
  goods: [
    { _id: 'g_doc_1', itemId: 's_301', name: '中大古树帆布袋', costCurrency: 120, stock: 25 },
    { _id: 'g_doc_2', itemId: 's_302', name: '校巴搪瓷杯', costCurrency: 80, stock: 0 }
  ],
  tree_logs: [],
  records: []
}

let _idSeq = 100
function nextId() {
  _idSeq++
  return 'doc_' + _idSeq
}

function matchCond(doc, cond) {
  return Object.keys(cond).every(function (k) { return doc[k] === cond[k] })
}

function makeQuery(name, cond) {
  let limitN = 100
  return {
    where: function (c) { return makeQuery(name, Object.assign({}, cond, c)) },
    limit: function (n) { limitN = n; return this },
    get: async function () {
      const rows = (db[name] || []).filter(function (d) { return matchCond(d, cond) }).slice(0, limitN)
      return { data: JSON.parse(JSON.stringify(rows)) }
    },
    doc: function (id) {
      return {
        get: async function () {
          const d = (db[name] || []).find(function (x) { return x._id === id })
          if (!d) throw new Error('doc not found')
          return { data: JSON.parse(JSON.stringify(d)) }
        },
        update: async function (arg) {
          const d = (db[name] || []).find(function (x) { return x._id === id })
          if (!d) throw new Error('doc not found')
          Object.assign(d, arg.data)
          return { stats: { updated: 1 } }
        },
        set: async function (arg) {
          db[name] = db[name] || []
          const idx = db[name].findIndex(function (x) { return x._id === id })
          if (idx >= 0) Object.assign(db[name][idx], arg.data)
          else db[name].push(Object.assign({ _id: id }, arg.data))
          return { _id: id }
        },
        remove: async function () {
          db[name] = (db[name] || []).filter(function (x) { return x._id !== id })
          return { stats: { removed: 1 } }
        }
      }
    },
    count: async function () {
      const rows = (db[name] || []).filter(function (d) { return matchCond(d, cond) })
      return { total: rows.length }
    },
    add: async function (arg) {
      const doc = Object.assign({ _id: nextId() }, arg.data)
      db[name] = db[name] || []
      db[name].push(doc)
      return { _id: doc._id }
    },
    /**
     * 云函数端支持 where().remove() 批量删除（客户端不支持），
     * resetDemoData 靠它清个人集合，所以假库也得实现。
     */
    remove: async function () {
      const keep = (db[name] || []).filter(function (d) { return !matchCond(d, cond) })
      const removed = (db[name] || []).length - keep.length
      db[name] = keep
      return { stats: { removed: removed } }
    }
  }
}

const fakeDb = {
  command: { neq: function (v) { return { $ne: v } } },
  collection: function (name) { return makeQuery(name, {}) },
  runTransaction: async function (fn) {
    const t = {
      collection: function (name) {
        return {
          doc: function (id) {
            return {
              get: async function () {
                const d = (db[name] || []).find(function (x) { return x._id === id })
                if (!d) throw new Error('doc not found')
                return { data: JSON.parse(JSON.stringify(d)) }
              },
              update: async function (arg) {
                const d = (db[name] || []).find(function (x) { return x._id === id })
                if (!d) throw new Error('doc not found')
                Object.assign(d, arg.data)
              }
            }
          }
        }
      }
    }
    return fn(t)
  }
}

/* ------------------------------------------------------------------ */
/* 假的 wx-server-sdk                                                  */
/* ------------------------------------------------------------------ */

let openid = 'openid_A'
let aiResponder = function () { return { passed: true, carbonSavedG: 120, comment: 'OK', detail: '', level: '中危', analysis: '枯枝', advice: '修剪', reward: 100, desc: '骑行 · 少排约 120 g', basePoints: 40 } }

const BAD_FILE = 'cloud://env.bucket/tree_photos/gone.jpg'

const sdk = {
  DYNAMIC_CURRENT_ENV: 'test-env',
  getTempFileURL: async function (arg) {
    const list = (arg.fileList || []).map(function (id) {
      if (String(id).indexOf(BAD_FILE) === 0) return { fileID: id, errMsg: 'storage file not exists' }
      return { fileID: id, tempFileURL: 'https://tmp.example/' + encodeURIComponent(id) }
    })
    return { fileList: list }
  },
  init: function () {},
  database: function () { return fakeDb },
  getWXContext: function () { return { OPENID: openid } },
  callFunction: async function (arg) {
    return { result: aiResponder(arg && arg.data) }
  }
}

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcbstub-'))
const stubFile = path.join(stubDir, 'wx-server-sdk.js')
fs.writeFileSync(stubFile, 'module.exports = global.__TCB_FAKE_SDK__\n')
global.__TCB_FAKE_SDK__ = sdk

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, opts) {
  if (request === 'wx-server-sdk') return stubFile
  return origResolve.call(this, request, parent, isMain, opts)
}

const actionsPath = path.join(__dirname, '..', 'cloudfunctions', 'actions', 'index.js')
const actions = require(actionsPath)

/* ------------------------------------------------------------------ */
/* 断言                                                                */
/* ------------------------------------------------------------------ */

let pass = 0
let failCount = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { failCount++; console.log('  FAIL  ' + label + '  ' + (detail == null ? '' : detail)) }
}
function userDoc(openid2) {
  return db.users.find(function (u) { return u._openid === openid2 })
}
function treeDoc(treeId) {
  return db.trees.find(function (t) { return t.treeId === treeId })
}

;(async () => {
  console.log('===== 认养 =====')
  let r = await actions.main({ action: 'adopt', payload: { treeId: 't_1730001112001' } })
  check('无主树认养成功', r.ok === true, r.msg)
  check('积分扣 300', userDoc('openid_A').availablePoints === 700, userDoc('openid_A').availablePoints)
  check('树归属变成我', treeDoc('t_1730001112001').ownerId === 'u_001', treeDoc('t_1730001112001').ownerId)

  r = await actions.main({ action: 'adopt', payload: { treeId: 't_1730001112001' } })
  check('已认养的树不能再认养', r.ok === false, r.msg)

  r = await actions.main({ action: 'adopt', payload: { treeId: 't_1730001112002' } })
  check('待审核的树不能认养', r.ok === false && r.msg.indexOf('审核') >= 0, r.msg)

  r = await actions.main({ action: 'adopt', payload: { treeId: 'nope' } })
  check('不存在的树被拒', r.ok === false, r.msg)

  console.log('===== 浇水 / 施肥（每天各一次）=====')
  r = await actions.main({ action: 'water', payload: { treeId: 't_101' } })
  check('首次浇水成功', r.ok === true, r.msg)
  check('加了成长值', treeDoc('t_101').growthScore > 30, treeDoc('t_101').growthScore)
  check('发了护林币 +2', userDoc('openid_A').coins === 302, userDoc('openid_A').coins)

  r = await actions.main({ action: 'water', payload: { treeId: 't_101' } })
  check('同一天再浇水被拒', r.ok === false && r.msg.indexOf('今天已经浇过水') >= 0, r.msg)

  r = await actions.main({ action: 'fertilize', payload: { treeId: 't_1730001112001' } })
  check('施肥成功', r.ok === true, r.msg)

  r = await actions.main({ action: 'water', payload: { treeId: 't_1730001112002' } })
  check('别人的树不能浇水', r.ok === false && r.msg.indexOf('不是你认养') >= 0, r.msg)

  console.log('===== 兑换（扣库存 + 扣币）=====')
  const coinsBefore = userDoc('openid_A').coins
  const stockBefore = db.goods[0].stock
  r = await actions.main({ action: 'exchange', payload: { itemId: 's_301' } })
  check('兑换成功', r.ok === true, r.msg)
  check('库存 -1', db.goods[0].stock === stockBefore - 1, db.goods[0].stock + ' / ' + stockBefore)
  check('护林币扣掉 120', userDoc('openid_A').coins === coinsBefore - 120, userDoc('openid_A').coins + ' / ' + coinsBefore)
  check('返回凭证码', /^SYSU-\d{6}$/.test(r.code || ''), r.code)
  check('返回兑换记录文案', !!r.record && r.record.indexOf('帆布袋') >= 0, r.record)

  r = await actions.main({ action: 'exchange', payload: { itemId: 's_302' } })
  check('库存 0 的商品兑不了', r.ok === false && r.msg.indexOf('兑完') >= 0, r.msg)

  console.log('===== 日程打卡（服务端核验）=====')
  aiResponder = function (d) {
    if (d.action === 'verify') return { passed: true, carbonSavedG: 150, comment: '骑行棒', detail: 'ok' }
    return {}
  }
  const ptsBeforeTask = userDoc('openid_A').availablePoints
  r = await actions.main({ action: 'completeTask', payload: { taskId: 'task_201', proofText: '骑到图书馆了' } })
  check('核验通过并打卡', r.ok === true, r.msg)
  check('日程标为已完成', db.tasks[0].done === true)
  check('积分到账 +40', userDoc('openid_A').availablePoints === ptsBeforeTask + 40,
    userDoc('openid_A').availablePoints + ' / ' + ptsBeforeTask)

  aiResponder = function () { return { passed: false, comment: '这张图看不出骑行' } }
  db.tasks[0].done = false
  r = await actions.main({ action: 'completeTask', payload: { taskId: 'task_201', proofText: '随便写点' } })
  check('AI 判不通过则驳回', r.ok === false && r.needProof === true, JSON.stringify(r))

  r = await actions.main({ action: 'completeTask', payload: { taskId: 'task_201' } })
  check('空凭证直接拒绝', r.ok === false, r.msg)

  console.log('===== 新增树木（AI 识别是不是树 + 什么品种，无人工审核）=====')
  aiResponder = function (d) {
    if (d.action === 'review') {
      return { isTree: true, passed: true, species: '水杉', confidence: 0.86, reason: '是水杉', detail: '针叶乔木，树干笔直' }
    }
    return {}
  }
  r = await actions.main({ action: 'addTree', payload: { name: '东湖岸边 · 那棵大树', age: '20', image: 'cloud://x.jpg', imageUrl: 'https://x.jpg', lat: 23.1, lng: 113.3, posX: 60, posY: 40 } })
  check('识别通过直接上架', r.ok === true && r.approved === true, JSON.stringify(r).slice(0, 80))
  check('品种用 AI 识别的结果（用户没填）', r.tree.species === '水杉', r.tree.species)
  check('不再产生 pending 状态', r.tree.reviewStatus === 'approved' && r.tree.status === 'normal',
    r.tree.reviewStatus + '/' + r.tree.status)
  check('树写进库了', !!treeDoc(r.tree.treeId))
  check('返回置信度给卡片用', r.confidence > 0, r.confidence)

  // 模型吐泛称（"乔木"）时不能当作品种显示，卡片上没信息量
  aiResponder = function () { return { isTree: true, passed: true, species: '乔木' } }
  r = await actions.main({ action: 'addTree', payload: { name: '泛称测试', image: 'cloud://x2.jpg', imageUrl: 'https://x2.jpg', lat: 23.1, lng: 113.3, posX: 62, posY: 42 } })
  check('泛称降级成未识别', r.ok === true && r.tree.species === '未识别', r.tree.species)

  // 不是树 → 一票否决，且不能落库（取消人工审核后没有兜底通道了）
  aiResponder = function () { return { isTree: false, passed: false, reason: '照片里是书本' } }
  const treeCountBefore = db.trees.length
  r = await actions.main({ action: 'addTree', payload: { name: '假树', image: 'cloud://y.jpg', imageUrl: 'https://y.jpg', lat: 1, lng: 1, posX: 1, posY: 1 } })
  check('不是树直接拒绝', r.ok === false && r.msg.indexOf('书本') >= 0, r.msg)
  check('拒绝时不落库', db.trees.length === treeCountBefore, db.trees.length + ' / ' + treeCountBefore)

  // AI 不可用：宁可上架一棵"未识别"，也不能让用户白填（演示容错）
  aiResponder = function () { return null }
  r = await actions.main({ action: 'addTree', payload: { name: 'AI 挂了的树', image: 'cloud://z2.jpg', imageUrl: 'https://z2.jpg', lat: 23.1, lng: 113.3, posX: 64, posY: 44 } })
  check('AI 不可用时 fail-open 上架', r.ok === true && r.aiDown === true, JSON.stringify(r).slice(0, 80))
  check('品种记未识别', r.tree.species === '未识别', r.tree.species)

  r = await actions.main({ action: 'addTree', payload: { name: '' } })
  check('缺名称被拒', r.ok === false, r.msg)
  r = await actions.main({ action: 'addTree', payload: { name: '没照片', image: '' } })
  check('缺照片被拒', r.ok === false && r.msg.indexOf('照片') >= 0, r.msg)

  console.log('===== 隐患上报（拒绝非树木照片）=====')
  aiResponder = function () { return { reject: true, reason: '图片为数学题截图，无树木' } }
  const ptsBefore = userDoc('openid_A').availablePoints
  r = await actions.main({ action: 'reportHazard', payload: { treeId: 't_101', image: 'cloud://z.jpg', imageUrl: 'https://z.jpg' } })
  check('非树木照片被拒', r.ok === false && r.msg.indexOf('数学题') >= 0, r.msg)
  check('拒绝时不给积分', userDoc('openid_A').availablePoints === ptsBefore)

  aiResponder = function () { return { level: '高危', analysis: '枯枝悬垂', advice: '清枝', reward: 150 } }
  r = await actions.main({ action: 'reportHazard', payload: { treeId: 't_101', image: 'cloud://z.jpg', imageUrl: 'https://z.jpg' } })
  check('通过后写工单', r.ok === true && !!r.hazard, r.msg)
  check('积分 +150', userDoc('openid_A').availablePoints === ptsBefore + 150, userDoc('openid_A').availablePoints)
  check('树标成隐患态', treeDoc('t_101').status === 'hazard', treeDoc('t_101').status)

  r = await actions.main({ action: 'reportHazard', payload: { treeId: 't_101', image: '' } })
  check('没照片直接拒', r.ok === false && r.msg.indexOf('照片') >= 0, r.msg)

  console.log('===== 新增日程（服务端 AI 分析）=====')
  aiResponder = function (d) {
    if (d.action === 'plan') return { desc: '骑行去上课 · 少排约 200 g CO₂e', basePoints: 40 }
    return {}
  }
  r = await actions.main({ action: 'createTask', payload: { title: '去教学楼上上课', slot: '14:00' } })
  check('日程创建成功', r.ok === true && !!r.task, r.msg)
  check('AI 分析结果写进去了', r.task.desc.indexOf('骑行') >= 0, r.task.desc)
  check('积分在合法区间', r.task.basePoints >= 20 && r.task.basePoints <= 50, r.task.basePoints)
  const plannedTaskId = r.task.taskId

  r = await actions.main({ action: 'createTask', payload: { title: '' } })
  check('空标题被拒', r.ok === false, r.msg)

  console.log('===== 核验对象是做法，不是标题 =====')
  aiResponder = function (d) {
    if (d.action === 'verify') {
      return { passed: true, mode: '骑行', evidence: '3.2 km / 14 分钟', carbonSavedG: 120, comment: '骑行不错', detail: 'ok' }
    }
    return {}
  }
  let verifyReq = null
  const origResponder = aiResponder
  aiResponder = function (d) {
    if (d.action === 'verify') verifyReq = d
    return origResponder(d)
  }
  r = await actions.main({ action: 'completeTask', payload: { taskId: plannedTaskId, proofText: '骑到教学楼 3.2 公里' } })
  check('核验通过并加分', r.ok === true && r.carbonSavedG === 120, JSON.stringify(r).slice(0, 80))
  check('低碳方案一起发给 AI（否则只能核"上课"）',
    !!verifyReq && String(verifyReq.desc || '').indexOf('骑行') >= 0, verifyReq && verifyReq.desc)
  check('返回核验到的做法', r.mode === '骑行', r.mode)
  check('返回凭证依据', !!r.evidence, r.evidence)
  check('做法与依据落库', (function () {
    const d = db.tasks.find(function (t) { return t.taskId === plannedTaskId })
    return !!d && d.verifyMode === '骑行' && d.evidence === '3.2 km / 14 分钟'
  })(), JSON.stringify(db.tasks.find(function (t) { return t.taskId === plannedTaskId })).slice(0, 100))

  console.log('===== 每日日程上限 10 条 =====')
  aiResponder = function (d) {
    if (d.action === 'plan') return { desc: '步行去上课 · 少排约 200 g CO₂e', basePoints: 30 }
    return {}
  }
  let createdCount = 0
  let blocked = null
  for (let k = 0; k < 12; k++) {
    const rr = await actions.main({ action: 'createTask', payload: { title: '占位日程' + k, slot: '09:00' } })
    if (rr.ok) createdCount++
    else { blocked = rr; break }
  }
  check('排到 10 条就拦住', !!blocked && blocked.msg.indexOf('最多') >= 0, blocked && blocked.msg)
  check('没有超过 10 条', createdCount <= 10, createdCount)

  console.log('===== 老数据迁移（users._id -> userId）=====')
  // 模拟历史数据：_id 是随机串而不是 userId
  db.users.push({
    _id: 'random_legacy_id_9f2',
    _openid: 'openid_B',
    userId: 'u_018_legacy',
    nickname: '老用户',
    availablePoints: 5,
    coins: 1,
    totalGrowthScore: 1
  })
  r = await actions.main({ action: 'migrateUsers' })
  check('迁移返回 ok', r.ok === true, JSON.stringify(r).slice(0, 120))
  check('至少迁移 1 条', r.migrated >= 1, r.migrated)
  check('老文档已删除', !db.users.some(function (u) { return u._id === 'random_legacy_id_9f2' }))
  check('新文档 _id 等于 userId',
    db.users.some(function (u) { return u._id === 'u_018_legacy' && u.nickname === '老用户' }))
  r = await actions.main({ action: 'migrateUsers' })
  check('再跑一次是幂等的', r.migrated === 0, r.migrated)

  console.log('===== 坏图清理 =====')
  r = await actions.main({ action: 'cleanBrokenTreeImages' })
  check('清理接口可用', r.ok === true, JSON.stringify(r).slice(0, 120))
  check('清掉 1 张坏图', r.cleaned === 1, r.cleaned)
  check('树上的 image 已置空',
    db.trees.find(function (t) { return t.treeId === 't_broken' }).image === '')

  console.log('===== 改资料 =====')
  r = await actions.main({ action: 'updateProfile', payload: { nickname: '新名字' } })
  check('昵称已更新', r.ok === true && userDoc('openid_A').nickname === '新名字', r.msg)
  r = await actions.main({ action: 'updateProfile', payload: { nickname: '   ' } })
  check('空昵称被拒', r.ok === false, r.msg)

  console.log('===== 重置演示数据（仅管理员）=====')
  // 造一棵"种子树"（createdBy 为空）和一棵用户新增的树，验证重置只删后者
  db.trees.push({
    _id: 't_doc_seed',
    _openid: 'openid_B',
    treeId: 't_seed_1',
    name: '种子树 · 大王椰',
    species: '大王椰子',
    ownerId: 'u_001',
    ownerName: '中大护林员小李',
    level: 2,
    growthScore: 620,
    status: 'hazard',
    hazardText: '枯枝',
    reviewStatus: 'approved',
    createdBy: ''
  })
  db.tasks.push({ _id: 'task_doc_x', _openid: 'openid_A', taskId: 'task_x', title: '待清', done: true })

  openid = 'openid_B'
  r = await actions.main({ action: 'resetDemoData' })
  check('非管理员被拒', r.ok === false && r.msg.indexOf('管理员') >= 0, r.msg)

  openid = 'openid_A'
  r = await actions.main({ action: 'resetDemoData' })
  check('管理员可重置', r.ok === true, JSON.stringify(r).slice(0, 120))
  check('删掉了用户新增的树', r.removedTrees > 0, r.removedTrees)
  check('种子树被保留', !!treeDoc('t_seed_1'))
  const seed = treeDoc('t_seed_1')
  check('种子树归属被清空', seed.ownerId === '' && seed.ownerName === '', seed.ownerId)
  check('种子树成长值归零', seed.level === 0 && seed.growthScore === 0, seed.level + '/' + seed.growthScore)
  check('种子树隐患状态复原', seed.status === 'normal' && seed.hazardText === '', seed.status)
  check('日程被清空', db.tasks.length === 0, db.tasks.length)
  check('积分币归零到演示初值',
    userDoc('openid_A').availablePoints === 520 && userDoc('openid_A').coins === 120,
    userDoc('openid_A').availablePoints + '/' + userDoc('openid_A').coins)

  console.log('===== 清空所有用户数据（wipeData，从零开始）=====')
  // 用户上传的树：真实形态是 t_+13 位时间戳
  db.trees.push({
    _id: 't_doc_uploaded', _openid: 'openid_B', treeId: 't_1730009999001',
    name: '用户传的树', species: '银杏', ownerId: 'u_001', ownerName: '谁',
    level: 1, growthScore: 99, status: 'normal', hazardText: '',
    reviewStatus: 'approved', createdBy: 'u_018'
  })
  db.goods[0].stock = 3
  const usersBeforeWipe = db.users.length

  openid = 'openid_B'
  r = await actions.main({ action: 'wipeData', payload: {} })
  check('非管理员不能清库', r.ok === false && r.msg.indexOf('管理员') >= 0, r.msg)

  openid = 'openid_A'
  r = await actions.main({ action: 'wipeData', payload: { stocks: { s_301: 25, s_302: 12, s_303: 5 } } })
  check('管理员可清库', r.ok === true, JSON.stringify(r).slice(0, 140))
  check('用户上传的树被删', !treeDoc('t_1730009999001'))
  check('种子树保留且归属/成长清空', (function () {
    const d = treeDoc('t_101')
    return !!d && d.ownerId === '' && d.growthScore === 0 && d.createdBy === ''
  })(), JSON.stringify(treeDoc('t_101')).slice(0, 120))
  check('日程/日志/兑换记录全清',
    db.tasks.length === 0 && db.tree_logs.length === 0 && db.records.length === 0,
    db.tasks.length + '/' + db.tree_logs.length + '/' + db.records.length)
  check('商品库存回初值', db.goods[0].stock === 25, db.goods[0].stock)
  check('users 全删（含管理员自己）', db.users.length === 0, db.users.length)
  check('返回统计对得上', r.removedUsers === usersBeforeWipe && r.removedTrees >= 1,
    r.removedUsers + '/' + r.removedTrees)

  console.log('===== 身份与未知 action =====')
  openid = ''
  r = await actions.main({ action: 'water', payload: { treeId: 't_101' } })
  check('拿不到 openid 直接拒', r.ok === false && r.msg.indexOf('身份') >= 0, r.msg)
  openid = 'openid_A'
  r = await actions.main({ action: 'nonsense' })
  check('未知 action 有兜底', r.ok === false && r.msg.indexOf('未知') >= 0, r.msg)

  console.log('===== 分发完整性（防止调用了没定义的函数）=====')
  const src = fs.readFileSync(actionsPath, 'utf-8')
  const dispatched = []
  const re = /action === '([A-Za-z0-9_]+)'\) return await ([A-Za-z0-9_]+)\(/g
  let m
  while ((m = re.exec(src)) !== null) dispatched.push({ action: m[1], fn: m[2] })
  const missing = dispatched.filter(function (d) {
    return src.indexOf('async function ' + d.fn) === -1
  })
  check('分发的每个 action 都有对应函数（共 ' + dispatched.length + ' 个）',
    missing.length === 0,
    missing.map(function (d) { return d.action + '->' + d.fn }).join(', '))

  fs.rmSync(stubDir, { recursive: true, force: true })
  console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败')
  process.exit(failCount === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('测试异常', e)
  process.exit(1)
})
