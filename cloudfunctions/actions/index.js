/**
 * actions 云函数：所有"要写库"的操作都走这里
 *
 * 为什么要它：原来认养、浇水、兑换、打卡都由客户端直接改数据库，为了能认养别人播种的树，
 * trees / goods 只能放开成"所有用户可读写"，等于谁都能改。收权的前提是把写操作搬到服务端。
 *
 * 设计原则（和客户端 store 的本地实现一一对应，逻辑要保持同步）：
 *   1. 身份只认 cloud.getWXContext().OPENID，不看客户端传的 userId
 *   2. 一切数值以服务端库里为准，客户端传的积分/币一律不信
 *   3. 校验不过返回 { ok:false, msg, user, tree }，同时带回服务端真值让客户端纠正
 *   4. AI 判定也在这里发起（调 task-ai），客户端拿不到"可以伪造的通过结果"
 *   5. 成功返回 { ok:true, user, tree|goods|record|logs } 供客户端覆盖内存
 *
 * 部署：右键 cloudfunctions/actions → 上传并部署：云端安装依赖
 * 依赖：wx-server-sdk（云端安装）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

/** 数值口径，与 common/theme.js 保持一致（WATER_COST 10 / FERT_COST 20，WATER_GAIN 20 / FERT_GAIN 50） */
const COST = {
  adopt: 300,
  water: 10,
  fertilize: 20
}
const GAIN = {
  water: 20,
  fertilize: 50
}
// 已停用：浇水/施肥不再自动发护林币（任务奖励改由客户端在林地页手动领取）。
// 常量保留只为返回字段兼容，care() 返回的 coin 现在恒为 0。
const COIN = {
  water: 2,
  fertilize: 5
}
const GROWTH_CAP = 1000
const LEVEL_STEP = 300

/**
 * 演示数据重置白名单。
 * 人工审核取消后，这份名单只剩一个用途：允许谁按"重置演示数据"。
 * 校验必须留在这里（云函数），前端 common/config.js 的同名数组只用来控制入口显隐。
 */
const ADMIN_IDS = ['u_001']

