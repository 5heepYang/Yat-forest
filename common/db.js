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
 * 云端按 _openid 做数据隔离（见 PERSONAL 表）：
 *   users / tasks / tree_logs / records  每人一份，查不到就静默注册（这就是"登录"）
 *   trees / goods                        全局共享，大家看同一片林子、同一批库存
 * 不需要 wx.login / code2Session —— 云开发在写入时自动注入 _openid，登录是免费的。
 *
 * 判断依据：wx.getAccountInfoSync().miniProgram.appId === 'touristappid'
 * 就是测试号，直接走本地模式，不去碰 wx.cloud（碰了会报错刷屏）。
 */
const { mockUser, newUser, mockTrees, mockTasks, mockGoods } = require('./mock')
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
    ],
    adoptedTreeId: 't_101',
    carbonGoal: 100
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

/**
 * 集合归属：
 *   true  = 每个用户一份（读写时按 _openid 过滤，互相看不见）
 *   false = 全局共享一份（大家看同一片林子、同一批商品库存）
 */
const PERSONAL = {
  users: true,
  trees: false,
  tasks: true,
  tree_logs: true,
  goods: false,
  records: true
}

/** 生成某用户的初始日程（每人自己的低碳日程，内容同一套模板） */
function personalTasks(userId) {
  return mockTasks().map(function (t) {
    return Object.assign({}, t, { userId: userId })
  })
}

/** 小程序端单次最多取 100 条，多了要翻页 */
function fetchAll(name, personal) {
  const MAX = 100
  let all = []

  function page(skip) {
    let q = cloudDb.collection(name)
    if (personal) {
      // '{openid}' 是云开发的通配写法，服务端会替换成当前用户的 openid
      q = q.where({ _openid: '{openid}' })
    }
    return q.orderBy('_id', 'asc')
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

/**
 * 覆盖写入一个集合：先删后插。
 * personal 集合只删"我的"文档，不会碰到别人的数据。
 * 注意：trees/goods 是全量覆盖，两人同时写会以后写的为准（比赛规模可接受，
 * 要严格就改成 .doc(id).update() 逐字段更新，或上云函数）。
 */
function replaceAll(name, docs) {
  const list = docs || []

  return fetchAll(name, PERSONAL[name])
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
  return Promise.all([
    fetchAll('users', true),
    fetchAll('trees', false),
    fetchAll('tasks', true),
    fetchAll('tree_logs', true),
    fetchAll('goods', false),
    fetchAll('records', true)
  ]).then(function (r) {
    let users = r[0]
    let trees = r[1]
    let tasks = r[2]
    let logs = r[3]
    let goods = r[4]
    let records = r[5]

    const seed = seedState()
    const jobs = []

    // —— 全局数据只播种一次：谁先进来谁播 ——
    // （两人同一秒首次进入会有重复种子，比赛规模可接受）
    const isFirstUser = !trees.length
    if (!trees.length) jobs.push(['trees', seed.trees])
    if (!goods.length) jobs.push(['goods', seed.goods])

    // —— 个人数据：查不到"我的"文档 = 第一次来，静默注册（openid 自动建档）——
    let me = users[0]
    if (!me) {
      // 第一个用户沿用种子身份 u_001（种子树 t_101 的 ownerId 就是它），
      // 之后每个新 openid 发新 id、开干净新号
      me = isFirstUser ? Object.assign({}, mockUser()) : newUser()
      me.adoptedTreeId = isFirstUser ? 't_101' : ''
      jobs.push(['users', [me]])
      jobs.push(['tasks', personalTasks(me.userId)])
      if (isFirstUser) {
        // 第一个进来的用户拿完整演示数据：认养 t_101 + 三条成长日志 + 两条兑换记录
        jobs.push(['tree_logs', seed.logs])
        jobs.push(['records', seed.records.map(function (t) { return { text: t } })])
      }
    } else if (!tasks.length) {
      // 老用户但日程被清了，补一份
      jobs.push(['tasks', personalTasks(me.userId)])
    }

    return Promise.all(jobs.map(function (j) {
      return replaceAll(j[0], j[1]).catch(function (e) {
        console.warn('[db] 初始化写入失败（检查集合是否建好、权限是否放开）', j[0], e)
        return null
      })
    })).then(function () {
      // 写入完成后再拼 state，新写入的文档这里直接用内存值兜底
      if (!users.length) users = [me]
      if (!trees.length) trees = seed.trees
      if (!tasks.length) tasks = personalTasks(me.userId)
      if (!goods.length) goods = seed.goods
      if (isFirstUser && !logs.length) logs = seed.logs
      if (isFirstUser && !records.length) {
        records = seed.records.map(function (t) { return { text: t } })
      }

      return buildState(users, trees, tasks, logs, goods, records)
    })
  })
}

/** 把云端拉到的各集合拼成 state。badges 是静态数据，不进云端，由 store 自带 */
function buildState(users, trees, tasks, logs, goods, records) {
  const u = Object.assign({}, users[0] || mockUser())
  const adoptedTreeId = typeof u.adoptedTreeId === 'string' ? u.adoptedTreeId : 't_101'
  const carbonGoal = u.carbonGoal || 100
  delete u.adoptedTreeId
  delete u.carbonGoal

  return {
    user: u,
    adoptedTreeId: adoptedTreeId,
    carbonGoal: carbonGoal,
    trees: trees,
    tasks: tasks,
    logs: logs,
    goods: goods,
    records: records.map(function (r) { return typeof r === 'string' ? r : (r.text || '') })
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

/**
 * 跨用户查档案：地图页进别人主页用。
 * users 是个人集合，云端按 userId 查（需要集合 read 权限放开，见 CONTRACT 权限分级表）。
 * 查不到（本地模式 / TA 没注册过 / 权限没放开）一律返回 null，
 * 页面拿 null 自己用全局 trees 上的冗余字段拼一份兜底档案。
 */
function fetchUserDoc(userId) {
  init()
  if (mode !== MODE_CLOUD || !userId) {
    return Promise.resolve(null)
  }
  return cloudDb.collection('users')
    .where({ userId: userId })
    .limit(1)
    .get()
    .then(function (res) {
      const d = res.data && res.data[0]
      return d ? copyDoc(d) : null
    })
    .catch(function (e) {
      console.warn('[db] 跨用户档案查询失败（检查 users 集合 read 权限）', e)
      return null
    })
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
  fetchUserDoc,
  seedState,
  newId,
  stamp
}
