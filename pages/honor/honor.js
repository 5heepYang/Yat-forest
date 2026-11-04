const store = require('../../common/store')
const db = require('../../common/db')
const auth = require('../../common/auth')
const { fmt, toast } = require('../../common/util')

function badgeClass(b) {
  if (!b.unlocked) return 'badge-circle badge-off'
  if (b.badgeId === 'b_01') return 'badge-circle badge-gold'
  if (b.badgeId === 'b_02') return 'badge-circle badge-pink'
  return 'badge-circle badge-green'
}

function goodsBoxClass(itemId) {
  return itemId === 's_301' ? 'goods-box goods-box-green' : 'goods-box goods-box-cream'
}

/** 树列表卡片用的展示字段（wxml 不能调函数，这里算好） */
function decorateTrees(list) {
  return list.map(function (t) {
    return {
      treeId: t.treeId,
      name: t.name,
      img: t.image || '/static/illus/palm.png',
      level: t.level.toFixed(0),
      growth: t.growthScore.toFixed(0)
    }
  })
}

/** 从全局树数据里挑出某人的树，顺带算合计成长值 / 最高等级（访客档案兜底用） */
function treesOf(st, userId) {
  const mine = []
  let sumGrowth = 0
  let maxLevel = 0
  let i = 0
  while (i < st.trees.length) {
    const t = st.trees[i]
    if (t.ownerId === userId) {
      mine.push(t)
      sumGrowth = sumGrowth + t.growthScore
      if (t.level > maxLevel) maxLevel = t.level
    }
    i++
  }
  return { list: mine, sumGrowth: sumGrowth, maxLevel: maxLevel }
}

