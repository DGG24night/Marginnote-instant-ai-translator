// SelectionMonitor.js —— 划词监听
// 原理：文档未提供"选中文本"系统通知，采用 NSTimer 轮询
//   currentDocumentController.selectionText。
// 触发时机（2026-08-07 改进）：
//   1. 候选文本连续 STABLE_TICKS 轮一致 → 进入"待触发"状态
//   2. 等待选区菜单弹出（PopupMenu.currentMenu().visible 为 true）才触发——
//      MarginNote 在鼠标抬起后才会弹出选区菜单，以此判定"选中结束"，
//      避免拖选过程中停顿即触发。
//   3. 兜底：待触发超过 PENDING_TIMEOUT_MS 仍未见菜单，直接触发。
// 锚点：触发后读取 PopupMenu.currentMenu().targetWinRect（选区菜单 rect）。
// 辅助摘录（2026-08-07）：
//   框选/双击段落的"辅助摘录"选区不置 isSelectionText，但识别文本很可能
//   写入 selectionText，因此不再以 isSelectionText 为门控，只要求文本非空。
//   若菜单弹出时读不到文本，用 HUD 输出一次性诊断（console 日志不可见）。

var MNIATSelectionMonitor = (function () {
  var POLL_INTERVAL = 0.3;      // 轮询间隔（秒）
  var ANCHOR_DELAY = 0.15;      // 触发后取锚点的延迟（等弹出菜单出现）
  var STABLE_TICKS = 2;         // 文本稳定轮数

  var timer = null;
  var targetWindow = null;
  var callbacks = {};

  var lastFiredText = "";
  var candidateText = "";
  var candidateTicks = 0;
  var pendingText = "";      // 已稳定、等待"选中结束"（菜单弹出）的文本
  var pendingSince = 0;

  var PENDING_TIMEOUT_MS = 1500; // 等待菜单弹出的超时兜底

  function isMenuVisible() {
    try {
      var menu = PopupMenu.currentMenu();
      return !!(menu && menu.visible);
    } catch (e) {
      return false;
    }
  }

  function readDocController() {
    try {
      var studyController = Application.sharedInstance().studyController(targetWindow);
      if (!studyController || !studyController.readerController) return null;
      return studyController.readerController.currentDocumentController || null;
    } catch (e) {
      return null;
    }
  }

  function readSelectionText() {
    try {
      var docController = readDocController();
      if (!docController) return null;
      // 不以 isSelectionText 为门控：辅助摘录（框选/双击段落）时该标志为
      // false，但识别出的文本仍可能写入 selectionText。
      var raw = docController.selectionText;
      if (raw) {
        var text = String(raw).trim();
        return text.length > 0 ? text : null;
      }
    } catch (e) {
      // 窗口切换/文档未打开等瞬时状态，静默忽略
    }
    return null;
  }

  // 一次性诊断：菜单弹出却读不到选中文本时，用 HUD 显示内部状态，
  // 帮助定位"辅助摘录选区是否写入 selectionText"（console 日志不可见）。
  var menuWasVisible = false;
  var lastDiagAt = 0;

  function diagnoseIfNeeded(menuVisibleNow) {
    if (menuVisibleNow && !menuWasVisible) {
      var text = readSelectionText();
      if (!text && Date.now() - lastDiagAt > 3000) {
        lastDiagAt = Date.now();
        try {
          var dc = readDocController();
          var info = "无 docController";
          if (dc) {
            var st = dc.selectionText;
            info = "isSelectionText=" + dc.isSelectionText +
              ", selectionText=" + (st ? ("len " + String(st).length) : String(st));
          }
          Application.sharedInstance().showHUD("[翻译插件诊断] " + info, targetWindow, 3);
        } catch (e) { /* 忽略 */ }
      }
    }
    menuWasVisible = menuVisibleNow;
  }

  function readAnchorRect() {
    try {
      var menu = PopupMenu.currentMenu();
      if (menu) {
        var rect = menu.targetWinRect;
        if (rect && isFinite(rect.x) && isFinite(rect.y)) {
          console.log("[MNIATMonitor] anchor from PopupMenu: " + JSON.stringify(rect));
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, source: "popupMenu" };
        }
      }
    } catch (e) {
      console.log("[MNIATMonitor] read anchor error: " + e);
    }
    return null;
  }

  var ANCHOR_MAX_ATTEMPTS = 3;

  function fireSelection(text) {
    lastFiredText = text;
    var attempts = 0;
    var attempt = function () {
      attempts += 1;
      var rect = readAnchorRect();
      if (rect || attempts >= ANCHOR_MAX_ATTEMPTS) {
        if (!rect) {
          console.log("[MNIATMonitor] anchor unavailable after " + attempts + " attempts, fallback to center");
        }
        if (callbacks.onSelection) {
          callbacks.onSelection(text, rect);
        }
        return;
      }
      // 选择菜单可能尚未弹出，短延迟后重试
      NSTimer.scheduledTimerWithTimeInterval(ANCHOR_DELAY, false, attempt);
    };
    NSTimer.scheduledTimerWithTimeInterval(ANCHOR_DELAY, false, attempt);
  }

  function tick() {
    var menuVisibleNow = isMenuVisible();
    diagnoseIfNeeded(menuVisibleNow);

    var text = readSelectionText();

    if (!text) {
      // 选区清空
      candidateText = "";
      candidateTicks = 0;
      pendingText = "";
      if (lastFiredText) {
        lastFiredText = "";
        if (callbacks.onClear) callbacks.onClear();
      }
      return;
    }

    if (text === lastFiredText) {
      // 已触发过的选区，不重复触发
      candidateText = "";
      candidateTicks = 0;
      return;
    }

    if (text === candidateText) {
      candidateTicks += 1;
      if (candidateTicks >= STABLE_TICKS && pendingText !== text) {
        // 文本已稳定，进入待触发状态，等待鼠标抬起（选区菜单弹出）
        pendingText = text;
        pendingSince = Date.now();
        candidateText = "";
        candidateTicks = 0;
      }
    } else {
      // 选择仍在变化（拖选进行中），取消待触发
      candidateText = text;
      candidateTicks = 1;
      pendingText = "";
    }

    if (pendingText) {
      var elapsed = Date.now() - pendingSince;
      if (menuVisibleNow || elapsed > PENDING_TIMEOUT_MS) {
        var fired = pendingText;
        pendingText = "";
        console.log("[MNIATMonitor] selection finished: \"" + fired.slice(0, 60) + "\" (waited " + elapsed + "ms)");
        fireSelection(fired);
      }
    }
  }

  return {
    // callbacks: { onSelection(text, anchorRect|null), onClear() }
    start: function (win, cbs) {
      this.stop();
      targetWindow = win;
      callbacks = cbs || {};
      lastFiredText = "";
      candidateText = "";
      candidateTicks = 0;
      pendingText = "";
      pendingSince = 0;
      menuWasVisible = false;
      timer = NSTimer.scheduledTimerWithTimeInterval(POLL_INTERVAL, true, function () {
        tick();
      });
      console.log("[MNIATMonitor] started, interval=" + POLL_INTERVAL + "s");
    },

    stop: function () {
      if (timer) {
        timer.invalidate();
        timer = null;
        console.log("[MNIATMonitor] stopped");
      }
      targetWindow = null;
      callbacks = {};
    },

    isRunning: function () {
      return !!timer;
    }
  };
})();
