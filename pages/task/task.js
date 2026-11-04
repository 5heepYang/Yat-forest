const store = require('../../common/store')
const { aiVerifyProof, aiAdvice, aiPlanTask, guessMode } = require('../../common/ai')

/** 每天日程上限：与 cloudfunctions/actions 的 TASK_MAX 保持一致 */
const TASK_MAX = 10
const { today } = require('../../common/mock')
const db = require('../../common/db')
const { fmt, todayText, toast } = require('../../common/util')

function emptyTask() {
  return {
    taskId: '', slot: '', title: '', desc: '', basePoints: 0,
    done: false, carbonSavedG: 0, aiComment: ''
  }
}

/** 当前时间 HH:mm（添加日程时的时间默认值） */
function nowSlot() {
  const d = new Date()
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
}

/**
 * 周柱状图（MVP：过去 6 天演示值 + 今天真实聚合，最右一根是今天）
 * 高度和配色在 js 里算好，wxml 里不能调函数
 */
function buildWeekBars(todayG) {
  const DEMO = [320, 480, 260, 540, 300, 180]
  const bars = DEMO.concat([todayG])

  let max = 1
  let i = 0
  while (i < bars.length) {
    if (bars[i] > max) max = bars[i]
    i++
  }

  return bars.map(function (v, idx) {
    let cls = 'wbar'
    if (idx === 6) {
      cls = 'wbar wbar-on'
    } else if (idx === 5 || idx === 3) {
      cls = 'wbar wbar-mid'
    }
    const h = v > 0 ? (v / max * 66).toFixed(0) + 'px' : '6px'
    return { idx: idx, h: h, cls: cls }
  })
}

/** 时段归属：上午(5-12) / 下午(12-18) / 晚上(18-24)，凌晨归上午 */
function slotGroup(slot) {
  const h = Number(slot.substring(0, 2))
  if (h < 12) return '上午'
  if (h < 18) return '下午'
  return '晚上'
}

/** 连续打卡天数：从今天（今天没打卡则从昨天）往前数每天是否有已核验任务 */
function buildStreakText(allTasks) {
  function key(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)
  }
  const dates = {}
  let i = 0
  while (i < allTasks.length) {
    const t = allTasks[i]
    if (t.done && t.date) {
      dates[t.date] = true
    }
    i++
  }
  const cur = new Date()
  if (!dates[key(cur)]) {
    cur.setDate(cur.getDate() - 1)
  }
  let n = 0
  while (dates[key(cur)]) {
    n++
    cur.setDate(cur.getDate() - 1)
  }
  // 零打卡不虚报：没有连续记录就如实显示 0 天
  if (n > 0) {
    return '连续 ' + n + ' 天'
  }
  return '连续 0 天'
}