/** 每天日程上限：与 pages/task/task.js 的 TASK_MAX 保持一致 */
const TASK_MAX = 10

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function today() {
  const d = new Date(Date.now() + 8 * 3600 * 1000) // 云函数是 UTC，按北京时间算
  const p = function (n) { return n < 10 ? '0' + n : String(n) }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

function levelOf(score) {
  let lv = 1 + Math.floor(score / LEVEL_STEP)
  if (lv > 4) lv = 4
  if (lv < 1) lv = 1
  return lv
}

function code() {
  return 'SYSU-' + Math.floor(100000 + Math.random() * 899999)
}

/** 当前用户的 users 文档（没有就报错，让客户端先登录/建档） */
async function myDoc(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/**
 * 按 treeId 找树。trees 文档的 _id 就是 treeId（见 common/db.js canonicalId），
 * 走主键查询天然有索引，不用给 treeId 单独建索引；
 * 查不到再退回 where，兼容 canonicalId 生效前写入的老数据。
 */
async function findTree(treeId) {
  if (!treeId) return null
  try {
    const r = await db.collection('trees').doc(treeId).get()
    if (r && r.data) return r.data
  } catch (e) { /* 老数据 _id 不是 treeId，走下面的 where */ }
  const res = await db.collection('trees').where({ treeId: treeId }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 统一的失败返回：带上服务端真值，客户端据此纠正本地内存 */
async function fail(openid, msg, extra) {
  const me = await myDoc(openid).catch(function () { return null })
  return Object.assign({ ok: false, msg: msg, user: pubUser(me) }, extra || {})
}

/** users 文档转给客户端的形状（去掉 _id/_openid 这类元数据） */
function pubUser(doc) {
  if (!doc) return null
  const u = Object.assign({}, doc)
  delete u._id
  delete u._openid
  return u
}

function pubTree(doc) {
  if (!doc) return null
  const t = Object.assign({}, doc)
  delete t._id
  delete t._openid
  return t
}

/** 树种名清理：模型偶尔吐学名/括号/泛称，卡片上要显示干净的具体品种 */
function cleanSpecies(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/[（(].*?[）)]/g, '').replace(/[,，。;；:：、\/]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s === '' || s === '无' || s === '未知' || s === '不确定' || s === 'null') return '未识别'
  const generic = ['乔木', '灌木', '绿植', '植物', '树木', '树', '行道树', '绿化树', '阔叶树', '针叶树']
  if (generic.indexOf(s) >= 0) return '未识别'
  return s.slice(0, 20)
}

/** 调 task-ai 做 AI 判定；云函数互调不受客户端额度影响 */
async function askAi(payload) {
  try {
    const res = await cloud.callFunction({ name: 'task-ai', data: payload })
    const r = res && res.result
    return r || null
  } catch (e) {
    console.warn('[actions] 调 task-ai 失败，走本地兜底', e && e.message)
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 各个 action                                                         */
/* ------------------------------------------------------------------ */

/** 认养：扣积分 + 设归属（事务，防两个人同时抢同一棵） */
async function adopt(openid, payload) {
  const treeId = String(payload.treeId || '')
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  // 首棵树免积分（与客户端 store.adoptTree 一致，零起点新用户也能开始养树）。
  // 统计失败时按原价收：安全默认，避免把收费逻辑做成"查不到就免费"。
  let cost = COST.adopt
  try {
    const cnt = await db.collection('trees').where({ ownerId: me.userId }).count()
    if (cnt && cnt.total === 0) cost = 0
  } catch (e) {
    console.warn('[actions] 统计名下树失败，按原价收费', e && e.message)
  }
  if ((me.availablePoints || 0) < cost) {
    return { ok: false, msg: '积分不足，去低碳日程做任务攒一点吧', user: pubUser(me) }
  }

  const tree = await findTree(treeId)
  if (!tree) return { ok: false, msg: '这棵树不存在', user: pubUser(me) }
  if (tree.ownerId && tree.ownerId !== me.userId) {
    return { ok: false, msg: '这棵树已经有认养人了', user: pubUser(me), tree: pubTree(tree) }
  }
  if (tree.ownerId === me.userId) {
    // 已经是自己的树：和客户端本地判定保持一致，提示而不是静默成功
    return { ok: false, msg: '这棵树已经有认养人了', user: pubUser(me), tree: pubTree(tree) }
  }
  if (tree.reviewStatus === 'pending' || tree.status === 'pending') {
    return { ok: false, msg: '这棵树还在审核中，通过后就能认养了', user: pubUser(me), tree: pubTree(tree) }
  }
  if (tree.reviewStatus === 'rejected' || tree.status === 'rejected') {
    return { ok: false, msg: '这棵树没有通过审核，暂不可认养', user: pubUser(me), tree: pubTree(tree) }
  }
  if (tree.status === 'hazard') {
    return { ok: false, msg: '该树正在隐患处理中，暂不可认养', user: pubUser(me), tree: pubTree(tree) }
  }

  const points = (me.availablePoints || 0) - cost
  const growth = 30
  await db.runTransaction(async function (t) {
    const tDoc = await t.collection('trees').doc(tree._id).get()
    if (tDoc.data.ownerId) {
      const e = new Error('这棵树已经有认养人了')
      e.friendly = true
      throw e
    }
    await t.collection('trees').doc(tree._id).update({
      data: { ownerId: me.userId, ownerName: me.nickname || '森友', level: 1, growthScore: growth }
    })
    await t.collection('users').doc(me._id).update({
      data: {
        availablePoints: points,
        totalGrowthScore: (me.totalGrowthScore || 0) + growth,
        adoptedTreeId: treeId
      }
    })
  }).catch(function (e) {
    if (e && e.friendly) return
    throw e
  })

  const me2 = await myDoc(openid)
  const tree2 = await findTree(treeId)
  return { ok: true, user: pubUser(me2), tree: pubTree(tree2) }
}

/** 浇水 / 施肥：每天每棵各一次，扣积分加成长（护林币改由客户端任务领取） */
async function care(openid, payload, kind) {
  const treeId = String(payload.treeId || '')
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  const tree = await findTree(treeId)
  if (!tree) return { ok: false, msg: '这棵树不存在', user: pubUser(me) }
  if (tree.ownerId !== me.userId) {
    return { ok: false, msg: '这不是你认养的树', user: pubUser(me), tree: pubTree(tree) }
  }

  const cost = kind === 'water' ? COST.water : COST.fertilize
  const gain = kind === 'water' ? GAIN.water : GAIN.fertilize
  const field = kind === 'water' ? 'lastWaterAt' : 'lastFertAt'
  const td = today()

  if (tree[field] === td) {
    return {
      ok: false,
      msg: kind === 'water' ? '今天已经浇过水了，明天再来' : '今天已经施过肥了，明天再来',
      user: pubUser(me),
      tree: pubTree(tree)
    }
  }
  if ((me.availablePoints || 0) < cost) {
    return { ok: false, msg: '积分不足，去低碳日程攒一点吧', user: pubUser(me), tree: pubTree(tree) }
  }
  if ((tree.growthScore || 0) >= GROWTH_CAP) {
    return { ok: false, msg: '这棵树已经长满啦', user: pubUser(me), tree: pubTree(tree) }
  }

  let g = (tree.growthScore || 0) + gain
  if (g > GROWTH_CAP) g = GROWTH_CAP

  await db.collection('trees').doc(tree._id).update({
    data: { growthScore: g, level: levelOf(g), [field]: td }
  })
  // 护林币不再自动到账：任务完成后由客户端在林地页「成长任务」右侧手动领取
  await db.collection('users').doc(me._id).update({
    data: {
      availablePoints: (me.availablePoints || 0) - cost,
      totalGrowthScore: (me.totalGrowthScore || 0) + gain
    }
  })

  const me2 = await myDoc(openid)
  const tree2 = await findTree(treeId)
  return { ok: true, user: pubUser(me2), tree: pubTree(tree2), gain: gain, coin: 0 }
}

/** 兑换：事务扣库存 + 扣护林币 + 写兑换记录 */
async function exchange(openid, payload) {
  const itemId = String(payload.itemId || '')
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  // goods 的 _id 就是 itemId，先走主键；老数据退回 where
  let goods = null
  try {
    const gDoc = await db.collection('goods').doc(itemId).get()
    goods = gDoc && gDoc.data ? gDoc.data : null
  } catch (e) { /* ignore */ }
  if (!goods) {
    const gRes = await db.collection('goods').where({ itemId: itemId }).limit(1).get()
    goods = gRes.data && gRes.data[0]
  }
  if (!goods) return { ok: false, msg: '商品不存在', user: pubUser(me) }
  if ((goods.stock || 0) <= 0) return { ok: false, msg: '这件纪念品已经兑完了', user: pubUser(me) }
  if ((me.coins || 0) < (goods.costCurrency || 0)) {
    return { ok: false, msg: '护林币不够，去林地浇水做任务攒一点吧', user: pubUser(me) }
  }

  const codeText = code()
  await db.runTransaction(async function (t) {
    const g = await t.collection('goods').doc(goods._id).get()
    if ((g.data.stock || 0) <= 0) {
      const e = new Error('这件纪念品已经兑完了')
      e.friendly = true
      throw e
    }
    await t.collection('goods').doc(goods._id).update({ data: { stock: g.data.stock - 1 } })
    await t.collection('users').doc(me._id).update({ data: { coins: (me.coins || 0) - goods.costCurrency } })
  }).catch(function (e) {
    if (e && e.friendly) return
    throw e
  })

  await db.collection('records').add({ data: { text: goods.name + ' · ' + codeText } })

  const me2 = await myDoc(openid)
  const g2 = await db.collection('goods').doc(goods._id).get()
  return {
    ok: true,
    user: pubUser(me2),
    goods: pubGoods(g2.data),
    code: codeText,
    record: goods.name + ' · ' + codeText
  }
}

function pubGoods(doc) {
  if (!doc) return null
  const g = Object.assign({}, doc)
  delete g._id
  delete g._openid
  return g
}

/** 日程打卡：服务端发起 AI 凭证核验，通过才加分（客户端伪造不了核验结果） */
async function completeTask(openid, payload) {
  const taskId = String(payload.taskId || '')
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  // tasks 的 _id 是 `${userId}_${taskId}`，先按主键查；老数据退回 where
  let task = null
  const taskDocId = (me.userId || '') + '_' + taskId
  try {
    const tDoc = await db.collection('tasks').doc(taskDocId).get()
    if (tDoc && tDoc.data && tDoc.data._openid === openid) task = tDoc.data
  } catch (e) { /* ignore */ }
  if (!task) {
    const tRes = await db.collection('tasks').where({ taskId: taskId, _openid: openid }).limit(1).get()
    task = tRes.data && tRes.data[0]
  }
  if (!task) return { ok: false, msg: '这条日程不存在', user: pubUser(me) }
  if (task.done) return { ok: false, msg: '这条日程已经打卡了', user: pubUser(me) }

  const proofText = String(payload.proofText || '')
  const imageUrl = String(payload.imageUrl || '')
  if (proofText === '' && imageUrl === '') {
    return { ok: false, msg: '先拍一张照片再提交', user: pubUser(me) }
  }

  const r = await askAi({
    action: 'verify',
    title: task.title,
    // 方案里写着"步行去上课"这种具体做法，核验对象是它，不是"上课"这个目的
    desc: task.desc || '',
    basePoints: task.basePoints,
    proofText: proofText,
    imageUrl: imageUrl
  })
  if (!r || r.fallback) {
    return { ok: false, msg: 'AI 核验暂时不可用，稍后再试', user: pubUser(me) }
  }
  if (r.passed === false) {
    return {
      ok: false,
      needProof: true,
      msg: r.comment || '这张凭证还证明不了这个做法',
      detail: r.detail || '',
      mode: r.mode || '',
      user: pubUser(me)
    }
  }

  const carbon = Number(r.carbonSavedG) || 0
  await db.collection('tasks').doc(task._id).update({
    data: {
      done: true,
      carbonSavedG: carbon,
      aiComment: r.comment || '',
      proofImage: payload.proofImage || '',
      proofText: proofText,
      // 记下"核验的是哪个做法"，时光轴/复查时能说清楚凭什么通过
      verifyMode: r.mode || '',
      evidence: r.evidence || '',
      reviewStatus: 'approved'
    }
  })
  await db.collection('users').doc(me._id).update({
    data: {
      availablePoints: (me.availablePoints || 0) + (task.basePoints || 0),
      totalGrowthScore: (me.totalGrowthScore || 0) + (task.basePoints || 0)
    }
  })

  const me2 = await myDoc(openid)
  const t2 = await db.collection('tasks').doc(task._id).get()
  return {
    ok: true,
    user: pubUser(me2),
    task: pubTask(t2.data),
    carbonSavedG: carbon,
    comment: r.comment || '',
    detail: r.detail || '',
    mode: r.mode || '',
    evidence: r.evidence || ''
  }
}

function pubTask(doc) {
  if (!doc) return null
  const t = Object.assign({}, doc)
  delete t._id
  delete t._openid
  return t
}

/**
 * 新增树木：服务端 AI 识别「是不是树 + 什么品种」，通过就直接上架。
 *
 * 已取消人工审核，所以这里是唯一关卡：
 *   - AI 明确说不是树 → 直接拒绝，不落库（没有 pending 可以转了）
 *   - AI 调用失败 → fail-open 放行，species 记"未识别"，避免演示时卡死
 */
async function addTree(openid, payload) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  const name = String(payload.name || '').trim()
  const age = String(payload.age || '').trim()
  const image = String(payload.image || '')
  const description = String(payload.description || '').trim()
  const lat = Number(payload.lat)
  const lng = Number(payload.lng)
  const posX = Number(payload.posX)
  const posY = Number(payload.posY)

  if (name === '') return { ok: false, msg: '请先给它起个名字', user: pubUser(me) }
  if (image === '') return { ok: false, msg: '请先上传现场照片', user: pubUser(me) }
  if (!isFinite(posX) || !isFinite(posY)) return { ok: false, msg: '缺少树木位置', user: pubUser(me) }

  const r = await askAi({
    action: 'review',
    name: name,
    age: age,
    description: description,
    imageUrl: String(payload.imageUrl || '')
  })

  // 明确判定"不是树"才拒绝；AI 不可用（r 为 null）走下面的 fail-open
  if (r && r.isTree === false) {
    return {
      ok: false,
      msg: r.reason || '照片里看不到树木，换一张再试',
      isTree: false,
      reason: r.reason || '',
      user: pubUser(me)
    }
  }

  const aiDown = !r
  const species = cleanSpecies((r && r.species) || payload.species)

  const doc = {
    treeId: 't_' + Date.now() + Math.floor(Math.random() * 1000),
    name: name,
    species: species,
    age: age || '未知',
    posX: posX,
    posY: posY,
    lat: lat,
    lng: lng,
    ownerId: '',
    ownerName: '',
    level: 0,
    growthScore: 0,
    status: 'normal',
    hazardText: '',
    reviewStatus: 'approved',
    reviewNote: (r && r.reason) || '',
    image: image,
    description: description,
    createdBy: me.userId,
    _openid: openid
  }

  const add = await db.collection('trees').add({ data: doc })
  doc._id = add._id
  return {
    ok: true,
    tree: pubTree(doc),
    approved: true,
    species: species,
    confidence: (r && Number(r.confidence)) || 0,
    aiDown: aiDown,
    reason: (r && r.reason) || (aiDown ? 'AI 暂时不可用' : ''),
    detail: (r && r.detail) || ''
  }
}

/** 隐患上报：服务端 AI 巡检，通过才写日志、发积分、把树标成隐患 */
async function reportHazard(openid, payload) {
  const treeId = String(payload.treeId || '')
  const image = String(payload.image || '')
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }
  if (image === '') return { ok: false, msg: '没有照片，请拍一张树木现场照片', user: pubUser(me) }

  const tree = await findTree(treeId)
  if (!tree) return { ok: false, msg: '这棵树不存在', user: pubUser(me) }

  const r = await askAi({
    action: 'hazard',
    name: tree.name,
    species: tree.species,
    imageUrl: String(payload.imageUrl || '')
  })
  if (!r) return { ok: false, msg: 'AI 巡检暂时不可用，稍后再试', user: pubUser(me) }
  if (r.reject) return { ok: false, msg: r.reason || '照片里看不到树木', user: pubUser(me) }
  if (!r.level) return { ok: false, msg: 'AI 未能给出巡检结论，稍后再试', user: pubUser(me) }

  const reward = Number(r.reward) || 100
  const logId = 'log_' + Date.now()
  await db.collection('tree_logs').add({
    data: {
      logId: logId,
      treeId: treeId,
      kind: 'hazard',
      imageUrl: image,
      description: '巡检上报：' + tree.name,
      aiAnalysis: '【' + r.level + '预警】' + (r.analysis || ''),
      rewardPoints: reward,
      createdAt: new Date().toISOString().substring(0, 16).replace('T', ' '),
      _openid: openid
    }
  })
  await db.collection('users').doc(me._id).update({
    data: {
      availablePoints: (me.availablePoints || 0) + reward,
      totalGrowthScore: (me.totalGrowthScore || 0) + reward
    }
  })
  // 树的状态只有创建者能改（权限收紧后客户端改不了，这里由云函数代劳）
  await db.collection('trees').doc(tree._id).update({
    data: { status: 'hazard', hazardText: r.analysis || '' }
  }).catch(function (e) { console.warn('[actions] 更新树状态失败', e && e.message) })

  const me2 = await myDoc(openid)
  const tree2 = await findTree(treeId)
  return {
    ok: true,
    user: pubUser(me2),
    tree: pubTree(tree2),
    hazard: { level: r.level, analysis: r.analysis || '', advice: r.advice || '', reward: reward }
  }
}

/** 上传生长实拍：服务端 AI 审核通过才记录 + 加成长（护林币由客户端手动领取） */
async function addGrowthLog(openid, payload) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  const tree = await findTree(String(payload.treeId || ''))
  if (!tree) return { ok: false, msg: '这棵树不存在', user: pubUser(me) }
  if (tree.ownerId !== me.userId) return { ok: false, msg: '这不是你认养的树', user: pubUser(me) }
  if (String(payload.image || '') === '') return { ok: false, msg: '请先拍照', user: pubUser(me) }

  // 首次登记照：客户端没传时用树自己的 image 兜底。
  // cloud:// 视觉模型取不到，先换临时 https；换不到就传空，不阻断上传。
  let referenceImageUrl = String(payload.referenceImageUrl || tree.image || '')
  if (referenceImageUrl.indexOf('cloud://') === 0) {
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [referenceImageUrl] })
      const f = tmp.fileList && tmp.fileList[0]
      referenceImageUrl = (f && f.tempFileURL) || ''
    } catch (e) {
      referenceImageUrl = ''
    }
  }
  if (referenceImageUrl.indexOf('http') !== 0) referenceImageUrl = ''

  const r = await askAi({
    action: 'review',
    name: tree.name,
    species: tree.species,
    age: tree.age,
    description: String(payload.description || '生长实拍'),
    imageUrl: String(payload.imageUrl || ''),
    referenceImageUrl: referenceImageUrl
  })
  if (r && r.passed === false) {
    // sameTree 透传给客户端：false 时页面要显示「不是同一棵树」的专用文案
    return { ok: false, msg: r.reason || '照片里看不出这棵树', sameTree: r.sameTree, user: pubUser(me) }
  }

  const logId = 'log_' + Date.now()
  const gain = 30
  let g = (tree.growthScore || 0) + gain
  if (g > GROWTH_CAP) g = GROWTH_CAP

  await db.collection('tree_logs').add({
    data: {
      logId: logId,
      treeId: tree.treeId,
      kind: 'growth',
      imageUrl: String(payload.image || ''),
      description: String(payload.description || '生长实拍'),
      aiAnalysis: '',
      rewardPoints: 0,
      createdAt: new Date().toISOString().substring(0, 16).replace('T', ' '),
      _openid: openid
    }
  })
  await db.collection('trees').doc(tree._id).update({ data: { growthScore: g, level: levelOf(g) } })
  // 护林币不再自动发：任务奖励由客户端在林地页手动领取
  await db.collection('users').doc(me._id).update({
    data: {
      totalGrowthScore: (me.totalGrowthScore || 0) + gain
    }
  })

  const me2 = await myDoc(openid)
  const tree2 = await findTree(tree.treeId)
  return { ok: true, user: pubUser(me2), tree: pubTree(tree2), logId: logId, gain: gain, coin: 0 }
}

