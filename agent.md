# Agent 协作规则

本文件对所有 AI 助手 / 自动化代理生效。开始任何工作前先读完本文件。

## 核心规则（必须遵守）

1. **不要自己造轮子**：能搬开源功能就直接搬，优先复用业界已成熟的方案；本项目内则优先复用 `common/`、`components/` 已有能力，不要复制一份新的。
2. **先定位，再给方案**：必须查清楚问题位置、定位根因之后才能给方案。不希望在改动后再次推翻先前的结论，所以改动前必须把问题位置完全定位清楚（读代码、加日志、复现验证），不允许凭猜测改。
3. **先方案，后实现**：任何功能实现前先给出方案，经用户同意后再动手写代码。
4. **不破坏现有功能**：修改不能与现有正常功能的逻辑冲突；涉及公共层（`common/`、`components/`、`app.*`）的改动尤其要评估对四个页面的影响。

## 项目速览（中大森友会 · 微信原生小程序）

- 由 uni-app x 工程 1:1 转换而来，零框架依赖，四个页面：`pages/map`（地图/认养）、`pages/task`（低碳日程）、`pages/tree`（我的林地）、`pages/honor`（我的/补给站）。
- 数据层：`common/db.js` 双模式（测试号 → 本地 Storage；正式 AppID → 云开发数据库），**页面和 store 都不写数据库代码**，业务只调 `store.xxx()` 和 `db.uploadImage()`。
- 状态：`common/store.js` 模块级单例，写完必须调页面 `refresh()` 重新 `setData`，否则界面不动。

## 开工前必读

| 文档 | 内容 |
| --- | --- |
| [`README.md`](README.md) | 跑起来方式、目录结构、转换注意事项（flex/refresh/模板函数）、协作流程 |
| [`docs/CONTRACT.md`](docs/CONTRACT.md) | 数据契约：集合字段、store 接口清单、页面写法三条铁律、分工边界。**新增字段先改这里再改代码** |
| [`docs/1.0实现说明.md`](docs/1.0实现说明.md) | 原版设计意图、数据流、AI 层契约、已知限制 |

## 硬约束（来自 README / CONTRACT，违反会直接出 bug）

- wxml 模板不能调用函数，格式化/类名一律在 js 里预计算好再 `setData`。
- 新容器必须显式写 `display: flex` + `flex-direction`（小程序 view 默认 block）。
- 数据读写只走 `store.xxx()`，不要在页面直接碰 `wx.cloud` / `wx.setStorageSync` / 直接改 `store.state`。
- `onShow` 里先 `await store.ready()` 再 `refresh()`。
- store 里新增写函数，末尾照抄 `persist([...涉及集合])`。
- 弹窗统一用 `components/sheet`，坐标换算用 `common/geo.js`，图片上传用 `db.uploadImage()`。
- 只改自己模块的 `pages/<模块>/`；动公共层先报备。
