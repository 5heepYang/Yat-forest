# 中大森友会 · 原生小程序版

「中大森友会 SYSU Eco-Twin」的微信原生小程序实现，由原 uni-app x（`.uvue` + UTS）工程 1:1 转换而来。

四个页面、全部交互与 Mock 数据与原版一致，**零框架依赖**，只需要微信开发者工具即可开发和调试。

---

## 一、怎么跑起来

1. 打开微信开发者工具 → 导入项目
2. 目录选 **本文件夹**（`elite-cup-native`），不要选上一层的 `elite-cup`
3. AppID 填 `wx986e1936b714fb78`（已预填在 `project.config.json`）
4. 点编译即可，无需任何额外安装、无需 HBuilderX、无需云开发

如果 AppID 报不匹配，右上角「详情 → 基本信息」里换成你自己的即可。

### 队友第一次拿到代码

```bash
git clone https://gitee.com/chen-zirui112/elite-cup.git
```

微信开发者工具 → 导入项目 → **选仓库根目录**（不是里面的子目录）。

**AppID 怎么处理**：仓库里预填的是队长的 AppID `wx986e1936b714fb78`，普通成员的微信账号不在这个小程序的成员列表里，导入时会提示「AppID 与账号不匹配」。任选一种：

| 场景 | 做法 |
| --- | --- |
| 只是在模拟器里看效果、改代码 | 导入时选**「使用测试号」**，最省事 |
| 想用自己的小程序身份 | 详情 → 基本信息 → AppID 改成自己的 |
| 要真机预览 / 上传代码 | 让队长把你的微信号加进小程序成员 |

**测试号下照常开发**：数据读写走 `common/db.js`，测试号自动落在本地 Storage（重启不丢）；只有队长的正式 AppID 才连云数据库。所以**不需要**：HBuilderX、DCloud 账号、node_modules、云开发环境、团队成员权限。

克隆下来就有的：四个页面、两个组件、Mock 数据、全部图片、子集字体。
**不需要**：HBuilderX、DCloud 账号、node_modules、云开发环境。
**不会克隆**：`project.private.config.json`（开发者工具的本地私人配置，打开后会自动生成）。

---

## 二、目录结构对照

| 原 uni-app x 工程 | 现在 |
| --- | --- |
| `App.uvue` | `app.js` + `app.wxss` |
| `pages.json` | `app.json` + 各页 `*.json` |
| `pages/*/index.uvue` | `pages/*/*.wxml` + `.wxss` + `.js` + `.json` |
| `components/nav-bar.uvue` | `components/nav-bar/` |
| `components/app-tabbar.uvue` | `components/app-tabbar/` |
| —（新增） | `components/sheet/` 统一底部弹层 |
| `common/*.uts` | `common/*.js`，另加 `db.js`（数据层）、`geo.js`（坐标工具） |
| `static/` | `static/`（原样复用） |

逻辑层函数名、字段名、数值口径**完全保留**，方便对照原代码：

- `common/store.js` —— 全局状态 + 全部写操作（认养/浇水/施肥/任务/隐患/兑换）
- `common/mock.js` —— 12 棵树、4 条任务、3 件纪念品、6 枚勋章、排行榜
- `common/ai.js` —— 三个 AI 能力的模拟实现，函数签名不变
- `common/theme.js` —— 设计 token 与数值常量
- `common/util.js` —— 格式化与 toast

---

## 三、转换时改了什么（重要）

### 1. flex 布局必须显式声明

uvue 的 `view` **默认就是 `flex-direction: column`**，所以原样式里大量容器没有写 `display: flex`。小程序 `view` 默认是 `block`，直接照搬会导致布局全塌。

处理方式：所有容器补 `display: flex`，**并显式写 `flex-direction: column`**（CSS 的 flex 默认是 row，方向不写会反过来）。搜索 wxss 里成对出现的 `display: flex` + `flex-direction` 就能看出规律。

### 2. 状态管理从 reactive 改为手动同步

