/**
 * 多树认养回归测试（本地模式，不联网、不碰云端）
 *
 * 用法：在小程序根目录执行  node tools/storetest.js
 * 用 touristappid 把 db 逼进本地 Storage 模式，然后验证：
 *   1. 能认养第二棵树，第一棵不受影响
 *   2. adoptedTreeId 变成"当前养护树"，切换只影响当前树
 *   3. water/fertilize 可指定树，不传时作用于当前树
 *   4. 指向别人的树会自动退化回自己的树
 */

const memStorage = {}
global.wx = {
  getAccountInfoSync() {
    // 测试号 -> db 走本地 Storage 模式，全链路不碰 wx.cloud
    return { miniProgram: { appId: 'touristappid' } }
  },
  setStorageSync(k, v) { memStorage[k] = JSON.parse(JSON.stringify(v)) },
  getStorageSync(k) { return memStorage[k] },
  getWindowInfo() { return { statusBarHeight: 20 } }
}

const store = require('../common/store.js')
const { ADOPT_COST, WATER_GAIN, FERT_GAIN } = require('../common/theme')

let pass = 0
let failCount = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { failCount++; console.log('  FAIL  ' + label + '  ' + (detail || '')) }
}

function growthOf(treeId) {
  const t = store.treeById(treeId)
  return t ? t.growthScore : null
}
function ownerOf(treeId) {
  const t = store.treeById(treeId)
  return t ? t.ownerId : null
}

