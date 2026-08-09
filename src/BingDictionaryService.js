// BingDictionaryService.js —— 必应词典查词（免费 web 接口，无需 key）
// 接口：https://cn.bing.com/dict/search?q=<word>&mkt=zh-CN （服务端渲染 HTML，正则解析）
// 发音：https://cn.bing.com/dict/mediamp3?blob=... （页面 data-mp3link，直接 <audio> 播放）
// 说明：必应早年开放的 clientsearch JSON 接口已失效（2026-08-09 实测返回页面壳），
//       故改为解析 dict/search 页面的 qdef 区块；结构多年稳定，解析做了防御性兜底。

var MNIATBing = (function () {

  function searchURL(word) {
    return "https://cn.bing.com/dict/search?q=" + encodeURIComponent(word) + "&mkt=zh-CN";
  }

  function fullURL(path) {
    if (!path) return "";
    if (path.indexOf("http") === 0) return path;
    return "https://cn.bing.com" + path;
  }

  // 解码常见 HTML 实体（JSCore 无 DOM，手工替换）
  function decodeEntities(s) {
    return String(s || "")
      .replace(/&#160;/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function stripTags(s) {
    return String(s || "").replace(/<[^>]*>/g, "");
  }

  // 从 dict/search 页面 HTML 提取结构化词条
  // 实测结构（2026-08-09 curl 验证）：
  //   <div class="qdef"><div class="hd_area"><h1><strong>hello</strong></h1>
  //   <div class="hd_prUS b_primtxt">美 [heˈləʊ] </div>         ← 美音
  //   <div class="hd_pr b_primtxt">英国 [həˈləʊ] </div>         ← 英音
  //   <a id="bigaud_us" data-mp3link="/dict/mediamp3?blob=..."> ← 英美发音 mp3（顺序：美、英）
  //   <li><span class="pos">int.</span><span class="def b_regtxt"><a>你好</a><span>；</span>...</span></li>
  function parseResult(html, word) {
    if (!html || typeof html !== "string") return null;

    // 解析范围限定在 qdef 区块（含词头/音标/释义），
    // 避免页面其他位置同名 class（如 <script> 内嵌数据）干扰正则匹配
    var region = html;
    var qi = html.indexOf('class="qdef"');
    if (qi >= 0) region = html.slice(qi, qi + 20000);

    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      translations: []   // [{pos, meaning}]
    };

    // 词头（兜底用，通常直接用选中词）
    var wm = region.match(/<h1><strong>([^<]+)<\/strong><\/h1>/);
    if (wm && wm[1] && wm[1].trim()) result.word = wm[1].trim();

    // 音标（注意 class 前缀匹配，避免 `hd_pr` 同时命中 `hd_prUS`）
    var m = region.match(/<div class="hd_prUS b_primtxt">[^[]*\[([^\]]*)\]/);
    if (m) result.usphone = m[1].trim();
    m = region.match(/<div class="hd_pr b_primtxt">[^[]*\[([^\]]*)\]/);
    if (m) result.ukphone = m[1].trim();

    // 发音 mp3（区块内顺序：美音 bigaud_us 在前，英音 bigaud_uk 在后）
    var mp3s = [];
    var re = /data-mp3link="([^"]+)"/g;
    var mm;
    while ((mm = re.exec(region)) !== null) mp3s.push(mm[1]);
    var usMp3 = mp3s.length > 0 ? fullURL(mp3s[0]) : "";
    var ukMp3 = mp3s.length > 1 ? fullURL(mp3s[1]) : "";
    result.usMp3 = usMp3 || ukMp3;
    result.ukMp3 = ukMp3 || usMp3;

    // 释义：逐条 <li>，词性在 <span class="pos...">，释义为 <a> 链接文本（含「；」分隔）
    var hasRealDef = false; // 是否存在非「网络」词性的真实释义
    var liRe = /<li><span class="pos[^"]*">([^<]*)<\/span><span class="def b_regtxt">([\s\S]*?)<\/span><\/li>/g;
    var lm;
    while ((lm = liRe.exec(region)) !== null) {
      var pos = stripTags(lm[1]).trim();
      if (pos && pos !== "网络") hasRealDef = true;
      var defHtml = lm[2];
      var defs = [];
      var aRe = /<a[^>]*>([\s\S]*?)<\/a>/g;
      var am;
      while ((am = aRe.exec(defHtml)) !== null) {
        var t = stripTags(am[1]).trim();
        if (t) defs.push(decodeEntities(t));
      }
      if (defs.length === 0) {
        // 无链接时取整段纯文本
        var plain = decodeEntities(stripTags(defHtml)).trim();
        if (plain) defs.push(plain);
      }
      defs.forEach(function (d) {
        result.translations.push({ pos: pos, meaning: d });
      });
    }

    // 未找到判定：没有音标且没有真实词性释义（仅剩「网络」释义）→ 视为未收录
    if (!hasRealDef && !result.ukphone && !result.usphone) {
      return null;
    }
    return result;
  }

  return {
    // 返回 Promise<result>，result 结构见 parseResult（含 ukMp3/usMp3 发音链接）
    lookup: function (word) {
      return MNNetwork.fetch(searchURL(word), {
        method: "GET",
        timeout: 12,
        headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) {
          throw new Error("必应词典接口 HTTP " + res.status);
        }
        var parsed = parseResult(res.text(), word);
        if (!parsed) {
          throw new Error("未找到该单词的释义");
        }
        return parsed;
      });
    }
  };
})();
