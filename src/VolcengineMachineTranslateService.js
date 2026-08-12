// VolcengineMachineTranslateService.js —— 火山引擎机器翻译（TranslateText，v4 HMAC-SHA256 签名）
// 接口：POST https://translate.volcengineapi.com/?Action=TranslateText&Version=2020-06-01
//   headers: Host + X-Date + Content-Type + Authorization
//   body (JSON): { SourceLanguage?, TargetLanguage, TextList: [string] }
// 签名（v4）：
//   1) CanonicalRequest = HTTPMethod\nURI\nQueryString\nCanonicalHeaders\nSignedHeaders\nHex(SHA256(payload))
//   2) StringToSign = HMAC-SHA256\nX-Date\nYYYYMMDD/region/service/request\nHex(SHA256(CanonicalRequest))
//   3) 派生密钥：kDate=HMAC(secret_utf8,date) → kRegion=HMAC(kDateB,region) → kService=HMAC(kRegionB,service) → kSigning=HMAC(kServiceB,"request")
//      （实测官方示例：kDate 以 hex 字符串传出，但下一步 HMAC 传入的是 hex 解码后的 32 字节二进制，而非 hex 字符串的 UTF-8 编码）
//   4) Signature = hex(HMAC(kSigningB, StringToSign))
//   5) Authorization = HMAC-SHA256 Credential=Akid/YYYYMMDD/region/service/request, SignedHeaders=host;x-date, Signature=...
//
// 业务参数（火山特有）：
//   TextList 是数组（长度 ≤ 16，总字符 ≤ 5000）；SourceLanguage 未指定时自动检测
// 响应：{ TranslationList: [{ Translation, DetectedSourceLanguage }], ResponseMetadata: { RequestId, Error: {Code, Message} | null } }

var MNIATVolcengineMT = (function () {
  "use strict";

  var HOST = "translate.volcengineapi.com";
  var REGION = "cn-north-1";
  var SERVICE = "translate";
  var ACTION = "TranslateText";
  var VERSION = "2020-06-01";

  // 目标语言映射（火山 vs 百度/腾讯码表略有不同）
  // 火山官方文档：zh=中文/zh-Hant=繁体/auto=自动/en=英语/ja=日语/ko=韩语/fr/es/ru/de 等
  // 兼容前端语言码：zh-CN → zh，zh-TW → zh-Hant，其它透传
  function langOf(tl) {
    var s = String(tl || "");
    if (s === "zh-CN") return "zh";
    if (s === "zh-TW") return "zh-Hant";
    if (!s) return "zh";
    return s;
  }

  // 派生 + 签名（v4）。ts 为 UTC+0 ISO8601 字符串 "YYYYMMDDTHHMMSSZ"；
  // date 为同前缀的 "YYYYMMDD"；payloadStr 为请求体 JSON 字符串
  function signCanon(accessKey, secretKey, ts, date, query, payloadStr) {
    var secretUtf8 = MNIATSHA256.toBytes(secretKey);
    var kDate = MNIATSHA256.hmacBytes(secretUtf8, date);
    var kRegion = MNIATSHA256.hmacBytes(kDate, REGION);
    var kService = MNIATSHA256.hmacBytes(kRegion, SERVICE);
    var kSigning = MNIATSHA256.hmacBytes(kService, "request");

    // CanonicalHeaders：host 与 x-date 必须参与；火山 SDK 还会把 content-type/x-content-sha256 纳入，
    // 但官方文档正文示例 SignedHeaders 只有 host;x-date，故此处按最小集合保持一致
    var canonicalHeaders = "host:" + HOST + "\n" + "x-date:" + ts + "\n";
    var signedHeaders = "host;x-date";
    var hashedPayload = MNIATSHA256.hex(payloadStr || "");
    var canonicalRequest =
      "POST\n" +
      "/\n" +
      String(query || "") + "\n" +
      canonicalHeaders + "\n" +
      signedHeaders + "\n" +
      hashedPayload;
    var hashedCanonical = MNIATSHA256.hex(canonicalRequest);
    var scope = date + "/" + REGION + "/" + SERVICE + "/request";
    var stringToSign =
      "HMAC-SHA256\n" + ts + "\n" + scope + "\n" + hashedCanonical;
    var sigBytes = MNIATSHA256.hmacBytes(kSigning, stringToSign);
    var signature = MNIATSHA256.bytesToHex(sigBytes);
    var authorization =
      "HMAC-SHA256 Credential=" + accessKey + "/" + scope +
      ", SignedHeaders=" + signedHeaders +
      ", Signature=" + signature;
    return { authorization: authorization, signature: signature };
  }

  // 主入口：翻译文本。配置：{ accessKeyId, secretAccessKey, targetLang }
  // 返回：{ text, from, to }
  function translate(text, opts) {
    if (!opts || !opts.accessKeyId || !opts.secretAccessKey) {
      return Promise.reject(new Error("请先在设置「机器翻译服务」中填入火山引擎 AccessKey ID 与 SecretAccessKey"));
    }
    var q = String(text || "").trim();
    if (!q) return Promise.reject(new Error("待翻译文本为空"));

    // 时间戳：UTC+0 ISO8601 YYYYMMDDTHHMMSSZ
    // 注意：getTime() 返回的即 UTC 纪元毫秒，getUTC* 系列直接读取 UTC 时间；
    // 不要再加 getTimezoneOffset() 偏移（会把时间减去本地时区差，如中国 -8h → 服务器判定签名过期）
    var now = new Date();
    var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
    var ts = now.getUTCFullYear() +
      pad(now.getUTCMonth() + 1) +
      pad(now.getUTCDate()) + "T" +
      pad(now.getUTCHours()) +
      pad(now.getUTCMinutes()) +
      pad(now.getUTCSeconds()) + "Z";
    var date = ts.slice(0, 8); // YYYYMMDD

    var biz = {
      TargetLanguage: langOf(opts.targetLang),
      TextList: [q]
    };
    // 仅当调用方显式指定 sourceLang 时才下发 SourceLanguage；
    // 否则让火山自动检测（不传默认即自动）
    if (opts.sourceLang) {
      var src = langOf(opts.sourceLang);
      if (src && src !== "auto") biz.SourceLanguage = src;
    }

    var payloadStr = JSON.stringify(biz);
    var query = "Action=" + ACTION + "&Version=" + VERSION;
    var sig = signCanon(opts.accessKeyId, opts.secretAccessKey, ts, date, query, payloadStr);

    return MNNetwork.fetch("https://" + HOST + "/?" + query, {
      method: "POST",
      headers: {
        "Host": HOST,
        "X-Date": ts,
        "Content-Type": "application/json",
        "Authorization": sig.authorization
      },
      body: payloadStr,
      timeout: 20
    }).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        throw new Error("火山翻译 HTTP " + res.status);
      }
      return res.json();
    }).then(function (data) {
      if (!data || typeof data !== "object") {
        throw new Error("火山翻译返回异常");
      }
      var meta = data.ResponseMetadata;
      if (meta && meta.Error && meta.Error.Code) {
        throw new Error("火山翻译失败：" + (meta.Error.Message || meta.Error.Code));
      }
      var list = data.TranslationList || [];
      if (list.length === 0 || !list[0] || !list[0].Translation) {
        throw new Error("火山翻译返回为空，请稍后重试");
      }
      var first = list[0];
      return {
        text: String(first.Translation),
        from: first.DetectedSourceLanguage || biz.SourceLanguage || "auto",
        to: String(biz.TargetLanguage)
      };
    });
  }

  return { translate: translate };
})();
