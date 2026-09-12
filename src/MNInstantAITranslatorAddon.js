function createMNInstantAITranslatorAddon(mainPath) {
  // 查词/翻译都关闭时插件完全静默：划词监听不启动/停止（不轮询选区、不读焦点笔记、
  // 不弹诊断 HUD）。注意：拼接模式需先有结果卡片才能进入（双击图钉），两者都关闭时
  // 不可能有卡片，因此无需为拼接模式保留监听。
  function isLookupTranslateAllDisabled() {
    var config = MNIATSettings.load();
    return config.lookupEnabled === false && config.translateEnabled === false;
  }

  // 划词监听回调（notebookWillOpen 与设置变更后的重启共用同一份，win 取调用时窗口）
  function monitorCallbacksFor(win) {
    return {
      onSelection: function (text, anchorRect, fallback) {
        // 拼接模式（双击图钉进入）：划词直接追加到拼接区，不受查词/翻译开关与 triggerMode 限制
        if (MNIATFlow.isAppendMode()) {
          MNIATFlow.handleSelection(win, text, anchorRect, fallback);
          return;
        }
        var config = MNIATSettings.load();
        // 独立开关：查词/翻译分别控制；两者都关闭时监听已停止，这里兜底不响应划词
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
      },
      // 图钉固定状态查询：选区监听在「点击空白关闭卡片」判定时调用，
      // 固定时点击脑图空白/菜单消失不关闭卡片（文档模式 blur 路径已有 pinned 检查）。
      isCardPinned: function () {
        return MNIATFloatingCard.isPinned();
      }
    };
  }

  return JSB.defineClass("MNInstantAITranslatorAddon : JSExtension", {
    sceneWillConnect: function () {
      self.mainPath = mainPath;
      MNIATFloatingCard.setMainPath(mainPath);
      self.webController = __MN_WEB_API_MNInstantAITranslatorAddon.createController(mainPath, self);

      self.layoutViewController = function () {
        __MN_WEB_API_MNInstantAITranslatorAddon.ensureLayout(self.webController);
      };

      // 按查词/翻译开关同步划词监听启停（bridge saveConfig / 导入配置成功后调用；
      // notebookWillOpen 走无条件接管，不经过这里）：
      //   都关闭 → 停止监听（含收起悬浮触发按钮）；任一开启 → 立即重启监听。
      // 修复（2026-09-12）：恢复分支不再用「已运行则不重启」守卫（依赖 isRunning 判定），
      // 改为与 notebookWillOpen 相同的无条件 start —— SelectionMonitor.start 自带先停旧
      // 计时器 + 重置状态，且启动时把文档残留选区预置为「已触发」（见 SelectionMonitor.start），
      // 不会因重启让旧选区重复触发翻译；同时避免了 isRunning 误报 true（stop 时 invalidate
      // 抛错导致 timer 残留）造成恢复后监听永远不启动、必须重开笔记本才恢复的失效场景。
      self.syncSelectionMonitor = function () {
        if (isLookupTranslateAllDisabled()) {
          if (MNIATSelectionMonitor.isRunning()) {
            MNIATSelectionMonitor.stop();
            MNIATFloatingCard.hideTrigger();
            console.log("[Instant AI Translator] lookup & translate both disabled, selection monitor stopped");
          }
          return;
        }
        if (self.window) {
          // 与 notebookWillOpen 对齐：卡片 bridge 命令需要插件实例定位当前窗口
          MNIATFloatingCard.setAddon(self);
          MNIATSelectionMonitor.start(self.window, monitorCallbacksFor(self.window));
          console.log("[Instant AI Translator] selection monitor restarted after config change");
        }
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

      // 注入插件实例到卡片控制器：卡片 bridge 命令（addCard 等）需要 addon.window 定位当前窗口
      MNIATFloatingCard.setAddon(self);
      // 打开笔记本时按开关接管监听（保持旧版「无条件重启、本窗口持有监听」语义）：
      // 查词/翻译都关闭 → 彻底不启动（用户点击脑图空白等动作插件不再感知，不弹诊断 HUD）；
      // 任一开启 → 正常启动。设置变更后的启停同步走 self.syncSelectionMonitor（带守卫）。
      if (isLookupTranslateAllDisabled()) {
        MNIATSelectionMonitor.stop();
        MNIATFloatingCard.hideTrigger();
      } else {
        MNIATSelectionMonitor.start(self.window, monitorCallbacksFor(self.window));
      }
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
