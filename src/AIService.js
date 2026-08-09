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

  // 在 provider.models 中查找模型配置（含 supportsReasoning 标记）
  function modelOf(provider, modelId) {
    var models = provider && Array.isArray(provider.models) ? provider.models : [];
    for (var i = 0; i < models.length; i++) {
      if (models[i] && models[i].id === modelId) return models[i];
    }
    return null;
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
    // 关键修复：模型明确标记「不支持推理」时，绝不发送任何思考相关参数。
    // 部分厂商（如百炼 Qwen 非推理款）对 enable_thinking 参数直接 400：
    //   {"code":20015,"message":"...model does not support parameter `enable_thinking`."}
    // 即使值为 false 也会报错，所以这里整段跳过。
    var model = modelOf(provider, modelId);
    var supportsReasoning = model ? model.supportsReasoning : undefined;
    var effort = route.reasoningEffort || "off";
    if (supportsReasoning === false) {
      // 不发送任何思考参数
    } else if (isQwenStyle(provider, modelId)) {
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

    // 连通性测试：最小请求验证 baseURL/apiKey/model 可用。
    // probeReasoning=true 时，连通后再发一次带思考参数的请求探测模型是否支持思考，
    // 返回 supportsReasoning: true | false | null（null = 无法判断，如 429/5xx/超时）。
    test: function (provider, modelId, probeReasoning) {
      var self = this;
      var basic = {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      };
      return MNNetwork.fetch(endpointOf(provider), {
        method: "POST",
        headers: headersOf(provider),
        json: basic,
        timeout: 15
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          if (!probeReasoning) {
            return { ok: true, status: res.status, supportsReasoning: null };
          }
          // 思考能力探测：多一次带思考参数的请求
          return MNNetwork.fetch(endpointOf(provider), {
            method: "POST",
            headers: headersOf(provider),
            json: self.buildProbeBody(provider, modelId),
            timeout: 15
          }).then(function (res2) {
            if (res2.status >= 200 && res2.status < 300) {
              return { ok: true, status: res.status, supportsReasoning: true };
            }
            var msg = extractError(res2.status, res2);
            var detected = self.detectReasoningFromError(msg);
            return { ok: true, status: res.status, supportsReasoning: detected, probeMessage: msg };
          });
        }
        return { ok: false, status: res.status, message: extractError(res.status, res) };
      });
    },

    // 思考能力探测请求体（按厂商风格选择参数）
    buildProbeBody: function (provider, modelId) {
      var body = {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      };
      if (isQwenStyle(provider, modelId)) {
        body.enable_thinking = true;
      } else if (isZhipuStyle(provider)) {
        body.thinking = { type: "enabled" };
      } else {
        body.reasoning_effort = "low";
      }
      return body;
    },

    // 从探测请求的错误信息判断是否「不支持思考参数」；无法判断返回 null
    detectReasoningFromError: function (message) {
      var m = String(message || "").toLowerCase();
      if (/does not support|not support|not supported|unsupported|unknown parameter|unknown field|invalid parameter|invalid field|is not supported|enable_thinking|reasoning_effort|'thinking'|thinking.*(not|invalid|unknown)/.test(m)) {
        return false;
      }
      return null;
    },

    // 获取模型列表：GET {baseURL}/models（OpenAI 兼容）
    // 返回 { models: [id 字符串数组] }。推理能力不在列表阶段判断（启发式不可靠），
    // 统一由「测试」时的思考参数探测（probeReasoning）确认。
    fetchModels: function (baseURL, apiKey) {
      var url = String(baseURL || "").trim().replace(/\/+$/, "") + "/models";
      return MNNetwork.fetch(url, {
        method: "GET",
        headers: { "Authorization": "Bearer " + String(apiKey || "") },
        timeout: 20
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          var obj = res.json();
          var list = obj && obj.data;
          if (list && list.length) {
            var ids = [];
            for (var i = 0; i < list.length; i++) {
              if (list[i] && list[i].id) ids.push(String(list[i].id));
            }
            if (ids.length) return { models: ids };
            return { models: [], message: "接口返回的模型列表为空" };
          }
          return { models: [], message: "接口返回格式异常（未找到 data 数组）" };
        }
        return { models: [], message: extractError(res.status, res) };
      });
    }
  };
})();