/** 新增日程：AI 分析低碳实现方式也放服务端，保证 basePoints 不是客户端随便填的 */
async function createTask(openid, payload) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  const title = String(payload.title || '').trim()
  const slot = String(payload.slot || '09:00')
  if (title === '') return { ok: false, msg: '先写一件今天要做的事', user: pubUser(me) }

  // 上限 10 条：一天排十件事已经够多了，再多也没人核得动。
  // 客户端也拦一次（为了即时提示），这里才是真正的关卡。
  const cnt = await db.collection('tasks')
    .where({ _openid: openid, date: today() })
    .count()
    .catch(function () { return { total: 0 } })
  if ((cnt && cnt.total) >= TASK_MAX) {
    return {
      ok: false,
      msg: '今天的日程最多 ' + TASK_MAX + ' 条，先完成或删掉一条再加',
      user: pubUser(me)
    }
  }

  const r = await askAi({ action: 'plan', title: title })
  const desc = (r && r.desc) || '选择绿色低碳方式完成这件事 · 少排约 60 g CO₂e'
  let points = Number(r && r.basePoints) || 20
  if (points < 20) points = 20
  if (points > 50) points = 50

  const doc = {
    taskId: 'task_' + Date.now() + Math.floor(Math.random() * 1000),
    userId: me.userId,
    date: today(),
    slot: slot,
    title: title,
    desc: desc,
    basePoints: points,
    done: false,
    carbonSavedG: 0,
    aiComment: '',
    proofImage: '',
    proofText: '',
    reviewStatus: '',
    _openid: openid
  }
  const add = await db.collection('tasks').add({ data: doc })
  doc._id = add._id
  return { ok: true, user: pubUser(me), task: pubTask(doc) }
}

