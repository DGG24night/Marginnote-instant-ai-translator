# 更新日志

## v0.7.7（2026-08-22）

### 新功能

- **拼接模式（跨页段落手动拼接翻译）**：段落/句子被页面截断时，可手动拼接跨页内容再翻译。
  - **进入**：双击卡片工具栏「图钉」进入拼接模式（卡片自动固定，编辑区显示最近一次划词的原文）；再次双击图钉或点「退出」按钮退出。
  - **划词追加**：拼接模式下继续在文档中划词（可翻页），每次选区自动智能连接进编辑区，不触发翻译/查词、不关闭卡片。
  - **编辑修正**：编辑区为可编辑文本框，可增删改、调整顺序；追加内容自动滚动到底部（始终看到最新追加段）。
  - **开始翻译**：点「开始翻译」用编辑后的完整文本走正常翻译/查词流程（AI 与机器翻译均适用），完成后自动退出拼接界面。
  - **智能连接（smartJoin）**：PDF 跨行连字符断词自动去连字符（`inter-`+`national` → `international`）、句子终止符（`。！？.!?`）后换行、CJK 直连、英文单词间补空格。
  - **pinned 恢复**：进入拼接前未固定 → 翻译完成后自动取消固定（方便点空白关闭卡片）；进入前已固定 → 翻译后保持固定。
  - 拼接翻译不注入 `{context}`（拼接文本跨页，原上下文提取定位会误报 HUD）。
  - 卡片高度随拼接内容增长（最大高度提升至 500px），文本过长时编辑区内部滚动、按钮固定可见。

### 修复

- **有道查中文不返回对应英文单词**：有道 `/m/result` 页面只对英文词返回词典词条，查询中文时页面无词条、解析不到对应英文，而其他查词服务（必应/海词/金山）查中文都能返回英文。改为检测到中文时改走有道 suggest 接口（`dict.youdao.com/suggest`），返回对应的英文释义（实测 `q=苹果` → explain `"apple"`），词头保留为中文输入，与其他查词服务查中文的行为保持一致。
- **拼接模式右下角缩放箭头遮挡「退出」按钮**：缩放箭头图标向卡片右下角更靠里（缩窄内边距，图标尺寸 20→18、字号 14→12），并给内容区底部操作按钮容器右侧让出空隙（`padding-right: 18px`），避免遮挡最右侧的「退出」按钮。
- **搜索功能写入查词/翻译缓存**：`bypassCache` 原先同时跳过读取与写入，导致搜索框查到的词不进查词历史、也不覆盖旧缓存值。改为仅跳过读取、写入仍发生——新结果覆盖旧缓存值、搜索词由此进入查词历史（AI 翻译的 `bypassCache` 语义同步对齐）。

### 体验优化

- **滚动条静止自动隐藏、仅滚动时显示**（设置页 + 结果卡片）：macOS WebView 的原生滚动条不响应 CSS `::-webkit-scrollbar` 颜色淡化，即使淡化成透明仍常驻。改为掐断原生滚动条：关闭卡片与设置页两处 WebView `UIScrollView` 的滚动指示器，根级不再滚动（内容放进带 `overflow` 的容器内滚动，滚动条归 CSS 控制），全局隐藏 HTML 滚动条、滚动进行时由 JS 给滚动容器临时加 `.mniat-scroll-visible`（停止滚动 600ms 后隐藏）。
- **查词结果不显示滚动条**：查词卡片高度随内容自适应，直接收起纵向滚动（`.card-page.dict-mode .card-body { overflow-y: hidden }`），保证查词页完全不出现滚动条。
- **AI 服务商测试支持「取消测试」**：单模型「测试中…」与「批量测试中…」按钮 hover 时切换为「取消测试」，点击即取消——复位 UI、批量测试停止后续模型；后台仍在跑的请求结果会被丢弃（网络层无法真正中止，仅前台丢弃显示）。

## v0.7.6（2026-08-17）

### 修复

