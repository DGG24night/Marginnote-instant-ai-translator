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

export const PROVIDER_PRESETS = [
  {
    name: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    models: [
      { id: "deepseek-chat", supportsReasoning: false },
      { id: "deepseek-reasoner", supportsReasoning: true },
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
    models: [{ id: "moonshot-v1-8k", supportsReasoning: false }],
  },
  {
    name: "智谱 GLM",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-flash", supportsReasoning: false },
      { id: "glm-4-air", supportsReasoning: false },
    ],
  },
  {
    name: "火山引擎",
    baseURL: "https://ark.cn-beijing.volces.com/api/v3",
    models: [
      { id: "doubao-seed-1-6-250615", supportsReasoning: true },
      { id: "doubao-seed-1-6-flash-250615", supportsReasoning: true },
      { id: "doubao-1-5-pro-32k-250115", supportsReasoning: true },
      { id: "doubao-1-5-lite-32k-250115", supportsReasoning: false },
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
    name: "Ollama Cloud",
    baseURL: "https://ollama.com/api",
    models: [
      { id: "gpt-oss:120b", supportsReasoning: true },
      { id: "gpt-oss:20b", supportsReasoning: true },
      { id: "qwen3-coder:480b", supportsReasoning: true },
      { id: "deepseek-v3.1:671b", supportsReasoning: true },
      { id: "glm-4.6", supportsReasoning: false },
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
  lookupCacheSize: 50,
  translateCacheSize: 50,
  targetLang: "zh-CN",
  contextLength: 200, // prompt {context} 变量：选区前后各取 N 字符（0 = 不获取上下文）
  translateWordCount: 3, // 触发翻译的单词数阈值：选区单词数 > N 走翻译，否则按查词处理（中文按字符算、英文按空格分词）
  triggerMode: "auto",
  theme: "light",
  fontSize: "medium",
  pronounceAuto: true,
  pronounceAccent: "us",
  lookupProvider: "youdao", // youdao | bing | haici | ai（查词服务提供商）
  aiExplainPronounce: "youdao", // 查词服务=ai 时，AI 解释返回后用于发音的词典：youdao | haici | bing
  streamMode: true, // AI 翻译/解释结果打字机效果（先取完整结果、再逐字显示）
  rememberCardSize: false,
  cardColorTranslate: 0, // 「添加卡片」颜色索引 0-15（翻译任务）
  cardColorLookup: 0, // 「添加卡片」颜色索引 0-15（查词/AI 解释任务）
  translateService: "ai", // ai=AI 翻译 | machine=机器翻译（百度等开放平台）
  machineProviders: [], // [{id,name,appid,secretKey}] 机器翻译服务账户列表
  machineRouting: { providerId: "", apiType: "llm", domain: "it" }, // llm|standard|domain + 领域值
  providers: [],
  routing: {
    translate: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" },
    lookup: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" },
  },
  prompts: { translate: "", explain: "" },
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
      ["translate", "lookup"].forEach((kind) => {
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