/**
 * 取图片的临时访问链接。
 *
 * 用途：云存储权限若是"仅创建者可读写"，客户端 getTempFileURL 拿不到别人的文件，
 * 图片就裂了。云函数是管理员身份，不受这个限制，可以代取。
 * 前端只在客户端取不到时才走这里，正常情况不会产生额外调用。
 */
async function getTempUrl(openid, payload) {
  const fileID = String(payload.fileID || '')
  if (fileID.indexOf('cloud://') !== 0) return { ok: false, msg: '不是云存储文件' }
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileID] })
    const f = res.fileList && res.fileList[0]
    if (f && f.tempFileURL) return { ok: true, url: f.tempFileURL }
    return { ok: false, msg: (f && f.errMsg) || '取链接失败' }
  } catch (e) {
    return { ok: false, msg: (e && e.message) || '取链接失败' }
  }
}

/** 种子树的 treeId 固定是三位数（t_101~t_112），用户新增的是 t_+13 位时间戳 */
function isUserUploadedTree(t) {
  const createdBy = String(t.createdBy || '')
  const treeId = String(t.treeId || '')
  return createdBy !== '' && !/^t_\d{3}$/.test(treeId)
}

/**
 * 演示数据重置：把库恢复到"刚部署"的样子，供答辩前反复演练。
 *
 * 不依赖 common/mock.js（云函数目录里 require 不到），所以用规则复原而不是重建种子：
 *   - 用 isUserUploadedTree 区分：种子树（t_1xx）保留，用户新增的删掉
 *   - 种子树本身保留，清掉归属/等级/成长/隐患，顺便把历史 pending 转 approved
 *   - tasks / tree_logs / records 是个人过程数据，全清
 *   - users 只归零数值，不动昵称头像（删了 users 会导致用户下次进来重新开号、头像丢失）
 *
 * 不可逆，只能在白名单内调用。
 */