原版 `common/store.uts` 用 `reactive()` 做响应式，小程序没有这个机制。现在 `common/store.js` 导出普通对象 `state`：

```js
const store = require('../../common/store')
store.adoptTree('t_103')   // 改数据
this.refresh()             // 再同步到页面
```

每个页面都有 `refresh()`，在 `onShow` 和每次写操作之后调用。**这是改动代码时最容易忘的一步**——只改 state 不调 refresh，界面不会变。

状态本身是模块级单例，页面之间 `wx.reLaunch` 切换不会丢（只要小程序没重启）。

### 3. 模板里不能调用函数

原模板里有 `unownedCount()`、`t.distance.toFixed(0)`、`pinClass(t)` 这类写法，小程序 wxml 只支持简单表达式。全部改为在 js 里预计算，模板只读字段：

- 树点位：`pinHeadClass` / `pinTailClass` / `pinIcon` 在 `decoratePins()` 里算好
- 详情卡：`tagText` / `btnText` / `btnBg` 等在 `decorateSelected()` 里算好
- 周柱状图：`{ idx, h, cls }`
- 时光轴：`{ logId, imageUrl, label }`

### 4. API 替换

| uni | 微信原生 |
| --- | --- |
| `uni.showToast` | `wx.showToast` |
| `uni.reLaunch` | `wx.reLaunch` |
| `uni.chooseImage` | `wx.chooseImage` |
| `uni.loadFontFace` | `wx.loadFontFace` |
| `var(--status-bar-height)` | `getApp().globalData.statusBarHeight`（CSS 变量小程序不支持） |

---

## 四、字体：为什么只有 500KB

原始 HarmonyOS Sans SC 两个字重共 **15.7 MB**，而微信小程序主包上限是 **2 MB**，原样打包会直接编译失败。

处理方案：用 `fonttools` 按工程实际用到的字符做子集化，15.7 MB → **519 KB**，视觉上无损（字形数据一个没少，只是去掉了用不到的字）。

### 加了新文案、发现字体不一致怎么办

子集里没有的字会**自动回退到系统字体**（不会出现方块乱码），但字重和字形会略有差异。想保持一致就重跑一次：

```bash
pip install fonttools
python tools/build-fonts.py
```

脚本会自动扫描所有 `.wxml` / `.js` 里的字符 + 1553 个常用汉字兜底，重新生成 `static/fonts/*.ttf`。原始字体放在 `assets-src/fonts/`（已在 `packOptions.ignore` 里排除，不会打进包）。

---

## 五、当前体积

| 项 | 大小 |
| --- | --- |
| 字体（2 个子集） | 519 KB |
| 图片（ui / illus / tabbar） | 67 KB |
| 代码 + 样式 | 约 80 KB |
| **主包合计** | **约 0.75 MB** |

主包 2 MB 上限，还有充足余量。如果后面加大图，优先压图或放 CDN，不要直接塞包内。

---

## 六、数据层与协作约定

数据全部走 `common/db.js` + `common/store.js`，**页面不碰数据库**：

| 环境 | 底层实现 | 效果 |
| --- | --- | --- |
| 测试号 | `wx.setStorageSync` | 数据存在各自开发者工具里，重启不丢，增删改查全可用 |
| 正式 AppID + 云开发 | `wx.cloud.database()` | 数据进云端，多人共享，按 `_openid` 隔离 |

- 队友**不需要**开通云开发、不需要配环境 ID。用测试号写的代码，合并到正式环境会自动走云端，一行都不用改
- **登录与数据隔离**：不需要登录页。正式环境下每人有自己的积分/日程/兑换记录（首次进入静默注册），树木和商品库存全局共享。用户在个人页点昵称可改名
- 上传图片统一调 `db.uploadImage()`，不要自己写存储逻辑
- 弹窗统一用 `components/sheet`，`.sheet-btn` / `.hint-box` 这些样式在 `app.wxss` 里，别再各写一套
- 坐标换算用 `common/geo.js`，不要手写经纬度

