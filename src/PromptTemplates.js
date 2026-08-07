// PromptTemplates.js —— 默认 prompt 模板与变量渲染
// 支持占位符：{text} 选中文本、{target_lang} 目标语言
// 用户自定义 prompt 为空串时回退到内置默认模板。

var MNIATPrompts = (function () {
  var DEFAULT_TRANSLATE =
    "你是一名专业的学术翻译。请将以下{target_lang}之外的原文翻译成{target_lang}，" +
    "要求准确、通顺、符合学术表达习惯。只输出译文，不要输出任何解释或额外内容。\n\n" +
    "原文：\n{text}";

  var DEFAULT_EXPLAIN =
    "你是一名语言学习助手。请用{target_lang}解释下面的英文单词，" +
    "包括：词性、核心释义、常见搭配、一个例句（附翻译）。保持简洁。\n\n" +
    "单词：{text}";

  function render(template, vars) {
    var out = String(template);
    for (var key in vars) {
      out = out.split("{" + key + "}").join(String(vars[key]));
    }
    return out;
  }

  return {
    defaults: {
      translate: DEFAULT_TRANSLATE,
      explain: DEFAULT_EXPLAIN
    },

    // kind: "translate" | "explain"
    build: function (kind, text) {
      var config = MNIATSettings.load();
      var custom = config.prompts && config.prompts[kind];
      var template = (custom && custom.trim().length > 0)
        ? custom
        : (kind === "explain" ? DEFAULT_EXPLAIN : DEFAULT_TRANSLATE);
      return render(template, { text: text, target_lang: config.targetLang });
    }
  };
})();