async function resetDemoData(openid) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }
  if (ADMIN_IDS.indexOf(me.userId) < 0) {
    return { ok: false, msg: '只有管理员能重置演示数据', user: pubUser(me) }
  }

  const out = {
    ok: true,
    removedTrees: 0,
    resetTrees: 0,
    cleared: { tasks: 0, tree_logs: 0, records: 0 },
    resetUsers: 0,
    failed: []
  }

  // 1) 删掉用户新增的树
  let rows = ((await db.collection('trees').limit(100).get()).data) || []
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]
    if (!isUserUploadedTree(t)) continue
    try {
      await db.collection('trees').doc(t._id).remove()
      out.removedTrees++
    } catch (e) {
      out.failed.push('tree:' + (t.treeId || t._id))
    }
  }

  // 2) 种子树复原
  rows = ((await db.collection('trees').limit(100).get()).data) || []
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]
    try {
      await db.collection('trees').doc(t._id).update({
        data: {
          ownerId: '',
          ownerName: '',
          level: 0,
          growthScore: 0,
          status: 'normal',
          hazardText: '',
          reviewStatus: 'approved',
          createdBy: ''
        }
      })
      out.resetTrees++
    } catch (e) {
      out.failed.push('tree-reset:' + (t.treeId || t._id))
    }
  }

  // 3) 个人过程数据全清（管理员身份可越过"仅创建者可读写"）
  const names = ['tasks', 'tree_logs', 'records']
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    try {
      const r = await db.collection(name).where({}).remove()
      out.cleared[name] = (r && r.stats && r.stats.removed) || 0
    } catch (e) {
      out.failed.push(name + ': ' + ((e && e.message) || String(e)))
    }
  }

  // 4) users 数值归零，档案保留
  const users = ((await db.collection('users').limit(100).get()).data) || []
  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    try {
      await db.collection('users').doc(u._id).update({
        data: { availablePoints: 0, coins: 0, totalGrowthScore: 0, badgeCount: 0, days: 1 }
      })
      out.resetUsers++
    } catch (e) {
      out.failed.push('user:' + (u.userId || u._id))
    }
  }

  out.user = pubUser(await myDoc(openid))
  return out
}