Page({
  data: {
    dateLine: '',
    todayPoints: '0',
    totalCarbonG: '0',
    carbonGoal: '0',
    progressPct: '0',
    barStyle: 'width:0%',
    groups: [],          // 时段分组 [{ label, tasks }]
    weekBars: [],
    streakText: '连续 0 天',

    // 添加日程弹窗
    sheetMode: '',
    addTitle: '',
    addSlot: '',

    // 核验弹窗
    current: null,
    currentPoints: '0',
    proofThumb: '',
    proofText: '',
    proofUrl: '',
    dots: '',
    // 这次到底在核验什么（"步行"而不是"上课"），loading 时告诉用户
    verifyTarget: '',
    verifySlow: false,
    todayCount: 0,
    taskMax: TASK_MAX,
    result: { carbonSavedG: '0', comment: '', detail: '', mode: '', evidence: '' },
    advice: ''
  },

  onLoad() {
    this.dotTimer = 0
    this.planning = {}   // 正在分析中的 taskId -> true，防止重复请求
    this._alive = true   // 页面存活标记：销毁后异步回调不再 setData
    this.verifySeq = 0   // 核验令牌：关闭弹窗/切换任务后旧回调作废
    this.verifying = false // 提交防双击
    this.proofUploading = false // 照片还在上传/换链接，期间不允许提交
    this.setData({
      dateLine: todayText(),
      current: emptyTask(),
      addSlot: nowSlot()
    })
  },

  async onShow() {
    await store.ready()
    this.planPending()
    this.refresh()
  },

  onUnload() {
    this._alive = false
    this.stopDots()
  },

  refresh() {
    const st = store.state
    const td = today()
    const pts = store.todayPoints()
    const pct = store.progressPct()

    // 今日日程装饰 + 排序
    const list = []
    let i = 0
    while (i < st.tasks.length) {
      const t = st.tasks[i]
      if (t.date === td) {
        list.push({
          taskId: t.taskId,
          slot: t.slot,
          title: t.title,
          desc: t.desc === '' ? 'AI 分析中…' : t.desc,
          basePoints: t.basePoints,
          done: t.done
        })
      }
      i++
    }
    list.sort(function (a, b) {
      return a.slot < b.slot ? -1 : 1
    })

    // 时段分组：上午 / 下午 / 晚上，组标签带组内时间跨度
    const ORDER = ['上午', '下午', '晚上']
    const buckets = { '上午': [], '下午': [], '晚上': [] }
    i = 0
    while (i < list.length) {
      buckets[slotGroup(list[i].slot)].push(list[i])
      i++
    }
    const groups = []
    i = 0
    while (i < ORDER.length) {
      const items = buckets[ORDER[i]]
      if (items.length > 0) {
        groups.push({
          label: ORDER[i] + ' · ' + items[0].slot + ' - ' + items[items.length - 1].slot,
          tasks: items
        })
      }
      i++
    }

    // 周账本：今天的真实减碳聚合
    const todayG = store.todayCarbon()

    this.setData({
      todayPoints: pts.toFixed(0),
      totalCarbonG: fmt(store.totalCarbon()),
      carbonGoal: st.carbonGoal.toFixed(0),
      progressPct: pct.toFixed(0),
      barStyle: 'width:' + pct.toFixed(0) + '%',
      groups: groups,
      weekBars: buildWeekBars(todayG),
      streakText: buildStreakText(st.tasks),
      todayCount: list.length,
      taskMax: TASK_MAX
    })
  },

  /** 对还没拿到 AI 分析结果的今日任务补一次分析（幂等，切页回来也能续上） */
  planPending() {
    const that = this
    const st = store.state
    const td = today()

    let i = 0
    while (i < st.tasks.length) {
      const t = st.tasks[i]
      if (t.date === td && !t.done && t.desc === '' && !this.planning[t.taskId]) {
        this.planning[t.taskId] = true
        aiPlanTask(t.title, function (r) {
          delete that.planning[t.taskId]
          store.updateTask(t.taskId, { desc: r.desc, basePoints: r.basePoints })
          if (that._alive) {
            that.refresh()
          }
        })
      }
      i++
    }
  },

  /* ---------------- 添加日程 ---------------- */

  openAdd() {
    this.setData({ sheetMode: 'add', addSlot: nowSlot() })
  },

  onAddTitle(e) {
    this.setData({ addTitle: e.detail.value })
  },

  onAddSlot(e) {
    this.setData({ addSlot: e.detail.value })
  },

  async confirmAdd() {
    const title = (this.data.addTitle || '').trim()
    const slot = this.data.addSlot

    if (title === '') {
      toast('先写下要做的事情')
      return
    }
    if (!slot) {
      toast('选一个时间')
      return
    }

    // 上限 10 条：云函数里也有同一道校验，这里只是让提示即时一点
    const td = today()
    let count = 0
    let ci = 0
    while (ci < store.state.tasks.length) {
      if (store.state.tasks[ci].date === td) count++
      ci++
    }
    if (count >= TASK_MAX) {
      toast('今天的日程已经排满 ' + TASK_MAX + ' 条，先完成或删掉一条')
      return
    }

    // 云端模式：AI 低碳分析与写库都在 actions 云函数里完成
    if (store.isCloud()) {
      wx.showLoading({ title: 'AI 分析中', mask: true })
      const r = await store.cloudCreateTask({ title: title, slot: slot })
      wx.hideLoading()
      if (!r.ok) {
        toast(r.msg || '添加失败')
        return
      }
      this.setData({ sheetMode: '', addTitle: '' })
      this.refresh()
      toast('已添加 · AI 已给出低碳方案')
      return
    }

    store.addTask({
      taskId: db.newId('task'),
      userId: store.state.user.userId,
      date: today(),
      slot: slot,
      title: title,
      desc: '',
      basePoints: 0,
      done: false,
      carbonSavedG: 0,
      aiComment: '',
      proofImage: '',
      reviewStatus: '',
      createdAt: db.stamp()
    })

    this.setData({ sheetMode: '', addTitle: '' })
    this.refresh()
    this.planPending()
  },

  /* ---------------- 凭证核验 ---------------- */

  startDots() {
    const that = this
    this.stopDots()
    this.setData({ dots: '', verifySlow: false })
    this.dotTimer = setInterval(function () {
      const cur = that.data.dots
      that.setData({ dots: cur.length >= 3 ? '' : cur + '.' })
    }, 300)
    // 8 秒还没回来就说一句，别让人对着"核验中"干等，以为卡死了
    this.slowTimer = setTimeout(function () {
      if (that.data.sheetMode === 'loading') that.setData({ verifySlow: true })
    }, 8000)
  },

  stopDots() {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer)
      this.slowTimer = 0
    }
    if (this.dotTimer) {
      clearInterval(this.dotTimer)
      this.dotTimer = 0
    }
  },

  closeSheet() {
    // 结果页只能点「领取」离开，防误触蒙层丢结果（P0-3）
    if (this.data.sheetMode === 'result') {
      return
    }
    this.stopDots()
    this.verifying = false
    this.setData({ sheetMode: '' })
  },

  openTask(e) {
    const id = e.currentTarget.dataset.id
    const st = store.state

    let t = null
    let i = 0
    while (i < st.tasks.length) {
      if (st.tasks[i].taskId === id) {
        t = st.tasks[i]
        break
      }
      i++
    }
    if (!t) return

    if (t.done) {
      toast('已核验通过，减少排放 ' + t.carbonSavedG.toFixed(0) + ' g')
      return
    }
    if (t.desc === '') {
      toast('AI 正在分析这条日程，马上就好')
      return
    }

    this.setData({
      current: t,
      currentPoints: t.basePoints.toFixed(0),
      proofThumb: t.proofImage || '',
      proofText: t.proofText || '',
      proofUrl: '',
      // 打开就说清楚核验对象，用户才知道该准备什么凭证
      verifyTarget: guessMode((t.title || '') + ' ' + (t.desc || '')) || '低碳做法',
      sheetMode: 'task'
    })
  },

  onProofText(e) {
    this.setData({ proofText: e.detail.value })
  },

  /** 失焦即暂存草稿：误触蒙层关闭后重开不丢已输入内容 */
  onProofBlur(e) {
    const text = (e.detail.value || '').trim()
    this.setData({ proofText: text })
    if (text !== '' && this.data.current && this.data.current.taskId) {
      store.updateTask(this.data.current.taskId, { proofText: text })
    }
  },

  /** 拍照或相册选图：先压一档再上传（本地模式整图 base64 进 Storage，防撑爆 10MB 上限） */
  pickPhoto(e) {
    const that = this
    const source = e.currentTarget.dataset.src === 'camera' ? ['camera'] : ['album']
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: source,
      success: function (res) {
        const raw = res.tempFilePaths[0]
        that.proofUploading = true
        wx.compressImage({
          src: raw,
          quality: 'low',
          success: function (c) {
            that.uploadProof(c.tempFilePath)
          },
          fail: function () {
            // 部分环境不支持 compressImage，回退原图
            that.uploadProof(raw)
          }
        })
      }
    })
  },

  uploadProof(filePath) {
    const that = this
    this.proofUploading = true
    db.uploadImage(filePath)
      .then(function (url) {
        store.updateTask(that.data.current.taskId, { proofImage: url })
        that.setData({ proofThumb: url, proofUrl: '' })
        // 视觉模型只能读公网地址：fileID 换成临时 https；本地 dataURL 直接可用
        return that.tempUrlOfImage(url).then(function (u) {
          that.setData({ proofUrl: u })
          that.proofUploading = false
        })
      })
      .catch(function () {
        that.proofUploading = false
        toast('凭证上传失败，重试一次')
      })
  },

  /**
   * fileID → 公网可读的临时 https。
   *
   * 之前只在选图那一刻换一次，换失败或中途重开弹层就永久丢了，
   * 提交时 imageUrl 为空 → 云函数判定"没有凭证" → 用户看到"再拍一张"，
   * 明明传了图却说没传，就是这个原因。
   */
  tempUrlOfImage(url) {
    return new Promise(function (resolve) {
      const src = String(url || '')
      if (src === '') return resolve('')
      if (src.indexOf('cloud://') !== 0) return resolve(src)
      if (!wx.cloud || !wx.cloud.getTempFileURL) return resolve('')
      wx.cloud.getTempFileURL({
        fileList: [src],
        success: function (res) {
          const f = res.fileList && res.fileList[0]
          resolve(f && f.tempFileURL ? f.tempFileURL : '')
        },
        fail: function () { resolve('') }
      })
    })
  },

  async startVerify() {
    const that = this
    const task = this.data.current
    if (this.verifying || !task || !task.taskId) {
      return
    }
    if (this.proofUploading) {
      toast('照片还在上传，等一秒再提交')
      return
    }

    const proofText = (this.data.proofText || '').trim()
    // 空凭证拦截：图、公网链接、文字三者皆空不允许提交
    if (proofText === '' && (this.data.proofUrl || '') === '' && (this.data.proofThumb || '') === '') {
      toast('拍一张照片或写一句凭证再提交')
      return
    }

    // 重开弹层时 proofUrl 会被清空，提交前补一次；补不出来就别把空图发给云函数
    let imageUrl = this.data.proofUrl || ''
    if (imageUrl === '' && this.data.proofThumb) {
      wx.showLoading({ title: '准备照片', mask: true })
      imageUrl = await this.tempUrlOfImage(this.data.proofThumb)
      wx.hideLoading()
      if (imageUrl !== '') this.setData({ proofUrl: imageUrl })
    }
    if (this.data.proofThumb && imageUrl === '') {
      toast('照片没加载成功，重新选一张再提交')
      return
    }

    // 文字凭证先暂存，AI 核验时综合判断
    if (proofText !== '') {
      store.updateTask(task.taskId, { proofText: proofText })
    }

    // 核验对象是方案里的做法（步行/骑行/光盘…），不是标题本身
    const target = guessMode((task.title || '') + ' ' + (task.desc || '')) || '低碳做法'

    this.verifySeq = this.verifySeq + 1
    const seq = this.verifySeq
    this.verifying = true

    this.setData({ sheetMode: 'loading', verifyTarget: target })
    this.startDots()

    // 云端模式：凭证核验与加分都在 actions 云函数里做，客户端拿不到可伪造的通过结果
    if (store.isCloud()) {
      const that2 = this
      store.cloudCompleteTask({
        taskId: task.taskId,
        proofText: proofText,
        imageUrl: imageUrl,
        proofImage: this.data.proofThumb
      }).then(function (r) {
        that2.verifying = false
        if (!that2._alive || seq !== that2.verifySeq || that2.data.sheetMode !== 'loading') return
        that2.stopDots()
        if (r.ok) {
          that2._cloudDone = true
          that2.setData({
            result: {
              carbonSavedG: (r.carbonSavedG || 0).toFixed(0),
              comment: r.comment || '',
              detail: r.detail || '',
              mode: r.mode || target,
              evidence: r.evidence || ''
            },
            sheetMode: 'result'
          })
          return
        }
        if (r.needProof) {
          that2.setData({
            result: {
              carbonSavedG: '0',
              comment: r.msg || '这张凭证还证明不了这个做法',
              detail: r.detail || '',
              mode: r.mode || target,
              evidence: ''
            },
            sheetMode: 'reject'
          })
          return
        }
        that2.setData({ sheetMode: 'task' })
        toast(r.msg || '核验失败')
      }).catch(function () {
        // 网络抖动/云函数超时：必须复位，否则下次提交会被 verifying 挡住、点了没反应
        that2.verifying = false
        if (!that2._alive || seq !== that2.verifySeq) return
        that2.stopDots()
        that2.setData({ sheetMode: 'task' })
        toast('核验没成功，网络或云函数超时，再点一次提交')
      })
      return
    }

    aiVerifyProof(task, proofText, imageUrl, function (r) {
      that.verifying = false
      // 回调作废守卫：弹窗已关 / 已切别的任务 / 页面已销毁，一律丢弃旧结果
      if (!that._alive || seq !== that.verifySeq || that.data.sheetMode !== 'loading') {
        return
      }
      that.stopDots()
      // 云端判不通过：不给积分，走驳回态，让用户换一张凭证
      if (r.passed === false) {
        that.setData({
          result: {
            carbonSavedG: '0',
            comment: r.comment || '这张凭证还证明不了这个做法',
            detail: r.detail || '',
            mode: r.mode || target,
            evidence: ''
          },
          sheetMode: 'reject'
        })
        return
      }
      that.setData({
        result: {
          carbonSavedG: r.carbonSavedG.toFixed(0),
          comment: r.comment,
          detail: r.detail,
          mode: r.mode || target,
          evidence: r.evidence || ''
        },
        sheetMode: 'result'
      })
    })
  },

  /** 驳回后重来：清掉这次的凭证，回到任务弹层重新拍 */
  retryProof() {
    this.setData({
      sheetMode: 'task',
      proofThumb: '',
      proofText: '',
      proofUrl: '',
      result: { carbonSavedG: '0', comment: '', detail: '' }
    })
  },

  claim() {
    const task = this.data.current

    // 云端模式：核验时云函数已经写好库、加过分，这里只收尾
    if (this._cloudDone) {
      this._cloudDone = false
      this.setData({ sheetMode: '', proofThumb: '', proofText: '', proofUrl: '' })
      this.refresh()
      toast('+' + task.basePoints.toFixed(0) + ' 积分已到账')
      return
    }

    const err = store.completeTask(task.taskId, Number(this.data.result.carbonSavedG), this.data.result.comment, {
      proofImage: this.data.proofThumb,
      proofText: (this.data.proofText || '').trim()
    })

    if (err !== '') {
      toast(err)
    } else {
      toast('+' + task.basePoints.toFixed(0) + ' 积分已到账')
    }

    this.setData({ sheetMode: '', proofThumb: '', proofText: '', proofUrl: '' })
    this.refresh()
  },

  askAi() {
    const that = this
    this.setData({
      sheetMode: 'advice',
      advice: 'AI 正在翻你的日程表…'
    })

    aiAdvice(store.doneCount(), store.todayTaskCount(), function (text) {
      that.setData({ advice: text })
    })
  }
})
