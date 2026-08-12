// AliyunMachineTranslateService.js —— 阿里云机器翻译（RPC 风格，POP API）
// 接口（Version=2018-10-12，endpoint mt.cn-hangzhou.aliyuncs.com）：
//   TranslateGeneral —— 机器翻译通用版（Scene 固定 general）
//   Translate       —— 机器翻译专业版（Scene: title/description/communication/medical/social/finance）
// 鉴权：RPC 签名（AccessKeyId/AccessKeySecret），无需 APPID：
//   1) 公共参数 + 业务参数合并，按 key 字典序排序（排除 Signature）
//   2) 每个 key/value 按 RFC3986 percentEncode（UTF-8；空格 %20、* %2A、~ 保留）
//   3) CanonicalizedQueryString = k1=v1&k2=v2...
//   4) StringToSign = "POST&" + percentEncode("/") + "&" + percentEncode(CanonicalizedQueryString)
//   5) Signature = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))
//   6) 请求：POST，全部参数（含 Signature）放 URL query string（与官方 SDK 行为一致）
// 签名工具：MNIATSHA1.hmacBase64（纯 JS SHA1/HMAC，见 SHA1.js）。
// 说明：SourceLanguage 传 auto（接口支持自动识别，响应 Data.DetectedLanguage 返回识别结果）。

var MNIATAliyunMT = (function () {
  "use strict";

  var ENDPOINT = "https://mt.cn-hangzhou.aliyuncs.com/";
  var VERSION = "2018-10-12";

  // 目标语言码映射：插件配置值 → 阿里云语言 code（阿里云基本同 ISO，仅兜底）
  function langCodeOf(tl) {
    var m = {
      "zh-CN": "zh",
      "zh-TW": "zh-TW",
      en: "en",
      ja: "ja",
      ko: "ko"
    };
    var key = String(tl || "");
    return m[key] || "en";
  }

  // RFC3986 percentEncode（与阿里云 RPC 文档一致）
  function percentEncode(str) {
    var s = encodeURIComponent(String(str));
    // encodeURIComponent 不编码 ! ' ( ) * ~ —— 按阿里云 RFC3986 percentEncode 需全部编码：
    // 只保留 A-Z a-z 0-9 - _ . ~（~ 保持字面），其余字符一律 %XX。
    // 教训（2026-08-13 实测）：漏掉 ( ) 会让含括号的文本（如 Poly(MMA)）签名不匹配
    // （服务器按完整 RFC3986 重算，把括号编码为 %28%29，与字面括号不一致 → SignatureDoesNotMatch）。
    return s
      .replace(/!/g, "%21")
      .replace(/'/g, "%27")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/\*/g, "%2A")
      .replace(/%7E/g, "~");
  }

  // UTC ISO8601：yyyy-MM-ddTHH:mm:ssZ
  function utcTimestamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      "T" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "Z";
  }

  // 签名随机数（防重放，每次请求不同）
  function signatureNonce() {
    return String(Date.now()) + "-" + Math.random().toString(16).slice(2, 10);
  }

  // 构造 CanonicalizedQueryString（排序 + percentEncode，排除 Signature）
  function canonicalQueryString(params) {
    var keys = [];
    for (var k in params) {
      if (k === "Signature") continue;
      if (params[k] === undefined || params[k] === null || params[k] === "") continue;
      keys.push(k);
    }
    keys.sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(percentEncode(keys[i]) + "=" + percentEncode(String(params[keys[i]])));
    }
    return parts.join("&");
  }

  // 计算签名
  function computeSignature(accessKeySecret, method, canonicalQS) {
    var stringToSign = method + "&" + percentEncode("/") + "&" + percentEncode(canonicalQS);
    return MNIATSHA1.hmacBase64(String(accessKeySecret) + "&", stringToSign);
  }

  // 通用请求：拼公共参数 + 业务参数 → 签名 → POST query
  function request(action, biz, accessKeyId, accessKeySecret) {
    var params = {
      Action: action,
      Version: VERSION,
      Format: "JSON",
      AccessKeyId: String(accessKeyId).trim(),
      SignatureMethod: "HMAC-SHA1",
      SignatureNonce: signatureNonce(),
      SignatureVersion: "1.0",
      Timestamp: utcTimestamp()
    };
    for (var k in biz) params[k] = biz[k];

    var canonicalQS = canonicalQueryString(params);
    var signature = computeSignature(accessKeySecret, "POST", canonicalQS);
    var url = ENDPOINT + "?" + canonicalQS + "&Signature=" + percentEncode(signature);

    return MNNetwork.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      timeout: 30
    }).then(function (res) {
      var data = null;
      try {
        data = res.json();
      } catch (e) {
        data = null;
      }
      if (!data || typeof data !== "object") {
        throw new Error("阿里云翻译返回异常（HTTP " + res.status + "）");
      }
      // 成功判定：Code 为 200。JSCore 桥接下 Code 可能是数字 200、字符串 "200"
      // 或 NSNumber 对象，必须宽松比较（严格 === 会误判成功为失败 → "未知错误（错误码 200）"）。
      var codeOk = data.Code == 200 || String(data.Code) === "200";
      if (!codeOk) {
        var errMsg = "";
        if (data.Message !== null && data.Message !== undefined && !(data.Message instanceof NSNull)) {
          errMsg = String(data.Message);
        }
        var codeStr = (data.Code !== null && data.Code !== undefined) ? String(data.Code) : "";
        throw new Error("阿里云翻译失败：" + (errMsg || "未知错误") +
          (codeStr ? "（错误码 " + codeStr + "）" : ""));
      }
      var translated = data.Data && data.Data.Translated ? String(data.Data.Translated) : "";
      if (!translated || translated.trim().length === 0) {
        throw new Error("阿里云翻译返回为空，请稍后重试");
      }
      return {
        text: translated,
        from: (data.Data && data.Data.DetectedLanguage) ? String(data.Data.DetectedLanguage) : "auto",
        to: String(biz.TargetLanguage || "")
      };
    });
  }

  return {
    // 机器翻译入口
    // opts: {
    //   apiType: "general" | "pro",
    //   scene:   专业版场景（title/description/communication/medical/social/finance；通用版忽略）
    //   accessKeyId, accessKeySecret,
    //   targetLang（插件语言配置值，如 zh-CN/en）
    // }
    translate: function (text, opts) {
      var q = String(text).trim();
      if (!q) return Promise.reject(new Error("待翻译文本为空"));
      if (!opts || !opts.accessKeyId || !opts.accessKeySecret) {
        return Promise.reject(new Error("请先设置阿里云 AccessKey ID 与 AccessKey Secret"));
      }
      var accessKeyId = String(opts.accessKeyId).trim();
      var accessKeySecret = String(opts.accessKeySecret).trim();
      if (!accessKeyId || !accessKeySecret) {
        return Promise.reject(new Error("请先设置阿里云 AccessKey ID 与 AccessKey Secret"));
      }

      var apiType = opts.apiType === "pro" ? "pro" : "general";
      var targetLang = langCodeOf(opts.targetLang);

      var biz = {
        FormatType: "text",
        SourceLanguage: "auto",   // 自动识别原文语言
        TargetLanguage: targetLang,
        SourceText: q
      };

      if (apiType === "pro") {
        // 专业版：Scene 必填（title/description/communication/medical/social/finance）
        biz.Scene = String(opts.scene || "title").trim() || "title";
        return request("Translate", biz, accessKeyId, accessKeySecret);
      }
      // 通用版：Scene 固定 general
      biz.Scene = "general";
      return request("TranslateGeneral", biz, accessKeyId, accessKeySecret);
    }
  };
})();
