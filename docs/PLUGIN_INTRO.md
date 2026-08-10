# Instant AI Translator — 即时 AI 翻译

> 在 MarginNote 中划词即译：AI 翻译、AI 单词解释、词典查询与发音，一站式搞定阅读中的语言障碍。
>
> - 版本：v0.5.0 ｜ 最低支持：MarginNote 4.2.3 ｜ 作者：ChuanLchuan
> - 开源地址：https://github.com/DGG24night/Marginnote-instant-ai-translator

---

## 一、功能简介

| 功能 | 说明 |
|---|---|
| 划词即译 | 在阅读/笔记中选中文字，自动弹出翻译卡片，无需任何额外操作 |
| AI 翻译 | 单词、句子、段落均可翻译，支持 5 种目标语言（简中 / 繁中 / 英 / 日 / 韩） |
| AI 解释 | 单词深度解析：音标、释义、常用词组、例句（带翻译）、相关词汇、词根词缀分析，Markdown 结构化呈现 |
| 词典查询 | 单词快速查词，支持有道 / 必应 / 海词三本词典，也可直接改用 AI 解释 |
| 发音朗读 | 美式 / 英式口音可选；查词自动发音；AI 解释后也可自动朗读 |
| 打字机效果 | 翻译 / 解释结果逐字显示，阅读体验更流畅（可关闭） |

## 二、支持的 AI 模型

基于 OpenAI Chat Completions 兼容协议，内置主流提供商，开箱即用：

- **OpenAI**（GPT 系列）
- **DeepSeek**（官方 / 阿里云百炼 / SiliconFlow）
- **Kimi（Moonshot）**
- **智谱 GLM**
- **阿里云百炼 Qwen**
- **SiliconFlow**

也可以填写任意兼容 Base URL，接入自建或其他服务。

**智能思考控制**：插件会自动识别提供商与模型，选择正确的思考参数（DeepSeek 官方 `thinking`、Kimi 特例、Qwen `enable_thinking`、OpenAI `reasoning_effort` 等）。关闭思考模式可显著加快响应。

**模型路由**：翻译和 AI 解释可以分别指定不同的提供商与模型（例如翻译用 DeepSeek、查词解释用 Kimi）。

## 三、安装方法

1. 下载最新版安装包 `instant-ai-translator-vX.X.X.mnaddon`（见 GitHub Releases）；
2. 用 MarginNote 打开该文件（或直接双击），确认安装；
3. 安装完成后**完全退出并重新打开 MarginNote**。

## 四、快速开始（3 步）

1. **打开设置面板**：MarginNote 菜单栏 → 插件 → Instant AI Translator → 设置；
2. **添加提供商**：选择一个预设提供商（如 DeepSeek / OpenAI），填入你的 **API Key** 即可；也可自定义 Base URL；
3. **选择模型**：在"模型路由"里为「翻译」和「AI 解释」分别选好模型，开始使用。

## 五、日常使用

- **翻译**：划选任意文本 → 卡片自动显示 AI 翻译结果；
- **查词**：划选单个单词 → 默认走词典查询（设置里可改为 AI 解释）；
- **发音**：点击结果中的 🔊 美 / 🔊 英 按钮朗读；设置"查词自动发音"后划词即读；
- **卡片操作**：拖拽标题栏移动，拖右下角缩放，双击标题栏最大化，点复制按钮复制译文，随时关闭。

## 六、常用设置一览

| 设置项 | 说明 |
|---|---|
| 目标语言 | 翻译输出语言（简中 / 繁中 / 英 / 日 / 韩） |
| 查词服务 | 有道 / 必应 / 海词 / AI 解释 |
| 发音口音 | 美式 / 英式 |
| 打字机效果 | 结果逐字显示开关 |
| 结果字号 | 小 / 中 / 大三档 |
| 主题 | 浅色 / 深色 |
| AI 解释模板 | 可自定义输出格式（支持 `{text}` 占位符），一键恢复默认 |

## 七、隐私说明

- 你的 **API Key 仅保存在本机**（MarginNote 插件数据目录），不上传任何第三方服务器；
- 翻译 / 查词文本仅发送到你自行配置的 AI 提供商或词典服务；
- 插件完全开源，可自行审查代码。

## 八、反馈与更新

- 遇到问题或想提需求，欢迎在 GitHub Issues 反馈：https://github.com/DGG24night/Marginnote-instant-ai-translator/issues
- 新版本会通过 GitHub Releases 发布，更新时下载最新 `.mnaddon` 重新安装即可。
