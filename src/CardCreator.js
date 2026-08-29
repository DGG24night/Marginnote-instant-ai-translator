// CardCreator.js —— 「添加卡片」：把当前查词 / AI 解释 / 翻译 / 对话回答保存为一张卡片
// 入口：结果卡片工具栏「添加」按钮、AI 对话回答「添加笔记」→ bridge addCard { title, body, markdown, colorIndex }
// 创建方式（依据 mn-docs 官方文档 reference/global/note、reference/marginnote/notebook-controller
// 与 guides/notes-and-database）：
//   - 创建笔记：全局 `Note` 对象 Note.createWithTitleNotebookDocument(title, notebook, doc)
//     （notebook 为 MbTopic，doc 为 MbBook）
//   - notebook 取「当前打开的脑图」：studyController.notebookController.notebookId（官方文档
//     NotebookController 页：「当前笔记本ID」）。dc.notebookId 指向文档主脑图，打开子脑图时
//     会建错位置（用户实测 2026-08），仅作兜底
//   - doc 直接用 dc.document（当前打开的 MbBook）
// 单卡片 + 原文高亮（用户要求：只创建一张卡片，同时原文保持高亮）：
//   dc.highlightFromSelection() 获取/创建选区高亮摘录 hlNote（自动在原文标黄）——
//   * hlNote 是空摘录（无评论、无子节点，含刚创建的）→ 高亮即卡片：noteTitle 写标题，
//     内容用 appendMarkdownComment/appendTextComment 附为评论（MarginNote 评论生态的标准
//     做法，OhMyMN 等插件的 AI 内容同样方式；注意直接改写空摘录的 noteTitle/excerptText
//     用户实测不生效 2026-08，故不走改写路线）
//   * hlNote 已有评论/子节点（用户旧摘录）→ 不改动它，新建卡片挂为其子节点
//   * 无选区（hlNote 为空）→ 新建独立文字卡片
// 约定：必须包在 UndoManager.undoGrouping 内并调用 refreshAfterDBChanged，否则界面不刷新且无法撤销

var MNIATCardCreator = (function () {

  // 摘录是否为「空」（无评论、无子节点）：空的才可直接承载标题与评论内容
  function isBareExcerpt(hlNote) {
    if (!hlNote) return false;
    var comments = hlNote.comments;
    if (comments && typeof comments.length === "number" && comments.length > 0) return false;
    var children = hlNote.childNotes;
    if (children && typeof children.length === "number" && children.length > 0) return false;
    return true;
  }

  // 创建一张新卡片（原文高亮；落在当前打开的脑图）。
  // win: 当前窗口；title: 标题；body: 正文；markdown: 正文是否按 Markdown 解释；colorIndex: 0-15 卡片颜色
  // 返回 { ok, topicid, noteId, highlighted }；失败抛 Error（由 bridge 转为前端错误提示）。
  function createCard(win, title, body, markdown, colorIndex) {
    var titleText = String(title || "").trim();
    var bodyText = String(body || "").trim();
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
    // 当前打开的脑图：notebookController.notebookId（官方文档 NotebookController 页）；
    // 兜底 dc.notebookId（主脑图）/ 文档 currentTopicId
    var nbController = studyController.notebookController;
    var currentNotebookId =
      (nbController && typeof nbController.notebookId === "string" && nbController.notebookId) || "";
    var topicId = currentNotebookId ||
      (dc.notebookId || "") ||
      (dc.document && dc.document.currentTopicId) || "";
    var notebook = topicId ? db.getNotebookById(topicId) : null;
    var doc = dc.document; // MbBook（创建笔记的第三个参数）
    if (!notebook || !doc) {
      throw new Error("未找到当前脑图或文档，无法添加卡片");
    }
    var topicid = notebook.topicId || notebook.topicid || topicId;

    // 选区高亮摘录（自动在原文标黄）；无选区时返回 undefined
    var hlNote = null;
    try {
      if (typeof dc.highlightFromSelection === "function") {
        hlNote = dc.highlightFromSelection();
      }
    } catch (e) {
      console.log("[MNIATCardCreator] highlightFromSelection failed: " + e);
    }

    var createdNoteId = null;
    UndoManager.sharedInstance().undoGrouping("添加卡片", topicid, function () {
      var note;
      // 空摘录 → 高亮即卡片：内容附为评论（改写 excerptText 在摘录上不生效，见文件头说明）
      if (hlNote && isBareExcerpt(hlNote) &&
        typeof hlNote.appendMarkdownComment === "function" &&
        typeof hlNote.appendTextComment === "function") {
        note = hlNote;
        if (titleText) {
          note.noteTitle = titleText;
        }
        if (markdown) {
          note.appendMarkdownComment(bodyText);
        } else {
          note.appendTextComment(bodyText);
        }
      } else {
        // 高亮已有内容（用户旧摘录）或无选区 → 新建卡片；有高亮时挂为其子节点（定位原文）
        note = Note.createWithTitleNotebookDocument(titleText || "翻译卡片", notebook, doc);
        if (!note) {
          throw new Error("卡片创建失败（返回空笔记对象）");
        }
        if (hlNote) {
          try {
            hlNote.addChild(note);
          } catch (e) {
            console.log("[MNIATCardCreator] addChild failed: " + e);
          }
        }
        note.noteTitle = titleText || note.noteTitle;
        if (bodyText) {
          note.excerptText = bodyText;
          // Markdown 模式：接口字段 0/1（用户要求默认开启）
          note.excerptTextMarkdown = markdown ? 1 : 0;
        }
      }
      if (typeof colorIndex === "number" && colorIndex >= 0 && colorIndex <= 15) {
        note.colorIndex = Math.floor(colorIndex);
      }
      try { createdNoteId = note.noteId; } catch (e) { /* 忽略 */ }
    });
    Application.sharedInstance().refreshAfterDBChanged(topicid);
    return { ok: true, topicid: topicid, noteId: createdNoteId, highlighted: !!hlNote };
  }

  return {
    createCard: createCard
  };
})();
