// HaiCiDictionaryService.js —— 海词词典查词（免费 web 接口，无需 key）
// 接口：https://dict.cn/<word> （服务端渲染 HTML，正则解析）
// 发音：https://audio.dict.cn/<naudio>（页面 naudio 属性，fb/mb=英式女/男声，fu/mu=美式女/男声）
// 说明：
//   - dict.cn/ws.php（JSON）已不可用（302 后被拒）；
//   - dict.cn/mp3.php?q=<word> 对任何词都返回同一个固定音频（2026-08-09 实测 md5 相同，已废弃）；
//   - mini.php 移动端页无发音数据，故改用主站页面（结构多年稳定，含音标/发音/释义）。

var MNIATHaiCi = (function () {

  function pageURL(word) {
    return "https://dict.cn/" + encodeURIComponent(word);
  }

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

  // 从 dict.cn/<word> 页面 HTML 提取结构化词条
  // 实测结构（2026-08-09 curl 验证）：
  //   <h1 class="keyword">run</h1>
  //   <div class="phonetic"><span>英 <bdo lang="EN-US">[rʌn]</bdo>
  //     <i class="sound fsound" naudio="fbTd30K...mp3?t=run">…</i>  ← fb/mb = 英式（女/男声）
  //     <i class="sound" naudio="mbTd30K...mp3?t=run">…</i>
  //   <span>美 <bdo lang="EN-US">[rʌn]</bdo>
  //     <i class="sound fsound" naudio="fu...mp3?t=run">…</i>     ← fu/mu = 美式（女/男声）
  //   <ul class="dict-basic-ul"><li><span>v.</span><strong>跑；行驶；…</strong></li>…</ul>
  // 中文词兜底：<div class="phonetic"><span>[píng guǒ]</span>；释义 <div class="layout cn"><li><a>apple</a>
  function parseResult(html, word) {
    if (!html || typeof html !== "string") return null;

    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      translations: []   // [{pos, meaning}]
    };

    // 词头
    var wm = html.match(/class="keyword"\s*>([^<]+)</);
    if (wm && wm[1] && wm[1].trim()) result.word = wm[1].trim();

    // 音标（英/美）
    var m = html.match(/<span>\s*英\s*<bdo lang="EN-US">\[([^\]]+)\]<\/bdo>/);
    if (m) result.ukphone = m[1].trim();
    m = html.match(/<span>\s*美\s*<bdo lang="EN-US">\[([^\]]+)\]<\/bdo>/);
    if (m) result.usphone = m[1].trim();

    // 发音：naudio 哈希文件名 → https://audio.dict.cn/<file>（fb/mb=英式，fu/mu=美式）
    var naudios = [];
    var re = /naudio="([^"]+)"/g;
    var nm;
    while ((nm = re.exec(html)) !== null) naudios.push(nm[1]);
    var ukMp3 = "";
    var usMp3 = "";
    for (var i = 0; i < naudios.length; i++) {
      var n = naudios[i];
      var fn = n.split("?")[0];
      if (!ukMp3 && (n.indexOf("fb") === 0 || n.indexOf("mb") === 0)) {
        ukMp3 = "https://audio.dict.cn/" + fn;
      }
      if (!usMp3 && (n.indexOf("fu") === 0 || n.indexOf("mu") === 0)) {
        usMp3 = "https://audio.dict.cn/" + fn;
      }
    }
    result.ukMp3 = ukMp3 || usMp3;
    result.usMp3 = usMp3 || ukMp3;

    // 释义：dict-basic-ul 的 <li><span>词性</span><strong>多个释义；分隔</strong></li>
    var liRe = /<li>\s*<span>([^<]*)<\/span>\s*<strong>([\s\S]*?)<\/strong>/g;
    var lm;
    while ((lm = liRe.exec(html)) !== null) {
      var pos = stripTags(lm[1]).trim();
      var meanings = decodeEntities(stripTags(lm[2])).split(/[；;]/);
      meanings.forEach(function (meaning) {
        meaning = meaning.trim();
        if (meaning) result.translations.push({ pos: pos, meaning: meaning });
      });
    }

    // 中文词兜底：拼音音标 + layout cn 释义
    if (!result.ukphone) {
      var pm = html.match(/<div class="phonetic">\s*<span>\s*\[([^\]]+)\]\s*<\/span>/);
      if (pm) {
        result.ukphone = pm[1].trim();
        result.usphone = result.ukphone;
      }
    }
    if (result.translations.length === 0) {
      var cm = html.match(/<div class="layout cn">\s*<ul[^>]*>([\s\S]*?)<\/ul>/);
      if (cm) {
        var aRe = /<a[^>]*>([\s\S]*?)<\/a>/g;
        var am;
        while ((am = aRe.exec(cm[1])) !== null) {
          var t = stripTags(am[1]).trim();
          if (t) result.translations.push({ pos: "", meaning: t });
        }
      }
    }

    if (result.translations.length === 0 && !result.ukphone && !result.usphone) {
      return null;
    }
    return result;
  }

  return {
    // 返回 Promise<result>，result 结构见 parseResult（含 ukMp3/usMp3 发音链接）
    lookup: function (word) {
      return MNNetwork.fetch(pageURL(word), {
        method: "GET",
        timeout: 12,
        headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) {
          throw new Error("海词词典接口 HTTP " + res.status);
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
