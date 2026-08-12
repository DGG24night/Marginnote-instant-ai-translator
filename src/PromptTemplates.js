// PromptTemplates.js —— 默认 prompt 模板与变量渲染
// 支持占位符：{text} 选中文本、{target_lang} 目标语言
// 用户自定义 prompt 为空串时回退到内置默认模板。

var MNIATPrompts = (function () {
  var DEFAULT_TRANSLATE =
    "你是一名专业的学术翻译。请将以下内容翻译为{target_lang}，" +
    "要求准确、通顺、符合学术表达习惯。**只输出译文**，不要输出任何解释或额外内容。" +
    "原文：{text}";

  var DEFAULT_EXPLAIN =
    "请严格按以下markdown格式输出单词{text}的解释：\n\n" +
    "# {text}\n" +
    "---\n" +
    "**音标**\n" +
    "给出单词的美式和英式发音音标\n" +
    "---\n" +
    "**释义**\n" +
    "以词性缩写开头(例如 `n.`, `v.`, `adj.`)，动词要区分及物(`vt.`)和不及物(`vi.`)两种词性，多含义的不要遗漏其他含义\n" +
    "---\n" +
    "**常用词组**\n" +
    "给出单词的常用词组及其含义（不超过5个）\n" +
    "---\n" +
    "**例句**\n" +
    "针对每个释义给出例句（将本次需要解释的单词加粗），并在例句下一行给出中文翻译（并将对应单词的含义加粗）。例句采用无序列表语法，中文翻译使用引用语法。**注意中文翻译与下一例句之间需要空一行。**\n" +
    "---\n" +
    "**相关词汇**\n" +
    "这里给出常见的同义词、近义词和变形，以及每个词的词性和释义。\n" +
    "---\n" +
    "**词根词缀分析**\n" +
    "这部分讲解如何通过词根词缀理解单词含义（如果单词过于简短没有词根词缀则可以不需要这部分）";

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
