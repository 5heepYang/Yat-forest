/**
 * task-ai 云函数：低碳日程页 AI 云调度
 *
 * 一个函数多个 action，零 npm 依赖（纯 Node 内置 https，上传即用）：
 *   plan   { action, title }                                     -> { desc, basePoints }
 *   verify { action, title, basePoints, proofText, imageUrl }    -> { passed, carbonSavedG, comment, detail }
 *   review { action, name, age, imageUrl }                       -> { isTree, species, confidence, passed, reason }
 *   hazard { action, name, species, imageUrl }                   -> { level, analysis, advice, reward }
 *   （review 名保留：旧版 actions 还在按这个名字调，改名会制造部署中间态）
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

/** action=hazard：树木隐患识别（有图走视觉模型，没图走文本模型） */
async function handleHazard(event) {
  const name = String(event.name || '').trim()
  const species = String(event.species || '').trim()
  const imageUrl = String(event.imageUrl || '').trim()

  // 隐患上报必须带现场照片：没图就拒绝，否则纯文字也能拿积分
  if (imageUrl === '') {
    return { reject: true, reason: '没有照片，请拍一张树木现场照片' }
  }

  const requirement =
    '你是中山大学校园树木安全巡检员。' +
    (imageUrl !== '' ? '先看这张现场照片，' : '') +
    '判断这棵树（名称：' + (name || '未知名') + '，树种：' + (species || '未知') + '）是否存在安全隐患，' +
    '包括：枯枝悬垂、断枝、树干倾斜或空洞、白蚁/虫害、根部松动、枝叶大面积枯黄。' +
    '如果照片里根本看不到树木（比如截图、文档、题目、室内物品），必须把 isTree 设为 false，不要硬报隐患。' +
    '只输出 JSON，格式 {"isTree":true或false,"reason":"不是树木时的原因，不超过20字",' +
    '"level":"低危或中危或高危","analysis":"现场判断，不超过40字","advice":"处置建议，不超过40字","reward":积分}。' +
    'reward 只能取 60（低危）/100（中危）/150（高危）。'

  const content = await callModel(VISION_MODEL, [
    {
      role: 'user',
      content: [
        { type: 'text', text: requirement },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ])

  const r = extractJson(content)

  // 照片不是树木现场：直接拒绝，不生成工单、不发积分（防止随便传图薅积分）
  const isTree = r.isTree === true || r.isTree === 'true'
  if (!isTree) {
    return { reject: true, reason: String(r.reason || '照片里看不到树木，请拍树木本身').slice(0, 30) }
  }

  const level = ['低危', '中危', '高危'].indexOf(String(r.level)) >= 0 ? String(r.level) : '中危'
  const reward = [60, 100, 150].indexOf(Number(r.reward)) >= 0 ? Number(r.reward) : 100
  return {
    level: level,
    ticket: 'SYSU-' + Math.floor(100000 + Math.random() * 899999),
    analysis: String(r.analysis || '').slice(0, 60),
    advice: String(r.advice || '').slice(0, 60),
    reward: reward
  }
}

/** 把模型给的树种名清理成卡片上能显示的短词 */
function cleanSpecies(raw) {
  let s = String(raw || '').trim()
  // 去掉括号注释、学名、标点，只留中文/字母主体
  s = s.replace(/[（(].*?[）)]/g, '').replace(/[,，。;；:：、\/]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s === '' || s === '无' || s === '未知' || s === '不确定' || s === 'null') return '未识别'
  // 泛称不算识别出来，卡片上没有信息量
  const generic = ['乔木', '灌木', '绿植', '植物', '树木', '树', '行道树', '绿化树', '阔叶树', '针叶树']
  if (generic.indexOf(s) >= 0) return '未识别'
  return s.slice(0, 20)
}

/**
 * action=review：识别新增树木（有图走视觉模型）
 *
 * 注意：action 名仍叫 review —— 改名会让"先传 task-ai 再传 actions"出现中间态：
 * 旧版 actions 还在调 review，新函数没有就会整个新增树流程失败。
 * 所以这里只扩展返回字段（species/isTree/confidence），passed 保留给旧调用方。
 */
async function handleReview(event) {
  const name = String(event.name || '').trim()
  const age = String(event.age || '').trim()
  const description = String(event.description || '').trim()
  const imageUrl = String(event.imageUrl || '').trim()
  const inputSpecies = String(event.species || '').trim()

  if (name === '') {
    return { fallback: true, reason: '名称不能为空' }
  }

  // 没有照片就无法识图：回退文本模型只做基本判断，品种沿用用户填的（没有就未识别）
  if (imageUrl === '') {
    const content = await callModel(TEXT_MODEL, [
      { role: 'system', content: '你是校园绿化管理员，判断这条树木登记信息是否合理。' },
      {
        role: 'user',
        content: '树木名称：' + name + '；树龄：' + (age || '未填') + '；描述：' + (description || '无') + '。' +
          '只输出 JSON，格式 {"isTree":true或false,"species":"具体树种中文名，不确定填未识别","confidence":0到1,"reason":"不超过30字"}。'
      }
    ])
    const rt = extractJson(content)
    const ok = rt.isTree === true || rt.isTree === 'true'
    return {
      passed: ok,
      isTree: ok,
      species: cleanSpecies(rt.species) === '未识别' ? cleanSpecies(inputSpecies) : cleanSpecies(rt.species),
      confidence: Number(rt.confidence) || 0,
      reason: String(rt.reason || (ok ? '信息合理' : '信息不合理')).slice(0, 40),
      detail: '没有现场照片，仅按文字判断'
    }
  }

  const requirement =
    '看这张照片，判断画面主体是不是一棵树/一株植物，并识别它的品种。' +
    (name ? '用户给它起名叫「' + name + '」，这个名字只是位置+外号，不代表品种，不要被它干扰。' : '') +
    '判断标准放宽：只要画面主体是树木或植株就算通过，不要求拍摄专业、不要求整树入镜。' +
    '品种要具体到中文俗名（例如：香樟、大王椰子、凤凰木、细叶榕、小叶榄仁）；' +
    '如果只是背景里有一点绿、主体是书本/人/建筑/食物/屏幕，则 isTree 为 false。' +
    '只输出 JSON，格式 {"isTree":true或false,"species":"具体树种中文名，认不出填未识别","confidence":0到1,"reason":"不超过30字的原因","detail":"外观特征不超过40字"}。'

  const content = await callModel(VISION_MODEL, [
    {
      role: 'user',
      content: [
        { type: 'text', text: requirement },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    }
  ])

  const r = extractJson(content)
  // 只认明确布尔值；缺字段说明模型没看懂 → 不通过，交给用户重拍
  const isTree = r.isTree === true || r.isTree === 'true'
  const species = cleanSpecies(r.species) === '未识别' ? cleanSpecies(inputSpecies) : cleanSpecies(r.species)
  return {
    passed: isTree,
    isTree: isTree,
    species: species,
    confidence: Number(r.confidence) || 0,
    reason: String(r.reason || (isTree ? '识别通过' : '照片里看不到树木')).slice(0, 40),
    detail: String(r.detail || '').slice(0, 60)
  }
}

/**
 * action=verify：凭证核验（有图走视觉模型，只有文字走文本模型）
 *
 * 关键设计：**核验对象是"低碳方案里的具体做法"，不是日程标题本身。**
 * 标题是"上课"，方案是"步行去上课" → 要核验的是"有没有步行过去"，
 * 凭证应该是 Keep / 步数 / 地图导航这类带距离和时长的截图，
 * 而不是一张教室照片。
 */
async function handleVerify(event) {
  const title = String(event.title || '').trim()
  const desc = String(event.desc || '').trim()
  const proofText = String(event.proofText || '').trim()
  const imageUrl = String(event.imageUrl || '').trim()
  const basePoints = Number(event.basePoints) || 20

  if (title === '' || (proofText === '' && imageUrl === '')) {
    return { fallback: true, reason: '缺少凭证（图片和文字都为空）' }
  }

  const requirement =
    '你在核验一条校园低碳打卡。\n' +
    '日程标题：' + title + '\n' +
    '低碳方案（含具体做法）：' + (desc || '没有方案，按标题里能看出的出行/用餐方式判断') + '\n' +
    (proofText !== '' ? '用户写的文字凭证：' + proofText + '\n' : '') +
    '\n核验规则：\n' +
    '1) 先确定核验对象：要核验的是方案里的**具体做法**（步行 / 骑行 / 公交 / 地铁 / 光盘 / 自带杯 / 无纸化…），' +
    '不是"上课""开会"这类目的。标题只说明你为什么出门，不能拿来当核验标准。\n' +
    '2) 再判断凭证能不能证明这个做法真的发生了：\n' +
    '   - 运动/出行类截图（Keep、悦跑圈、手机步数、地图导航、乘车码、地铁进出站记录）：看距离、时长、速度是否吻合。' +
    '步行约 4~6 km/h，骑行约 12~20 km/h，跑步约 7~12 km/h；' +
    '如果数据明显不合理（例如 5 分钟走了 8 公里却说是步行），判否。\n' +
    '   - 餐饮类：光盘要看餐盘是否吃干净，自带杯要看是不是一次性杯。\n' +
    '   - 凭证和做法对不上（方案说步行，截的却是外卖单、购物记录、教室黑板）→ 判否。\n' +
    '   - 时间、地点和日程吻合是加分项，但不强求。\n' +
    '3) 凭证信息不足以下结论时判否，并在 evidence 里说清缺什么（例如"截图没有距离或时长"）。\n' +
    '4) 通过时按行为强度估算减碳量（参考：步行 100-200g、骑行 80-150g、公交地铁 150-300g、' +
    '光盘 60-120g、自带杯 40-90g），上限 ' + CARBON_CAP + '。\n' +
    '只输出 JSON，格式 ' +
    '{"passed":true或false,"mode":"核验到的具体做法","evidence":"凭证里支撑判断的关键信息，不超过30字",' +
    '"carbonSavedG":克数,"comment":"给用户看的一句话，不超过30字","detail":"判断依据，不超过50字"}。'

  let content
  if (imageUrl !== '') {
    content = await callModel(VISION_MODEL, [
      {
        role: 'user',
        content: [
          { type: 'text', text: requirement },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ])
  } else {
    content = await callModel(TEXT_MODEL, [
      { role: 'system', content: '你是校园低碳凭证审核员，判断文字凭证能否证明低碳方案里的做法已经发生。' },
      { role: 'user', content: requirement }
    ])
  }

  const r = extractJson(content)
  // passed 严格判定：只认布尔 true 或字符串 "true"，缺字段/类型漂移一律不通过
  const passed = r.passed === true || r.passed === 'true'
  const mode = String(r.mode || guessMode(title + ' ' + desc)).slice(0, 12)
  const evidence = String(r.evidence || '').slice(0, 40)
  return {
    passed: passed,
    mode: mode,
    evidence: evidence,
    // 判否时减碳量必须是 0：模型常吐 0，而 0 是 falsy，会被下面的兜底算法撑成 basePoints*2
    carbonSavedG: passed
      ? Math.max(10, Math.min(CARBON_CAP, Number(r.carbonSavedG) || basePoints * 2))
      : 0,
    comment: String(r.comment || (passed ? '凭证核验通过，继续保持！' : '这张凭证还证明不了这个做法')).slice(0, 50),
    detail: '核验对象：' + (mode || '低碳做法') + '（不是「' + title + '」这件事本身）' +
      (evidence !== '' ? '；依据：' + evidence : '') +
      (imageUrl === '' ? '；无图片，仅按文字判断' : '')
  }
}

/** 模型没给做法时，按文字兜底猜一个，只用于前端展示「正在核验什么」 */
function guessMode(text) {
  const s = String(text || '')
  if (/骑行|单车|自行车/.test(s)) return '骑行'
  if (/地铁/.test(s)) return '地铁'
  if (/公交|巴士/.test(s)) return '公交'
  if (/步行|走路|走去/.test(s)) return '步行'
  if (/光盘|空盘/.test(s)) return '光盘行动'
  if (/自带杯|自带水杯/.test(s)) return '自带杯'
  if (/无纸|电子|线上/.test(s)) return '无纸化'
  return ''
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
    if (event.action === 'review') {
      return await handleReview(event)
    }
    if (event.action === 'hazard') {
      return await handleHazard(event)
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
