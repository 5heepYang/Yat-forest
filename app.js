const { loadFonts } = require('./common/font')

App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 页面切换方向（'right' / 'left'），由 custom-tab-bar 写入、目标页 onShow 消费
    tabAnim: '',
    // 访客档案 userId：地图页写入、「我的」页 onShow 消费（tab 页不能带参数）
    visUserId: ''
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
