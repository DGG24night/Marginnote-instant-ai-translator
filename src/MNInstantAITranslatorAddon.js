function createMNInstantAITranslatorAddon(mainPath) {
  return JSB.defineClass("MNInstantAITranslatorAddon : JSExtension", {
    sceneWillConnect: function () {
      self.mainPath = mainPath;
      MNIATFloatingCard.setMainPath(mainPath);
      self.webController = __MN_WEB_API_MNInstantAITranslatorAddon.createController(mainPath, self);

      self.layoutViewController = function () {
        __MN_WEB_API_MNInstantAITranslatorAddon.ensureLayout(self.webController);
      };

      console.log("[Instant AI Translator] initialized");
    },

    sceneDidDisconnect: function () {
      MNIATSelectionMonitor.stop();
      MNIATFlow.cancelCurrent();
      MNIATFloatingCard.destroy();
      if (self.webController && self.webController.view && self.webController.view.superview) {
        self.webController.view.removeFromSuperview();
      }
      self.webController = null;
      console.log("[Instant AI Translator] disconnected");
    },

    notebookWillOpen: function () {
      if (!self.webController) {
        throw new Error("webController not initialized");
      }

      self.webController.addon = self;
      self.webController.addonWindow = self.window;

      if (__MN_WEB_API_MNInstantAITranslatorAddon.shouldRestorePanel()) {
        __MN_WEB_API_MNInstantAITranslatorAddon.showPanel(self.webController);
        self.layoutViewController();
      }

      var win = self.window;
      // 注入插件实例到卡片控制器：卡片 bridge 命令（addCard 等）需要 addon.window 定位当前窗口
      MNIATFloatingCard.setAddon(self);
      MNIATSelectionMonitor.start(win, {
        onSelection: function (text, anchorRect, fallback) {
          var config = MNIATSettings.load();
          // 独立开关：查词/翻译分别控制；两者都关闭时不响应划词（旧版总开关 enabled 已并入这两个开关）
          if (config.lookupEnabled === false && config.translateEnabled === false) return;
          if (config.triggerMode === "button") {
            // 悬浮按钮模式：先按独立开关判断该选区是否应处理，再显示小按钮，点击后才触发
            if (!MNIATFlow.canHandle(text)) return;
            MNIATFloatingCard.showTrigger(win, anchorRect, text);
          } else {
            MNIATFlow.handleSelection(win, text, anchorRect, fallback);
          }
        },
        // 点击空白（菜单新弹出但无任何选中，或焦点笔记残留同一张卡片）：关闭结果卡片。
        // 弥补脑图模式下 WebView blur 不触发导致无法点空白关闭的场景；
        // 文档模式 blur 正常，此路径作为兜底（结果一致：关闭卡片）。
        onBlankClick: function () {
          MNIATFloatingCard.hideTrigger();
          MNIATFlow.cancelCurrent();
          MNIATFloatingCard.hide();
        },
        onClear: function () {
          // 选区清空：收起悬浮按钮（结果卡片保留，由用户手动关闭或被新选区取代）
          MNIATFloatingCard.hideTrigger();
        }
      });
    },

    notebookWillClose: function () {
      MNIATSelectionMonitor.stop();
      MNIATFlow.cancelCurrent();
      MNIATFloatingCard.hide();
    },

    controllerWillLayoutSubviews: function (controller) {
      if (controller === Application.sharedInstance().studyController(self.window)) {
        self.layoutViewController();
      }
    },

    queryAddonCommandStatus: function () {
      const checked =
        self.webController &&
        self.webController.view &&
        self.webController.view.window
          ? true
          : false;

      return {
        image: "icon.png",
        object: self,
        selector: "toggleWebPanel:",
        checked,
      };
    },

    toggleWebPanel: function () {
      if (!self.webController) {
        throw new Error("webController not initialized");
      }

      if (self.webController.view && self.webController.view.window) {
        __MN_WEB_API_MNInstantAITranslatorAddon.hidePanel(self.webController);
      } else {
        __MN_WEB_API_MNInstantAITranslatorAddon.showPanel(self.webController);
        self.layoutViewController();
      }

      Application.sharedInstance().studyController(self.window).refreshAddonCommands();
    },
  });
}
