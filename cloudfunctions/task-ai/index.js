/**
 * task-ai 云函数：低碳日程页 AI 云调度
 *
 * 一个函数两个 action，零 npm 依赖（纯 Node 内置 https，上传即用）：
 *   plan   { action, title }                                     -> { desc, basePoints }
 *   verify { action, title, basePoints, proofText, imageUrl }    -> { passed, carbonSavedG, comment, detail }
 *
 * 任何失败（未配 key / 模型超时 / 参数缺失）都返回 { fallback: true, reason }，
 * 小程序端 common/ai.js 收到 fallback 后自动回退本地模拟，页面不瘫。
 *
 * 环境变量（云开发控制台 -> 云函数 -> task-ai -> 配置 -> 环境变量）：
 *   DASHSCOPE_API_KEY  阿里云百炼（千问平台）API Key，形如 sk-xxxx
 *
 * 模型分工（同一 Key，同一 OpenAI 兼容接口）：
 *   deepseek-v4.1-flash  文本：日程低碳分析（实测 2.5s 左右，JSON 稳定）
 *   qwen3-vl-plus        视觉：凭证识图（DeepSeek 无视觉能力，必须用千问 VL）
 */
const https = require('https')

const API_KEY = process.env.DASHSCOPE_API_KEY || ''
const AI_HOST = 'dashscope.aliyuncs.com'
const AI_PATH = '/compatible-mode/v1/chat/completions'
const TEXT_MODEL = 'deepseek-v4.1-flash' // 文本：日程低碳分析
const VISION_MODEL = 'qwen3-vl-plus'     // 视觉：凭证识图
// 8s：实测文本 2.5s / 视觉 1.4s 返回；留出一次重试的余量，两次总耗时不超云函数 20s 上限
const TIMEOUT_MS = 8000
// 这两个模型都是推理型：先产出 reasoning_content 再产出 content，
// 实测思考过程占 100-335 tokens。预算给到 300 会被思考过程吃光、content 返回空串。
const MAX_TOKENS = 1200
const CARBON_CAP = 300 // 减碳克数上限：防模型幻觉输出爆表数字

