// CardCreator.js —— 「添加卡片」：把当前查词 / AI 解释 / 翻译结果保存为一条新笔记卡片
// 入口：结果卡片工具栏「添加」按钮 → bridge addCard { title, body, markdown, colorIndex }
// 创建方式（依据 mn-docs 官方文档 reference/global/note 与 guides/notes-and-database）：
//   - 创建笔记的方法在全局 `Note` 对象上：Note.createWithTitleNotebookDocument(title, notebook, doc)
//     （notebook 为 MbTopic，doc 为 MbBook）
//   - notebook 取自当前文档所属笔记本：db.getNotebookById(dc.notebookId)（DocumentController.notebookId）
//   - doc 直接用 dc.document（当前打开的 MbBook）
// 写入字段：note.noteTitle / note.excerptText（正文）/ note.excerptTextMarkdown（0/1，Markdown 模式）
//          / note.colorIndex（0-15 卡片颜色）
// 关联原文（关键需求：点击卡片可定位原文 + 原文被高亮）：
//   - 调用 dc.highlightFromSelection() 获取/创建选区高亮笔记 hlNote（自带 startPage/endPage/
//     startPos/endPos，自动在原文高亮）
//   - 决策：
//     * hlNote 是新建的（无评论、无子节点）→ 复用 hlNote 作为卡片（改写 title/excerptText），
//       hlNote 自带位置 → 点击节点跳转原文 ✓
//     * hlNote 是已存在的摘录（含评论或子节点）→ 新建独立 cardNote，并 hlNote.addChild(cardNote)
//       关联为子节点，原 hlNote 保留原文高亮
// 约定：必须包在 UndoManager.undoGrouping 内并调用 refreshAfterDBChanged，否则界面不刷新且无法撤销

var MNIATCardCreator = (function () {

  // 高亮笔记是否视为「可复用为卡片」的空摘录：
  //   无评论、无子节点，且 excerptText 接近当前选区文本（说明刚由 highlightFromSelection 创建）
  function isReusableHighlight(hlNote, needle) {
    if (!hlNote) return false;
    var comments = hlNote.comments;
    if (Array.isArray(comments) && comments.length > 0) return false;
    var children = hlNote.childNotes;
    if (Array.isArray(children) && children.length > 0) return false;
    var existing = hlNote.excerptText ? String(hlNote.excerptText).trim() : "";
    var target = String(needle || "").trim();
    if (!existing || !target) return false;
    // 允许首尾/换行差异
    if (existing === target) return true;
    if (Math.abs(existing.length - target.length) <= 2 &&
      existing.replace(/\s+/g, "") === target.replace(/\s+/g, "")) return true;
    return false;
  }

  // 创建一张新卡片（与原文摘录关联，原文自动高亮）。
  // win: 当前窗口；title: 标题；body: 正文；markdown: 正文是否按 Markdown 解释；colorIndex: 0-15 卡片颜色
  // 返回 { ok, topicid, noteId }；失败抛 Error（由 bridge 转为前端错误提示）。
  function createCard(win, title, body, markdown, colorIndex) {
    var titleText = String(title || "").trim();
    var bodyText = String(body || "").trim();
    var needleText = String(titleText || bodyText || "").trim();
    if (!titleText && !bodyText) {
      throw new Error("卡片内容为空，无法添加");
    }
    if (!win) {
      throw new Error("缺少窗口上下文，无法添加卡片");
    }

    var studyController = Application.sharedInstance().studyController(win);
    if (!studyController || !studyController.readerController) {
      throw new Error("未找到当前学习窗口，无法添加卡片");
    }
    var dc = studyController.readerController.currentDocumentController;
    if (!dc || !dc.document) {
      throw new Error("未找到当前打开的文档，无法添加卡片");
    }

    var db = Database.sharedInstance();
    // 当前文档所属笔记本：优先 DocumentController.notebookId（官方文档确认存在），
    // 为空时兜底 MbBook.currentTopicId
    var topicId = dc.notebookId || (dc.document && dc.document.currentTopicId) || "";
    var notebook = db.getNotebookById(topicId);
    var doc = dc.document; // MbBook（创建笔记的第三个参数）
    if (!notebook || !doc) {
      throw new Error("未找到当前笔记本或文档，无法添加卡片");
    }

    // 获取/创建选区高亮笔记 —— 这一步会**自动在原文标黄高亮**，并返回带 startPage/endPage 的摘录笔记
    // （依据 mn-docs DocumentController.highlightFromSelection）。无选区时返回 undefined。
    var hlNote = null;
    try {
      if (typeof dc.highlightFromSelection === "function") {
        hlNote = dc.highlightFromSelection();
      }
    } catch (e) {
      console.log("[MNIATCardCreator] highlightFromSelection failed: " + e);
    }
    // 选区文本（用于判断 hlNote 是否可复用）：dc.selectionText
    var selectionForCheck = "";
    try {
      if (typeof dc.selectionText === "string") selectionForCheck = dc.selectionText.trim();
    } catch (e) { /* 忽略 */ }
    var reuse = isReusableHighlight(hlNote, selectionForCheck || needleText);

    var topicid = notebook.topicId || notebook.topicid || topicId;
    var createdNoteId = null;
    UndoManager.sharedInstance().undoGrouping("添加卡片", topicid, function () {
      var note;
      if (reuse && hlNote) {
        // 复用新建的高亮笔记作为卡片：自带原文位置 → 点击节点跳转原文 ✓
        note = hlNote;
      } else {
        // 选区无摘录、或 hlNote 是已存在的旧摘录 → 新建独立笔记，
        // 并将新笔记挂到 hlNote 下作为子节点（hlNote 保留原文高亮）
        note = Note.createWithTitleNotebookDocument(titleText || "翻译卡片", notebook, doc);
        if (hlNote && note && hlNote !== note) {
          try {
            hlNote.addChild(note);
          } catch (e) {
            console.log("[MNIATCardCreator] addChild failed: " + e);
          }
        }
      }
      if (!note) {
        throw new Error("卡片创建失败（返回空笔记对象）");
      }
      note.noteTitle = titleText || note.noteTitle;
      if (bodyText) {
        note.excerptText = bodyText;
        // Markdown 模式：接口字段 0/1（用户要求默认开启）
        note.excerptTextMarkdown = markdown ? 1 : 0;
      }
      if (typeof colorIndex === "number" && colorIndex >= 0 && colorIndex <= 15) {
        note.colorIndex = Math.floor(colorIndex);
      }
      try { createdNoteId = note.noteId; } catch (e) { /* 忽略 */ }
    });
    Application.sharedInstance().refreshAfterDBChanged(topicid);
    return { ok: true, topicid: topicid, noteId: createdNoteId };
  }

  return {
    createCard: createCard
  };
})();