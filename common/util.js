/** 通用格式化工具 */

/** 数值转整数文本（避免出现 34.0% 这类诡异输出） */
function istr(n) {
  return Number(n || 0).toFixed(0)
}

function pct(n) {
  return Number(n || 0).toFixed(0) + '%'
}

function pxs(n) {
  return Number(n || 0).toFixed(0) + 'px'
}

/** 千分位，如 1280 -> 1,280 */
function fmt(n) {
  const s = Number(n || 0).toFixed(0)
  let out = ''
  let cnt = 0
  let i = s.length - 1
  while (i >= 0) {
    out = s.substring(i, i + 1) + out
    cnt++
    if (cnt % 3 === 0 && i > 0) {
      out = ',' + out
    }
    i--
  }
  return out
}

/** 例：11月2日 · 周一 */
function todayText() {
  const d = new Date()
  const names = ['日', '一', '二', '三', '四', '五', '六']
  const idx = d.getDay()
  return (d.getMonth() + 1).toFixed(0) + '月' + d.getDate().toFixed(0) + '日 · 周' + names[idx]
}

/** 例：2026-11-02 15:20 */
function stamp() {
  const d = new Date()
  const m = (d.getMonth() + 1).toFixed(0)
  const day = d.getDate().toFixed(0)
  const hh = d.getHours().toFixed(0)
  const mm = d.getMinutes().toFixed(0)
  const h2 = hh.length < 2 ? '0' + hh : hh
  const m2 = mm.length < 2 ? '0' + mm : mm
  return d.getFullYear().toFixed(0) + '-' + m + '-' + day + ' ' + h2 + ':' + m2
}

/**
 * 把云存储 fileID（cloud://...）换成公网可读的临时 https 链接，视觉模型只认这种地址。
 * 非 cloud:// 的地址原样返回；取不到就返回空串（调用方自行降级）。
 */
function toPublicUrl(url) {
  return new Promise(function (resolve) {
    const s = String(url || '')
    if (s.indexOf('cloud://') !== 0) {
      resolve(s)
      return
    }
    if (!wx.cloud || !wx.cloud.getTempFileURL) {
      viaCloudFunction(s, resolve)
      return
    }
    wx.cloud.getTempFileURL({
      fileList: [s],
      success: function (res) {
        const f = res.fileList && res.fileList[0]
        if (f && f.tempFileURL) {
          resolve(f.tempFileURL)
          return
        }
        // 云存储权限是"仅创建者可读写"时，别人的文件客户端取不到，
        // 让云函数以管理员身份代取（actions.getTempUrl）
        viaCloudFunction(s, resolve)
      },
      fail: function () {
        viaCloudFunction(s, resolve)
      }
    })
  })
}

/** 兜底：让 actions 云函数代取临时链接；云函数不可用就给空串让调用方降级 */
function viaCloudFunction(fileID, resolve) {
  if (!wx.cloud || !wx.cloud.callFunction) {
    resolve('')
    return
  }
  wx.cloud.callFunction({
    name: 'actions',
    data: { action: 'getTempUrl', payload: { fileID: fileID } }
  }).then(function (res) {
    const r = (res && res.result) || {}
    resolve(r.ok && r.url ? r.url : '')
  }).catch(function () {
    resolve('')
  })
}

/**
 * 把 cloud:// 换成 <image> 能直接用的 https 地址（带 90 分钟缓存）。
 * 云存储权限受限时由 actions 云函数代取，所以即使权限没放开，别人的图也能显示。
 */
const urlCache = {}
function resolveCloudUrl(url) {
  const s = String(url || '')
  if (s.indexOf('cloud://') !== 0) return Promise.resolve(s)
  const hit = urlCache[s]
  if (hit && hit.expire > Date.now()) return Promise.resolve(hit.url)
  return toPublicUrl(s).then(function (u) {
    if (u && u.indexOf('http') === 0) {
      urlCache[s] = { url: u, expire: Date.now() + 90 * 60 * 1000 }
      return u
    }
    return s
  })
}

function toast(msg) {
  wx.showToast({
    title: msg,
    icon: 'none',
    duration: 1800
  })
}

/* ------------------------------------------------------------------ */
/* tab 页常驻 + 切页入场动画                                             */
/* switchTab 不销毁页面，切回时第一帧用的是上次离开时的 data；若等 onShow */
/* 才挂动画类，会先正常显示一帧、再跳到动画起点（用户看到的一帧跳变）。   */
/* 做法：点 tabBar 时先给目标页预置「暂停在 0% 帧」的动画类，切回首帧就是 */
/* 动画起点，onShow 只负责解除暂停；类名交替两套等价 keyframes，保证重放。 */
/* ------------------------------------------------------------------ */
const TAB_PAGES = {}

