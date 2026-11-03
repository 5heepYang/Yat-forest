/**
 * 地图页数据服务
 *
 * 页面不直接碰 store 的内部结构，统一从这里取数。
 * 当前数据源是 common/store（内存状态 + 自动落库，测试号读本地），
 * 后续切换云开发 / HTTP 接口时只需改这个文件，页面代码不动。
 */
const store = require('../../../common/store')

/**
 * 获取全部树木点位。
 * 等数据层就绪后再返回，避免页面先闪一遍内置种子数据。
 * @returns {Promise<Array>} Tree 数组（字段同云端 trees 集合）
 */
async function getTrees() {
  await store.ready()
  return store.state.trees
}

module.exports = {
  getTrees
}
