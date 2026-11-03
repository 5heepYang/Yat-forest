/**
 * notify 云函数：拍照提醒的订阅消息推送
 *
 * 触发方式：云开发定时触发器（见 config.json，默认每早 9 点），也可在控制台手动测试。
 *
 * 为什么"提醒所有认养了树的人"而不是"只提醒到期的"：
 * 拍照周期存在客户端 wx.Storage（tree_kit_v1 按树分桶），云端没有这份数据，
 * 云函数拿不到"谁的树该拍了"。要做到按周期精准提醒，得把 lastPhotoAt 也写进
 * trees / 新建集合，属于后续优化；当前用每日一条软提醒，不打扰但足够演示。
 *
 * 环境变量（云开发控制台 → 云函数 → notify → 配置 → 环境变量）：
 *   REMIND_TEMPLATE_ID  订阅消息模板 ID（小程序后台 → 订阅消息 → 我的模板）
 *   WX_APPID            小程序 AppID（云调用失败时的备用通道用）
 *   WX_SECRET           小程序 AppSecret（同上，只放环境变量，绝不进代码）
 *
 * 两条发送通道（自动降级）：
 *   1. 云调用 cloud.openapi.subscribeMessage.send —— 免 token，但要求云环境与小程序
 *      正确关联，否则会报 -501001 INVALID_WX_ACCESS_TOKEN
 *   2. 直连 https://api.weixin.qq.com —— 用 AppID + AppSecret 换 access_token。
 *      通道 1 报 -501001 时自动走这里，缓存 token 2 小时
 *
 * 模板字段：当前用「日程提醒」模板（编号 571），字段是
 *   thing2  提醒内容   date4 日程时间   thing11 备注
 * 换模板必须同步改下面的 data，字段对不上会报 47003。
 */
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const TEMPLATE_ID = process.env.REMIND_TEMPLATE_ID || ''
const WX_APPID = process.env.WX_APPID || ''
const WX_SECRET = process.env.WX_SECRET || ''

/** 43101 = 用户没订阅/额度用完，属于正常情况，不算故障 */
const ERR_NO_SUBSCRIBE = 43101

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

/* ------------------------------------------------------------------ */
/* 备用通道：AppID + AppSecret 直连微信接口                             */
/* ------------------------------------------------------------------ */

let tokenCache = { token: '', expireAt: 0 }

function httpsJson(method, url, body) {
  return new Promise(function (resolve, reject) {
    const payload = body ? JSON.stringify(body) : ''
    const req = https.request(url, {
      method: method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}
      ),
      timeout: 8000
    }, function (res) {
      let raw = ''
      res.on('data', function (c) { raw = raw + c })
      res.on('end', function () {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(new Error('响应解析失败: ' + raw.slice(0, 200)))
        }
      })
    })
    req.on('timeout', function () { req.destroy(new Error('请求超时')) })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function getAccessToken() {
  const now = Date.now()
  if (tokenCache.token && tokenCache.expireAt > now) return tokenCache.token

  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
    + '&appid=' + encodeURIComponent(WX_APPID)
    + '&secret=' + encodeURIComponent(WX_SECRET)
  const r = await httpsJson('GET', url)
  if (!r.access_token) {
    throw new Error('取 access_token 失败: ' + (r.errcode || '') + ' ' + (r.errmsg || ''))
  }
  // 官方有效期 7200 秒，提前 5 分钟过期，避免边界
  tokenCache = { token: r.access_token, expireAt: now + (Number(r.expires_in || 7200) - 300) * 1000 }
  return tokenCache.token
}

async function sendByHttp(payload) {
  const token = await getAccessToken()
  const url = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + token
  const r = await httpsJson('POST', url, payload)
  if (r.errcode && r.errcode !== 0) {
    const e = new Error(r.errmsg || 'errcode ' + r.errcode)
    e.errCode = r.errcode
    throw e
  }
  return r
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

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

  const when = remindTime()
  const httpReady = !!(WX_APPID && WX_SECRET)

  let sent = 0
  let failed = 0
  let noQuota = 0
  let mode = 'cloud'
  let lastError = ''

  for (let i = 0; i < users.length; i++) {
    const u = users[i]
    const names = treeNames(trees, u.userId)
    if (!names.length || !u._openid) continue

    const payload = {
      touser: u._openid,
      templateId: TEMPLATE_ID,
      page: 'pages/tree/tree',
      miniprogramState: 'developer',   // 上线改成 formal
      data: {
        thing2: { value: names[0].slice(0, 20) },
        date4: { value: when },
        thing11: { value: '记得给它拍张照' }
      }
    }

    try {
      await cloud.openapi.subscribeMessage.send(payload)
      sent++
      continue
    } catch (e1) {
      lastError = (e1 && (String(e1.errCode) + ' ' + (e1.errMsg || e1.message || ''))) || String(e1)
      // 云调用失败（常见 -501001 INVALID_WX_ACCESS_TOKEN）：切到 AppID+Secret 通道重试一次
      if (!httpReady) {
        failed++
        console.warn('[notify] 云调用失败且未配置 WX_APPID/WX_SECRET', u.userId, lastError)
        continue
      }
      mode = 'http'
      try {
        await sendByHttp(payload)
        sent++
      } catch (e2) {
        if (e2 && Number(e2.errCode) === ERR_NO_SUBSCRIBE) {
          noQuota++
          console.warn('[notify] 用户未订阅或额度已用完（正常）', u.userId)
        } else {
          failed++
          lastError = (e2 && e2.message) || String(e2)
          console.warn('[notify] 备用通道也失败', u.userId, lastError)
        }
      }
    }
  }

  const result = {
    sent: sent,
    failed: failed,
    noQuota: noQuota,
    users: users.length,
    trees: trees.length,
    mode: mode
  }
  if (failed && lastError) result.lastError = lastError
  console.log('[notify] 结果', JSON.stringify(result))
  return result
}
