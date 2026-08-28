// ChatHistoryStore.js —— AI 对话历史（持久化，documentPath JSON，容量 50）
// 长按机器人图标进入 AI 对话后，每轮问答记录 {question, answer, at}；
// 结果卡片历史记录按钮在对话界面下读取展示（列表显示发送给 AI 的问题），
// 点击条目回放该轮问答（作为对话上下文继续提问）。
// 同一问题重复提问（重新回答）覆盖旧记录，保持最新答案。

var MNIATChatHistory = (function () {
  var ADDON_DIR_NAME = "whc-instant-ai-translator";
  var MAX_ITEMS = 50;

  function filePath() {
    return Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME + "/chat-history.json";
  }

  function load() {
    try {
      var fm = NSFileManager.defaultManager();
      var path = filePath();
      if (fm.fileExistsAtPath(path)) {
        var data = NSData.dataWithContentsOfFile(path);
        if (data && data.length() > 0) {
          var arr = NSJSONSerialization.JSONObjectWithDataOptions(data, 1);
          if (Array.isArray(arr)) return arr;
        }
      }
    } catch (e) {
      console.log("[MNIATChatHistory] load error: " + e);
    }
    return [];
  }

  function save(list) {
    try {
      var fm = NSFileManager.defaultManager();
      var dir = Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME;
      if (!fm.fileExistsAtPath(dir)) {
        fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(dir, true, null);
      }
      var data = NSJSONSerialization.dataWithJSONObjectOptions(list, 1);
      data.writeToFileAtomically(filePath(), true);
    } catch (e) {
      console.log("[MNIATChatHistory] save error: " + e);
    }
  }

  return {
    // 记录一轮问答（最近在前）；同问题旧记录移除（重新回答后保持最新）
    add: function (question, answer) {
      var q = String(question || "").trim();
      var a = String(answer || "").trim();
      if (!q && !a) return;
      var list = load().filter(function (item) {
        return !item || String(item.question || "").trim() !== q;
      });
      list.unshift({ question: q, answer: a, at: Date.now() });
      if (list.length > MAX_ITEMS) list = list.slice(0, MAX_ITEMS);
      save(list);
    },

    // 全部历史（最近在前）：[{question, answer, at}]
    list: function () {
      return load();
    },

    clear: function () {
      save([]);
    }
  };
})();
