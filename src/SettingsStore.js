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
      lookupEnabled: true,          // 查词功能独立开关（false 时选中单词不触发查词）
      translateEnabled: true,       // 翻译功能独立开关（false 时选中句子/段落不触发翻译）
      lookupCacheSize: 50,          // 查词结果缓存条数（0 = 不使用缓存）
      translateCacheSize: 50,       // AI 翻译结果缓存条数（0 = 不使用缓存）
      targetLang: "zh-CN",
      contextLength: 200,           // prompt {context} 变量的上下文长度：选区前后各取 N 字符（0 = 不获取上下文）
      translateThreshold: 3,        // 触发翻译的字符数阈值：选区 trim 后字符数 > N 走翻译，否则按查词处理（默认 3，可查词组）
      triggerMode: "auto",          // auto=选中即翻译 | button=先显示悬浮按钮
      theme: "light",               // light | dark
      fontSize: "medium",           // small | medium | large
      pronounceAuto: true,          // 查词后自动发音
      pronounceAccent: "us",        // uk | us
      lookupProvider: "youdao",     // youdao | bing | haici | kingsoft | ai（查词服务提供商；ai = 直接用 AI 解释）
      aiExplainPronounce: "youdao", // 查词服务=ai 时，AI 解释返回后用哪个词典发音：youdao | haici | bing | kingsoft
      streamMode: true,             // AI 翻译/解释结果打字机效果（先取完整结果、再逐字显示）
      rememberCardSize: false,      // 结果卡片：记住并恢复上次手动调整的大小（默认关闭）
      cardColorTranslate: 0,        // 「添加卡片」颜色索引 0-15（翻译任务创建卡片时使用）
      cardColorLookup: 0,           // 「添加卡片」颜色索引 0-15（查词/AI 解释任务创建卡片时使用）
      translateService: "ai",       // 翻译引擎：ai=AI 翻译 | machine=机器翻译（百度/小牛/阿里云/腾讯等）
      machineProviders: [],         // [{id,vendor,name,appid,secretKey,accessKeyId,accessKeySecret,secretId,secretKey}] 机器翻译账户列表
      machineRouting: {             // 机器翻译路由配置
        providerId: "",             // 机器翻译提供商 id（machineProviders 中的 id）
        apiType: "llm",             // 百度：llm=大模型 | standard=通用 | domain=领域；小牛：flash=Flash | pro=Pro；阿里云：general=通用版 | pro=专业版；腾讯：text=文本翻译
        domain: "it",               // 百度领域文本翻译的领域值（apiType=domain 时生效）
        scene: "title"              // 阿里云专业版场景（title/description/communication/medical/social/finance，apiType=pro 且 vendor=aliyun 时生效）
      },
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

    // 选区上下文长度深兜底（老配置无该字段时给默认值 200；0 = 关闭上下文）
    merged.contextLength =
      typeof raw.contextLength === "number" && raw.contextLength >= 0
        ? Math.min(Math.floor(raw.contextLength), 2000)
        : 200;

    // 触发翻译的单词数阈值深兜底（老配置无该字段时默认 3；限制非负整数）
    // 兼容：translateThreshold（v0.7.4 早期版的字段名）→ 迁移为 translateWordCount
    var legacyThreshold = (typeof raw.translateThreshold === "number" && raw.translateThreshold >= 0)
      ? raw.translateThreshold : null;
    merged.translateWordCount =
      typeof raw.translateWordCount === "number" && raw.translateWordCount >= 0
        ? Math.min(Math.floor(raw.translateWordCount), 100)
        : (legacyThreshold != null ? Math.min(Math.floor(legacyThreshold), 100) : 3);

    // 创建卡片颜色深兜底（老配置无字段时默认 0；限制 0-15 整数）
    function pickColorIndex(v) {
      return typeof v === "number" && v >= 0 && v <= 15
        ? Math.floor(v)
        : 0;
    }
    merged.cardColorTranslate = pickColorIndex(raw.cardColorTranslate);
    merged.cardColorLookup = pickColorIndex(raw.cardColorLookup);

    // 机器翻译配置深兜底（老配置无这些字段时给默认值）
    merged.translateService = raw.translateService === "machine" ? "machine" : "ai";
    if (!Array.isArray(merged.machineProviders)) merged.machineProviders = [];
    // 早期账户无 vendor 字段：按名称推断（"小牛翻译" → niutrans，"阿里云" → aliyun，其余 → baidu）
    for (var mi = 0; mi < merged.machineProviders.length; mi++) {
      var mp = merged.machineProviders[mi];
      if (mp && typeof mp === "object") {
        if (!mp.vendor) {
          var mpName = String(mp.name || "");
          if (/小牛/.test(mpName)) mp.vendor = "niutrans";
          else if (/阿里/.test(mpName)) mp.vendor = "aliyun";
          else if (/腾讯/.test(mpName)) mp.vendor = "tencent";
          else if (/火山/.test(mpName)) mp.vendor = "volcengine";
          else mp.vendor = "baidu";
        }
        mp.appid = typeof mp.appid === "string" ? mp.appid : "";
        mp.secretKey = typeof mp.secretKey === "string" ? mp.secretKey : "";
        // 阿里云账户字段（AccessKey）
        mp.accessKeyId = typeof mp.accessKeyId === "string" ? mp.accessKeyId : "";
        mp.accessKeySecret = typeof mp.accessKeySecret === "string" ? mp.accessKeySecret : "";
        // 腾讯云账户字段（SecretId/SecretKey）
        mp.secretId = typeof mp.secretId === "string" ? mp.secretId : "";
        // 火山引擎账户字段（AccessKeyId + SecretAccessKey）
        mp.secretAccessKey = typeof mp.secretAccessKey === "string" ? mp.secretAccessKey : "";
      }
    }
    // 各机器翻译商的接口类型白名单（超集：百度 llm/standard/domain，小牛 flash/pro，阿里云 general/pro，腾讯/火山 text）
    var MT_API_TYPES = { llm: 1, standard: 1, domain: 1, flash: 1, pro: 1, general: 1, text: 1 };
    merged.machineRouting = {
      providerId: (raw.machineRouting && typeof raw.machineRouting.providerId === "string")
        ? raw.machineRouting.providerId : "",
      apiType: (raw.machineRouting && raw.machineRouting.apiType &&
        MT_API_TYPES[raw.machineRouting.apiType])
        ? raw.machineRouting.apiType : "llm",
      domain: (raw.machineRouting && typeof raw.machineRouting.domain === "string")
        ? raw.machineRouting.domain : "it",
      scene: (raw.machineRouting && typeof raw.machineRouting.scene === "string")
        ? raw.machineRouting.scene : "title"
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

    // 用默认值补齐缺字段（导入配置时校验/归一化用）
    normalize: withDefaults,

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
