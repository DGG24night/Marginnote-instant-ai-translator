// PromptTemplates.js —— 默认 prompt 模板与变量渲染
// 支持占位符：{text} 选中文本、{target_lang} 目标语言、{context} 选区上下文（前后文）
// 用户自定义 prompt 为空串时回退到内置默认模板。
// {context} 由调用方（TranslateFlow）在划词查词时从当前页文本层提取并随任务传入，
// 长度由常规设置「选区上下文长度」控制（0 = 不获取，变量渲染为空字符串）；
// 翻译任务（句子/段落）不提取上下文（2026-08-31），{context} 恒为空串。

var MNIATPrompts = (function () {
  var DEFAULT_TRANSLATE =
    "你是一名专业的学术翻译。请将以下内容翻译为{target_lang}，" +
    "要求准确、通顺、符合学术表达习惯。**只输出译文**，不要输出任何解释或额外内容。" +
    "原文：{text}";

  var DEFAULT_EXPLAIN =
    "你是一名专业的英语老师，擅长帮助用户理解单词的意思。请严格按以下markdown格式输出单词{text}的解释：\n\n" +
    "# {text}\n" +
    "---\n" +
    "**音标**\n" +
    "- 英式：给出单词的英式音标\n" +
    "- 美式：给出单词的美式音标\n" +
    "---\n" +
    "**释义**\n" +
    "以词性缩写开头(例如 `n.`, `v.`, `adj.`)，动词要区分及物(`vt.`)和不及物(`vi.`)两种词性。\n" +
    "词性的下一行为该词性下的释义（同一词性的不同词义需用数字序号分点列出）。\n" +
    "---\n" +
    "**原句**\n" +
    "- 根据上下文给出单词所在的原句，并将{text}加粗。\n" +
    "- 给出原句的中文翻译。\n" +
    "---\n" +
    "**分析**\n" +
    "分析单词在原句中的释义。\n\n" +
    "单词所在的上下文如下：{context}";

  // 上下文为空时从渲染结果中移除的悬空尾行（DEFAULT_EXPLAIN 的 {context} 引导句）：
  // 上下文未开启/提取失败/搜索框查词/翻译任务时 {context} 渲染为空串，若不移除会留下
  // 「单词所在的上下文如下：」空段落，模型可能据此编造上下文。仅匹配该固定文案。
  var EMPTY_CONTEXT_SUFFIX = "单词所在的上下文如下：";

  // 机器人图标双击 prompt：长难句结构化讲解（句子主干 → 结构拆解 → 难点词汇 → 翻译 → 理解要点）。
  // （单击即「AI 解释」，直接复用 DEFAULT_EXPLAIN，无独立模板）
  // 路由优先「模型路由 → 长难句解释」，未配置时回落「AI 解释」路由。
  var DEFAULT_ROBOT_DOUBLE =
    "你是一名专业的英语老师，擅长帮助用户理解难懂的句子。请严格按以下markdown格式，对长难句做结构化讲解，讲解与输出使用{target_lang}（原句与专有名词保留原文）：\n\n" +
    "首先以原句开头，并加粗\n" +
    "---\n" +
    "**句子主干**\n" +
    "分点提取全句核心框架（主语/谓语/宾语/表语）；并列句分别列出各分句主干，主从复合句先给主句主干\n" +
    "---\n" +
    "**结构拆解**\n" +
    "按意群从外层到内层逐段拆解：说明每个从句、分词短语、介词短语、插入语等修饰或说明的对象（如定语从句修饰哪个词）及其在句中的作用；倒装、省略等特殊结构需明确指出\n" +
    "---\n" +
    "**难点词汇**\n" +
    "列出影响理解的关键单词或短语（不超过6个）：词性、释义、在本句中的含义\n" +
    "---\n" +
    "**全文翻译**\n" +
    "- 先给贴近原文结构的直译\n" +
    "- 再给通顺自然的意译\n" +
    "---\n" +
    "**理解要点**\n" +
    "用一两句话点出本句最容易误解之处（如歧义修饰对象、省略成分、易混词形、虚拟/倒装带来的含义变化）\n\n" +
    "你需要讲解的句子是：{text}";

  // AI 查词-中文 prompt：查词-中文 选「AI 查词-中文」时使用。
  // 目标是「像词典条目一样」输出，而不是像 AI 解释那样长篇分析：
  // 拼音/注音 → 词性分组的义项（逐条编号）→ 可选的例词/例句。
  // 复用 {text}/{context} 变量；{target_lang} 未使用但保留渲染兼容。
  var DEFAULT_LOOKUP_ZH =
    "你是一名中文词典编纂者。请严格按以下markdown格式，为{text}给出规范的词典式释义：\n\n" +
    "# {text}\n" +
    "**拼音**\n" +
    "给出汉语拼音（带声调；多音字按读音分行列出）。\n" +
    "---\n" +
    "**释义**\n" +
    "按词性分组（如〈名〉〈动〉〈形〉〈副〉），每个词性下的义项用数字序号 1. 2. 3. 逐条列出，" +
    "释义后用「：」接常见搭配或例词（如“相逢，会面：～见。～事。”）。\n" +
    "若是词语或成语，先给整体释义，再说明关键字义与用法。\n" +
    "---\n" +
    "**例句**\n" +
    "给出 1-2 个能体现该词用法的例句（古文引用请注明出处）。\n\n" +
    "**只输出词典内容本身**，不要写“根据查询”“以下是”之类的开场白；" +
    "若{text}不存在或不是规范的中文词条，直接说明「未收录该词条」并给出最接近的规范说法。\n\n" +
    "该词所在的上下文（可能为空）：{context}";

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
      explain: DEFAULT_EXPLAIN,
      robotDouble: DEFAULT_ROBOT_DOUBLE,
      lookupZh: DEFAULT_LOOKUP_ZH
    },

    // kind: "translate" | "explain" | "robotDouble" | "lookupZh"
    // context: 选区上下文（前后文）字符串，仅查词任务传入；未提供或为空时 {context}
    //          渲染为空串，并移除悬空的「上下文如下：」尾行（见 EMPTY_CONTEXT_SUFFIX）
    build: function (kind, text, context) {
      var config = MNIATSettings.load();
      var custom = config.prompts && config.prompts[kind];
      var fallbacks = {
        explain: DEFAULT_EXPLAIN,
        robotDouble: DEFAULT_ROBOT_DOUBLE,
        lookupZh: DEFAULT_LOOKUP_ZH
      };
      var template = (custom && custom.trim().length > 0)
        ? custom
        : (fallbacks[kind] || DEFAULT_TRANSLATE);
      var out = render(template, {
        text: text,
        target_lang: config.targetLang,
        context: context || ""
      });
      if (!context) {
        // {context} 为空串时，末尾只剩「单词所在的上下文如下：」悬空引导句：
        // 仅当它确实是结尾内容（其后只有空白）时才移除，避免误伤其他模板文案
        var idx = out.lastIndexOf(EMPTY_CONTEXT_SUFFIX);
        if (idx >= 0 && out.slice(idx + EMPTY_CONTEXT_SUFFIX.length).trim().length === 0) {
          out = out.slice(0, idx);
        }
        out = out.replace(/\s+$/, "");
      }
      return out;
    }
  };
})();
