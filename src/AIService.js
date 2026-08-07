// AIService.js —— AI 翻译/解释服务（OpenAI Chat Completions 兼容协议）
// 仅非流式请求（MNNetwork.fetch 一次性返回）。
// 注：NSURLConnection delegate 流式在本环境实测不可用，已移除相关代码（2026-08-07）。

var MNIAIService = (function () {

  function endpointOf(provider) {
    var base = String(provider.baseURL || "").trim().replace(/\/+$/, "");
    return base + "/chat/completions";
  }

  // 思考模式适配（2026-08-07 按厂商文档适配）：
  //   - Qwen 系（百炼兼容模式 / SiliconFlow，或模型名以 qwen 开头）：
  //     顶层参数 enable_thinking（false=关闭思考），reasoning_effort 无效
  //   - 智谱 GLM：thinking: { type: "enabled" | "disabled" }
  //   - OpenAI / DeepSeek 等：reasoning_effort: low | medium | high
  function isQwenStyle(provider, modelId) {
    var url = String(provider.baseURL || "").toLowerCase();
    if (/dashscope|siliconflow|modelscope/.test(url)) return true;
    return /^qwen/i.test(String(modelId || "").trim());
  }

  function isZhipuStyle(provider) {
    return /bigmodel\.cn/.test(String(provider.baseURL || "").toLowerCase());
  }

  function buildBody(provider, modelId, route, prompt) {
    var body = {
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      stream: false
    };
    if (typeof route.temperature === "number") {
      body.temperature = route.temperature;
    }
    var effort = route.reasoningEffort || "off";
    if (isQwenStyle(provider, modelId)) {
      body.enable_thinking = effort !== "off";
    } else if (isZhipuStyle(provider)) {
      body.thinking = { type: effort === "off" ? "disabled" : "enabled" };
    } else if (effort !== "off") {
      body.reasoning_effort = effort;
    }
    return body;
  }

  function headersOf(provider) {
    return {
      "Authorization": "Bearer " + String(provider.apiKey || ""),
      "Content-Type": "application/json"
    };
  }

  function extractContent(obj) {
    try {
      if (obj && obj.choices && obj.choices[0] && obj.choices[0].message) {
        return String(obj.choices[0].message.content || "");
      }
    } catch (e) { /* ignore */ }
    return "";
  }

  function extractError(status, res) {
    var message = "HTTP " + status;
    try {
      var obj = res.json();
      if (obj && obj.error && obj.error.message) {
        return String(obj.error.message);
      }
    } catch (e) { /* ignore */ }
    try {
      var text = res.text();
      if (text) message += ": " + text.slice(0, 200);
    } catch (e) { /* ignore */ }
    return message;
  }

  return {
    // kind: "translate" | "lookup"（决定使用哪组路由配置）
    // promptKind: "translate" | "explain"（决定使用哪个 prompt 模板）
    // handlers: { onDelta(delta, accumulated), onDone(full), onError(message) }
    // 返回 { cancel() }
    run: function (kind, promptKind, text, handlers) {
      handlers = handlers || {};

      var resolved = MNIATSettings.resolveRoute(kind);
      var provider = resolved.provider;
      var route = resolved.route;

      if (!provider || !route.modelId) {
        var msg = "尚未配置 AI 服务，请先在设置面板中添加提供商并选择模型";
        if (handlers.onError) handlers.onError(msg);
        return { cancel: function () {} };
      }

      var prompt = MNIATPrompts.build(promptKind, text);
      var body = buildBody(provider, route.modelId, route, prompt);
      console.log("[MNIAIService] request start: " + provider.name + " / " + route.modelId);

      MNNetwork.fetch(endpointOf(provider), {
        method: "POST",
        headers: headersOf(provider),
        json: body,
        timeout: 120
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          var content = extractContent(res.json());
          if (content) {
            if (handlers.onDelta) handlers.onDelta(content, content);
            if (handlers.onDone) handlers.onDone(content);
          } else {
            if (handlers.onError) handlers.onError("AI 返回为空，请检查模型配置");
          }
        } else {
          if (handlers.onError) handlers.onError(extractError(res.status, res));
        }
      }).catch(function (err) {
        if (handlers.onError) handlers.onError("请求失败: " + String(err));
      });

      return { cancel: function () {} };
    },

    // 连通性测试：最小请求验证 baseURL/apiKey/model 可用
    test: function (provider, modelId) {
      var body = {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      };
      return MNNetwork.fetch(endpointOf(provider), {
        method: "POST",
        headers: headersOf(provider),
        json: body,
        timeout: 15
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          return { ok: true, status: res.status };
        }
        return { ok: false, status: res.status, message: extractError(res.status, res) };
      });
    }
  };
})();
