/**
 * 登录态（纯本地标记）
 *
 * 身份由微信 openid 静默承担：云端模式下云开发自动按 _openid 隔离个人数据
 * （users/tasks/tree_logs/records 每人一份，查不到就静默注册），本地模式
 * （测试号）是本机单账号。这里只记一个"走过登录页"的标记，
 * 登录页用它守门、个人页退出登录时清掉。
 */
const KEY = 'ec_login_v1'
const RESET_KEY = 'ec_reset_v1'

function isLoggedIn() {
  try {
    return !!wx.getStorageSync(KEY)
  } catch (e) {
    return false
  }
}

function markLoggedIn() {
  try {
    wx.setStorageSync(KEY, { ts: Date.now() })
  } catch (e) {
    console.warn('[auth] 写登录标记失败', e)
  }
}

function clearLogin() {
  try {
    wx.removeStorageSync(KEY)
  } catch (e) {
    console.warn('[auth] 清登录标记失败', e)
  }
}

/**
 * 本地模式的"演示数据重置"只做一次（这台设备第一次登录）。
 * 之后退出再登录不重置——退出弹窗承诺了"护林档案不会丢"，不能自己打脸。
 */
function needFreshReset() {
  try {
    return !wx.getStorageSync(RESET_KEY)
  } catch (e) {
    return false
  }
}

function markResetDone() {
  try {
    wx.setStorageSync(RESET_KEY, { ts: Date.now() })
  } catch (e) {
    console.warn('[auth] 写重置标记失败', e)
  }
}

module.exports = { isLoggedIn, markLoggedIn, clearLogin, needFreshReset, markResetDone }
