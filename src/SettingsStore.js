// SettingsStore.js —— 插件配置存储
// 全部业务配置保存在 documentPath/<addonid>/config.json（结构化数据，按 AGENTS.md 规则）。
// 读写使用 NSJSONSerialization + NSData.writeToFileAtomically；
// 读取时对空文件/非法 JSON/缺字段做默认值兜底，带 schema version 便于后续迁移。

var MNIATSettings = (function () {
  var ADDON_DIR_NAME = "whc-instant-ai-translator";
  var CONFIG_FILE_NAME = "config.json";
  var CONFIG_VERSION = 1;

  var cachedConfig = null;

  function defaultConfig() {
    return {
      version: CONFIG_VERSION,
      enabled: true,                // 插件总开关（false 时划词不触发）
      targetLang: "zh-CN",
      triggerMode: "auto",          // auto=选中即翻译 | button=先显示悬浮按钮
      theme: "light",               // light | dark
      fontSize: "medium",           // small | medium | large
      pronounceAuto: true,          // 查词后自动发音
      pronounceAccent: "us",        // uk | us
      providers: [],                // [{id,name,baseURL,apiKey,models:[{id,supportsReasoning}]}]
      routing: {
        translate: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" },
        lookup: { providerId: "", modelId: "", temperature: 0.3, reasoningEffort: "off" }
      },
      prompts: {
        translate: "",              // 空串 = 使用内置默认模板
        explain: ""
      }
    };
  }

  function configDir() {
    return Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME;
  }

  function configPath() {
    return configDir() + "/" + CONFIG_FILE_NAME;
  }

  function ensureDir() {
    var fm = NSFileManager.defaultManager();
    var dir = configDir();
    if (!fm.fileExistsAtPath(dir)) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(dir, true, null);
    }
  }

  // 用默认值补齐缺字段（浅合并 + 关键子对象深兜底）
  function withDefaults(raw) {
    var base = defaultConfig();
    if (!raw || typeof raw !== "object") return base;

    var merged = {};
    var key;
    for (key in base) merged[key] = base[key];
    for (key in raw) {
      if (raw[key] !== undefined && raw[key] !== null) merged[key] = raw[key];
    }

    ["translate", "lookup"].forEach(function (k) {
      var r = (raw.routing && raw.routing[k]) || {};
      merged.routing[k] = {
        providerId: typeof r.providerId === "string" ? r.providerId : "",
        modelId: typeof r.modelId === "string" ? r.modelId : "",
        temperature: typeof r.temperature === "number" ? r.temperature : 0.3,
        reasoningEffort: typeof r.reasoningEffort === "string" ? r.reasoningEffort : "off"
      };
    });

    merged.prompts = {
      translate: (raw.prompts && typeof raw.prompts.translate === "string") ? raw.prompts.translate : "",
      explain: (raw.prompts && typeof raw.prompts.explain === "string") ? raw.prompts.explain : ""
    };

    if (!Array.isArray(merged.providers)) merged.providers = [];
    merged.version = CONFIG_VERSION;
    return merged;
  }

  return {
    load: function () {
      if (cachedConfig) return cachedConfig;
      var raw = null;
      try {
        var path = configPath();
        var fm = NSFileManager.defaultManager();
        if (fm.fileExistsAtPath(path)) {
          var data = NSData.dataWithContentsOfFile(path);
          if (data && data.length() > 0) {
            raw = NSJSONSerialization.JSONObjectWithDataOptions(data, 1);
          }
        }
      } catch (e) {
        console.log("[MNIATSettings] load error, fallback to defaults: " + e);
        raw = null;
      }
      cachedConfig = withDefaults(raw);
      return cachedConfig;
    },

    save: function (config) {
      try {
        ensureDir();
        var normalized = withDefaults(config);
        var data = NSJSONSerialization.dataWithJSONObjectOptions(normalized, 1);
        data.writeToFileAtomically(configPath(), true);
        cachedConfig = normalized;
        return true;
      } catch (e) {
        console.log("[MNIATSettings] save error: " + e);
        return false;
      }
    },

    defaults: defaultConfig,

    // 便捷：按用途（translate/lookup）解析提供商与模型
    resolveRoute: function (kind) {
      var config = this.load();
      var route = config.routing[kind] || {};
      var provider = null;
      for (var i = 0; i < config.providers.length; i++) {
        if (config.providers[i].id === route.providerId) {
          provider = config.providers[i];
          break;
        }
      }
      return { provider: provider, route: route };
    }
  };
})();
