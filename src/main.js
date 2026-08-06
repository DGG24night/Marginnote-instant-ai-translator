JSB.require("WebDevServerConfig");
JSB.require("WebBridgeCommands");
JSB.require("WebPanelController");
JSB.require("MNInstantAITranslatorAddon");

JSB.newAddon = function (mainPath) {
  return createMNInstantAITranslatorAddon(mainPath);
};
