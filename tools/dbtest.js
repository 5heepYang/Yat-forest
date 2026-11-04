/**
 * db.js 写入层回归测试（本地假云端，不联网）
 *
 * 用法：在小程序根目录执行  node tools/dbtest.js
 * tools/ 已在 project.config.json 的 packOptions.ignore 中，不会被打进小程序包。
 *
 * 目的：验证 syncCollection 相比旧 replaceAll 是否真的满足三条：
 *   1. 中途写失败不会留下空集合
 *   2. 只写变化的文档（写放大消失）
 *   3. 迁移期随机 _id 的老文档不会插出重复
 */
let OPENID = 'openid_A'
const stats = { writes: 0, removes: 0, reads: 0 }
const FAIL = { setIds: new Set() }
const store = {} // collectionName -> Map(_id -> doc)

function clone(o) { return JSON.parse(JSON.stringify(o)) }

function collectionApi(name) {
  const q = { where: null, skip: 0, limit: 100 }
  const api = {
    where(w) { q.where = w; return api },
    orderBy() { return api },
    skip(n) { q.skip = n; return api },
    limit(n) { q.limit = n; return api },
    get() {
      stats.reads++
      let arr = Array.from((store[name] || new Map()).values())
      if (q.where) arr = arr.filter(function (d) { return d._openid === OPENID })
      arr.sort(function (a, b) { return a._id < b._id ? -1 : 1 })
      return Promise.resolve({ data: clone(arr.slice(q.skip, q.skip + q.limit)) })
    },
    doc(id) {
      return {
        set(arg) {
          if (FAIL.setIds.has(id)) return Promise.reject(new Error('模拟写入失败: ' + id))
          stats.writes++
          const bag = store[name] || (store[name] = new Map())
          const old = bag.get(id) || {}
          bag.set(id, Object.assign({ _id: id, _openid: OPENID }, clone(arg.data)))
          return Promise.resolve({ _id: id, updated: Object.keys(old).length > 0 })
        },
        remove() {
          stats.removes++
          const bag = store[name]
          if (bag) bag.delete(id)
          return Promise.resolve({})
        },
        update(arg) {
          const bag = store[name]
          const old = bag.get(id) || {}
          bag.set(id, Object.assign({}, old, clone(arg.data)))
          return Promise.resolve({})
        }
      }
    },
    add(arg) {
      throw new Error('不应该再调用 add（应改为 doc(id).set）')
    }
  }
  return api
}

const memStorage = {}
global.wx = {
  getAccountInfoSync() { return { miniProgram: { appId: 'wxRealAppId' } } },
  cloud: {
    init() {},
    database() { return { collection: collectionApi } },
    uploadFile() { return Promise.resolve({ fileID: 'cloud://x' }) }
  },
  setStorageSync(k, v) { memStorage[k] = v },
  getStorageSync(k) { return memStorage[k] }
}

const db = require('../common/db.js')

function countOf(name) { return (store[name] || new Map()).size }
// 只清计数器与故障注入；云端数据要保留，否则测不出"没变就不写"
function reset() { stats.writes = 0; stats.removes = 0; stats.reads = 0; FAIL.setIds.clear() }
function wipeCloud() { Object.keys(store).forEach(k => store[k].clear()); reset() }
let pass = 0, failCount = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { failCount++; console.log('  FAIL  ' + label + '  ' + (detail || '')) }
}

