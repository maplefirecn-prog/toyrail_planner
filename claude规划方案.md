好的，按你的新要求，我建议把 AI 功能进一步收敛成一个 极简 AI 对话式规划窗口：

不提供上下文勾选项；
不做复杂 patch 交互；
不显示密钥后四位，也不显示指纹，只显示星号；
AI 生成后给摘要、部件数量、轨道长度等信息；
用户确认后 一键替换当前规划 JSON。
下面是优化后的方案。

一、整体定位
AI 窗口不是一个复杂配置面板，而是一个“轨道规划助手”。

用户只需要做三件事：

配置 API 类型和密钥；
在对话框里输入需求，或者点样板提示词；
查看 AI 生成摘要，一键替换当前规划。
核心流程：

用户输入需求
  ↓
系统自动收集当前项目 + catalog + 固定起点 + 开放端点
  ↓
组合系统提示词 + 上下文 + 用户需求
  ↓
AI 返回完整 project JSON + 摘要
  ↓
本地校验
  ↓
显示摘要 / 部件数量 / 轨道长度 / 警告
  ↓
用户点击“替换当前规划”
二、AI 窗口 UI 设计
入口
建议在顶部工具栏或右侧项目面板加入：

AI 规划
点击后打开右侧抽屉。

AI 窗口结构
┌──────────────────────────────┐
│ AI 轨道规划                   │
├──────────────────────────────┤
│ API 设置                      │
│  API 格式：[Anthropic ▼]       │
│  Base URL：[https://...]       │
│  Model：[claude-opus-4-8]      │
│  API Key：[************] [更换] │
├──────────────────────────────┤
│ 你想规划什么？                 │
│ [对话输入框 / textarea]        │
│                              │
│ 样板提示词：                   │
│ [重新设计一个环线布局]          │
│ [基于当前布局继续扩展]          │
│ [从当前起点继续铺轨]            │
│ [优化当前布局减少开放端点]      │
├──────────────────────────────┤
│ 提示：生成前请先导出/保存当前   │
│ 规划 JSON，AI 结果会替换当前规划 │
├──────────────────────────────┤
│ [生成规划] [停止]              │
├──────────────────────────────┤
│ 生成结果                      │
│ 摘要：...                     │
│ 部件数量：...                 │
│ 轨道长度：...                 │
│ 开放端点：...                 │
│ 警告：...                     │
│                              │
│ [替换当前规划] [复制 JSON]      │
└──────────────────────────────┘
三、API 设置交互
API 格式
只保留必要字段：

API 格式
[ Anthropic Messages API ]
[ OpenAI-compatible Chat Completions API ]
Anthropic 默认值
Base URL: https://api.anthropic.com
Model: claude-opus-4-8
OpenAI-compatible 默认值
Base URL: https://api.openai.com/v1
Model: 用户自己填，默认可给 gpt-4.1 或留空
也允许用户填第三方 OpenAI-compatible endpoint。

API Key 状态
你要求“不显示后四位，指纹都不需要，打上星号即可”，所以 UI 简化为：

未设置
API Key
[ 输入 API Key              ] [保存]
已设置
API Key
[ ************              ] [更换] [删除]
点击“更换”后：

新 API Key
[                         ] [保存] [取消]
注意：

不提供“显示密钥”按钮；
不显示后四位；
不显示 hash 指纹；
保存后 input 只显示固定星号，例如：
************
本地密钥提示
窗口里需要有一个很短的说明：

API Key 仅保存在当前浏览器本地。静态网页无法做到真正保密，请使用低额度、可随时撤销的密钥。
如果你要放演示密钥，可以再加：

演示额度有限，可能随时失效。
四、对话窗口设计
你希望不要选项、不要上下文勾选，只保留一个对话窗口。因此对用户来说就是：

你想让 AI 怎么规划？
[                                                  ]
[                                                  ]
下面给几个样板提示词按钮，点击后自动填入 textarea。

样板提示词建议
1. 重新设计一个轨道
请重新设计当前画布上的轨道规划。目标是做一个适合 N 轨的环线布局，尽量使用当前素材库中的标准直轨和曲轨，布局要尽量保持在画布范围内，并减少开放端点。
2. 基于当前布局扩展
请在当前布局基础上继续扩展，不要删除已有轨道。希望增加一条侧线和一个简单会车区域，尽量保持轨道连接合理，并避免明显碰撞。
3. 从当前起点继续铺轨
请从当前设置的起点继续铺轨，延展出一段自然的线路。优先使用标准直轨和曲轨，如果需要分岔可以使用道岔。
4. 优化当前布局
请优化当前轨道布局，尽量减少开放端点和不必要的断开连接，保持大部分已有轨道位置不变，只在必要时调整或补充轨道。
5. 生成站场布局
请基于当前画布设计一个小型车站区域，包括主线、会车线和一条短侧线。尽量使用当前素材库中的道岔、直轨和曲轨，布局保持紧凑。
五、生成前提醒
因为这次设计是一键替换当前规划 JSON，所以 AI 窗口必须明确提醒用户：

建议先点击“导出项目 JSON”保存当前规划。AI 生成结果应用后会替换当前 placements 和 connections。
更强一点：

AI 结果应用后会替换当前规划。请先导出当前项目 JSON 作为备份。
可以在“替换当前规划”按钮点击时再确认一次：

确定要用 AI 生成结果替换当前规划吗？建议先导出当前项目 JSON 备份。
六、AI 输出结构
既然目标是一键替换当前规划 JSON，我建议不要让 AI 返回 patch，而是返回一个包装对象：

{
  "schema": "raildesign.aiGeneratedProject.v1",
  "summary": {
    "title": "小型环线与侧线布局",
    "description": "使用标准直轨、曲轨和道岔生成一个环线，并加入一条会车侧线。",
    "warnings": [],
    "estimatedPlacementCount": 24,
    "estimatedTrackLengthMm": 4280,
    "estimatedOpenConnectors": 2
  },
  "project": {
    "schema": "raildesign.project.v1",
    "projectId": "layout-ai-generated",
    "name": "AI Generated Layout",
    "units": "mm",
    "board": {},
    "catalogRefs": [],
    "view": {},
    "layers": [],
    "placements": [],
    "connections": [],
    "metadata": {}
  }
}
这样 UI 可以：

读取 summary 展示；
读取 project 做本地校验；
用户确认后替换当前 state.project。
为什么返回完整 project 而不是 patch？
因为你的目标是“简单一些”和“一键替换当前规划 JSON”。

完整 project 的优点：

用户理解简单：AI 给出一个新规划；
程序处理简单：校验后整体替换；
对话模型更容易稳定输出；
不需要处理复杂 patch 合并冲突。
但系统提示词里仍然可以要求：

如果用户说“基于当前布局扩展”，AI 应该在返回的新 project 中保留原有 placements，再添加新内容；
如果用户说“重新设计”，AI 可以大幅替换 placements/connections。
七、本地应用逻辑
点击“替换当前规划”时，程序做：

1. 取 AI 返回的 project
2. 校验 project.schema === "raildesign.project.v1"
3. 校验 placements / connections
4. 校验 pieceId 是否存在
5. 校验 connectorId 是否存在
6. 校验连接 profile 是否兼容
7. 校验同一 connector 不重复连接
8. 可选：碰撞检测
9. 替换 state.project
10. G.clearGeometryCache()
11. ensureProjectShape()
12. fitView()
13. renderAll()
14. setStatus("已应用 AI 规划")
应用时建议保留当前项目的一些外壳字段：

newProject.projectId = state.project.projectId
newProject.name = state.project.name + " · AI"
newProject.board = state.project.board
newProject.view = state.project.view
newProject.layers = state.project.layers
但如果 AI 返回了更合理的 board/layers，也可以允许覆盖。

我建议第一版：

AI 可以替换 placements/connections/catalogRefs/metadata.notes
程序保留当前 board/view/layers/projectId
这样更安全。

八、自动发送给 AI 的上下文
用户不需要勾选，但系统仍然自动发送必要上下文。

建议固定发送：

{
  "app": {
    "name": "RailDesign Planner",
    "units": "mm",
    "coordinateSystem": {
      "origin": "board center",
      "x": "right positive",
      "y": "up positive",
      "yawDeg": "0 is +x, 90 is +y"
    }
  },
  "userRequest": "...",
  "currentProject": {
    "board": {},
    "catalogRefs": [],
    "layers": [],
    "placements": [],
    "connections": []
  },
  "fixedStart": {},
  "openConnectors": [],
  "validation": {},
  "metrics": {},
  "catalog": {
    "catalogId": "...",
    "version": "...",
    "pieces": []
  },
  "outputRequirements": {
    "returnFullProject": true,
    "replaceCurrentPlan": true
  }
}
catalog 内容建议
虽然用户不需要勾选，但程序内部要做压缩。

每个 piece 发送：

{
  "id": "tomix.s280-pc",
  "sku": "1012",
  "name": "S280-PC PC直轨",
  "kind": "track.straight",
  "tags": ["straight"],
  "connectors": [
    { "id": "A", "x": 0, "y": 0, "z": 0, "yawDeg": 180, "profile": "tomix.fine-track" },
    { "id": "B", "x": 280, "y": 0, "z": 0, "yawDeg": 0, "profile": "tomix.fine-track" }
  ],
  "routes": [
    {
      "connectorIds": ["A", "B"],
      "segments": [{ "type": "line", "lengthMm": 280 }]
    }
  ]
}
不要发送：

sources
metadata
长说明文本
render 细节
provenance 细节
九、系统提示词优化版
下面这版适合“返回完整 project JSON”。

System Prompt
你是 RailDesign Planner 的轨道规划引擎。你的任务是根据用户需求、当前项目、当前素材库和轨道几何信息，生成一个完整的 RailDesign project JSON。
你必须只输出 JSON，不要输出 Markdown，不要输出解释文字。
输出必须是一个对象，结构为：
{
  "schema": "raildesign.aiGeneratedProject.v1",
  "summary": { ... },
  "project": { ... }
}
核心规则：
1. 单位与坐标
- 所有长度单位都是 mm。
- 坐标原点在画布中心。
- x 向右为正，y 向上为正。
- yawDeg 使用角度制，0 表示朝 +x，90 表示朝 +y，180 表示朝 -x，270 表示朝 -y。
- placement 的 x/y/z/yawDeg 是世界坐标中的放置变换。
2. Catalog 约束
- 只能使用上下文 catalog.pieces 中存在的 pieceId。
- 不要编造 pieceId。
- 不要编造 connectorId。
- connection 必须引用真实 placementId 和 connectorId。
- 同一个 connector 不能被连接超过一次。
- 连接两端的 profile 必须兼容。
3. Project 输出约束
- project.schema 必须是 "raildesign.project.v1"。
- project.units 必须是 "mm"。
- project.placements 必须是完整数组。
- project.connections 必须是完整数组。
- 每个 placement 必须包含 id, pieceId, x, y, z, yawDeg。
- 新增 placement id 使用 "ai-pl-" 前缀，例如 "ai-pl-001"。
- id 必须唯一。
- 默认 layerId 使用 "base"。
- 如果当前项目已有 layers，保留它们。
- 如果当前项目已有 board，保留 board 尺寸和 grid。
- 如果用户要求“基于当前布局扩展”，应尽量保留 currentProject.placements 和 currentProject.connections，并在其基础上添加。
- 如果用户要求“重新设计”，可以替换 placements 和 connections。
- 如果用户要求“从当前起点继续铺轨”，必须优先从 fixedStart 开始生成新轨道，并把结果合并进完整 project。
4. 轨道几何规则
- 连续轨道应通过 connections 明确连接。
- 连接的两个端点应在几何上重合或非常接近，并且朝向相反。
- 优先使用标准直轨和标准曲轨。
- 需要分岔、会车线、侧线时可以使用 turnout。
- 尽量让布局保持在 board 范围内。
- 避免明显重叠和碰撞。
- 如果不能完全闭合或不能满足需求，在 summary.warnings 中说明。
5. fixedStart 规则
- 如果 fixedStart.type 是 "connector"，新延展的第一段轨道必须连接到该 connector。
- 如果 fixedStart.type 是 "point"，新延展的第一段轨道应从该点附近开始，但不要为 point 创建 connection。
- 如果没有 fixedStart，则根据用户需求决定从当前开放端点扩展还是重新设计。
6. summary 规则
summary 必须包含：
- title: 简短标题
- description: 方案摘要
- warnings: 字符串数组
- estimatedPlacementCount: 部件数量
- estimatedTrackLengthMm: 估算轨道总长度
- estimatedOpenConnectors: 估算开放端点数量
7. 质量要求
- 输出必须能被 JSON.parse 解析。
- 输出必须尽量符合 RailDesign project schema。
- 不要使用注释。
- 不要在 JSON 外包裹 ```json。
十、用户消息模板
程序每次请求时拼成：

请根据以下上下文生成 RailDesign 轨道规划。
用户需求：
{{用户输入}}
上下文 JSON：
{{上下文 JSON}}
请只返回 JSON，格式必须是 raildesign.aiGeneratedProject.v1。
十一、输出 JSON Schema 简化版
第一版可以让本地校验为主，不一定强依赖 provider 的 JSON schema 功能。但如果 provider 支持，可以发这个 schema。

{
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "summary", "project"],
  "properties": {
    "schema": {
      "const": "raildesign.aiGeneratedProject.v1"
    },
    "summary": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "title",
        "description",
        "warnings",
        "estimatedPlacementCount",
        "estimatedTrackLengthMm",
        "estimatedOpenConnectors"
      ],
      "properties": {
        "title": { "type": "string" },
        "description": { "type": "string" },
        "warnings": {
          "type": "array",
          "items": { "type": "string" }
        },
        "estimatedPlacementCount": { "type": "integer" },
        "estimatedTrackLengthMm": { "type": "number" },
        "estimatedOpenConnectors": { "type": "integer" }
      }
    },
    "project": {
      "type": "object",
      "additionalProperties": true
    }
  }
}
这里不把完整 project schema 塞进 JSON schema，是为了减少请求长度和提高 OpenAI-compatible 兼容性。完整校验放在本地做。

十二、Anthropic 请求建议
如果是 Anthropic Messages API：

{
  model: "claude-opus-4-8",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  output_config: {
    effort: "high",
    format: {
      type: "json_schema",
      schema: AI_GENERATED_PROJECT_SCHEMA
    }
  },
  system: SYSTEM_PROMPT,
  messages: [
    {
      role: "user",
      content: USER_MESSAGE
    }
  ]
}
说明：

claude-opus-4-8 适合几何规划和长上下文。
thinking: { type: "adaptive" } 适合复杂规划。
用 output_config.format 约束 JSON。
不使用 assistant prefill。
不使用 temperature / top_p / top_k。
十三、OpenAI-compatible 请求建议
{
  model: model,
  messages: [
    {
      role: "system",
      content: SYSTEM_PROMPT
    },
    {
      role: "user",
      content: USER_MESSAGE
    }
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "rail_design_generated_project",
      schema: AI_GENERATED_PROJECT_SCHEMA,
      strict: true
    }
  }
}
如果某个 OpenAI-compatible 服务不支持 response_format，fallback 为：

{
  model,
  messages: [
    { role: "system", content: SYSTEM_PROMPT + "\n你必须只输出 JSON。" },
    { role: "user", content: USER_MESSAGE }
  ]
}
本地仍然做：

JSON.parse()
validateAiProject()
十四、提示词长度估算
下面是比较重要的部分。

因为你不让用户勾选上下文，所以系统会固定发送一套压缩上下文。当前 catalog 大约是 64 个部件。如果发送 compact catalog，而不是完整 raw catalog，长度是可控的。

估算单位说明
下面估算分两种：

字符数：JSON 字符长度。
token 数：大概估算。JSON/英文/数字较多时，通常 1 token 约 3～4 个字符；中文更接近 1～2 字/ token。这里按偏保守估算。
输入组成估算
内容	估计字符数	估计 tokens
System Prompt	2,500～4,000 chars	1,200～2,200 tokens
User Message 包装文字	300～600 chars	150～300 tokens
用户自然语言需求	50～800 chars	30～500 tokens
输出 JSON schema 简化版	1,500～2,500 chars	500～900 tokens
board / view / layers	500～1,200 chars	150～400 tokens
当前 project placements/connections，小布局	2,000～8,000 chars	600～2,500 tokens
fixedStart + openConnectors + validation + metrics	1,000～5,000 chars	300～1,600 tokens
compact catalog，64 个部件	35,000～70,000 chars	10,000～22,000 tokens
典型请求长度
1. 空项目 / 新建布局
当前项目几乎没有 placements。

约 45,000～80,000 chars
约 13,000～26,000 tokens
主要成本来自 catalog。

2. 当前 demo 项目 / 小布局
例如 6～30 个 placements。

约 50,000～95,000 chars
约 15,000～32,000 tokens
3. 中等布局
例如 100～200 个 placements。

约 90,000～180,000 chars
约 28,000～60,000 tokens
4. 大型布局
例如 500+ placements。

可能超过 250,000 chars
可能超过 80,000 tokens
这时 Anthropic 的 1M context 仍然能承受，但成本和速度会上升明显。OpenAI-compatible 服务是否能承受取决于模型上下文窗口。

如果误发完整 raw catalog
当前 data/tomix-fine-track.catalog.json 完整内容约数千行，含 metadata/sources/notes 等。如果原样塞给 AI：

可能 150,000～300,000+ chars
约 45,000～100,000+ tokens
不推荐。

所以即使 UI 不给用户选项，程序内部也应该永远发送 compact catalog。

十五、推荐 token 控制策略
虽然 UI 不提供上下文选项，但程序可以自动控制。

1. 永远压缩 catalog
只发送：

id, sku, name, kind, tags, connectors, route segments, dimensions
不要发送：

sources, metadata, render, long description
2. placements 很多时自动摘要旧布局
如果当前 placements 超过某个阈值，例如：

> 200 placements
可以发送：

完整 open connectors；
完整 board；
当前 selected/fixedStart 周边的 placements；
总体 metrics；
但不发送全部 placements 细节。
不过第一版可以先不做，等实际遇到大布局再优化。

3. 输出 max_tokens
AI 输出完整 project JSON 时，输出长度可能也不小。

建议：

Anthropic
max_tokens: 16000
对于大布局可以提高到：

max_tokens: 32000
如果未来生成大型完整 JSON，建议用 streaming。

OpenAI-compatible
根据服务支持情况：

max_tokens 或 max_completion_tokens: 8000～16000
不同 OpenAI-compatible 服务字段不统一，这里实现时要兼容。

十六、生成结果展示
AI 返回后，UI 显示：

标题：小型环线与侧线布局
摘要：
使用 S280、C280-45 和一个道岔生成紧凑环线，并加入短侧线。
统计：
部件数量：24
轨道长度：4.28 m
开放端点：2
连接数量：23
警告：
- 当前 catalog 中缺少更短的缓和曲线，因此部分曲线较紧。
- 方案未完全闭合，保留 2 个开放端点用于后续扩展。
按钮：

[替换当前规划 JSON] [复制生成 JSON] [重新生成]
十七、替换当前规划 JSON 的规则
点击替换时：

AI project.placements 替换 state.project.placements
AI project.connections 替换 state.project.connections
AI project.catalogRefs 替换/合并 state.project.catalogRefs
metadata.notes 写入 AI 摘要
保留当前 projectId / name / board / view / layers，除非 AI 返回字段合法且用户明确要求重设画布
我建议第一版替换这些：

state.project.placements = aiProject.placements;
state.project.connections = aiProject.connections;
state.project.catalogRefs = aiProject.catalogRefs || state.project.catalogRefs;
state.project.metadata.notes = aiSummary.description;
保留这些：

state.project.projectId
state.project.name
state.project.board
state.project.view
state.project.layers
这样用户不会因为 AI 返回奇怪 board 而失去画布设置。

十八、本地校验失败时的交互
如果 AI 返回 JSON 解析失败：

AI 返回内容不是合法 JSON。
[复制原始响应] [重新生成]
如果 JSON 合法但项目校验失败：

AI 规划未通过本地校验：
- pieceId xxx 不存在
- connection 引用了不存在的 connector
- connector A 被重复连接
[让 AI 修复] [复制错误] [重新生成]
“让 AI 修复”仍然保持简单，只发：

请修复上一次 JSON，使其通过以下本地校验错误。
只返回完整 JSON。
十九、最终推荐 MVP
我建议第一版只实现：

AI 抽屉窗口；
API 类型 / Base URL / Model / Key；
Key 保存后只显示星号；
一个 textarea；
几个样板提示词按钮；
自动构造上下文；
AI 返回完整 project JSON；
本地校验；
摘要显示；
一键替换当前规划 JSON。
暂时不实现：

多轮聊天历史；
上下文勾选；
多方案比较；
局部 patch；
自动保存；
AI 直接操控画布。
简化后的核心产品体验
用户看到的是：

AI 规划
输入：帮我基于当前布局扩展一个车站和侧线
点击：生成规划
查看：摘要、部件数量、轨道长度、警告
点击：替换当前规划 JSON
背后程序做：

自动带上当前 project + compact catalog + fixedStart + open connectors
AI 返回完整 project
本地验证
应用
这应该是最符合你现在“简单、单机版、GitHub Pages 体验”的版本。