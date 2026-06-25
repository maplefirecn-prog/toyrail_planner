# RailDesign Planner

Web 模型铁路（N 轨）轨道设计工具。SCARM 风格的"拖近吸附 + 角度校正"自动连接，零安装依赖、纯浏览器运行。

## 运行

需要 Node.js（仅用作静态服务器；运行时纯浏览器，无构建步骤）。

```bash
node tools/serve.js
# 浏览器打开 http://127.0.0.1:8765/
```

也可直接双击 `index.html`（file://），但部分浏览器对 file:// 有限制，推荐用服务器。

## 核心能力

### 自动连接（拖近吸附 + 角度校正）

SCARM 的核心交互：两根轨道靠近时，断点自动吸附并**调整到正确的拼接角度**连接，而不是按已有角度硬连（硬连可能导致轨道实际无法运行）。

**用法**：

1. 单击选中一根轨道，双击解锁移动
2. 拖动这根轨道靠近另一根的开放端点（绿色圆点）——目标端点会高亮提示
3. 松手：被拖的轨道自动移动 + 旋转对准目标端点，写入连接
4. 若对准后与其他轨道冲突，自动回退到拖动前位置并提示

**关键点**：

- 只移动被拖的那根轨道，目标轨道不动
- 用 `alignConnectorToTarget` 让端点严丝合缝对齐（位置 + 朝向都校正）
- 连接前做碰撞检查（排除刚连接的那对端点——它们本就该重合），冲突则取消
- profile 兼容性检查：接口不匹配的轨道不会连接

### 基础编辑

- 选择 / 移动 / 旋转 / 翻转 / 删除轨道件
- 从素材库放置直轨、曲轨、道岔、立柱、桥脚、坡道
- 2D 毫米画布（网格、标尺、平移、缩放、视图旋转）+ 3D 立体预览
- 多高度跨越：placement 支持 `z` 起点 + `zEnd` 终点，单段轨道可表达爬坡
- 导入 / 导出 catalog / project JSON，IndexedDB 持久化
- 校验框实时显示：开放端点数 · 连通分量数

## 素材库

内置 Tomix Fine Track 共 85 件（catalog 版本 `2026-06-23-curated`）：

- **轨道**（8 直 + 15 曲 + 7 交叉 + 10 道岔，含 541-15 经典、280-30 紧凑、3-way、剪式交叉、复式交分、弧线、迷你等）
- **桥脚 / 立柱**（红砖单线、复线高架、复线 PC、阶层梁、筑堤、螺旋等）
- **坡道桥脚**：3016/3044 套件拆为 D1-D10 / DS-D1 到 DS-D10 共 20 件递增高度（5.5mm 步进，配合 4% 标准坡度 280mm 间距）

## 性能优化

- **几何指纹缓存**：`placementRoutes`/`placementConnectors` 按 placement 指纹缓存，变更点失效（减 70%+ 重复采样）
- **frame 级缓存**：`openConnectors`/`allConnectors`/拓扑图每帧只算一次，多处共享
- **uniform grid 空间索引**（`src/spatial.js`）：hit-test 从 O(n) 降到 O(√n)
- **`rebuildIndex` 条件化**：仅 catalog 变化时重建

## 文件结构

```
src/
  app.js                主应用（状态、渲染、交互、3D 预览）
  geometry.js           几何引擎（坐标变换、连接器、吸附、指纹缓存）
  spatial.js            uniform grid 空间索引
  graph.js              拓扑图（connector 为节点，route/connection 为边）
  db.js                 Dexie / IndexedDB 持久化
  styles.css            UI 样式
  tomix-catalog.js      Tomix Fine Track 素材库
  sample-data.js        Demo catalog + 示例项目
  planning/
    collision.js        碰撞检测（AABB 粗筛 + route 采样点精测）
schemas/                catalog.v1 / project.v1 JSON Schema
data/                   示例 JSON
tools/
  serve.js              零依赖 Node 静态服务器
  rebuild-tomix-catalog.js  从原始 Tomix 数据生成精简 catalog 的脚本
vendor/
  dexie-fallback.js     CDN 不可用时的 IndexedDB 备用方案
```

## 设计取舍

自动连接采用"拖近吸附 + 移动被拖轨道对准角度"的方式，**不**做：

- 在两固定端点间塞可弯轨的 bi-arc 拟合——对模型铁路设计场景价值低
- 拓扑图上的 A\*/Dijkstra 最短路径——用户自己摆的拓扑已知，路径搜索意义不大
- 模拟退火整体布局优化——轨道件角度离散，连续优化不适用

碰撞检测不作为独立功能展示，而是并入连接逻辑（连接产生冲突时拒绝连接）。

## License

[MIT](LICENSE) © Tom Lee

## Trademarks

"TOMIX" and Tomix Fine Track product model numbers (1011, 1012, 3018, 等) are
trademarks of Tomytec Co., Ltd. This project is **not affiliated with or
endorsed by Tomytec**. Product data is included for compatibility purposes only.

## Dependencies

- [Dexie.js](https://dexie.org/) (Apache 2.0) — loaded from CDN with a built-in
  IndexedDB fallback in `vendor/dexie-fallback.js`.