/**
 * 清空所有用户数据，回到"一个用户也没有"的初始状态。
 *
 * 删：users 全部档案、tasks / tree_logs / records 全部、**所有树**
 *   （种子演示树和测试期上传的假树都是假数据，真树由用户之后重新采集上传）。
 * 不动：goods 商品与库存。
 *
 * 树全删后 pullCloud 不会再自动播种演示树（该逻辑已移除），
 * 地图就是空的，等真实数据导入。
 *
 * 权限：管理员（ADMIN_IDS），或**库里只剩你自己一个用户**。
 *   第二条是给"从零开始"场景用的：先在控制台把 users 删到只剩自己，
 *   再进来点这个按钮，就能自助完成清空，不用改代码加白名单。
 *   库里还有别人时谁都不能清 —— 防止有人误把所有人的数据抹掉。
 *
 * 树一棵不删还有个好处：pullCloud 的 isFirstUser = !trees.length 恒为 false，
 * 清完重新进来一定是 newUser() 新号，不会落进 u_001 演示身份。
 *
 * 不可逆。执行完自己也变成新用户（管理员身份随之消失）。
 */
async function wipeData(openid) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  // 白名单，或"库里只剩我一个"（此时清空不影响任何别人）
  const cnt = await db.collection('users').count().catch(function () { return { total: -1 } })
  const alone = cnt && cnt.total === 1
  if (ADMIN_IDS.indexOf(me.userId) < 0 && !alone) {
    return {
      ok: false,
      msg: '库里还有其他用户的档案，只有管理员或"唯一用户"能清空',
      user: pubUser(me)
    }
  }

  const out = {
    ok: true,
    removedTrees: 0,
    removedUsers: 0,
    cleared: { tasks: 0, tree_logs: 0, records: 0 },
    failed: []
  }

  // 1) 所有树全删（种子演示树 + 测试期上传的，都是假数据）
  const rows = ((await db.collection('trees').limit(100).get()).data) || []
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]
    try {
      await db.collection('trees').doc(t._id).remove()
      out.removedTrees++
    } catch (e) {
      out.failed.push('tree:' + (t.treeId || t._id))
    }
  }

  // 2) 个人过程数据全清
  const names = ['tasks', 'tree_logs', 'records']
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    try {
      const r = await db.collection(name).where({}).remove()
      out.cleared[name] = (r && r.stats && r.stats.removed) || 0
    } catch (e) {
      out.failed.push(name + ': ' + ((e && e.message) || String(e)))
    }
  }

  // 3) 最后删用户档案：放在最后，前面的步骤还要靠 me 做身份校验
  try {
    const r = await db.collection('users').where({}).remove()
    out.removedUsers = (r && r.stats && r.stats.removed) || 0
  } catch (e) {
    out.failed.push('users: ' + ((e && e.message) || String(e)))
    return Object.assign({ ok: false, msg: '删除用户档案失败，数据只清了一部分' }, out)
  }

  return out
}

