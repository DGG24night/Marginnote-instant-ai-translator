# 即时 AI 翻译插件 — 开发计划

> 依据 `Goal.md` 需求，基于 mn-docs-mcp 官方文档调研结论制定。
> 状态：待确认 → 确认后开始 M0。

---

## 0. 技术调研结论（mn-docs 已核实）

| 议题 | 结论 | 来源 |
|------|------|------|
| 运行时 | JavaScriptCore，无 `fetch`/`setTimeout`/`localStorage`；延时用 `NSTimer` | reference/js-runtime |
| 网络请求 | `NSURLConnection.sendAsynchronousRequestQueueCompletionHandler` + 官方 `base64.js`/`network.js` 封装（`MNNetwork.fetch`），data→JSON 用 `NSJSONSerialization` 直接解析 NSData | guides/network-requests |
| 获取选中文本 | `studyController.readerController.currentDocumentController.selectionText` / `isSelectionText`（只读属性，无事件回调） | reference/marginnote/document-controller |
| 划词触发 | **文档无"选中文本"系统通知**。需 M0 验证：`NSTimer` 轮询 `selectionText` 变化（保底可行）；`PopupMenu.currentMenu()` 在选中弹出菜单期间非空且 `targetWinRect` 提供选区位置 | reference/global/popup-menu |
| 悬浮卡片定位 | `PopupMenu.currentMenu().targetWinRect`（CGRect，只读）可作为选区锚点；边缘自适应在前端/布局层做 | 同上 |
| 生命周期 | `JSB.defineClass('... : JSExtension')`，`sceneWillConnect` 建 UI、`notebookWillOpen` 恢复面板、工具栏按钮走 `queryAddonCommandStatus` | guides/toolbar-and-commands |
| 流式输出 | **NSURLConnection 为一次性整体回调，不支持逐 chunk 接收**。"流式"需降级：非流式请求拿完整结果，前端打字机效果模拟（见风险 R2） | guides/network-requests |
| 发音 | 文档未导出 `AVAudioPlayer`。方案：结果卡片为 WebView，直接内嵌 `<audio>` 播放有道语音 URL（`dict.youdao.com/dictvoice?audio={word}&type=1英/2美`），WebView 是完整浏览器环境，天然支持 | reference/uikit/uiwebview |
| 存储 | 开关/小配置 → `NSUserDefaults`（key 带前缀 `mn_iat_`）；结构化配置（提供商/模型/prompt）→ `documentPath/<AddonId>/config.json`，`NSJSONSerialization` + `writeToFileAtomically`；WebView 禁止 localStorage 存业务数据 | AGENTS.md + guides/cookbook/addon-settings |

---

## 1. 总体架构

```
┌─ MarginNote 宿主 ─────────────────────────────────────────┐
│                                                           │
│  src/ (JavaScriptCore 插件层)                             │
│  ┌──────────────────────┐   NSTimer 轮询 selectionText    │
│  │ SelectionMonitor.js  │──────────────┐                  │
│  └──────────────────────┘              ▼                  │
│  ┌──────────────────────┐   ┌─────────────────────────┐   │
│  │ MNInstantAITranslator│   │ FloatingCardController  │   │
│  │ Addon.js (生命周期)   │──▶│ (结果卡片 WebView 容器)  │   │
│  └──────────────────────┘   └───────────┬─────────────┘   │
│  ┌──────────────────────┐               │ bridge          │
│  │ AIService.js         │◀── WebBridgeCommands.js         │
│  │ YoudaoService.js     │   (命令分发)    │                │
│  │ network.js/base64.js │               │                │
│  │ SettingsStore.js     │               ▼                │
│  └──────────────────────┘   ┌─────────────────────────┐   │
│                             │ WebPanelController      │   │
│                             │ (设置面板 WebView, 已有) │   │
│                             └───────────┬─────────────┘   │
└─────────────────────────────────────────┼─────────────────┘
                                          │ mnaddon://bridge
┌─────────────────────────────────────────▼─────────────────┐
│  web/ (React + Vite, 运行于 UIWebView)                     │
│  ?view=settings → 设置面板（提供商/模型/prompt/外观）        │
│  ?view=card     → 结果卡片（翻译卡/词典卡，<audio> 发音）    │
│  统一 MNBridge.send(command, payload)                      │
└───────────────────────────────────────────────────────────┘
```

**关键设计决策**