(async () => {
  console.log('===== S1 首次 pull：播种 =====')
  wipeCloud()
  const s1 = await db.pull()
  check('trees 0 条（云端不播种演示树，等真实导入）', countOf('trees') === 0, '实际 ' + countOf('trees'))
  check('tasks 0 条（新号不再灌示例日程）', countOf('tasks') === 0, '实际 ' + countOf('tasks'))
  check('state.user 存在', !!(s1 && s1.user && s1.user.userId), JSON.stringify(s1 && s1.user))
  console.log('  写入 ' + stats.writes + ' 次 / 删除 ' + stats.removes + ' 次')

  console.log('===== S2 加一条日程：应只写 1 条 =====')
  reset()
  s1.tasks.push({ taskId: 'task_new_1', userId: s1.user.userId, date: '11-03', slot: '20:00', title: '骑共享单车去图书馆', desc: '骑行', basePoints: 40, done: false, carbonSavedG: 0 })
  await db.save(s1, ['tasks'])
  check('只产生 1 次写入', stats.writes === 1, '实际 ' + stats.writes)
  check('没有删除动作', stats.removes === 0, '实际 ' + stats.removes)
  check('tasks 变成 1 条', countOf('tasks') === 1, '实际 ' + countOf('tasks'))

  console.log('===== S3 重复保存同样内容：应零写入 =====')
  reset()
  await db.save(s1, ['tasks'])
  check('零写入零删除', stats.writes === 0 && stats.removes === 0, 'writes=' + stats.writes + ' removes=' + stats.removes)

  console.log('===== S4 删掉一条日程：应只删 1 条、零写入 =====')
  reset()
  s1.tasks = s1.tasks.filter(t => t.taskId !== 'task_new_1')
  await db.save(s1, ['tasks'])
  check('零写入', stats.writes === 0, '实际 ' + stats.writes)
  check('只删 1 条', stats.removes === 1, '实际 ' + stats.removes)
  check('tasks 回到 0 条', countOf('tasks') === 0, '实际 ' + countOf('tasks'))

  console.log('===== S5 旧随机 _id 文档迁移：不得插出重复 =====')
  // 新号不再灌示例日程，自己造一份带 taskId 的正常文档，再改成随机 _id 模拟老数据
  s1.tasks.push({
    taskId: 'task_201', userId: s1.user.userId, date: '11-03', slot: '09:00',
    title: '标准标题', desc: 'x', basePoints: 20, done: false, carbonSavedG: 0
  })
  await db.save(s1, ['tasks'])
  reset()
  const bag = store.tasks
  const victim = Array.from(bag.values()).find(d => d.taskId === 'task_201')
  check('找到 task_201 老文档', !!victim)
  bag.delete(victim._id)
  const legacyId = 'randomLegacyId123'
  bag.set(legacyId, Object.assign({}, victim, { _id: legacyId, title: '老数据标题' }))
  await db.save(s1, ['tasks'])
  const sameTaskId = Array.from(bag.values()).filter(d => d.taskId === 'task_201')
  check('task_201 仍只有 1 条', sameTaskId.length === 1, '实际 ' + sameTaskId.length + ' 条')
  check('原地更新了老 _id（未另建新文档）', sameTaskId[0]._id === legacyId, '实际 _id=' + sameTaskId[0]._id)
  check('内容已同步为最新', sameTaskId[0].title !== '老数据标题', '标题=' + sameTaskId[0].title)

  console.log('===== S6 写入中途失败：集合不得被清空 =====')
  reset()
  const before = countOf('tasks')
  s1.tasks[0].title = '改标题触发一次写入'
  FAIL.setIds.add(s1.user.userId + '_' + s1.tasks[0].taskId)
  await db.save(s1, ['tasks'])
  check('集合条数不变', countOf('tasks') === before, 'before=' + before + ' after=' + countOf('tasks'))
  check('失败时未清空数据', countOf('tasks') > 0)
  FAIL.setIds.clear()

  console.log('===== S7 连加 3 条日程的写入次数（旧实现约 2N×3） =====')
  reset()
  ;[1, 2, 3].forEach(function (i) {
    s1.tasks.push({ taskId: 'bulk_' + i, userId: s1.user.userId, date: '11-03', slot: '09:0' + i, title: '批量' + i, desc: 'x', basePoints: 20, done: false, carbonSavedG: 0 })
    return db.save(s1, ['tasks'])
  })
  await db.save(s1, ['tasks'])
  check('三次 persist 共 3 次写入', stats.writes === 3, '实际 ' + stats.writes)

  console.log('===== S8 第二个用户登录：个人集合不得与第一个用户撞 _id =====')
  reset()
  OPENID = 'openid_B'
  const s2 = await db.pull()
  const aTasksBefore = countOf('tasks')
  // B 自己加一条同名日程（验证同名不会覆盖 A 的文档）
  s2.tasks.push({
    taskId: 'task_201', userId: s2.user.userId, date: '11-03', slot: '09:00',
    title: 'B 的日程', desc: 'x', basePoints: 20, done: false, carbonSavedG: 0
  })
  await db.save(s2, ['tasks'])
  const rowsB = Array.from(store.tasks.values()).filter(d => d.userId === s2.user.userId)
  const rowsA = Array.from(store.tasks.values()).filter(d => d.userId !== s2.user.userId)
  check('B 用户注册了独立档案', !!(s2 && s2.user && s2.user.userId), JSON.stringify(s2 && s2.user))
  check('B 的日程只写进自己的桶', rowsB.length === 1, '实际 ' + rowsB.length)
  check('A 用户数据未被覆盖', rowsA.length === aTasksBefore, rowsA.length + ' / ' + aTasksBefore)
  check('B 的文档 _id 带自己 userId 前缀', rowsB.every(d => d._id.indexOf(s2.user.userId) === 0), rowsB.map(d => d._id).join(','))
  check('task_201 在两个用户下各一份', Array.from(store.tasks.values()).filter(d => d.taskId === 'task_201').length === 2)

  console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败')
  process.exit(failCount === 0 ? 0 : 1)
})().catch(function (e) {
  console.error('测试脚本异常', e)
  process.exit(1)
})
