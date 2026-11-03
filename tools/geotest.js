/**
 * 地理坐标工具回归测试（纯函数，不依赖 wx）
 *
 * 用法：在小程序根目录执行  node tools/geotest.js
 */

const geo = require('../common/geo.js')
const { mockTrees } = require('../common/mock.js')

let pass = 0
let failCount = 0
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label) }
  else { failCount++; console.log('  FAIL  ' + label + '  ' + (detail == null ? '' : detail)) }
}

console.log('===== 校园中心 =====')
const c = geo.CAMPUS
check('中心点是南校园 GCJ02 坐标', Math.abs(c.latitude - 23.096716) < 1e-6 && Math.abs(c.longitude - 113.298398) < 1e-6,
  c.latitude + ',' + c.longitude)

const center = geo.posToLatLng(50, 50)
check('相对坐标 (50,50) 正好是中心点', center.latitude === c.latitude && center.longitude === c.longitude)

const old = geo.distanceMeters(23.0975, 113.2988, c.latitude, c.longitude)
check('旧中心点与新中心点相距约 110 米', old > 80 && old < 150, old + ' m')

console.log('===== 坐标换算可逆 =====')
const back = geo.latLngToPos(center.latitude, center.longitude)
check('经纬度 -> 相对坐标 往返一致', Math.abs(back.posX - 50) < 1e-6 && Math.abs(back.posY - 50) < 1e-6,
  JSON.stringify(back))
const far = geo.posToLatLng(90, 10)
const farBack = geo.latLngToPos(far.latitude, far.longitude)
check('边缘点位往返一致', Math.abs(farBack.posX - 90) < 1e-6 && Math.abs(farBack.posY - 10) < 1e-6,
  JSON.stringify(farBack))

console.log('===== 树坐标以 posX/posY 为准 =====')
const tree = { posX: 70, posY: 30, lat: 1, lng: 2 }   // 故意塞入错误缓存
const p = geo.treeLatLng(tree)
const expected = geo.posToLatLng(70, 30)
check('有 pos 时忽略已存的 lat/lng', p.latitude === expected.latitude && p.longitude === expected.longitude,
  p.latitude + ',' + p.longitude)
const noPos = geo.treeLatLng({ lat: 23.1, lng: 113.3 })
check('没有 pos 时退回 lat/lng', noPos.latitude === 23.1 && noPos.longitude === 113.3)

console.log('===== 距离与附近筛选 =====')
const trees = mockTrees()
check('种子树数量 12 棵', trees.length === 12, trees.length)
const near = geo.nearbyTrees(c.latitude, c.longitude, trees, 500, false)
check('中心点 500 米内有树', near.length > 0, near.length + ' 棵')
check('结果按距离升序', (function () {
  for (let i = 1; i < near.length; i++) if (near[i - 1].distance > near[i].distance) return false
  return true
})())
const onlyFree = geo.nearbyTrees(c.latitude, c.longitude, trees, 5000, true)
check('只筛待认养时结果都有 ownerId 为空', onlyFree.every(function (t) { return t.ownerId === '' }),
  onlyFree.length + ' 棵')
check('距离文案', geo.formatDistance(120) === '120 m' && geo.formatDistance(1200) === '1.2 km')

console.log('===== 失败原因翻译 =====')
check('接口未报备', geo.locFailReason('getLocation:fail the api need to be declared in the requiredPrivateInfos field') === '小程序未在 app.json 声明定位接口')
check('拒绝授权', geo.locFailReason('getLocation:fail auth deny') === '定位权限被拒绝')
check('隐私未同意', geo.locFailReason('getLocation:fail privacy permission is not authorized') === '还没同意隐私协议')
check('系统定位关闭', geo.locFailReason('getLocation:fail system permission denied') === '手机系统的定位服务没开')
check('未知原因兜底', geo.locFailReason('getLocation:fail something weird') === '设备暂时拿不到位置')

console.log('\n结果：' + pass + ' 通过 / ' + failCount + ' 失败')
process.exit(failCount === 0 ? 0 : 1)