;(async () => {
  await store.ready()

  console.log('===== S1 初始状态 =====')
  const me = store.state.user.userId
  check('默认有 1 棵树', store.myTrees().length === 1, '实际 ' + store.myTrees().length)
  const first = store.myTrees()[0].treeId
  check('第一棵是 t_101', first === 't_101', first)
  check('myTree 指向它', store.myTree().treeId === first)

  console.log('===== S2 认养第二棵 =====')
  store.updateUser({ availablePoints: 2000 })
  const before1 = growthOf(first)
  // 从种子数据里挑两棵真正无主的树（种子里 t_102 已经被 u_018 认养了）
  const free = store.state.trees.filter(function (x) { return x.ownerId === '' }).map(function (x) { return x.treeId })
  check('种子里有足够的无主树', free.length >= 2, '只有 ' + free.length + ' 棵')
  const second = free[0]
  const err = store.adoptTree(second)
  check('认养成功', err === '', err)
  check('现在有 2 棵树', store.myTrees().length === 2, '实际 ' + store.myTrees().length)
  check('认养后自动聚焦新树', store.myTree().treeId === second, store.myTree().treeId)
  check('第一棵归属没被抢走', ownerOf(first) === me, ownerOf(first))
  check('第一棵成长值没被动', growthOf(first) === before1, before1 + ' -> ' + growthOf(first))
  check('扣了认养费', store.state.user.availablePoints === 2000 - ADOPT_COST, String(store.state.user.availablePoints))

  console.log('===== S3 切换当前树，浇水只作用于当前树 =====')
  check('切回第一棵', store.selectTree(first) === true)
  check('myTree 变成第一棵', store.myTree().treeId === first)
  const g1 = growthOf(first)
  const g2 = growthOf(second)
  const errW = store.water()
  check('浇水成功', errW === '', errW)
  check('第一棵涨了成长值', growthOf(first) === g1 + WATER_GAIN, g1 + ' -> ' + growthOf(first))
  check('第二棵没被动', growthOf(second) === g2, g2 + ' -> ' + growthOf(second))

  console.log('===== S4 显式指定树浇水 =====')
  const g2b = growthOf(second)
  const g1b = growthOf(first)
  store.fertilize(second)
  check('第二棵涨了成长值', growthOf(second) === g2b + FERT_GAIN, g2b + ' -> ' + growthOf(second))
  check('第一棵没被动', growthOf(first) === g1b)
  const strangerErr = store.fertilize('t_102')   // 别人认养的树
  check('给别人认养的树施肥会被拒绝', strangerErr === '这不是你认养的树', strangerErr)

  console.log('===== S5 非法切换与自动退化 =====')
  check('不能切到无主的树', store.selectTree(free[1]) === false)
  check('不能切到不存在的树', store.selectTree('t_999') === false)
  const keep = store.state.adoptedTreeId
  store.state.adoptedTreeId = free[1]   // 模拟脏数据：指向了无主的树
  check('脏数据时 myTree 自动退化到自己的树', store.myTree().treeId === first, store.myTree().treeId)
  store.state.adoptedTreeId = keep

  console.log('===== S6 两棵树的养护进度互不干扰（kit 分桶由页面负责，这里验证数据层）=====')
  const a = store.treeById(first)
  const b = store.treeById(second)
  check('两棵树等级独立', typeof a.level === 'number' && typeof b.level === 'number')
  check('两棵树成长值不同', a.growthScore !== b.growthScore, a.growthScore + ' vs ' + b.growthScore)
  check('myTrees 按等级/成长值降序', (function () {
    const list = store.myTrees()
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].level < list[i].level) return false
      if (list[i - 1].level === list[i].level && list[i - 1].growthScore < list[i].growthScore) return false
    }
    return true
  })())

  console.log('===== S7 隐患上报可指定任意树（地图页场景） =====')
  const stranger = store.state.trees.filter(function (x) { return x.ownerId !== '' && x.ownerId !== store.state.user.userId })[0]
  check('找到别人认养的树', !!stranger)
  const logsBefore = store.state.logs.length
  const ptsBefore = store.state.user.availablePoints
  const errH = store.reportHazard(
    { level: '中', ticket: 'HT-TEST', analysis: '树冠枯枝', advice: '修剪', reward: 30 },
    '地图巡检拍照：' + stranger.name,
    '/static/illus/palm.png',
    stranger.treeId
  )
  check('对别人的树上报成功', errH === '', errH)
  check('写了一条隐患日志', store.state.logs.length === logsBefore + 1, store.state.logs.length)
  check('日志挂在那棵树上', store.state.logs[store.state.logs.length - 1].treeId === stranger.treeId,
    store.state.logs[store.state.logs.length - 1].treeId)
  check('上报人拿到积分', store.state.user.availablePoints === ptsBefore + 30,
    ptsBefore + ' -> ' + store.state.user.availablePoints)
  const errBad = store.reportHazard({ level: '中', ticket: 'X', analysis: '', advice: '', reward: 10 }, 'x', '', 'not_exist_tree')
  check('不存在的树会被拒绝', errBad === '这棵树不存在', errBad)

  console.log('===== S8 新增树审核流程 =====')
  check('当前账号是管理员', store.isAdmin() === true)
  const pendingId = 't_pending_test'
  store.addTree({
    treeId: pendingId, name: '测试·待审核的树', species: '樟树', posX: 60, posY: 40,
    lat: 0, lng: 0, ownerId: '', ownerName: '', level: 0, growthScore: 0,
    status: 'pending', hazardText: '', age: '20', reviewStatus: 'pending',
    image: '', description: '', createdBy: store.state.user.userId
  })
  const t1 = store.treeById(pendingId)
  check('待审核树已入库', !!t1 && t1.reviewStatus === 'pending')
  const adoptErr = store.adoptTree(pendingId)
  check('待审核的树不能认养', adoptErr === '这棵树还在人工审核中，通过后就能认养了', adoptErr)

  const rvErr = store.reviewTree(pendingId, true)
  check('管理员可通过审核', rvErr === '', rvErr)
  const t2 = store.treeById(pendingId)
  check('通过后状态为 approved/normal', t2.reviewStatus === 'approved' && t2.status === 'normal',
    t2.reviewStatus + '/' + t2.status)
  check('通过后可以认养了', store.treeById(pendingId).ownerId === '' && store.adoptTree(pendingId) === '')
  const again = store.reviewTree(pendingId, true)
  check('已审过的不能再审', again === '这棵树不在待审核状态', again)

  const rejectId = 't_reject_test'
  store.addTree({
    treeId: rejectId, name: '测试·要被驳回的树', species: '榕树', posX: 40, posY: 60,
    lat: 0, lng: 0, ownerId: '', ownerName: '', level: 0, growthScore: 0,
    status: 'pending', hazardText: '', age: '未知', reviewStatus: 'pending',
    image: '', description: '', createdBy: store.state.user.userId
  })
  check('管理员可驳回', store.reviewTree(rejectId, false) === '')
  const t3 = store.treeById(rejectId)
  check('驳回后状态为 rejected', t3.reviewStatus === 'rejected' && t3.status === 'rejected',
    t3.reviewStatus + '/' + t3.status)
  const rejAdopt = store.adoptTree(rejectId)
  check('驳回的树也不能认养', rejAdopt === '这棵树没有通过审核，暂不可认养', rejAdopt)

  console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败')
  process.exit(failCount === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('测试异常', e)
  process.exit(1)
})
