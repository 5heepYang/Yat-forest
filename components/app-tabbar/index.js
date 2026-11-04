Component({
  properties: {
    active: {
      type: String,
      value: ''
    }
  },

  data: {
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

  methods: {
    go(e) {
      const key = e.currentTarget.dataset.key
      const path = e.currentTarget.dataset.path
      if (key === this.data.active) {
        return
      }
      // 记录切页方向：目标页 onShow 时播放入场动画（左移就左进、右移就右进）
      const order = ['map', 'task', 'tree', 'me']
      const from = order.indexOf(this.data.active)
      const to = order.indexOf(key)
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.tabAnim = (from >= 0 && to >= 0 && to > from) ? 'right' : 'left'
      }
      wx.reLaunch({ url: path })
    }
  }
})
