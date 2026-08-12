// TencentMachineTranslateService.js —— 腾讯云机器翻译（TMT，API 3.0，TC3-HMAC-SHA256 签名）
// 接口：TextTranslate（tmt.tencentcloudapi.com，Version=2018-03-21）
//   业务参数：SourceText（必填）、Source（必填，支持 auto 自动识别）、Target（必填）、ProjectId（默认 0）
//   响应：{ Response: { TargetText, Source, Target, RequestId, Error?: {Code, Message} } }
// 鉴权：TC3-HMAC-SHA256（SecretId/SecretKey，无 APPID）：
//   1) CanonicalRequest = POST\n/\n\n<canonicalHeaders>\n<signedHeaders>\n<hashedPayload>
//      canonicalHeaders = content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\nx-tc-action:texttranslate\n
//      signedHeaders = content-type;host;x-tc-action（最小集合，官方 POST 示例验证）
//      hashedPayload = 小写 hex(SHA256(请求体 JSON 字符串))
//   2) StringToSign = TC3-HMAC-SHA256\n<timestamp>\n<date>/tmt/tc3_request\n<hashedCanonical>
//   3) SecretDate = HMAC-SHA256("TC3"+SecretKey, date)；SecretService = HMAC(SecretDate, "tmt")；
//      SecretSigning = HMAC(SecretService, "tc3_request")；Signature = hex(HMAC(SecretSigning, StringToSign))
//   4) Authorization = TC3-HMAC-SHA256 Credential=<SecretId>/<credentialScope>, SignedHeaders=..., Signature=...
// 签名工具：MNIATSHA256（纯 JS SHA256/HMAC，见 SHA256.js）。
// 关键点：
//   - 签名用 JSON.stringify 生成的 payload 字符串，发送时用 options.body（UTF-8 字节）——
//     保证「签名串 = 实际发送 body」，否则服务器哈希比对失败（AuthFailure.SignatureFailure）。
//   - date 必须为 UTC+0 日期（从时间戳换算，勿用本地时区，凌晨会签名失败）。
//   - 语言码：zh-CN→zh、zh-TW→zh-TW、en→en、ja→ja、ko→ko；其余按原值透传。

