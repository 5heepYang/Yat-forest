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

function toast(msg) {
  wx.showToast({
    title: msg,
    icon: 'none',
    duration: 1800
  })
}

module.exports = { istr, pct, pxs, fmt, todayText, stamp, toast }