- **脑图模式下卡片「图钉」失效**：图钉的 `pinned` 检查原本只存在于 `onLostFocus`（blur）路径，而脑图模式下点击空白走的是选区监听的 `onBlankClick` 路径（直接 `FloatingCard.hide()`，无 pinned 检查）→ 打开图钉点击脑图空白仍关闭卡片。修复：`FloatingCardController` 新增 `isPinned()` 查询；`SelectionMonitor` 在「点击空白关闭」两处判定（选区清空 / 同 noteId 残留）加入 `!isCardPinned()` 条件，pinned 时走 `onClear`（仅收起悬浮按钮）而不关闭卡片，且不置 `blankClosed`（取消固定后再次点空白可正常关闭）；`MNInstantAITranslatorAddon` 注入 `isCardPinned` 回调桥接。文档模式 blur 路径保持原 pinned 检查。
- **查词卡片抽搐（重新触发同文本死循环）**：上一轮把 `MNIATSelectionMonitor.notifyCardClosed` 放在 `TranslateFlow.cancelCurrent` 里调用，但 `handleSelection` 第一行也是 `cancelCurrent`（用于取消上一次查词/翻译的 session），结果每次触发查词都清空 `lastFiredText`，下一轮 tick 读到同一 `selectionText` 因 `text !== lastFiredText` 重新触发，形成"选中→触发→cancel→清空→再触发"死循环（卡片抽搐）。改为把 `notifyCardClosed` 移到 `FloatingCardController.hide`（所有关闭路径 onBlankClick / onLostFocus / closeCard bridge / notebookWillClose 都走 hide），从 `TranslateFlow.cancelCurrent` 移除——只在卡片真正关闭时清空 `lastFiredText`。
- **拖拽排序到末尾位置失效**（同上一轮，新增）：拖到末尾之后时无行可挂 `drop-before` 类，蓝色定位条无家可归。改为独立 `.drop-indicator` 元素（绝对定位）由 `useDragSort` 暴露的 `indicatorTop`（相对 `listEl` 顶部偏移）实时定位，覆盖任意插入位置（含末尾之后）。`moveItem` 不动（splice 已正确处理 `to=rows.length`）。
- **拖拽过程中出现蓝色文本选区覆盖**：`useDragSort.startDrag` 增加 `window.getSelection().removeAllRanges()` 清除 mousedown 残留选区；CSS 加 `.drag-list / .drag-handle` 的 `user-select: none` + `-webkit-user-drag: none` + `-webkit-tap-highlight-color: transparent`，关闭 macOS 系统拖拽半透明矩形与文本选区高亮。
- **关闭卡片后再次选中同一单词无法触发查词**（含失焦关闭路径）：上一轮试图在选区监听 tick 内用 `blankClosed` / `menuJustShown` 判定同文本是否重新触发，但**失焦关闭（onLostFocus）路径不经过 monitor**，且菜单与 `selectionText` 持续显示，导致 `menuJustShown=false`、`blankClosed=false`，仍走「重复忽略」分支。改为从根源修：新增 `MNIATSelectionMonitor.notifyCardClosed()`，由 `FloatingCardController.hide`（所有关闭路径都走）在卡片关闭时统一调用清空 `lastFiredText` / `lastFiredNoteId` / `lastFiredAt` / `blankClosed`；再次选中同一文本时 `text !== lastFiredText`，等同首次选中，正常触发查词/翻译。覆盖点空白（onBlankClick）与失焦（onLostFocus）两条关闭路径。
- **卡片正文 markdown 水平线排版**（2026-08-15）：`---` 分隔线前后无空行时会被渲染成 `## ---` 二级标题（导致音标/释义等小节字体变大、排版错乱）。新增 `normalizeCardBody`：保存卡片前自动在 `---` 上下补空行（已带空行不重复），查词 / AI 解释 / 翻译三种模式的卡片统一生效。
- **AI 解释卡片回退保护**（2026-08-15）：查词服务为「AI 解释」时跳过摘录回退重试——摘录正文本身就是 AI 解释输出，再跑一次 AI 解释无意义且易触发重复请求。
- 移除「自动删除正文首行重复标题」逻辑（保留 AI 返回的完整原始内容）。

### 新功能

- **设置页「服务提供商」手动排序（bar 图标拖拽）**：
  - 每个提供商卡片与每个模型行前新增 bar 图标（与结果卡片工具栏最左侧三横线图标同款），拖动可调整顺序：AI 提供商、各提供商内模型、机器翻译服务均可独立排序。
  - 顺序持久化到配置（`config.providers` / `providers.<id>.models` / `config.machineProviders`）；长按「重新生成」的模型列表渲染同一份数据，顺序与手动排序自动一致。
  - 拖拽基于 mouse 事件实现（兼容 UIWebView 老内核）：拖动中显示插入位置横线，松开鼠标一次性保存。
- **AI 服务提供商「添加」入口移至列表底部**：原顶部"从预设添加 + 添加提供商"下拉与按钮移到所有已添加 provider 卡片之后，便于在已有列表下方继续追加。
- **机器翻译服务商支持折叠 ID/KEY**：服务名称前加与 AI provider 同款 ▶ 折叠按钮，默认折叠 SecretId / SecretKey / AccessKey 等敏感字段；点击 ▶ 展开。
- **查词卡片音标与释义之间加分隔线**：保存查词卡片时，`buildDictBody` 在音标部分与释义部分之间插入 `---`（上下各空一行），分隔线规范化由 `normalizeCardBody` 兜底。仅两部分都存在时插入。

### 体验优化

- **AI 服务提供商卡片折叠态紧凑化**：折叠时（仅显示 head）卡片从原 ~90px 压到 ~50px 高——`.provider-card` padding 由 `14` 减到 `10/12`，`.provider-head` 折叠态 margin-bottom 归零（仅展开时给 body 留空隙），head 内元素统一 `gap: 6px`，删除按钮 `margin-left: auto` 贴右、name 与 meta 在左，左右对称；机器翻译卡片同步收紧。
- **删除机器翻译服务卡片绿色 vendor 标签**：移除 `.machine-vendor-tag`（"百度"/"小牛"/"阿里云"/"腾讯云"/"火山"），卡片视觉更简洁。

