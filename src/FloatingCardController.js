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
  var CARD_MARGIN = 8;
  var EDGE_PADDING = 12;

  var BRIDGE_SCHEME = "mnaddon";
  var BRIDGE_HOST = "bridge";

  var controller = null;
  var triggerButton = null;
  var pendingTrigger = null; // { win, text, rect }
  var addonMainPath = null;

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

  // ---------- 工具 ----------

  function evaluateScript(webView, script) {
    webView.evaluateJavaScript(script, function () {});
  }

  function encodeEventJSON(value) {
    return JSON.stringify(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

  function computeFrame(anchorRect, bounds) {
    var x;
    var y;
    if (anchorRect) {
      x = anchorRect.x;
      y = anchorRect.y + anchorRect.height + CARD_MARGIN;
      if (y + CARD_HEIGHT > bounds.y + bounds.height - EDGE_PADDING) {
        y = anchorRect.y - CARD_HEIGHT - CARD_MARGIN;
      }
    } else {
      x = bounds.x + (bounds.width - CARD_WIDTH) / 2;
      y = bounds.y + (bounds.height - CARD_HEIGHT) / 2;
    }
    x = Math.max(bounds.x + EDGE_PADDING, Math.min(x, bounds.x + bounds.width - CARD_WIDTH - EDGE_PADDING));
    y = Math.max(bounds.y + EDGE_PADDING, Math.min(y, bounds.y + bounds.height - CARD_HEIGHT - EDGE_PADDING));
    return { x: x, y: y, width: CARD_WIDTH, height: CARD_HEIGHT };
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
    },

    webViewDidFinishLoad: function () {
      self._loaded = true;
      console.log("[MNIATCard] page loaded");
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
    }
  });

  // ---------- 对外接口 ----------

  return {
    setMainPath: function (mainPath) {
      addonMainPath = mainPath;
    },

    ensureController: function (win) {
      if (!controller) {
        controller = cardControllerClass.new();
        controller.addonWindow = win;
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

      c.view.frame = computeFrame(anchorRect, studyController.view.bounds);
      if (!c.view.superview) {
        studyController.view.addSubview(c.view);
      }
      c.view.hidden = false;

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
    // 底部越界时向上收；宽度不变
    resizeToHeight: function (height) {
      if (!controller || !controller.view || !controller.view.superview) return;
      var h = Math.max(CARD_MIN_HEIGHT, Math.min(height, CARD_MAX_HEIGHT));
      var f = controller.view.frame;
      if (Math.abs(f.height - h) < 1) return;
      var bounds = controller.view.superview.bounds;
      var y = f.y;
      if (y + h > bounds.y + bounds.height - EDGE_PADDING) {
        y = Math.max(bounds.y + EDGE_PADDING, bounds.y + bounds.height - h - EDGE_PADDING);
      }
      controller.view.frame = { x: f.x, y: y, width: f.width, height: h };
      controller._container.frame = { x: 0, y: 0, width: f.width, height: h };
      controller._webView.frame = { x: 0, y: 0, width: f.width, height: h };
    },

    hide: function () {
      if (controller && controller.view && controller.view.superview) {
        controller.view.removeFromSuperview();
      }
      this.hideTrigger();
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