/**
 * 一次性数据迁移：把 users 文档的 _id 改成 userId。
 *
 * 背景：canonicalId 生效前写入的 users 文档 _id 是随机串，按主键 doc(userId) 查不到，
 * 只能退回 where({userId}) 全表扫描（控制台一直提示建索引）。
 * 迁移后 _id === userId，主键查询直接命中，不需要任何索引（腾讯云侧建索引要套餐）。
 *
 * 幂等，重复执行无副作用。每个失败都带上具体原因，不被统一兜底吞掉。
 */
async function migrateUsers(openid) {
  const out = { ok: true, total: 0, migrated: 0, failed: [] }
  let res
  try {
    res = await db.collection('users').limit(100).get()
  } catch (e) {
    return { ok: false, msg: '读取 users 失败：' + ((e && e.message) || e) }
  }

  const rows = res.data || []
  out.total = rows.length
  const list = rows.filter(function (u) { return u.userId && u._id !== u.userId })

  for (let i = 0; i < list.length; i++) {
    const u = list[i]
    const data = Object.assign({}, u)
    delete data._id
    try {
      await db.collection('users').doc(u.userId).set({ data: data })
      await db.collection('users').doc(u._id).remove()
      out.migrated++
    } catch (e) {
      out.failed.push({ userId: u.userId, oldId: u._id, msg: (e && e.message) || String(e) })
    }
  }
  return out
}

