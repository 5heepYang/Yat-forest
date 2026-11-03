const { emptyTree } = require('../../common/mock')
const store = require('../../common/store')
const { CAMPUS, posToLatLng, latLngToPos, treeLatLng, distanceMeters, formatDistance, getCurrentLocation, nearbyTrees } = require('../../common/geo')
const { aiAnalyzeHazard } = require('../../common/ai')
const { ADOPT_COST } = require('../../common/theme')
const { toast } = require('../../common/util')
const db = require('../../common/db')
const { getTrees } = require('./services/treeService')

/** 「附近可认养」的统计半径（米） */
const NEAR_RADIUS = 500

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我认养的' },
  { key: 'owned', label: '已认养' },
  { key: 'free', label: '待认养' }
]

/** 四种状态的 marker 图标（素材在 pages/map/assets/，配色同 common/theme.js） */
const ICON_FREE = '/pages/map/assets/marker-free.png'
const ICON_OWNED = '/pages/map/assets/marker-owned.png'
const ICON_MINE = '/pages/map/assets/marker-mine.png'
const ICON_HAZARD = '/pages/map/assets/marker-hazard.png'

/** 按树木状态选 marker 图标：隐患 > 我认养的 > 校友认养的 > 待认养 */
function markerIcon(t, me) {
  if (t.status === 'hazard') return ICON_HAZARD
  if (t.ownerId === me) return ICON_MINE
  if (t.ownerId !== '') return ICON_OWNED
  return ICON_FREE
}

/**
 * Tree 数组 -> <map> markers。
 * marker.id 用数组下标（数字，各平台兼容），treeId 的映射由调用方单独维护。
 * selectedId 对应的 marker 放大一号，作为点击选中的反馈。
 */
function buildMarkers(list, me, selectedId) {
  return list.map(function (t, i) {
    // 统一走 treeLatLng：posX/posY 是真源，CAMPUS 校准后全量生效
    const p = treeLatLng(t)
    const on = t.treeId === selectedId
    return {
      id: i,
      latitude: p.latitude,
      longitude: p.longitude,
      iconPath: markerIcon(t, me),
      width: on ? 44 : 36,
      height: on ? 56 : 46,
      // 锚点设在 pin 尖端，点位正好落在树的经纬度上
      anchor: { x: 0.5, y: 1 },
      title: t.name
    }
  })
}

