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
const { mockUser, newUser, mockTrees, mockGoods } = require('./mock')
const { stamp } = require('./util')

const STATE_KEY = 'ec_state_v1'
const MODE_LOCAL = 'local'
const MODE_CLOUD = 'cloud'

/** 云开发环境 ID。留空 = 用默认环境（只有一个环境时没问题）。 */
const CLOUD_ENV = 'jchan-d6g7u9or6ce1d060c'

let mode = MODE_LOCAL
let cloudDb = null
let inited = false
/** 本次会话的 openid（由 actions.whoami 取回）。空串 = 未取得，退回 '{openid}' 占位写法 */
let myOpenid = ''

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
    tasks: [],
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

/**
 * 某用户的初始日程。
 * 现在固定为空：日程只算用户自己添加上传的那几条，不再给新号灌模板。
 * （函数保留是为了兼容旧调用方/旧数据脚本，返回值恒为 []）
 */
function personalTasks(userId) {
  return []
}

/** 小程序端单次最多取 100 条，多了要翻页 */
function fetchAll(name, personal) {
  const MAX = 100
  let all = []

  function page(skip) {
    let q = cloudDb.collection(name)
    if (personal) {
      // 优先用真实 openid 显式过滤（whoami 从云函数 getWXContext 取回，最可靠）。
      // 原来依赖 '{openid}' 占位符由服务端替换，但在部分环境/权限组合下不替换，
      // 会导致每次进入都查不到旧档案、反复注册新号——2026-11-04 实测踩坑。
      q = q.where({ _openid: myOpenid || '{openid}' })
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
 * 各集合的业务主键字段。
 * 作用有两个：①生成确定性 _id 做 upsert；②迁移期把"随机 _id 的老文档"按业务主键认回来，
 * 避免同一棵树/同一条日程在云端出现两份。
 */
const KEY_FIELD = {
  users: 'userId',
  trees: 'treeId',
  tasks: 'taskId',
  tree_logs: 'logId',
  goods: 'itemId'
}

/** 业务主键 -> 云端文档 _id。个人集合加 userId 前缀，避免不同用户同名业务 id 撞车 */
function canonicalId(name, doc, index, uid) {
  const me = String(uid || 'me')
  if (name === 'users') return String(doc.userId || me)
  if (name === 'trees') return String(doc.treeId || ('tree_' + index))
  if (name === 'goods') return String(doc.itemId || ('item_' + index))
  if (name === 'records') return me + '_rec_' + index
  const key = doc.taskId || doc.logId || ('i' + index)
  return me + '_' + String(key)
}

/** 稳定指纹：字段排序后序列化，用来判断"这条文档到底变没变" */
function fpOf(obj) {
  const keys = Object.keys(obj || {}).sort()
  const parts = []
  let i = 0
  while (i < keys.length) {
    parts.push(keys[i] + ':' + JSON.stringify(obj[keys[i]]))
    i++
  }
  return '{' + parts.join(',') + '}'
}

/**
 * 同步一个集合：先 upsert 再清理，取代原来的"先删后插"。
 *
 * 为什么改：
 *   1. 原来删完再插，中途失败（断网/被杀/单条 add 报错）会把集合留空，
 *      下次启动 pullCloud 走"日程被清补种子"分支，把打卡历史重置回 4 条 mock。
 *      现在内容没变的文档直接跳过、变了的原地 set()，任何时刻云端都是完整数据。
 *   2. 原来每条 persist 都要"读全量 + 删 N 条 + 插 N 条"，加一条日程产生 2N 次云调用；
 *      现在只有真正变化的文档才写，加一条日程 = 1 次写。
 *
 * 全局集合（trees/goods）只做增改不删，因为没人会删除树或商品，
 * 而且删别人的文档会被"仅创建者可读写"权限拒绝。
 */
function syncCollection(name, docs, uid) {
  const list = docs || []
  const personal = PERSONAL[name]
  const keyField = KEY_FIELD[name]

  return fetchAll(name, personal).then(function (rows) {
    const rowById = {}
    const idByKey = {}
    rows.forEach(function (r) {
      rowById[r._id] = r
      if (keyField) {
        const k = String(r[keyField] == null ? '' : r[keyField])
        if (k && !idByKey[k]) idByKey[k] = r._id
      }
    })

    const desired = []
    const keepId = {}
    list.forEach(function (d, i) {
      const payload = copyDoc(d)
      const key = keyField ? String(payload[keyField] == null ? '' : payload[keyField]) : ''
      const id = (key && idByKey[key]) || canonicalId(name, payload, i, uid)
      if (keepId[id]) return   // 同 id 只留第一条，免得自己跟自己写冲突
      keepId[id] = true
      desired.push({ id: id, payload: payload })
    })

    const writes = []
    desired.forEach(function (d) {
      const old = rowById[d.id]
      if (old && fpOf(copyDoc(old)) === fpOf(d.payload)) return  // 没变，不写
      writes.push(
        cloudDb.collection(name).doc(d.id).set({ data: d.payload })
          .then(function () { return true })
          .catch(function (e) {
            console.warn('[db] 文档写入失败', name, d.id, e)
            return false
          })
      )
    })

    return Promise.all(writes).then(function (rs) {
      const failed = rs.filter(function (x) { return !x }).length
      if (failed) console.warn('[db] 部分文档写入失败', name, failed + '/' + rs.length)
      const written = rs.length - failed

      // 全局集合不清理；个人集合清掉本次快照里已经不存在的文档（如被删除的记录）
      if (!personal) return { written: written, failed: failed, removed: 0 }

      /*
       * 只删"确定是我写的"旧文档。
       *
       * 之前这里见 stale 就 remove，结果换号重登后留下了别的 openid 的文档，
       * 客户端按"仅创建者可读写"去删会报 -502001，每次启动刷一条警告（无害但很吵）。
       * 云函数以管理员身份写的文档不带 _openid，客户端同样删不掉。
       *
       * 判据：这个文档的 _openid 必须是本次"要保留"的文档里出现过的 openid。
       * 那些文档一定是我的（能读到、又要继续写），所以删同 openid 的兄弟文档不会被拒。
       * 剩下的脏数据不在这里硬删，交给 actions 的 resetDemoData 以管理员身份清。
       */
      const ownOpenids = {}
      rows.forEach(function (r) {
        if (keepId[r._id] && r._openid) ownOpenids[r._openid] = true
      })
      const stale = rows.filter(function (r) {
        return !keepId[r._id] && r._openid && ownOpenids[r._openid]
      })
      if (!stale.length) return { written: written, failed: failed, removed: 0 }

      return Promise.all(stale.map(function (r) {
        return cloudDb.collection(name).doc(r._id).remove()
          .then(function () { return true })
          .catch(function (e) {
            console.warn('[db] 旧文档清理失败（可忽略）', name, r._id, e)
            return false
          })
      })).then(function (ds) {
        return { written: written, failed: failed, removed: ds.filter(function (x) { return x }).length }
      })
    })
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
  // 先向云端确认自己的 openid（云函数 getWXContext 最可靠），
  // 后面个人集合的查询用真实值显式过滤，不依赖 '{openid}' 占位符替换
  return ensureOpenid().then(function () {
    return pullCloudInner()
  })
}

/** 向云端取自己的 openid，取不到时退回占位写法（不阻塞启动） */
function ensureOpenid() {
  if (myOpenid) return Promise.resolve(myOpenid)
  try {
    return wx.cloud.callFunction({ name: 'actions', data: { action: 'whoami' } })
      .then(function (res) {
        const r = (res && res.result) || {}
        myOpenid = (r && r.ok && r.openid) || ''
        if (!myOpenid) {
          console.warn('[db] whoami 未取得 openid：', r && (r.msg || r.detail))
        }
        return myOpenid
      })
      .catch(function (e) {
        console.warn('[db] whoami 调用失败，退回 {openid} 占位写法', e && (e.errMsg || e.message))
        myOpenid = ''
        return ''
      })
  } catch (e) {
    console.warn('[db] whoami 调用异常', e && e.message)
    myOpenid = ''
    return Promise.resolve('')
  }
}

function pullCloudInner() {
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

    // —— goods 是系统数据，空了自动补；trees 不再自动播种 ——
    // 树要靠真实采集上传（地图加号），演示树只在本地模式（测试号）存在，
    // 云端清空后就是空地图，等真树导入。谁先进来谁补 goods（同一秒并发可接受）。
    if (!goods.length) jobs.push(['goods', seed.goods])

    // —— 个人数据：查不到"我的"文档 = 第一次来，静默注册（openid 自动建档）——
    // 每个新 openid 都开干净新号：随机昵称、0 积分 0 币、没有树；
    // 日程也不再灌模板 —— 只有用户自己添加的才算，空日程页显示空态。
    let me = users[0]
    if (!me) {
      me = newUser()
      console.warn('[db] 未查到我的档案，注册新号（openid 前 10 位：' + myOpenid.slice(0, 10) + '）。' +
        '若这不是首次进入，说明按 openid 查档案失败，把这条日志发给开发者')
      jobs.push(['users', [me]])
    }

    return Promise.all(jobs.map(function (j) {
      return syncCollection(j[0], j[1], me.userId).catch(function (e) {
        console.warn('[db] 初始化写入失败（检查集合是否建好、权限是否放开）', j[0], e)
        return null
      })
    })).then(function () {
      // 写入完成后再拼 state，新写入的文档这里直接用内存值兜底
      // 注意 trees 不兜底：云端没树就是没树（等真实数据导入）
      if (!users.length) users = [me]
      if (!goods.length) goods = seed.goods

      return buildState(users, trees, tasks, logs, goods, records)
    })
  })
}

/** 把云端拉到的各集合拼成 state。badges 是静态数据，不进云端，由 store 自带 */
function buildState(users, trees, tasks, logs, goods, records) {
  const u = Object.assign({}, users[0] || mockUser())
  // 老数据没有这个字段时兜底成空（以前兜 't_101'，会让新号莫名指向一棵可能不存在的树）
  const adoptedTreeId = typeof u.adoptedTreeId === 'string' ? u.adoptedTreeId : ''
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
      adoptedTreeId: state.adoptedTreeId || '',
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
function writeSnapshot(snap, uid) {
  return Promise.all(Object.keys(snap).map(function (k) {
    return syncCollection(k, snap[k], uid)
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

  // trees / goods 是公共集合，改由 actions 云函数以管理员身份写入；
  // 客户端不再直连写，既能收回集合写权限，也避免"客户端改了但云端没改"的不一致。
  // 注意：首次播种走 pullCloud 的独立路径，不受这里影响。
  let keys = only
  if (keys) {
    keys = keys.filter(function (k) { return k !== 'trees' && k !== 'goods' })
    if (!keys.length) return Promise.resolve(true)
  }

  const snap = snapshotOf(state, keys)
  const uid = (state && state.user && state.user.userId) || 'me'

  writeChain = writeChain
    .catch(function () { /* 上一次失败不影响下一次 */ })
    .then(function () { return writeSnapshot(snap, uid) })
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
 * 偷看本地缓存（只读 Storage，不触发任何网络请求）。
 * 给 store 做"先渲染缓存、再后台刷新"用，页面秒开靠它。
 */
function peekLocal() {
  return loadLocal()
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
  // users 文档的 _id 就是 userId（见 canonicalId），按主键查天然走索引，
  // 不需要为 userId 额外建索引；查不到再退回 where 兼容迁移前的老文档
  return cloudDb.collection('users').doc(userId).get()
    .then(function (res) {
      return res && res.data ? copyDoc(res.data) : null
    })
    .catch(function () {
      return cloudDb.collection('users')
        .where({ userId: userId })
        .limit(1)
        .get()
        .then(function (r2) {
          const d = r2.data && r2.data[0]
          return d ? copyDoc(d) : null
        })
        .catch(function (e) {
          console.warn('[db] 跨用户档案查询失败（检查 users 集合 read 权限）', e)
          return null
        })
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
  peekLocal,
  fetchUserDoc,
  uploadImage,
  seedState,
  newId,
  stamp
}
