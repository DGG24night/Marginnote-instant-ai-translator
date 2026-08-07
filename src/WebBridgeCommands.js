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

  function testProvider(context, payload) {
    if (!payload || !payload.provider || !payload.modelId) {
      throw new Error("缺少 provider 或 modelId 参数");
    }
    return MNIAIService.test(payload.provider, payload.modelId);
  }

  // ---------- 卡片交互 ----------

  function cardReady() {
    MNIATFlow.onCardReady();
    return { acknowledged: true };
  }

  function closeCard() {
    MNIATFlow.cancelCurrent();
    MNIATFloatingCard.hide();
    return { closed: true };
  }

  function copyText(context, payload) {
    var text = payload && payload.text;
    if (!text) {
      throw new Error("缺少待复制文本");
    }
    UIPasteboard.generalPasteboard().string = String(text);
    return { copied: true };
  }

  function explainWithAI() {
    return MNIATFlow.explainWithAI();
  }

  // 卡片前端测量内容高度后上报，插件侧钳制并调整 WebView 高度
  function resizeCard(context, payload) {
    if (context.kind === "card" && payload && typeof payload.height === "number") {
      MNIATFloatingCard.resizeToHeight(payload.height);
    }
    return { resized: true };
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
    testProvider,
    cardReady,
    closeCard,
    copyText,
    explainWithAI,
    resizeCard,
    closePanel,
  };

  return {
    commands,
  };
})();
