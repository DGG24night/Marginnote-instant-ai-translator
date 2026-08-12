// YoudaoService.js —— 有道词典查词（免费 web 页面，无需 key）
// 页面：https://dict.youdao.com/m/result?word=<word>&lang=en （移动版服务端渲染 HTML，正则解析）
// 发音：https://dict.youdao.com/dictvoice?audio=<word>&type=1(英)/2(美) —— 前端 <audio> 直接播放
//
// 为什么不用 jsonapi_s 接口（2026-08-12 用户实测 interface 触发）：
//   jsonapi_s 在未签名/风控状态下，对很多词（哪怕词库里有，如 interface）返回一组
//   **随机推荐词**的完整词条（ec.word 为数组 + return-phrase 随机词，如 tip-up / B /
//   axletree / whiffler，每次请求都不同），无法区分"未命中"与"命中但被污染"。
//   移动版页面 /m/result 为 Nuxt.js SSR，词条数据直接渲染在 HTML 里，结构多年稳定。
//
// 实测结构（2026-08-12 curl 验证）：
//   <span class="title" ...>interface</span>                          ← 词头
//   <span class="phonetic" ...>/ ˈɪntəfeɪs /</span>                    ← 英音（首个）
//   <span class="phonetic" ...>/ ˈɪntərfeɪs /</span>                    ← 美音（第二个）
//   <li class="word-exp" ...><span class="pos">n.</span>
//     <span class="trans">（人机）界面…</span></li>                    ← 逐条释义
//   miss（词不存在，如 zzzzabc）：页面无 <div class="simple dict-module"> 区块

var MNIATYoudao = (function () {

  function lookupURL(word) {
    return "https://dict.youdao.com/m/result?word=" +
      encodeURIComponent(word) + "&lang=en";
  }

  function pronounceURL(word, accent) {
    // accent: "uk" -> type=1, "us" -> type=2
    var type = accent === "uk" ? 1 : 2;
    return "https://dict.youdao.com/dictvoice?audio=" +
      encodeURIComponent(word) + "&type=" + type;
  }

  // 有道页面偶发混入的脏数据/异常提示（间歇性出现，2026-08-09 用户实测触发），
  // 释义中出现时直接删除，避免污染查词结果。
  // 例如 "we are pirates, these data are stolen from youdao"（疑似接口异常提示）。
  var JUNK_PATTERNS = [
    /we\s+are\s+pirates[^；;。]*/gi,
    /these\s+data\s+are\s+stolen\s+from\s+youdao/gi
  ];

  function cleanJunk(text) {
    var out = String(text || "");
    JUNK_PATTERNS.forEach(function (re) {
      out = out.replace(re, "");
    });
    return out.replace(/\s{2,}/g, " ").replace(/^[；;\s]+|[；;\s]+$/g, "").trim();
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&#160;/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) {
        return String.fromCharCode(Number(n));
      });
  }

  function stripTags(s) {
    return String(s || "").replace(/<[^>]*>/g, "");
  }

  // 从 /m/result 页面 HTML 提取结构化词条
  // 返回 null = 未命中（词不存在 / 页面异常）
  //
  // **重要**：页面里 class="title" 在多个位置出现（页头 banner "全部产品"、
  // "双语例句"/"网络释义"/"英英释义"/"词组短语"等模块小标题、word-title 区块的
  // 词头 span，以及 seo 站点名）。若不限定范围，会错误命中 "全部产品" 这类
  // 推广文字作为词头。因此必须**限定在 word-title 区块内**取词头 / 音标：
  //
  //   <h4 class="word-title">
  //     <span class="title">commercial</span>
  //     <span class="phonetic">/ kə'mə:ʃəl /</span>
  //   </h4>
  //   <div class="phone_con">
  //     <span class="per-phone"><span>英</span>
  //       <span class="phonetic">/ ˈɪntəfeɪs /</span></span>
  //     <span class="per-phone"><span>美</span>
  //       <span class="phonetic">/ ˈɪntərfeɪs /</span></span>
  //   </div>
  //   miss（词不存在，如 zzzzabc）：页面无 <div class="simple dict-module"> 区块
  function parseResult(html, word) {
    if (!html || typeof html !== "string") return null;

    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      translations: []   // [{pos, meaning}]
    };

    // 1) 词头：限定在 word-title 区块内找 title（避免命中"全部产品"banner 等）
    var wtMatch = html.match(/<h4 class="word-title"[^>]*>([\s\S]{0,2000}?)<\/h4>/);
    if (wtMatch && wtMatch[1]) {
      var wtm = wtMatch[1].match(/<span class="title"[^>]*>([^<]+)<\/span>/);
      if (wtm && wtm[1] && wtm[1].trim()) {
        result.word = wtm[1].trim();
      }
    }

    // 2) 音标：phone_con 区块内嵌嵌套 div（pronounce/audio），用懒惰正则会以
    //    第一个 nested </div> 截断而漏掉美音。改用：定位 phone_con 起始位置，
    //    找下一个块级标记（同辈区块开始处，如 simple dict-module / word-head 闭合）
    //    作为右边界提取。
    var pcStart = html.indexOf('<div class="phone_con"');
    if (pcStart >= 0) {
      // 右边界：取下个 <div class="simple dict-module"（释义区块）之前作为 phone_con 范围
      var pcEnd = html.indexOf('<div class="simple dict-module"', pcStart);
      if (pcEnd < 0) pcEnd = pcStart + 4000; // 兜底：最多取 4000 字符
      var pcSeg = html.slice(pcStart, pcEnd);
      var phones = [];
      var pre = /<span class="phonetic"[^>]*>([^<]*)<\/span>/g;
      var pm;
      while ((pm = pre.exec(pcSeg)) !== null) {
        var ph = decodeEntities(stripTags(pm[1])).trim().replace(/^\/+|\/+$/g, "").trim();
        if (ph) phones.push(ph);
      }
      if (phones.length > 0) result.ukphone = phones[0];
      if (phones.length > 1) result.usphone = phones[1];
    }
    if (!result.ukphone) result.ukphone = result.usphone;
    if (!result.usphone) result.usphone = result.ukphone;

    // 3) 释义：限定在 simple dict-module 区块内逐条 <li class="word-exp">
    // miss 判定：无该区块 → 词不存在
    var si = html.indexOf('class="simple dict-module"');
    if (si >= 0) {
      var seg = html.slice(si, si + 12000);
      var liRe = /<li class="word-exp"[^>]*>([\s\S]*?)<\/li>/g;
      var lm;
      while ((lm = liRe.exec(seg)) !== null) {
        var raw = lm[1];
        var pos = "";
        var posM = raw.match(/class="pos"[^>]*>([^<]*)</);
        if (posM) pos = decodeEntities(stripTags(posM[1])).trim();
        var tran = "";
        var tranM = raw.match(/class="trans"[^>]*>([\s\S]*?)<\/span>/);
        if (tranM) tran = decodeEntities(stripTags(tranM[1])).trim();
        var clean = cleanJunk(tran);
        if (clean) {
          result.translations.push({ pos: pos, meaning: clean });
        }
      }
    }

    if (result.translations.length === 0 && !result.ukphone && !result.usphone) {
      return null;
    }
    return result;
  }

  return {
    pronounceURL: pronounceURL,

    // 返回 Promise<result>，result 结构见 parseResult
    lookup: function (word) {
      return MNNetwork.fetch(lookupURL(word), {
        method: "GET",
        timeout: 12,
        headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) {
          throw new Error("有道接口 HTTP " + res.status);
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
