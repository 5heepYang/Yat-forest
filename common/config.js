/**
 * 全局配置
 *
 * 这里的值都是"需要人决定、但不适合散落在页面里"的东西。
 */

/**
 * 演示数据管理员名单。
 *
 * 人工审核取消后（新增树由 AI 识别后直接上架），这份名单只剩一个用途：
 * 决定谁能在个人页看到「重置演示数据」。
 *
 * 注意：这里只控制界面显隐，不构成权限。真正的白名单校验在
 * cloudfunctions/actions/index.js 的 resetDemoData 里（服务端常量 ADMIN_IDS），
 * 两边要一起改。
 */
const ADMIN_IDS = ['u_001']

/**
 * 拍照提醒的订阅消息模板 ID（小程序后台 → 订阅消息 → 我的模板）。
 *
 * 当前模板：「日程提醒」（编号 571），字段如下，改模板时两边必须一起改：
 *   thing2  提醒内容
 *   date4   日程时间
 *   thing11 备注
 */
const SUBSCRIBE_TEMPLATE_ID = 'rK51LC7yeND1qD9Pqy69EB1ZpLC5NH021ELBVZooF_I'

/** 构建标记：改代码后手动更新。真机上据此判断跑的是不是最新版本 */
const BUILD_TAG = 'v20261104-1502'

module.exports = {
  ADMIN_IDS,
  SUBSCRIBE_TEMPLATE_ID,
  BUILD_TAG
}