/** 详情卡片里的文案 / 配色，按状态预先算好（wxml 里不能调用函数） */
function decorateSelected(t) {
  const me = store.state.user.userId

  let tagText = ''
  if (t.status === 'hazard') {
    tagText = '隐患预警，待后勤处理'
  } else if (t.ownerId === '') {
    tagText = '待认养，可立即认养'
  } else if (t.ownerId === me) {
    tagText = '我认养的，可去养护'
  } else {
    tagText = '已认养：' + t.ownerName
  }

  let btnText = ''
  let btnBg = ''
  let btnColor = ''
  if (t.ownerId === me) {
    btnText = '已认养 · 去给它浇水'
    btnBg = 'btn-soft'
    btnColor = 'tc-btn-t-deep'
  } else if (t.ownerId !== '') {
    // 校友认养的树：不提供认养入口
    btnText = '这棵树已被认养'
    btnBg = 'btn-mute'
    btnColor = 'tc-btn-t-white'
  } else if (t.status === 'hazard') {
    btnText = '隐患处理中，暂不可认养'
    btnBg = 'btn-mute'
    btnColor = 'tc-btn-t-white'
  } else {
    btnText = '消耗 ' + ADOPT_COST.toFixed(0) + ' 积分认养'
    btnBg = 'btn-main'
    btnColor = 'tc-btn-t-white'
  }

  // 描述：隐患树优先展示隐患说明（红色），其余用简介或兜底文案
  const isHazard = t.status === 'hazard'
  const desc = isHazard && t.hazardText
    ? '隐患说明：' + t.hazardText
    : (t.description || '这棵树还没有简介，等认养人来补充。')

  return {
    treeId: t.treeId,
    name: t.name,
    species: t.species,
    age: t.age,
    status: t.status,
    ownerId: t.ownerId,
    coverImg: t.image || '/static/illus/palm.png',
    ownerText: t.ownerId === '' ? '暂无认养人' : (t.ownerId === me ? t.ownerName + '（我）' : t.ownerName),
    growthScore: t.growthScore,
    levelText: t.level > 0 ? 'Lv.' + t.level : '未养成',
    desc: desc,
    descClass: isHazard ? 'tc-desc-warn' : '',
    distanceText: formatDistance(t.distance),
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
    keyword: '',
    // 地图默认中心：中大南校园（common/geo.js 里的 CAMPUS）
    center: {
      latitude: CAMPUS.latitude,
      longitude: CAMPUS.longitude
    },
    scale: 17,
    markers: [],
    userReal: false,
    showCard: false,
    sel: null,
    showUpload: false,
    uploadLoc: null,
    uploadDraft: null,
    pickMode: false,
    loaded: false,
    showEmpty: false,
    mapReady: false,
    hintText: '正在加载树木点位…'
  },

  onLoad() {
    // 全量树木缓存（非渲染数据，不放 data，避免 setData 拷贝大数组）
    this.trees = []
    // marker.id（数组下标）-> treeId 的映射，Step 3 的 markertap 靠它找回树木
    this.markerTreeIds = []
    // 当前选中的树（详情打开时放大对应 marker）
    this.selectedTreeId = ''
    // 认养确认框是否已弹出（防连续点击重复认养）
    this.adopting = false
    // 当前定位结果（geo.getCurrentLocation 的产物，含 real 标记）
    this.userLoc = null
    this.setData({ sel: decorateSelected(emptyTree()) })
  },

  async onShow() {
    // 等数据层拉完（测试号读本地、正式环境读云端），再渲染，避免先闪一下内置假数据
    this.trees = await getTrees()
    this.loaded = true

    // 定位：拿到真实位置就用它算"距你 xx m"，拿不到就回退校园中心
    await this.locate(true)
    this.refresh()

    // 数据就绪后再给地图留一点瓦片加载时间，然后揭开暖白遮罩；
    // 只在首次进入时盖一次，切 Tab 回来地图已就绪，不再闪
    if (!this.data.mapReady) {
      if (this._mapReadyTimer) clearTimeout(this._mapReadyTimer)
      this._mapReadyTimer = setTimeout(() => {
        this.setData({ mapReady: true })
      }, 400)
    }
  },

  refresh() {
    const f = this.data.filter
    const me = store.state.user.userId
    const kw = this.data.keyword.replace(/^\s+|\s+$/g, '').toLowerCase()

    const picked = []
    let i = 0
    while (i < this.trees.length) {
      const t = this.trees[i]
      // 第一步：状态筛选
      if (f === 'mine') {
        if (t.ownerId !== me) { i++; continue }
      } else if (f === 'owned') {
        // 已认养：所有被认养的树，含我的（用户明确保留原口径）
        if (t.ownerId === '') { i++; continue }
      } else if (f === 'free') {
        if (t.ownerId !== '') { i++; continue }
      }
      // 第二步：关键词搜索（树名 / 树种），与筛选叠加
      if (kw !== '') {
        const hay = (t.name + ' ' + t.species).toLowerCase()
        if (hay.indexOf(kw) === -1) { i++; continue }
      }
      picked.push(t)
      i++
    }

    this.markerTreeIds = picked.map(function (t) { return t.treeId })

    // 提示文案：无结果 / 有筛选或搜索 / 默认三种口径
    let hintText = ''
    if (picked.length === 0) {
      hintText = '没有找到符合条件的树木'
    } else if (f !== 'all' || kw !== '') {
      hintText = '当前显示 ' + picked.length.toFixed(0) + ' 棵'
    } else if (this.userLoc && this.userLoc.real) {
      // 有真实定位才敢说"附近"：按 500 米半径数一遍待认养
      const nearFree = nearbyTrees(this.userLoc.latitude, this.userLoc.longitude, this.trees, NEAR_RADIUS, true)
      hintText = '附近 ' + nearFree.length.toFixed(0) + ' 棵可认养 · ' + NEAR_RADIUS + ' 米内'
    } else {
      hintText = '全校 ' + store.unownedCount() + ' 棵可认养'
    }

    this.setData({
      subtitle: '南校园 · ' + this.trees.length.toFixed(0) + ' 棵树在册',
      markers: buildMarkers(picked, me, this.selectedTreeId),
      showEmpty: this.loaded && picked.length === 0,
      hintText: hintText
    })
  },

  setFilter(e) {
    const k = e.detail.key
    if (k === this.data.filter) return
    this.setData({ filter: k }, () => this.refresh())
  },

  /** 点击 marker：marker.id 是数组下标，先换成 treeId 再找回树木；选中 pin 放大反馈 */
  onMarkerTap(e) {
    const treeId = this.markerTreeIds[e.detail.markerId]
    if (!treeId) return
    const t = store.treeById(treeId)
    if (!t) return
    this.selectedTreeId = treeId
    this.setData({
      sel: decorateSelected(t),
      showCard: true
    })
    this.refresh()
  },

  onUnload() {
    if (this._mapReadyTimer) clearTimeout(this._mapReadyTimer)
  },

  /** 读取定位授权状态：true 已授权 / false 已明确拒绝 / undefined 还没问过 */
  checkLocSetting() {
    return new Promise(function (resolve) {
      wx.getSetting({
        success: function (res) {
          resolve(res.authSetting['scope.userLocation'])
        },
        fail: function () {
          resolve(undefined)
        }
      })
    })
  },

  /**
   * 定位入口。
   * @param {boolean} silent 进入页面时的静默模式：被拒绝只 toast；
   *                         false = 点"回到当前位置"按钮，被拒绝时引导去设置
   */
  async locate(silent) {
    const loc = await getCurrentLocation()
    this.userLoc = loc
    this.applyDistances()

    if (loc.real) {
      // 授权成功：地图显示蓝点；人就在校园附近才自动把视野跟过去，
      // 人在校外（演示常见）时保持校园视野，避免一棵树都看不到
      const dToCampus = distanceMeters(loc.latitude, loc.longitude, CAMPUS.latitude, CAMPUS.longitude)
      this.setData({ userReal: true })
      if (dToCampus <= 1000) {
        this.setData({
          center: { latitude: loc.latitude, longitude: loc.longitude }
        })
      }
      return
    }

    // 没拿到真实定位：区分"明确拒绝授权"和"设备暂时拿不到"，前者才引导
    const st = await this.checkLocSetting()
    if (st === false) {
      if (silent) {
        toast('定位权限未开启，已显示校园地图')
        return
      }
      wx.showModal({
        title: '定位权限未开启',
        content: '开启后可查看你与树木的距离，并支持一键回到当前位置',
        confirmText: '去设置',
        cancelText: '暂不',
        confirmColor: '#4E8A6B',
        success: (res) => {
          if (!res.confirm) return
          wx.openSetting({
            success: (s) => {
              // 从设置页回来且已授权，立即重试一次定位
              if (s.authSetting['scope.userLocation']) {
                this.locate(true)
              }
            }
          })
        }
      })
      return
    }

    // 其余失败（接口未在后台报备 / 隐私协议未同意 / 无定位信号 / 超时）：
    // 以前这里什么都不提示，用户会以为"已经定位好了"，实际看到的是校园兜底中心。
    const why = loc.reason || '设备暂时拿不到位置'
    console.warn('[map] 定位不可用：', why, loc.errMsg)
    if (silent) {
      toast('定位不可用：' + why + '，已显示校园地图')
      return
    }
    wx.showModal({
      title: '定位不可用',
      content: why + '。可以先手动浏览校园地图，或检查小程序后台是否已申请「获取当前的地理位置」接口权限。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#4E8A6B'
    })
  },

  /** 用当前定位刷新每棵树的"距你 xx"（无定位时按校园中心算，保证不报错） */
  applyDistances() {
    const loc = this.userLoc || CAMPUS
    this.trees.forEach(function (t) {
      const p = treeLatLng(t)
      t.distance = distanceMeters(loc.latitude, loc.longitude, p.latitude, p.longitude)
    })
  },

  /** 地图右下角"回到当前位置"按钮：已定位直接飞过去，否则先走授权流程 */
  onLocate() {
    if (this.userLoc && this.userLoc.real) {
      wx.createMapContext('campusMap').moveToLocation()
      return
    }
    this.locate(false)
  },

  onCardClose() {
    this.selectedTreeId = ''
    this.setData({ showCard: false })
    this.refresh()
  },

  /**
   * 拍照上报异常：任何一棵树都能报（包括别人认养的树）。
   * 现场照片 → AI 巡检定级 → 二次确认 → 写隐患日志 + 把树标成 hazard（marker 变红）。
   */
  onCardHazard() {
    const sel = this.data.sel
    if (!sel) return

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0]
        this.runHazardCheck(sel, f ? f.tempFilePath : '')
      },
      fail: (e) => {
        if (e && e.errMsg && e.errMsg.indexOf('cancel') === -1) {
          toast('选择照片失败，请重试')
        }
      }
    })
  },

  runHazardCheck(sel, image) {
    wx.showLoading({ title: 'AI 巡检中', mask: true })
    aiAnalyzeHazard(sel.name, sel.species, (r) => {
      wx.hideLoading()
      wx.showModal({
        title: r.level + '预警 · ' + sel.name,
        content: r.analysis + '\n\n建议：' + r.advice + '\n\n提交后可获得 ' + r.reward.toFixed(0) + ' 碳积分',
        confirmText: '提交工单',
        cancelText: '取消',
        confirmColor: '#4E8A6B',
        success: (m) => {
          if (!m.confirm) return
          const err = store.reportHazard(
            { level: r.level, ticket: r.ticket, analysis: r.analysis, advice: r.advice, reward: r.reward },
            '地图巡检拍照：' + sel.name,
            image,
            sel.treeId
          )
          if (err) {
            toast(err)
            return
          }
          // 再把树标成隐患态，marker 与卡片会一起变红；
          // 别人的树可能因集合权限写不进去，失败不算错，日志和积分已经记上了
          store.updateTree(sel.treeId, { status: 'hazard', hazardText: r.analysis })
          this.setData({ showCard: false })
          this.refresh()
          toast('工单已推送总务处 · +' + r.reward.toFixed(0) + ' 积分')
        }
      })
    })
  },

  /**
   * 详情卡片主按钮：认养闭环。
   * 我认养的 -> 跳林地浇水；隐患树 -> 只提示不可认养；
   * 待认养 -> 二次确认 -> store.adoptTree 校验积分并扣减 -> 刷新 marker 和详情。
   */
  onCardAction() {
    const sel = this.data.sel
    if (!sel) return

    if (sel.ownerId === store.state.user.userId) {
      // 先把自己这棵切成"当前养护树"，再去林地页，避免多树时点哪棵都进同一棵
      store.selectTree(sel.treeId)
      wx.reLaunch({ url: '/pages/tree/tree' })
      return
    }

    if (sel.ownerId !== '') {
      // 校友认养的树：按钮已置灰，这里兜底拦截，不进入认养流程
      toast('这棵树已经有认养人了，去看看其他树吧')
      return
    }

    if (sel.status === 'hazard') {
      toast('该树正在隐患处理中，暂不可认养')
      return
    }

    // 防重复点击：确认框弹出期间不再响应，认养成功后树已有归属，重复认养会被 store 拦截
    if (this.adopting) return
    this.adopting = true

    const me = store.state.user
    wx.showModal({
      title: '确认认养',
      content: '消耗 ' + ADOPT_COST.toFixed(0) + ' 积分认养「' + sel.name + '」？\n当前可用积分：' + me.availablePoints.toFixed(0),
      confirmText: '确认认养',
      cancelText: '再想想',
      confirmColor: '#4E8A6B',
      success: (res) => {
        if (!res.confirm) return

        // 积分不足 / 已被他人认养等情况由 store 统一校验，返回提示语
        const err = store.adoptTree(sel.treeId)
        if (err !== '') {
          toast(err)
          return
        }

        // 认养成功：刷新地图 marker（变金色"我"字 pin），详情卡片就地更新为"我认养的"
        this.refresh()
        this.setData({ sel: decorateSelected(store.treeById(sel.treeId)) })
        toast('认养成功，剩余 ' + store.state.user.availablePoints.toFixed(0) + ' 积分')
      },
      complete: () => {
        this.adopting = false
      }
    })
  },

  /** 打开新增树木弹窗，位置取打开时的地图中心（取不到则用默认校园中心） */
  onAddTree() {
    const open = (loc) => {
      this.selectedTreeId = ''
      this.setData({
        showUpload: true,
        uploadLoc: loc,
        uploadDraft: null,   // 新开一次，草稿从头来
        pickMode: false,
        showCard: false
      })
      this.refresh()
    }
    const fallback = {
      latitude: this.data.center.latitude,
      longitude: this.data.center.longitude
    }
    wx.createMapContext('campusMap').getCenterLocation({
      success: (res) => {
        open({
          latitude: Number(res.latitude.toFixed(6)),
          longitude: Number(res.longitude.toFixed(6))
        })
      },
      fail: () => open(fallback)
    })
  },

  onUploadClose() {
    this.setData({ showUpload: false, uploadDraft: null })
  },

  /** 弹窗把表单内容实时抛上来，选点往返时不会丢已填内容 */
  onUploadDraft(e) {
    this.setData({ uploadDraft: e.detail })
  },

  /** 收起弹窗，进入"在地图上点一下"的选点模式 */
  onUploadPick() {
    this.setData({ showUpload: false, pickMode: true })
    toast('在地图上点一下树木的位置')
  },

  onPickCancel() {
    this.setData({ pickMode: false, showUpload: true })
  },

  /** 选点模式下的地图点击：拿经纬度回填弹窗 */
  onMapTap(e) {
    if (!this.data.pickMode) return
    const d = e && e.detail
    if (!d || typeof d.latitude !== 'number') {
      toast('没取到位置，请再点一次')
      return
    }
    this.setData({
      pickMode: false,
      showUpload: true,
      uploadLoc: {
        latitude: Number(d.latitude.toFixed(6)),
        longitude: Number(d.longitude.toFixed(6))
      }
    })
  },

  /** 表单校验通过后入库：新树默认待认养（status normal + ownerId 空），立刻上图 */
  onUploadSubmit(e) {
    const f = e.detail
    const loc = this.data.uploadLoc || {
      latitude: this.data.center.latitude,
      longitude: this.data.center.longitude
    }
    const pos = latLngToPos(loc.latitude, loc.longitude)

    // 演示提交失败场景时取消注释（约 5% 概率失败）；默认全部成功
    // if (Math.random() < 0.05) { toast('提交失败，请稍后再试'); return }

    store.addTree({
      treeId: db.newId('t'),
      name: f.name,
      species: f.species,
      posX: pos.posX,
      posY: pos.posY,
      lat: loc.latitude,
      lng: loc.longitude,
      ownerId: '', ownerName: '', level: 0, growthScore: 0,
      status: 'normal', hazardText: '', age: f.age || '未知',
      distance: distanceMeters((this.userLoc || CAMPUS).latitude, (this.userLoc || CAMPUS).longitude, loc.latitude, loc.longitude),
      reviewStatus: 'approved',
      image: f.image,
      description: f.description,
      createdBy: store.state.user.userId
    })

    this.setData({ showUpload: false, uploadDraft: null, pickMode: false })
    this.refresh()
    toast('新增成功')
  },

  /** 空状态里点"清除筛选和搜索"：回到全部 + 清空关键词 */
  onResetView() {
    if (this.data.filter === 'all' && this.data.keyword === '') return
    this.setData({ filter: 'all', keyword: '' }, () => this.refresh())
  },

  onKeywordChange(e) {
    this.setData({ keyword: e.detail.keyword }, () => this.refresh())
  }
})
