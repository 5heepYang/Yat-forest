/**
 * notify 云函数：拍照提醒的订阅消息推送
 *
 * 触发方式：云开发定时触发器（见 config.json，默认每早 9 点）。
 *
 * 为什么"提醒所有认养了树的人"而不是"只提醒到期的"：
 * 拍照周期存在客户端 wx.Storage（tree_kit_v1 按树分桶），云端没有这份数据，
 * 云函数拿不到"谁的树该拍了"。要做到按周期精准提醒，得把 lastPhotoAt 也写进
 * trees / 新建集合，属于后续优化；当前用每日一条软提醒，不打扰但足够演示。
 *
 * 环境变量（云开发控制台 → 云函数 → notify → 配置 → 环境变量）：
 *   REMIND_TEMPLATE_ID  订阅消息模板 ID（小程序后台 → 订阅消息 → 我的模板）
 *
 * 模板字段：当前用「日程提醒」模板（编号 571），字段是
 *   thing2  提醒内容   date4 日程时间   thing11 备注
 * 换模板必须同步改下面的 data，字段对不上会报 47003。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const TEMPLATE_ID = process.env.REMIND_TEMPLATE_ID || ''

/**
 * 提醒时间：取"明天 09:00"（date 类型要求 24 小时制且带年月日，如 2026年11月4日 09:00）
 */
function remindTime() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const hh = '09:00'
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh
}

/** 取该用户名下的树名（最多 20 字，模板 thing 类型有长度限制） */
function treeNames(trees, ownerId) {
  const out = []
  let i = 0
  while (i < trees.length) {
    if (trees[i].ownerId === ownerId) out.push(trees[i].name || '你的树')
    i++
  }
  return out
}

exports.main = async function () {
  if (!TEMPLATE_ID) {
    console.warn('[notify] 未配置 REMIND_TEMPLATE_ID，跳过推送')
    return { skipped: 'REMIND_TEMPLATE_ID 未配置' }
  }

  // 只取已认养的树（ownerId 非空）
  const treeRes = await db.collection('trees').where({ ownerId: _.neq('') }).limit(100).get()
  const trees = treeRes.data || []

  // 每个用户一条 users 文档，_openid 就是推送用的 touser
  const userRes = await db.collection('users').limit(100).get()
  const users = userRes.data || []

  let sent = 0
  let failed = 0
  const when = remindTime()

  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    const names = treeNames(trees, u.userId)
    if (!names.length || !u._openid) continue

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: u._openid,
        templateId: TEMPLATE_ID,
        page: 'pages/tree/tree',
        miniprogramState: 'developer',   // 上线改成 formal
        data: {
          thing2: { value: names[0].slice(0, 20) },
          date4: { value: when },
          thing11: { value: '记得给它拍张照' }
        }
      })
      sent++
    } catch (e) {
      failed++
      // 43101 = 用户没订阅或已取消订阅，属于正常情况，不用告警
      console.warn('[notify] 发送失败', u.userId, e && e.errCode, e && e.errMsg)
    }
  }

  return { sent: sent, failed: failed, users: users.length, trees: trees.length }
}
