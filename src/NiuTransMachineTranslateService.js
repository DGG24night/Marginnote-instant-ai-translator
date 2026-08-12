// NiuTransMachineTranslateService.js —— 小牛翻译开放平台 · 机器翻译服务
// 接入两种产品（2026-08-13 依据官方文档 niutrans.com/documents/contents/transapi_text_v2 实现）：
//   1. 通用文本 Flash（高并发低延迟）：
//        POST https://api.niutrans.com/v2/text/translate
//        鉴权：appId + timestamp + authStr
//        authStr = md5(paramStr)，paramStr 由「apikey + 各参数按参数名 ASCII 码升序拼接」
//        组成（apikey=xxx&appId=xxx&from=xxx&srcText=xxx&timestamp=xxx&to=xxx）。
//        注意：空参数不参与；authStr 自身不参与。
//   2. 通用文本 Pro（大模型 / LLM，强上下文理解）：
//        POST https://api.niutrans.com/v2/text/translate/llm
//        鉴权：直接在 JSON 中传 apikey 字段（无需 appId/timestamp/authStr）
// 共同约定：
//   - Flash 支持 application/x-www-form-urlencoded 与 application/json；
//     Pro 仅支持 application/json
//   - srcText 必须 UTF-8 编码；单次请求长度 ≤ 5000 字符
//   - from 支持 auto（自动识别源语）；返回 JSON：{ from, to, tgtText }
// 依赖：MNIATMD5（src/MD5.js）
// 说明：本文件只做「机器翻译」请求与解析，UI/路由/缓存由 SettingsStore / TranslateFlow 负责。

var MNIATNiuTrans = (function () {
  var ENDPOINT_FLASH = "https://api.niutrans.com/v2/text/translate";
  var ENDPOINT_PRO = "https://api.niutrans.com/v2/text/translate/llm";

  // 插件目标语言 → 小牛语种代码（小牛：zh=简体、cht=繁体、en、ja、ko）
  var LANG_MAP = {
    "zh-CN": "zh",
    "zh-TW": "cht",
    "en": "en",
    "ja": "ja",
    "ko": "ko"
  };

  function langCodeOf(targetLang) {
    var code = LANG_MAP[String(targetLang || "")];
    return code || "zh";
  }

  // 拼接 form-urlencoded body（Flash 走 form 时用；JSON 走 body 字符串）
  function buildForm(params) {
    var parts = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === "") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    }
    return parts.join("&");
  }

  // Flash 鉴权串生成：apikey + 参与参数（空值剔除、authStr 不参与）按参数名 ASCII 升序拼接
  // 官方规则示例（paramStr）：
  //   apikey=a3a5c0e35bd5382fd85e9efb30c6d218&appId=YcW1740708102939&from=zh&srcText=...&timestamp=1689564909&to=en
  function buildAuthStr(apikey, params) {
    var keys = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === "") continue;
      keys.push(k);
    }
    keys.sort(); // 参数名 ASCII 升序
    var seg = "apikey=" + apikey;
    for (var i = 0; i < keys.length; i++) {
      seg += "&" + keys[i] + "=" + params[keys[i]];
    }
    return MNIATMD5.hex(seg);
  }

  // 统一发请求 + 解析：成功 resolve 文本，失败 reject Error（含小牛 errorCode/errorMsg）
  function request(endpoint, body, contentType) {
    return MNNetwork.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Accept": "application/json"
      },
      body: body,
      timeout: 20
    }).then(function (res) {
      var obj = res.json();
      if (!obj || typeof obj !== "object") {
        throw new Error("小牛翻译响应解析失败（HTTP " + res.status + "）");
      }
      if (obj.errorCode && obj.errorCode !== "000000") {
        var code = String(obj.errorCode);
        var msg = String(obj.errorMsg || "未知错误");
        throw new Error("小牛翻译错误 " + code + "：" + msg);
      }
      var tgt = obj.tgtText;
      if (tgt === undefined || tgt === null || String(tgt).trim() === "") {
        throw new Error("小牛翻译返回为空");
      }
      return { text: String(tgt), from: obj.from, to: obj.to };
    });
  }

  // 对外统一入口
  // opts: { apiType: "flash"|"pro", appid, secretKey, targetLang }
  // 返回 Promise<{ text, from, to }>
  function translate(text, opts) {
    var q = String(text || "").trim();
    if (!q) return Promise.reject(new Error("待翻译文本为空"));
    if (!opts || !opts.secretKey) {
      return Promise.reject(new Error("请先在设置中填写小牛翻译 API Key"));
    }

    var apikey = String(opts.secretKey).trim();
    var from = "auto";
    var to = langCodeOf(opts.targetLang);
    var apiType = opts.apiType === "pro" ? "pro" : "flash";

    if (apiType === "pro") {
      // Pro：JSON body，直接带 apikey，无 appId/authStr/timestamp
      var proBody = JSON.stringify({
        from: from,
        to: to,
        srcText: q,
        apikey: apikey
      });
      return request(ENDPOINT_PRO, proBody, "application/json");
    }

    // Flash：需要 appId + timestamp + authStr
    var appId = String(opts.appid || "").trim();
    if (!appId) {
      return Promise.reject(new Error("小牛翻译 Flash 需要 APPID，请在设置中填写"));
    }
    var params = {
      from: from,
      to: to,
      srcText: q,
      appId: appId,
      timestamp: String(Date.now())
    };
    params.authStr = buildAuthStr(apikey, params);
    return request(ENDPOINT_FLASH, buildForm(params), "application/x-www-form-urlencoded");
  }

  return {
    translate: translate,
    langCodeOf: langCodeOf
  };
})();
