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

module.exports = { istr, pct, pxs, fmt, todayText, stamp, toast, toPublicUrl, resolveCloudUrl }
