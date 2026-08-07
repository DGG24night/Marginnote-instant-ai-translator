// TranslateFlow.js —— 划词任务编排
// 职责：接收划词事件 → 判定单词/句子 → 调度卡片显隐 → 调用 AI/有道服务 → 推送事件到卡片前端。
// 事件协议（推送至卡片 window.__MNIATCardEvent）：
//   {type:"reset"}                          卡片复用时重置界面
//   {type:"loading", mode, text}            mode: translate | lookup | explain
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
      onDone: function (full) {
        if (full && full.trim().length > 0) {
          pushEvent({ type: "translateResult", text: full });
        } else {
          pushEvent({ type: "error", message: "AI 返回为空，请检查提供商配置或稍后重试" });
        }
      },
      onError: function (message) {
        pushEvent({ type: "error", message: message });
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
        pushEvent({ type: "loading", mode: "lookup", text: job.text });
        MNIATYoudao.lookup(job.text.trim()).then(function (result) {
          if (currentJob !== job) return; // 已被新任务取代
          var config = MNIATSettings.load();
          result.pronounce = {
            uk: MNIATYoudao.pronounceURL(job.text.trim(), "uk"),
            us: MNIATYoudao.pronounceURL(job.text.trim(), "us"),
            auto: config.pronounceAuto,
            accent: config.pronounceAccent
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
    }
  };
})();
