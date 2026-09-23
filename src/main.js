JSB.require("WebDevServerConfig");
JSB.require("base64");
JSB.require("network");
JSB.require("StreamChannel"); // delegate 真流式通道（SSE），AIService 流式输出依赖
JSB.require("MD5");
JSB.require("SHA1");
JSB.require("SHA256");
JSB.require("SettingsStore");
JSB.require("CacheStore");
JSB.require("ChatHistoryStore");
JSB.require("ConfigSync");
JSB.require("PromptTemplates");
JSB.require("AIService");
JSB.require("BaiduMachineTranslateService");
JSB.require("NiuTransMachineTranslateService");
JSB.require("AliyunMachineTranslateService");
JSB.require("TencentMachineTranslateService");
JSB.require("VolcengineMachineTranslateService");
JSB.require("YoudaoService");
JSB.require("BingDictionaryService");
JSB.require("HaiCiDictionaryService");
JSB.require("KingsoftDictionaryService");
JSB.require("XinhuaStrokes");            // 新华字典字页「总笔画」离线表（由 scripts/build-xinhua-strokes.js 生成）
JSB.require("XinhuaDictionaryService"); // 新华词典（汉字/词语/成语），依赖上方的笔画表
JSB.require("HanyuGuoxueService");      // 汉语国学（汉字/词语/成语，含引证/例如/英文折叠内容）
JSB.require("FloatingCardController");
JSB.require("TranslateFlow");
JSB.require("SelectionMonitor");
JSB.require("CardCreator");
JSB.require("WebBridgeCommands");
JSB.require("WebPanelController");
JSB.require("MNInstantAITranslatorAddon");

JSB.newAddon = function (mainPath) {
  return createMNInstantAITranslatorAddon(mainPath);
};
