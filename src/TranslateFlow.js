// TranslateFlow.js —— 划词任务编排
// 职责：接收划词事件 → 判定单词/句子 → 调度卡片显隐 → 调用 AI/有道服务 → 推送事件到卡片前端。
// 事件协议（推送至卡片 window.__MNIATCardEvent）：
//   {type:"reset"}                          卡片复用时重置界面
//   {type:"loading", mode, text}            mode: translate | lookup | explain
//   {type:"delta", accumulated}             流式增量（AI 翻译/解释打字机效果）
//   {type:"translateResult", text}          翻译/解释完成
//   {type:"dictResult", data}               词典结果（含 pronounce 配置）
//   {type:"error", message}                 失败
//
// 2026-08-11 新增能力：
//   - 查词 / 翻译独立开关（config.lookupEnabled / translateEnabled）：单独开启查词时，
//     选中句子或段落不触发翻译；canHandle 供 button 触发模式前置拦截。
//   - 结果缓存（MNIATCache）：查词缓存（含 AI 解释）与 AI 翻译缓存相互独立；
//     查词键含服务商前缀（不同查词服务查同一单词不互用缓存），翻译键含提供商+模型；
//     容量由配置 lookupCacheSize / translateCacheSize 控制（0=不使用缓存）。
//   - 「重新生成」（regenerate）：点击重跑当前 AI 任务并跳过缓存（bypassCache）；
//     长按选模型通过 override 临时覆盖提供商/模型（不写回默认路由配置）。
//   - 工具栏搜索（searchWord）：用默认查词服务查询任意单词。
//   - 工具栏查词服务切换（lookupWithProvider）：临时切换查词服务/AI 解释对比结果，不落配置。

