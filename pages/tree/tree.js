/**
 * 页面 3「我的林地」—— 微信原生小程序版
 *
 * 只依赖 common/store 的公开接口，不改 common/ 任何文件：
 *   store.state / store.myTree / store.water / store.fertilize
 *   store.addGrowthLog / store.reportHazard
 *   store.updateTree / store.updateUser
 *
 * 货币口径：
 *   - 浇水 / 施肥：消耗碳积分（availablePoints）
 *   - 任务 / 升级 / 连续护林：发放护林币（coins），去「我的」补给站兑换
 *   - 隐患上报：沿用 store.reportHazard 的碳积分奖励
 *
 * 任务 / 工单 / 连续护林等扩展状态存在 wx.Storage，不新增云数据库集合。
 */
const store = require('../../common/store')
const { aiAnalyzeHazard, aiTreeSpirit } = require('../../common/ai')
const { toast, stamp } = require('../../common/util')
const { WATER_COST, FERT_COST, WATER_GAIN, FERT_GAIN } = require('../../common/theme')
const { SUBSCRIBE_TEMPLATE_ID } = require('../../common/config')

const KIT_KEY = 'tree_kit_v1'
const GROWTH_CAP = 1000
const LEVEL_STEP = 300
const LEVEL_UP_COINS = 50
const REWARD_WATER = 15
const REWARD_FERT = 20
const REWARD_PHOTO = 50
const PHOTO_GROWTH = 30
const PHOTO_PERIOD = 14
const DAILY_BONUS = 10
const STREAK_3 = 20
const STREAK_7 = 50
const STREAK_14 = 100

const CARE_WATER = [
  '识别到水壶与水流，土壤已经湿了，这棵树今天的水分达标。',
  '看到你在给它浇水了，叶面有水珠、土色变深，核验通过。',
  '浇水动作清晰，根部周围无明显积水，刚刚好。'
]
const CARE_FERT = [
  '识别到施肥动作与颗粒肥，用量克制，没有被雨水冲走的痕迹。',
  '肥料已均匀撒在根区外围，核验通过，别直接堆在树干上。',
  '看到你在施肥了，土壤疏松、无烧根风险，这次养护合格。'
]

/* ---------- 小工具 ---------- */

function pad2(n) {
  const s = Number(n).toFixed(0)
  return s.length < 2 ? '0' + s : s
}

