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

/* ------------------------------------------------------------------ */
/* 树种插画：九个种子树种都得有专属图，任何生僻种都不能退回椰子树      */
/* ------------------------------------------------------------------ */

const { speciesArt, speciesSlug } = require(path.join(root, 'common', 'speciesArt'))

// 种子树实际用到的树种（common/mock.js），每一个都必须命中专属插画
const SEED_SPECIES = ['大王椰子', '细叶榕', '香樟', '白玉兰', '水杉', '柠檬桉', '木棉', '小叶榄仁']
const artMissing = []
SEED_SPECIES.forEach(function (sp) {
  const p = path.join(root, speciesArt(sp).replace(/^\//, ''))
  if (!fs.existsSync(p)) artMissing.push(sp + ' → ' + speciesArt(sp) + '（文件不存在）')
  if (speciesSlug(sp) === 'generic-tree') artMissing.push(sp + ' 退回了通用图')
})
console.log('\n  ' + (artMissing.length === 0 ? 'OK  ' : 'FAIL') + '  八个种子树种都有专属插画' +
  (artMissing.length ? '  ' + artMissing.join('; ') : ''))
if (artMissing.length) failed++
else ok++

// 生僻树种走形态族 / 通用兜底，绝不能落到 coconut-palm（老 bug 就是全员椰子）
const oddCases = ['银杏', '罗汉松', '蓝花楹', '不知名的树', '未识别', '']
const oddBad = oddCases.filter(function (sp) { return speciesSlug(sp) === 'coconut-palm' })
console.log('  ' + (oddBad.length === 0 ? 'OK  ' : 'FAIL') + '  生僻树种不会退回椰子树' +
  (oddBad.length ? '  ' + oddBad.join(', ') : ''))
if (oddBad.length) failed++
else ok++

// 每张插画都得真存在（拼错文件名在真机上就是一块空白）
const allSlugs = ['coconut-palm', 'banyan', 'camphor', 'magnolia', 'dawn-redwood', 'lemon-gum', 'kapok', 'sea-almond', 'generic-tree']
const lostFiles = allSlugs.filter(function (s) {
  return !fs.existsSync(path.join(root, 'static', 'illus', 'species', s + '.png'))
})
console.log('  ' + (lostFiles.length === 0 ? 'OK  ' : 'FAIL') + '  九张树种插画文件都在' +
  (lostFiles.length ? '  缺：' + lostFiles.join(', ') : ''))
if (lostFiles.length) failed++
else ok++

// 历史数据把占位图写进了 trees.image，不能当成实拍照片（否则封面又是椰子树）
const { treeCover } = require(path.join(root, 'common', 'speciesArt'))
const legacyOk = treeCover({ species: '香樟', image: '/static/illus/palm.png' }).indexOf('camphor.png') > 0
const photoOk = treeCover({ species: '香樟', image: 'cloud://env.bucket/tree_photos/a.jpg' }).indexOf('cloud://') === 0
console.log('  ' + (legacyOk && photoOk ? 'OK  ' : 'FAIL') + '  占位图让位给树种插画、真实照片优先')
if (legacyOk && photoOk) ok++
else failed++

console.log('\n加载：' + ok + ' 成功 / ' + failed + ' 失败；注册页面 ' + calls.page.length + ' 个、组件 ' + calls.component.length + ' 个')
process.exit(failed === 0 ? 0 : 1)
