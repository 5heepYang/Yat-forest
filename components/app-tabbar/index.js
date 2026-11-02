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
      wx.reLaunch({ url: path })
    }
  }
})
