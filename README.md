# 3D Building Kit — 空间语言编辑器

一个**纯前端**、像 Townscaper 一样简单的 3D 建筑工具。核心理念：用户只**定义空间结构**（在网格上画出体量、叠楼层），系统**自动把建筑素材包裹上去**——地板、外墙、窗、一扇门、转角柱、收好边的屋顶全部自动生成。用户从不手动摆门窗墙。最后一键**导出成单个 GLB 文件**。

面向初/高中生，用 Kenney 的 Building Kit 素材。技术栈：React 19 + React Three Fiber + drei + Three.js + Zustand + Vite。

## 快速开始

```bash
# 1. 生成素材（从 Kenney building-kit zip 解出 GLB/缩略图，生成 pieces.json）
node scripts/build-kit.mjs            # 默认读 /mnt/c/Users/laval/Downloads/kenney_building-kit.zip
# 2. 安装并启动
npm install
npm run dev                           # http://localhost:5173
```

## 怎么用

- **画空间**（默认）：在网格上左键拖一个矩形 → 立刻生成一栋完整建筑（地板+窗墙+一扇门+转角柱+屋顶）。
- **叠楼层**：画布左侧的竖向楼层条像电梯键——点任意一层直接切换，最上方 `＋` 去上面一层（滚轮 / `[` `]` 也可切层）。切到上层后再画一个矩形即叠出多层；下层会自动只在没被上层盖住的地方铺屋顶。
- **擦除**：切到擦除工具，拖矩形删掉空间的格子（支持 L 形等任意形状）。
- **相邻空间**：同层两个空间贴在一起，共享墙自动开成通道门洞。
- 快捷键：`S` 画 / `E` 擦 / `Tab` 切「体块/成品」视图 / `Ctrl+Z`·`Ctrl+Y` 撤销重做。右键拖动转视角。
- **风格**：住宅（默认，全套）/ 亭子（柱+顶无墙）/ 开放（只地板+顶）。
- 层高固定 = 墙高（素材尺寸固定，二层地板正好落在一层墙顶，不可调以免出现填不上的缝）。
- **体块视图**：随时切换查看纯抽象体块结构（每个空间一种颜色，无素材）。
- **保存/读取**：自动存浏览器 localStorage；可导出/导入工程 JSON。
- **导出 GLB**：整栋建筑导成一个自带贴图的 `building.glb`（可拖进 https://gltf-viewer.donmccurdy.com 或 Blender 查看）。

## 设计核心

**抽象层（持久化真源）**：`cells: Record<"level,ci,cj", spaceId>` —— 哪些格子被占、属于哪个空间。

**物化层（派生，每次编辑实时重算）**：`src/kit/deriveSkin.ts` 是一个**纯函数、确定性**的自动出皮引擎——同一结构永远生成同一外观，改一处不影响别处。规则：每格一块地板；外缘面放墙（确定性 hash 决定开窗还是实墙，底层正面一扇门+门叶）；同一空间内部不放墙；两空间之间开通道门洞；凸角放柱；顶层盖屋顶（按暴露边自动选角/边/中屋顶件）。

坐标：cell = 网格线之间的方格（中心 `GRID*i+HALF`），墙/柱落在网格线上 → 你圈出的矩形外轮廓 = 建筑真实外墙线。`GRID=2.0`、`WALL_HEIGHT=2.4`，均实测自 GLB。

## 项目结构

```
scripts/build-kit.mjs        # zip → public/kit/* + pieces.json
src/
  kit/constants.ts           # GRID/WALL_HEIGHT/坐标辅助
  kit/types.ts  massing.ts   # Space/cell 模型 + rect 工具
  kit/deriveSkin.ts          # 自动出皮引擎（核心）
  store/useBuildStore.ts     # Zustand：cells 真源 + reskin + 撤销/persist
  three/Scene.tsx            # Canvas/相机/轨道/网格
  three/GroundPlane.tsx      # 画空间/擦除交互
  three/CellPreview.tsx  AbstractView.tsx
  three/PlacedPieces.tsx  PieceInstance.tsx  useKitModel.ts  exportGLB.ts
  ui/Toolbar.tsx
```

## 后续可加（phase-next）

楼梯/层间连接（室外空间用）· 屋顶凹角更精细（roof-flat-corner-inner）· 更多风格 · 门洞朝向/门叶开合微调 · 移动端触屏。