## v0.7.5（2026-08-15）

### 新功能

- **prompt 上下文变量 `{context}` + 选区上下文设置**：
  - Prompt 模板支持 `{context}`：划词翻译/解释时从当前页文本层取选区前后文注入，帮助 AI 理解语境。
  - 常规设置新增「选区上下文长度」（默认 200 字符、0=关闭）；提取失败降级为空串，不影响请求。
  - 缓存键纳入上下文摘要（`cXXX` 段），同一句不同上下文不互串缓存。
  - PDF 文本层按 `char: codePoint` 结构还原（白名单键 + `String.fromCharCode`），兼容键名不稳定的 NSArray。

- **工具栏「添加」按钮（保存卡片）**：
  - 查词/AI 解释模式在发音按钮之后、翻译模式在搜索按钮之前，使用用户提供的「＋」图标。
  - 查词 → 单词为标题、音标+释义为正文；AI 解释 → 单词为标题、解释为正文；翻译 → 原句为标题、译文为正文。
  - Markdown 模式默认开启；查词卡片正文自动排版（**音标** 英/美分行 + **释义** 按词性分行）。
  - 创建卡片自动在原文标黄（`highlightFromSelection`），点击脑图节点可跳转原文；`undoGrouping` 包裹可撤销。

- **卡片颜色设置**：
  - 常规设置新增「卡片颜色」分类（独立区块）：翻译卡片颜色 / 查词·AI 解释卡片颜色，1-16 色块（4×4 弹窗，向上展开，深色块白字）。
  - 颜色随任务类型自动应用（`note.colorIndex`）。

- **触发翻译的单词数设置**：
  - 常规设置「通用」区新增「触发翻译的单词数」（默认 3）：选区单词数大于此值走翻译，否则按查词（英文按空格分词、中文按字符算），支持用查词服务查词组。

- **选中卡片（含图片摘录/脑图模式）触发翻译/查词**：
  - 选中卡片优先用标题（`noteTitle`）触发，失败自动回退摘录正文（`excerptText`）重试一次。
  - 脑图模式（无文档打开）通过 `notebookController.focusNote` 读取焦点笔记；图片摘录同样按普通卡片处理（OCR/备注文本可触发）。

### 修复

- **划词闪退**：移除上下文提取链路中的 ObjC 高风险调用（`NSJSONSerialization` 序列化文本层、`MNUtil.getCurrentSelection()`）——JSCore try/catch 捕获不了 ObjC 异常；改为纯数组索引 + 白名单键读取。
- **选中已摘录文本误用卡片正文**：不再校验「摘录内容是否来自原文」，改为标题优先、正文回退；`from/to 相同` 错误通过自动回退消除。
- **脑图模式选区不触发 / 点击空白不关闭卡片**：
  - 焦点笔记读取增加 `notebookController` 兜底（脑图模式无文档控制器）。
  - 点击空白关闭卡片：菜单边缘信号 + 距上次触发时序保护（1.2s）+ 焦点笔记 `noteId` 残留识别 + `blankClosed` 防重触发；脑图模式卡片跟随 MN 菜单显示/消失。
  - 点击空白不再误弹「翻译插件诊断」HUD（仅存在选中信号时诊断）。
- **卡片选中态不再弹「上下文未定位到选区」HUD**：卡片来源跳过上下文提取（文档划词不受影响）。
- 设置页常规区按「通用 / 查词 / 翻译 / 卡片颜色」分组；色块去边框、方形、紧凑式选择器。

## v0.7.4（2026-08-14）

### 新功能

- **机器翻译结果适配打字机效果**：
  - 从 `AIService.js` 抽出共用的打字机模拟器 `simulateTyping(full, handlers)`（AI 翻译/解释与机器翻译共用同一实现与节奏，`30ms` tick、总时长约 3s、步长自适应）。
  - `TranslateFlow.runMachineTranslate` 在「打字机效果」开启时，机器翻译返回结果改为逐字推送 `delta` 事件（与 AI 翻译同一通道），播完再推 `translateResult`；关闭时保持原一次性整体展示。缓存命中仍直接整体展示（与 AI 缓存命中行为一致）。
  - 机器翻译打字机句柄挂载到 `job.session`：划词新任务 / 重新生成会自动取消进行中的打字计时器，避免陈旧事件污染。

- **卡片高度随打字机逐渐增大并封顶**：
  - `cardReady` bridge 现在返回卡片高度上下限（`minHeight`/`maxHeight`），前端测量后按此钳制上报，杜绝超过原生最大高度导致的溢出。
  - 打字机播放期间卡片高度**只增不减**（单调递增）：markdown 局部渲染（代码块/标题未闭合等）导致的测量回缩不再引发卡片上下抖动，卡片随内容逐行平滑长高；播放完成后按最终内容精确落位。
  - 达到最大高度后卡片停止增长，文字在卡片内部滚动、不再向下推动，查看结果位置稳定；其他模式（词典、非打字机、菜单/历史面板）的滚动与布局行为保持不变。

