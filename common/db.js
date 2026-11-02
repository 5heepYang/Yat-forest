/**
 * 数据访问层（Data Access Layer）
 *
 * 一套接口，两种实现，页面和 store 都不用关心数据存在哪：
 *
 *   云端模式：正式 AppID + 云开发环境可用  ->  wx.cloud.database()
 *   本地模式：测试号 / 没开云开发 / 断网    ->  wx.setStorageSync()
 *
 * 这样队友用测试号开发时，增删改查全部可用（数据存在各自的开发者工具里，重启不丢），
 * 队长合并后用正式 AppID 跑，自动切到云端，一份代码两套后端，谁都不用改自己的代码。
 *
 * 判断依据：wx.getAccountInfoSync().miniProgram.appId === 'touristappid'
 * 就是测试号，直接走本地模式，不去碰 wx.cloud（碰了会报错刷屏）。
 */
const { mockUser, mockTrees, mockTasks, mockGoods } = require('./mock')
const { stamp } = require('./util')

const STATE_KEY = 'ec_state_v1'
const MODE_LOCAL = 'local'
const MODE_CLOUD = 'cloud'

/** 云开发环境 ID。留空 = 用默认环境（只有一个环境时没问题）。 */
const CLOUD_ENV = 'jchan-d6g7u9or6ce1d060c'

let mode = MODE_LOCAL
let cloudDb = null
let inited = false

/* ------------------------------------------------------------------ */
/* 模式判断                                                            */
/* ------------------------------------------------------------------ */

function isTestAccount() {
  try {
    const info = wx.getAccountInfoSync()
    const appId = info && info.miniProgram && info.miniProgram.appId
    // 测试号的 appId 是 touristappid；拿不到也按测试号处理，走本地最安全
    return !appId || appId === 'touristappid'
  } catch (e) {
    return true
  }
}

function init() {
  if (inited) return mode
  inited = true

  if (isTestAccount() || !wx.cloud) {
    mode = MODE_LOCAL
    console.log('[db] 本地模式（测试号或无云能力），数据存在 Storage')
    return mode
  }

  try {
    wx.cloud.init({
      env: CLOUD_ENV || undefined,
      traceUser: true
    })
    cloudDb = wx.cloud.database()
    mode = MODE_CLOUD
    console.log('[db] 云端模式，数据写入云开发数据库')
  } catch (e) {
    console.warn('[db] 云开发初始化失败，回退本地模式', e)
    mode = MODE_LOCAL
  }

  return mode
}

function getMode() {
  return mode
}

/* ------------------------------------------------------------------ */
/* 初始数据（云端和本地的第一份种子数据都来自这里）                     */
/* ------------------------------------------------------------------ */

function seedState() {
  return {
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
    records: [
      '中大古树帆布袋 · SYSU-483920',
      '中大古树帆布袋 · SYSU-771203'
    ]
  }
}

/* ------------------------------------------------------------------ */
/* 本地实现                                                            */
/* ------------------------------------------------------------------ */

function loadLocal() {
  try {
    const data = wx.getStorageSync(STATE_KEY)
    if (data && data.user && data.trees) {
      return data
    }
  } catch (e) {
    console.warn('[db] 读取本地数据失败', e)
  }
  return null
}

