# 数据契约 v1.1

> 本文件是四人并行开发的**唯一依据**。任何新增字段、改名、改类型，先改这里，再改代码。
> 字段名一旦定下就不要动，合并冲突 90% 来自命名不一致。

---

## 一、数据存在哪（不用管，但要知道）

`common/db.js` 屏蔽了存储差异，**页面和 store 都不用写数据库代码**：

| 你的环境 | 底层实现 | 效果 |
| --- | --- | --- |
| 测试号（`touristappid`） | `wx.setStorageSync` | 增删改查全可用，数据存在你的开发者工具里，重启不丢 |
| 正式 AppID + 云开发已开通 | `wx.cloud.database()` | 数据进云端，多人共享 |

业务代码永远只调 `store.xxx()` 和 `db.uploadImage()`，**不要自己写 `wx.cloud`**——测试号下会直接报错白屏。

---

## 二、集合与字段

六个集合，字段全部小驼峰。`_id` 由数据库托管，业务代码不碰。

### users（用户）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userId` | string | 业务主键，如 `u_001` |
| `nickname` | string | 昵称。微信已不开放真实昵称，让用户自己填 |
| `avatar` | string | 头像地址（图片地址或云存储 fileID） |
| `bio` | string | 个人签名，个人主页展示 |
| `availablePoints` | number | **碳积分**，日程页赚，认养/浇水/施肥花 |
| `coins` | number | **护林币**，林地页赚，补给站花 |
| `totalGrowthScore` | number | 累计成长值，排行榜用 |
| `badgeCount` | number | 勋章数 |
| `days` | number | 护林天数 |

### trees（校园树木）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `treeId` | string | 业务主键 |
| `name` | string | 树名，如「逸仙大道08号 · 大王椰」 |
| `species` | string | 树种 |
| `age` | string | 树龄文案，如「26 年」 |
| `posX` / `posY` | number | 相对坐标 0-100（旧自绘地图用，保留兼容） |
| `lat` / `lng` | number | **真实经纬度**，地图组件用这个 |
| `image` | string | 实拍图地址 |
| `ownerId` | string | 认养人 userId，空串 = 待认养 |
| `ownerName` | string | 认养人昵称（冗余，列表免查询） |
| `level` | number | 等级 0-4 |
| `growthScore` | number | 成长值，满 1000 升 4 级 |
| `status` | string | 见下表，**枚举值不能自创** |
| `hazardText` | string | 隐患描述 |
| `reviewStatus` | string | `pending` / `approved` / `rejected`，人工审核用 |
| `createdBy` | string | 提交人 userId（用户在地图上新增的树） |

`status` 枚举：

| 值 | 含义 | 地图上显示 |
| --- | --- | --- |
| `normal` | 正常（可认养 / 已认养） | ✅ 按归属着色 |
| `hazard` | 有隐患，暂不可认养 | ✅ 红色感叹号 |
| `pending` | 刚提交，等审核 | ❌ 不显示（配合 `reviewStatus`） |
| `rejected` | 审核驳回 | ❌ 不显示 |

> 用户在地图上新增的树：`status: 'normal'` + `reviewStatus: 'pending'`。
> 地图渲染时过滤 `reviewStatus !== 'approved'` 的点位。

### tasks（日程任务）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `taskId` | string | 业务主键 |
| `userId` | string | 归属用户 |
| `date` | string | 日期 `2026-11-02`，跨天要重开一批任务 |
| `slot` | string | 时间段 `08:00` |
| `title` | string | 事项，如「搭公交去教学楼」 |
| `desc` | string | AI 给出的低碳实现方式 |
| `basePoints` | number | 完成得多少**碳积分** |
| `coinReward` | number | 完成得多少**护林币**（新增，可先不填） |
| `done` | boolean | 是否已核验通过 |
| `carbonSavedG` | number | 本次减碳克数 |
| `aiComment` | string | AI 评语 |
| `proofImage` | string | 凭证图片地址 |
| `reviewStatus` | string | `''` 未提交 / `pending` 待审 / `approved` / `rejected` |
| `type` | string | `once` / `daily` / `weekly`，任务系统用 |
| `repeatDays` | number | 周期天数（`weekly` 时用，如 7） |
| `createdAt` | string | 创建时间 |

