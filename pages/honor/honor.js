const store = require('../../common/store')
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

Page({
  data: {
    statusBarHeight: 20,
    days: '0',
    nickname: '',
    avatar: '',
    treeLevel: '0',
    unlockedCount: 0,
    badgeTotal: 0,
    pointsText: '0',
    growthText: '0',
    adoptedCount: 0,
    topBadges: [],
    treeName: '',
    treeGrowth: '0',
    myTrees: [],
    guest: false,
    guestName: '',
    backText: '',
    adoptText: '',
    recordText: '',
    topGoods: [],

    sheetMode: '',
    currentGoods: null,
    codeText: '',
    nicknameInput: ''
  },

  onLoad(options) {
    const app = getApp()
    const g = (app && app.globalData) || {}
    // 从地图点别人的树进来时带 ?userId=xxx，进只读的"认养人主页"模式
    this.viewUserId = (options && options.userId) ? decodeURIComponent(options.userId) : ''
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },

  async onShow() {
    await store.ready()
    this.refresh()
  },

  refresh() {
    const st = store.state
    const me = st.user.userId
    const guest = !!this.viewUserId && this.viewUserId !== me

    // 访客模式只看得到公有数据（trees 是全局集合），积分/护林币/勋章拿不到，直接不展示
    let i = 0
    let owned = []
    while (i < st.trees.length) {
      const tr = st.trees[i]
      if (tr.ownerId === (guest ? this.viewUserId : me)) owned.push(tr)
      i++
    }
    owned.sort(function (a, b) {
      if (a.level !== b.level) return b.level - a.level
      return b.growthScore - a.growthScore
    })

    const t = guest ? (owned[0] || store.myTree()) : store.myTree()
    const adopted = owned.length

    let unlocked = 0
    i = 0
    while (i < st.badges.length) {
      if (st.badges[i].unlocked) unlocked++
      i++
    }

    const badges = st.badges.slice(0, 4).map(function (b) {
      return {
        badgeId: b.badgeId,
        name: b.name,
        icon: b.icon,
        unlocked: b.unlocked,
        cls: badgeClass(b)
      }
    })

    const goods = st.goods.slice(0, 2).map(function (g) {
      return {
        itemId: g.itemId,
        name: g.name,
        image: g.image,
        costText: g.costCurrency.toFixed(0),
        desc: g.desc,
        boxCls: goodsBoxClass(g.itemId)
      }
    })

    // 我的树：多棵时横向滑动展示，点任意一棵直接切过去养护（访客模式不可点进养护）
    const myTrees = owned.map(function (x) {
      return {
        treeId: x.treeId,
        name: x.name,
        level: x.level.toFixed(0),
        growth: x.growthScore.toFixed(0),
        image: x.image || '/static/illus/palm.png',
        active: x.treeId === t.treeId
      }
    })

    let adoptText = '暂无'
    if (myTrees.length > 0) {
      adoptText = myTrees.length.toFixed(0) + ' 棵 · ' + myTrees[0].name
    }

    let recordText = '暂无'
    if (st.records.length > 0) {
      recordText = st.records.length.toFixed(0) + ' 次 · 帆布袋'
    }

    let totalGrowth = 0
    let maxLevel = 0
    i = 0
    while (i < owned.length) {
      totalGrowth += owned[i].growthScore
      if (owned[i].level > maxLevel) maxLevel = owned[i].level
      i++
    }

    this.setData({
      guest: guest,
      guestName: owned.length > 0 ? (owned[0].ownerName || '这位森友') : '这位森友',
      backText: guest ? '‹ 返回地图' : '',
      days: st.user.days.toFixed(0),
      nickname: guest ? (owned.length > 0 ? (owned[0].ownerName || '这位森友') : '这位森友') : st.user.nickname,
      avatar: guest ? '/static/illus/avatar.png' : st.user.avatar,
      treeLevel: (guest ? maxLevel : t.level).toFixed(0),
      unlockedCount: unlocked,
      badgeTotal: st.badges.length,
      pointsText: fmt(guest ? totalGrowth : st.user.availablePoints),
      growthText: fmt(guest ? totalGrowth : st.user.totalGrowthScore),
      adoptedCount: adopted,
      topBadges: badges,
      treeName: t.name,
      treeGrowth: t.growthScore.toFixed(0),
      myTrees: myTrees,
      adoptText: adoptText,
      recordText: recordText,
      topGoods: goods
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

  doExchange() {
    const r = store.exchange(this.data.currentGoods.itemId)
    if (!r.ok) {
      toast(r.msg)
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

  /** 点昵称 → 改名弹层 */
  openProfile() {
    if (this.data.guest) return
    this.setData({
      sheetMode: 'profile',
      nicknameInput: store.state.user.nickname
    })
  },

  onNickInput(e) {
    this.setData({ nicknameInput: e.detail.value })
  },

  saveProfile() {
    const nick = (this.data.nicknameInput || '').trim()
    if (!nick) {
      toast('先写个名字吧')
      return
    }
    store.updateUser({ nickname: nick })
    this.setData({ sheetMode: '', nickname: nick })
    toast('改好了')
  },

  goTree() {
    wx.reLaunch({ url: '/pages/tree/tree' })
  },

  /** 访客模式：返回地图 */
  goBack() {
    wx.navigateBack({
      fail: function () {
        wx.reLaunch({ url: '/pages/map/map' })
      }
    })
  },

  /** 点「我的树」里的某棵 → 切为当前养护对象再进林地页 */
  openTree(e) {
    if (this.data.guest) {
      toast('这是别人的林地，去地图认养一棵自己的吧')
      return
    }
    const id = e.currentTarget.dataset.id
    if (id && store.selectTree(id)) {
      wx.reLaunch({ url: '/pages/tree/tree' })
      return
    }
    this.goTree()
  }
})
