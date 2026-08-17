// FloatingCardController.js —— 划词结果悬浮卡片 + 悬浮触发按钮
// 卡片为独立 UIWebView，加载 web 前端 #/card 路由：
//   - 插件 → 卡片：window.__MNIATCardEvent(json) 事件推送（loading/delta/result/error）
//   - 卡片 → 插件：mnaddon://bridge URL 拦截（与设置面板共用 WebBridgeCommands）
// 定位：锚定 PopupMenu 选区 rect，优先下方、空间不足翻上方，水平钳制。

var MNIATFloatingCard = (function () {
  var CARD_WIDTH = 360;
  var CARD_HEIGHT = 180;      // 初始高度（loading 态），内容到达后由前端测量上报自适应
  var CARD_MIN_HEIGHT = 80;
  var CARD_MAX_HEIGHT = 420;
  var CARD_MIN_WIDTH = 260;
  var CARD_MAX_WIDTH = 520;
  var CARD_MARGIN = 8;
  var EDGE_PADDING = 12;
  var CARD_DRAG_TOP = 44;             // 顶部拖动条高度（覆盖 web toolbar 区域）
  // 拖动条右侧让出的宽度：需避开工具栏全部按钮。
  // 工具栏按钮（2026-08-14 扩展）：搜索、英/美发音、添加、AI解释、重新生成、复制、图钉 ≈ 270px，
  // 加 12px 右边距 → 285。
  var CARD_DRAG_BAR_RIGHT = 285;
  var CARD_RESIZE_HANDLE_SIZE = 40;   // 右下角缩放手柄触摸区
  var CARD_SIZE_KEY = "mn_iat_card_size"; // NSUserDefaults：记住的卡片尺寸

  var BRIDGE_SCHEME = "mnaddon";
  var BRIDGE_HOST = "bridge";

  var controller = null;
  var triggerButton = null;
  var pendingTrigger = null; // { win, text, rect }
  var addonMainPath = null;
  var addonInstance = null;  // 插件实例（notebookWillOpen 时注入，卡片 bridge 命令需要访问 window）

  // 图钉固定状态：pinned = true 时点击卡片外部不自动关闭（工具栏图钉按钮切换）
  var pinned = false;
  var focusTimer = null; // 延迟聚焦 NSTimer（页面加载后让卡片 WebView 成为 firstResponder）

  // 悬浮按钮点击目标（类只定义一次，实例随按钮创建）
  var triggerTapTargetClass = JSB.defineClass("MNIATTriggerTapTarget : NSObject", {
    onTap: function () {
      var pending = pendingTrigger;
      MNIATFloatingCard.hideTrigger();
      if (pending) {
        MNIATFlow.handleSelection(pending.win, pending.text, pending.rect);
      }
    }
  });

  // 点击卡片外部自动关闭：blur（焦点）方案。
  // 背景：macOS 上文档区/卡片都是 UIWebView，会吞掉区域内的鼠标事件，任何覆盖在文档上的
  //       透明垫层都会连带拦截滚轮（UIButton/UIView 均实测失效），无法两全。
  // 方案：卡片显示时让卡片 WebView 成为 firstResponder（becomeFirstResponder，cookbook 有示例），
  //       前端监听 window blur——点击外部（文档/侧栏）→ WebView 失焦 → blur → 通知插件关闭；
  //       滚轮滚动文档不改变焦点 → 滚动照常；点击卡片内 → WebView 保持焦点 → 不误关。
  // 仅卡片可见且未固定（pinned=false）时关闭卡片。
  function requestCardFocus() {
    if (!controller || !controller._webView) return;
    try {
      controller._webView.becomeFirstResponder();
    } catch (e) { /* 忽略：聚焦失败时 blur 可能不触发，属环境限制 */ }
  }

  // 前端 window blur 通知：未固定则关闭卡片
  function onLostFocus() {
    if (!controller || !controller.view || !controller.view.superview) return;
    if (pinned) return; // 图钉固定：失焦不关闭
    console.log("[MNIATCard] lost focus -> hide");
    MNIATFlow.cancelCurrent();
    MNIATFloatingCard.hide();
  }

  // ---------- 工具 ----------

  function evaluateScript(webView, script) {
    webView.evaluateJavaScript(script, function () {});
  }

  function encodeEventJSON(value) {
    return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  // ---------- 记住卡片尺寸 ----------

  function rememberSizeEnabled() {
    try {
      return MNIATSettings.load().rememberCardSize === true;
    } catch (e) {
      return false;
    }
  }

  function loadCardSize() {
    var v = NSUserDefaults.standardUserDefaults().objectForKey(CARD_SIZE_KEY);
    if (v && typeof v.width === "number" && typeof v.height === "number") {
      return { width: v.width, height: v.height };
    }
    return null;
  }

  function saveCardSize(width, height) {
    if (!rememberSizeEnabled()) return;
    NSUserDefaults.standardUserDefaults().setObjectForKey({ width: width, height: height }, CARD_SIZE_KEY);
  }

  // 同步卡片各层 frame（view / 白色容器 / webView / 拖动条 / 缩放手柄），可选项：持久化尺寸
  function applyCardFrame(c, f, persistSize) {
    c.view.frame = { x: f.x, y: f.y, width: f.width, height: f.height };
    c._container.frame = { x: 0, y: 0, width: f.width, height: f.height };
    c._webView.frame = { x: 0, y: 0, width: f.width, height: f.height };
    if (c._dragBar) {
      c._dragBar.frame = {
        x: 0,
        y: 0,
        width: Math.max(0, f.width - CARD_DRAG_BAR_RIGHT),
        height: CARD_DRAG_TOP
      };
    }
    if (c._resizeHandle) {
      c._resizeHandle.frame = {
        x: f.width - CARD_RESIZE_HANDLE_SIZE,
        y: f.height - CARD_RESIZE_HANDLE_SIZE,
        width: CARD_RESIZE_HANDLE_SIZE,
        height: CARD_RESIZE_HANDLE_SIZE
      };
    }
    if (persistSize === true) {
      saveCardSize(f.width, f.height);
    }
  }

  function decodeBridgeMessage(requestURL) {
    var absolute = String(requestURL.absoluteString());
    if (absolute.indexOf(BRIDGE_SCHEME + "://" + BRIDGE_HOST) !== 0) {
      throw new Error("Unexpected bridge URL: " + absolute);
    }
    var marker = "payload=";
    var index = absolute.indexOf(marker);
    if (index < 0) {
      throw new Error("Missing payload in bridge URL");
    }
    return JSON.parse(decodeURIComponent(absolute.slice(index + marker.length)));
  }

  function sendBridgeResponse(webView, requestId, result, error) {
    var response = {
      requestId: requestId,
      payload: result === undefined ? null : result,
      error: error === undefined ? null : error,
    };
    evaluateScript(webView, "window.__MNBridgeReceive_MNInstantAITranslatorAddon('" + encodeEventJSON(response) + "')");
  }

  function isPromiseLike(value) {
    return !!value && typeof value.then === "function";
  }

  function resolveCardEntryURL(mainPath) {
    var devServerURL = __MNGetWebDevServerURL_MNInstantAITranslatorAddon();
    if (devServerURL) {
      return NSURL.URLWithString(devServerURL + "/#/card");
    }
    var localEntryPath = mainPath + "/web-dist/index.html";
    return NSURL.URLWithString("file://" + localEntryPath + "#/card");
  }

  function computeFrame(anchorRect, bounds, size) {
    var width = (size && size.width) ? size.width : CARD_WIDTH;
    var height = (size && size.height) ? size.height : CARD_HEIGHT;
    var x;
    var y;
    if (anchorRect) {
      x = anchorRect.x;
      y = anchorRect.y + anchorRect.height + CARD_MARGIN;
      if (y + height > bounds.y + bounds.height - EDGE_PADDING) {
        y = anchorRect.y - height - CARD_MARGIN;
      }
    } else {
      x = bounds.x + (bounds.width - width) / 2;
      y = bounds.y + (bounds.height - height) / 2;
    }
    x = Math.max(bounds.x + EDGE_PADDING, Math.min(x, bounds.x + bounds.width - width - EDGE_PADDING));
    y = Math.max(bounds.y + EDGE_PADDING, Math.min(y, bounds.y + bounds.height - height - EDGE_PADDING));
    return { x: x, y: y, width: width, height: height };
  }

  // ---------- 卡片 ViewController ----------

  var cardControllerClass = JSB.defineClass("MNIATCardController : UIViewController <UIWebViewDelegate>", {
    viewDidLoad: function () {
      self.view.autoresizingMask = 0;
      self.view.backgroundColor = UIColor.clearColor();
      self.view.layer.cornerRadius = 12;
      self.view.layer.shadowOffset = { width: 0, height: 4 };
      self.view.layer.shadowRadius = 12;
      self.view.layer.shadowOpacity = 0.25;
      self.view.layer.shadowColor = UIColor.blackColor();
      self.view.layer.masksToBounds = false;

      self._container = new UIView({ x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT });
      self._container.backgroundColor = UIColor.whiteColor();
      self._container.layer.cornerRadius = 12;
      self._container.layer.masksToBounds = true;
      self.view.addSubview(self._container);

      self._webView = new UIWebView({ x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT });
      self._webView.backgroundColor = UIColor.whiteColor();
      self._webView.delegate = self;
      self._container.addSubview(self._webView);

      // 原生拖动条：透明，覆盖 web toolbar 左侧区域（避开右侧按钮），
      // 手势加在纯 UIView 上，避免被 UIWebView 拦截（macOS WebView 会吞掉区域内的鼠标事件）
      self._dragBar = new UIView({
        x: 0,
        y: 0,
        width: CARD_WIDTH - CARD_DRAG_BAR_RIGHT,
        height: CARD_DRAG_TOP
      });
      self._dragBar.backgroundColor = UIColor.clearColor();
      self._dragPan = new UIPanGestureRecognizer(self, "handleCardPan:");
      self._dragBar.addGestureRecognizer(self._dragPan);
      // 点击 bar 图标（拖动条左端）打开查词服务切换菜单：
      // 拖动条是覆盖在 web 工具栏左端的原生透明层，web 层收不到该区域的点击，
      // 故由原生 tap 识别后转发给前端（pan 与 tap 互不冲突：拖动时 tap 自动失败）。
      self._dragTap = new UITapGestureRecognizer(self, "handleCardDragTap:");
      self._dragBar.addGestureRecognizer(self._dragTap);
      self._container.addSubview(self._dragBar);

      // 右下角缩放手柄
      self._resizeHandle = new UIView({
        x: CARD_WIDTH - CARD_RESIZE_HANDLE_SIZE,
        y: CARD_HEIGHT - CARD_RESIZE_HANDLE_SIZE,
        width: CARD_RESIZE_HANDLE_SIZE,
        height: CARD_RESIZE_HANDLE_SIZE
      });
      self._resizeHandle.backgroundColor = UIColor.clearColor();
      self._resizeHandle.userInteractionEnabled = true;
      var resizeIcon = new UILabel({ x: 10, y: 10, width: 20, height: 20 });
      resizeIcon.text = "↘";
      resizeIcon.font = UIFont.systemFontOfSize(14);
      resizeIcon.textColor = UIColor.grayColor();
      resizeIcon.alpha = 0.45;
      self._resizeHandle.addSubview(resizeIcon);
      self._resizePan = new UIPanGestureRecognizer(self, "handleCardResize:");
      self._resizeHandle.addGestureRecognizer(self._resizePan);
      self._container.addSubview(self._resizeHandle);
    },

    webViewDidFinishLoad: function () {
      self._loaded = true;
      console.log("[MNIATCard] page loaded");
      // 页面加载完成后再尝试聚焦（blur 方案需要 WebView 持有焦点）
      requestCardFocus();
    },

    webViewDidFailLoadWithError: function (webView, error) {
      console.log("[MNIATCard] load failed: " + (error ? error.localizedDescription : "unknown"));
    },

    webViewShouldStartLoadWithRequestNavigationType: function (webView, request, navigationType) {
      try {
        var url = request.URL();
        var scheme = String(url.scheme || "").toLowerCase();
        if (scheme !== BRIDGE_SCHEME) {
          return true;
        }

        var message = decodeBridgeMessage(url);
        var handler = __MN_WEB_BRIDGE_COMMANDS_MNInstantAITranslatorAddon.commands[message.command];
        if (typeof handler !== "function") {
          throw new Error("Unknown bridge command: " + message.command);
        }

        var context = { controller: self, addon: self.addon, kind: "card" };
        var result = handler(context, message.payload);

        if (isPromiseLike(result)) {
          result.then(function (payload) {
            sendBridgeResponse(webView, message.requestId, payload, null);
          }).catch(function (error) {
            sendBridgeResponse(webView, message.requestId, null, {
              message: String((error && error.message) || error),
              command: message.command
            });
          });
          return false;
        }

        sendBridgeResponse(webView, message.requestId, result, null);
        return false;
      } catch (error) {
        sendBridgeResponse(webView, "unknown", null, {
          message: String((error && error.message) || error),
          command: "unknown"
        });
        console.log("[MNIATCard] bridge error: " + error);
        return false;
      }
    },

    // 点击工具栏最左侧 bar 图标区域：打开查词服务切换菜单（转发给前端）
    handleCardDragTap: function (recognizer) {
      if (recognizer.state === 3) { // Ended
        var pt = recognizer.locationInView(self._dragBar);
        if (pt.x >= 0 && pt.x <= 48 && pt.y >= 0 && pt.y <= CARD_DRAG_TOP) {
          evaluateScript(self._webView, "window.__MNIATCardOpenSwitch && window.__MNIATCardOpenSwitch()");
        }
      }
    },

    // 拖动卡片：手势仅挂在顶部透明拖动条上（不拦截 webView 内容区）
    handleCardPan: function (recognizer) {
      if (recognizer.state === 1) {
        self._panStartFrame = self.view.frame;
        return;
      }

      if (recognizer.state === 2) {
        var translation = recognizer.translationInView(self.view.superview);
        var superview = self.view.superview;
        var bounds = superview ? superview.bounds : { x: 0, y: 0, width: 1920, height: 1080 };
        var start = self._panStartFrame;
        var nx = start.x + translation.x;
        var ny = start.y + translation.y;
        nx = Math.max(bounds.x, Math.min(nx, bounds.x + bounds.width - start.width));
        ny = Math.max(bounds.y, Math.min(ny, bounds.y + bounds.height - start.height));
        self.view.frame = { x: nx, y: ny, width: start.width, height: start.height };
        return;
      }

      if (recognizer.state === 3) {
        self._panStartFrame = null;
      }
    },

    // 右下角缩放手柄：改变卡片宽高，结束后按"记住大小"开关决定是否持久化
    handleCardResize: function (recognizer) {
      if (recognizer.state === 1) {
        self._resizeStartFrame = self.view.frame;
        return;
      }

      if (recognizer.state === 2) {
        var translation = recognizer.translationInView(self.view.superview);
        var start = self._resizeStartFrame;
        var width = Math.max(CARD_MIN_WIDTH, Math.min(start.width + translation.x, CARD_MAX_WIDTH));
        var height = Math.max(CARD_MIN_HEIGHT, Math.min(start.height + translation.y, CARD_MAX_HEIGHT));
        var superview = self.view.superview;
        var bounds = superview ? superview.bounds : { x: 0, y: 0, width: 1920, height: 1080 };
        var f = { x: start.x, y: start.y, width: width, height: height };
        if (f.x + width > bounds.x + bounds.width - EDGE_PADDING) {
          f.x = Math.max(bounds.x + EDGE_PADDING, bounds.x + bounds.width - width - EDGE_PADDING);
        }
        if (f.y + height > bounds.y + bounds.height - EDGE_PADDING) {
          f.y = Math.max(bounds.y + EDGE_PADDING, bounds.y + bounds.height - height - EDGE_PADDING);
        }
        applyCardFrame(self, f, false);
        return;
      }

      if (recognizer.state === 3) {
        saveCardSize(self.view.frame.width, self.view.frame.height);
        self._resizeStartFrame = null;
      }
    }
  });

  // ---------- 对外接口 ----------

  return {
    setMainPath: function (mainPath) {
      addonMainPath = mainPath;
    },

    // 注入插件实例：卡片 bridge 命令（如 addCard）需要 addon.window 定位当前窗口
    setAddon: function (addon) {
      addonInstance = addon;
    },

    ensureController: function (win) {
      if (!controller) {
        controller = cardControllerClass.new();
        controller.addonWindow = win;
        controller.addon = addonInstance; // 与面板控制器一致：卡片 controller 也可访问插件实例
      }
      return controller;
    },

    // 显示卡片并加载 #/card；返回 true 表示触发了页面（重新）加载
    showJob: function (win, anchorRect) {
      var c = this.ensureController(win);
      var studyController = Application.sharedInstance().studyController(win);
      if (!studyController || !studyController.view) {
        console.log("[MNIATCard] studyController unavailable");
        return false;
      }

      var savedSize = rememberSizeEnabled() ? loadCardSize() : null;
      // 图钉固定：卡片停留在当前位置，不跟随划词位置（固定行为，v0.7.2 起不再可配置）
      if (!pinned) {
        applyCardFrame(c, computeFrame(anchorRect, studyController.view.bounds, savedSize), false);
      }
      if (!c.view.superview) {
        studyController.view.addSubview(c.view);
      }
      c.view.hidden = false;
      // blur 方案：让卡片 WebView 持有焦点，前端失焦（点击外部）时通知关闭。
      // 立即聚焦 + 延迟再聚焦（页面/窗口就绪后），提高聚焦成功率
      requestCardFocus();
      if (focusTimer) {
        focusTimer.invalidate();
        focusTimer = null;
      }
      focusTimer = NSTimer.scheduledTimerWithTimeInterval(0.5, false, function () {
        focusTimer = null;
        if (controller && controller.view && controller.view.superview) {
          requestCardFocus();
        }
      });

      if (c._loaded) {
        // 页面已加载：复用，前端不会再次发 cardReady，直接重启任务
        MNIATFlow.restartJob();
        return false;
      }

      c._webView.loadRequest(NSURLRequest.requestWithURL(resolveCardEntryURL(addonMainPath)));
      return true;
    },

    // 插件 → 卡片事件推送
    sendEvent: function (obj) {
      if (!controller || !controller._webView || !controller._loaded) return;
      evaluateScript(
        controller._webView,
        "window.__MNIATCardEvent && window.__MNIATCardEvent('" + encodeEventJSON(obj) + "')"
      );
    },

    // 前端测量内容高度后调用：钳制在 [MIN, MAX]，保持水平位置，
    // 底部越界时向上收；宽度不变。
    // 若开启"记住大小"且已保存过尺寸，则以用户手动调整的大小为准，跳过自动高度。
    resizeToHeight: function (height) {
      if (!controller || !controller.view || !controller.view.superview) return;
      if (rememberSizeEnabled() && loadCardSize()) return;
      var h = Math.max(CARD_MIN_HEIGHT, Math.min(height, CARD_MAX_HEIGHT));
      var f = controller.view.frame;
      if (Math.abs(f.height - h) < 1) return;
      var bounds = controller.view.superview.bounds;
      var y = f.y;
      if (y + h > bounds.y + bounds.height - EDGE_PADDING) {
        y = Math.max(bounds.y + EDGE_PADDING, bounds.y + bounds.height - h - EDGE_PADDING);
      }
      applyCardFrame(controller, { x: f.x, y: y, width: f.width, height: h }, false);
    },

    // 卡片高度上下限（供前端 cardReady 获取，测量结果按此钳制上报）
    limits: function () {
      return { minHeight: CARD_MIN_HEIGHT, maxHeight: CARD_MAX_HEIGHT };
    },

    hide: function () {
      if (focusTimer) {
        focusTimer.invalidate();
        focusTimer = null;
      }
      pinned = false; // 卡片隐藏后解除固定（下次出现默认可点击外部关闭）
      if (controller && controller.view && controller.view.superview) {
        controller.view.removeFromSuperview();
      }
      this.hideTrigger();
      // 通知选区监听：清空 lastFiredText，让"再次选中同一文本"等同首次选中。
      // 所有关闭路径（onBlankClick / onLostFocus / closeCard bridge / notebookWillClose）
      // 都走 hide，因此统一在这里通知一次。TranslateFlow.cancelCurrent
      // 不再调（避免 handleSelection 内取消时把"等待被关闭的"状态一起清掉造成抽搐）。
      try {
        if (typeof MNIATSelectionMonitor !== "undefined" &&
          MNIATSelectionMonitor && typeof MNIATSelectionMonitor.notifyCardClosed === "function") {
          MNIATSelectionMonitor.notifyCardClosed();
        }
      } catch (e) { /* 忽略通知失败，不影响隐藏 */ }
    },

    destroy: function () {
      this.hide();
      if (controller && controller._webView) {
        controller._webView.delegate = null;
      }
      controller = null;
    },

    isVisible: function () {
      return !!(controller && controller.view && controller.view.superview);
    },

    // 前端 window blur（卡片 WebView 失焦，即点击卡片外部）通知：未固定则关闭
    cardLostFocus: function () {
      onLostFocus();
      return { closed: true };
    },

    // 图钉固定状态：true = 固定（点击卡片外部不自动关闭）；false = 默认（点击外部关闭）
    setPinned: function (value) {
      pinned = !!value;
      // 固定状态变化后重新聚焦 WebView：点击图钉按钮（可聚焦 DOM 元素）可能让窗口焦点
      // 脱离卡片，导致之后点外部不再触发 blur（bug：取消固定后点外部不关闭）。
      requestCardFocus();
      return { pinned: pinned };
    },

    // 图钉固定状态查询：选区监听在脑图模式「点击空白关闭」判定时使用——
    // 固定时点空白不关闭卡片（与文档模式 blur 路径的 pinned 检查一致）。
    isPinned: function () {
      return pinned;
    },

    // ---------- 悬浮触发按钮（triggerMode = button） ----------

    showTrigger: function (win, anchorRect, text) {
      this.hideTrigger();
      var studyController = Application.sharedInstance().studyController(win);
      if (!studyController || !studyController.view) return;

      pendingTrigger = { win: win, text: text, rect: anchorRect };

      var bounds = studyController.view.bounds;
      var size = 40;
      var x = anchorRect ? anchorRect.x + anchorRect.width + 8 : bounds.x + bounds.width / 2;
      var y = anchorRect ? anchorRect.y + anchorRect.height + 4 : bounds.y + bounds.height / 2;
      x = Math.max(bounds.x + EDGE_PADDING, Math.min(x, bounds.x + bounds.width - size - EDGE_PADDING));
      y = Math.max(bounds.y + EDGE_PADDING, Math.min(y, bounds.y + bounds.height - size - EDGE_PADDING));

      triggerButton = new UIButton({ x: x, y: y, width: size, height: size });
      triggerButton.setTitleForState("译", 0);
      triggerButton.setTitleColorForState(UIColor.whiteColor(), 0);
      triggerButton.titleLabel.font = UIFont.boldSystemFontOfSize(16);
      triggerButton.backgroundColor = UIColor.colorWithRedGreenBlueAlpha(0.2, 0.5, 0.9, 0.95);
      triggerButton.layer.cornerRadius = size / 2;
      triggerButton.layer.shadowOffset = { width: 0, height: 2 };
      triggerButton.layer.shadowRadius = 6;
      triggerButton.layer.shadowOpacity = 0.3;
      triggerButton.layer.shadowColor = UIColor.blackColor();

      var target = triggerTapTargetClass.new();
      triggerButton._tapTarget = target;
      triggerButton.addTargetActionForControlEvents(target, "onTap", 1 << 6); // touchUpInside

      studyController.view.addSubview(triggerButton);
    },

    hideTrigger: function () {
      if (triggerButton && triggerButton.superview) {
        triggerButton.removeFromSuperview();
      }
      triggerButton = null;
      pendingTrigger = null;
    }
  };
})();
