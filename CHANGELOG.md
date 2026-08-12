# 更新日志

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
