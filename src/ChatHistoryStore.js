// ChatHistoryStore.js —— AI 对话历史（持久化，documentPath JSON，容量 = 设置「AI问答历史数量」）
// 长按机器人图标进入 AI 对话后，每轮问答记录 {question, answer, at, context}；
// context = 本轮提问之前的消息序列 [{role, content}]（对话上下文快照），
// 用于点击历史时回放完整对话并定位到该轮问答；旧记录无 context 字段时前端回落单轮展示。
// 结果卡片历史记录按钮在对话界面下读取展示（列表显示发送给 AI 的问题），
// 点击条目回放该轮问答（作为对话上下文继续提问）。
// 同一问题重复提问（重新回答）覆盖旧记录，保持最新答案。
// 达到容量上限后自动丢弃最早的记录；容量设为 0 时不保存新历史。

var MNIATChatHistory = (function () {
  var ADDON_DIR_NAME = "whc-instant-ai-translator";
  var DEFAULT_MAX_ITEMS = 50;
  var MAX_CONTEXT_MESSAGES = 40; // 单条记录保存的上下文消息数上限（防长对话把 JSON 撑得过大）

  function filePath() {
    return Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME + "/chat-history.json";
  }

  // 容量上限（设置「AI问答历史数量」）；非法值回落默认 50
  function maxSize() {
    try {
      var n = MNIATSettings.load().chatHistorySize;
      if (typeof n === "number" && n >= 0) return Math.floor(n);
    } catch (e) { /* 设置读取失败时用默认值 */ }
    return DEFAULT_MAX_ITEMS;
  }

  // 按当前设置裁剪列表：返回 { list, trimmed }
  function trim(list) {
    var max = maxSize();
    if (list.length <= max) return { list: list, trimmed: false };
    return { list: list.slice(0, max), trimmed: true };
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

  // 规范化上下文消息：只保留 user/assistant 两种角色，内容转字符串、丢弃空消息；
  // 超过上限时保留最近的消息（离本轮提问越近价值越高）
  function normalizeContext(context) {
    var result = [];
    if (!Array.isArray(context)) return result;
    for (var i = 0; i < context.length; i++) {
      var m = context[i];
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      var content = String(m.content || "").trim();
      if (!content) continue;
      result.push({ role: m.role, content: content });
    }
    if (result.length > MAX_CONTEXT_MESSAGES) {
      result = result.slice(result.length - MAX_CONTEXT_MESSAGES);
    }
    return result;
  }

  return {
    // 记录一轮问答（最近在前）；同问题旧记录移除（重新回答后保持最新）；
    // context = 本轮提问之前的消息序列 [{role, content}]（可省略，回放上下文用）；
    // 达到「AI问答历史数量」上限后丢弃最早的记录（0 = 不保存历史）
    add: function (question, answer, context) {
      var q = String(question || "").trim();
      var a = String(answer || "").trim();
      if (!q && !a) return;
      var max = maxSize();
      if (max <= 0) return;
      var list = load().filter(function (item) {
        return !item || String(item.question || "").trim() !== q;
      });
      list.unshift({ question: q, answer: a, at: Date.now(), context: normalizeContext(context) });
      if (list.length > max) list = list.slice(0, max);
      save(list);
    },

    // 全部历史（最近在前）：[{question, answer, at, context}]
    // 读取时按当前设置裁剪：调小「AI问答历史数量」后立即生效（旧记录在下次写入时落盘）
    list: function () {
      var result = trim(load());
      if (result.trimmed) save(result.list);
      return result.list;
    },

    clear: function () {
      save([]);
    }
  };
})();
