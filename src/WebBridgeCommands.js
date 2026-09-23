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

  // 配置写入（saveConfig / 导入配置）后同步划词监听启停：
  // 查词与翻译都关闭 → 停止监听（插件完全静默，不弹诊断 HUD）；任一开启 → 恢复监听。
  // 双路径（2026-09-15，修复「关闭查词/翻译再开启后须重进文档才恢复」）：
  //   路径一：经插件实例 addon.syncSelectionMonitor（携带权威 self.window）；
  //   路径二：直连 MNIATSelectionMonitor.sync——不依赖 addon 实例属性在 WebView
  //           拦截上下文里的可达性，监听器用自身持久化的最近窗口/回调重启。
  // 路径一调用链任一环节静默失败时由路径二兜底；两条都失败时，插件侧对账心跳
  // （notebookWillOpen 启动，每 0.5s）保证监听最迟约 0.5s 后恢复。
  function syncMonitorAfterConfigChange(context) {
    try {
      if (context && context.addon && typeof context.addon.syncSelectionMonitor === "function") {
        context.addon.syncSelectionMonitor();
      }
    } catch (e) {
      console.log("[MNIATBridge] sync via addon instance failed: " + e);
    }
    try {
      var running = MNIATSelectionMonitor.sync();
      if (!running) {
        // 查词/翻译都关闭（或暂无可监控窗口）：收起悬浮触发按钮
        MNIATFloatingCard.hideTrigger();
      }
    } catch (e) {
      console.log("[MNIATBridge] sync selection monitor failed: " + e);
    }
  }

  function saveConfig(context, payload) {
    var ok = MNIATSettings.save(payload);
    if (!ok) {
      throw new Error("配置保存失败，请查看日志");
    }
    syncMonitorAfterConfigChange(context);
    return { saved: true };
  }

  function getDefaultPrompts() {
    return MNIATPrompts.defaults;
  }

  // 面板顶栏主题（banner）：设置页/卡片页应用外观配置时调用。
  // 标题栏是原生视图（CSS 覆盖不到），暗色主题下由插件侧改色；
  // 卡片页发来的命令经 addon.webController 定位到面板控制器。
  function applyPanelTheme(context, payload) {
    const theme = payload && payload.theme === "dark" ? "dark" : "light";
    const panel = context && context.kind === "panel"
      ? context.controller
      : (context && context.addon && context.addon.webController) || null;
    if (!panel) return { applied: false };
    __MN_WEB_API_MNInstantAITranslatorAddon.applyTheme(panel, theme);
    return { applied: true };
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

  // 粘贴方式导入（文本）：payload.json 为配置文本；整体覆盖（导入前自动备份 config.backup.json）
  function importConfig(context, payload) {
    var text = payload && payload.json;
    if (!text || typeof text !== "string" || !text.trim()) {
      throw new Error("缺少导入的配置内容");
    }
    var result = MNIATConfigSync.importConfig(text);
    if (result && result.ok) {
      // 导入整体覆盖配置：查词/翻译开关可能变化，同步监听启停
      syncMonitorAfterConfigChange(context);
    }
    return result;
  }

  // 导入（文件方式）：弹系统文件选择器，选中配置 JSON 后读取导入。
  // 导入成功后同步监听启停（同 importConfig：整体覆盖可能改变查词/翻译开关）。
  function importConfigFromFile(context) {
    return MNIATConfigSync.importConfigFromFile(context).then(function (result) {
      if (result && result.ok) {
        syncMonitorAfterConfigChange(context);
      }
      return result;
    });
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

  // 原生 TTS（发音兜底）：卡片前端播放词典音频失败（或词典没有音频直链，如中文词语/成语）
  // 时调用，用 MarginNote 自带的 SpeechManager 朗读（mn-docs → reference/utility/speech-manager）。
  // 语言按内容自动判定（含 CJK → zh-CN，否则 en-US），也可由 payload.lang 显式指定。
  function speakText(context, payload) {
    var text = payload && payload.text ? String(payload.text).trim() : "";
    if (!text) {
      throw new Error("缺少朗读文本");
    }
    var lang = (payload && payload.lang) ||
      (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text) ? "zh-CN" : "en-US");
    var sm = null;
    try {
      sm = SpeechManager.sharedInstance();
    } catch (e) {
      sm = null;
    }
    if (!sm) {
      throw new Error("系统发音不可用");
    }
    // 上一次朗读未结束时先停止，避免叠加播放
    try {
      if (sm.speaking) sm.stopSpeech();
    } catch (e) { /* 忽略：部分版本无 speaking 属性 */ }
    try {
      sm.playText(text, lang);
    } catch (e2) {
      // 指定语言的签名不可用时退回单参数版本
      sm.playText(text);
    }
    return { spoken: true, lang: lang };
  }

  // 「添加卡片」（工具栏添加按钮 / AI 对话回答「添加笔记」）：
  // payload = { title, body, markdown, colorIndex } —— 前端按当前结果组装（查词=单词标题+音标释义正文，
  // AI 解释=单词标题+解释正文，翻译=原句标题+译文正文），Markdown 模式默认开启。
  // 插件侧在「当前打开的脑图」（notebookController.notebookId）下建卡并高亮原文：
  // 空摘录即卡片（标题+评论内容），旧摘录/无选区则新建卡片（挂子节点/独立）；返回 { ok, topicid, noteId, highlighted }。
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

  // 机器人图标：单击 / 双击触发对应自定义 prompt（设置「Prompt 模板」可自定义两种模板）
  function robotRun(context, payload) {
    if (!payload || !payload.promptKey) {
      throw new Error("缺少 promptKey 参数");
    }
    return MNIATFlow.robotPrompt(String(payload.promptKey));
  }

  // AI 对话（长按机器人图标）：payload.messages = [{role, content}] 完整对话历史；
  // payload.override = {providerId, modelId, reasoningEffort?} 临时覆盖 chat 路由
  // （模型选择 / 重新回答选模型 / 思考强度列表，均可单独出现，不写回设置）
  function chatSend(context, payload) {
    if (!payload || !Array.isArray(payload.messages)) {
      throw new Error("缺少对话消息");
    }
    return MNIATFlow.chatSend(payload.messages, payload.override);
  }

  // AI 对话历史：[{question, answer, at}]，最近在前（点击条目回放该轮问答）
  function getChatHistory() {
    return { items: MNIATChatHistory.list() };
  }

  // 暂停 AI 对话生成（输入行暂停按钮）：取消进行中的流式请求；
  // 已生成的部分由前端本地追加为回答（chatDraft 仍在前端）
  function chatStop() {
    return MNIATFlow.chatStop();
  }

  // 工具栏搜索框查询任意单词：按内容语言用默认查词服务（含中文 → 查词-中文，否则查词-英文）
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
  // 2026-09-18：window 解析失败不再抛错（此前抛「缺少窗口上下文，无法进入拼接模式」，
  // 前端 catch 会把错误吞掉 → 双击图钉毫无反应）。窗口只是「定位当前文档」用，
  // 拼接模式下每次划词都会用监听回调带回的窗口刷新会话，进入时缺失可由 lastWin 兜底。
  function enterAppendMode(context) {
    var win = null;
    try {
      win = (context && context.controller && context.controller.addonWindow) ||
        (context && context.addon && context.addon.window) || null;
    } catch (e) {
      // 实例属性在 bridge 上下文里可能不可读（本身抛错）：吞掉，交给 lastWin 兜底
      win = null;
    }
    if (!win) {
      console.log("[MNIATBridge] enterAppendMode: window unavailable, fall back to lastWin");
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
    applyPanelTheme,
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
    speakText,
    addCard,
    explainWithAI,
    robotRun,
    chatSend,
    chatStop,
    getChatHistory,
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
