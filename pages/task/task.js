const store = require('../../common/store')
const { aiVerifyProof, aiAdvice, aiPlanTask, guessMode } = require('../../common/ai')

/** 每天日程上限：与 cloudfunctions/actions 的 TASK_MAX 保持一致 */
const TASK_MAX = 10
const { today } = require('../../common/mock')
const db = require('../../common/db')
const { fmt, todayText, toast, pageEnter, pagePreset, setTabBarHidden } = require('../../common/util')

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
 * 周柱状图（真实数据：最近 7 天，过去 6 天 + 今天）
 * 只统计已核验任务的减碳量；整周都是 0 时返回 empty=true，页面显示「本周还没有完成日程」
 */
function buildWeekBars(allTasks) {
  const days = []
  const now = new Date()
  let i = 6
  while (i >= 0) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    d.setDate(d.getDate() - i)
    days.push({
      key: d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2),
      g: 0,
      today: i === 0
    })
    i--
  }

  const byKey = {}
  days.forEach(function (d) { byKey[d.key] = d })
  const list = allTasks || []
  let j = 0
  while (j < list.length) {
    const t = list[j]
    if (t && t.done && t.date && byKey[t.date]) {
      byKey[t.date].g += Number(t.carbonSavedG) || 0
    }
    j++
  }

  let max = 0
  days.forEach(function (d) { if (d.g > max) max = d.g })

  const bars = days.map(function (d, idx) {
    // 那天没做任务：不画柱子，只保留列占位
    if (d.g <= 0) {
      return { idx: idx, h: '0px', cls: '' }
    }
    const h = Math.max(6, Math.round(d.g / max * 66)) + 'px'
    return { idx: idx, h: h, cls: d.today ? 'wbar wbar-on' : 'wbar wbar-mid' }
  })

  return { bars: bars, empty: max <= 0 }
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

/** 凭证提示里的做法短句：取方案第一句、去掉括号补充和「· 少排约…」尾巴，太长就退回做法名 */
function proofHintOf(desc, fallback) {
  let s = String(desc || '').trim()
  s = s.replace(/（[^）]*）|\([^)]*\)/g, '')
  s = s.replace(/·.*$/, '')
  s = s.replace(/[。；;！!].*$/, '')
  s = s.replace(/[，,].*$/, '')
  s = s.trim()
  // 短到能直接读（「步行去教学楼」这种），太长就退回做法名
  if (s.length > 12) return fallback
  return s || fallback
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
    weekEmpty: false,
    streakText: '连续 0 天',

    // 添加日程弹窗
    sheetMode: '',
    addTitle: '',
    addSlot: '',

    // 核验弹窗
    current: null,
    currentPoints: '0',
    proofThumb: '',
    proofUrl: '',
    proofHint: '',
    dots: '',
    // 这次到底在核验什么（"步行"而不是"上课"），loading 时告诉用户
    verifyTarget: '',
    verifySlow: false,
    todayCount: 0,
    taskMax: TASK_MAX,
    result: { carbonSavedG: '0', comment: '', detail: '', mode: '', evidence: '' },
    advice: '',
    navAnim: ''
  },

  onLoad() {
    // 首次创建即预置入场动画，首帧就是动画起点（onShow 的 pageEnter 负责后续切换）
    pagePreset(this, 'task')
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
    pageEnter(this, 'task')
    const tb = this.getTabBar && this.getTabBar()
    if (tb && tb.syncActive) tb.syncActive()
    // 弹层开着的页面重新显示时，tabBar 继续保持隐藏（关闭弹层时才恢复）
    setTabBarHidden(this, this.data.sheetMode !== '')
    await store.ready()
    this.planPending()
    this.refresh()
  },

  onHide() {
    // tab 页常驻不销毁：切走时停掉核验中的"…"动画与慢提示
    this.stopDots()
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
          desc: t.desc === '' ? '生成中…' : t.desc,
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

    // 周账本：最近 7 天的真实减碳聚合（只算已核验任务）
    const week = buildWeekBars(st.tasks)

    this.setData({
      todayPoints: pts.toFixed(0),
      totalCarbonG: fmt(store.totalCarbon()),
      carbonGoal: st.carbonGoal.toFixed(0),
      progressPct: pct.toFixed(0),
      barStyle: 'width:' + pct.toFixed(0) + '%',
      groups: groups,
      weekBars: week.bars,
      weekEmpty: week.empty,
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
    setTabBarHidden(this, true)
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
      wx.showLoading({ title: '生成中', mask: true })
      const r = await store.cloudCreateTask({ title: title, slot: slot })
      wx.hideLoading()
      if (!r.ok) {
        toast(r.msg || '添加失败')
        return
      }
      setTabBarHidden(this, false)
      this.setData({ sheetMode: '', addTitle: '' })
      this.refresh()
      toast('已添加')
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

    setTabBarHidden(this, false)
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
    setTabBarHidden(this, false)
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
      toast('这条日程还在生成，稍等一下')
      return
    }

    const target = guessMode((t.title || '') + ' ' + (t.desc || '')) || '低碳做法'
    setTabBarHidden(this, true)
    this.setData({
      current: t,
      currentPoints: t.basePoints.toFixed(0),
      proofThumb: t.proofImage || '',
      proofUrl: '',
      verifyTarget: target,
      // 弹层里只留一句「上传一张 XX 的图片凭证」
      proofHint: proofHintOf(t.desc, target),
      sheetMode: 'task'
    })
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

    // 只认照片凭证：没有图、也没有公网链接，就不允许提交
    if ((this.data.proofUrl || '') === '' && (this.data.proofThumb || '') === '') {
      toast('先拍一张照片再提交')
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

    aiVerifyProof(task, '', imageUrl, function (r) {
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
      proofUrl: '',
      result: { carbonSavedG: '0', comment: '', detail: '' }
    })
  },

  claim() {
    const task = this.data.current

    // 云端模式：核验时云函数已经写好库、加过分，这里只收尾
    if (this._cloudDone) {
      this._cloudDone = false
      setTabBarHidden(this, false)
      this.setData({ sheetMode: '', proofThumb: '', proofUrl: '' })
      this.refresh()
      toast('+' + task.basePoints.toFixed(0) + ' 积分已到账')
      return
    }

    const err = store.completeTask(task.taskId, Number(this.data.result.carbonSavedG), this.data.result.comment, {
      proofImage: this.data.proofThumb
    })

    if (err !== '') {
      toast(err)
    } else {
      toast('+' + task.basePoints.toFixed(0) + ' 积分已到账')
    }

    setTabBarHidden(this, false)
    this.setData({ sheetMode: '', proofThumb: '', proofUrl: '' })
    this.refresh()
  },

  askAi() {
    const that = this
    setTabBarHidden(this, true)
    this.setData({
      sheetMode: 'advice',
      advice: '正在整理你的日程…'
    })

    aiAdvice(store.doneCount(), store.todayTaskCount(), function (text) {
      that.setData({ advice: text })
    })
  }
})
