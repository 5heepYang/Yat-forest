// 自定义 tabBar：四个 Tab 常驻（switchTab 不销毁页面），切页零白屏。
// 选中态由当前页面路由反推，页面 onShow 里也会通过 getTabBar() 再同步一次（双保险）。
// 切页方向写入 globalData.tabAnim，目标页 onShow 时由 common/util.js 的 pageEnter 消费并播放入场动画。
const ORDER = ['map', 'task', 'tree', 'me']
const { armTabAnim } = require('../common/util')

Component({
  data: {
    active: 'map',
    // 弹层打开时页面调用 store/util 的 setTabBarHidden 置 true，
    // 因为自定义 tabBar 在框架层，页面内弹层的 z-index 盖不住它
    hidden: false,
    tabs: [
      {
        key: 'map', label: '地图',
        icon: '/static/tabbar/map.png', iconOn: '/static/tabbar/map-on.png',
        path: '/pages/map/map'
      },
      {
        key: 'task', label: '日程',
        icon: '/static/tabbar/task.png', iconOn: '/static/tabbar/task-on.png',
        path: '/pages/task/task'
      },
      {
        key: 'tree', label: '林地',
        icon: '/static/tabbar/tree.png', iconOn: '/static/tabbar/tree-on.png',
        path: '/pages/tree/tree'
      },
      {
        key: 'me', label: '我的',
        icon: '/static/tabbar/me.png', iconOn: '/static/tabbar/me-on.png',
        path: '/pages/honor/honor'
      }
    ]
  },

  lifetimes: {
    attached() {
      this.syncActive()
    }
  },

  pageLifetimes: {
    show() {
      this.syncActive()
      // tabBar 显隐由各页 onShow 按 sheetMode 决定（弹层开着要保持隐藏），这里不重置
    }
  },

  methods: {
    // 按页面栈顶路由反推当前 Tab，避免四个页面各自维护一份选中态
    syncActive() {
      let pages = []
      try {
        pages = getCurrentPages() || []
      } catch (e) {
        pages = []
      }
      const cur = pages.length ? pages[pages.length - 1] : null
      const route = (cur && cur.route) || ''
      const tabs = this.data.tabs
      let key = ''
      let i = 0
      while (i < tabs.length) {
        if (tabs[i].path === '/' + route) {
          key = tabs[i].key
          break
        }
        i++
      }
      if (key !== '' && key !== this.data.active) {
        this.setData({ active: key })
      }
    },

    go(e) {
      const key = e.currentTarget.dataset.key
      const path = e.currentTarget.dataset.path
      if (key === this.data.active) {
        return
      }
      const from = ORDER.indexOf(this.data.active)
      const to = ORDER.indexOf(key)
      const dir = (from >= 0 && to >= 0 && to > from) ? 'right' : 'left'
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.tabAnim = dir
      }
      // 关键：切页前先给目标页预置「暂停在 0% 帧」的入场动画。
      // 页面常驻，switchTab 后第一帧用的是旧 data；预置后首帧即动画起点，
      // 不会再出现「先完整显示一帧、再跳到动画起点」的一帧跳变。
      armTabAnim(key, dir)
      const prev = this.data.active
      // 先切选中态再跳转：switchTab 后页面不会重建，视觉上更跟手
      this.setData({ active: key })
      wx.switchTab({
        url: path,
        fail: () => {
          // 跳转失败（如路由未注册）把选中态还原，避免 tabBar 与实际页面不一致
          this.setData({ active: prev })
        }
      })
    }
  }
})