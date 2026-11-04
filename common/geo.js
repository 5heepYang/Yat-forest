/**
 * 地理坐标工具
 *
 * 现有 Mock 数据用的是「地图相对坐标」posX / posY（0-100 的百分比），
 * 这是当初自绘地图的设计。换成原生 <map> 组件后需要真实经纬度，
 * 这里提供换算和距离计算，不需要改动已有数据结构。
 *
 * 用法：
 *   const { posToLatLng, nearbyTrees, formatDistance } = require('../../common/geo')
 *   const markers = trees.map(t => Object.assign({ id: t.treeId }, posToLatLng(t)))
 */

/**
 * 中山大学南校园中心点（GCJ02，与 <map> 组件、wx.getLocation 同一坐标系）。
 * 取值来自腾讯地图南校园点位 23.096716/113.298398；
 * 旧值 23.0975/113.2988 偏北约 110 米，会让所有树整体偏移，2026-11-03 已校准。
 */
const CAMPUS = {
  latitude: 23.096716,
  longitude: 113.298398,
  /** 相对坐标 0-100 跨度对应的经纬度范围（决定地图上点位的疏密，越大越散） */
  latSpan: 0.006,
  lngSpan: 0.006
}

/**
 * 相对坐标 -> 经纬度。
 *
 * 两种调用方式都支持，因为数据来源有两套写法：
 *   posToLatLng(tree)          // 传整个树对象
 *   posToLatLng(posX, posY)    // 传两个数字
 *
 * 返回值同时给 lat/lng（树对象里的字段名）和 latitude/longitude（<map> 组件要的名字），
 * 省掉调用处的映射代码。
 */
function posToLatLng(a, b) {
  let posX = 50
  let posY = 50

  if (a !== null && typeof a === 'object') {
    posX = Number(a.posX || 50)
    posY = Number(a.posY || 50)
  } else {
    posX = Number(a === undefined ? 50 : a)
    posY = Number(b === undefined ? 50 : b)
  }

  const lat = CAMPUS.latitude + (50 - posY) / 100 * CAMPUS.latSpan
  const lng = CAMPUS.longitude + (posX - 50) / 100 * CAMPUS.lngSpan

  return {
    lat: lat,
    lng: lng,
    latitude: lat,
    longitude: lng
  }
}

/** 经纬度 -> 相对坐标（队员在图上点一下加树时，把 tap 的经纬度转回来存） */
function latLngToPos(latitude, longitude) {
  return {
    posX: (longitude - CAMPUS.longitude) / CAMPUS.lngSpan * 100 + 50,
    posY: 50 - (latitude - CAMPUS.latitude) / CAMPUS.latSpan * 100
  }
}

/**
 * 树的经纬度。
 *
 * posX/posY 是唯一真源，树对象里存的 lat/lng 只当缓存：
 * 校园中心点校准后（CAMPUS 改过），已有数据的 posX/posY 会立刻跟着变，
 * 不用去清理云端已存的旧经纬度。只有完全没有 pos 的树才退回用 lat/lng。
 */
function treeLatLng(t) {
  if (t && t.posX !== null && t.posX !== undefined && t.posY !== null && t.posY !== undefined) {
    return posToLatLng(t)
  }
  if (t && t.lat && t.lng) {
    return { lat: t.lat, lng: t.lng, latitude: t.lat, longitude: t.lng }
  }
  return posToLatLng(t)
}

/** 两点间距离（米），Haversine */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

/**
 * 附近可认养的树
 * @param {number} lat 我的纬度
 * @param {number} lng 我的经度
 * @param {Array} trees 全部树
 * @param {number} radius 半径（米），默认 1000
 * @param {boolean} onlyUnowned 只算待认养
 */
function nearbyTrees(lat, lng, trees, radius, onlyUnowned) {
  const limit = radius || 1000
  const out = []

  trees.forEach(function (t) {
    if (onlyUnowned && t.ownerId !== '') return

    const p = treeLatLng(t)

    const d = distanceMeters(lat, lng, p.latitude, p.longitude)
    if (d <= limit) {
      out.push(Object.assign({}, t, {
        latitude: p.latitude,
        longitude: p.longitude,
        distance: d
      }))
    }
  })

  out.sort(function (a, b) { return a.distance - b.distance })
  return out
}

/** 距离文案：120m / 1.2km（拿不到有效距离时给占位符，避免页面上出现 NaN） */
function formatDistance(m) {
  const n = Number(m)
  if (!isFinite(n) || n < 0) return '—'
  if (n < 1000) return Math.round(n) + ' m'
  return (n / 1000).toFixed(1) + ' km'
}

/**
 * 把 wx.getLocation 的底层 errMsg 翻成用户能看懂的一句话。
 * 不翻译的话，页面只能拿到一串 getLocation:fail xxx，用户完全不知道该怎么办。
 */
function locFailReason(errMsg) {
  const m = String(errMsg || '')
  if (m.indexOf('requiredPrivateInfos') >= 0) return '小程序未在 app.json 声明定位接口'
  if (m.indexOf('privacy') >= 0) return '还没同意隐私协议'
  if (m.indexOf('auth deny') >= 0 || m.indexOf('authDeny') >= 0 || m.indexOf('authorize') >= 0) return '定位权限被拒绝'
  if (m.indexOf('system permission') >= 0 || m.indexOf('SYSTEM_PERMISSION') >= 0) return '手机系统的定位服务没开'
  if (m.indexOf('timeout') >= 0) return '定位超时'
  if (m.indexOf('ERROR_NOCELL') >= 0 || m.indexOf('NOLOCATION') >= 0) return '当前没有可用的定位信号'
  return '设备暂时拿不到位置'
}

/**
 * 取当前位置。失败时回退到校园中心，保证地图不白屏；
 * 同时把"为什么失败"带出去（reason 是给用户看的中文，errMsg 是给 Console 看的原文）。
 */
function getCurrentLocation() {
  return new Promise(function (resolve) {
    wx.getLocation({
      type: 'gcj02',
      // 无 GPS 时基站定位误差可达公里级，开高精度能收到百米级；
      // 3 秒内允许系统持续提高精度，超时后返回当前最优结果
      isHighAccuracy: true,
      highAccuracyExpireTime: 3000,
      success: function (res) {
        resolve({ latitude: res.latitude, longitude: res.longitude, real: true, reason: '', errMsg: '' })
      },
      fail: function (e) {
        // 测试号 / 未授权 / 未声明隐私协议 / 接口未报备时都会走这里，用校园中心兜底
        const msg = (e && e.errMsg) || ''
        console.warn('[geo] 定位失败，回退校园中心', msg)
        resolve({
          latitude: CAMPUS.latitude,
          longitude: CAMPUS.longitude,
          real: false,
          reason: locFailReason(msg),
          errMsg: msg
        })
      }
    })
  })
}

module.exports = {
  CAMPUS,
  posToLatLng,
  latLngToPos,
  treeLatLng,
  distanceMeters,
  nearbyTrees,
  formatDistance,
  getCurrentLocation,
  locFailReason
}