> 完整字段定义、接口清单、四人分工边界、每个功能该改哪个文件，全部写在 **[`docs/CONTRACT.md`](docs/CONTRACT.md)**，开工前先读一遍。

### 队长建库自检清单（只用做一次）

1. 云开发控制台 → 数据库 → 依次新建 6 个集合：
   `users`、`trees`、`tasks`、`tree_logs`、`goods`、`records`
   （小程序端建不了集合，**必须在控制台手动建**，少一个对应页面就没数据）
2. 每个集合 → 权限设置 → 自定义安全规则 → 填：

   ```json
   { "read": true, "write": true }
   ```

3. 开发者工具里编译预览，随便点一次「浇水」
4. 打开调试器 Console，应看到 `[db] 云端模式`，且没有红色报错
5. 回云开发控制台看 `trees` 集合，那条树的 `growthScore` 应该 +20，`users` 的 `availablePoints` -10

第 5 步成立，说明整条链路（页面 → store → db → 云数据库）通了。之后队友合并进来的代码会自动走同一条链路，不用再配任何东西。

第 6 步（一次性，配合登录隔离生效）：云控制台把 6 个集合里的旧记录**全部删掉**，再编译进入一次——你会以第一个用户 `u_001` 注册，拿到完整演示数据（已认养 t_101、3 条日志、4 条日程）；之后每个进来的人都是新用户，各自注册。不清也能跑，只是 t_101 会挂在一个没人认领的 `u_001` 名下。

> 集合是空的也没关系：首次启动会按集合补种种子数据，缺哪个补哪个。

## 七、给队友的分工入口

| 模块 | 页面文件 | 对应原分工 |
| --- | --- | --- |
| 森友地图与认养 | `pages/map/` | 队员 A |
| 低碳日程与 AI 核验 | `pages/task/` | 队员 B |
| 我的林地 | `pages/tree/` | 队员 C |
| 我的 / 补给站 | `pages/honor/` | 队员 D |
| 公共层 | `common/`、`components/` | 队长，改动需先同步 |

改页面时的注意顺序：

1. 模板改 `*.wxml`，样式改 `*.wxss`（**记得给新容器补 `display: flex` + `flex-direction`**）
2. 需要新字段就在 `data` 里声明，再在 `refresh()` 里 `setData`
3. 涉及全局数值（积分、成长值）的写操作，一律走 `common/store.js`，不要在页面里直接改 state

### 开发循环（每人照此执行）

```bash
# 0. 一次性：clone + 导入 + 测试号（见第一节）
git clone https://gitee.com/chen-zirui112/elite-cup.git

# 1. 认领模块后，开自己的分支（分支名 = 模块名）
git checkout -b feat/map     # A：地图    feat/task：B 日程
                             # feat/tree：C 林地    feat/honor：D 个人页

# 2. 开发……改完一批就提交
git add -A
git commit -m "feat(map): 地图页接入定位与半径筛选"
git push origin feat/map
```

3. 做完后去 Gitee 发 **Pull Request**（`feat/xxx` → `master`），描述里写清：改了哪些文件、新增了哪些 data 字段、依赖了 CONTRACT 里哪几条
4. 队长 review 合并。合并后队长用正式 AppID 编译验收一遍云端链路

**边界纪律**（CONTRACT.md 有完整版）：

- 只改自己模块的 `pages/<模块>/`；要动 `common/`、`components/`、`app.*` 先在群里说，合并冲突基本都出在这
- 数据读写只走 `store.xxx()`，**不要**自己碰 `wx.cloud` / `wx.setStorageSync`
- wxml 里不能调函数，格式化/类名都在 js 里算好再 `setData`

---

## 八、与原版的已知差异

- **没有跨端能力**：原 uni-app x 工程可编译 Android / iOS / 鸿蒙 / Web，这份只能在微信里跑
- **小程序端本来就是 VDOM 渲染**（基础库架构决定的），原版蒸汽模式的原生渲染性能在这里不存在
- 字体是子集，未覆盖的生僻字回退系统字体
- `pages/task` 的周柱状图高度按 66px 基准算，与原版一致
