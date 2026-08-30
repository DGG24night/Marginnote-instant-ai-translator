// StreamChannel.js —— NSURLConnection delegate 真流式通道（SSE 行缓冲解析）
// 背景：2026-08-29 StreamProbe 在本机实测通过（Ollama Cloud，5 块 / 83 条 SSE 事件 / 1.7s，
//   回调实时到达、流期间主线程其他任务正常穿插、无卡死、看门狗未触发）。
// 探针确认的关键事实（对照 2026-08-06/08-09 两次失败）：
//   - delegate 回调 args=2，签名即 function (connection, xxx)；为防桥接顺序差异，
//     仍按特征（base64Encoding / statusCode / code|domain）在两参中识别目标对象；
//   - NSURLConnection 按 TCP 读聚合：单块可达数 KB、含多条 SSE 事件 → 必须行缓冲解析；
//   - 不调用 setDelegateQueue（Apple 规定它与 run loop 调度互斥；探针未用即正常）；
//   - delegate 与 connection 都由 session 强引用（08-06「回调零触发」根因是 delegate 弱引用被
//     回收；2026-08-30 修复：此前只强引用了 connection，delegate 是局部变量，JS 包装可被
//     GC 回收 → 回调静默丢失，实测与「上下文失败 HUD 紧贴请求发出」的场景强相关）；
//   - 本层每个 chunk 只做内存解析，UI 推送由调用方节流
//     （08-09 卡死主因：每 chunk evaluateJavaScript 推全量文本打满主线程）。
// 职责：连接生命周期 + SSE 行缓冲解析；不做节流、不做 UI 推送。
// 对外：MNIATStream.post(url, options, handlers) → { cancel() }
//   options 复用 MNNetwork.buildRequest（method/headers/json/timeout）；
//   handlers: {
//     onStatus(status),       // 响应头到达（非 HTTP 为 -1）
//     onEvent(obj),           // 每条 "data: {json}" 的解析结果；"data: [DONE]" 内部消化不回调
//     onEnd(),                // 流正常结束
//     onError(message, info)  // info: { status, bodyText }；HTTP>=400 时 bodyText 为完整响应体
//   }
// 非 200 响应：正文不是 SSE，按普通文本收集，结束时一次性 onError 上抛（调用方决定是否重试）。