/**
 * 清理坏掉的树图片：trees.image 指向的文件若已不存在，就置空
 * （页面自动回退到内置示意图），避免每次渲染都报网络错误。
 */
async function cleanBrokenTreeImages(openid) {
  const res = await db.collection('trees').limit(100).get()
  const rows = res.data || []
  const ids = []
  for (let i = 0; i < rows.length; i++) {
    const img = String(rows[i].image || '')
    if (img.indexOf('cloud://') === 0) ids.push(img)
  }
  if (!ids.length) return { ok: true, checked: 0, cleaned: 0 }

  const urlRes = await cloud.getTempFileURL({ fileList: ids }).catch(function () { return { fileList: [] } })
  const bad = {}
  ;(urlRes.fileList || []).forEach(function (f) {
    if (!f.tempFileURL) bad[f.fileID] = f.errMsg || 'not exists'
  })

  const cleaned = []
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i]
    const img = String(t.image || '')
    if (bad[img]) {
      await db.collection('trees').doc(t._id).update({ data: { image: '' } }).catch(function () {})
      cleaned.push({ treeId: t.treeId, fileID: img, reason: bad[img] })
    }
  }
  return { ok: true, checked: ids.length, cleaned: cleaned.length, detail: cleaned }
}

/** 改资料（昵称 / 头像 / 碳目标） */
async function updateProfile(openid, payload) {
  const me = await myDoc(openid)
  if (!me) return { ok: false, msg: '请先登录' }

  const patch = {}
  if (typeof payload.nickname === 'string') {
    const nick = payload.nickname.trim()
    if (nick === '') return { ok: false, msg: '先写个名字吧', user: pubUser(me) }
    patch.nickname = nick.slice(0, 12)
  }
  if (typeof payload.bio === 'string') patch.bio = payload.bio.slice(0, 40)
  if (typeof payload.avatar === 'string' && payload.avatar !== '') {
    patch.avatar = payload.avatar.slice(0, 1000)
  }
  if (payload.carbonGoal !== undefined) {
    const g = Number(payload.carbonGoal)
    if (g > 0) patch.carbonGoal = g
  }
  if (!Object.keys(patch).length) return { ok: true, user: pubUser(me) }

  await db.collection('users').doc(me._id).update({ data: patch })
  // 树卡/访客档案读的是树上的冗余 ownerName，改昵称时一起同步（批量更新）
  if (patch.nickname) {
    try {
      await db.collection('trees').where({ ownerId: me.userId }).update({
        data: { ownerName: patch.nickname }
      })
    } catch (e) {
      console.warn('[actions] 同步树认养人昵称失败', e && e.message)
    }
  }
  const me2 = await myDoc(openid)
  return { ok: true, user: pubUser(me2) }
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

exports.main = async function (event) {
  const openid = cloud.getWXContext().OPENID || ''
  if (!openid) return { ok: false, msg: '拿不到用户身份（不是从小程序调用的？）' }

  const action = String(event.action || '')
  const payload = event.payload || {}

  try {
    if (action === 'adopt') return await adopt(openid, payload)
    if (action === 'water') return await care(openid, payload, 'water')
    if (action === 'fertilize') return await care(openid, payload, 'fertilize')
    if (action === 'exchange') return await exchange(openid, payload)
    if (action === 'completeTask') return await completeTask(openid, payload)
    if (action === 'addTree') return await addTree(openid, payload)
    if (action === 'reportHazard') return await reportHazard(openid, payload)
    if (action === 'addGrowthLog') return await addGrowthLog(openid, payload)
    if (action === 'createTask') return await createTask(openid, payload)
    if (action === 'updateProfile') return await updateProfile(openid, payload)
    if (action === 'getTempUrl') return await getTempUrl(openid, payload)
    if (action === 'migrateUsers') return await migrateUsers(openid)
    if (action === 'cleanBrokenTreeImages') return await cleanBrokenTreeImages(openid)
    if (action === 'resetDemoData') return await resetDemoData(openid)
    if (action === 'whoami') return { ok: true, openid: openid }
    if (action === 'wipeData') return await wipeData(openid)
    return { ok: false, msg: '未知 action: ' + action }
  } catch (e) {
    console.error('[actions] 执行失败', action, e && e.message)
    // 诊断类 action 把真实错误吐回去，别再一律"服务器开小差了"
    if (action === 'migrateUsers' || action === 'cleanBrokenTreeImages' || action === 'resetDemoData' || action === 'wipeData') {
      return {
        ok: false,
        msg: '执行失败：' + ((e && (e.errMsg || e.message)) || String(e)),
        errCode: (e && e.errCode) || '',
        stack: String((e && e.stack) || '').slice(0, 300)
      }
    }
    return await fail(openid, '服务器开小差了，稍后再试')
  }
}