- **长按「重新生成」的模型列表接入机器翻译服务**：
  - 模型选择器新增「机器翻译服务」分组（仅翻译任务且已配置机器翻译账户时显示，可折叠，风格与 AI 供应商分组一致），点击任意已配置账户即用该账户重新生成当前翻译。
  - bridge `regenerate` 支持 `{ machineProviderId }` 载荷；插件侧 `MNIATFlow.regenerate` 按「显式机器翻译覆盖 > 显式 AI 覆盖 > 常规设置『翻译服务』」路由，`runMachineTranslate` 支持 `machineOverride` 临时覆盖提供商（不写回 `machineRouting`，接口类型/领域仍取路由配置）。
  - 顺带修复：`runMachineTranslate` 路由提供商缺失时不再抛裸异常，改为友好错误提示。

### 修复

- **长文本翻译时卡片高度不随打字机增长、播完才一次性展开**（用户实测反馈）：
  - 根因（最终版）：卡片高度测量使用定时器做 debounce/轮询，但定时器注册在依赖 `state` 的 effect 内——打字机期间 delta 每 30ms 更新一次 state，每次渲染都会先清除上一个未到期的定时器（50ms `setTimeout` 或 60ms `setInterval`）再重新注册，由于 delta 间隔小于定时器周期，**测量永远等不到触发**，直到打字机播完（不再有 delta）才执行，表现为卡片高度最后一次性跳到最终高度。
  - 修复：`CardPage.jsx` 将测量函数存入 `doMeasureRef`（每次渲染更新最新上下文），定时器统一经 ref 调用；**streaming 期间的 `setInterval(60ms)` 只在「进入/退出 streaming」时启停**（依赖仅 `isStreaming`，不再随每次 delta 重建），卡片高度随逐字输出同步渐进增长（仍受 [80, 420] 钳制、期间只增不减）；非打字机状态（done / 词典 / 加载 / 菜单与历史面板）保持一次性测量与原有布局行为不变。

- **选中「已创建摘录的文本」无法触发翻译/查词**（用户实测反馈）：
  - 根因：选中已摘录文本时，MarginNote 进入摘录笔记选中态，文本选区接口 `selectionText` 为空（`isSelectionText=false`），划词监听读不到文本，弹出一次性诊断提示且不触发。
  - 修复：`SelectionMonitor.js` 新增摘录回退——菜单弹出且主路径读不到文本时，从当前文档控制器的焦点笔记（`visibleFocusNote` / `focusNote` / `lastFocusNote`）读取 `excerptText` 作为选中文本（仅信任 `docMd5` 与当前文档一致的摘录，避免误读脑图/其他文档笔记）；诊断提示只在「文本选区 + 摘录回退」都失败时才显示，并补充回退状态字段便于后续排查。

## v0.7.3（2026-08-13）

### 设置页体验优化

- **常规页**：把「查词自动发音」「打字机效果」「记住卡片大小」三个勾选项从双列下拉区**下移**到一个紧凑的「偏好」栅格区域，让上半页只保留下拉和数字输入项，页面更整洁（不破坏任何功能）。
- **提供商页**：
  - 删除「AI 服务提供商」和「机器翻译服务」标题后的灰色 hint 小字。
  - 添加机器翻译的下拉选项名简化（去掉副标题描述）：「百度翻译 / 小牛翻译 / 阿里翻译 / 腾讯翻译 / 火山翻译」，长度统一。
  - 机器翻译卡片删除按钮**改成垃圾桶图标**+「确认删除？」两步交互（首次点垃圾桶，进入二次确认态，3 秒无操作回退；再点一次才真正删除），与 AI ProviderCard 一致。机器翻译卡片抽成 `MachineProviderCard` 组件复用 `confirmingDelete` + `confirmTimerRef`。
- **路由页**：删除「机器翻译路由」标题下方那段「常规设置『翻译服务』= 机器翻译时生效...」提示文字。
- **敏感字段默认隐藏 + 眼睛切换**（用户要求）：
  - AI 提供商的 API Key、机器翻译全部 ID/密钥字段（百度/小牛 APPID + Secret Key、阿里云 AccessKey ID/Secret、腾讯 SecretId/SecretKey、火山 AccessKey ID/SecretAccessKey）**默认以密文圆点（····）显示**。
  - 每个敏感输入框右侧新增**眼睛按钮**（用户提供的 yanjing SVG 图标），点击切换明文/密文，再点收回；眼睛高亮表示当前为明文显示态。
  - 实现：新增 `SecretInput` 组件（内部 state 切换 `type="password"` / `"text"`）+ `EyeIcon`（EYE_PATHS 常量）+ `.secret-input-wrap` / `.secret-eye-btn` 样式。

### 新功能

