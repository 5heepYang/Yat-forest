const app = getApp()

Component({
  options: {
    // 让页面的 .icon-btn 等样式可以作用到 slot 内容上
    styleIsolation: 'apply-shared'
  },

  properties: {
    title: {
      type: String,
      value: ''
    },
    subtitle: {
      type: String,
      value: ''
    }
  },

  data: {
    statusBarHeight: 20
  },

  lifetimes: {
    attached() {
      const g = (app && app.globalData) || {}
      this.setData({
        statusBarHeight: g.statusBarHeight || 20
      })
    }
  }
})