var MNIATTencentMT = (function () {
  "use strict";

  var ENDPOINT = "https://tmt.tencentcloudapi.com/";
  var HOST = "tmt.tencentcloudapi.com";
  var SERVICE = "tmt";
  var ACTION = "TextTranslate";
  var VERSION = "2018-03-21";
  var REGION = "ap-guangzhou";      // TMT 支持地域（仅请求头，不参与签名）

  // 目标语言码映射：插件配置值 → 腾讯云语言 code
  function langCodeOf(tl) {
    var m = {
      "zh-CN": "zh",
      "zh-TW": "zh-TW",
      en: "en",
      ja: "ja",
      ko: "ko"
    };
    var key = String(tl || "");
    return m[key] || key || "en";
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // 当前 UTC 时间戳（秒）与 UTC 日期（TC3 的 date 必须 UTC+0）
  function nowUtc() {
    var d = new Date();
    return {
      timestamp: String(Math.floor(d.getTime() / 1000)),
      date: d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate())
    };
  }

  // TC3-HMAC-SHA256：计算 Authorization 头
  function computeAuthorization(secretId, secretKey, timestamp, date, payload) {
    var contentType = "application/json; charset=utf-8";
    var canonicalHeaders = "content-type:" + contentType + "\n" +
      "host:" + HOST + "\n" +
      "x-tc-action:" + ACTION.toLowerCase() + "\n";
    var signedHeaders = "content-type;host;x-tc-action";
    var hashedPayload = MNIATSHA256.hex(payload);
    var canonicalRequest = "POST\n/\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + hashedPayload;
    var hashedCanonical = MNIATSHA256.hex(canonicalRequest);
    var credentialScope = date + "/" + SERVICE + "/tc3_request";
    var stringToSign = "TC3-HMAC-SHA256\n" + timestamp + "\n" + credentialScope + "\n" + hashedCanonical;

    var secretDate = MNIATSHA256.hmacBytes(MNIATSHA256.toBytes("TC3" + String(secretKey)), date);
    var secretService = MNIATSHA256.hmacBytes(secretDate, SERVICE);
    var secretSigning = MNIATSHA256.hmacBytes(secretService, "tc3_request");
    var signature = MNIATSHA256.bytesToHex(MNIATSHA256.hmacBytes(secretSigning, stringToSign));

    return "TC3-HMAC-SHA256 Credential=" + String(secretId) + "/" + credentialScope +
      ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
  }

  // 通用请求：构造业务参数 → 签名 → POST JSON
  function request(biz, secretId, secretKey) {
    var payload = JSON.stringify(biz);   // 签名与发送共用同一字符串
    var now = nowUtc();
    var authorization = computeAuthorization(secretId, secretKey, now.timestamp, now.date, payload);

    return MNNetwork.fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": authorization,
        "Content-Type": "application/json; charset=utf-8",
        "Host": HOST,
        "X-TC-Action": ACTION,
        "X-TC-Timestamp": now.timestamp,
        "X-TC-Version": VERSION,
        "X-TC-Region": REGION
      },
      body: payload,   // options.body → UTF-8 字节，与签名 payload 完全一致
      timeout: 30
    }).then(function (res) {
      var data = null;
      try {
        data = res.json();
      } catch (e) {
        data = null;
      }
      if (!data || typeof data !== "object") {
        throw new Error("腾讯云翻译返回异常（HTTP " + res.status + "）");
      }
      // 腾讯云响应包裹在 Response 字段；成功时无 Error（可能为 undefined/null/NSNull）
      var resp = (data.Response && typeof data.Response === "object") ? data.Response : data;
      var err = resp.Error;
      var hasErr = err !== null && err !== undefined && !(err instanceof NSNull);
      if (hasErr) {
        var codeStr = (err.Code !== null && err.Code !== undefined && !(err.Code instanceof NSNull))
          ? String(err.Code) : "";
        var msgStr = (err.Message !== null && err.Message !== undefined && !(err.Message instanceof NSNull))
          ? String(err.Message) : "";
        throw new Error("腾讯云翻译失败：" + (msgStr || "未知错误") +
          (codeStr ? "（错误码 " + codeStr + "）" : ""));
      }
      var translated = (resp.TargetText !== null && resp.TargetText !== undefined &&
        !(resp.TargetText instanceof NSNull)) ? String(resp.TargetText) : "";
      if (!translated || translated.trim().length === 0) {
        throw new Error("腾讯云翻译返回为空，请稍后重试");
      }
      return {
        text: translated,
        from: (resp.Source !== null && resp.Source !== undefined && !(resp.Source instanceof NSNull))
          ? String(resp.Source) : "auto",
        to: String(biz.Target || "")
      };
    });
  }

  return {
    // 机器翻译入口（腾讯 TMT 仅一个文本翻译接口，apiType 固定 "text"）
    // opts: {
    //   secretId, secretKey,          // 腾讯云 API 密钥（SecretId/SecretKey）
    //   targetLang（插件语言配置值，如 zh-CN/en）
    // }
    translate: function (text, opts) {
      var q = String(text).trim();
      if (!q) return Promise.reject(new Error("待翻译文本为空"));
      if (!opts || !opts.secretId || !opts.secretKey) {
        return Promise.reject(new Error("请先设置腾讯云 SecretId 与 SecretKey"));
      }
      var secretId = String(opts.secretId).trim();
      var secretKey = String(opts.secretKey).trim();
      if (!secretId || !secretKey) {
        return Promise.reject(new Error("请先设置腾讯云 SecretId 与 SecretKey"));
      }

      var biz = {
        SourceText: q,
        Source: "auto",              // 自动识别原文语言
        Target: langCodeOf(opts.targetLang),
        ProjectId: 0
      };
      return request(biz, secretId, secretKey);
    }
  };
})();
