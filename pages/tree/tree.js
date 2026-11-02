const store = require('../../common/store')
const { aiAnalyzeHazard } = require('../../common/ai')
const { toast } = require('../../common/util')

const RIVAL_SCORE = 720
const STAGES = ['幼芽', '新叶', '枝繁']

function stageLabel(log, i) {
  const stage = i < STAGES.length ? STAGES[i] : '生长'
  const mm = (log.createdAt || '').substring(0, 2)
  const m = mm.substring(0, 1) === '0' ? mm.substring(1, 2) : mm
  return m + ' 月 · ' + stage
}

function widthOf(score) {
  let p = score / 1000 * 100
  if (p > 100) p = 100
  return 'width:' + p.toFixed(0) + '%'
}

Page({
  data: {
    navSubtitle: '',
    tree: { name: '', species: '', age: '', level: '0', growthScore: '0' },
    weatherLine: '今天风大，我的叶子有点痒～',
    nextNeed: '',
    growthBarStyle: 'width:0%',
    pkMeStyle: 'width:0%',
    pkRivalStyle: 'width:0%',
    rivalScore: RIVAL_SCORE.toFixed(0),
    pkResultText: '',
    growthLogs: [],

    sheetMode: '',
    dots: '',
    hazard: { level: '', ticket: '', analysis: '', advice: '', reward: '0' }
  },

  onLoad() {
    this.dotTimer = 0
  },

  async onShow() {
    await store.ready()
    this.refresh()
  },

  onUnload() {
    this.stopDots()
  },

  refresh() {
    const t = store.myTree()
    const rest = 1000 - t.growthScore
    const gap = t.growthScore - RIVAL_SCORE

    const logs = []
    let i = 0
    while (i < store.state.logs.length) {
      const log = store.state.logs[i]
      if (log.kind === 'growth') {
        logs.push({
          logId: log.logId,
          imageUrl: log.imageUrl,
          label: stageLabel(log, logs.length)
        })
      }
      i++
    }

    this.setData({
      navSubtitle: '在养 1 棵 · 成长值 ' + t.growthScore.toFixed(0),
      tree: {
        name: t.name,
        species: t.species,
        age: t.age,
        level: t.level.toFixed(0),
        growthScore: t.growthScore.toFixed(0)
      },
      nextNeed: rest > 0 ? ('再涨 ' + rest.toFixed(0) + ' 升级') : '已满级',
      growthBarStyle: widthOf(t.growthScore),
      pkMeStyle: widthOf(t.growthScore),
      pkRivalStyle: widthOf(RIVAL_SCORE),
      pkResultText: gap > 0
        ? '你的树领先 ' + gap.toFixed(0) + ' 点成长值，胜方可额外获得 50 积分。'
        : '还差 ' + (0 - gap).toFixed(0) + ' 点成长值。多浇水施肥，反超后再来挑战。',
      growthLogs: logs
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

  onWater() {
    const err = store.water()
    if (err !== '') {
      toast(err)
      return
    }
    toast('浇水成功，成长值 +20')
    this.refresh()
  },

  onFertilize() {
    const err = store.fertilize()
    if (err !== '') {
      toast(err)
      return
    }
    toast('施肥成功，成长值 +50')
    this.refresh()
  },

  openPk() {
    this.setData({ sheetMode: 'pk' })
  },

  doPk() {
    if (store.myTree().growthScore > RIVAL_SCORE) {
      store.state.user.availablePoints = store.state.user.availablePoints + 50
      toast('PK 获胜！+50 积分')
      this.setData({ sheetMode: '' })
      this.refresh()
    } else {
      toast('惜败，成长值反超后再来')
    }
  },

  openHazard() {
    this.setData({ sheetMode: 'hazard' })
  },

  useSampleHazard() {
    this.startHazard()
  },

  pickHazardPhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success: function (res) {
        console.log('隐患照片：', res.tempFilePaths)
        that.startHazard()
      }
    })
  },

  startHazard() {
    const that = this
    const t = store.myTree()
    this.setData({ sheetMode: 'hazardLoading' })
    this.startDots()

    aiAnalyzeHazard(t.name, t.species, function (r) {
      that.stopDots()
      that.setData({
        hazard: {
          level: r.level,
          ticket: r.ticket,
          analysis: r.analysis,
          advice: r.advice,
          reward: r.reward.toFixed(0)
        },
        sheetMode: 'hazardResult'
      })
    })
  },

  submitHazard() {
    const h = this.data.hazard
    const t = store.myTree()
    const err = store.reportHazard(
      { level: h.level, ticket: h.ticket, analysis: h.analysis, advice: h.advice, reward: Number(h.reward) },
      t.hazardText
    )
    if (err !== '') {
      toast(err)
      return
    }
    this.setData({ sheetMode: '' })
    this.refresh()
    toast('工单已推送总务处，+' + h.reward + ' 积分')
  },

  openUpload() {
    this.setData({ sheetMode: 'upload' })
  },

  useSampleUpload() {
    store.addGrowthLog('/static/illus/stage3.png', '今天又长高了一点点')
    this.setData({ sheetMode: '' })
    this.refresh()
    toast('已记入成长时光轴，+20 积分')
  },

  pickGrowthPhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success: function (res) {
        console.log('生长实拍：', res.tempFilePaths)
        store.addGrowthLog('/static/illus/stage3.png', '线下实拍已记录')
        that.setData({ sheetMode: '' })
        that.refresh()
        toast('已记入成长时光轴，+20 积分')
      }
    })
  },

  onBell() {
    toast('1.0 骨架：生长提醒通知，队员 C 可在此接入本地推送')
  }
})