function saveLocal(state) {
  try {
    wx.setStorageSync(STATE_KEY, state)
    return true
  } catch (e) {
    console.warn('[db] 写入本地数据失败（可能超出 10MB 上限，检查是否把图片塞进了 state）', e)
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 云端实现                                                            */
/* ------------------------------------------------------------------ */

/** 小程序端单次最多取 100 条，多了要翻页 */
function fetchAll(name) {
  const MAX = 100
  let all = []

  function page(skip) {
    return cloudDb.collection(name)
      .skip(skip)
      .limit(MAX)
      .get()
      .then(function (res) {
        all = all.concat(res.data)
        if (res.data.length === MAX) {
          return page(skip + MAX)
        }
        return all
      })
  }

  return page(0)
}

/** 全量覆盖写入：先清空再插入，保证前后端一致（比赛项目数据量小，够用） */
function replaceAll(name, docs) {
  const list = docs || []

  return fetchAll(name)
    .then(function (rows) {
      if (!rows.length) return null
      const tasks = rows.map(function (d) {
        return cloudDb.collection(name).doc(d._id).remove()
      })
      return Promise.all(tasks)
    })
    .then(function () {
      if (!list.length) return null
      const tasks = list.map(function (d) {
        return cloudDb.collection(name).add({ data: copyDoc(d) })
      })
      return Promise.all(tasks)
    })
}

/** 去掉云端自动生成的字段，回写时带着它们会报错 */
function copyDoc(d) {
  const c = Object.assign({}, d)
  delete c._id
  delete c._openid
  return c
}

function pullCloud() {
  const names = ['users', 'trees', 'tasks', 'tree_logs', 'goods', 'records']

  return Promise.all(names.map(function (n) {
    return fetchAll(n).catch(function () { return [] })
  })).then(function (results) {
    const users = results[0]
    const trees = results[1]
    const tasks = results[2]
    const logs = results[3]
    const goods = results[4]
    const records = results[5]

    // 哪个集合是空的就补哪个，避免只建了部分集合时页面白屏
    const seed = seedState()
    const missing = []
    if (!users.length) missing.push('users')
    if (!trees.length) missing.push('trees')
    if (!tasks.length) missing.push('tasks')
    if (!logs.length) missing.push('tree_logs')
    if (!goods.length) missing.push('goods')
    if (!records.length) missing.push('records')

    if (missing.length) {
      console.log('[db] 这些集合还没有数据，补种：', missing.join(', '))
      const fill = writeSnapshot(snapshotOf(seed, missing))
      // 补种失败不影响本次进页面，本地还有缓存兜底
      return fill.catch(function (e) {
        console.warn('[db] 补种失败（多半是集合还没在控制台建好）', e)
      }).then(function () {
        return buildState(users, trees, tasks, logs, goods, records, seed)
      })
    }

    return buildState(users, trees, tasks, logs, goods, records, seed)
  })
}

/** 把云端拉到的各集合拼成 state，空的部分用种子数据兜底 */
function buildState(users, trees, tasks, logs, goods, records, seed) {
  // adoptedTreeId / carbonGoal 没有独立集合，寄存在 users 文档里一起存
  const u = Object.assign({}, users[0] || seed.user)
  const adoptedTreeId = u.adoptedTreeId || 't_101'
  const carbonGoal = u.carbonGoal || 100
  delete u.adoptedTreeId
  delete u.carbonGoal

  return {
    user: u,
    adoptedTreeId: adoptedTreeId,
    carbonGoal: carbonGoal,
    trees: trees.length ? trees : seed.trees,
    tasks: tasks.length ? tasks : seed.tasks,
    logs: logs.length ? logs : seed.logs,
    goods: goods.length ? goods : seed.goods,
    records: records.length
      ? records.map(function (r) { return typeof r === 'string' ? r : (r.text || '') })
      : seed.records
  }
}

/**
 * 把内存状态转成"集合名 -> 文档数组"的快照。
 * 立即快照是为了排队写入期间 state 又被改了也能写对。
 *
 * @param {object} state 全量状态
 * @param {Array}  only  只落这些集合（如 ['trees','users']），不传则全写
 */
function snapshotOf(state, only) {
  const all = {
    // 认养的树 id 和碳目标没有独立集合，附在 users 文档上一起存
    users: [Object.assign(copyDoc(state.user || {}), {
      adoptedTreeId: state.adoptedTreeId || 't_101',
      carbonGoal: state.carbonGoal || 100
    })],
    trees: (state.trees || []).map(copyDoc),
    tasks: (state.tasks || []).map(copyDoc),
    tree_logs: (state.logs || []).map(copyDoc),
    goods: (state.goods || []).map(copyDoc),
    records: (state.records || []).map(function (r) {
      return typeof r === 'string' ? { text: r } : copyDoc(r)
    })
  }

  const keys = only || Object.keys(all)
  const out = {}
  keys.forEach(function (k) {
    out[k] = all[k] || []
  })
  return out
}

/** 真正落库：并发写各个集合，互不影响 */
function writeSnapshot(snap) {
  return Promise.all(Object.keys(snap).map(function (k) {
    return replaceAll(k, snap[k])
  }))
}

/** 串行队列：防止两次写入的"删-插"交叉，把集合写空 */
let writeChain = Promise.resolve()

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 拉取全量数据。永远 resolve 一个可用的 state：
 * - 本地模式：Storage 有就返回，没有就返回种子数据
 * - 云端模式：拉云端，失败则退回本地缓存
 */
function pull() {
  init()

  if (mode === MODE_LOCAL) {
    const local = loadLocal()
    if (local) return Promise.resolve(local)
    const seed = seedState()
    saveLocal(seed)
    return Promise.resolve(seed)
  }

  return pullCloud()
    .then(function (data) {
      saveLocal(data) // 云端数据在本地留一份缓存，断网也能进
      return data
    })
    .catch(function (e) {
      console.warn('[db] 云端拉取失败，使用本地缓存', e)
      return loadLocal() || seedState()
    })
}

/**
 * 保存数据。调用方不 await 也不会阻塞界面。
 * @param {object} state 全量状态
 * @param {Array}  only  只落库这些集合（如 ['trees','users']），不传则全写
 */
function save(state, only) {
  saveLocal(state)

  if (mode !== MODE_CLOUD) {
    return Promise.resolve(true)
  }

  const snap = snapshotOf(state, only)

  writeChain = writeChain
    .catch(function () { /* 上一次失败不影响下一次 */ })
    .then(function () { return writeSnapshot(snap) })
    .then(function () { return true })
    .catch(function (e) {
      console.warn('[db] 云端写入失败（本地已保存，下次启动会重试拉取）', e)
      return false
    })

  return writeChain
}

/**
 * 上传图片，返回可直接放进 <image src> 的地址。
 *
 * 云端模式：传云存储，返回 fileID
 * 本地模式：转 base64 存 Storage，返回 dataURL（重启仍在，能撑到合并）
 *
 * 注意：本地模式下 base64 很占空间，Storage 上限 10MB，
 * 队友开发时建议每张图先压缩（wx.compressImage）。
 */
function uploadImage(filePath) {
  init()

  if (mode === MODE_CLOUD) {
    const ext = (filePath.match(/\.(\w+)$/) || [, 'jpg'])[1]
    const cloudPath = 'tree_photos/' + Date.now() + '_' + Math.floor(Math.random() * 10000) + '.' + ext
    return wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath
    }).then(function (res) {
      return res.fileID
    })
  }

  // 本地模式：读成 base64
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'base64',
      success: function (res) {
        resolve('data:image/jpeg;base64,' + res.data)
      },
      fail: function (e) {
        console.warn('[db] 图片转 base64 失败', e)
        reject(e)
      }
    })
  })
}

/** 生成本地唯一 id（云端模式下业务 id 仍然用它，便于离线创建后同步） */
function newId(prefix) {
  return prefix + '_' + Date.now() + Math.floor(Math.random() * 1000)
}

module.exports = {
  MODE_LOCAL,
  MODE_CLOUD,
  init,
  getMode,
  isTestAccount,
  pull,
  save,
  uploadImage,
  seedState,
  newId,
  stamp
}
