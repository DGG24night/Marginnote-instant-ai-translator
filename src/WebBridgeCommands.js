// WebBridgeCommands.js —— bridge 命令注册表
// 命令名必须与前端 MNBridge.send(command, payload) 的 command 一致。
// context: { controller, addon, kind: "panel" | "card", closePanel }

var __MN_WEB_BRIDGE_COMMANDS_MNInstantAITranslatorAddon = (function () {
  function toBridgePayload(value) {
    return value === undefined ? null : value;
  }

  function ping(context, payload) {
    return {
      now: new Date().toISOString(),
      source: "mn-addon",
      payload: toBridgePayload(payload),
      addon: context.addon && context.addon.window ? "available" : "unavailable",
    };
  }

  // ---------- 配置 ----------

  function getConfig() {
    return MNIATSettings.load();
  }

  function saveConfig(context, payload) {
    var ok = MNIATSettings.save(payload);
    if (!ok) {
      throw new Error("配置保存失败，请查看日志");
    }
    return { saved: true };
  }

  function getDefaultPrompts() {
    return MNIATPrompts.defaults;
  }

  // ---------- 配置备份与同步 ----------

  // 导出：写临时文件并弹出系统保存面板，返回 { ok, bytes, fileName }
  function exportConfig() {
    return MNIATConfigSync.exportConfig();
  }

  // 导出（剪贴板方式）：配置 JSON 写入系统剪贴板，返回 { ok, bytes }
  function exportConfigToClipboard() {
    return MNIATConfigSync.exportConfigToClipboard();
  }

  // 导入（粘贴方式）：payload.json 为配置文本；整体覆盖（导入前自动备份 config.backup.json）
  function importConfig(context, payload) {
    var text = payload && payload.json;
    if (!text || typeof text !== "string" || !text.trim()) {
      throw new Error("缺少导入的配置内容");
    }
    return MNIATConfigSync.importConfig(text);
  }

  // 导入（文件方式）：弹系统文件选择器，选中配置 JSON 后读取导入
  function importConfigFromFile(context) {
    return MNIATConfigSync.importConfigFromFile(context);
  }

  function testProvider(context, payload) {
    if (!payload || !payload.provider || !payload.modelId) {
      throw new Error("缺少 provider 或 modelId 参数");
    }
    // probeReasoning: true 时额外探测模型是否支持思考（返回 supportsReasoning）
    return MNIAIService.test(payload.provider, payload.modelId, !!payload.probeReasoning);
  }

  function fetchModels(context, payload) {
    if (!payload || !payload.baseURL) {
      throw new Error("缺少 baseURL 参数");
    }
    return MNIAIService.fetchModels(payload.baseURL, payload.apiKey);
  }

  // ---------- 卡片交互 ----------

  function cardReady() {
    MNIATFlow.onCardReady();
    // 返回卡片高度上下限：前端测量后按此钳制（打字机渐进增长封顶依赖 maxHeight）
    var limits = MNIATFloatingCard.limits();
    return {
      acknowledged: true,
      minHeight: limits.minHeight,
      maxHeight: limits.maxHeight
    };
  }

  function closeCard() {
    MNIATFlow.cancelCurrent();
    MNIATFloatingCard.hide();
    return { closed: true };
  }

  // 图钉固定状态（工具栏图钉按钮）：true = 固定，点击卡片外部不关闭
  function setCardPinned(context, payload) {
    return MNIATFloatingCard.setPinned(!!(payload && payload.pinned));
  }

  // 卡片 WebView 失焦（用户点击卡片外部）→ 未固定时关闭卡片（blur 方案）
  function cardLostFocus(context) {
    if (context.kind === "card") {
      MNIATFloatingCard.cardLostFocus();
    }
    return { handled: true };
  }

  function copyText(context, payload) {
    var text = payload && payload.text;
    if (!text) {
      throw new Error("缺少待复制文本");
    }
    UIPasteboard.generalPasteboard().string = String(text);
    return { copied: true };
  }

  // 「添加卡片」（工具栏添加按钮）：
  // payload = { title, body, markdown, colorIndex } —— 前端按当前结果组装（查词=单词标题+音标释义正文，
  // AI 解释=单词标题+解释正文，翻译=原句标题+译文正文），Markdown 模式默认开启。
  // 插件侧在当前文档所属笔记本下创建一条新笔记，并通过 dc.highlightFromSelection 关联原文位置；
  // 返回 { ok, topicid, noteId }。
  function addCard(context, payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少卡片内容");
    }
    // 窗口定位：卡片控制器持有 addonWindow（ensureController 注入）；addon 为插件实例
    // （notebookWillOpen 时经 setAddon 注入卡片控制器）——双兜底，避免 controller.addon 缺失
    var win = (context.controller && context.controller.addonWindow) ||
      (context.addon && context.addon.window);
    if (!win) {
      throw new Error("缺少窗口上下文，无法添加卡片");
    }
    var colorIndex = (typeof payload.colorIndex === "number") ? payload.colorIndex : null;
    return MNIATCardCreator.createCard(
      win,
      payload.title,
      payload.body,
      payload.markdown !== false,
      colorIndex
    );
  }

  function explainWithAI() {
    return MNIATFlow.explainWithAI();
  }

  // 工具栏搜索框查询任意单词：用默认查词服务提供商（config.lookupProvider）查词
  function cardLookup(context, payload) {
    if (!payload || !payload.text) {
      throw new Error("缺少查询文本");
    }
    return MNIATFlow.searchWord(String(payload.text));
  }

  // 工具栏 bar 图标菜单：临时切换查词服务/AI 解释（不写回默认查词服务配置）
  function cardLookupProvider(context, payload) {
    if (!payload || !payload.provider) {
      throw new Error("缺少查词服务参数");
    }
    return MNIATFlow.lookupWithProvider(String(payload.provider));
  }

  // 「重新生成」：点击重跑当前 AI 翻译/解释（跳过缓存）；
  // 长按选模型时 payload 二选一：
  //   { providerId, modelId }      —— AI 提供商（临时覆盖，不写回路由配置）
  //   { machineProviderId }        —— 机器翻译服务（临时覆盖，不写回 machineRouting）
  function regenerate(context, payload) {
    var override = null;
    if (payload && payload.machineProviderId) {
      override = { machineProviderId: String(payload.machineProviderId) };
    } else if (payload && payload.providerId) {
      override = {
        providerId: String(payload.providerId),
        modelId: String(payload.modelId || "")
      };
    }
    return MNIATFlow.regenerate(override);
  }

  // 解析单词发音 URL（AI 解释结果工具栏的手动发音按钮）：
  // 按「AI 解释发音」配置选择有道/海词/必应，accent 传 uk | us；
  // 返回 { url, fallbacks }，fallbacks 为回退链（小写词/另一口音，播放失败时前端依次尝试）
  function getPronounceURL(context, payload) {
    if (!payload || !payload.word) {
      throw new Error("缺少 word 参数");
    }
    var accent = payload.accent === "uk" ? "uk" : "us";
    return MNIATFlow.resolvePronounceURL(payload.word, accent).then(function (r) {
      return {
        url: (r && r.url) || "",
        fallbacks: (r && Array.isArray(r.fallbacks) ? r.fallbacks : []).filter(function (u) { return !!u; })
      };
    });
  }

  // 历史记录：kind = "lookup"（查词，含词典/AI 解释）| "translate"（翻译）
  function getHistory(context, payload) {
    var kind = payload && payload.kind === "translate" ? "translate" : "lookup";
    return { items: MNIATFlow.getHistory(kind) };
  }

  // 点击历史条目：结果卡片显示缓存内容（不再请求网络）
  function applyHistory(context, payload) {
    if (!payload || !payload.kind || !payload.item) {
      throw new Error("缺少历史条目参数");
    }
    return MNIATFlow.applyHistory(payload.kind, payload.item);
  }

  // 卡片前端测量内容高度后上报，插件侧钳制并调整 WebView 高度
  function resizeCard(context, payload) {
    if (context.kind === "card" && payload && typeof payload.height === "number") {
      MNIATFloatingCard.resizeToHeight(payload.height);
    }
    return { resized: true };
  }

  // ---------- 拼接模式（双击图钉：跨页段落手动拼接翻译） ----------

  // 双击图钉 → 进入拼接模式：取消当前翻译，以最近选区为拼接起点，固定卡片并切换到拼接界面
  function enterAppendMode(context) {
    var win = (context.controller && context.controller.addonWindow) ||
      (context.addon && context.addon.window);
    if (!win) {
      throw new Error("缺少窗口上下文，无法进入拼接模式");
    }
    return MNIATFlow.enterAppendMode(win);
  }

  // 「开始翻译」：payload.text = 前端拼接编辑区的最终文本（用户可编辑修正）
  function appendTranslate(context, payload) {
    if (!payload || !payload.text) {
      throw new Error("缺少拼接文本");
    }
    return MNIATFlow.startAppendTranslate(String(payload.text));
  }

  // 退出拼接模式（前端「退出」按钮 / 再次双击图钉）
  function exitAppendMode() {
    return MNIATFlow.exitAppendMode();
  }

  // ---------- 面板 ----------

  function closePanel(context, payload) {
    context.closePanel(context.controller);
    return {
      closed: true,
      payload: toBridgePayload(payload),
    };
  }

  const commands = {
    ping,
    getConfig,
    saveConfig,
    getDefaultPrompts,
    exportConfig,
    exportConfigToClipboard,
    importConfig,
    importConfigFromFile,
    testProvider,
    fetchModels,
    cardReady,
    closeCard,
    setCardPinned,
    cardLostFocus,
    copyText,
    addCard,
    explainWithAI,
    cardLookup,
    cardLookupProvider,
    regenerate,
    getPronounceURL,
    getHistory,
    applyHistory,
    resizeCard,
    enterAppendMode,
    appendTranslate,
    exitAppendMode,
    closePanel,
  };

  return {
    commands,
  };
})();