/** 调千问平台 OpenAI 兼容接口，返回 choices[0].message.content（单次，不重试） */
function callModelOnce(model, messages) {
  const body = JSON.stringify({
    model: model,
    messages: messages,
    temperature: 0.4,
    max_tokens: MAX_TOKENS
  })

  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: AI_HOST,
      path: AI_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: TIMEOUT_MS
    }, function (res) {
      let raw = ''
      res.on('data', function (chunk) { raw = raw + chunk })
      res.on('end', function () {
        // 显式检查状态码：429/5xx 错误体没有 choices，走重试/拒绝
        if (res.statusCode >= 400) {
          reject(new Error('AI HTTP ' + res.statusCode + '（限流或服务异常）: ' + raw.slice(0, 120)))
          return
        }
        try {
          const data = JSON.parse(raw)
          if (data.choices && data.choices[0] && data.choices[0].message) {
            resolve(data.choices[0].message.content || '')
          } else {
            reject(new Error('AI 响应异常: ' + raw.slice(0, 200)))
          }
        } catch (e) {
          reject(new Error('AI 响应解析失败: ' + raw.slice(0, 200)))
        }
      })
    })
    req.on('timeout', function () {
      req.destroy(new Error('AI 请求超时 ' + TIMEOUT_MS + 'ms'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** 429/5xx/超时退避重试一次（间隔 500ms） */
function callModel(model, messages, attempt) {
  attempt = attempt || 0
  return callModelOnce(model, messages).catch(function (e) {
    if (attempt >= 1) {
      throw e
    }
    return new Promise(function (resolve) {
      setTimeout(resolve, 500)
    }).then(function () {
      return callModel(model, messages, attempt + 1)
    })
  })
}

/** 从模型回复里抠 JSON（容忍 markdown 代码块包裹） */
function extractJson(text) {
  let t = String(text || '').trim()
  const fence = t.indexOf('```')
  if (fence >= 0) {
    t = t.replace(/```(json)?/g, '').trim()
  }
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('模型未返回 JSON: ' + t.slice(0, 120))
  }
  return JSON.parse(t.slice(start, end + 1))
}

/** action=plan：日程低碳分析 */
async function handlePlan(event) {
  const title = String(event.title || '').trim()
  if (title === '') {
    return { fallback: true, reason: 'title 为空' }
  }

  const content = await callModel(TEXT_MODEL, [
    {
      role: 'system',
      content: '你是中山大学校园低碳日程助手。用户给你一件今天要做的事，你给出它的低碳实现方式。' +
        '只输出 JSON，格式 {"desc":"低碳方式 · 少排约 N g CO₂e","basePoints":积分}。' +
        '要求：desc 不超过 20 字，说明具体怎么做和减碳估算；basePoints 只能取 20/30/40/50 ' +
        '（公共交通/步行 50，骑行 40，光盘/节约用餐 30，无纸化/节能/自带杯 20，其他低碳行为 20）。'
    },
    { role: 'user', content: '今天要做的事：' + title }
  ])

  const r = extractJson(content)
  const pts = Number(r.basePoints)
  if (!r.desc || !(pts > 0)) {
    return { fallback: true, reason: '模型返回字段不完整' }
  }
  return {
    desc: String(r.desc).slice(0, 40),
    basePoints: Math.min(50, Math.max(20, Math.round(pts)))
  }
}

/** action=verify：凭证核验（有图走视觉模型，只有文字走文本模型） */
async function handleVerify(event) {
  const title = String(event.title || '').trim()
  const proofText = String(event.proofText || '').trim()
  const imageUrl = String(event.imageUrl || '').trim()
  const basePoints = Number(event.basePoints) || 20

  if (title === '' || (proofText === '' && imageUrl === '')) {
    return { fallback: true, reason: '缺少凭证（图片和文字都为空）' }
  }

  const requirement =
    '核验这份凭证能否证明低碳行为「' + title + '」已发生。' +
    (proofText !== '' ? '文字凭证：' + proofText + '。' : '') +
    '减碳量按行为强度估算（参考：公交/步行约 100-200g，骑行约 80-150g，光盘约 60-120g，其他 40-100g）。' +
    '只输出 JSON，格式 {"passed":true或false,"carbonSavedG":克数,"comment":"趣味评语不超过30字"}。'

  let content
  if (imageUrl !== '') {
    content = await callModel(VISION_MODEL, [
      {
        role: 'user',
        content: [
          { type: 'text', text: requirement + ' 请重点核对图片内容与低碳行为是否匹配。' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ])
  } else {
    content = await callModel(TEXT_MODEL, [
      { role: 'system', content: '你是校园低碳凭证审核员，判断文字凭证是否合理可信。' },
      { role: 'user', content: requirement }
    ])
  }

  const r = extractJson(content)
  // passed 严格判定：只认布尔 true 或字符串 "true"，缺字段/类型漂移一律不通过
  const passed = r.passed === true || r.passed === 'true'
  return {
    passed: passed,
    carbonSavedG: Math.max(10, Math.min(CARBON_CAP, Number(r.carbonSavedG) || basePoints * 2)),
    comment: String(r.comment || '凭证核验通过，继续保持！').slice(0, 50),
    detail: '云端核验：' + (passed
      ? (imageUrl !== '' ? '图像与行为匹配' : '文字凭证可信')
      : '凭证未通过判定') +
      (proofText !== '' ? '，文字凭证「' + proofText + '」已交叉验证' : '')
  }
}

exports.main = async function (event) {
  if (!API_KEY) {
    console.warn('[task-ai] fallback：DASHSCOPE_API_KEY 未配置')
    return { fallback: true, reason: 'DASHSCOPE_API_KEY 未配置（云开发控制台环境变量）' }
  }

  try {
    if (event.action === 'plan') {
      return await handlePlan(event)
    }
    if (event.action === 'verify') {
      return await handleVerify(event)
    }
    console.warn('[task-ai] fallback：未知 action', String(event.action))
    return { fallback: true, reason: '未知 action: ' + String(event.action) }
  } catch (e) {
    // 降级原因落云端日志，联调时可在云函数日志里直接搜 fallback
    const reason = String((e && e.message) || e)
    console.warn('[task-ai] fallback:', reason)
    return { fallback: true, reason: reason }
  }
}