- **接入百度机器翻译（开放平台，无需 AI Key）**（依据 fanyi-api.baidu.com doc/21/23/24 官方文档实现）：
  - 新增 `src/BaiduMachineTranslateService.js`，封装百度三种接口：
    - **大模型文本翻译**（`ait/api/aiTextTranslate`）：大模型理解能力，翻译更自然，可选翻译指令（当前固定 `model_type=llm`）；
    - **通用文本翻译**（`api/trans/vip/translate`）：标准接口，适合日常翻译；
    - **领域文本翻译**（`api/trans/vip/fieldtranslate`）：按领域优化，支持 11 个领域（信息技术/金融财经/机械制造/生物医药/网络文学/学术论文/航空航天/人文社科/新闻资讯/法律法规/合同），领域翻译仅支持中英互译。
  - 新增 `src/MD5.js`（纯 JS MD5，JSCore 无内置）：用于百度签名 `sign=md5(appid+q+salt+密钥)`（领域接口为 `md5(appid+q+salt+domain+密钥)`）；已用官方示例向量 + python hashlib 交叉验证。
  - **设置页三处改造**：
    - 「服务提供商」页：**AI 服务提供商折叠为可展开区块**（默认收起）；新增「机器翻译服务」配置区，填写百度 APPID 与密钥（可添加多个账户，架构上支持后续接入其他机器翻译服务商）。
    - 「模型路由」页：新增「机器翻译路由」区块——选择机器翻译提供商、接口类型（大模型翻译 / 通用文本翻译 / 领域文本翻译），选「领域文本翻译」时出现**二级菜单**选择领域。
    - 「常规」页：新增「翻译服务」设置，可选 **AI 翻译** 或 **机器翻译**（句子/段落翻译引擎，AI 翻译走原模型路由）。
  - 机器翻译结果走翻译缓存（键 `mt:<提供商>:<接口类型>[:领域]:文本`），历史记录正常收录；「重新生成」重跑并跳过缓存。

### 新功能（追加）

- **接入小牛翻译（通用文本 Flash / Pro）**（依据 niutrans.com/documents/contents/transapi_text_v2 官方文档实现）：
  - 新增 `src/NiuTransMachineTranslateService.js`（`MNIATNiuTrans`），封装两种产品：
    - **通用文本 Flash**（`POST /v2/text/translate`）：高并发低延迟，适合批量短文本；鉴权 `appId + timestamp + authStr`，`authStr = md5(apikey + 各参数按参数名 ASCII 升序拼接)`（空参数不参与、authStr 自身不参与）；
    - **通用文本 Pro / 大模型**（`POST /v2/text/translate/llm`）：强上下文理解，适合长文本与专业内容；鉴权直接传 `apikey` 字段（无需 appId）。
  - 机器翻译账户结构扩展 `vendor` 字段（`baidu` / `niutrans`）：「机器翻译服务」配置区可添加百度或小牛账户（小牛只需 API Key，Flash 额外需要 APPID）；「机器翻译路由」页按所选提供商动态显示接口选项（百度：大模型/通用/领域；小牛：Flash/Pro），缓存键区分 vendor（`mt:<提供商>:<vendor>:<接口类型>...`）。
  - `SettingsStore` 对 v0.7.3 早期无 `vendor` 字段的账户自动兜底（名称含「小牛」→ niutrans，否则 → baidu）。

### 新功能（追加）

- **接入阿里云机器翻译（通用版 / 专业版）**（依据 help.aliyun.com 机器翻译 TranslateGeneral / Translate 文档与《RPC 调用机制》实现）：
  - 新增 `src/SHA1.js`（纯 JS SHA1 + HMAC-SHA1 + Base64，JSCore 无原生 crypto）：已用标准 SHA1/HMAC 向量 + **阿里云 RPC 官方签名示例**（`testid`/`testsecret` → `9NaGiOspFP5UPcwX8Iwt2YJXXuk=`）+ python hmac 交叉验证通过。
  - 新增 `src/AliyunMachineTranslateService.js`（`MNIATAliyunMT`），封装两种接口（Version=2018-10-12，endpoint `mt.cn-hangzhou.aliyuncs.com`）：
    - **通用版 TranslateGeneral**（Scene 固定 general）；
    - **专业版 Translate**（Scene 必填：商品标题 title / 商品描述 description / 商品沟通 communication / 医疗 medical / 社交 social / 金融 finance）。
  - 鉴权：阿里云 RPC 签名（无需 APPID）——`Signature = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))`，StringToSign 按「公共参数 + 业务参数合并 → 字典序排序 → RFC3986 percentEncode → CanonicalizedQueryString」构造；请求 POST、全参数（含 Signature）放 URL query（与官方 SDK 一致）。`SourceLanguage=auto` 自动识别原文语言。
  - 机器翻译账户支持 `vendor=aliyun`（字段 AccessKeyId / AccessKeySecret）：「机器翻译服务」配置区可添加阿里云账户；「机器翻译路由」页按提供商显示接口选项（阿里云：通用版 / 专业版，选专业版时出现**场景二级菜单**）；缓存键区分 scene（`mt:<id>:aliyun:pro:<scene>:text`）。
  - `SettingsStore` 兜底增强：无 `vendor` 账户按名称推断含「阿里」→ aliyun；`machineRouting` 新增 `scene` 字段（默认 title）；`apiType` 白名单扩展为百度/小牛/阿里云全部取值（顺带修复小牛 `flash`/`pro` 被误归一为 `llm` 的隐患）。
  - 修复：**RPC 签名 percentEncode 漏编码 `! ' ( )`**（`encodeURIComponent` 不编码这 4 个字符）——含括号/感叹号的文本（如 `Poly(MMA)`）签名时括号为字面量、服务器按 RFC3986 重算为 `%28%29`，导致 `SignatureDoesNotMatch`。已补全编码（只保留 `A-Z a-z 0-9 - _ . ~`），并用服务器返回的真实 string to sign 逐字符复现验证通过。
  - 修复：**成功判定 `data.Code !== 200` 严格比较误判**（用户开通服务后实测报"未知错误（错误码 200）"）——JSCore 桥接下 `Code` 可能是数字 200、字符串 `"200"` 或 NSNumber 对象，严格 `!==` 会把成功当失败。改为宽松判定 `data.Code == 200 || String(data.Code) === "200"`，并补 `Message`（含 NSNull）容错与空译文校验；mock 覆盖 6 种场景全部通过。

