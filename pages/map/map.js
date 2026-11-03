const { emptyTree } = require('../../common/mock')
const store = require('../../common/store')
const { ADOPT_COST } = require('../../common/theme')
const { toast } = require('../../common/util')

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我认养的' },
  { key: 'owned', label: '已认养' },
  { key: 'free', label: '待认养' }
]

/** 给树点位补上 class / icon 字段（wxml 里不能调用函数，只能在 js 里先算好） */
function decoratePins(list) {
  const me = store.state.user.userId
  return list.map(function (t) {
    let head = 'pin-head-plain'
    let tail = 'pin-tail-plain'
    let icon = '/static/illus/tree-sage.png'

    if (t.status === 'hazard') {
      head = 'pin-head-warn'
      tail = 'pin-tail-warn'
    } else if (t.ownerId === me) {
      head = 'pin-head-mine'
      tail = 'pin-tail-mine'
      icon = '/static/illus/tree-white.png'
    } else if (t.ownerId !== '') {
      icon = '/static/illus/tree-deep.png'
    }

    return {
      treeId: t.treeId,
      name: t.name,
      species: t.species,
      posX: t.posX.toFixed(0),
      posY: t.posY.toFixed(0),
      status: t.status,
      pinHeadClass: head,
      pinTailClass: tail,
      pinIcon: icon
    }
  })
}

/** 详情卡片里的文案 / 配色，按状态预先算好 */
function decorateSelected(t) {
  const me = store.state.user.userId

  let tagText = ''
  if (t.status === 'hazard') {
    tagText = '隐患预警 · 待后勤处理'
  } else if (t.ownerId === '') {
    tagText = '待认养 · 可立即认养'
  } else if (t.ownerId === me) {
    tagText = '我认养的 · 可去养护'
  } else {
    tagText = '已认养 · ' + t.ownerName
  }

  let btnText = ''
  let btnBg = ''
  let btnColor = ''
  if (t.ownerId === me) {
    btnText = '已认养 · 去给它浇水'
    btnBg = 'btn-soft'
    btnColor = 'tc-btn-t-deep'
  } else if (t.status === 'hazard') {
    btnText = '隐患处理中 · 暂不可认养'
    btnBg = 'btn-mute'
    btnColor = 'tc-btn-t-white'
  } else if (t.ownerId !== '') {
    // 别人认养的树：不能认养（原来这里会错落到"消耗积分认养"，点了必报错），改成进认养人主页
    btnText = '查看认养人主页'
    btnBg = 'btn-soft'
    btnColor = 'tc-btn-t-deep'
  } else {
    btnText = '消耗 ' + ADOPT_COST.toFixed(0) + ' 积分认养'
    btnBg = 'btn-main'
    btnColor = 'tc-btn-t-white'
  }

  return {
    treeId: t.treeId,
    name: t.name,
    species: t.species,
    age: t.age,
    distance: t.distance.toFixed(0),
    status: t.status,
    ownerId: t.ownerId,
    tagText: tagText,
    tagBg: t.status === 'hazard' ? 'tag-warn' : 'tag-cream',
    tagColor: t.status === 'hazard' ? 'tc-tag-t-warn' : 'tc-tag-t-cream',
    btnText: btnText,
    btnBg: btnBg,
    btnColor: btnColor
  }
}

Page({
  data: {
    subtitle: '',
    filters: FILTERS,
    filter: 'all',
    showCard: false,
    sel: null,
    pins: [],
    hintText: ''
  },

  onLoad() {
    this.setData({ sel: decorateSelected(emptyTree()) })
  },

  async onShow() {
    // 等数据层拉完（测试号读本地、正式环境读云端），再渲染，避免先闪一下内置假数据
    await store.ready()
    this.refresh()
  },

  refresh() {
    const st = store.state
    const f = this.data.filter
    const me = st.user.userId

    const picked = []
    let i = 0
    while (i < st.trees.length) {
      const t = st.trees[i]
      if (f === 'all') {
        picked.push(t)
      } else if (f === 'mine') {
        if (t.ownerId === me) picked.push(t)
      } else if (f === 'owned') {
        if (t.ownerId !== '') picked.push(t)
      } else {
        if (t.ownerId === '') picked.push(t)
      }
      i++
    }

    this.setData({
      subtitle: '南校园 · ' + st.trees.length.toFixed(0) + ' 棵树在册',
      pins: decoratePins(picked),
      hintText: '附近 ' + store.unownedCount() + ' 棵可认养'
    })
  },

  setFilter(e) {
    const k = e.currentTarget.dataset.key
    if (k === this.data.filter) return
    this.setData({ filter: k }, () => this.refresh())
  },

  onSelect(e) {
    const id = e.currentTarget.dataset.id
    const t = store.treeById(id)
    if (!t) return
    this.setData({
      sel: decorateSelected(t),
      showCard: true
    })
  },

  onCardAction() {
    const sel = this.data.sel
    if (!sel) return

    if (sel.ownerId === store.state.user.userId) {
      wx.reLaunch({ url: '/pages/tree/tree' })
      return
    }

    // 别人认养的树 → 访客模式进 TA 的个人主页
    if (sel.ownerId !== '') {
      wx.navigateTo({ url: '/pages/honor/honor?userId=' + sel.ownerId })
      return
    }

    const err = store.adoptTree(sel.treeId)
    if (err !== '') {
      toast(err)
      return
    }

    this.setData({ showCard: false })
    this.refresh()
    toast('认养成功！去「林地」给它浇水吧')
  },

  onAddTree() {
    const n = store.state.trees.length + 1
    store.state.trees.push({
      treeId: 't_' + (100 + n).toFixed(0),
      name: '新上报点位 · 待鉴定 ' + n.toFixed(0),
      species: '待识别',
      posX: 20 + Math.random() * 55,
      posY: 26 + Math.random() * 34,
      ownerId: '', ownerName: '', level: 0, growthScore: 0,
      status: 'normal', hazardText: '', age: '未知', distance: 520
    })
    this.refresh()
    toast('已新增待认养点位，队员 A 采集实拍后可直接替换')
  },

  onSearch() {
    toast('1.0 骨架：搜索框已就位，队员 A 可在此接入树名检索')
  }
})
