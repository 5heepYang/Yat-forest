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
    adoptText: '',
    recordText: '',
    topGoods: [],

    sheetMode: '',
    currentGoods: null,
    codeText: '',
    nicknameInput: ''
  },

  onLoad() {
    const app = getApp()
    const g = (app && app.globalData) || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })
  },

  async onShow() {
    await store.ready()
    this.refresh()
  },

  refresh() {
    const st = store.state
    const t = store.myTree()

    let adopted = 0
    let i = 0
    while (i < st.trees.length) {
      if (st.trees[i].ownerId === st.user.userId) adopted++
      i++
    }

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

    // 我的树：多棵时横向滑动展示，点任意一棵直接切过去养护
    const myTrees = store.myTrees().map(function (x) {
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

    this.setData({
      days: st.user.days.toFixed(0),
      nickname: st.user.nickname,
      avatar: st.user.avatar,
      treeLevel: t.level.toFixed(0),
      unlockedCount: unlocked,
      badgeTotal: st.badges.length,
      pointsText: fmt(st.user.availablePoints),
      growthText: fmt(st.user.totalGrowthScore),
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

  /** 点「我的树」里的某棵 → 切为当前养护对象再进林地页 */
  openTree(e) {
    const id = e.currentTarget.dataset.id
    if (id && store.selectTree(id)) {
      wx.reLaunch({ url: '/pages/tree/tree' })
      return
    }
    this.goTree()
  }
})