Page({
  data: {
    statusBarHeight: 20,
    viewing: false,
    days: '0',
    nickname: '',
    avatar: '',
    heroLine1: '',
    heroLine2: '',
    stats: [],
    unlockedCount: 0,
    badgeTotal: 0,
    topBadges: [],
    allBadges: [],
    treeList: [],
    coinsText: '0',
    totalCarbonText: '0 g',
    recordText: '',
    recordList: [],
    topGoods: [],

    sheetMode: '',
    currentGoods: null,
    codeText: '',
    nicknameInput: '',
    bioInput: '',
    avatarSheet: ''
  },

  onLoad(options) {
    const app = getApp()
    const g = (app && app.globalData) || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
    // 地图页点「查看认养人」进来会带 userId：访客模式，只看不改
    this.visUserId = (options && options.userId) || ''
  },

  async onShow() {
    await store.ready()
    if (this.visUserId !== '' && this.visUserId !== store.state.user.userId) {
      this.loadVisitor()
    } else {
      this.refresh()
    }
  },

  /** 我的主页（tab 进来，无参数） */
  refresh() {
    const st = store.state
    const t = store.myTree()
    const tm = treesOf(st, st.user.userId)

    // 勋章从真实数据算（认养/减碳/隐患/护林天数），不再用 mock 的硬编码值
    const badgesAll = store.badgeState()
    let unlocked = 0
    let titleBadge = ''
    let i = 0
    while (i < badgesAll.length) {
      if (badgesAll[i].unlocked) {
        unlocked++
        if (titleBadge === '') titleBadge = badgesAll[i].name
      }
      i++
    }

    // 勋章馆弹层用：全部勋章 + 点亮状态 + 获取条件
    const allBadges = badgesAll.map(function (b) {
      return {
        badgeId: b.badgeId,
        name: b.name,
        icon: b.icon,
        desc: b.desc,
        unlocked: b.unlocked,
        cls: badgeClass(b)
      }
    })

    const badges = allBadges.slice(0, 4)

    // 补给站全量商品（不再截前两件）
    const goods = st.goods.map(function (g) {
      return {
        itemId: g.itemId,
        name: g.name,
        image: g.image,
        costText: g.costCurrency.toFixed(0),
        desc: g.desc,
        boxCls: goodsBoxClass(g.itemId)
      }
    })

    // 生涯累计减碳（所有已完成任务的 carbonSavedG 求和）
    let totalCarbon = 0
    i = 0
    while (i < st.tasks.length) {
      if (st.tasks[i].done) {
        totalCarbon = totalCarbon + (st.tasks[i].carbonSavedG || 0)
      }
      i++
    }

    // 兑换记录：'商品名 · 凭证码' 拆开展示
    const recordList = st.records.map(function (r) {
      const parts = (r || '').split(' · ')
      return { name: parts[0] || '纪念品', code: parts[1] || '' }
    })

    let recordText = '去逛逛 ›'
    if (recordList.length > 0) {
      recordText = recordList.length.toFixed(0) + ' 次 ›'
    }

    const bio = st.user.bio || ''

    this.setData({
      viewing: false,
      days: st.user.days.toFixed(0),
      nickname: st.user.nickname,
      avatar: st.user.avatar,
      heroLine1: 'Lv.' + t.level.toFixed(0) + ' 护林人' + (titleBadge !== '' ? ' · ' + titleBadge : ''),
      heroLine2: bio !== '' ? bio : '已点亮 ' + unlocked.toFixed(0) + ' / ' + st.badges.length.toFixed(0) + ' 枚勋章',
      stats: [
        { num: fmt(st.user.availablePoints), unit: '', label: '可用碳积分', gold: false },
        { num: fmt(st.user.totalGrowthScore), unit: '', label: '累计成长值', gold: false },
        { num: tm.list.length.toFixed(0), unit: '棵', label: '我的树', gold: false },
        { num: fmt(st.user.coins || 0), unit: '', label: '护林币', gold: true }
      ],
      unlockedCount: unlocked,
      badgeTotal: st.badges.length,
      topBadges: badges,
      allBadges: allBadges,
      treeList: decorateTrees(tm.list),
      coinsText: fmt(st.user.coins || 0),
      totalCarbonText: fmt(totalCarbon) + ' g',
      recordText: recordText,
      recordList: recordList,
      topGoods: goods
    })
  },

  /**
   * 别人的主页（地图页进入）。
   * 档案优先读云端 users；TA 没注册过（演示数据里的认养人）或本地模式时，
   * 用全局 trees 上的冗余字段（ownerName / 成长值）拼一份兜底档案。
   * 补给站整块隐藏——护林币和兑换记录是别人的钱包，只看不花。
   */
  loadVisitor() {
    const that = this
    const st = store.state
    const tm = treesOf(st, this.visUserId)

    db.fetchUserDoc(this.visUserId).then(function (doc) {
      let nickname = '森友'
      let avatar = '/static/illus/avatar.png'
      let growth = tm.sumGrowth
      let badgeCount = 0
      let bio = ''
      let daysStat = { num: '—', unit: '', label: '护林天数' }

      if (doc) {
        nickname = doc.nickname || nickname
        avatar = doc.avatar || avatar
        growth = doc.totalGrowthScore || growth
        badgeCount = doc.badgeCount || 0
        bio = doc.bio || ''
        daysStat = { num: (doc.days || 0).toFixed(0), unit: '天', label: '护林天数' }
      } else if (tm.list.length > 0) {
        nickname = tm.list[0].ownerName || nickname
      }

      const badges = st.badges.slice(0, 4).map(function (b, idx) {
        const on = idx < badgeCount
        return {
          badgeId: b.badgeId,
          name: b.name,
          icon: b.icon,
          unlocked: on,
          cls: badgeClass({ badgeId: b.badgeId, unlocked: on })
        }
      })

      that.setData({
        viewing: true,
        nickname: nickname,
        avatar: avatar,
        heroLine1: 'Lv.' + tm.maxLevel.toFixed(0) + ' 护林人',
        heroLine2: bio !== '' ? bio : '已点亮 ' + badgeCount.toFixed(0) + ' / ' + st.badges.length.toFixed(0) + ' 枚勋章',
        stats: [
          { num: fmt(growth), unit: '', label: '累计成长值' },
          { num: tm.list.length.toFixed(0), unit: '棵', label: '在养的树' },
          daysStat
        ],
        unlockedCount: badgeCount,
        badgeTotal: st.badges.length,
        topBadges: badges,
        treeList: decorateTrees(tm.list)
      })
    })
  },

  /** 在养的树卡片：只有本人的主页能点进林地页；带 id 时顺便切成当前养护树 */
  onTreeTap(e) {
    if (this.data.viewing) return
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    if (id) store.selectTree(id)
    wx.reLaunch({ url: '/pages/tree/tree' })
  },

  goBack() {
    wx.navigateBack({
      fail: function () {
        wx.reLaunch({ url: '/pages/map/map' })
      }
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '护林档案不会丢，重新登录即可回来',
      confirmText: '退出',
      cancelText: '先不',
      success: function (res) {
        if (!res.confirm) return
        auth.clearLogin()
        wx.reLaunch({ url: '/pages/login/login' })
      }
    })
  },

  openExchange(e) {
    const id = e.currentTarget.dataset.id
    const st = store.state

    let g = null
    let i = 0
    while (i < st.goods.length) {
      if (st.goods[i].itemId === id) {
        g = st.goods[i]
        break
      }
      i++
    }
    if (!g) return

    this.setData({
      currentGoods: {
        itemId: g.itemId,
        name: g.name,
        desc: g.desc,
        costText: g.costCurrency.toFixed(0)
      },
      sheetMode: 'confirm'
    })
  },

  async doExchange() {
    // 云端模式下 exchange() 返回 Promise，库存与护林币由 actions 云函数事务扣减
    const r = await store.exchange(this.data.currentGoods.itemId)
    if (!r.ok) {
      toast(r.msg || '兑换失败')
      this.refresh()
      return
    }
    this.setData({
      codeText: r.code,
      sheetMode: 'ok'
    })
    this.refresh()
  },

  closeSheet() {
    this.setData({ sheetMode: '' })
  },

  /** 勋章馆弹层：全部勋章 + 点亮状态 + 获取条件 */
  openBadges() {
    this.setData({ sheetMode: 'badges' })
  },

  /** 关于弹层：积分/成长值/护林币的获得与使用说明 */
  openAbout() {
    this.setData({ sheetMode: 'about' })
  },

  /** 兑换记录弹层：逐条展示商品名 + 凭证码 */
  openRecords() {
    this.setData({ sheetMode: 'records' })
  },

  /** 头像点击放大预览 */
  previewAvatar() {
    const url = this.data.avatar
    if (!url) return
    wx.previewImage({
      current: url,
      urls: [url],
      fail: function () { /* base64 头像个别机型不支持预览，静默即可 */ }
    })
  },

  /** 点昵称 → 改资料弹层（改名/换头像/签名；登录页只一键进入，资料在这补） */
  openProfile() {
    this.avatarTemp = ''
    this.setData({
      sheetMode: 'profile',
      nicknameInput: store.state.user.nickname,
      bioInput: store.state.user.bio || '',
      avatarSheet: store.state.user.avatar
    })
  },

  /** 微信官方头像选择：拿到的是临时文件路径，保存时再压缩转存 */
  onChooseAvatar(e) {
    const path = e.detail.avatarUrl
    if (!path) return
    this.avatarTemp = path
    this.setData({ avatarSheet: path })
  },

  onNickInput(e) {
    this.setData({ nicknameInput: e.detail.value })
  },

  onBioInput(e) {
    this.setData({ bioInput: e.detail.value })
  },

  saveProfile() {
    const nick = (this.data.nicknameInput || '').trim()
    if (!nick) {
      toast('先写个名字吧')
      return
    }
    const bio = (this.data.bioInput || '').trim()

    const that = this
    const finish = function (avatarUrl) {
      if (store.isCloud()) {
        store.cloudUpdateProfile({ nickname: nick, avatar: avatarUrl, bio: bio }).then(function (r) {
          that.setData({ sheetMode: '', nickname: nick, avatar: avatarUrl, heroLine2: bio })
          toast(r && r.ok ? '改好了' : ((r && r.msg) || '保存失败'))
          that.refresh()
        })
        return
      }
      store.updateUser({ nickname: nick, avatar: avatarUrl, bio: bio })
      that.setData({ sheetMode: '', nickname: nick, avatar: avatarUrl, heroLine2: bio })
      toast('改好了')
    }

    if (this.avatarTemp) {
      // 头像是临时文件：先压缩再转存（本地转 base64 / 云端传云存储），转存失败就用原路径顶着
      const temp = this.avatarTemp
      wx.compressImage({
        src: temp,
        quality: 40,
        success: function (r) {
          db.uploadImage(r.tempFilePath)
            .then(finish)
            .catch(function () { finish(temp) })
        },
        fail: function () {
          db.uploadImage(temp)
            .then(finish)
            .catch(function () { finish(temp) })
        }
      })
    } else {
      finish(store.state.user.avatar)
    }
  }
})
