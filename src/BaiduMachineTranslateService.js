// BaiduMachineTranslateService.js —— 百度翻译开放平台 · 机器翻译服务
// 接入三种接口（2026-08-13 依据官方文档 fanyi-api.baidu.com/doc/21/23/24 实现）：
//   1. 大模型文本翻译  POST https://fanyi-api.baidu.com/ait/api/aiTextTranslate
//        sign = md5(appid + q + salt + 密钥)；可选 model_type='llm'|'nmt'（默认 llm）
//   2. 通用文本翻译    POST https://fanyi-api.baidu.com/api/trans/vip/translate
//        sign = md5(appid + q + salt + 密钥)
//   3. 领域文本翻译    POST https://fanyi-api.baidu.com/api/trans/vip/fieldtranslate
//        sign = md5(appid + q + salt + domain + 密钥)   ← 注意 domain 参与签名
// 共同约定：
//   - Content-Type: application/x-www-form-urlencoded，统一 UTF-8
//   - q 生成签名时不做 URL encode；发送请求时才 encode（否则 54001 签名错误）
//   - from 支持 auto（自动检测），to 不可为 auto
//   - 响应统一 { from, to, trans_result: [{src, dst}] }；异常 { error_code, error_msg }
// 依赖：MNIATMD5（src/MD5.js，JSCore 无内置 MD5）
// 说明：本文件只做「机器翻译」请求与解析，UI/路由/缓存由 SettingsStore / TranslateFlow 负责。

var MNIATBaiduMT = (function () {
  var ENDPOINT_LLM = "https://fanyi-api.baidu.com/ait/api/aiTextTranslate";
  var ENDPOINT_STANDARD = "https://fanyi-api.baidu.com/api/trans/vip/translate";
  var ENDPOINT_DOMAIN = "https://fanyi-api.baidu.com/api/trans/vip/fieldtranslate";

  // 领域翻译支持范围（官方 doc/24）：value 为接口 domain 参数
  var DOMAINS = [
    { value: "it", label: "信息技术" },
    { value: "finance", label: "金融财经" },
    { value: "machinery", label: "机械制造" },
    { value: "senimed", label: "生物医药" },
    { value: "novel", label: "网络文学" },
    { value: "academic", label: "学术论文" },
    { value: "aerospace", label: "航空航天" },
    { value: "wiki", label: "人文社科" },
    { value: "news", label: "新闻资讯" },
    { value: "law", label: "法律法规" },
    { value: "contract", label: "合同" }
  ];

  // 插件目标语言 → 百度语种代码（插件常规页 TARGET_LANGS：zh-CN/zh-TW/en/ja/ko）
  var LANG_MAP = {
    "zh-CN": "zh",
    "zh-TW": "cht",
    "en": "en",
    "ja": "jp",
    "ko": "kor"
  };

  function langCodeOf(targetLang) {
    var code = LANG_MAP[String(targetLang || "")];
    return code || "zh";
  }

  // 拼接 form-urlencoded body（所有参数统一 encode，q 在此处才编码）
  function buildForm(params) {
    var parts = [];
    for (var k in params) {
      if (params[k] === undefined || params[k] === null || params[k] === "") continue;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])));
    }
    return parts.join("&");
  }

  // 统一发请求 + 解析：成功 resolve 文本，失败 reject Error（含百度 error_code/msg）
  function request(endpoint, params) {
    return MNNetwork.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: buildForm(params),
      timeout: 20
    }).then(function (res) {
      var obj = res.json();
      if (!obj || typeof obj !== "object") {
        throw new Error("百度翻译响应解析失败（HTTP " + res.status + "）");
      }
      if (obj.error_code && obj.error_code !== "52000") {
        var code = String(obj.error_code);
        var msg = String(obj.error_msg || "未知错误");
        // 常见错误附解决方案提示（官方错误码表）
        if (code === "54001") msg += "（检查签名/密钥是否正确）";
        if (code === "52003") msg += "（检查 APPID 是否正确、是否已开通对应服务）";
        if (code === "54004") msg += "（账户余额不足）";
        if (code === "58001") msg += "（语言方向不支持）";
        if (code === "54003") msg += "（访问频率受限，请降低调用频率）";
        throw new Error("百度翻译错误 " + code + "：" + msg);
      }
      var trs = obj.trans_result;
      if (!Array.isArray(trs) || trs.length === 0 || !trs[0] || !trs[0].dst) {
        throw new Error("百度翻译返回为空");
      }
      return { text: String(trs[0].dst), from: obj.from, to: obj.to };
    });
  }

  // 对外统一入口
  // opts: { apiType: "llm"|"standard"|"domain", domain, appid, secretKey, targetLang }
  // 返回 Promise<{ text, from, to }>
  function translate(text, opts) {
    var q = String(text || "").trim();
    if (!q) return Promise.reject(new Error("待翻译文本为空"));
    if (!opts || !opts.appid || !opts.secretKey) {
      return Promise.reject(new Error("请先在设置中填写百度翻译 APPID 与密钥"));
    }

    var appid = String(opts.appid).trim();
    var secret = String(opts.secretKey).trim();
    var salt = String(Math.floor(Date.now() / 1000)) + String(Math.floor(Math.random() * 100000));
    var from = "auto";
    var to = langCodeOf(opts.targetLang);
    var apiType = opts.apiType === "domain" ? "domain" :
      (opts.apiType === "llm" ? "llm" : "standard");

    if (apiType === "domain") {
      var domain = String(opts.domain || "it").trim() || "it";
      var signD = MNIATMD5.hex(appid + q + salt + domain + secret);
      return request(ENDPOINT_DOMAIN, {
        q: q, from: from, to: to, appid: appid, salt: salt, domain: domain, sign: signD
      });
    }

    var sign = MNIATMD5.hex(appid + q + salt + secret);
    if (apiType === "llm") {
      return request(ENDPOINT_LLM, {
        q: q, from: from, to: to, appid: appid, salt: salt, sign: sign,
        model_type: "llm"
      });
    }
    return request(ENDPOINT_STANDARD, {
      q: q, from: from, to: to, appid: appid, salt: salt, sign: sign
    });
  }

  return {
    translate: translate,
    domains: DOMAINS,
    langCodeOf: langCodeOf
  };
})();
