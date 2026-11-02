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

/** 中山大学南校园的近似中心点。队员 A 实地采点时可以用 wx.getLocation 校准后改这里。 */
const CAMPUS = {
  latitude: 23.0975,
  longitude: 113.2988,
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

    // 树对象里已经存了 lat/lng 就直接用，没有才换算
    const p = (t.lat && t.lng)
      ? { latitude: t.lat, longitude: t.lng }
      : posToLatLng(t)

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

/** 距离文案：120m / 1.2km */
function formatDistance(m) {
  if (m < 1000) return m + ' m'
  return (m / 1000).toFixed(1) + ' km'
}

/** 取当前位置。失败时回退到校园中心，保证地图不白屏。 */
function getCurrentLocation() {
  return new Promise(function (resolve) {
    wx.getLocation({
      type: 'gcj02',
      success: function (res) {
        resolve({ latitude: res.latitude, longitude: res.longitude, real: true })
      },
      fail: function (e) {
        // 测试号 / 未授权 / 未声明隐私协议时走这里，用校园中心兜底
        console.warn('[geo] 定位失败，回退校园中心', e && e.errMsg)
        resolve({
          latitude: CAMPUS.latitude,
          longitude: CAMPUS.longitude,
          real: false
        })
      }
    })
  })
}

module.exports = {
  CAMPUS,
  posToLatLng,
  latLngToPos,
  distanceMeters,
  nearbyTrees,
  formatDistance,
  getCurrentLocation
}