1. **双 WebView**：设置面板复用模板 `WebPanelController`；结果卡片新建 `FloatingCardController`（独立 UIWebView、透明背景、无边框、跟随选区定位）。两处共用同一份前端 bundle，用 URL query `?view=settings|card` 分流路由。
2. **业务逻辑下沉插件层**：AI 请求、有道请求、prompt 渲染、判定规则（单词/句子）全部在 `src/` 完成；Web 层只做展示和设置表单，通过 bridge 拿数据。
3. **统一 AI 协议**：以 OpenAI Chat Completions 兼容协议为统一接入层，预置 OpenAI / DeepSeek / Moonshot / 智谱 / 自定义 baseURL，覆盖"多提供商多模型"需求。
4. **API Key 只存本地**：`NSUserDefaults` 或本地 JSON，请求只发往用户配置的提供商 endpoint。

---

## 2. 模块与文件规划

### src/（插件层，JavaScriptCore）

| 文件 | 职责 | 备注 |
|------|------|------|
| `main.js` | 仅 `JSB.require` 入口 | 已有，追加 require |
| `base64.js` | Base64 解码（文档原文照抄） | 新增 |
| `network.js` | `MNNetwork.fetch` 封装（文档原文照抄） | 新增 |
| `SettingsStore.js` | 配置读写：NSUserDefaults（开关）+ config.json（提供商/模型/prompt），带 schema 版本与默认值兜底 | 新增 |
| `SelectionMonitor.js` | NSTimer 轮询选区；判定单词/句子；触发悬浮按钮或直接触发翻译；全局标识符加 `mnIAT` 前缀/IIFE | 新增，核心 |
| `AIService.js` | OpenAI 兼容协议调用：chat/completions、temperature、reasoning effort（按提供商能力传参）、超时与错误规范化 | 新增 |
| `YoudaoService.js` | 有道查词接口调用与结果解析（音标/释义/词性） | 新增 |
| `PromptTemplates.js` | 默认翻译/解释 prompt 模板，`{text}`/`{target_lang}` 占位符渲染 | 新增 |
| `FloatingCardController.js` | 结果卡片原生容器：UIWebView、定位（锚定 `targetWinRect`，边缘翻转）、显隐动画、点击外部关闭 | 新增，核心 |
| `WebBridgeCommands.js` | bridge 命令注册表扩展 | 在模板基础上扩展 |
| `WebPanelController.js` | 设置面板 | 模板已有，微调 |
| `MNInstantAITranslatorAddon.js` | 生命周期编排：创建/销毁两个控制器、启动停止 SelectionMonitor | 改造 |

### web/（React 前端）

| 文件 | 职责 |
|------|------|
| `src/App.jsx` | 按 `?view=` 分流到 Settings / Card |
| `src/settings/SettingsView.jsx` | 设置面板主页 |
| `src/settings/ProviderSection.jsx` | 提供商 CRUD + 模型列表 + API Key 输入 |
| `src/settings/PromptEditor.jsx` | 查词/翻译 prompt 编辑，变量提示，恢复默认 |
| `src/settings/GeneralSection.jsx` | 触发方式、目标语言、字号、主题、发音开关与英/美音 |
| `src/card/ResultCard.jsx` | 卡片骨架：加载态/错误态/结果态、复制按钮、关闭 |
| `src/card/TranslateResult.jsx` | 翻译结果展示（打字机模拟流式） |
| `src/card/DictResult.jsx` | 词典结果：音标 + 发音按钮（`<audio>`）+ 释义 + "AI 解释"切换 |
| `src/lib/mnBridge.js` | 已有，不动 |
| `src/lib/theme.js` | 亮/暗主题 token、字号档位 |

### Bridge 命令清单（`WebBridgeCommands.js`）

| command | 方向 | 说明 |
|---------|------|------|
| `getConfig` / `saveConfig` | Web→插件 | 读取/保存全部配置（config.json） |
| `testProvider` | Web→插件 | 验证 API Key 连通性（最小请求） |
| `translate` | Web→插件 | 发起翻译（卡片加载后由前端发起，插件层请求 AI 并回推结果） |
| `lookup` | Web→插件 | 发起有道查词 |
| `copyText` | Web→插件 | 写剪贴板（UIPasteboard） |
| `closeCard` | Web→插件 | 关闭结果卡片 |
| `pronounce` | （前端自行 `<audio>` 播放，无需 bridge） | — |
| 已有 `ping`/`echo`/`closePanel` | — | 保留 |

---

## 3. 数据流（一次划词翻译）