var MNIATFlow = (function () {
  var currentJob = null; // { mode, text, win, session }
  var lastWin = null;    // 最近一次划词所在窗口（搜索/重新生成等无新划词场景复用）

  function pushEvent(obj) {
    MNIATFloatingCard.sendEvent(obj);
  }

  function isSingleWord(text) {
    return /^[A-Za-z][A-Za-z'\-]*$/.test(String(text).trim());
  }

  // 单词数统计：
  //   - 英文按空白分词（连续字母数字 + 撇号 - 视为一个词）
  //   - 中日韩（CJK）字符每个算 1 个"词"（不分词）
  // 例："hello world" → 2；"你好世界" → 4；"hello 世界" → 3；"high-rate" → 1
  function countWords(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    // CJK 字符（CJK Unified Ideographs + 日文假名 + 韩文音节）：每个算 1 个词
    var cjkChars = (trimmed.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    // 英文/数字按空白分词，过滤纯标点
    var asciiWords = trimmed.split(/\s+/).filter(function (w) {
      return /[A-Za-z0-9]/.test(w);
    }).length;
    return cjkChars + asciiWords;
  }

  // 判定查词 / 翻译：
  //   - 纯英文单词（isSingleWord）始终按查词；
  //   - 其余按单词数：countWords(text) > config.translateWordCount（默认 3）按翻译，否则查词。
  //   让用户能用查词服务查词组（多个词、短语），仅多词内容走翻译。
  function determineMode(text) {
    if (isSingleWord(text)) return "lookup";
    var cfg = MNIATSettings.load();
    var limit = (typeof cfg.translateWordCount === "number" && cfg.translateWordCount >= 0)
      ? cfg.translateWordCount : 3;
    return countWords(text) > limit ? "translate" : "lookup";
  }

  // ---------- 选区上下文提取（prompt {context} 变量） ----------
  //
  // ⚠️ 崩溃教训（2026-08-15 用户实测：划词闪退）：
  //   JSCore 的 try/catch 只能捕获 JS 异常，**捕获不了 ObjC 层异常**。
  //   上一版在提取链路里用了 NSJSONSerialization.dataWithJSONObjectOptions 序列化整页
  //   文本层、以及 MNUtil.getCurrentSelection()——文本层数组含不可序列化对象（NSDate/
  //   自定义对象/循环引用）时 ObjC 直接抛 NSInvalidArgumentException → 进程闪退。
  //   因此本实现**只允许两类安全操作**：
  //     1) 数组：按数字索引访问（node[i]）；
  //     2) 字典：仅按白名单键读取（node["text"] 等），绝不 for-in 原生对象、绝不做
  //        NSJSONSerialization / JSON.stringify 序列化。

  var CONTEXT_TEXT_KEYS = ["text", "content", "str", "txt", "t", "value", "string",
    "name", "label", "line", "lines", "char", "chars", "character", "characters",
    "word", "words", "data", "body", "caption",
    "glyphs", "glyph", "runs", "run", "fragments", "fragment",
    "segments", "segment", "pieces", "piece", "items", "textContent", "contentText", "plainText",
    "code", "codePoint"];
  var CONTEXT_MAX_FRAGMENTS = 5000; // 一页文本的片段收集上限（PDF 文本层按词切分，需足够大）

  // 递归收集文本串：
  //   - 数组：用 buffer 聚合元素，遍历结束后 join 成一行（行/字符集合 → 完整一行文本）
  //   - 字符串：直接收集（去空白碎片）
  //   - 数字：作为 Unicode codePoint 转字符（PDF 文本层每字一个对象，char 键存 codePoint）
  //   - 字典：白名单键读取，**number 类型的 char/code/codePoint 转字符**（MarginNote 实际结构）
  // 全程仅数组索引 + 白名单键读取，无序列化、无 for-in，避免 ObjC 异常崩溃。
  function collectPageText(node, depth, out) {
    if (depth > 8 || out.length >= CONTEXT_MAX_FRAGMENTS) return;
    if (node == null) return;
    var t = typeof node;
    if (t === "string") {
      var s = node.trim();
      if (s.length >= 1 && !/^[\d.,\-+\s]+$/.test(s)) out.push(s);
      return;
    }
    if (t === "number") {
      // 裸数字（极少见）：作为单字符
      if (node >= 0x20 && node <= 0x10FFFF) out.push(String.fromCharCode(node));
      return;
    }
    if (t !== "object") return;

    // 数组（NSArray / 字符集合）：buffer 聚合 → 一行
    if (typeof node.length === "number") {
      var n = Math.min(node.length, 2000);
      var buf = [];
      for (var i = 0; i < n && out.length < CONTEXT_MAX_FRAGMENTS; i++) {
        var elem = node[i];
        if (elem == null) continue;
        var et = typeof elem;
        if (et === "string") {
          if (elem.length > 0) buf.push(elem);
        } else if (et === "number") {
          if (elem >= 0x20 && elem <= 0x10FFFF) buf.push(String.fromCharCode(elem));
        } else if (et === "object" && typeof elem.length !== "number") {
          // 字符对象：优先取 char/character/code/codePoint（number → 字符）
          var ch = elem.char;
          if (typeof ch !== "number") ch = elem.character;
          if (typeof ch !== "number") ch = elem.code;
          if (typeof ch !== "number") ch = elem.codePoint;
          if (typeof ch === "number" && ch >= 0x20 && ch <= 0x10FFFF) {
            buf.push(String.fromCharCode(ch));
            continue;
          }
          // 其他文本字段（text/content/str/value/...）
          var textFound = "";
          for (var ki = 0; ki < CONTEXT_TEXT_KEYS.length; ki++) {
            var k = CONTEXT_TEXT_KEYS[ki];
            if (k === "char" || k === "character" || k === "code" || k === "codePoint") continue;
            var v = elem[k];
            if (typeof v === "string" && v.length > 0) { textFound = v; break; }
          }
          if (textFound) {
            buf.push(textFound);
          } else {
            // 字典无文本字段：递归收集其中可能的字符串
            collectPageText(elem, depth + 1, out);
          }
        } else {
          // 嵌套数组/其他：递归
          collectPageText(elem, depth + 1, out);
        }
      }
      var line = buf.join("").trim();
      if (line.length >= 1) out.push(line);
      return;
    }

    // 字典（无 length）：白名单键读取
    for (var ki2 = 0; ki2 < CONTEXT_TEXT_KEYS.length; ki2++) {
      var k2 = CONTEXT_TEXT_KEYS[ki2];
      var v2 = node[k2];
      if (v2 == null) continue;
      var vt2 = typeof v2;
      if (vt2 === "string") {
        var sv2 = v2.trim();
        if (sv2.length >= 1 && !/^[\d.,\-+\s]+$/.test(sv2)) out.push(sv2);
      } else if (vt2 === "number" &&
        (k2 === "char" || k2 === "character" || k2 === "code" || k2 === "codePoint")) {
        // 字典中独立的 char 数字：作为单字符
        if (v2 >= 0x20 && v2 <= 0x10FFFF) out.push(String.fromCharCode(v2));
      } else if (vt2 === "object") {
        collectPageText(v2, depth + 1, out);
      }
    }
  }

  // 安全描述 NSArray 结构（不序列化、不 for-in，仅索引访问 + 白名单键读取）
  // 返回 { length, firstType, firstHasKey:["text:1","content:0",...], firstArrayLen }
  // ——用于 HUD 诊断告诉用户实际键名是什么（白名单是否覆盖）
  function describeArray(arr) {
    var info = { length: (arr && typeof arr.length === "number") ? arr.length : 0 };
    if (!arr || info.length === 0) return info;
    var first = arr[0];
    info.firstType = typeof first;
    if (first && typeof first === "object") {
      if (typeof first.length === "number") {
        // 第一层是数组（行集合）——再看首个元素
        info.firstArrayLen = first.length;
        if (first.length > 0) {
          var row0 = first[0];
          info.firstChildType = typeof row0;
          if (row0 && typeof row0 === "object" && typeof row0.length !== "number") {
            // 字典：列出白名单键探测命中情况
            info.firstKeys = probeKeys(row0);
          } else if (typeof row0 === "string") {
            info.firstChildIsString = true;
          }
        }
      } else {
        // 第一层直接是字典
        info.firstKeys = probeKeys(first);
      }
    }
    return info;
  }

  function probeKeys(obj) {
    var found = [];
    for (var i = 0; i < CONTEXT_TEXT_KEYS.length; i++) {
      var k = CONTEXT_TEXT_KEYS[i];
      var v = obj[k];
      if (v == null) continue;
      var t = typeof v;
      var preview = "";
      if (t === "string") preview = ":" + String(v).slice(0, 12).replace(/\s+/g, "_");
      found.push(k + "(" + t + ")" + preview);
    }
    return found;
  }

  // 获取指定页的整页文本：
  //   1) MNDocument（若运行环境注入）：textContentsForPageNo 返回 string（首选）；
  //   2) MbBook.textContentsForPageNo：返回 NSArray（外层行/段、内层对象）——白名单键递归收集。
  // 全程仅数组索引 + 白名单键读取，无序列化、无 for-in，避免 ObjC 异常崩溃。
  // 返回 { ok, text, source, reason?, info? } ——失败时 reason + info 给 HUD 诊断
  function getPageText(dc, pageNo) {
    // 1) MNDocument（若运行环境注入）
    try {
      if (typeof MNDocument !== "undefined" && MNDocument) {
        var md = new MNDocument(dc.document);
        if (md && typeof md.textContentsForPageNo === "function") {
          var t = md.textContentsForPageNo(pageNo);
          if (typeof t === "string" && t.trim().length > 0) {
            return { ok: true, text: t, source: "MNDocument" };
          }
        }
      }
    } catch (e) { /* 环境未注入/异常 → 走兜底 */ }
    // 2) MbBook.textContentsForPageNo：NSArray → 白名单键递归收集
    try {
      var doc = dc.document;
      if (!doc || typeof doc.textContentsForPageNo !== "function") {
        return { ok: false, reason: "MbBook.textContentsForPageNo 方法不可用" };
      }
      var arr = doc.textContentsForPageNo(pageNo);
      if (!arr) {
        return { ok: false, reason: "MbBook 文本层返回 null/undefined（pageNo=" + pageNo + "）" };
      }
      if (typeof arr.length !== "number") {
        return { ok: false, reason: "MbBook 文本层无 length 属性（typeof=" + typeof arr + "）" };
      }
      if (arr.length === 0) {
        return { ok: false, reason: "MbBook 文本层为空数组（该页可能为扫描件/未 OCR）" };
      }
      var parts = [];
      collectPageText(arr, 0, parts);
      if (parts.length > 0) {
        return { ok: true, text: parts.join(" "), source: "MbBook" };
      }
      // 收集为空：诊断（让用户知道白名单键不匹配实际键名）
      var info = describeArray(arr);
      return {
        ok: false,
        reason: "白名单键未匹配（第一行探测键名见 info）",
        info: info
      };
    } catch (e) {
      return { ok: false, reason: "MbBook.textContentsForPageNo 抛 JS 异常: " + e };
    }
  }

  // 选区所在页码：DocumentController.currPageNo（1 起）/ currPageIndex（0 起）。
  // 只用文档控制器属性（官方文档确认存在），不调用 MNUtil（环境注入与否未知，
  // 且可能触发 ObjC 异常导致崩溃）。
  function resolveSelectionPageNo(dc) {
    if (dc) {
      if (typeof dc.currPageNo === "number" && dc.currPageNo >= 1) return dc.currPageNo;
      if (typeof dc.currPageIndex === "number") return dc.currPageIndex + 1;
    }
    return 1;
  }

  // 提取选区上下文：当前页文本层中定位选中文本，前后各取 contextLength 字符。
  // 返回 "" 表示未开启/定位失败（prompt 的 {context} 渲染为空，不影响请求）。
  // 开启但提取失败时弹一次性 HUD 诊断（console 日志在 MarginNote 不可见），便于排查。
  function extractContext(win, text) {
    try {
      var cfg = MNIATSettings.load();
      var len = (typeof cfg.contextLength === "number") ? cfg.contextLength : 200;
      if (!len || len <= 0) return "";
      var studyController = Application.sharedInstance().studyController(win);
      if (!studyController || !studyController.readerController) return "";
      var dc = studyController.readerController.currentDocumentController;
      if (!dc || !dc.document) return "";
      var pageNo = resolveSelectionPageNo(dc);
      var pageResult = getPageText(dc, pageNo);
      var pageText = pageResult.ok ? pageResult.text : "";
      var needle = String(text || "").trim();
      if (!pageText || pageText.length === 0) {
        var reason = pageResult.reason || "未知";
        console.log("[MNIATFlow] context: page text unavailable, reason=" + reason);
        // 诊断信息：HUD 显示失败原因 + 探测到的实际键名（便于白名单覆盖）
        var hudMsg = "[翻译插件] 上下文失败：" + reason + "，已降级为不注入";
        if (pageResult.info && pageResult.info.firstKeys) {
          hudMsg += "；实际键名：" + pageResult.info.firstKeys.slice(0, 5).join("、");
        }
        if (hudMsg.length > 220) hudMsg = hudMsg.slice(0, 220) + "…";
        Application.sharedInstance().showHUD(hudMsg, win, 4);
        return "";
      }
      if (!needle) return "";
      var pos = pageText.indexOf(needle);
      if (pos < 0) {
        // 选区在文本层中可能带换行/连字符：模糊兜底——去掉空白后重试
        var flat = pageText.replace(/\s+/g, " ");
        var flatNeedle = needle.replace(/\s+/g, " ");
        pos = flat.indexOf(flatNeedle);
        if (pos < 0) {
          console.log("[MNIATFlow] context: selection not found in page text (pageNo=" + pageNo +
            ", pageLen=" + pageText.length + ", needle=" + needle.slice(0, 40) + ")");
          var preview = needle.length > 20 ? needle.slice(0, 20) + "…" : needle;
          Application.sharedInstance().showHUD("[翻译插件] 上下文：未定位到选区「" + preview +
            "」（页文本长度 " + pageText.length + "），已降级为不注入", win, 3);
          return "";
        }
        var start = Math.max(0, pos - len);
        var end = Math.min(flat.length, pos + flatNeedle.length + len);
        var ctxFlat = flat.slice(start, end).trim();
        console.log("[MNIATFlow] context extracted (flat): len=" + ctxFlat.length +
          ", head=" + ctxFlat.slice(0, 60));
        return ctxFlat;
      }
      var start = Math.max(0, pos - len);
      var end = Math.min(pageText.length, pos + needle.length + len);
      var ctx = pageText.slice(start, end).trim();
      console.log("[MNIATFlow] context extracted: len=" + ctx.length + ", head=" + ctx.slice(0, 60));
      return ctx;
    } catch (e) {
      console.log("[MNIATFlow] extract context error: " + e);
      return "";
    }
  }

  // 上下文摘要（用于缓存键区分：同一文本不同上下文视为不同输入）
  function contextKey(context) {
    if (!context) return "";
    var h = 5381;
    for (var i = 0; i < context.length; i++) {
      h = ((h << 5) + h + context.charCodeAt(i)) >>> 0;
    }
    return "c" + h.toString(36);
  }

  // 解析有效路由（含「重新生成选模型」的临时覆盖）：
  // override = { providerId, modelId }，覆盖的提供商/模型不存在时回落默认路由；
  // 覆盖仅作用于本次请求，不写回 config.routing。
  function resolveEffectiveRoute(kind, override) {
    var resolved = MNIATSettings.resolveRoute(kind);
    if (!override || !override.providerId) return resolved;
    var providers = MNIATSettings.load().providers || [];
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].id === override.providerId) {
        var p = providers[i];
        var modelOk = !!override.modelId && Array.isArray(p.models) &&
          p.models.some(function (m) { return m && m.id === override.modelId; });
        return {
          provider: p,
          route: {
            providerId: p.id,
            modelId: modelOk ? override.modelId : "",
            temperature: resolved.route.temperature,
            reasoningEffort: resolved.route.reasoningEffort
          }
        };
      }
    }
    return resolved;
  }

  // AI 翻译 / AI 解释统一入口：
  //   routingKind: "translate" | "lookup"（路由配置组）
  //   promptKind: "translate" | "explain"（prompt 模板）
  //   opts: { bypassCache, override }
  // 缓存规则：
  //   - 翻译（routingKind=translate）→ AI 翻译缓存，键 = providerId:modelId:text
  //   - AI 解释（promptKind=explain）→ 查词缓存，键 = ai:providerId:modelId:word
  //   - 重新生成（bypassCache=true）跳过读取；新结果仍写入缓存覆盖旧值
  function runAI(job, routingKind, promptKind, opts) {
    opts = opts || {};
    var resolved = resolveEffectiveRoute(routingKind, opts.override);
    var provider = resolved.provider;
    var route = resolved.route;

    var cacheKind = null;
    var cacheKey = "";
    if (provider && route.modelId) {
      // 缓存键纳入上下文摘要：prompt 含 {context} 时，同一文本不同上下文结果不同，
      // 不区分会导致缓存互串（cXXX 段；上下文为空时不加段，兼容旧缓存仍可命中）
      var ck = contextKey(job.context);
      if (promptKind === "explain") {
        cacheKind = "lookup";
        cacheKey = "ai:" + provider.id + ":" + route.modelId + (ck ? ":" + ck : "") +
          ":" + String(job.text).trim().toLowerCase();
      } else {
        cacheKind = "translate";
        cacheKey = provider.id + ":" + route.modelId + (ck ? ":" + ck : "") +
          ":" + String(job.text).trim();
      }
      if (!opts.bypassCache) {
        var cached = MNIATCache.get(cacheKind, cacheKey);
        if (cached && cached.text && cached.text.trim().length > 0) {
          console.log("[MNIATFlow] AI cache hit (" + promptKind + "): " + String(job.text).slice(0, 40));
          pushEvent({ type: "translateResult", text: cached.text });
          // 「查词服务 = AI 解释」场景：命中缓存同样按设置朗读该单词
          speakAIExplainWord(job, promptKind);
          return;
        }
      }
    }

    job.session = MNIAIService.run(routingKind, promptKind, job.text, {
      resolved: resolved, // 复用已解析的路由（含临时覆盖），避免内部二次解析导致键不一致
      context: job.context || "", // 选区上下文 → prompt {context} 变量
      onDelta: function (delta, accumulated) {
        // 流式增量：前端 accumulated 累积渲染（打字机效果）
        pushEvent({ type: "delta", accumulated: accumulated });
      },
      onDone: function (full) {
        if (full && full.trim().length > 0) {
          if (cacheKind && cacheKey) {
            // meta 记录来源与原文，供历史记录展示（查词/AI 解释/翻译历史相互独立）
            MNIATCache.put(cacheKind, cacheKey, {
              text: full,
              meta: {
                kind: promptKind === "explain" ? "ai" : "translate",
                provider: provider.id,
                sourceText: String(job.text).trim()
              }
            });
          }
          pushEvent({ type: "translateResult", text: full });
          // 「查词服务 = AI 解释」场景：AI 返回后按设置用词典朗读该单词
          speakAIExplainWord(job, promptKind);
        } else {
          pushEvent({ type: "error", message: "AI 返回为空，请检查提供商配置或稍后重试" });
        }
      },
      onError: function (message) {
        // 卡片选中态回退（2026-08-15）：primary（标题）失败时尝试用 fallbackText
        // （摘录正文）再发起一次请求，避免 from/to 相同等错误导致完全无响应。
        // 仅一次重试（_fallbackTried 标志）防止无限循环。
        //
        // ⚠️ 限定（2026-08-15）：仅当「查词服务是真实词典」时启用 fallback。
        // 当 lookupProvider="ai" 时，excerptText 本身就是 AI 解释输出，
        // 拿它再跑 AI 解释无意义（重复请求、消耗 API、且 prompt 含中英混合长文本易报错）。
        if (job.fallbackText && job.fallbackText !== job.text && !job._fallbackTried) {
          var fbCfg = MNIATSettings.load();
          if (fbCfg.lookupProvider === "ai") {
            // 跳过 fallback：直接报错
            pushEvent({ type: "error", message: message });
            return;
          }
          job._fallbackTried = true;
          console.log("[MNIATFlow] primary failed, retry with fallback text: \"" +
            job.fallbackText.slice(0, 40) + "\"");
          if (job.session) {
            try { job.session.cancel(); } catch (e) { /* 忽略 */ }
            job.session = null;
          }
          job.text = job.fallbackText;
          job.fallbackText = ""; // 防止再触发
          // 重新发起 AI 请求（按新文本重新判定查词/翻译与缓存键）
          runAI(job, routingKind, promptKind, opts);
          return;
        }
        pushEvent({ type: "error", message: message });
      }
    });
  }

  // 词典查词结果收尾：构建发音信息（口音/自动开关取当前配置，缓存命中时同样刷新）并推送
  function finishLookup(job, provider, result) {
    var cfg = MNIATSettings.load();
    var uk = "";
    var us = "";
    if (provider === "bing" || provider === "haici" || provider === "kingsoft") {
      // 必应/海词/金山：解析结果自带英美发音链接
      uk = result.ukMp3 || "";
      us = result.usMp3 || "";
    } else {
      uk = MNIATYoudao.pronounceURL(job.text.trim(), "uk");
      us = MNIATYoudao.pronounceURL(job.text.trim(), "us");
    }
    result.pronounce = {
      uk: uk,
      us: us,
      // 有道 dictvoice 对首字母大写词可能 500（如 Desolvation），小写正常，
      // 提供小写兜底供前端回退
      ukFallback: provider === "youdao"
        ? MNIATYoudao.pronounceURL(job.text.trim().toLowerCase(), "uk")
        : "",
      usFallback: provider === "youdao"
        ? MNIATYoudao.pronounceURL(job.text.trim().toLowerCase(), "us")
        : "",
      auto: cfg.pronounceAuto,
      accent: cfg.pronounceAccent
    };
    // 携带服务商标记：前端工具栏「查词服务切换」菜单据此高亮当前使用的服务
    result.provider = provider;
    pushEvent({ type: "dictResult", data: result });
  }

  // 机器翻译（百度/小牛/阿里云/腾讯等开放平台，无 AI 提供商依赖）：
  //   config.translateService === "machine" 时，句子/段落翻译走此路径；
  //   provider/apiType/domain 来自 config.machineRouting + machineProviders；
  //   按 provider.vendor 分派到对应服务（baidu → MNIATBaiduMT，niutrans → MNIATNiuTrans，
  //   aliyun → MNIATAliyunMT，tencent → MNIATTencentMT，volcengine → MNIATVolcengineMT）；
  //   缓存：翻译缓存，键 = mt:<providerId>:<vendor>:<apiType>[:<domain|scene>]:text；
  //   重新生成（bypassCache=true）跳过读取，新结果仍写入缓存覆盖旧值。
  //   打字机效果（2026-08-14）：streamMode 开启时，返回结果经 MNIAIService.simulateTyping
  //   逐字推送 delta 事件（与 AI 翻译同一通道），播完再推 translateResult；关闭时保持
  //   一次性整体展示。缓存命中仍直接整体展示（与 AI 缓存命中行为一致）。
  //   machineOverride（2026-08-14，长按「重新生成」选机器翻译服务）：{ machineProviderId }
  //   临时覆盖机器翻译提供商（不写回 machineRouting），apiType/domain/scene 仍取路由配置。
  function runMachineTranslate(job, opts) {
    opts = opts || {};
    var cfg = MNIATSettings.load();
    var routing = cfg.machineRouting || {};
    var provider = null;
    var providers = cfg.machineProviders || [];
    // 提供商解析：优先「重新生成选模型」的临时覆盖，其次路由配置
    var targetId = (opts.machineOverride && opts.machineOverride.machineProviderId) || routing.providerId;
    for (var i = 0; i < providers.length; i++) {
      if (providers[i].id === targetId) {
        provider = providers[i];
        break;
      }
    }
    if (!provider) {
      pushEvent({ type: "error", message: "未配置机器翻译服务：请先在设置「机器翻译服务」中添加账户" });
      return;
    }
    // 校验密钥：阿里云用 AccessKeySecret，腾讯云用 secretId/secretKey，火山用 accessKeyId/secretAccessKey，其他用 secretKey/apiKey
    var vendor = provider.vendor === "niutrans" ? "niutrans" :
      (provider.vendor === "aliyun" ? "aliyun" :
      (provider.vendor === "tencent" ? "tencent" :
      (provider.vendor === "volcengine" ? "volcengine" : "baidu")));
    if (vendor === "aliyun") {
      if (!provider.accessKeyId || !provider.accessKeySecret) {
        pushEvent({ type: "error", message: "未配置机器翻译服务：请先在设置「机器翻译服务」中填写阿里云 AccessKey ID 与 Secret" });
        return;
      }
    } else if (vendor === "tencent") {
      if (!provider.secretId || !provider.secretKey) {
        pushEvent({ type: "error", message: "未配置机器翻译服务：请先在设置「机器翻译服务」中填写腾讯云 SecretId 与 SecretKey" });
        return;
      }
    } else if (vendor === "volcengine") {
      if (!provider.accessKeyId || !provider.secretAccessKey) {
        pushEvent({ type: "error", message: "未配置机器翻译服务：请先在设置「机器翻译服务」中填写火山引擎 AccessKey ID 与 SecretAccessKey" });
        return;
      }
    } else if (!provider.secretKey && !provider.apiKey) {
      pushEvent({ type: "error", message: "未配置机器翻译服务：请先在设置「机器翻译服务」中填写密钥" });
      return;
    }

    var apiType = routing.apiType;
    var domain = String(routing.domain || "it");
    var scene = String(routing.scene || "title");
    var text = String(job.text).trim();
    // 缓存键：vendor + apiType；baidu 的领域、aliyun 专业版的场景会改变结果，纳入键
    var cacheKey = "mt:" + provider.id + ":" + vendor + ":" + apiType +
      (vendor === "baidu" && apiType === "domain" ? ":" + domain : "") +
      (vendor === "aliyun" && apiType === "pro" ? ":" + scene : "") + ":" + text;

    if (!opts.bypassCache) {
      var cached = MNIATCache.get("translate", cacheKey);
      if (cached && cached.text && cached.text.trim().length > 0) {
        console.log("[MNIATFlow] machine translate cache hit: " + text.slice(0, 40));
        pushEvent({ type: "translateResult", text: cached.text });
        return;
      }
    }

    var promise = null;
    if (vendor === "niutrans") {
      promise = MNIATNiuTrans.translate(text, {
        apiType: apiType === "pro" ? "pro" : "flash",
        appid: provider.appid,
        secretKey: provider.secretKey || provider.apiKey,
        targetLang: cfg.targetLang
      });
    } else if (vendor === "aliyun") {
      promise = MNIATAliyunMT.translate(text, {
        apiType: apiType === "pro" ? "pro" : "general",
        scene: scene,
        accessKeyId: provider.accessKeyId,
        accessKeySecret: provider.accessKeySecret,
        targetLang: cfg.targetLang
      });
    } else if (vendor === "tencent") {
      promise = MNIATTencentMT.translate(text, {
        secretId: provider.secretId,
        secretKey: provider.secretKey,
        targetLang: cfg.targetLang
      });
    } else if (vendor === "volcengine") {
      promise = MNIATVolcengineMT.translate(text, {
        accessKeyId: provider.accessKeyId,
        secretAccessKey: provider.secretAccessKey,
        targetLang: cfg.targetLang
      });
    } else {
      promise = MNIATBaiduMT.translate(text, {
        apiType: apiType,
        domain: domain,
        appid: provider.appid,
        secretKey: provider.secretKey || provider.apiKey,
        targetLang: cfg.targetLang
      });
    }

    promise.then(function (result) {
      if (currentJob !== job) return; // 已被新任务取代
      var out = (result && result.text) ? String(result.text) : "";
      if (out.trim().length > 0) {
        if (!opts.bypassCache) {
          MNIATCache.put("translate", cacheKey, {
            text: out,
            meta: { kind: "translate", provider: provider.id, sourceText: text }
          });
        }
        // 打字机效果：与 AI 翻译同一 delta 通道逐字输出，播完再推完成事件。
        // job.session 挂载打字机句柄：新任务/重新生成时 cancelCurrent/regenerate 会取消计时器。
        if (cfg.streamMode !== false) {
          if (job.session) {
            try { job.session.cancel(); } catch (e) { /* 忽略 */ }
            job.session = null;
          }
          job.session = MNIAIService.simulateTyping(out, {
            onDelta: function (delta, accumulated) {
              if (currentJob !== job) return;
              pushEvent({ type: "delta", accumulated: accumulated });
            },
            onDone: function (full) {
              if (currentJob !== job) return;
              job.session = null;
              pushEvent({ type: "translateResult", text: full });
            }
          });
        } else {
          pushEvent({ type: "translateResult", text: out });
        }
      } else {
        pushEvent({ type: "error", message: "机器翻译返回为空，请稍后重试" });
      }
    }).catch(function (err) {
      if (currentJob !== job) return;
      pushEvent({ type: "error", message: String((err && err.message) || err) });
    });
  }

  // 词典查词（含缓存）：
  // 缓存键 = 服务商:单词小写 —— 不同查词服务查同一单词不互用缓存；
  // 命中时用当前配置重建发音信息（口音/自动开关可能已变化）。
  //
  // 大小写约定（2026-08-12 用户实测反馈）：
  //   - 金山词霸对大小写敏感（"Hard" = 哈德姓氏 / "hard" = 普通的形容词），
  //     划词查到 "Hard" 时若直接发请求会被当姓氏解析；统一改用 lowercase
  //     词发请求，确保拿到的是普通词条。
  //   - 其他查词服务对大小写不敏感（必应/海词/有道），传小写无副作用。
  //   - 缓存 key 始终用小写，避免 "Hard" 与 "hard" 命中两份独立但语义不同的缓存。
  //
  // bypassCache（2026-08-12 用户反馈）：
  //   搜索框（searchWord）查询时设 true —— 跳过读写缓存，强制走网络。
  //   解决"搜索 hard 时仍返回之前 Hard 的姓氏缓存"问题（同一 cacheKey 命中）。
  function runLookup(job, provider) {
    pushEvent({ type: "loading", mode: "lookup", text: job.text });
    var rawWord = String(job.text).trim();
    var queryWord = (provider === "kingsoft") ? rawWord.toLowerCase() : rawWord;
    var cacheKey = provider + ":" + rawWord.toLowerCase();
    var bypassCache = !!job.bypassCache;

    if (!bypassCache) {
      var cached = MNIATCache.get("lookup", cacheKey);
      if (cached && cached.data) {
        console.log("[MNIATFlow] lookup cache hit: " + provider + " / " + rawWord);
        finishLookup(job, provider, cached.data);
        return;
      }
    }

    var lookupPromise = null;
    if (provider === "bing") {
      lookupPromise = MNIATBing.lookup(queryWord);
    } else if (provider === "haici") {
      lookupPromise = MNIATHaiCi.lookup(queryWord);
    } else if (provider === "kingsoft") {
      lookupPromise = MNIATKingsoft.lookup(queryWord);
    } else {
      lookupPromise = MNIATYoudao.lookup(queryWord);
    }

    lookupPromise.then(function (result) {
      if (currentJob !== job) return; // 已被新任务取代
      if (!bypassCache) {
        // meta 记录来源与单词（用户输入原样），供历史记录展示（不同查词服务独立标签）
        MNIATCache.put("lookup", cacheKey, {
          data: result,
          meta: { kind: "dict", provider: provider, sourceText: rawWord }
        });
      }
      finishLookup(job, provider, result);
    }).catch(function (err) {
      if (currentJob !== job) return;
      pushEvent({ type: "error", message: String((err && err.message) || err) });
    });
  }

  // 解析单词发音 URL（首选 + 回退链）：
  // 按「AI 解释发音」配置选择词典（有道同步 / 海词、必应需解析页面异步）。
  // 供 AI 解释自动发音与工具栏手动发音按钮（bridge getPronounceURL）共用。
  // 返回 { url, fallbacks }：url 为首选，fallbacks 为备选列表（依次尝试）。
  // 有道特例：dictvoice 对首字母大写词可能返回 500（如 Desolvation），小写正常，
  // 故回退链包含「小写词」与「另一口音」。
  function resolvePronounceURL(word, preferredAccent) {
    var config = MNIATSettings.load();
    var source = config.aiExplainPronounce || "youdao";
    var accent = preferredAccent === "uk" ? "uk" : "us";
    var other = accent === "uk" ? "us" : "uk";

    if (source === "youdao") {
      var lower = String(word).toLowerCase();
      return Promise.resolve({
        url: MNIATYoudao.pronounceURL(word, accent),
        fallbacks: [
          MNIATYoudao.pronounceURL(lower, accent),   // 大写 500 时用小写重试
          MNIATYoudao.pronounceURL(lower, other)     // 再不行换另一口音
        ]
      });
    }
    var promise = null;
    if (source === "bing") promise = MNIATBing.lookup(word);
    else if (source === "haici") promise = MNIATHaiCi.lookup(word);
    else if (source === "kingsoft") promise = MNIATKingsoft.lookup(word);
    else promise = MNIATYoudao.lookup(word); // 默认有道（与 SettingsStore.aiExplainPronounce 默认值一致）
    return promise.then(function (result) {
      if (!result) return { url: "", fallbacks: [] };
      var url = accent === "uk" ? (result.ukMp3 || "") : (result.usMp3 || "");
      var otherUrl = other === "uk" ? (result.ukMp3 || "") : (result.usMp3 || "");
      return { url: url, fallbacks: otherUrl ? [otherUrl] : [] };
    }).catch(function () {
      return { url: "", fallbacks: [] };
    });
  }

  // AI 解释（lookupProvider=ai）返回后自动发音：
  // 按「AI 解释发音」配置选择有道/海词/必应，口音遵循「发音口音」（uk/us），
  // 并遵循「查词自动发音」开关（用户要求发音跟随该开关）；
  // 仅当默认查词服务为 AI 解释（config.lookupProvider === "ai"）时生效——
  // 词典卡/工具栏手动切换的 AI 解释（lookupProvider 为词典）不触发自动发音。
  function speakAIExplainWord(job, promptKind) {
    if (promptKind !== "explain" || !job || job.mode !== "explain") return;
    var config = MNIATSettings.load();
    if (config.lookupProvider !== "ai") return;
    if (!config.pronounceAuto) return;
    var word = String(job.text || "").trim();
    if (!word) return;
    var accent = config.pronounceAccent === "uk" ? "uk" : "us";
    resolvePronounceURL(word, accent).then(function (r) {
      if (r && r.url) {
        pushEvent({ type: "speak", url: r.url, fallbacks: r.fallbacks || [], accent: accent });
      }
    });
  }

  // ---------- 历史记录（数据源 = 查词/翻译缓存） ----------

  // 兜底解析（兼容无 meta 的旧缓存条目；新写入的缓存均带 meta，正常不命中这些分支）
  function fallbackProviderFromKey(key) {
    var idx = String(key).indexOf(":");
    return idx > 0 ? String(key).slice(0, idx) : "";
  }
  function fallbackWordFromKey(key) {
    var idx = String(key).lastIndexOf(":");
    return idx >= 0 ? String(key).slice(idx + 1) : String(key);
  }

  // 读取历史记录：
  //   kind = "lookup" → 查词历史（词典查词 type=dict / AI 解释 type=ai，含服务商标记）
  //   kind = "translate" → 翻译历史（type=translate，含原文与译文）
  // 顺序 = 缓存最近使用优先；缓存容量为 0 时返回空数组。
  function getHistory(kind) {
    var cacheKind = kind === "translate" ? "translate" : "lookup";
    var entries = MNIATCache.entries(cacheKind);
    var items = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var v = e.value || {};
      var meta = v.meta || {};
      var item = { key: e.key };
      if (cacheKind === "translate") {
        item.type = "translate";
        item.sourceText = meta.sourceText || fallbackWordFromKey(e.key);
        item.text = v.text || "";
        if (!item.text) continue;
      } else if (meta.kind === "ai" || (!meta.kind && String(e.key).indexOf("ai:") === 0)) {
        item.type = "ai";
        item.sourceText = meta.sourceText || fallbackWordFromKey(e.key);
        item.text = v.text || "";
        if (!item.text) continue;
      } else {
        item.type = "dict";
        item.provider = meta.provider || fallbackProviderFromKey(e.key);
        item.sourceText = meta.sourceText || fallbackWordFromKey(e.key);
        item.data = v.data || null;
        if (!item.data) continue;
      }
      items.push(item);
    }
    return items;
  }

  // 点击历史条目：结果卡片直接显示缓存内容（不再请求网络）。
  //   dict → finishLookup 重建发音信息；ai → translateResult + 自动发音门控；
  //   translate → translateResult。
  function applyHistory(kind, item) {
    if (!item || !item.type) {
      throw new Error("缺少历史条目");
    }
    if (currentJob && currentJob.session) {
      currentJob.session.cancel();
      currentJob.session = null;
    }
    var win = (currentJob && currentJob.win) || lastWin;
    pushEvent({ type: "reset" });

    if (item.type === "translate") {
      var src = String(item.sourceText || "").trim();
      currentJob = { mode: "translate", text: src, win: win, session: null, context: "" };
      pushEvent({ type: "loading", mode: "translate", text: src });
      pushEvent({ type: "translateResult", text: String(item.text || "") });
    } else if (item.type === "ai") {
      var w = String(item.sourceText || "").trim();
      currentJob = { mode: "explain", text: w, win: win, session: null, context: "" };
      pushEvent({ type: "loading", mode: "explain", text: w });
      pushEvent({ type: "translateResult", text: String(item.text || "") });
      speakAIExplainWord(currentJob, "explain");
    } else if (item.type === "dict" && item.data) {
      var word = String(item.sourceText || "").trim();
      var provider = item.provider === "bing" || item.provider === "haici" || item.provider === "kingsoft"
        ? item.provider
        : "youdao";
      currentJob = { mode: "lookup", text: word, win: win, session: null, context: "" };
      pushEvent({ type: "loading", mode: "lookup", text: word });
      finishLookup(currentJob, provider, item.data);
    } else {
      throw new Error("不支持的历史条目类型");
    }
    return { applied: true };
  }

  return {
    // 判定该文本是否应被处理（查词/翻译独立开关）
    canHandle: function (text) {
      var mode = determineMode(text);
      var config = MNIATSettings.load();
      if (mode === "lookup" && config.lookupEnabled === false) return false;
      if (mode === "translate" && config.translateEnabled === false) return false;
      return true;
    },

    // 划词触发入口（triggerMode=auto 时由 monitor 直接调用；button 模式由悬浮按钮点击调用）
    // fallback（2026-08-15）：来自卡片选中态的回退文本（标题优先，摘录正文兜底）。
    // 当 primary 报错时由 runAI 自动用 fallback 再发起一次请求。
    handleSelection: function (win, text, anchorRect, fallback) {
      this.cancelCurrent();

      var mode = determineMode(text);
      var config = MNIATSettings.load();
      // 独立开关：查词/翻译分别控制；单独开启查词时选中句子/段落不触发翻译
      if (mode === "lookup" && config.lookupEnabled === false) return;
      if (mode === "translate" && config.translateEnabled === false) return;

      lastWin = win;
      // 选区上下文（prompt {context} 变量）：
      //   - 文档划词（fallback 为 undefined/null）：从当前页文本层提取前后文；
      //   - 卡片选中态（fallback 为字符串）：标题/摘录不一定来自当前页文本层，提取无意义，
      //     且无文档时（脑图模式）会误弹「未定位到选区」HUD → 直接跳过（context 为空串）。
      var fromCard = typeof fallback === "string";
      currentJob = {
        mode: mode,
        text: text,
        win: win,
        session: null,
        context: fromCard ? "" : extractContext(win, text),
        fallbackText: fromCard ? (fallback || "") : "" // 卡片选中态：primary（标题）失败时回退到摘录正文
      };

      console.log("[MNIATFlow] new job: mode=" + mode + ", text=\"" + text.slice(0, 40) +
        "\", fromCard=" + fromCard + ", fallback=" + (fallback ? "yes" : "no"));
      // 显示卡片并加载 #/card 页面；卡片前端 ready 后通过 bridge 发送 cardReady
      MNIATFloatingCard.showJob(win, anchorRect);
    },

    // 卡片前端加载完成（bridge: cardReady）
    onCardReady: function () {
      if (!currentJob) return;
      this.startJob(currentJob);
    },

    // 卡片已处于打开状态时的复用启动（跳过页面加载）
    restartJob: function () {
      if (!currentJob) return;
      pushEvent({ type: "reset" });
      this.startJob(currentJob);
    },

    startJob: function (job) {
      if (job.mode === "lookup") {
        var config = MNIATSettings.load();
        var lookupProvider = config.lookupProvider || "youdao"; // youdao | bing | haici | ai

        // 查词服务配置为「AI 解释」时，直接走 AI（使用 lookup 路由 + explain prompt）
        if (lookupProvider === "ai") {
          job.mode = "explain"; // 标记为 AI 解释任务（触发返回后自动发音；词典卡手动切换不触发）
          pushEvent({ type: "loading", mode: "explain", text: job.text });
          runAI(job, "lookup", "explain", {});
          return;
        }

        runLookup(job, lookupProvider);
      } else {
        pushEvent({ type: "loading", mode: "translate", text: job.text });
        // 翻译引擎：常规设置「翻译服务」= machine 时走机器翻译（百度等），否则走 AI
        var cfg = MNIATSettings.load();
        if (cfg.translateService === "machine") {
          runMachineTranslate(job, {});
        } else {
          runAI(job, "translate", "translate", {});
        }
      }
    },

    // 词典卡 → 一键切换 AI 解释
    explainWithAI: function () {
      if (!currentJob) {
        throw new Error("当前没有进行中的查词任务");
      }
      if (currentJob.session) {
        currentJob.session.cancel();
        currentJob.session = null;
      }
      // 标记为 AI 解释任务：前端显示「重新生成」按钮并支持长按选模型；
      // 自动发音仍受 speakAIExplainWord 的 config.lookupProvider === "ai" 门控，不受影响
      currentJob.mode = "explain";
      pushEvent({ type: "loading", mode: "explain", text: currentJob.text });
      runAI(currentJob, "lookup", "explain", {});
      return { switched: true };
    },

    // 工具栏搜索框查询任意单词：使用默认查词服务提供商（config.lookupProvider）。
    // bypassCache=true（2026-08-12）：搜索不读也不写缓存，避免大小写版本命中已有
    // 错误缓存（如曾划词查 "Hard" 拿到姓氏结果，再搜索 "hard" 会被同 cacheKey 命中）。
    searchWord: function (text) {
      var trimmed = String(text || "").trim();
      if (!trimmed) throw new Error("查询内容为空");
      var win = (currentJob && currentJob.win) || lastWin;
      this.cancelCurrent();
      // 搜索无选区：不带上下文（context 为空，{context} 渲染为空串）
      currentJob = { mode: "lookup", text: trimmed, win: win, session: null, bypassCache: true, context: "" };
      pushEvent({ type: "reset" });
      this.startJob(currentJob);
      return { started: true };
    },

    // 工具栏查词服务切换（bar 图标菜单）：临时切换查词服务/AI 解释对比结果，
    // 不写回 config.lookupProvider（默认查词服务仍在设置页更改）。
    lookupWithProvider: function (provider) {
      if (!currentJob) {
        throw new Error("当前没有进行中的任务");
      }
      var valid = provider === "youdao" || provider === "bing" || provider === "haici" ||
        provider === "kingsoft" || provider === "ai";
      if (!valid) throw new Error("不支持的查词服务: " + provider);
      if (currentJob.session) {
        currentJob.session.cancel();
        currentJob.session = null;
      }
      if (provider === "ai") {
        currentJob.mode = "explain";
        pushEvent({ type: "loading", mode: "explain", text: currentJob.text });
        runAI(currentJob, "lookup", "explain", {});
      } else {
        currentJob.mode = "lookup";
        runLookup(currentJob, provider);
      }
      return { switched: true };
    },

    // 「重新生成」：重跑当前 AI 翻译/解释任务，跳过缓存；
    // override = { providerId, modelId }（AI 提供商，长按选模型时传入，临时覆盖，不写回配置）
    //          | { machineProviderId }（机器翻译服务，长按选模型时传入，临时覆盖，不写回 machineRouting）
    // 路由优先级：显式机器翻译覆盖 > 显式 AI 覆盖 > 常规设置「翻译服务」（machine → 机器翻译，否则 AI）。
    regenerate: function (override) {
      if (!currentJob) {
        throw new Error("当前没有进行中的任务");
      }
      if (currentJob.mode !== "translate" && currentJob.mode !== "explain") {
        throw new Error("当前不是 AI 翻译/解释结果，无法重新生成");
      }
      if (currentJob.session) {
        currentJob.session.cancel();
        currentJob.session = null;
      }
      var kind = currentJob.mode === "explain" ? "lookup" : "translate";
      var promptKind = currentJob.mode === "explain" ? "explain" : "translate";
      pushEvent({ type: "reset" });
      pushEvent({ type: "loading", mode: currentJob.mode, text: currentJob.text });

      // 拆分两类覆盖：机器翻译（machineProviderId）与 AI（providerId+modelId），避免串用
      var machineOverride = (override && override.machineProviderId)
        ? { machineProviderId: String(override.machineProviderId) }
        : null;
      var aiOverride = (override && override.providerId)
        ? { providerId: String(override.providerId), modelId: String(override.modelId || "") }
        : null;

      // 翻译任务走机器翻译的条件：用户显式选了机器翻译服务，或常规设置默认就是机器翻译（且未显式选 AI 模型）
      var useMachine = currentJob.mode === "translate" &&
        (!!machineOverride || (MNIATSettings.load().translateService === "machine" && !aiOverride));
      if (useMachine) {
        runMachineTranslate(currentJob, { bypassCache: true, machineOverride: machineOverride });
        return { regenerated: true };
      }
      runAI(currentJob, kind, promptKind, { bypassCache: true, override: aiOverride });
      return { regenerated: true };
    },

    cancelCurrent: function () {
      if (currentJob && currentJob.session) {
        currentJob.session.cancel();
      }
      currentJob = null;
    },

    hasJob: function () {
      return !!currentJob;
    },

    // 供 bridge 命令调用：解析单词发音 URL（工具栏手动发音按钮）
    resolvePronounceURL: resolvePronounceURL,

    // 供 bridge 命令调用：历史记录读取 / 应用
    getHistory: getHistory,
    applyHistory: applyHistory
  };
})();
