const store = require('../../common/store')
const { aiVerifyProof, aiAdvice } = require('../../common/ai')
const { fmt, todayText, toast } = require('../../common/util')

function emptyTask() {
  return {
    taskId: '', slot: '', title: '', desc: '', basePoints: 0,
    done: false, carbonSavedG: 0, aiComment: ''
  }
}

/** 周柱状图：高度和配色都要在 js 里算好，wxml 里不能调函数 */
function buildWeekBars(bars) {
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
    return {
      idx: idx,
      h: (v / max * 66).toFixed(0) + 'px',
      cls: cls
    }
  })
}

Page({
  data: {
    dateLine: '',
    todayPoints: '0',
    totalGrowth: '0',
    carbonGoal: '0',
    progressPct: '0',
    barStyle: 'width:0%',
    sectionLabel: '',
    tasks: [],
    weekBars: [],

    sheetMode: '',
    current: null,
    currentPoints: '0',
    advice: '',
    dots: '',
    result: { carbonSavedG: '0', comment: '', detail: '' }
  },

  onLoad() {
    this.dotTimer = 0
    this.setData({
      dateLine: todayText(),
      current: emptyTask()
    })
  },

  async onShow() {
    await store.ready()
    this.refresh()
  },

  onUnload() {
    this.stopDots()
  },

  refresh() {
    const st = store.state
    const pts = store.todayPoints()
    const pct = store.progressPct()

    let sectionLabel = '今日日程'
    if (st.tasks.length > 0) {
      sectionLabel = '上午 · ' + st.tasks[0].slot + ' - 10:00'
    }

    this.setData({
      todayPoints: pts.toFixed(0),
      totalGrowth: fmt(st.user.totalGrowthScore),
      carbonGoal: st.carbonGoal.toFixed(0),
      progressPct: pct.toFixed(0),
      barStyle: 'width:' + pct.toFixed(0) + '%',
      sectionLabel: sectionLabel,
      tasks: st.tasks,
      weekBars: buildWeekBars(st.weekBars)
    })
  },

  startDots() {
    const that = this
    this.stopDots()
    this.setData({ dots: '' })
    this.dotTimer = setInterval(function () {
      const cur = that.data.dots
      that.setData({ dots: cur.length >= 3 ? '' : cur + '.' })
    }, 300)
  },

  stopDots() {
    if (this.dotTimer) {
      clearInterval(this.dotTimer)
      this.dotTimer = 0
    }
  },

  closeSheet() {
    this.stopDots()
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
      toast('这个任务已核验通过，减少排放 ' + t.carbonSavedG.toFixed(0) + ' g')
      return
    }

    this.setData({
      current: t,
      currentPoints: t.basePoints.toFixed(0),
      sheetMode: 'task'
    })
  },

  startVerify() {
    const that = this
    const task = this.data.current
    this.setData({ sheetMode: 'loading' })
    this.startDots()

    aiVerifyProof(task.title, task.basePoints, function (r) {
      that.stopDots()
      that.setData({
        result: {
          carbonSavedG: r.carbonSavedG.toFixed(0),
          comment: r.comment,
          detail: r.detail
        },
        sheetMode: 'result'
      })
    })
  },

  useSample() {
    this.startVerify()
  },

  pickPhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success: function (res) {
        console.log('凭证图片：', res.tempFilePaths)
        that.startVerify()
      }
    })
  },

  claim() {
    const task = this.data.current
    const err = store.completeTask(task.taskId, Number(this.data.result.carbonSavedG), this.data.result.comment)

    if (err !== '') {
      toast(err)
    } else {
      toast('+' + task.basePoints.toFixed(0) + ' 积分已到账')
    }

    this.setData({ sheetMode: '' })
    this.refresh()
  },

  askAi() {
    const that = this
    this.setData({
      sheetMode: 'advice',
      advice: 'AI 正在翻你的日程表…'
    })

    aiAdvice(store.doneCount(), store.state.tasks.length, function (text) {
      that.setData({ advice: text })
    })
  },

  onCalendar() {
    toast('1.0 骨架：日程协同入口，队员 B 可在此接入课表导入')
  }
})