### 新功能（追加）

- **接入腾讯云机器翻译（TMT 文本翻译）**（依据 cloud.tencent.com TextTranslate 接口文档与《API 3.0 签名方法 v3》实现）：
  - 新增 `src/SHA256.js`（纯 JS SHA256 + HMAC-SHA256 + 字节/hex 工具，JSCore 无原生 crypto）：已用标准 SHA256/HMAC 向量 + **腾讯云 TC3 官方示例的 HashedRequestPayload / HashedCanonicalRequest 精确匹配** + python 全链路交叉（含二进制派生密钥链）验证通过。
  - 新增 `src/TencentMachineTranslateService.js`（`MNIATTencentMT`）：文本翻译 `TextTranslate`（`POST https://tmt.tencentcloudapi.com/`，Version=2018-03-21，Source=auto 自动识别原文语言，ProjectId=0）。
  - 鉴权：**TC3-HMAC-SHA256**（SecretId/SecretKey，无需 APPID）——CanonicalRequest（content-type;host;x-tc-action 最小签名集）→ StringToSign → 派生密钥链（`SecretDate = HMAC("TC3"+SecretKey, date)` → SecretService → SecretSigning）→ Authorization 头；**date 必须 UTC+0**（从时间戳换算）；签名用 `JSON.stringify` 生成 payload、发送用 `options.body`（UTF-8 字节），保证「签名串 = 实际发送 body」。

### 新功能（追加）

- **接入火山引擎机器翻译（TranslateText）**（依据 docs.volcengine.com docs/4640/65067 与《签名算法 v4》文档实现）：
  - 新增 `src/VolcengineMachineTranslateService.js`（`MNIATVolcengineMT`）：文本翻译 `TranslateText`（`POST https://translate.volcengineapi.com/?Action=TranslateText&Version=2020-06-01`，Service=translate，Region=cn-north-1）。业务参数 `TargetLanguage` + `TextList`（数组，单次最多 16 段或 5000 字符），`SourceLanguage` 不传即自动检测。响应 `TranslationList[].Translation` + `DetectedSourceLanguage`，错误在 `ResponseMetadata.Error`。
  - 鉴权：**v4 HMAC-SHA256**（AccessKeyId/SecretAccessKey，无需 APPID）——CanonicalRequest（POST 最小签名集 `host;x-date`，Action/Version 放 query 参与签名）→ StringToSign → **派生密钥链第 2~4 层用 hex 解码后的 32 字节二进制作 HMAC 密钥**（非 UTF-8 编码；按官方示例 kRegion=`2f41e8...` python 复算验证）→ Authorization 头；签名用 `JSON.stringify` 生成 payload、发送用 `options.body`（UTF-8 字节），保证「签名串 = 实际发送 body」。**date 严格 UTC+0**。
  - 复用现有 `SHA256.js`（`hex/toBytes/bytesToHex/hmacBytes`），无需新增工具。签名自洽验证：JS 捕获请求后由 **python 独立复算签名，与 JS 生成结果逐字符一致**。
  - 机器翻译账户支持 `vendor=volcengine`（字段 accessKeyId / **secretAccessKey**，区别于百度/小牛/阿里/腾讯的键名）；「机器翻译服务」配置区可填火山引擎密钥，「机器翻译路由」页按提供商显示接口类型（火山：单选项「文本翻译（TranslateText）」，当前版本只暴露一个接口）；缓存键 `mt:<id>:volcengine:text:text`。
  - 前端 `MACHINE_PROVIDER_PRESETS` 加「火山翻译」（下拉名简化，与「百度翻译 / 小牛翻译 / 阿里翻译 / 腾讯翻译」格式统一）；`SettingsStore` 兜底增强：账户名含「火山」→ volcengine；`apiType` 白名单加 text（腾讯/火山共用）。
  - 机器翻译账户支持 `vendor=tencent`（字段 SecretId / SecretKey）：「机器翻译服务」配置区可添加腾讯云账户；「机器翻译路由」页按提供商显示接口选项（腾讯云：文本翻译 TextTranslate 单一接口，只读）；缓存键 `mt:<id>:tencent:text:<text>`。
  - `SettingsStore` 兜底：无 `vendor` 账户按名称推断含「腾讯」→ tencent；`apiType` 白名单增加 `text`（腾讯）。

