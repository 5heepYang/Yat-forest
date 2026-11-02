const { loadFonts } = require('./common/font')

App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44
  },

  onLaunch() {
    // 状态栏高度：各页面的自定义导航栏需要它来做顶部留白
    let info = {}
    try {
      info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    } catch (e) {
      info = {}
    }
    this.globalData.statusBarHeight = info.statusBarHeight || 20

    loadFonts()
  }
})
