/**
 * AI 能力封装层（1.0 为本地模拟，接口签名与真实多模态调用一致）
 *
 * 接真实大模型时只需改这一个文件：把 setTimeout 里的本地推演替换成
 * wx.request 调用 Vision LLM，回调仍然通过 cb 返回同样的结构，页面代码零改动。
 */

const PROOF_COMMENTS = [
  '识别到乘车凭证！今日少排碳，你的小树又长高了一截~',
  '空盘验真通过 ✅ 光盘是最朴素的减碳，食堂阿姨都替你骄傲。',
  '骑行轨迹清晰，两条腿的发动机比四个轮子环保多了。',
  '无纸化笔记识别成功，纸张：谢谢你放过我。'
]

const SPIRIT_REPLIES = [
  '我在这条路上站了三十八年，早八的人流我一眼就能看出谁是刚醒的。',
  '台风天别靠我太近，我的老叶子比你的拖延症还沉。',
  '你浇的水我收到了，虽然虚拟的，但心意是真的。',
  '期末周？我一年四季都站着不动，你这点考试算什么。',
  '记得帮我看一眼头顶有没有枯叶，我不想当校园里最危险的那棵树。'
]

function pick(list) {
  const i = Math.floor(Math.random() * list.length)
  return list[i]
}

/* ------------------------------------------------------------------ */
/* 云调度通道：非测试号且 wx.cloud 可用时走云函数 task-ai（千问平台），  */
/* 任何失败自动回退本地模拟，页面无感。云函数部署见                      */
/* pages/task/云后端部署指南.md                                        */
/* ------------------------------------------------------------------ */

function cloudReady() {
  try {
    if (!wx.cloud) return false
    const info = wx.getAccountInfoSync()
    const appId = info && info.miniProgram && info.miniProgram.appId
    // 测试号没有云环境，直接走本地模拟
    if (!appId || appId === 'touristappid') return false
    return true
  } catch (e) {
    return false
  }
}

function callTaskAi(payload, onOk, onFail) {
  wx.cloud.callFunction({
    name: 'task-ai',
    data: payload,
    success: function (res) {
      const r = res && res.result
      if (r && !r.fallback) {
        onOk(r)
      } else {
        onFail(r && r.reason || '云函数返回 fallback')
      }
    },
    fail: function (e) {
      onFail(String((e && e.errMsg) || e))
    }
  })
}

function code4() {
  const n = Math.floor(1000 + Math.random() * 9000)
  return n.toFixed(0)
}

/** AI 多模态凭证核验：云调度优先（Qwen-VL 识图），失败回退本地模拟 */
function aiVerifyProof(taskTitle, basePoints, proofText, imageUrl, cb) {
  // 图片可达性守卫：cloud:// 视觉模型取不到；超长 dataURL（base64 约 45KB+）会超 callFunction
  // 入参限制，两者都剥离成空图（有文字凭证时云端仍可走文本核验）
  var img = imageUrl || ''
  if (img.indexOf('cloud://') === 0 || (img.indexOf('data:') === 0 && img.length > 60000)) {
    console.warn('[ai] 凭证图不可公网可达，剥离后降级：', img.slice(0, 24) + '...')
    img = ''
  }

  if (cloudReady()) {
    callTaskAi({
      action: 'verify',
      title: taskTitle,
      basePoints: basePoints,
      proofText: proofText || '',
      imageUrl: img
    }, function (r) {
      if (r && r.passed && Number(r.carbonSavedG) > 0) {
        cb({
          passed: true,
          carbonSavedG: Number(r.carbonSavedG),
          comment: r.comment || '',
          detail: '云端核验：' + (r.detail || '视觉模型凭证判定通过')
        })
        return
      }
      if (r && r.passed === false) {
        // 云端明确判定不通过：透传驳回，让用户换凭证重拍，不再假装通过
        cb({
          passed: false,
          carbonSavedG: 0,
          comment: r.comment || '这张凭证还不足以证明低碳行为已经发生',
          detail: '云端核验：' + (r.detail || '凭证未通过判定')
        })
        return
      }
      // 云端没给出明确结论（字段缺失/为空）：退回本地判定，保证流程不断
      localVerify(taskTitle, basePoints, proofText, cb)
    }, function (reason) {
      console.warn('[ai] verify 云端降级：', reason)
      localVerify(taskTitle, basePoints, proofText, cb)
    })
    return
  }
  localVerify(taskTitle, basePoints, proofText, cb)
}