var MNIATStream = (function () {
  var sessions = {}; // sid -> session（强引用，防 delegate/connection 被回收）
  var sidSeq = 0;

  function stopSession(sid) {
    var s = sessions[sid];
    if (!s) return;
    s.cancelled = true;
    // 墓碑占位：cancel 后仍可能收到迟到回调（已发出的数据/错误），保留一个
    // cancelled=true 的小对象让回调静默返回，同时不把整个 session（含大 buf 与
    // handlers 闭包）留在 sessions 里；也会避免把「取消后的迟到回调」误报成
    // 「session 丢失」诊断。
    sessions[sid] = { cancelled: true };
    if (s.connection) {
      try { s.connection.cancel(); } catch (e) { /* 忽略 */ }
      s.connection = null;
    }
    if (s.delegate) {
      s.delegate = null; // 释放强引用（原生连接已 cancel，delegate 不再需要）
    }
  }

  // ---------- SSE 行缓冲解析 ----------
  // 只解析完整行（\n 结尾）。UTF-8 续字节（0x80-0xBF）不含 0x0A，因此完整行内
  // 不会出现被截断的多字节序列，逐行 MNIATUTF8.decode 是安全的；残行留在 buf 等下一块。
  function handleLine(s, rawLine) {
    var line = rawLine;
    if (line.length > 0 && line.charAt(line.length - 1) === "\r") {
      line = line.substring(0, line.length - 1);
    }
    if (line.length === 0) return; // SSE 事件分隔空行
    if (line.indexOf("data:") !== 0) return; // event:/id:/retry:/注释行：OpenAI 兼容流只关心 data:
    var payload = line.substring(5);
    if (payload.charAt(0) === " ") payload = payload.substring(1);
    if (payload.length === 0) return;
    if (payload === "[DONE]") {
      s.done = true;
      console.log("[MNIATStream] [DONE]（events=" + s.events + "）");
      return;
    }
    var obj = null;
    try { obj = JSON.parse(MNIATUTF8.decode(payload)); } catch (e) { obj = null; }
    if (obj) {
      s.events += 1;
      if (s.handlers.onEvent) s.handlers.onEvent(obj);
    }
  }

  function drainLines(s) {
    var buf = s.buf;
    var pos = 0;
    while (!s.done) {
      var idx = buf.indexOf("\n", pos);
      if (idx < 0) break;
      handleLine(s, buf.substring(pos, idx));
      pos = idx + 1;
    }
    if (pos > 0) s.buf = buf.substring(pos);
  }

  function finish(s) {
    if (s.finished) return;
    s.finished = true;
    stopSession(s.sid);
    console.log("[MNIATStream] finish: chunks=" + s.chunks + " events=" + s.events);
    if (s.handlers.onEnd) s.handlers.onEnd();
  }

  // delegate 类只定义一次（require 时执行；重载插件重定义覆盖）
  var streamDelegateClass = JSB.defineClass("MNIATStreamDelegate : NSObject", {
    connectionDidReceiveResponse: function (a, b) {
      var s = sessions[self.__sid];
      if (!s) {
        console.log("[MNIATStream] 回调丢弃：session 不存在（sid=" + self.__sid + "）");
        return;
      }
      if (s.cancelled || s.finished) return;
      var response = (b && typeof b.statusCode === "function") ? b : a;
      var status = -1;
      try { status = response ? Number(response.statusCode()) : -1; } catch (e) { /* 非 HTTP */ }
      s.status = status;
      s.errBody = status >= 400;
      console.log("[MNIATStream] status=" + status + (s.errBody ? "（错误体模式）" : ""));
      if (s.handlers.onStatus) s.handlers.onStatus(status);
    },

    connectionDidReceiveData: function (a, b) {
      var s = sessions[self.__sid];
      if (!s) {
        console.log("[MNIATStream] 回调丢弃：session 不存在（sid=" + self.__sid + "）");
        return;
      }
      if (s.cancelled || s.finished) return;
      var data = (b && typeof b.base64Encoding === "function") ? b : a;
      if (!data) return;
      var bytes = "";
      try { bytes = MNIATBase64.decode(data.base64Encoding()); } catch (e) { return; }
      if (!bytes.length) return;
      s.chunks += 1;
      console.log("[MNIATStream] chunk #" + s.chunks + " +" + bytes.length + "B");
      if (s.errBody) {
        // HTTP>=400：正文是普通 JSON/文本错误体，原样收集，结束时统一上抛
        s.rawBody += bytes;
        if (s.rawBody.length > 262144) {
          var oversized = "HTTP " + s.status + "（错误体过大已截断）";
          stopSession(s.sid);
          if (s.handlers.onError) s.handlers.onError(oversized, { status: s.status, bodyText: "" });
        }
        return;
      }
      s.buf += bytes;
      if (s.buf.length > 1048576) { // 残行异常堆积（防御）：一行超过 1MB 视为数据异常
        stopSession(s.sid);
        if (s.handlers.onError) s.handlers.onError("响应数据异常", { status: s.status });
        return;
      }
      drainLines(s);
      if (s.done && !s.finished) finish(s); // [DONE]：立即结束，不等服务器关连接
    },

    connectionDidFinishLoading: function () {
      var s = sessions[self.__sid];
      if (!s) {
        console.log("[MNIATStream] 回调丢弃：session 不存在（sid=" + self.__sid + "）");
        return;
      }
      if (s.cancelled || s.finished) return;
      if (s.errBody) {
        var bodyText = "";
        try { bodyText = MNIATUTF8.decode(s.rawBody); } catch (e) { /* 解码失败给空串 */ }
        stopSession(s.sid);
        console.log("[MNIATStream] HTTP " + s.status + " 错误体 " + bodyText.length + " 字符");
        if (s.handlers.onError) {
          s.handlers.onError("HTTP " + s.status, { status: s.status, bodyText: bodyText });
        }
        return;
      }
      if (s.buf.length > 0) { // 结尾无换行的残行
        var tail = s.buf;
        s.buf = "";
        handleLine(s, tail);
      }
      finish(s);
    },

    connectionDidFailWithError: function (a, b) {
      var s = sessions[self.__sid];
      if (!s) {
        console.log("[MNIATStream] 回调丢弃：session 不存在（sid=" + self.__sid + "）");
        return;
      }
      if (s.cancelled || s.finished) return;
      var err = (b && (b.code !== undefined || b.domain !== undefined)) ? b : a;
      var message = "网络错误";
      try {
        if (err) {
          message = typeof err.localizedDescription === "function"
            ? String(err.localizedDescription())
            : String(err.localizedDescription || message);
        }
      } catch (e) { /* 忽略 */ }
      stopSession(s.sid);
      console.log("[MNIATStream] error: " + message + "（chunks=" + s.chunks + "）");
      if (s.handlers.onError) s.handlers.onError(message, { status: s.status });
    }
  });

  return {
    post: function (url, options, handlers) {
      handlers = handlers || {};
      var sid = "s" + (++sidSeq);
      var s = {
        sid: sid,
        handlers: handlers,
        buf: "",
        rawBody: "",
        status: -1,
        errBody: false,
        done: false,
        finished: false,
        cancelled: false,
        chunks: 0,
        events: 0,
        connection: null,
        delegate: null
      };

      var delegate = null;
      try {
        delegate = streamDelegateClass.new();
        delegate.__sid = sid;
      } catch (e) {
        if (handlers.onError) handlers.onError("流式连接创建失败: " + e, { status: -1 });
        return { cancel: function () {} };
      }

      try {
        var request = MNNetwork.buildRequest(url, options || {});
        s.connection = NSURLConnection.connectionWithRequestDelegate(request, delegate);
        s.delegate = delegate; // 强引用 delegate 的 JS 包装：局部变量会被 GC 回收，回调随之静默丢失
      } catch (e2) {
        if (handlers.onError) handlers.onError("流式连接启动失败: " + e2, { status: -1 });
        return { cancel: function () {} };
      }

      sessions[sid] = s; // 先注册再 start：回调可能在 start 后立刻到达
      console.log("[MNIATStream] open " + url);
      try { s.connection.start(); } catch (e3) {
        console.log("[MNIATStream] start 失败: " + e3);
        stopSession(sid);
        if (handlers.onError) handlers.onError("流式连接启动失败: " + e3, { status: -1 });
      }

      return {
        cancel: function () { stopSession(sid); }
      };
    }
  };
})();
