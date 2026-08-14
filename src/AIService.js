// AIService.js —— AI 翻译/解释服务（OpenAI Chat Completions 兼容协议）
// 流式输出（2026-08-09 修复版）：
//   「流式输出」= 非流式请求 + 打字机模拟：fetch 一次性拿完整结果，
//   插件侧 NSTimer 分批推送 delta，前端逐字显示（打字机效果）。
//   为何不用真流式：NSURLConnection delegate 流式在本环境两次实测不可用——
//   2026-08-06 回调零触发（已移除）；2026-08-09 重建后开启即主线程卡死
//   （mac 彩虹转盘），且主线程卡死后看门狗 NSTimer 无法触发，降级形同虚设。
//   故 delegate 真流式从默认路径移除，StreamChannel.js 保留为实验通道（未接入），
//   待环境确认支持后再启用。
// 开关：config.streamMode（默认 true）。false = 一次性完整显示（无打字效果）。

var MNIAIService = (function () {

  // Ollama（Cloud / Local）识别：
  //   Cloud baseURL: https://ollama.com/api（用户预置）
  //   Local baseURL: http://localhost:11434 / http://127.0.0.1:11434（用户预置，无 /api 后缀）
  // 预置的 baseURL 是 Ollama 原生 API 基址，而 OpenAI 兼容端点是 /v1/chat/completions，
  // 需要 endpointOf / fetchModels 中转换为 /v1 层级（见 endpointOf 注释）。
  function isOllamaStyle(provider) {
    var url = String(provider && provider.baseURL || "").toLowerCase();
    return /ollama\.com/.test(url) ||
      /localhost:11434/.test(url) ||
      /127\.0\.0\.1:11434/.test(url);
  }

  function endpointOf(provider) {
    var base = String(provider.baseURL || "").trim().replace(/\/+$/, "");
    if (isOllamaStyle(provider)) {
      // Ollama 官方 OpenAI 兼容端点为 /v1/chat/completions：
      //   Local: http://localhost:11434/v1/chat/completions
      //   Cloud: https://ollama.com/v1/chat/completions
      // 预置 baseURL（https://ollama.com/api、http://localhost:11434）为原生 API 基址：
      //   - https://ollama.com/api  → 去掉 /api → https://ollama.com + /v1
      //   - http://localhost:11434  → 直接 + /v1
      // 用户若已填到 /v1 层级（如 http://localhost:11434/v1）则直接复用。
      if (/\/api$/.test(base)) base = base.replace(/\/api$/, "");
      if (!/\/v1$/.test(base)) base = base + "/v1";
      return base + "/chat/completions";
    }
    return base + "/chat/completions";
  }

  // 思考模式适配（2026-08-09 按"提供商 + 模型 ID"细分；2026-08-10 新增火山/蚂蚁百灵）：
  //
  //   ┌─────────────────┬───────────────────────────────────────────────┐
  //   │ doubao 模型     │ 任何供应商托管的 doubao 均优先命中（火山方舟    │
  //   │ (modelId^doubao)│ 官方 + 百炼/SiliconFlow/自定义等）：           │
  //   │                 │ thinking.type=disabled|enabled 控制开关        │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ DeepSeek 官方   │ thinking.type=disabled|enabled 控制开关；          │
  //   │ (.deepseek.com) │ 开启时辅以 reasoning_effort=low|medium|high       │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ Moonshot        │ kimi-k3 → reasoning_effort: low|high|max        │
  //   │ (.moonshot.cn)  │   关闭→low（k3 始终思考，无 none）；medium→high  │
  //   │                 │ kimi-k2.7-code/-code-highspeed → 始终 enabled   │
  //   │                 │ kimi-k2.5 / kimi-k2.6 / 其他 → thinking.type     │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ 蚂蚁百灵        │ Ling-3.0-flash → thinking.type: enabled|disabled│
  //   │ (.ant-ling.com) │ Ring-2.6-1T → reasoning.effort: high|xhigh      │
  //   │                 │   （始终推理，无关闭选项，映射为 high）          │
  //   │                 │ 其余 Ling 模型 → 不发任何思考参数               │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ 智谱 bigmodel.cn│ thinking.type: enabled | disabled              │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ 百炼/SiliconFlow│ modelId 含 "deepseek" / "kimi" → reasoning_effort│
  //   │ /ModelScope/    │   关闭→"none"（官方取值）；其余档位透传         │
  //   │ Qwen 系         │ 其余（含 modelId 以 qwen 开头）→ enable_thinking │
  //   ├─────────────────┼───────────────────────────────────────────────┤
  //   │ 其他（OpenAI /  │ reasoning_effort: none（关闭）| low|medium|high  │
  //   │ 自定义兼容）    │ 关闭→"none"（OpenAI 官方支持）                  │
  //   └─────────────────┴───────────────────────────────────────────────┘
  //
  // 用户标记 supportsReasoning:false 的模型 → 跳过整段

  function isQwenStyle(provider, modelId) {
    var url = String(provider.baseURL || "").toLowerCase();
    if (/dashscope|siliconflow|modelscope/.test(url)) return true;
    return /^qwen/i.test(String(modelId || "").trim());
  }

  function isZhipuStyle(provider) {
    return /bigmodel\.cn/.test(String(provider.baseURL || "").toLowerCase());
  }

  function isDeepSeekStyle(provider) {
    // DeepSeek 官方 api.deepseek.com；不误判 SiliconFlow 上的 deepseek-ai/...
    return /(^|\.)deepseek\.com/.test(String(provider.baseURL || "").toLowerCase());
  }

  function isMoonshotStyle(provider) {
    return /moonshot\.cn/.test(String(provider.baseURL || "").toLowerCase());
  }

  function isKimi(modelId) {
    return /^kimi/i.test(String(modelId || "").trim());
  }

  function isKimiK3(modelId) {
    return /^kimi-k3(\b|$)/i.test(String(modelId || "").trim());
  }

  function isKimiK27Code(modelId) {
    // kimi-k2.7-code / kimi-k2.7-code-highspeed：思考始终开启
    return /^kimi-k2\.7/i.test(String(modelId || "").trim());
  }

  function isDeepSeekModel(modelId) {
    return /deepseek/i.test(String(modelId || "").trim());
  }

  // doubao 模型（火山方舟官方，或其他供应商托管的 doubao）
  // 火山方舟文档：所有 doubao 模型均用 thinking 对象控制深度思考开关
  function isDoubaoModel(modelId) {
    return /^doubao/i.test(String(modelId || "").trim());
  }

  // 蚂蚁百灵（api.ant-ling.com）
  function isAntLingStyle(provider) {
    return /ant-ling\.com/.test(String(provider.baseURL || "").toLowerCase());
  }

  // 蚂蚁百灵 Ling-3.0-flash：thinking.type 控制思考开关（唯一支持 thinking 的 Ling 模型）
  function isLing30Flash(modelId) {
    return /^ling-3\.0-flash/i.test(String(modelId || "").trim());
  }

  // 蚂蚁百灵 Ring-2.6-1T：reasoning.effort 控制推理深度（唯一支持 reasoning 的模型，始终推理）
  function isRing26(modelId) {
    return /^ring-2\.6/i.test(String(modelId || "").trim());
  }

  // 在 provider.models 中查找模型配置（含 supportsReasoning 标记）
  function modelOf(provider, modelId) {
    var models = provider && Array.isArray(provider.models) ? provider.models : [];
    for (var i = 0; i < models.length; i++) {
      if (models[i] && models[i].id === modelId) return models[i];
    }
    return null;
  }

  // 构造思考控制参数对象 {} 表示不发送任何参数
  function buildReasoningBody(provider, modelId, route) {
    var model = modelOf(provider, modelId);
    var supportsReasoning = model ? model.supportsReasoning : undefined;
    var effort = route.reasoningEffort || "off";

    // 用户明确标记「不支持推理」：整段跳过
    if (supportsReasoning === false) return {};

    var mid = String(modelId || "").trim();

    // 0. Ollama（Cloud / Local，OpenAI 兼容接口）：
    //    按供应商 URL 识别，优先于模型名启发式（如 Ollama 上的 qwen3 模型不应走
    //    DashScope 的 enable_thinking，而应使用官方兼容接口支持的 reasoning_effort：
    //    "high"|"medium"|"low"|"max"|"none"；关闭 → "none"，其余档位透传）。
    if (isOllamaStyle(provider)) {
      return { reasoning_effort: effort === "off" ? "none" : effort };
    }

    // 1. doubao 模型（火山方舟官方 + 其他供应商托管的 doubao）：
    //    统一用 thinking.type 控制深度思考开关（火山方舟文档：enabled/disabled/auto，
    //    用户设置无 auto，故映射 enabled/disabled 两档）
    if (isDoubaoModel(mid)) {
      return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
    }

    // 2. DeepSeek 官方：双参数（开关 + 强度）
    if (isDeepSeekStyle(provider)) {
      if (effort === "off") return { thinking: { type: "disabled" } };
      return { thinking: { type: "enabled" }, reasoning_effort: effort };
    }

    // 3. Moonshot Kimi：按 modelId 分支
    if (isMoonshotStyle(provider)) {
      if (isKimiK27Code(mid)) {
        // kimi-k2.7-code 系列：始终开启；用户关闭无效（官方只支持 enabled）
        return { thinking: { type: "enabled" } };
      }
      if (isKimiK3(mid)) {
        // kimi-k3：reasoning_effort 取值 low|high|max；不支持 none/medium
        // 关闭 → low（k3 始终思考，无法真正关掉，映射为最小强度）
        // medium → high（按文档映射：low/medium → high）
        if (effort === "off") return { reasoning_effort: "low" };
        if (effort === "medium") return { reasoning_effort: "high" };
        return { reasoning_effort: effort };
      }
      if (isKimi(mid)) {
        // kimi-k2.5 / kimi-k2.6 / 其他：thinking.type
        return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
      }
    }

    // 4. 蚂蚁百灵（api.ant-ling.com）：
    //    Ling-3.0-flash → thinking.type（文档：仅此模型支持 thinking）
    //    Ring-2.6-1T   → reasoning.effort: high|xhigh（文档：仅此模型支持 reasoning，
    //                   始终推理无关闭选项；用户档位映射为 high 默认深度）
    //    其余 Ling 模型 → 不支持思考参数，不发任何参数
    if (isAntLingStyle(provider)) {
      if (isLing30Flash(mid)) {
        return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
      }
      if (isRing26(mid)) {
        return { reasoning: { effort: "high" } };
      }
      return {};
    }

    // 5. 智谱：thinking.type
    if (isZhipuStyle(provider)) {
      return { thinking: { type: effort === "off" ? "disabled" : "enabled" } };
    }

    // 6. Qwen 系列 / 百炼 / SiliconFlow / ModelScope
    if (isQwenStyle(provider, mid)) {
      // 百炼等第三方上跑的 DeepSeek / Kimi 模型官方支持 reasoning_effort 字符串（含 none）
      if (isDeepSeekModel(mid) || isKimi(mid)) {
        return { reasoning_effort: effort === "off" ? "none" : effort };
      }
      return { enable_thinking: effort !== "off" };
    }

    // 7. 其他（OpenAI GPT / 自定义 OpenAI 兼容 / 未识别提供商）
    return { reasoning_effort: effort === "off" ? "none" : effort };
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
    // 部分厂商（如百炼 Qwen 非推理款）对 enable_thinking 参数直接 400：
    //   {"code":20015,"message":"...model does not support parameter `enable_thinking`."}
    // 即使值为 false 也会报错——supportsReasoning===false 时由 buildReasoningBody 跳过整段
    Object.assign(body, buildReasoningBody(provider, modelId, route));
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

  // 网络/认证错误友好提示：
  // NSURLErrorDomain -1012（NSURLErrorUserCancelledAuthentication）= 服务器发起认证质询但被取消，
  // 常见于 API Key 缺失/错误（如 Ollama Cloud 需先在 ollama.com 创建 API Key；本地 Ollama 无需 Key）。
  function errorText(err) {
    var code = err && typeof err.code === "number" ? err.code : null;
    var raw = (err && (err.message || err.localizedDescription))
      ? String(err.message || err.localizedDescription)
      : String(err);
    if (code === -1012) {
      return "认证失败（-1012）：服务器要求认证，请检查 API Key 是否正确。" +
        "Ollama Cloud 需先在 https://ollama.com/settings/keys 创建 API Key 并填入提供商设置；" +
        "Ollama Local 本地服务无需 Key。";
    }
    return raw;
  }

  // ---------- 流式输出（打字机模拟） ----------

  var SIM_INTERVAL_MS = 30;  // 打字机 tick 间隔
  var SIM_MAX_TICKS = 100;   // 最大 tick 数（总打字时长约 3s；文本越长单 tick 步长越大）

  // 打字机模拟（AI 翻译/解释与机器翻译共用）：
  //   把完整文本 full 按 tick 分批推送 handlers.onDelta(delta, accumulated)，
  //   播完回调 handlers.onDone(accumulated)。返回 { cancel() }，取消后不再推送。
  //   步长自适应：短文本逐字，长文本大步长，总时长控制在 ~3s。
  function simulateTyping(full, handlers) {
    handlers = handlers || {};
    var state = {
      cancelled: false,
      finished: false,
      accumulated: "",
      simTimer: null
    };

    function cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      if (state.simTimer) {
        state.simTimer.invalidate();
        state.simTimer = null;
      }
    }

    var step = Math.max(3, Math.ceil(full.length / SIM_MAX_TICKS));
    var pos = 0;
    function tickFn() {
      if (state.cancelled) return;
      var next = Math.min(pos + step, full.length);
      var chunk = full.slice(pos, next);
      state.accumulated += chunk;
      if (handlers.onDelta) handlers.onDelta(chunk, state.accumulated);
      pos = next;
      if (pos >= full.length) {
        state.finished = true;
        state.simTimer = null;
        if (handlers.onDone) handlers.onDone(state.accumulated);
      } else {
        state.simTimer = NSTimer.scheduledTimerWithTimeInterval(SIM_INTERVAL_MS / 1000, false, tickFn);
      }
    }
    state.simTimer = NSTimer.scheduledTimerWithTimeInterval(SIM_INTERVAL_MS / 1000, false, tickFn);

    return { cancel: cancel };
  }

  // 非流式请求：一次性拿完整结果（streamMode=false 时直接用）
  function runOnce(provider, route, prompt, handlers) {
    var body = buildBody(provider, route.modelId, route, prompt);
    console.log("[MNIAIService] request start (non-stream): " + provider.name + " / " + route.modelId);

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
      if (handlers.onError) handlers.onError("请求失败: " + errorText(err));
    });
  }

  // 流式输出：非流式 fetch + NSTimer 分批推送（打字机效果）。
  // 与前端 delta 事件同一通道，前端状态机零改动。
  function runSimulatedStreaming(provider, route, prompt, handlers) {
    var state = {
      cancelled: false,
      typing: null // simulateTyping 返回的 { cancel() }
    };

    function cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      if (state.typing) {
        state.typing.cancel();
        state.typing = null;
      }
    }

    var body = buildBody(provider, route.modelId, route, prompt);
    console.log("[MNIAIService] request start (simulated stream): " + provider.name + " / " + route.modelId);

    MNNetwork.fetch(endpointOf(provider), {
      method: "POST",
      headers: headersOf(provider),
      json: body,
      timeout: 120
    }).then(function (res) {
      if (state.cancelled) return;
      if (res.status >= 200 && res.status < 300) {
        var content = extractContent(res.json());
        if (content && content.trim().length > 0) {
          state.typing = simulateTyping(content, {
            onDelta: function (delta, accumulated) {
              if (state.cancelled) return;
              if (handlers.onDelta) handlers.onDelta(delta, accumulated);
            },
            onDone: function (full) {
              if (state.cancelled) return;
              state.typing = null;
              if (handlers.onDone) handlers.onDone(full);
            }
          });
        } else {
          if (handlers.onError) handlers.onError("AI 返回为空，请检查模型配置");
        }
      } else {
        if (handlers.onError) handlers.onError(extractError(res.status, res));
      }
    }).catch(function (err) {
      if (state.cancelled) return;
      if (handlers.onError) handlers.onError("请求失败: " + errorText(err));
    });

    return { cancel: cancel };
  }

  return {
    // kind: "translate" | "lookup"（决定使用哪组路由配置）
    // promptKind: "translate" | "explain"（决定使用哪个 prompt 模板）
    // handlers: { onDelta(delta, accumulated), onDone(full), onError(message), resolved?, override? }
    //   resolved: { provider, route } —— 调用方已解析好的有效路由（含「重新生成选模型」的临时覆盖），
    //             不传则内部按配置解析。
    // 返回 { cancel() }
    run: function (kind, promptKind, text, handlers) {
      handlers = handlers || {};

      var resolved = handlers.resolved || MNIATSettings.resolveRoute(kind);
      var provider = resolved.provider;
      var route = resolved.route;

      if (!provider || !route.modelId) {
        var msg = "尚未配置 AI 服务，请先在设置面板中添加提供商并选择模型";
        if (handlers.onError) handlers.onError(msg);
        return { cancel: function () {} };
      }

      var prompt = MNIATPrompts.build(promptKind, text);
      var config = MNIATSettings.load();
      var useStream = config.streamMode !== false;

      if (useStream) {
        return runSimulatedStreaming(provider, route, prompt, handlers);
      }
      runOnce(provider, route, prompt, handlers);
      return { cancel: function () {} };
    },

    // 打字机模拟（AI 翻译/解释与机器翻译共用）：
    //   把完整文本按 tick 分批推送 handlers.onDelta(delta, accumulated)，
    //   播完回调 handlers.onDone(accumulated)；返回 { cancel() }。
    //   机器翻译（TranslateFlow.runMachineTranslate）在 streamMode 开启时复用，
    //   与 AI 走同一 delta 事件通道，前端打字机效果与卡片高度渐进增长一致。
    simulateTyping: simulateTyping,

    // 连通性测试：最小请求验证 baseURL/apiKey/model 可用。
    // probeReasoning=true 时，连通后再发一次带思考参数的请求探测模型是否支持思考，
    // 返回 supportsReasoning: true | false | null（null = 无法判断，如 429/5xx/超时）。
    // 返回 latencyMs：整个测试过程耗时（毫秒，含探测请求；失败/超时也返回实际耗时）。
    test: function (provider, modelId, probeReasoning) {
      var self = this;
      var t0 = Date.now();
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
        var connectMs = Date.now() - t0;
        if (res.status >= 200 && res.status < 300) {
          if (!probeReasoning) {
            return { ok: true, status: res.status, supportsReasoning: null, latencyMs: connectMs };
          }
          // 思考能力探测：多一次带思考参数的请求
          return MNNetwork.fetch(endpointOf(provider), {
            method: "POST",
            headers: headersOf(provider),
            json: self.buildProbeBody(provider, modelId),
            timeout: 15
          }).then(function (res2) {
            var totalMs = Date.now() - t0;
            if (res2.status >= 200 && res2.status < 300) {
              return { ok: true, status: res.status, supportsReasoning: true, latencyMs: totalMs };
            }
            var msg = extractError(res2.status, res2);
            var detected = self.detectReasoningFromError(msg);
            return { ok: true, status: res.status, supportsReasoning: detected, probeMessage: msg, latencyMs: totalMs };
          });
        }
        return { ok: false, status: res.status, message: extractError(res.status, res), latencyMs: connectMs };
      }).catch(function (err) {
        // 网络层错误（含 -1012 认证被取消）→ 转为可读结果，避免设置页显示裸错误
        return { ok: false, status: 0, message: errorText(err), latencyMs: Date.now() - t0 };
      });
    },

    // 思考能力探测请求体（按厂商风格选择参数；与 buildReasoningBody 保持同一套规则）
    buildProbeBody: function (provider, modelId) {
      var body = {
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false
      };
      // 用 high 作为探测强度（最强信号，能区分支持/不支持）
      // kimi-k3 + high → reasoning_effort: high；kimi-k2.7-code → 始终 enabled；其它分支见 buildReasoningBody
      var probeRoute = { reasoningEffort: "high", temperature: 0 };
      Object.assign(body, buildReasoningBody(provider, modelId, probeRoute));
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
      var base = String(baseURL || "").trim().replace(/\/+$/, "");
      if (isOllamaStyle({ baseURL: base })) {
        // Ollama OpenAI 兼容模型列表端点为 /v1/models（与 endpointOf 同一套转换规则）
        if (/\/api$/.test(base)) base = base.replace(/\/api$/, "");
        if (!/\/v1$/.test(base)) base = base + "/v1";
      }
      var url = base + "/models";
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