/** Node 测试环境没有 getApp：纯 UI 辅助函数统一兜底，不在测试里抛错 */
function globalData() {
  try {
    if (typeof getApp !== 'function') return {}
    const app = getApp()
    return (app && app.globalData) || {}
  } catch (e) {
    return {}
  }
}

/** seq 奇数/偶数交替两套等价关键帧：computed animation 变化才会重放动画 */
function animClass(dir, seq) {
  const n = seq % 2 === 1 ? '1' : '2'
  if (dir === 'right') return 'page-anim-right-' + n
  if (dir === 'left') return 'page-anim-left-' + n
  return 'page-anim-fade-' + n
}

/** 地图页含原生 map 组件：根节点 transform 会让原生层错位/闪烁，只做淡入 */
function animDir(key, dir) {
  return key === 'map' ? '' : (dir || '')
}

/** tabBar 点击前预置目标页动画；目标页实例还不存在时返回 false，由 onLoad 预置兜底。
 *  cb 会在预置真正落到渲染层之后回调——必须等这一步再 switchTab，
 *  否则切过去的第一帧仍按旧状态渲染（用户看到的“重复一帧”）。 */
function armTabAnim(key, dir, cb) {
  const page = TAB_PAGES[key]
  if (!page || !page.setData) return false
  page._animSeq = (page._animSeq || 0) + 1
  try {
    page.setData({ navAnim: 'page-anim-paused ' + animClass(animDir(key, dir), page._animSeq) }, function () {
      if (cb) cb()
    })
  } catch (e) {
    // 页面实例可能已经销毁（退出登录等 reLaunch）：丢掉旧引用，交给目标页 onLoad 兜底
    delete TAB_PAGES[key]
    return false
  }
  return true
}

/** 退出登录等 reLaunch 场景：页面实例会销毁，清空注册表避免对已销毁页面 setData */
function clearTabPages() {
  Object.keys(TAB_PAGES).forEach(function (k) {
    delete TAB_PAGES[k]
  })
}

/** 页面 onShow 第一条调用：注册 tab 页实例 + 播放入场动画 */
function pageEnter(page, key) {
  if (key) TAB_PAGES[key] = page
  const g = globalData()
  const dir = animDir(key, g.tabAnim || '')
  if (g.tabAnim) g.tabAnim = ''
  const cur = page.data.navAnim || ''
  // tabBar 已经预置了暂停态：首帧就是动画起点，这里只解除暂停让它播完
  if (cur.indexOf('page-anim-paused') >= 0) {
    const next = cur.replace('page-anim-paused', '').trim()
    if (next) {
      page.setData({ navAnim: next })
      return
    }
  }
  // 已有入场动画（onLoad 预置的首进动画 / 刚播完的上一轮）：不重放。
  // 副作用是好的：从后台切回前台时页面不再无端再动一次。
  if (cur) return
  page._animSeq = (page._animSeq || 0) + 1
  page.setData({ navAnim: animClass(dir, page._animSeq) })
}

/** tab 页 onLoad 第一条调用：页面首次创建时预置入场动画。
 *  onLoad 的 setData 一定发生在首帧渲染之前，首帧即动画起点，
 *  堵住“首次进入该页先静止一帧、onShow 才开始播”的跳变。 */
function pagePreset(page, key) {
  const g = globalData()
  const dir = animDir(key, g.tabAnim || '')
  if (g.tabAnim) g.tabAnim = ''
  page._animSeq = (page._animSeq || 0) + 1
  page.setData({ navAnim: animClass(dir, page._animSeq) })
}

/** 非 tabBar 触发的 switchTab（看认养人、认养成功跳林地等）：
 *  同样先预置动画；页面还没创建时把方向存进 globalData，供目标页 onLoad 预置 */
function switchTabAnim(path, key, dir) {
  const g = globalData()
  if (g) g.tabAnim = dir || ''
  let jumped = false
  const jump = function () {
    if (jumped) return
    jumped = true
    wx.switchTab({ url: path })
  }
  if (!armTabAnim(key, dir || '', jump)) jump()
  else setTimeout(jump, 120) // 后台页 setData 回调延迟时的兜底，jump 自带去重
}

/**
 * 弹层打开/关闭时隐藏/显示自定义 tabBar。
 * 自定义 tabBar 由框架渲染在页面之上（页面内 z-index 盖不住），
 * 弹层底部按钮会被挡，所以弹层期间直接隐藏。
 */
function setTabBarHidden(page, hidden) {
  const tb = page && page.getTabBar && page.getTabBar()
  if (tb && tb.setData) {
    tb.setData({ hidden: !!hidden })
  }
}

module.exports = { istr, pct, pxs, fmt, todayText, stamp, toast, toPublicUrl, resolveCloudUrl, pageEnter, pagePreset, armTabAnim, switchTabAnim, clearTabPages, setTabBarHidden }
