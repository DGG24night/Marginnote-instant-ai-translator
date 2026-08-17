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
  var lastFiredNoteId = ""; // 最近一次触发来源的焦点笔记 ID（区分「点击空白残留」与「新选中卡片」）
  var lastFiredAt = 0;      // 最近一次触发时间戳（时序保护：翻译刚触发菜单还挂着时不误关）
  var blankClosed = false;  // 已因「点击空白/菜单消失」关闭卡片：阻止残留焦点笔记重新触发，新选中时重置
  var candidateText = "";
  var candidateTicks = 0;
  var pendingText = "";      // 已稳定、等待"选中结束"（菜单弹出）的文本
  var pendingFallback = null; // 随 pendingText 一起待触发的回退文本（卡片选中态专用）
  var pendingNoteId = "";     // 随 pendingText 一起待触发的焦点笔记 ID
  var pendingSince = 0;

  var PENDING_TIMEOUT_MS = 1500; // 等待菜单弹出的超时兜底
  var BLANK_CLOSE_DELAY = 1200;  // 触发后至少间隔此毫秒才允许「空白点击/菜单消失」关闭卡片（防翻译刚触发误关）

  // 脑图模式（仅显示脑图、未打开文档）判定：readerController/currentDocumentController 不可用。
  // 该模式下结果卡片「跟随 MN 菜单显示/消失」（blur 关闭失效，用菜单生命周期兜底）。
  function isMindMapOnly() {
    return !readDocController();
  }

  function isMenuVisible() {
    try {
      var menu = PopupMenu.currentMenu();
      return !!(menu && menu.visible);
    } catch (e) {
      return false;
    }
  }

  // 结果卡片是否被图钉固定（callbacks.isCardPinned 由插件实例注入）：
  // 固定时「点击空白/菜单消失」不关闭卡片（脑图模式 blur 失效走 monitor 关闭路径，
  // 必须在这里感知 pinned；文档模式 blur 路径在 FloatingCard 侧已有 pinned 检查）。
  function isCardPinned() {
    try {
      return callbacks.isCardPinned ? !!callbacks.isCardPinned() : false;
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

  // 读取焦点笔记（按场景选择控制器）：
//   1) 文档打开：studyController.readerController.currentDocumentController（可读 dc.docMd5 做校验）
//   2) 脑图模式（仅显示脑图、无打开文档）：studyController.notebookController.focusNote / visibleFocusNote
// 文档控制器不可用时不校验 docMd5（脑图节点可能来自任何历史文档，且 docController.docMd5 不存在）
  function readFocusNote() {
    try {
      var studyController = Application.sharedInstance().studyController(targetWindow);
      if (!studyController) return { note: null, docController: null };
      var dc = (studyController.readerController && studyController.readerController.currentDocumentController) || null;
      if (dc) {
        var dcn = dc.visibleFocusNote || dc.focusNote || dc.lastFocusNote;
        if (dcn) return { note: dcn, docController: dc };
      }
      // 脑图模式：notebookController 始终可用
      var nbc = studyController.notebookController;
      if (nbc) {
        var nbn = nbc.visibleFocusNote || nbc.focusNote || nbc.lastFocusNote;
        if (nbn) return { note: nbn, docController: null };
      }
    } catch (e) { /* 忽略 */ }
    return { note: null, docController: null };
  }

  // 回退读取：选中「已创建摘录的文本」时，MarginNote 进入摘录笔记选中态，
  // 文本选区接口 selectionText 为空（isSelectionText=false），但被选中的摘录
  // 即当前焦点笔记。
  // 仅菜单弹出时启用（见 tick），避免用户无操作时误读脑图/其他文档的焦点笔记；
  // 文档打开时校验 docMd5 防止误读其他文档/脑图焦点笔记；脑图模式跳过校验。
  //
  // ⚠️ 设计取舍（2026-08-15 用户反馈）：本质是翻译插件，不校验「摘录内容是否来自原文」。
  // 返回结构：{ primary, fallback, noteId }
  //   primary  = 标题（noteTitle）—— 选卡片时优先用标题（更可能是原词/原句）
  //   fallback = 摘录正文（excerptText）—— primary 触发查词/翻译报错时自动回退一次
  //   noteId   = 焦点笔记 ID —— 用于区分「点击空白（焦点笔记残留）」与「新选中卡片」
  //   都为空 → 返回 null（跳过）
  function readFocusNoteExcerpt() {
    try {
      var focus = readFocusNote();
      var note = focus.note;
      if (!note) return null;
      // docMd5 校验：仅在文档控制器与笔记都存在 docMd5 时校验；脑图模式（docController=null）跳过
      var dc = focus.docController;
      if (dc && dc.docMd5 && note.docMd5 && note.docMd5 !== dc.docMd5) {
        return null;
      }
      var primary = "";
      if (note.noteTitle) {
        var t = String(note.noteTitle).trim();
        if (t.length > 0) primary = t;
      }
      var fallback = "";
      if (note.excerptText) {
        var e = String(note.excerptText).trim();
        if (e.length > 0 && e !== primary) fallback = e;
      }
      if (!primary && !fallback) return null;
      if (!primary) primary = fallback; // 标题为空时退化为正文
      return { primary: primary, fallback: fallback, noteId: note.noteId || "" };
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // 一次性诊断：菜单弹出但「文本选区 + 焦点笔记摘录回退」都读不到文本时，
  // 用 HUD 显示内部状态，帮助定位未知选区场景（console 日志不可见）。
  // ⚠️ 2026-08-15：仅在「存在选中信号」时诊断——点击脑图空白（菜单弹出但
  // isSelectionText=false 且无焦点笔记）是正常操作，不弹诊断。
  var menuWasVisible = false;
  var lastDiagAt = 0;

  function hasFocusNoteSignal() {
    try {
      var dc = readDocController();
      if (dc) {
        return !!(dc.visibleFocusNote || dc.focusNote || dc.lastFocusNote);
      }
      // 脑图模式：notebookController.focusNote
      var studyController = Application.sharedInstance().studyController(targetWindow);
      var nbc = studyController && studyController.notebookController;
      return !!(nbc && (nbc.visibleFocusNote || nbc.focusNote));
    } catch (e) {
      return false;
    }
  }

  function diagnoseIfNeeded(menuVisibleNow) {
    if (menuVisibleNow && !menuWasVisible) {
      var text = readSelectionText();
      if (!text) {
        var focusInfo = readFocusNoteExcerpt();
        if (focusInfo) text = focusInfo.primary;
      }
      if (!text && Date.now() - lastDiagAt > 3000) {
        var dc = readDocController();
        var hasSelectionSignal = (dc && !!dc.isSelectionText) || hasFocusNoteSignal();
        if (!hasSelectionSignal) return; // 点击空白（无选中意图）：正常操作，不诊断
        lastDiagAt = Date.now();
        try {
          var info = "无 docController";
          if (dc) {
            var st = dc.selectionText;
            var fn = dc.visibleFocusNote || dc.focusNote || dc.lastFocusNote;
            info = "isSelectionText=" + dc.isSelectionText +
              ", selectionText=" + (st ? ("len " + String(st).length) : String(st)) +
              ", focusNoteExcerpt=" + (fn && fn.excerptText ? ("len " + String(fn.excerptText).length) : "无");
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

  // 触发选区：text 为主文本（文档选区 = selectionText，卡片选中 = primary）；
  // fallback 为回退文本（仅卡片选中态有，文档选区为 null）—— 当 primary 报错时由
  // TranslateFlow 自动用 fallback 再发起一次请求（标题 vs 摘录正文回退）。
  // noteId：来源焦点笔记 ID（仅卡片选中态有），用于「点击空白关闭卡片」判定。
  function fireSelection(text, fallback, noteId) {
    lastFiredText = text;
    lastFiredNoteId = noteId || "";
    lastFiredAt = Date.now();
    blankClosed = false; // 新触发：允许后续空白点击/菜单消失关闭卡片
    var attempts = 0;
    var attempt = function () {
      attempts += 1;
      var rect = readAnchorRect();
      if (rect || attempts >= ANCHOR_MAX_ATTEMPTS) {
        if (!rect) {
          console.log("[MNIATMonitor] anchor unavailable after " + attempts + " attempts, fallback to center");
        }
        if (callbacks.onSelection) {
          callbacks.onSelection(text, rect, fallback);
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
    // 菜单边缘信号：新弹出（本次可见、上次不可见）/ 刚消失（本次不可见、上次可见）。
    // 用户实测：MarginNote 左键/右键点击脑图空白都会弹出菜单。
    var menuJustShown = menuVisibleNow && !menuWasVisible;
    var menuJustHidden = !menuVisibleNow && menuWasVisible;
    diagnoseIfNeeded(menuVisibleNow);
    var mindMapOnly = isMindMapOnly();

    var text = null;
    var fallback = null;
    var focusNoteId = "";
    var rawSelection = readSelectionText();
    if (rawSelection) {
      text = rawSelection;
    } else if (menuVisibleNow) {
      // 菜单弹出却无文本选区：可能是选中了「已创建摘录的文本」（摘录笔记选中态），
      // 此时 selectionText 为空，但被选中的摘录即当前焦点笔记，回退读取其摘录文本，
      // 使摘录内容同样能触发翻译/查词。无菜单弹出时不回退，避免误读焦点笔记。
      var focusInfo = readFocusNoteExcerpt();
      if (focusInfo) {
        text = focusInfo.primary;
        fallback = focusInfo.fallback;
        focusNoteId = focusInfo.noteId || "";
      }
    }

    // 「点击空白关闭卡片」统一判定（脑图模式 blur 失效的兜底，文档模式结果一致）：
    //   1) 菜单新弹出 + 无任何选中（text 空）→ 点击空白
    //   2) 菜单新弹出 + 焦点笔记残留同一张卡（text 相同 + noteId 相同）→ 点击空白
    //   3) 脑图模式 + 菜单刚消失 → 卡片跟随菜单收起
    // 全部带时序保护（距上次触发 > BLANK_CLOSE_DELAY）与 blankClosed 防重复。
    var elapsedSinceFired = lastFiredAt ? (Date.now() - lastFiredAt) : 0;
    var canBlankClose = !blankClosed && elapsedSinceFired > BLANK_CLOSE_DELAY;

    if (!text) {
      // 选区清空。
      candidateText = "";
      candidateTicks = 0;
      pendingText = "";
      pendingFallback = null;
      pendingNoteId = "";
      if (lastFiredText) {
        if (canBlankClose && !isCardPinned() && (menuJustShown || (menuJustHidden && mindMapOnly))) {
          console.log("[MNIATMonitor] blank click / menu hidden -> hide card");
          blankClosed = true;
          if (callbacks.onBlankClick) callbacks.onBlankClick();
        } else if (callbacks.onClear) {
          // 图钉固定（isCardPinned）时不关闭卡片，仅收起悬浮按钮；
          // blankClosed 保持 false，取消固定后再次点击空白可正常关闭。
          callbacks.onClear();
        }
        // 不清空 lastFiredText/lastFiredNoteId：残留焦点笔记可能持续读到同文本，
        // 清空会导致残留文本重新触发；靠 blankClosed 阻止重复关闭。
      }
      return;
    }

    if (text === lastFiredText) {
      // 同一文本再次出现。若来源是同一张焦点笔记（点击空白后焦点笔记残留上一张卡片）
      // 且菜单新弹出 → 视为「点击卡片外部」→ 关闭卡片（弥补 blur 失效）。
      // 无 noteId（文档选区重复）/ noteId 不同 → 普通重复，不处理。
      // 注（2026-08-17）：「关闭卡片后再次选中同一词」由 FloatingCardController.hide
      // → MNIATSelectionMonitor.notifyCardClosed 在关闭时清空 lastFiredText，
      // 让再次选中走「新文本触发」流程，等同首次选中，无需在 tick 内做特殊判定。
      // 图钉固定（isCardPinned）时点击空白不关闭卡片（与文档模式 blur 路径一致）。
      if (canBlankClose && !isCardPinned() && focusNoteId && focusNoteId === lastFiredNoteId &&
        (menuJustShown || (menuJustHidden && mindMapOnly))) {
        console.log("[MNIATMonitor] same note + menu edge -> blank click, hide card");
        blankClosed = true;
        if (callbacks.onBlankClick) callbacks.onBlankClick();
      }
      candidateText = "";
      candidateTicks = 0;
      return;
    }

    // 新文本：正常触发，重置 blankClosed（允许后续空白点击再次关闭）
    blankClosed = false;

    if (text === candidateText) {
      candidateTicks += 1;
      if (candidateTicks >= STABLE_TICKS && pendingText !== text) {
        // 文本已稳定，进入待触发状态，等待鼠标抬起（选区菜单弹出）
        pendingText = text;
        pendingFallback = fallback;
        pendingNoteId = focusNoteId;
        pendingSince = Date.now();
        candidateText = "";
        candidateTicks = 0;
      }
    } else {
      // 选择仍在变化（拖选进行中），取消待触发
      candidateText = text;
      candidateTicks = 1;
      pendingText = "";
      pendingFallback = null;
      pendingNoteId = "";
    }

    if (pendingText) {
      var elapsed = Date.now() - pendingSince;
      if (menuVisibleNow || elapsed > PENDING_TIMEOUT_MS) {
        var fired = pendingText;
        var firedFallback = pendingFallback;
        var firedNoteId = pendingNoteId;
        pendingText = "";
        pendingFallback = null;
        pendingNoteId = "";
        console.log("[MNIATMonitor] selection finished: \"" + fired.slice(0, 60) + "\" (waited " + elapsed + "ms, fallback=" + (firedFallback ? "yes" : "no") + ")");
        fireSelection(fired, firedFallback, firedNoteId);
      }
    }
  }

  return {
    // callbacks: { onSelection(text, anchorRect|null, fallback|null), onBlankClick(), onClear() }
    start: function (win, cbs) {
      this.stop();
      targetWindow = win;
      callbacks = cbs || {};
      lastFiredText = "";
      lastFiredNoteId = "";
      lastFiredAt = 0;
      blankClosed = false;
      candidateText = "";
      candidateTicks = 0;
      pendingText = "";
      pendingFallback = null;
      pendingNoteId = "";
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
    },

    // 卡片关闭后重置上次触发标记（2026-08-17 修复）：
    // TranslateFlow.cancelCurrent 在卡片关闭时调用本方法，清空 lastFiredText。
    // 随后用户再次选中同一文本时 text !== lastFiredText，等同首次选中，走
    // 「新文本触发」流程正常查词/翻译。覆盖点空白关闭（onBlankClick）与
    // 失焦关闭（onLostFocus）两条路径，统一从根源修。
    // 候选/pending 状态保持，不影响新一轮 tick 的候选检测。
    notifyCardClosed: function () {
      lastFiredText = "";
      lastFiredNoteId = "";
      lastFiredAt = 0;
      blankClosed = false;
    }
  };
})();
