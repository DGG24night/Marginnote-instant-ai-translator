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
      if (promptKind === "explain") {
        cacheKind = "lookup";
        cacheKey = "ai:" + provider.id + ":" + route.modelId + ":" + String(job.text).trim().toLowerCase();
      } else {
        cacheKind = "translate";
        cacheKey = provider.id + ":" + route.modelId + ":" + String(job.text).trim();
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
        pushEvent({ type: "error", message: message });
      }
    });
  }

  // 词典查词结果收尾：构建发音信息（口音/自动开关取当前配置，缓存命中时同样刷新）并推送
  function finishLookup(job, provider, result) {
    var cfg = MNIATSettings.load();
    var uk = "";
    var us = "";
    if (provider === "bing" || provider === "haici") {
      // 必应/海词：解析结果自带英美发音链接
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

  // 词典查词（含缓存）：
  // 缓存键 = 服务商:单词小写 —— 不同查词服务查同一单词不互用缓存；
  // 命中时用当前配置重建发音信息（口音/自动开关可能已变化）。
  function runLookup(job, provider) {
    pushEvent({ type: "loading", mode: "lookup", text: job.text });
    var word = String(job.text).trim();
    var cacheKey = provider + ":" + word.toLowerCase();

    var cached = MNIATCache.get("lookup", cacheKey);
    if (cached && cached.data) {
      console.log("[MNIATFlow] lookup cache hit: " + provider + " / " + word);
      finishLookup(job, provider, cached.data);
      return;
    }

    var lookupPromise = null;
    if (provider === "bing") {
      lookupPromise = MNIATBing.lookup(word);
    } else if (provider === "haici") {
      lookupPromise = MNIATHaiCi.lookup(word);
    } else {
      lookupPromise = MNIATYoudao.lookup(word);
    }

    lookupPromise.then(function (result) {
      if (currentJob !== job) return; // 已被新任务取代
      // meta 记录来源与单词，供历史记录展示（不同查词服务独立标签）
      MNIATCache.put("lookup", cacheKey, {
        data: result,
        meta: { kind: "dict", provider: provider, sourceText: word }
      });
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
    var promise = source === "bing" ? MNIATBing.lookup(word) : MNIATHaiCi.lookup(word);
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
      currentJob = { mode: "translate", text: src, win: win, session: null };
      pushEvent({ type: "loading", mode: "translate", text: src });
      pushEvent({ type: "translateResult", text: String(item.text || "") });
    } else if (item.type === "ai") {
      var w = String(item.sourceText || "").trim();
      currentJob = { mode: "explain", text: w, win: win, session: null };
      pushEvent({ type: "loading", mode: "explain", text: w });
      pushEvent({ type: "translateResult", text: String(item.text || "") });
      speakAIExplainWord(currentJob, "explain");
    } else if (item.type === "dict" && item.data) {
      var word = String(item.sourceText || "").trim();
      var provider = item.provider === "bing" || item.provider === "haici"
        ? item.provider
        : "youdao";
      currentJob = { mode: "lookup", text: word, win: win, session: null };
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
      var mode = isSingleWord(text) ? "lookup" : "translate";
      var config = MNIATSettings.load();
      if (mode === "lookup" && config.lookupEnabled === false) return false;
      if (mode === "translate" && config.translateEnabled === false) return false;
      return true;
    },

    // 划词触发入口（triggerMode=auto 时由 monitor 直接调用；button 模式由悬浮按钮点击调用）
    handleSelection: function (win, text, anchorRect) {
      this.cancelCurrent();

      var mode = isSingleWord(text) ? "lookup" : "translate";
      var config = MNIATSettings.load();
      // 独立开关：查词/翻译分别控制；单独开启查词时选中句子/段落不触发翻译
      if (mode === "lookup" && config.lookupEnabled === false) return;
      if (mode === "translate" && config.translateEnabled === false) return;

      lastWin = win;
      currentJob = { mode: mode, text: text, win: win, session: null };

      console.log("[MNIATFlow] new job: mode=" + mode + ", text=\"" + text.slice(0, 40) + "\"");
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
        runAI(job, "translate", "translate", {});
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

    // 工具栏搜索框查询任意单词：使用默认查词服务提供商（config.lookupProvider）
    searchWord: function (text) {
      var trimmed = String(text || "").trim();
      if (!trimmed) throw new Error("查询内容为空");
      var win = (currentJob && currentJob.win) || lastWin;
      this.cancelCurrent();
      currentJob = { mode: "lookup", text: trimmed, win: win, session: null };
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
      var valid = provider === "youdao" || provider === "bing" || provider === "haici" || provider === "ai";
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
    // override = { providerId, modelId }（长按选模型时传入，临时覆盖，不写回配置）
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
      runAI(currentJob, kind, promptKind, { bypassCache: true, override: override });
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