function todayStr() {
  const d = new Date()
  return d.getFullYear().toFixed(0) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function monthText(dateStr) {
  if (!dateStr || dateStr.length < 7) return ''
  const mm = dateStr.substring(5, 7)
  return (mm.substring(0, 1) === '0' ? mm.substring(1, 2) : mm) + ' 月'
}

function levelOf(score) {
  let lv = 1 + Math.floor(score / LEVEL_STEP)
  if (lv > 4) lv = 4
  if (lv < 1) lv = 1
  return lv
}

function levelTitle(lv) {
  if (lv >= 4) return '古树挚友'
  if (lv === 3) return '森友'
  if (lv === 2) return '绿叶守卫'
  return '初识护林员'
}

function dateText(s) {
  return s && s.length >= 10 ? s.substring(5, 10) : (s || '')
}

function legacyMonth(s) {
  if (!s) return ''
  let head = s
  const sp = s.indexOf(' ')
  if (sp > 0) head = s.substring(0, sp)
  const dash = head.indexOf('-')
  if (dash <= 0) return ''
  let m = head.substring(0, dash)
  if (m.substring(0, 1) === '0') m = m.substring(1, 2)
  return m + ' 月'
}

function daysPassed(ts) {
  return Math.floor((Date.now() - ts) / 86400000)
}

/* ---------- 模块状态（本地持久化） ---------- */

/** 单棵树的养护状态：任务进度 / 工单 / 照片 / 当天是否已核验 */
function newBucket() {
  return {
    tasks: {
      water: { lastDoneAt: '', lastDoneTs: 0 },
      fert: { lastDoneAt: '', lastDoneTs: 0 },
      photo: { lastDoneAt: '', lastDoneTs: 0, periodDays: PHOTO_PERIOD }
    },
    tickets: [],
    photos: [],
    dailyBonusAt: '',
    careAt: ''
  }
}

/**
 * kit 容器：
 *   trees[treeId] 每棵树一个桶 —— 多树后任务/工单/照片/核验状态互不串味
 *   streak        用户维度的连续护林天数，不按树分
 *   legacy        老格式（tasks 直接挂在根上）暂存，等知道当前 treeId 再搬进对应桶
 */
function defaultKit() {
  return { trees: {}, streak: { days: 0, lastAt: '', lastTs: 0, milestone: 0 }, legacy: null }
}

function loadKit() {
  const saved = wx.getStorageSync(KIT_KEY) || {}
  const kt = defaultKit()
  if (saved.trees) kt.trees = saved.trees
  if (saved.streak) kt.streak = Object.assign(kt.streak, saved.streak)
  if (saved.tasks || saved.tickets || saved.photos) {
    kt.legacy = {
      tasks: saved.tasks || newBucket().tasks,
      tickets: saved.tickets || [],
      photos: saved.photos || [],
      dailyBonusAt: saved.dailyBonusAt || '',
      careAt: saved.careAt || ''
    }
  }
  return kt
}

function saveKit(kt) {
  wx.setStorageSync(KIT_KEY, kt)
}

/** 取某棵树的桶；老格式数据会在第一次调用时迁进当前树的桶里，进度不丢 */
function ensureBucket(kt, treeId) {
  const key = treeId || '_none'
  if (!kt.trees[key]) {
    kt.trees[key] = kt.legacy || newBucket()
    kt.legacy = null
  }
  return kt.trees[key]
}

function taskDone(kit, kind) {
  const t = kit.tasks[kind]
  if (!t || !t.lastDoneAt) return false
  if (kind === 'photo') return t.periodDays - daysPassed(t.lastDoneTs) > 0
  return t.lastDoneAt === todayStr()
}

function taskDaysLeft(kit, kind) {
  const t = kit.tasks[kind]
  if (!t || !t.lastDoneTs) return 0
  const left = t.periodDays - daysPassed(t.lastDoneTs)
  return left > 0 ? left : 0
}

Page({
  data: {
    navSubtitle: '',
    myTrees: [],
    tree: { name: '', species: '', age: '', level: '0', growthScore: '0' },
    levelTitle: '',
    nextNeed: '',
    growthBarStyle: 'width:0%',
    atMax: false,
    spiritLine: '今天风大，我的叶子有点痒～',
    gainShow: false,
    gainText: '',

    tasks: [],
    pointsText: '',
    coinsText: '',
    dailyText: '',
    streakText: '',
    streakHint: '',
    photoBar: 'width:100%',
    photoHint: '',

    rankTop: [],
    myOutOfTop: false,
    myRankRow: null,
    rankText: '',

    photos: [],
    photoCount: 0,
    allPhotos: [],

    tickets: [],

    sheetMode: '',
    dots: '',
    hazard: { level: '', ticket: '', analysis: '', advice: '', reward: '0' },
    hazardImage: '',
    pendingKind: '',
    careLabel: '',
    careTip: '',
    careVerified: false,
    periodOptions: [7, 14, 30],
    photoPeriod: PHOTO_PERIOD
  },

  onLoad() {
    this.dotTimer = 0
    this.gainTimer = 0
    this.kt = loadKit()
    this.kit = null
    this.careComment = ''
  },

  async onShow() {
    await store.ready()
    this.refresh()
  },

  onUnload() {
    this.stopDots()
    if (this.gainTimer) {
      clearTimeout(this.gainTimer)
      this.gainTimer = 0
    }
  },

  /* ---------- 视图刷新 ---------- */

  refresh() {
    const t = store.myTree()
    this.kit = ensureBucket(this.kt, t.treeId)
    const kit = this.kit
    const streak = this.kt.streak
    const mine = store.myTrees()
    const user = store.state.user
    const today = todayStr()

    const atMax = t.growthScore >= GROWTH_CAP
    let next = t.level * LEVEL_STEP
    if (t.level >= 4) next = GROWTH_CAP
    const rest = next - t.growthScore
    let nextNeed = '已满级'
    if (rest > 0) {
      nextNeed = t.level >= 4
        ? '再涨 ' + rest.toFixed(0) + ' 满级'
        : '再涨 ' + rest.toFixed(0) + ' 升 Lv.' + (t.level + 1).toFixed(0)
    }

    // 任务
    const defs = [
      { kind: 'water', title: '给树浇一次水', reward: REWARD_WATER },
      { kind: 'fert', title: '给树施一次肥', reward: REWARD_FERT },
      { kind: 'photo', title: '上传一张生长实拍', reward: REWARD_PHOTO }
    ]
    const tasks = []
    let dailyDone = 0
    defs.forEach(function (d) {
      const done = taskDone(kit, d.kind)
      if (done && d.kind !== 'photo') dailyDone++
      let sub = '今日待完成 · 点击去做'
      if (done) {
        sub = d.kind === 'photo' ? '已完成 · 还有 ' + taskDaysLeft(kit, d.kind) + ' 天' : '今天已完成'
      } else if (d.kind === 'photo') {
        sub = '本周期还没记录 · 点击上传'
      }
      tasks.push({ kind: d.kind, title: d.title, reward: d.reward, sub: sub, done: done })
    })

    // 连续 / 全勤
    const milestone = streak.milestone
    const nextM = milestone < 3 ? 3 : (milestone < 7 ? 7 : (milestone < 14 ? 14 : 0))
    const rewardMap = { 3: STREAK_3, 7: STREAK_7, 14: STREAK_14 }
    let streakHint = '连续奖励已全部解锁'
    if (kit.dailyBonusAt === today) {
      streakHint = '今日全勤 +' + DAILY_BONUS + ' 已到账'
    } else if (nextM > 0) {
      const left = nextM - streak.days
      streakHint = left > 0 ? '再坚持 ' + left + ' 天 +' + rewardMap[nextM] : '连续奖励已全部解锁'
    }

    // 拍照倒计时
    let photoBar = 100
    if (kit.tasks.photo.lastDoneTs) {
      photoBar = Math.round((kit.tasks.photo.periodDays - taskDaysLeft(kit, 'photo')) / kit.tasks.photo.periodDays * 100)
      if (photoBar < 0) photoBar = 0
      if (photoBar > 100) photoBar = 100
    }
    const photoHint = taskDone(kit, 'photo')
      ? '还有 ' + taskDaysLeft(kit, 'photo') + ' 天可以再拍一张'
      : '今天该给它拍张照啦'

    // 时光轴：allPhotos 最新在前，photos 取最近 3 张按时间升序
    const allPhotos = []
    let idx = 0
    while (idx < store.state.logs.length) {
      const log = store.state.logs[idx]
      if (log.kind === 'growth' && log.treeId === t.treeId) {
        let stage = ''
        let dayText = ''
        let k = 0
        while (k < kit.photos.length) {
          if (kit.photos[k].logId === log.logId) {
            stage = kit.photos[k].stage
            dayText = kit.photos[k].monthText
            break
          }
          k++
        }
        if (!dayText) dayText = legacyMonth(log.createdAt)
        if (!stage) stage = allPhotos.length === 0 ? '枝繁' : (allPhotos.length === 1 ? '新叶' : '幼芽')
        allPhotos.unshift({
          logId: log.logId,
          imageUrl: log.imageUrl,
          label: dayText + ' · ' + stage,
          desc: log.description
        })
      }
      idx++
    }
    const photos = allPhotos.slice(0, 3).reverse()

    // 等级榜
    const list = []
    let n = 0
    while (n < store.state.trees.length) {
      const tree = store.state.trees[n]
      if (tree.ownerId !== '') list.push(tree)
      n++
    }
    list.sort(function (a, b) {
      if (a.level !== b.level) return b.level - a.level
      return b.growthScore - a.growthScore
    })
    const rankTop = []
    let r = 0
    while (r < list.length && r < 5) {
      const tree = list[r]
      rankTop.push({
        treeId: tree.treeId,
        no: r + 1,
        noCls: r === 0 ? 'rno rno-gold' : (r === 1 ? 'rno rno-silver' : (r === 2 ? 'rno rno-bronze' : 'rno rno-plain')),
        name: tree.name,
        owner: tree.ownerName,
        level: tree.level.toFixed(0),
        score: tree.growthScore.toFixed(0),
        mine: tree.ownerId === user.userId   // 多树：自己名下的树都高亮，不只是当前这棵
      })
      r++
    }
    let myRankNo = 0
    let q = 0
    while (q < list.length) {
      if (list[q].treeId === t.treeId) { myRankNo = q + 1; break }
      q++
    }

    // 工单
    const tickets = []
    let m = kit.tickets.length - 1
    while (m >= 0) {
      const tk = kit.tickets[m]
      tickets.push({
        id: tk.id,
        ticket: tk.ticket,
        level: tk.level,
        dateText: dateText(tk.createdAt),
        resolved: tk.resolved
      })
      m--
    }

    this.setData({
      navSubtitle: '在养 ' + mine.length.toFixed(0) + ' 棵 · 成长值 ' + t.growthScore.toFixed(0),
      myTrees: mine.map(function (x) {
        return {
          treeId: x.treeId,
          name: x.name,
          level: x.level.toFixed(0),
          active: x.treeId === t.treeId
        }
      }),
      tree: {
        name: t.name,
        species: t.species,
        age: t.age,
        level: t.level.toFixed(0),
        growthScore: t.growthScore.toFixed(0)
      },
      levelTitle: levelTitle(t.level),
      nextNeed: nextNeed,
      growthBarStyle: 'width:' + Math.min(100, t.growthScore / GROWTH_CAP * 100).toFixed(0) + '%',
      atMax: atMax,
      tasks: tasks,
      pointsText: '碳积分 ' + user.availablePoints.toFixed(0),
      coinsText: (user.coins || 0).toFixed(0),
      dailyText: '每日 ' + dailyDone + '/2',
      streakText: streak.days > 0 ? '连续护林 ' + streak.days + ' 天' : '今天还没打卡',
      streakHint: streakHint,
      photoBar: 'width:' + photoBar + '%',
      photoHint: photoHint,
      rankTop: rankTop,
      myOutOfTop: myRankNo > 5,
      myRankRow: myRankNo > 5 ? {
        no: myRankNo,
        name: t.name,
        owner: '我',
        level: t.level.toFixed(0),
        score: t.growthScore.toFixed(0)
      } : null,
      rankText: myRankNo > 0 ? '我的排名 #' + myRankNo : '暂未上榜',
      photos: photos,
      photoCount: allPhotos.length,
      allPhotos: allPhotos,
      tickets: tickets,
      careVerified: kit.careAt === today,
      careTip: this.careComment ? 'AI 核验：' + this.careComment : '每天首次浇水 / 施肥需 AI 现场核验',
      photoPeriod: kit.tasks.photo.periodDays
    })
  },

  /**
   * 申请拍照提醒的订阅消息授权。
   * 没配模板 ID 时静默跳过（页面内的周期提示仍然生效），不打扰用户。
   */
  requestRemind(days) {
    if (!SUBSCRIBE_TEMPLATE_ID) {
      console.info('[tree] 未配置订阅消息模板 ID，跳过授权申请（页面内提示仍然生效）')
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [SUBSCRIBE_TEMPLATE_ID],
      success: (res) => {
        if (res[SUBSCRIBE_TEMPLATE_ID] === 'accept') {
          toast('已开启：每 ' + days + ' 天提醒你拍一张')
        }
      },
      fail: (e) => {
        console.warn('[tree] 订阅消息授权失败', e)
      }
    })
  },

  /* ---------- 多树切换 ---------- */

  onSwitchTree(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    if (!store.selectTree(id)) {
      toast('这棵树不在你的林地里')
      return
    }
    this.careComment = ''   // 核验评语属于上一棵树，切走就清掉
    this.refresh()
    const now = store.myTree()
    toast('已切换到「' + (now.name || '') + '」')
  },

  /* ---------- 养成 ---------- */

  onWater() {
    if (this.data.atMax) return toast('这棵树已经长满啦')
    if (!this.data.careVerified) return this.openCare('water')
    this.performWater('')
  },

  onFertilize() {
    if (this.data.atMax) return toast('这棵树已经长满啦')
    if (!this.data.careVerified) return this.openCare('fert')
    this.performFertilize('')
  },

  performWater(comment) {
    const t = store.myTree()
    const lvBefore = t.level
    const err = store.water(t.treeId)
    if (err) return toast(err)

    if (t.growthScore > GROWTH_CAP) t.growthScore = GROWTH_CAP
    const lvNow = levelOf(t.growthScore)
    store.updateTree(t.treeId, { growthScore: t.growthScore, level: lvNow })

    if (comment) {
      this.kit.careAt = todayStr()
      this.careComment = comment
    }
    const gained = this.grantTask('water', lvNow > lvBefore)
    saveKit(this.kt)
    this.refresh()

    let msg = '浇水成功 · 成长 +' + WATER_GAIN
    if (gained.task) msg += ' · 任务 +' + gained.task + ' 护林币'
    if (gained.level) msg += ' · 升 Lv.' + lvNow + ' 再 +' + gained.level
    if (gained.bonus) msg += ' · 全勤 +' + gained.bonus
    toast(msg)
    this.playGain(String(WATER_GAIN))
  },

  performFertilize(comment) {
    const t = store.myTree()
    const lvBefore = t.level
    const err = store.fertilize(t.treeId)
    if (err) return toast(err)

    if (t.growthScore > GROWTH_CAP) t.growthScore = GROWTH_CAP
    const lvNow = levelOf(t.growthScore)
    store.updateTree(t.treeId, { growthScore: t.growthScore, level: lvNow })

    if (comment) {
      this.kit.careAt = todayStr()
      this.careComment = comment
    }
    const gained = this.grantTask('fert', lvNow > lvBefore)
    saveKit(this.kt)
    this.refresh()

    let msg = '施肥成功 · 成长 +' + FERT_GAIN
    if (gained.task) msg += ' · 任务 +' + gained.task + ' 护林币'
    if (gained.level) msg += ' · 升 Lv.' + lvNow + ' 再 +' + gained.level
    if (gained.bonus) msg += ' · 全勤 +' + gained.bonus
    toast(msg)
    this.playGain(String(FERT_GAIN))
  },

  /** 结算任务 / 升级 / 连续 / 全勤，全部发护林币 */
  grantTask(kind, levelUp) {
    const kit = this.kit
    const streak = this.kt.streak
    const result = { task: 0, level: 0, bonus: 0 }
    const today = todayStr()

    if (!taskDone(kit, kind)) {
      kit.tasks[kind].lastDoneAt = today
      kit.tasks[kind].lastDoneTs = Date.now()
      result.task = kind === 'water' ? REWARD_WATER : (kind === 'fert' ? REWARD_FERT : REWARD_PHOTO)
      this.addCoins(result.task)
    }

    if (levelUp) {
      result.level = LEVEL_UP_COINS
      this.addCoins(LEVEL_UP_COINS)
    }

    if (kind !== 'photo' && streak.lastAt !== today) {
      let d = 1
      if (streak.lastTs > 0 && (Date.now() - streak.lastTs) / 3600000 <= 36) {
        d = streak.days + 1
      }
      streak.days = d
      streak.lastAt = today
      streak.lastTs = Date.now()
      if (d >= 3 && streak.milestone < 3) { streak.milestone = 3; this.addCoins(STREAK_3) }
      if (d >= 7 && streak.milestone < 7) { streak.milestone = 7; this.addCoins(STREAK_7) }
      if (d >= 14 && streak.milestone < 14) { streak.milestone = 14; this.addCoins(STREAK_14) }
    }

    if (kit.dailyBonusAt !== today && taskDone(kit, 'water') && taskDone(kit, 'fert')) {
      kit.dailyBonusAt = today
      result.bonus = DAILY_BONUS
      this.addCoins(DAILY_BONUS)
    }
    return result
  },

  addCoins(n) {
    const user = store.state.user
    store.updateUser({ coins: (user.coins || 0) + n })
  },

  /* ---------- 养护核验 ---------- */

  openCare(kind) {
    this.setData({
      sheetMode: 'care',
      pendingKind: kind,
      careLabel: kind === 'fert' ? '施肥' : '浇水'
    })
  },

  useSampleCare() {
    this.startCare('/static/illus/palm.png')
  },

  pickCarePhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success(res) {
        that.startCare(res.tempFilePaths[0] || '/static/illus/palm.png')
      }
    })
  },

  startCare() {
    const that = this
    const kind = this.data.pendingKind
    this.setData({ sheetMode: 'careLoading' })
    this.startDots()

    setTimeout(function () {
      that.stopDots()
      const arr = kind === 'fert' ? CARE_FERT : CARE_WATER
      const comment = arr[Math.floor(Math.random() * arr.length)]
      that.setData({ sheetMode: '' })
      if (kind === 'fert') {
        that.performFertilize(comment)
      } else {
        that.performWater(comment)
      }
    }, 1400)
  },

  /* ---------- 任务列表点击 ---------- */

  onTask(e) {
    const kind = e.currentTarget.dataset.kind
    if (taskDone(this.kit, kind)) {
      if (kind === 'photo') return toast('本周期已完成，' + taskDaysLeft(this.kit, kind) + ' 天后再来')
      return toast('今天已经完成，明天再来')
    }
    if (kind === 'water') return this.onWater()
    if (kind === 'fert') return this.onFertilize()
    this.openUpload()
  },

  /* ---------- 时光轴 ---------- */

  openUpload() {
    this.setData({ sheetMode: 'upload' })
  },

  useSampleUpload() {
    this.afterUpload('/static/illus/stage3.png', '示例实拍：枝叶比上次更密了')
  },

  pickGrowthPhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success(res) {
        that.afterUpload(res.tempFilePaths[0] || '/static/illus/stage3.png', '线下实拍：今天又长高了一点点')
      }
    })
  },

  afterUpload(image, desc) {
    const kit = this.kit
    const t = store.myTree()
    if (!t.treeId) return toast('先认养一棵树吧')

    const log = store.addGrowthLog(image, desc)
    kit.photos.push({
      logId: log.logId,
      stage: t.growthScore < LEVEL_STEP ? '幼芽' : (t.growthScore < LEVEL_STEP * 2 ? '新叶' : '枝繁'),
      monthText: monthText(todayStr())
    })

    const gained = this.grantTask('photo', false)
    if (gained.task) {
      let g = t.growthScore + PHOTO_GROWTH
      if (g > GROWTH_CAP) g = GROWTH_CAP
      store.updateTree(t.treeId, { growthScore: g, level: levelOf(g) })
    }

    saveKit(this.kt)
    this.setData({ sheetMode: '' })
    this.refresh()
    toast(gained.task ? '已记入时光轴 · 任务 +' + gained.task + ' 护林币' : '已记入时光轴（本周期奖励已领过）')
  },

  openAllLogs() {
    this.setData({ sheetMode: 'allLogs' })
  },

  /* ---------- 提醒周期 ---------- */

  openPeriod() {
    this.setData({ sheetMode: 'period' })
  },

  setPeriod(e) {
    const days = Number(e.currentTarget.dataset.days)
    this.kit.tasks.photo.periodDays = days
    saveKit(this.kt)
    this.setData({ sheetMode: '' })
    toast('拍照提醒已改为每 ' + days + ' 天')
    this.requestRemind(days)
    this.refresh()
  },

  closeSheet() {
    this.stopDots()
    this.setData({ sheetMode: '' })
  },

  /* ---------- 隐患 ---------- */

  openHazard() {
    const t = store.myTree()
    if (!t.treeId) return toast('先认养一棵树吧')
    if (t.status === 'hazard') return toast('这棵树已有待处理工单，等后勤处理完再报')
    this.setData({ sheetMode: 'hazard' })
  },

  useSampleHazard() {
    this.startHazard('/static/illus/palm.png')
  },

  pickHazardPhoto() {
    const that = this
    wx.chooseImage({
      count: 1,
      success(res) {
        that.startHazard(res.tempFilePaths[0] || '/static/illus/palm.png')
      }
    })
  },

  startHazard(image) {
    const that = this
    const t = store.myTree()
    this.setData({ sheetMode: 'hazardLoading', hazardImage: image })
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
      '线下巡检拍照：' + t.name,
      this.data.hazardImage
    )
    if (err) return toast(err)

    this.kit.tickets.push({
      id: 'tk_' + (this.kit.tickets.length + 1),
      ticket: h.ticket,
      level: h.level,
      analysis: h.analysis,
      advice: h.advice,
      createdAt: stamp(),
      resolved: false,
      imageUrl: this.data.hazardImage
    })
    store.updateTree(t.treeId, { status: 'hazard', hazardText: h.analysis })
    saveKit(this.kt)
    this.setData({ sheetMode: '' })
    this.refresh()
    toast('工单已推送总务处 · +' + h.reward + ' 积分')
  },

  resolveTicket(e) {
    const id = e.currentTarget.dataset.id
    let i = this.kit.tickets.length - 1
    while (i >= 0) {
      if (this.kit.tickets[i].id === id) {
        this.kit.tickets[i].resolved = true
        break
      }
      i--
    }
    const t = store.myTree()
    store.updateTree(t.treeId, { status: 'normal', hazardText: '' })
    saveKit(this.kt)
    this.refresh()
    toast('已模拟后勤处理完成，树恢复健康')
  },

  /* ---------- 树灵 ---------- */

  onSpirit() {
    const that = this
    aiTreeSpirit('', function (line) {
      that.setData({ spiritLine: line })
    })
  },

  /* ---------- 动效 / 计时器 ---------- */

  playGain(text) {
    const that = this
    this.setData({ gainShow: true, gainText: text })
    if (this.gainTimer) clearTimeout(this.gainTimer)
    this.gainTimer = setTimeout(function () {
      that.setData({ gainShow: false })
      that.gainTimer = 0
    }, 900)
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

  onBell() {
    this.openPeriod()
  }
})
