// StreamChannel.js —— NSURLConnection delegate 流式连接通道
// 背景：mn-docs「NSURLConnection」确认 connectionWithRequestDelegate + delegate 回调可用
//       （connectionDidReceiveResponse / connectionDidReceiveData / connectionDidFinishLoading /
//        connectionDidFailWithError，另有 start/cancel/setDelegateQueue）。
//       2026-08-06 曾实现但「回调零触发」导致整体移除（network.js 有记录）。本轮重建并修正：
//       1) delegate 与 connection 存入模块级 registry 强引用——NSURLConnection 对 delegate 是
//          weak 引用，旧实现若 delegate 只是局部变量会被回收，回调静默失效（历史根因）；
//       2) 显式 setDelegateQueue(NSOperationQueue.mainQueue())；
//       3) 显式 start()；
//       4) 幂等 cancel()：conn.cancel() + registry 清理，已取消连接的回调一律忽略。
// 职责：只做「连接 + 分块字节回调」，不做 SSE 解析（解析在 AIService）。
// 对外：MNIATStream.post(url, options, handlers) → { cancel() }
//   handlers: {
//     onStatus(statusCode),   // 收到响应头（delegate 通道存活信号）；非 HTTP 时 status 为 0
//     onData(byteChunk),      // NSData → base64 → 「字节语义字符串」（每个 charCode 一个字节），
//                             //   便于按字节边界安全切行（UTF-8 续字节 >=0x80 不含 0x0A）
//     onEnd(),                // 流正常结束
//     onError(message)        // 连接层失败（网络错误等）
//   }

var MNIATStream = (function () {
  var connSeq = 0;
  var connections = {}; // connId -> { id, delegate, connection, handlers, cancelled }

  function findEntry(seq) {
    return connections[seq] || null;
  }

  function release(connId) {
    if (connections[connId]) {
      delete connections[connId];
    }
  }

  // delegate 类只定义一次；实例上挂 _seq（connId）用于回调反查 entry。
  // JSB 对 delegate 回调的参数传递顺序与 ObjC selector 一致（connection 在前），
  // 但不同桥接版本可能有差异，故用 arguments[1] || arguments[0] 容错取真实参数。
  var streamDelegateClass = JSB.defineClass("MNIATStreamDelegate : NSObject", {
    connectionDidReceiveResponse: function () {
      var entry = findEntry(self._seq);
      if (!entry || entry.cancelled) return;
      var status = 0;
      try {
        var response = arguments[1] || arguments[0];
        if (response && response.statusCode) {
          status = Number(response.statusCode());
        }
      } catch (e) { /* 非 HTTP 响应，忽略 */ }
      if (entry.handlers.onStatus) entry.handlers.onStatus(status);
    },

    connectionDidReceiveData: function () {
      var entry = findEntry(self._seq);
      if (!entry || entry.cancelled) return;
      var data = arguments[1] || arguments[0];
      if (!data || typeof data.length !== "function" || data.length() === 0) return;
      try {
        var bytes = MNIATBase64.decode(data.base64Encoding());
        if (entry.handlers.onData) entry.handlers.onData(bytes);
      } catch (e) {
        console.log("[MNIATStream] decode chunk error: " + e);
      }
    },

    connectionDidFinishLoading: function () {
      var entry = findEntry(self._seq);
      if (!entry || entry.cancelled) return;
      release(self._seq);
      if (entry.handlers.onEnd) entry.handlers.onEnd();
    },

    connectionDidFailWithError: function () {
      var entry = findEntry(self._seq);
      if (!entry || entry.cancelled) return;
      release(self._seq);
      var message = "网络错误";
      try {
        var error = arguments[1] || arguments[0];
        if (error && error.localizedDescription) {
          message = String(error.localizedDescription());
        }
      } catch (e) { /* 忽略 */ }
      if (entry.handlers.onError) entry.handlers.onError(message);
    }
  });

  return {
    // url/options 复用 MNNetwork.buildRequest（method/headers/json/timeout 一致），
    // 流式场景需在 options.headers 覆盖 Accept: text/event-stream。
    post: function (url, options, handlers) {
      handlers = handlers || {};
      var req = MNNetwork.buildRequest(url, options || {});

      var delegate = streamDelegateClass.new();
      var connection = null;
      var connId = "s" + (++connSeq);
      delegate._seq = connId;

      try {
        connection = NSURLConnection.connectionWithRequestDelegate(req, delegate);
      } catch (e) {
        if (handlers.onError) handlers.onError("流式连接创建失败: " + e);
        return { cancel: function () {} };
      }

      connections[connId] = {
        id: connId,
        delegate: delegate,
        connection: connection,
        handlers: handlers,
        cancelled: false
      };

      try {
        // 历史教训：delegate 通道不触发多因默认 run loop 调度与弱引用，显式走主队列
        connection.setDelegateQueue(NSOperationQueue.mainQueue());
        connection.start();
      } catch (e) {
        release(connId);
        if (handlers.onError) handlers.onError("流式连接启动失败: " + e);
        return { cancel: function () {} };
      }

      return {
        cancel: function () {
          var entry = connections[connId];
          if (!entry || entry.cancelled) return;
          entry.cancelled = true;
          try {
            entry.connection.cancel();
          } catch (e) { /* 忽略 */ }
          release(connId);
        }
      };
    }
  };
})();