## v0.7.2（2026-08-12）

### 修复

- **有道查词偶发返回"随机词条" / 词头错位**（用户实测 commercial 触发）：
  - 根因：`jsonapi_s` 接口在风控状态下对常见词返回随机推荐词（不再可用）；页面内 `<span class="title">` 在多处出现（页头 banner "全部产品"、"双语例句"/"网络释义"/"英英释义"等模块标题、词头 span），原正则取了 banner 作为词头。
  - 修复：放弃 `jsonapi_s`，改走**移动版页面** `dict.youdao.com/m/result?word=<w>&lang=en`（Nuxt SSR，HTML 渲染）；词头限定 `<h4 class="word-title">` 区块、音标限定 `<div class="phone_con">` 到下个 `simple dict-module` 之间的范围（避免嵌套 div 截断）、释义限定 `simple dict-module` 区块；拼写错的词（无 simple 区块）正确判定未命中。
- **金山词霸所有词都"未找到"**：
  - 根因一：插件默认请求 UA 是 iPhone；金山词霸 `www.iciba.com` 对手机 UA 返回 **302 → `m.iciba.com`** 空壳页，无 `__NEXT_DATA__` 数据。
  - 根因二（真凶）：解析 `__NEXT_DATA__` 时用了 `NSString.stringWithString(...).dataUsingEncoding(4)` 转 NSData 再 `NSJSONSerialization` 解析——该桥接路径在 JSCore 中不可靠，解析永远返回 null（按 mn-docs「JavaScript 原生环境」文档，标准内置 `JSON` 对象可用，应直接用 `JSON.parse`）。
  - 修复：`network.js` 默认 UA 由 iPhone 改为**桌面 Mac Safari**；`KingsoftDictionaryService` 改用 **`JSON.parse`** 解析 `__NEXT_DATA__`。另按 mn-docs「网络请求」文档规范修复 `ConfigSync.readTextFile`（NSData→文本走 `base64Encoding()`+Base64 解码，不再用 `NSString.stringWithContentsOfData`）。其它查词服务（必应、海词、有道）对桌面 UA 完全兼容。
- **金山词霸对大小写敏感导致释义错位**（用户实测 Hard → 哈德姓氏词条）：
  - 根因：金山词霸对大小写敏感（"Hard" = 哈德姓氏 vs "hard" = 普通的形容词），划词选中 "Hard" 时直接发请求被解析为姓氏。
  - 修复：`runLookup` 在 `provider === "kingsoft"` 路径下把查询词统一小写后再发请求；其他服务商大小写不敏感保持原样。缓存 key 始终用小写（之前已是），同一词的不同大小写形式命中同一缓存，避免互相污染。
- **搜索功能复用查词缓存导致返回上次结果**（用户实测：划词查 Hard 拿到姓氏结果 → 搜索 hard 仍返回姓氏词条）：
  - 根因：搜索走 `runLookup` 会读缓存；之前划词 "Hard" 写入的缓存（key 为 `kingsoft:hard`）被搜索 "hard" 命中。
  - 修复：搜索路径（`searchWord`）在 job 上设置 `bypassCache=true`，`runLookup` 据此跳过读和写缓存、强制走网络。划词（自动触发）仍读/写缓存，不变。

### 新功能

- **新增查词服务：金山词霸**（`https://www.iciba.com/word?w=<word>`，无需 key）：
  - 解析页面内嵌 `__NEXT_DATA__` JSON（Next.js SSR 数据），结构化稳定：英美音标、真人发音 mp3（缺失回退 TTS）、带词性释义（主源 basic 释义，兜底柯林斯/简明英汉/机器翻译）。
  - 已接入：设置页「查词服务提供商」与「AI 解释发音」下拉、结果卡片工具栏「查词服务切换」菜单、历史记录（新增 JS 标签，绿底）。
  - 缓存键独立（`kingsoft:` 前缀），与有道/必应/海词互不串用。

### 体验优化

- **同词性释义合并展示**（用户反馈：必应 / 海词 / 金山每个意思一行太长；与有道同款格式）：
  - 释义渲染改为按 `pos` 分组：同一词性的多个 meaning 用「；」连接成一行，不同词性仍分多行展示。复制文本格式同步对齐。
  - 对有道无影响（其原始数据本身就是按 pos 分好组），其它三家的多行单义折叠为少行多义。历史记录点击后走同一渲染逻辑自动生效。
