/**
 * 页面加载冒烟测试
 *
 * 用法：在小程序根目录执行  node tools/smoketest.js
 *
 * 把 wx / Page / Component / getApp 打成假桩，逐个 require 页面与组件，
 * 用来抓"改了 import 或顶层代码后页面加载就报错"这类问题。
 * 不执行任何生命周期，只验证模块能被加载、依赖能解析。
 */

const calls = { page: [], component: [] }

const noop = function () {}
const memStorage = {}

global.wx = {
  getAccountInfoSync() { return { miniProgram: { appId: 'touristappid' } } },
  getStorageSync(k) { return memStorage[k] },
  setStorageSync(k, v) { memStorage[k] = v },
  getWindowInfo() { return { statusBarHeight: 20 } },
  getSystemInfoSync() { return { statusBarHeight: 20, platform: 'devtools' } },
  createMapContext() { return { moveToLocation: noop, getCenterLocation: noop } },
  showToast: noop,
  showModal: noop,
  showLoading: noop,
  hideLoading: noop,
  navigateTo: noop,
  navigateBack: noop,
  reLaunch: noop,
  switchTab: noop,
  openSetting: noop,
  chooseMedia: noop,
  requestSubscribeMessage: noop,
  loadFontFace: noop,
  getFileSystemManager() { return { readFile: noop } },
  cloud: undefined
}

global.Page = function (cfg) { calls.page.push(cfg) }
global.Component = function (cfg) { calls.component.push(cfg) }
global.getApp = function () { return { globalData: { statusBarHeight: 20, navBarHeight: 44 } } }
global.App = function () {}

const fs = require('fs')
const path = require('path')

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') return
      walk(p, out)
    } else if (e.name.endsWith('.js')) {
      out.push(p)
    }
  })
  return out
}

const root = path.join(__dirname, '..')
const targets = []
walk(path.join(root, 'pages'), targets)
walk(path.join(root, 'components'), targets)
targets.push(path.join(root, 'app.js'))

let ok = 0
let failed = 0
targets.forEach(function (f) {
  const rel = path.relative(root, f)
  try {
    require(f)
    ok++
    console.log('  OK    ' + rel)
  } catch (e) {
    failed++
    console.log('  FAIL  ' + rel + '  ' + (e && e.message))
  }
})

console.log('\n加载：' + ok + ' 成功 / ' + failed + ' 失败；注册页面 ' + calls.page.length + ' 个、组件 ' + calls.component.length + ' 个')
process.exit(failed === 0 ? 0 : 1)
