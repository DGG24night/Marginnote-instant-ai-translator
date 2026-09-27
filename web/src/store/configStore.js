import { create } from "zustand";
import MNBridge from "../lib/mnBridge";

// 全局配置 store：与插件侧 config.json 同步
// 读：getConfig；写：updateConfig（本地乐观更新 + 立即持久化）

function genId() {
  return `p-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// 拖拽排序目标列表解析：
//   "providers" → config.providers；"machineProviders" → config.machineProviders；
//   "providers.<id>.models" → 指定提供商内的模型列表。找不到返回 null。
function resolveList(config, path) {
  if (path === "providers") return config.providers;
  if (path === "machineProviders") return config.machineProviders;
  const m = /^providers\.(.+)\.models$/.exec(path);
  if (m) {
    const p = config.providers.find((x) => x.id === m[1]);
    return p ? p.models : null;
  }
  return null;
}

// 防御性清理：移除各提供商中 id 为空的模型（兼容历史脏数据）
function sanitizeConfig(config) {
  let changed = false;
  const providers = (config.providers || []).map((p) => {
    const raw = p.models || [];
    const models = raw.filter((m) => m && m.id && String(m.id).trim());
    if (models.length !== raw.length) changed = true;
    return { ...p, models };
  });
  return changed ? { ...config, providers } : config;
}

// 最近一次同步给插件的面板主题：卡片页每次新任务都会 load() 刷新配置，
// 主题未变时不重复发送 bridge 命令
let lastPanelTheme = null;

export const PROVIDER_PRESETS = [
  {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    // model 官方取值仅 deepseek-v4-flash / deepseek-v4-pro（api-docs.deepseek.com，
    // 2026-09）；两者均为混合推理，thinking.type 默认 enabled
    models: [
      { id: "deepseek-v4-flash", supportsReasoning: true },
      { id: "deepseek-v4-pro", supportsReasoning: true },
    ],
  },
  {
    name: "SiliconFlow",
    baseURL: "https://api.siliconflow.cn/v1",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", supportsReasoning: false },
      { id: "deepseek-ai/DeepSeek-R1", supportsReasoning: false },
      { id: "Qwen/Qwen2.5-7B-Instruct", supportsReasoning: false },
    ],
  },
  {
    name: "阿里云百炼",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", supportsReasoning: false },
      { id: "qwen-turbo", supportsReasoning: false },
      { id: "qwen-max", supportsReasoning: false },
    ],
  },
  {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o-mini", supportsReasoning: false },
      { id: "gpt-4o", supportsReasoning: false },
    ],
  },
  {
    name: "Moonshot Kimi",
    baseURL: "https://api.moonshot.cn/v1",
    // kimi-k3 始终思考（reasoning_effort: low|high|max）；kimi-k2.7-code 思考始终
    // 开启；kimi-k2.6 由 thinking.type 控制开关（适配见 src/AIService.js）
    models: [
      { id: "kimi-k3", supportsReasoning: true },
      { id: "kimi-k2.7-code", supportsReasoning: true },
      { id: "kimi-k2.6", supportsReasoning: true },
    ],
  },
  {
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    // GLM 系列由 thinking.type 控制思考开关（见 src/AIService.js isZhipuStyle）
    models: [
      { id: "glm-5.3", supportsReasoning: true },
      { id: "glm-5.3-flash", supportsReasoning: true },
      { id: "glm-4.5-air", supportsReasoning: true },
    ],
  },
  {
    name: "火山引擎",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    // doubao-* 走 thinking.type（isDoubaoModel）；托管的 deepseek/glm 走通用
    // reasoning_effort 分支，「测试」的探测会自动校正 supportsReasoning 标记
    models: [
      { id: "doubao-seed-2-1-lite-260915", supportsReasoning: true },
      { id: "deepseek-v4-1-flash-260910", supportsReasoning: true },
      { id: "glm-5-3-flash-260828", supportsReasoning: true },
    ],
  },
  {
    name: "蚂蚁百灵",
    baseURL: "https://api.ant-ling.com/v1",
    models: [
      { id: "Ling-3.0-flash", supportsReasoning: true },
      { id: "Ling-3.0-tiny", supportsReasoning: false },
      { id: "Ling-2.6-1T", supportsReasoning: false },
      { id: "Ling-2.6-flash", supportsReasoning: false },
      { id: "Ring-2.6-1T", supportsReasoning: true },
    ],
  },
  {
    name: "小米 MiMo",
    baseURL: "https://api.xiaomimimo.com/v1",
    models: [
      { id: "mimo-v2.6-pro", supportsReasoning: true },
      { id: "mimo-v2.6-flash", supportsReasoning: true },
    ],
  },
  {
    name: "Ollama Cloud",
    baseURL: "https://ollama.com/api",
    // gemma 系列为非推理模型；gpt-oss 原生支持 reasoning_effort
    models: [
      { id: "gemma4:31b", supportsReasoning: false },
      { id: "gpt-oss:120b", supportsReasoning: true },
      { id: "gpt-oss:20b", supportsReasoning: true },
    ],
  },
  {
    name: "Ollama Local",
    baseURL: "http://localhost:11434",
    models: [
      { id: "llama3.2", supportsReasoning: false },
      { id: "qwen3:8b", supportsReasoning: true },
      { id: "gemma3:4b", supportsReasoning: false },
      { id: "deepseek-r1:7b", supportsReasoning: true },
    ],
  },
  { name: "自定义（OpenAI 兼容）", baseURL: "", models: [] },
];

// 机器翻译服务预设：vendor 用于插件侧分派（baidu → MNIATBaiduMT，niutrans → MNIATNiuTrans，
// aliyun → MNIATAliyunMT，tencent → MNIATTencentMT，volcengine → MNIATVolcengineMT）
// name 在设置页下拉里显示，保持简短
export const MACHINE_PROVIDER_PRESETS = [
  { vendor: "baidu",      name: "百度翻译" },
  { vendor: "niutrans",   name: "小牛翻译" },
  { vendor: "aliyun",     name: "阿里翻译" },
  { vendor: "tencent",    name: "腾讯翻译" },
  { vendor: "volcengine", name: "火山翻译" },
];

const EMPTY_CONFIG = {
  version: 1,
  enabled: true,
  lookupEnabled: true,
  translateEnabled: true,
  lookupChinese: true, // 查询中文：关闭后选中内容含中文不触发查词/翻译（仅划词触发路径，工具栏搜索等显式操作不受影响）
  lookupCacheSize: 50,
  translateCacheSize: 50,
  targetLang: "zh-CN",
  contextLength: 200, // prompt {context} 变量：选区前后各取 N 词（英文按单词、中文按字计；0 = 不获取上下文；仅查词任务使用，翻译不提取）
  translateWordCount: 3, // 触发翻译的单词数阈值：选区单词数 > N 走翻译，否则按查词处理（中文按字符算、英文按空格分词）
  triggerMode: "auto",
  theme: "light",
  fontSize: "medium",
  pronounceAuto: true,
  pronounceAccent: "us",
  lookupProvider: "youdao", // youdao | bing | haici | ai（查词服务提供商）
  aiExplainPronounce: "youdao", // 查词服务=ai 时，AI 解释返回后用于发音的词典：youdao | haici | bing
  streamMode: true, // 流式输出：AI 回复逐字实时显示；关闭则等待完整结果一次性显示（机器翻译打字机同步受控）
  typewriterEffect: true, // 打字机效果：流式期间按固定节拍逐字揭示，输出更顺滑（关闭 = 收到多少显示多少）
  rememberCardSize: false,
  shortcuts: { lookup: "d", note: "n", save: "alt+s", chat: "c", historyPrev: "ArrowUp,ArrowLeft", historyNext: "ArrowDown,ArrowRight" }, // 结果卡片内快捷键
  noteIncludeResult: true, // 笔记编辑：自动附带查词/翻译结果（以 --- 分隔）
  chatHistorySize: 50, // AI 问答历史容量：达到上限自动删除最早的记录（0 = 不保存历史）
  cardColorTranslate: 0, // 「添加卡片」颜色索引 0-15（翻译任务）
  cardColorLookup: 0, // 「添加卡片」颜色索引 0-15（查词/AI 解释任务）
  translateService: "ai", // ai=AI 翻译 | machine=机器翻译（百度等开放平台）
  machineProviders: [], // [{id,name,appid,secretKey}] 机器翻译服务账户列表
  machineRouting: { providerId: "", apiType: "llm", domain: "it" }, // llm|standard|domain + 领域值
  providers: [],
  routing: {
    translate: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" },
    lookup: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" },
    chat: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" }, // AI 对话：对话界面切换模型时写入（= 上次使用的模型），设置页不再配置
    robotDouble: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" }, // 长难句解释（双击机器人图标）：留空回落 AI 解释路由
  },
  prompts: { translate: "", explain: "", robotDouble: "" },
};

export const useConfigStore = create((set, get) => ({
  config: EMPTY_CONFIG,
  loaded: false,
  saving: false,
  saveError: "",

  load: async () => {
    try {
      const config = await MNBridge.send("getConfig");
      const merged = { ...EMPTY_CONFIG, ...config };
      // routing 深合并：老配置缺新路由组（如 robotDouble）时补默认值，避免 RouteEditor 读到 undefined
      merged.routing = { ...EMPTY_CONFIG.routing, ...(merged.routing || {}) };
      // 防御性清理：移除 id 为空/无效的模型（曾因旧版 bug 写入空 id 行）
      const cleaned = sanitizeConfig(merged);
      set({ config: cleaned, loaded: true });
      if (cleaned !== merged) {
        MNBridge.send("saveConfig", cleaned).catch(() => {});
      }
    } catch (error) {
      console.error("getConfig failed", error);
      set({ loaded: true });
    }
    // 应用主题与字号
    get().applyAppearance();
  },

  applyAppearance: () => {
    const { config } = get();
    document.documentElement.dataset.theme = config.theme || "light";
    document.documentElement.dataset.fontsize = config.fontSize || "medium";
    // 面板顶栏（原生标题栏）同步主题：banner 不是 DOM，CSS 覆盖不到
    const theme = config.theme || "light";
    if (theme !== lastPanelTheme) {
      lastPanelTheme = theme;
      MNBridge.send("applyPanelTheme", { theme }).catch(() => {});
    }
  },

  // 局部更新并持久化；updater 接收 config 副本，直接改
  update: async (updater) => {
    const draft = JSON.parse(JSON.stringify(get().config));
    updater(draft);
    set({ config: draft });
    get().applyAppearance();

    set({ saving: true, saveError: "" });
    try {
      await MNBridge.send("saveConfig", draft);
    } catch (error) {
      set({ saveError: String((error && error.message) || error) });
    } finally {
      set({ saving: false });
    }
  },

  addProvider: async (preset) => {
    const provider = {
      id: genId(),
      name: preset.name,
      baseURL: preset.baseURL,
      apiKey: "",
      models: preset.models.map((m) => ({ ...m })),
    };
    await get().update((config) => {
      config.providers.push(provider);
    });
    return provider.id;
  },

  removeProvider: async (providerId) => {
    await get().update((config) => {
      config.providers = config.providers.filter((p) => p.id !== providerId);
      ["translate", "lookup", "chat", "robotDouble"].forEach((kind) => {
        if (config.routing[kind].providerId === providerId) {
          config.routing[kind] = { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" };
        }
      });
    });
  },

  // 拖拽排序（设置页「服务提供商」bar 图标）：
  // path = "providers"（AI 提供商）| "machineProviders"（机器翻译服务）| "providers.<id>.models"（某提供商内模型）
  // 把 path 数组的 from 项移动到 to（to 为插入位置索引，语义 = 插到目标项之前）。
  // 顺序持久化后，结果卡片长按「重新生成」的模型列表会按同样顺序展示（渲染同一份数据）。
  moveItem: async (path, from, to) => {
    await get().update((config) => {
      const arr = resolveList(config, path);
      if (!arr || from < 0 || from >= arr.length) return;
      const item = arr.splice(from, 1)[0];
      // 删除后元素左移：from 在 to 之前时目标索引减 1
      let target = to > from ? to - 1 : to;
      target = Math.max(0, Math.min(target, arr.length));
      arr.splice(target, 0, item);
    });
  },

  // 导出配置：插件层写入临时文件并弹出系统保存面板
  exportConfig: async () => {
    return MNBridge.send("exportConfig");
  },

  // 导出配置（剪贴板方式）：插件层把配置 JSON 写入系统剪贴板
  exportConfigToClipboard: async () => {
    return MNBridge.send("exportConfigToClipboard");
  },

  // 导入配置（粘贴文本）：整体覆盖（插件层导入前自动备份）；成功后重新加载本地状态
  importConfig: async (jsonText) => {
    const result = await MNBridge.send("importConfig", { json: jsonText });
    if (result && result.ok) {
      await get().load();
    }
    return result;
  },

  // 导入配置（文件方式）：弹系统文件选择器，选中配置文件后导入
  importConfigFromFile: async () => {
    const result = await MNBridge.send("importConfigFromFile");
    if (result && result.ok) {
      await get().load();
    }
    return result;
  },
}));