### tree_logs（生长实拍 / 隐患工单）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `logId` | string | 业务主键 |
| `treeId` | string | 关联的树 |
| `kind` | string | `growth`（实拍）/ `hazard`（隐患） |
| `imageUrl` | string | 图片地址 |
| `description` | string | 描述 |
| `aiAnalysis` | string | AI 分析结论 |
| `rewardPoints` | number | 奖励碳积分 |
| `coinReward` | number | 奖励护林币（新增，可先不填） |
| `reviewStatus` | string | `pending` / `approved` / `rejected` |
| `createdAt` | string | 时间 |

### goods（纪念品）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `itemId` | string | 业务主键 |
| `name` | string | 名称 |
| `costCurrency` | number | 消耗**护林币**（即 `user.coins`） |
| `stock` | number | 库存 |
| `image` | string | 图片 |
| `desc` | string | 描述 |

### records（兑换记录）

目前是**字符串数组**，格式 `商品名 · 凭证码`，如 `中大古树帆布袋 · SYSU-483920`。

显示时只需要次数就直接用 `state.records.length`。要做记录列表再升级成对象：

```js
{ recordId, userId, itemId, itemName, code, costCurrency, createdAt }
```

升级时同步改 `store.exchange()` 和本文件，别只改一半。

---

## 三、接口清单

### 读（`common/store.js`，全部同步）

```js
const store = require('../../common/store')

store.state                  // 全量状态：user / trees / tasks / logs / goods / records
store.myTree()               // 我认养的那棵树
store.treeById(id)           // 按 id 找树
store.myTreeCount()          // 我认养了几棵
store.unownedCount()         // 待认养数量
store.todayPoints()          // 今日已得碳积分
store.todayCarbon()          // 今日已减碳克数
store.doneCount()            // 今日完成任务数
store.progressPct()          // 今日目标完成百分比（0-100，已截断）
```

### 写（`common/store.js`，全部同步，内部自动落库）

```js
store.adoptTree(id)                    // 认养，返回 '' 成功 / 错误文案
store.water()                          // 浇水，同上
store.fertilize()                      // 施肥，同上
store.completeTask(id, carbon, cmt)    // 完成任务，同上
store.addGrowthLog(image, desc)        // 加生长实拍，返回 log 对象
store.reportHazard(result, desc, img)  // 上报隐患，返回 '' / 错误文案
store.exchange(itemId)                 // 兑换（扣 coins），返回 { ok, code, msg }

// 新增功能用
store.addTree(tree)                    // 加树（reviewStatus 给 'pending'）
store.updateTree(treeId, patch)        // 改树字段
store.addTask(task)                    // 加日程
store.updateUser(patch)                // 改用户字段（加 coins、改昵称等）
```

### 图片 / id（`common/db.js`）

```js
const db = require('../../common/db')

await db.uploadImage(tempFilePath)  // 返回可直接放进 <image src> 的地址
db.newId('log')                     // 生成唯一 id
db.getMode()                        // 'local' | 'cloud'，调试用
```

> `uploadImage` 在测试号下走 base64 存 Storage，正式环境走云存储。**页面代码完全一样**。

---

## 四、坐标

现有数据已经是 `lat` / `lng`（Mock 里由 `posX/posY` 换算好）。`common/geo.js` 提供其余能力，**不要手写坐标**：

```js
const geo = require('../../common/geo')

geo.posToLatLng(tree)                    // { lat, lng, latitude, longitude }
geo.posToLatLng(posX, posY)              // 同上，两种调用方式都支持
geo.latLngToPos(lat, lng)                // { posX, posY }
geo.nearbyTrees(lat, lng, trees, 1000, true)  // 1km 内待认养的树，按距离排序
geo.getCurrentLocation()                 // Promise<{ latitude, longitude, real }>
geo.formatDistance(1200)                 // '1.2 km'
```

`lat` / `lng` 是树对象里的字段名，`latitude` / `longitude` 是 `<map>` 组件要的名字，`posToLatLng` 两个都返回，直接用。

校园中心点常量在 `geo.CAMPUS`，队员 A 实地校准后改这里即可。

---

## 五、页面写法三条铁律

### 1. `onShow` 必须等数据就绪

```js
async onShow() {
  await store.ready()   // 等数据层拉完（测试号读本地、正式环境读云端）
  this.refresh()
}
```

不等的话，正式环境首次进入会先闪一下内置假数据再跳变。

