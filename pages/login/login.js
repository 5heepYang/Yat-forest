const store = require('../../common/store')
const db = require('../../common/db')
const auth = require('../../common/auth')

Page({
  data: {
    statusBarHeight: 20,
    entering: false
  },

  onLoad() {
    const app = getApp()
    const g = (app && app.globalData) || {}
    this.setData({ statusBarHeight: g.statusBarHeight || 20 })

    // 已登录的老用户直接进首页，登录页只拦新用户和退出登录的人
    if (auth.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/map/map' })
    }
  },

  /**
   * 微信一键登录：点一下就进。
   * 身份由微信 openid 静默承担——云端模式云开发自动按 _openid 建档并隔离数据，
   * 别人进来就是新账号，互不可见；wx.login 只走一遍官方门面，失败也不拦人。
   */
  onWxLogin() {
    if (this.data.entering) return
    this.setData({ entering: true })

    wx.login({
      complete: function () {
        store.ready().then(function () {
          // 本地模式（测试号没有 openid）：这台设备第一次登录时，
          // 把内置演示账号重置成干净新号，只做一次
          if (db.getMode() === db.MODE_LOCAL && auth.needFreshReset()) {
            store.resetForNewUser()
            auth.markResetDone()
          }
          auth.markLoggedIn()
          wx.reLaunch({ url: '/pages/map/map' })
        })
      }
    })
  }
})
