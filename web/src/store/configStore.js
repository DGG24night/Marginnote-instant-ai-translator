import { create } from "zustand";
import MNBridge from "../lib/mnBridge";

// 全局配置 store：与插件侧 config.json 同步
// 读：getConfig；写：updateConfig（本地乐观更新 + 立即持久化）

function genId() {
  return `p-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
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
  { name: "自定义（OpenAI 兼容）", baseURL: "", models: [] },
];

const EMPTY_CONFIG = {
  version: 1,
  enabled: true,
  targetLang: "zh-CN",
  triggerMode: "auto",
  theme: "light",
  fontSize: "medium",
  pronounceAuto: true,
  pronounceAccent: "us",
  rememberCardSize: false,
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
      set({ config: { ...EMPTY_CONFIG, ...config }, loaded: true });
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
}));