/** 本地模拟：恒通过 + 随机减碳量（离线兜底，也是测试号的正式实现） */
function localVerify(taskTitle, basePoints, proofText, cb) {
  setTimeout(function () {
    const carbon = basePoints * 2 + Math.floor(Math.random() * 40)
    let detail = '视觉核验：图像场景与「' + taskTitle + '」匹配度 96%，凭证要素完整'
    if (proofText) {
      detail = detail + '；文字凭证「' + proofText + '」已交叉验证通过'
    }
    cb({
      passed: true,
      carbonSavedG: carbon,
      comment: pick(PROOF_COMMENTS),
      detail: detail
    })
  }, 1400)
}

/** AI 日程低碳规划：云调度优先，失败回退关键词模拟。签名不变，页面零改动 */
function aiPlanTask(title, cb) {
  if (cloudReady()) {
    callTaskAi({ action: 'plan', title: title }, function (r) {
      if (r && r.desc && Number(r.basePoints) > 0) {
        cb({ desc: String(r.desc), basePoints: Number(r.basePoints) })
      } else {
        localPlan(title, cb)
      }
    }, function (reason) {
      console.warn('[ai] plan 云端降级：', reason)
      localPlan(title, cb)
    })
    return
  }
  localPlan(title, cb)
}

/** 本地模拟：关键词映射表（离线兜底，也是测试号的正式实现） */
function localPlan(title, cb) {
  const RULES = [
    { keys: ['公交', '校巴', '巴士', '地铁', '乘车'], desc: '乘公共交通出行', pts: 50 },
    { keys: ['步行', '走路', '散步'], desc: '全程步行，零碳出行', pts: 50 },
    { keys: ['骑行', '单车', '自行车', '骑车'], desc: '骑共享单车出行', pts: 40 },
    { keys: ['光盘', '食堂', '吃饭', '午餐', '晚餐', '早餐', '餐'], desc: '食堂光盘行动，按需取餐', pts: 30 },
    { keys: ['打印', '笔记', '无纸', '电子', '网课'], desc: '双面打印 / 无纸化记录', pts: 20 },
    { keys: ['关灯', '空调', '断电', '节能', '省电'], desc: '随手节能，宿舍低耗', pts: 20 },
    { keys: ['自带杯', '水杯', '塑料', '一次性'], desc: '自带水杯，少用一次性制品', pts: 20 }
  ]

  setTimeout(function () {
    let pts = 20
    let desc = '选择绿色低碳方式完成这件事'
    let i = 0
    while (i < RULES.length) {
      const rule = RULES[i]
      let hit = false
      let k = 0
      while (k < rule.keys.length) {
        if (title.indexOf(rule.keys[k]) >= 0) {
          hit = true
          break
        }
        k++
      }
      if (hit) {
        pts = rule.pts
        desc = rule.desc
        break
      }
      i++
    }

    cb({
      desc: desc + ' · 少排约 ' + (pts * 3) + ' g CO₂e',
      basePoints: pts
    })
  }, 900)
}

/**
 * AI 审核新增树木：判断照片是不是真实的树、名称与树种是否合理。
 * 云端优先（Qwen-VL 识图），失败回退本地规则（有照片 + 必填项完整即通过）。
 * 回调统一拿到 { passed, reason, detail }，页面不用关心走的哪条路。
 */
function aiReviewTree(info, cb) {
  const payload = {
    action: 'review',
    name: info.name || '',
    species: info.species || '',
    age: info.age || '',
    description: info.description || '',
    imageUrl: info.imageUrl || ''
  }

  if (cloudReady()) {
    callTaskAi(payload, function (r) {
      if (r && typeof r.passed === 'boolean') {
        cb({ passed: r.passed, reason: r.reason || '', detail: r.detail || '' })
        return
      }
      cb(localReviewTree(info))
    }, function (reason) {
      console.warn('[ai] review 云端降级：', reason)
      cb(localReviewTree(info))
    })
    return
  }
  cb(localReviewTree(info))
}

