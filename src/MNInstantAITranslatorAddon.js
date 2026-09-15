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

  // ---------- 划词监听对账心跳（2026-09-15） ----------
  // 背景：设置面板保存配置时，重启监听的调用链经过 UIWebView URL 拦截回调
  // （saveConfig → addon.syncSelectionMonitor → monitor.start）。该上下文里任一环节
  // （addon 实例属性可达性 / self.window / 定时器调度）静默失败，监听就会保持停止，
  // 表现为「关闭查词/翻译再开启后划词无响应，须退出重进文档才恢复」——且失败无任何
  // 报错，无法从外部定位具体环节。
  // 对策：在 notebookWillOpen（原生生命周期上下文，长时间运行已被验证可靠）启动本
  // 心跳，每 0.5s 调 SelectionMonitor.sync 对账：配置要求运行而监听未运行 → 立即用
  // 最近已知窗口重启；配置要求停止时 sync 内部自行判定，不会重启。即使 bridge 侧
  // 两条同步路径（插件实例 / 直连监听器）全部静默失败，监听最迟 0.5s 后也会恢复。
  // 心跳只读内存缓存配置 + 布尔判定，不触碰文档选区/焦点笔记，开销可忽略；
  // 笔记本关闭 / 插件断开时停止。
  var supervisorTimer = null;
  var MONITOR_SUPERVISOR_INTERVAL = 0.5;

  function startMonitorSupervisor() {
    stopMonitorSupervisor();
    try {
      supervisorTimer = NSTimer.scheduledTimerWithTimeInterval(MONITOR_SUPERVISOR_INTERVAL, true, function () {
        try {
          MNIATSelectionMonitor.sync();
        } catch (e) {
          console.log("[Instant AI Translator] supervisor sync error: " + e);
        }
      });
    } catch (e) {
      console.log("[Instant AI Translator] supervisor schedule error: " + e);
      supervisorTimer = null;
    }
  }

  function stopMonitorSupervisor() {
    if (supervisorTimer) {
      try {
        supervisorTimer.invalidate();
      } catch (e) { /* 桥接异常忽略：置空即可 */ }
      supervisorTimer = null;
    }
  }

  return JSB.defineClass("MNInstantAITranslatorAddon : JSExtension", {
    sceneWillConnect: function () {
      self.mainPath = mainPath;
      MNIATFloatingCard.setMainPath(mainPath);
      self.webController = __MN_WEB_API_MNInstantAITranslatorAddon.createController(mainPath, self);

      self.layoutViewController = function () {
        __MN_WEB_API_MNInstantAITranslatorAddon.ensureLayout(self.webController);
      };

      // 按查词/翻译开关同步划词监听启停（bridge saveConfig / 导入配置成功后调用）：
      //   都关闭 → 停止监听（含收起悬浮触发按钮）；任一开启 → 经 SelectionMonitor.sync
      //   重启（已运行则幂等返回，未运行则用 self.window 重启）。
      // 2026-09-15：本方法只是 bridge 同步的路径一（携带权威 self.window）；路径二为
      // WebBridgeCommands 直连 SelectionMonitor.sync（不依赖本实例可达），两条路径
      // 全部失效时由 startMonitorSupervisor 的对账心跳兜底恢复（见上方注释）。
      self.syncSelectionMonitor = function () {
        if (isLookupTranslateAllDisabled()) {
          MNIATSelectionMonitor.stop();
          MNIATFloatingCard.hideTrigger();
          console.log("[Instant AI Translator] lookup & translate both disabled, selection monitor stopped");
          return;
        }
        // 卡片 bridge 命令需要插件实例定位当前窗口（与 notebookWillOpen 对齐）
        MNIATFloatingCard.setAddon(self);
        MNIATSelectionMonitor.sync(self.window, monitorCallbacksFor(self.window));
        console.log("[Instant AI Translator] selection monitor synced after config change");
      };

      console.log("[Instant AI Translator] initialized");
    },

    sceneDidDisconnect: function () {
      stopMonitorSupervisor();
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
      // 任一开启 → 正常启动。设置变更后的启停同步走 self.syncSelectionMonitor + bridge
      // 直连路径，两条都失效时由下方对账心跳兜底。
      if (isLookupTranslateAllDisabled()) {
        // 走 sync 而非裸 stop：把窗口/回调记入监听器（lastKnownWindow/lastCallbacks），
        // 供「应用重启时两开关都关、之后才开启」的场景下兜底路径重启使用；
        // sync 内部按配置判定应停止 → stop（幂等），不会启动轮询。
        MNIATSelectionMonitor.sync(self.window, monitorCallbacksFor(self.window));
        MNIATFloatingCard.hideTrigger();
      } else {
        MNIATSelectionMonitor.start(self.window, monitorCallbacksFor(self.window));
      }
      // 对账心跳：监听「应运行而未运行」时自动恢复（含配置切换后 bridge 重启失败的场景）
      startMonitorSupervisor();
    },

    notebookWillClose: function () {
      stopMonitorSupervisor();
      MNIATSelectionMonitor.stop();
      MNIATFlow.cancelCurrent();
      MNIATFloatingCard.hide();
    },

    // 文档打开：对账划词监听（配置要求运行而监听未运行 → 立即重启）。
    // 覆盖「切换/重开文档后监听意外停止」的场景；正常情况下 notebookWillOpen 已启动，
    // sync 幂等（已运行直接返回；查词/翻译都关闭时不会重启）。
    documentDidOpen: function () {
      MNIATSelectionMonitor.sync(self.window, monitorCallbacksFor(self.window));
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