- **移除「固定图钉位置」设置项**（用户要求：图钉固定即停留在当前位置，无需配置）：
  - 删除设置页「常规设置」中的「固定图钉位置」开关；图钉固定后卡片**默认不跟随划词位置**（原 `pinStays` 开关的开启态即默认行为）。
  - 清理：`SettingsStore.js` / `web/src/store/configStore.js` 删除 `pinStays` 默认值，`FloatingCardController.showJob` 不再读配置、图钉固定直接跳过重新定位（旧设置里残留的 `pinStays` 值不再生效）。
- **AI 翻译预置 prompt 更新**（用户指定文案）：
  - 默认翻译模板改为「你是一名专业的学术翻译。请将以下内容翻译为{target_lang}，要求准确、通顺、符合学术表达习惯。**只输出译文**，不要输出任何解释或额外内容。原文：{text}」。
- **AI 服务商测试显示延时**（用户要求）：
  - 插件侧 `AIService.test` 记录耗时并返回 `latencyMs`（整个测试过程毫秒数，含推理探测请求；失败/超时也返回实际耗时）。
  - 设置页单个模型「测试」结果与「批量测试全部」的每个模型行均显示延时（<1s 显示 ms，≥1s 显示 s 保留 1 位小数）。

## v0.7.1（2026-08-12）

### 修复

- **重新生成长按在 iPad 触摸设备上失效**（二次修复）：鼠标长按可弹出模型选择列表，但手指 / Apple Pencil 长按无效。
  - 根因一：按钮是条件渲染（结果出现后才出现），上一版用 `useEffect` 只在组件挂载时绑定触摸监听，按钮后出现时监听未绑定 → 触摸长按永远无效（鼠标用 React 属性随渲染绑定所以正常）。
  - 根因二：MarginNote 插件 WebView 为 **UIWebView**，无 Pointer Events，且系统长按手势约 500ms 识别，会与自定义长按竞争。
  - 修复：改用 **callback ref** 在按钮挂载 / 卸载时动态绑定、解绑原生 touch 事件（`touchstart` 启动 400ms 计时并 `preventDefault` 抑制系统手势，`touchmove` 移出按钮才取消，`touchend` 区分单击 / 长按）；长按阈值 600ms → 400ms 提前于系统手势；触摸结束后 500ms 窗口内忽略补发的合成 mouse 事件（防止模型列表被误关 / 重复触发）；CSS 增加 `-webkit-touch-callout: none`、`user-select: none` 抑制系统长按菜单。

## v0.7.0（2026-08-11）

### 新功能

- **工具栏搜索按钮**：结果卡片工具栏新增搜索按钮，点击切换为搜索框，随时用默认查词服务查询任意单词
- **重新生成**：AI 解释 / AI 翻译时显示「重新生成」按钮——点击即重新生成（跳过缓存）；长按弹出模型选择列表（供应商为一级选项、模型为二级选项缩进展示，支持按供应商折叠/展开，默认全部展开）
- **查词服务快速切换**：工具栏最左侧 bar 图标改为可点击按钮，可临时切换有道 / 必应 / 海词 / AI 解释以对比结果，不影响默认设置（默认查词服务仍在设置中修改）
- **查词 / 翻译独立开关**：设置页插件总开关一分为二，查词、翻译可单独控制开关；仅开启查词时选中句子不触发翻译
- **缓存功能**：查词缓存与 AI 翻译缓存独立 LRU 设计，数量可分别设置（0 = 不使用缓存）；相同查询直接命中缓存，不同查词服务互不共用；点击「重新生成」始终绕过缓存
- **Ollama 预置**：新增 Ollama Cloud（https://ollama.com/api）与 Ollama Local（http://localhost:11434）两个预置 AI 供应商，自动适配 OpenAI 兼容端点并支持 reasoning effort 参数

### 体验优化

- **历史记录**：工具栏新增历史按钮（时钟图标），查词历史与翻译历史相互独立——查词历史为单词列表并带服务商彩色标签（YD / BY / HC / AI），翻译历史每条两行展示原文与译文、右侧渐变消失；点击历史条目直接显示对应缓存内容，不重复请求
- **双击复制**：移除工具栏复制按钮，改为在结果卡片内连击两次自动复制
- **公式渲染**：AI 解释 / 翻译输出中的 LaTeX 公式（`$...$`、`$$...$$`、`\(...\)`、`\[...\]`）现可正常显示，支持上下标、分数、根号、矩阵、分段函数、希腊字母等
- **卡片高度自适应**：打开查词切换菜单、模型选择列表或历史面板时，卡片高度自动调整以完整显示选项，无需手动拖动
- **错误提示优化**：修复 Ollama Cloud 测试报 NSURLErrorDomain -1012（认证失败）时的友好提示，引导检查 API Key
- **细节优化**：搜索框关闭按钮更换新图标、AI 解释界面按钮顺序与大小调整、移除重新生成按钮 hover 动效、查词历史 AI 标签底色调整

### 安装

下载 `instant-ai-translator-v0.7.0.mnaddon` 后双击安装，或在 MarginNote「设置 → 插件」中选择本地安装。