### 2. 写完必须刷新页面自己的 data

写操作改的是 `store.state`（内存），不会自动更新页面。改完要重新 `setData`：

```js
onWater() {
  const err = store.water()
  if (err) return toast(err)
  this.refresh()      // ← 关键，忘了界面不会动
}
```

### 3. 落库是自动的，不要手动调

`store` 里每个写函数末尾都调了 `persist([...])`，方括号里是这次改动涉及的集合名。**不要**在页面里再调 `db.save()`，也不要直接改 `store.state.xxx` 绕过写函数——那样不会落库。

如果你在 `store.js` 里新加写函数，末尾照抄一句 `persist([...])`，把你改到的字段所在集合列出来：

| 你改了什么 | 填什么 |
| --- | --- |
| 树（认养/浇水/施肥/改状态/新增树） | `['trees', 'users']` |
| 任务（打卡/新增日程） | `['tasks', 'users']` |
| 成长日志 / 隐患上报 | `['tree_logs', 'users']` |
| 兑换纪念品 | `['goods', 'users', 'records']` |
| 只改用户信息 | `['users']` |
| 不确定 | 不填，写 `persist()`（会全量写 6 个集合，慢但不会错） |

---

## 六、云开发配置（队长操作，队友不用管）

1. 微信公众平台 → 开发 → 云开发 → 开通，创建环境
2. 把环境 ID 填到 `common/db.js` 的 `CLOUD_ENV`（留空则用默认环境）
3. 云开发控制台 → 数据库 → 建 6 个集合：`users` `trees` `tasks` `tree_logs` `goods` `records`
4. 每个集合权限改成自定义安全规则：

```json
{
  "read": true,
  "write": true
}
```

> 比赛项目为了简单直接放开读写。正式产品要用 `doc._openid == auth.openid` 限制。

5. 云存储权限同样设置。**不需要写云函数**，前端直连数据库。

---

## 七、四人分工边界

| 人 | 只改这些文件 | 不要碰 |
| --- | --- | --- |
| 队员 A（地图） | `pages/map/**` | 其他页面 |
| 队员 B（日程） | `pages/task/**` | 其他页面 |
| 队员 C（林地） | `pages/tree/**` | 其他页面 |
| 队员 D（个人页） | `pages/honor/**` | 其他页面 |
| 队长 | `common/**`、`components/**`、`app.*` | — |

页面里要用的公共能力（弹窗、坐标、上传）都已经在 `components/` 和 `common/` 里，**需要新东西先在群里说，不要各自复制一份**。

---

## 八、功能与字段对照（做之前先看这张表）

| 功能 | 改哪个页面 | 依赖字段 / 接口 |
| --- | --- | --- |
| 地图换成原生 map 组件 | `pages/map` | `trees.lat/lng` + `geo.posToLatLng` |
| 地图加号新增树 | `pages/map` | `store.addTree()`，`reviewStatus: 'pending'` |
| 树木人工审核 | `pages/honor`（管理员入口） | `store.updateTree(id, { reviewStatus: 'approved' })` |
| 定位 + 附近可认养 | `pages/map` | `geo.getCurrentLocation()` + `geo.nearbyTrees()` |
| 看别人的个人主页 | `pages/map` | `trees.ownerId` + `users.nickname/avatar/bio` |
| 树上上报异常 | `pages/map` | `store.reportHazard()` |
| 新增日程 + AI 分析 | `pages/task` | `store.addTask()`，`ai.js` 里加分析函数 |
| 上传凭证核验 | `pages/task` | `db.uploadImage()` → `tasks.proofImage` |
| 碳账本周统计 | `pages/task` | `tasks.date` 按天聚合 |
| 浇水施肥 | `pages/tree` | `store.water()/fertilize()`，扣 `availablePoints` |
| 树木等级排行榜 | `pages/tree` | `tasks` 换成按 `trees.growthScore` 排序 |
| 任务系统（定期实拍） | `pages/tree` | `tasks.type/repeatDays` |
| 护林币货币 | `pages/tree` / `honor` | `user.coins`、`goods.costCurrency` |
| 补给站兑换 | `pages/honor` | `store.exchange()` |
| 个人主页卡片 | `pages/honor` | `users.nickname/avatar/bio/coins` |

新增字段一律：**先改本文件，再改代码，字段名英文小驼峰。**