1. `SelectionMonitor` 轮询发现 `selectionText` 变化且非空 → 读取 `PopupMenu.currentMenu().targetWinRect` 锚点。
2. 判定：`/^[A-Za-z][A-Za-z\-']*$/` 单词 → 查词流；其余 → 翻译流。
3. 按设置决定：直接展示卡片并进入加载态，或先显示悬浮小按钮、点击后再展示。
4. `FloatingCardController` 在锚点附近放置 WebView 卡片（边缘自动翻转），加载 `?view=card`。
5. 卡片前端 ready 后发 bridge `translate`/`lookup`（携带 text）→ 插件层请求 → 结果回推（`evaluateJavaScript` 或 bridge response）→ 渲染。
6. 单词卡：前端用 `<audio src="dictvoice...">` 自动发音（若设置开启）；可一键切"AI 解释"（再走 `translate` 命令，用解释 prompt）。
7. 复制：`copyText` → UIPasteboard；失败/超时：卡片错误态 + 重试按钮。

---

## 4. 存储设计

- `NSUserDefaults`（key 前缀 `mn_iat_`）：面板显隐、窗口 frame（模板已有）、主题、字号、触发模式、发音开关、英/美音、目标语言。
- `documentPath/<AddonId>/config.json`（schema `version: 1`）：
  ```json
  {
    "providers": [{ "id": "...", "name": "DeepSeek", "baseURL": "...", "apiKey": "...", "models": [{ "id": "deepseek-chat", "supportsReasoning": false }] }],
    "routing": { "translate": { "providerId": "...", "modelId": "...", "temperature": 0.3, "reasoningEffort": "off" },
                 "lookup":    { "...": "..." } },
    "prompts": { "translate": "...", "explain": "..." },
    "targetLang": "zh-CN"
  }
  ```
- 读：空文件/非法 JSON → 默认值兜底；写：`NSData.writeToFileAtomically(path, true)`。

---

## 5. 里程碑

| 里程碑 | 内容 | 验收标准 |
|--------|------|----------|
| **M0 技术验证** | 轮询选区可行性；`PopupMenu.targetWinRect` 锚点取值；空白 WebView 卡片定位显隐 | ✅ 已通过真机验证（划词稳定出卡、位置贴近选区）；锚点读取加了 3 次重试 |
| **M1 基础设施** | base64/network 引入；SettingsStore；AI/有道 service 骨架；bridge 命令框架 | ✅ 已实现（含真流式 MNIATStream），待真机验证 |
| **M2 翻译闭环** | 划词→判定→卡片→AI 翻译→展示→复制→错误态 | ✅ 已实现（流式增量推送卡片），待真机验证 |
| **M3 查词闭环** | 有道查词、发音（英/美）、AI 解释切换、复制 | ✅ 已实现（WebView `<audio>` 发音），待真机验证 |
| **M4 设置面板** | 提供商/模型 CRUD、分别路由、temperature/reasoning、prompt 编辑、目标语言、字号、主题、触发模式 | ✅ 已实现（React 设置页，改动即存），待真机验证 |
| **M5 打磨发布** | 边缘翻转、动画、暗色主题走查、超时/重试、空状态；`pnpm build` 出 `.mnaddon` | 按 Goal.md 逐项核对清单通过 |

---

## 6. 风险与待确认项

- **R1 划词触发**：文档无选中事件通知，轮询方案（300ms）保底可行但需实测性能与时机（轮询到文本时选择菜单可能尚未弹出，锚点需延迟一帧再取）。**M0 首先验证**。
- **R2 流式输出**：JSCore 网络栈不支持真流式。拟降级为"非流式请求 + 前端打字机模拟"。若必须真流式，需探索 `NSURLSession` dataTask delegate 是否导出（文档未见，成功率低）。
- **R3 有道接口**：免费 web 接口（`dict.youdao.com/jsonapi_s`）无 key 可用但非官方承诺；发音 URL 为公开 CDN 相对稳定。备选：支持填有道智云 key 走官方 API。
- **R4 reasoning effort**：各提供商参数不统一（OpenAI `reasoning_effort`、DeepSeek `reasoner` 模型等），按提供商能力白名单传参，不支持的忽略。
- **R5 UIWebView 兼容**：发布构建已按模板走经典单 bundle（无 ESM），React 19 特性需保守使用。

---

## 7. 已确认决策（2026-08-06）

1. **流式**：优先探索真流式 → ✅ 已确认可行：`NSURLConnection.connectionWithRequestDelegate(request, delegate)` 支持 delegate 回调（`connectionDidReceiveData` 分块接收）。方案：NSMutableData 缓冲 + 按 `\n` 切分（UTF-8 续字节 ≥0x80 不含 0x0A，按行切割安全）+ SSE 解析。M0 一并验证；打字机模拟作为降级保底。
2. **查词接口**：默认有道免费 web 接口（无需 key），发音走 `dictvoice` CDN；后续可扩展智云 key。
3. **执行**：直接进入 M0 技术验证（划词监听 + 锚点 + 卡片显隐 + 流式 delegate）。
