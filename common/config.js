/**
 * 全局配置
 *
 * 这里的值都是"需要人决定、但不适合散落在页面里"的东西。
 */

/**
 * 管理员名单：能审核新增树木的人。
 * 目前是种子队长账号 u_001；队伍里换人时把 userId 加进来即可。
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

module.exports = {
  ADMIN_IDS,
  SUBSCRIBE_TEMPLATE_ID
}