/** 本地兜底：不做图像判断，只校验必填项（测试号 / 云端不可用时用） */
function localReviewTree(info) {
  const ok = !!info.imageUrl && !!info.name && !!info.species
  return {
    passed: ok,
    reason: ok ? '信息完整，本地规则直接通过' : '缺少照片或树种信息',
    detail: '本地规则审核'
  }
}

/** AI 树木安全巡检医生：识别虫害 / 高空坠叶风险，生成后勤工单 */
function aiAnalyzeHazard(treeName, species, imageUrl, cb) {
  if (cloudReady()) {
    callTaskAi({
      action: 'hazard',
      name: treeName,
      species: species,
      imageUrl: imageUrl || ''
    }, function (r) {
      if (r && r.reject) {
        cb({ reject: true, reason: r.reason || '照片里看不到树木' })
        return
      }
      if (r && r.level) {
        cb({
          level: r.level,
          ticket: r.ticket || ('SYSU-' + code4()),
          analysis: r.analysis || '',
          advice: r.advice || '',
          reward: Number(r.reward) || 100,
          detail: r.detail || ''
        })
        return
      }
      cb(localAnalyzeHazard(treeName, species))
    }, function (reason) {
      console.warn('[ai] hazard 云端降级：', reason)
      cb(localAnalyzeHazard(treeName, species))
    })
    return
  }
  cb(localAnalyzeHazard(treeName, species))
}

/** 本地兜底：按树种给固定话术（测试号 / 云端不可用时用） */
function localAnalyzeHazard(treeName, species) {
  let level = '高危'
  let analysis = '识别到「' + treeName + '」顶部枯萎叶片已脱离叶鞘，处于悬垂状态，存在高空坠物砸伤风险。'
  let advice = '建议后勤绿化队在 24 小时内完成枯叶清除，并在树下 3m 范围设置临时警戒带。'
  if (species.indexOf('榕') >= 0) {
    level = '中危'
    analysis = '识别到树干基部有白蚁泥线与蛀蚀痕迹，暂未见结构失稳，但需持续监测。'
    advice = '建议投放白蚁诱杀饵剂，两周后回访复查树干强度。'
  } else if (species.indexOf('凤凰木') >= 0) {
    level = '中危'
    analysis = '台风过后存在断枝悬挂，断口未完全脱离，遇风可能二次坠落。'
    advice = '建议修剪断枝并清理树下残枝，台风季前完成一次全面排查。'
  }
  return {
    level: level,
    ticket: 'SYSU-' + code4(),
    analysis: analysis,
    advice: advice,
    reward: 100
  }
}

/** AI 日程碳管家：根据今日任务给出减碳建议 */
function aiAdvice(doneCount, totalCount, cb) {
  setTimeout(function () {
    let s = ''
    if (doneCount >= totalCount) {
      s = '今天的任务链全部核验通过，预计再走 800 步就能多减 40g，去操场绕一圈吧。'
    } else {
      s = '你还有 ' + (totalCount - doneCount).toFixed(0) + ' 个任务没打卡。按你今天的日程，晚餐光盘 + 回宿舍关灯一小时，还能再减约 120g，够你的树长 20 点成长值。'
    }
    cb(s)
  }, 900)
}

/** AI 树灵对话：每棵树按树种/位置拥有独立性格 */
function aiTreeSpirit(question, cb) {
  setTimeout(function () {
    let reply = ''
    if (question.indexOf('台风') >= 0) {
      reply = '台风来之前记得帮我拍张照，我头顶那片老叶早就想下去了。'
    } else if (question.indexOf('早八') >= 0 || question.indexOf('累') >= 0) {
      reply = '早八路过我这儿记得抬头看看，我三十八年没请过假。'
    } else if (question.indexOf('期末') >= 0) {
      reply = '期末周？我一年四季站着不动，你这点考试算什么，去图书馆吧。'
    } else {
      reply = pick(SPIRIT_REPLIES)
    }
    cb(reply)
  }, 1000)
}

module.exports = { aiVerifyProof, aiPlanTask, aiReviewTree, aiAnalyzeHazard, aiAdvice, aiTreeSpirit }
