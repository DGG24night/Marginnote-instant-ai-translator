JSB.require("WebDevServerConfig");
JSB.require("base64");
JSB.require("network");
JSB.require("SettingsStore");
JSB.require("CacheStore");
JSB.require("ConfigSync");
JSB.require("PromptTemplates");
JSB.require("AIService");
JSB.require("YoudaoService");
JSB.require("BingDictionaryService");
JSB.require("HaiCiDictionaryService");
JSB.require("KingsoftDictionaryService");
JSB.require("FloatingCardController");
JSB.require("TranslateFlow");
JSB.require("SelectionMonitor");
JSB.require("WebBridgeCommands");
JSB.require("WebPanelController");
JSB.require("MNInstantAITranslatorAddon");

JSB.newAddon = function (mainPath) {
  return createMNInstantAITranslatorAddon(mainPath);
};
