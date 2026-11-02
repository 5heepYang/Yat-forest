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
    adoptText: '',
    recordText: '',
    topGoods: [],

    sheetMode: '',
    currentGoods: null,
    codeText: ''
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

    let adoptText = '暂无'
    if (t.treeId !== '') {
      adoptText = t.species + ' · 08 号'
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

  goTree() {
    wx.reLaunch({ url: '/pages/tree/tree' })
  }
})
