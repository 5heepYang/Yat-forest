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
    statusBarHeight: 20,
    // 右上角留给微信胶囊（··· ○）的避让距离：不避让的话页面右上角按钮会被胶囊压住
    rightPad: 20
  },

  lifetimes: {
    attached() {
      const g = (app && app.globalData) || {}
      const patch = {
        statusBarHeight: g.statusBarHeight || 20,
        rightPad: 20
      }
      // 自定义导航栏不会自动给胶囊留位置：算一下胶囊左边界到屏幕右边的距离
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const rect = wx.getMenuButtonBoundingClientRect()
        const winW = (info && info.windowWidth) || 0
        if (winW > 0 && rect && rect.left > 0) {
          // nav 自身右内边距是 20px，这里只补「胶囊左边距 + 8px 间距 - 20px」
          patch.rightPad = Math.max(0, winW - rect.left + 8 - 20)
        }
      } catch (e) {
        patch.rightPad = 20
      }
      this.setData(patch)
    }
  }
})
