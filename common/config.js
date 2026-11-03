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
 * 拍照提醒的订阅消息模板 ID。
 * 留空 = 不申请订阅、不推送（页面内的周期提示仍然生效）。
 * 申请方式：小程序后台 → 订阅消息 → 选用「待办事项提醒」类模板，
 * 把模板 ID 填在这里，并把字段名对齐 cloudfunctions/notify/index.js 里的 data。
 */
const SUBSCRIBE_TEMPLATE_ID = ''

module.exports = {
  ADMIN_IDS,
  SUBSCRIBE_TEMPLATE_ID
}
