// TranslateFlow.js —— 划词任务编排
// 职责：接收划词事件 → 判定单词/句子 → 调度卡片显隐 → 调用 AI/有道服务 → 推送事件到卡片前端。
// 事件协议（推送至卡片 window.__MNIATCardEvent）：
//   {type:"reset"}                          卡片复用时重置界面
//   {type:"loading", mode, text}            mode: translate | lookup | explain
//   {type:"delta", accumulated}             流式增量（AI 翻译/解释打字机效果）
//   {type:"translateResult", text}          翻译/解释完成
//   {type:"dictResult", data}               词典结果（含 pronounce 配置）
//   {type:"error", message}                 失败

var MNIATFlow = (function () {
  var currentJob = null; // { mode, text, win, session }

  function pushEvent(obj) {
    MNIATFloatingCard.sendEvent(obj);
  }

  function isSingleWord(text) {
    return /^[A-Za-z][A-Za-z'\-]*$/.test(String(text).trim());
  }

  function runAI(job, routingKind, promptKind) {
    job.session = MNIAIService.run(routingKind, promptKind, job.text, {
      onDelta: function (delta, accumulated) {
        // 流式增量：前端 accumulated 累积渲染（打字机效果）
        pushEvent({ type: "delta", accumulated: accumulated });
      },
      onDone: function (full) {
        if (full && full.trim().length > 0) {
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
  // 仅对 startJob 的 AI 分支（job.mode === "explain"）生效，
  // 词典卡手动切换 AI 解释（explainWithAI，mode 仍为 lookup）不触发。
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

  return {
    // 划词触发入口（triggerMode=auto 时由 monitor 直接调用；button 模式由悬浮按钮点击调用）
    handleSelection: function (win, text, anchorRect) {
      this.cancelCurrent();

      var mode = isSingleWord(text) ? "lookup" : "translate";
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
          runAI(job, "lookup", "explain");
          return;
        }

        pushEvent({ type: "loading", mode: "lookup", text: job.text });

        // 按配置分发到对应词典服务
        var lookupPromise = null;
        if (lookupProvider === "bing") {
          lookupPromise = MNIATBing.lookup(job.text.trim());
        } else if (lookupProvider === "haici") {
          lookupPromise = MNIATHaiCi.lookup(job.text.trim());
        } else {
          lookupPromise = MNIATYoudao.lookup(job.text.trim());
        }

        lookupPromise.then(function (result) {
          if (currentJob !== job) return; // 已被新任务取代
          var cfg = MNIATSettings.load();
          var uk = "";
          var us = "";
          if (lookupProvider === "bing" || lookupProvider === "haici") {
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
            ukFallback: lookupProvider === "youdao"
              ? MNIATYoudao.pronounceURL(job.text.trim().toLowerCase(), "uk")
              : "",
            usFallback: lookupProvider === "youdao"
              ? MNIATYoudao.pronounceURL(job.text.trim().toLowerCase(), "us")
              : "",
            auto: cfg.pronounceAuto,
            accent: cfg.pronounceAccent
          };
          pushEvent({ type: "dictResult", data: result });
        }).catch(function (err) {
          if (currentJob !== job) return;
          pushEvent({ type: "error", message: String((err && err.message) || err) });
        });
      } else {
        pushEvent({ type: "loading", mode: "translate", text: job.text });
        runAI(job, "translate", "translate");
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
      pushEvent({ type: "loading", mode: "explain", text: currentJob.text });
      runAI(currentJob, "lookup", "explain");
      return { switched: true };
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
    resolvePronounceURL: resolvePronounceURL
  };
})();
