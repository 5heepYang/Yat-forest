/**
 * 字体加载：替代原 App.uvue 里的 uni.loadFontFace
 * Regular / Bold 分别注册为两个 family，页面里用 font-family: HYSans / HYSansBold 引用。
 */
function loadFonts() {
  const fonts = [
    { family: 'HYSans', source: 'url("/static/fonts/hy-regular.ttf")' },
    { family: 'HYSansBold', source: 'url("/static/fonts/hy-bold.ttf")' }
  ]

  fonts.forEach(function (f) {
    wx.loadFontFace({
      global: true,
      family: f.family,
      source: f.source,
      success: function () {
        console.log('font ok ' + f.family)
      },
      fail: function (e) {
        console.log('font fail ' + f.family, e && e.errMsg)
      }
    })
  })
}

module.exports = { loadFonts: loadFonts }
