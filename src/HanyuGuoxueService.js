// HanyuGuoxueService.js —— 汉语国学（hanyuguoxue.com，免费 web 页面，无需 key）
//
// 覆盖：汉字 / 词语 / 成语。数据源与 URL 规则（2026-09-19 实测）：
//
//   **不直接拼页面 URL，走站内搜索接口**——站点搜索命中唯一词条时用 301/302 跳到正式页，
//   NSURLConnection 默认跟随跳转，因此一次请求即可拿到最终页面（实测：
//     /zidian/search?words=遇       → 301 → /zidian/zi-36935    （36935 = 0x9047 十进制）
//     /cidian/search?words=一心一意  → 301 → /cidian/ci-1391ad532（哈希不可离线推导）
//     /chengyu/search?words=一诺千金 → 302 → /chengyu/ci-19c1b1159d
//     /cidian/search?words=一诺千金  → 301 → /cidian/ci-19c1b1159d（词语页同时覆盖成语）
//     /cidian/search?words=人工智能  → 200 搜索结果页（未收录，页面仍是搜索结果）
//   ）
//   未命中时停留在搜索结果页，解析拿不到词条 → 视为「未收录」。
//
//   字页结构（/zidian/zi-*）：
//     <div class=zi-title-main><h2>遇</h2>
//     <span class=voice data-voice=yu4.mp3><em class=py>yù</em><em class=zy>ㄩˋ</em></span>
//     <div class=zi-basic-explain>   ← 基本解释：p.explain（span.no 序号 + span.text 释义 + span.eg 例如）
//     <div class=zi-detail-explain>  ← 详细解释：p.cixing（词性）分段，p.explain 义项，
//                                       义项后跟 p.extra.quotes(引证) / p.extra.eg(例如) / p.extra.en(英文)
//   词/成语页结构（/cidian/ci-*）：
//     <div class=ci-title ...><h1 class=song>一心一意</h1>
//     <span class=voice data-text=一(yi1)心(xin1)…>yī xīn yī yì</span>（注音 span 带 class="voice zhuyin"）
//     <div class=ci-content id=ciContent> 内按 <div class=title-line-cross><h3>词语解释</h3></div> 分段，
//       取「词语解释」段的 div.ci-entries：p.explain（span.no ◎ + 释义）+ p.extra（英文/例证/反义）
//
// 音频：
//   字页 data-voice=yu4.mp3 → https://data.hanyuguoxue.com/voice/yu4.mp3（真实录音，实测 audio/mpeg）
//   词/成语页只有 data-text（站点前端自行合成），无直链 → 本服务不返回 mp3，
//   由卡片侧回退到 MarginNote 原生 TTS（SpeechManager.playText）。
//
// 返回结构与其他词典服务一致，另加 2 个字段：
//   details: [{ label, text }] —— 折叠展示的补充内容（引证/例如/英文），卡片默认收起，点击展开
//   （phoneticLabel / perLine 语义同 MNIATXinhua）

var MNIATHanyuGuoxue = (function () {

  var HOST = "https://www.hanyuguoxue.com";
  var VOICE_HOST = "https://data.hanyuguoxue.com/voice/";

  // ---------- 文本清洗 ----------

  function fromCodePoint(cp) {
    if (!(cp > 0) || cp > 0x10ffff) return "";
    if (cp <= 0xffff) return String.fromCharCode(cp);
    var v = cp - 0x10000;
    return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
  }

  function codePointOf(s) {
    var str = String(s || "");
    if (!str.length) return 0;
    var hi = str.charCodeAt(0);
    if (hi >= 0xd800 && hi <= 0xdbff && str.length > 1) {
      var lo = str.charCodeAt(1);
      if (lo >= 0xdc00 && lo <= 0xdfff) return ((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
    }
    return hi;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&#(\d+);/g, function (_, n) { return fromCodePoint(Number(n)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return fromCodePoint(parseInt(n, 16)); })
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
      .replace(/&lsquo;/g, "‘").replace(/&rsquo;/g, "’")
      .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
      .replace(/&hellip;/g, "…").replace(/&middot;/g, "·");
  }

  function stripTags(s) {
    return String(s || "").replace(/<[^>]*>/g, "");
  }

  function clean(s) {
    var t = decodeEntities(stripTags(s));
    t = t.replace(/[\u00a0\u3000]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    return t;
  }

  // 保留结构的分行清洗（引证多条时以换行分隔，卡片里逐行展示）
  function cleanLines(s) {
    var t = String(s || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/span>\s*<span[^>]*>/g, "\n"); // 同级 span 之间视为换行
    t = decodeEntities(stripTags(t));
    t = t.replace(/[\u00a0\u3000]/g, " ");
    var parts = t.split(/\n+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/\s+/g, " ").trim();
      if (p) out.push(p);
    }
    return out.join("\n");
  }

  function truncate(s, max) {
    var t = String(s || "");
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  // 属性取值：兼容 class=xxx 与 class="xxx yyy"
  function attrClass(attrs) {
    var m = /class\s*=\s*("([^"]*)"|([^\s>]+))/.exec(attrs || "");
    return m ? (m[2] != null ? m[2] : m[3]) : "";
  }

  function segments(html, cls) {
    var i = html.indexOf(cls);
    if (i < 0) return "";
    var start = html.lastIndexOf("<div", i);
    if (start < 0) start = i;
    // 右边界：下一个 <div class=card / 下一段 content-card（页面结构固定，取一个较长的安全窗口）
    return html.slice(start, start + 30000);
  }

  // ---------- 汉字页 ----------

  function parseCharPage(html, ch) {
    var result = {
      word: ch,
      ukphone: "",
      usphone: "",
      zhuyin: "",
      phoneticLabel: "拼音",
      perLine: true,
      translations: [],
      wordForms: [],
      ukMp3: "",
      usMp3: ""
    };

    var wm = /<div class=zi-title-main>\s*<h2>([^<]*)<\/h2>/.exec(html);
    if (wm && wm[1]) result.word = clean(wm[1]) || ch;

    // 拼音 / 注音 / 读音：**限定在字头区**（zi-title-main 到「遇的意思」卡片之前）取
    // <span class=voice data-voice=xx.mp3>。整页有多处同名结构（详细解释里每个字头、
    // 下方「字义分解」等），不限定范围会把拼音重复拼成 "yù yù yù yù"。
    var headStart = html.indexOf("zi-title-main");
    if (headStart < 0) headStart = 0;
    var headEnd = html.indexOf("id=details", headStart);
    if (headEnd < 0) headEnd = headStart + 6000;
    var head = html.slice(headStart, headEnd);
    var vRe = /<span class=voice data-voice=([^ >]+)>([\s\S]*?)<\/span>/g;
    var vm;
    var phones = [];
    var zhuyins = [];
    var seen = {};
    var voiceFile = "";
    while ((vm = vRe.exec(head)) !== null) {
      if (!voiceFile) voiceFile = vm[1];
      var py = /<em class=py>([\s\S]*?)<\/em>/.exec(vm[2]);
      var zy = /<em class=zy>([\s\S]*?)<\/em>/.exec(vm[2]);
      var pyText = py ? clean(py[1]) : "";
      var zyText = zy ? clean(zy[1]) : "";
      var key = pyText + "|" + zyText;
      if (seen[key]) continue; // 同页重复的读音只保留一次
      seen[key] = 1;
      if (pyText) phones.push(pyText);
      if (zyText) zhuyins.push(zyText);
    }
    result.ukphone = phones.filter(Boolean).join(" ");
    result.zhuyin = zhuyins.filter(Boolean).join(" ");
    if (voiceFile) {
      var url = VOICE_HOST + voiceFile;
      result.ukMp3 = url;
      result.usMp3 = url;
    }

    var hasBasic = false;
    var hasDetail = false;

    // 基本解释：p.explain（span.no 序号 / span.text 释义 / span.eg 例如）
    var bi = html.indexOf("zi-basic-explain");
    if (bi >= 0) {
      var bSeg = html.slice(bi, bi + 20000);
      var bEnd = bSeg.indexOf("zi-detail-explain");
      if (bEnd > 0) bSeg = bSeg.slice(0, bEnd);
      var bRe = /<p([^>]*)>([\s\S]*?)<\/p>/g;
      var bm;
      var first = true;
      while ((bm = bRe.exec(bSeg)) !== null) {
        if (!/explain/.test(attrClass(bm[1]))) continue;
        var inner = bm[2];
        var noM = /<span class=no>([\s\S]*?)<\/span>/.exec(inner);
        var no = noM ? clean(noM[1]) : "";
        var rest = inner.replace(/<span class=no>[\s\S]*?<\/span>/, "");
        var egM = /<span class=eg>([\s\S]*?)<\/span>/.exec(rest);
        var text = egM ? rest.slice(0, rest.indexOf("<span class=eg>")) : rest;
        var meaning = clean(text);
        if (!meaning) continue;
        var details = [];
        if (egM) {
          var eg = clean(egM[1]);
          eg = eg.replace(/^例如\s*[:：]?\s*/, "");
          if (eg) details.push({ label: "例如", text: eg });
        }
        result.translations.push({
          pos: first ? "基本解释" : "",
          meaning: (no ? no + " " : "") + truncate(meaning, 300),
          details: details
        });
        first = false;
        hasBasic = true;
      }
    }

    // 详细解释：p.cixing 分词性，p.explain 义项，p.extra.* 作为该义项的可折叠补充
    var di = html.indexOf("zi-detail-explain");
    if (di >= 0) {
      var dSeg = html.slice(di, di + 60000);
      var dEnd = dSeg.indexOf("content-card-body");
      if (dEnd > 0) dSeg = dSeg.slice(0, dEnd);
      var dRe = /<p([^>]*)>([\s\S]*?)<\/p>/g;
      var dm;
      var pos = "";
      var pendingPos = "";
      while ((dm = dRe.exec(dSeg)) !== null) {
        var cls = attrClass(dm[1]);
        var dInner = dm[2];
        if (/cixing/.test(cls)) {
          pos = clean(dInner) || pos;
          pendingPos = pos;
          continue;
        }
        if (/explain/.test(cls)) {
          var dNoM = /<span class=no>([\s\S]*?)<\/span>/.exec(dInner);
          var dNo = dNoM ? clean(dNoM[1]) : "";
          var dText = clean(dInner.replace(/<span class=no>[\s\S]*?<\/span>/, ""));
          if (!dText) continue;
          result.translations.push({
            pos: pendingPos,
            meaning: (dNo ? dNo + " " : "") + truncate(dText, 300),
            details: []
          });
          pendingPos = "";
          hasDetail = true;
          continue;
        }
        if (/extra/.test(cls)) {
          var last = result.translations[result.translations.length - 1];
          if (!last) continue;
          var label = "";
          var lm = /<label>([\s\S]*?)<\/label>/.exec(dInner);
          if (lm) label = clean(lm[1]).replace(/\s*[:：]\s*$/, "").trim();
          if (!label) {
            var tm = /<span class=("tag[^"]*"|tag[^ >]*)>([\s\S]*?)<\/span>/.exec(dInner);
            if (tm) label = clean(tm[2]);
          }
          if (!label) label = "补充";
          var body = dInner
            .replace(/<label>[\s\S]*?<\/label>/, "")
            .replace(/<span class=("tag[^"]*"|tag[^ >]*)>[\s\S]*?<\/span>/, "");
          var dv = truncate(cleanLines(body), 600);
          if (dv) last.details.push({ label: label, text: dv });
        }
      }
    }

    if (result.translations.length === 0 && !result.ukphone) return null;
    if (result.translations.length > 24) result.translations = result.translations.slice(0, 24);
    return result;
  }

  // ---------- 词语 / 成语页 ----------

  function parseWordPage(html, word) {
    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      zhuyin: "",
      phoneticLabel: "拼音",
      perLine: true,
      translations: [],
      wordForms: [],
      ukMp3: "",
      usMp3: ""
    };

    var wm = /<h1 class=song>([^<]*)<\/h1>/.exec(html);
    if (wm && wm[1]) result.word = clean(wm[1]) || word;

    // 拼音 / 注音：<p><label>拼音</label> <span class=voice data-text=…>yī xīn yī yì</span></p>
    // 注意 class 的引号不一定存在（拼音行是 class=voice，注音行是 class="voice zhuyin"），
    // 统一按「label 之后第一个 span」取值，避免把注音当成拼音。
    var pyM = /<label>\s*拼音\s*<\/label>\s*(?:<[^>]*>\s*)*?<span[^>]*>([\s\S]*?)<\/span>/.exec(html);
    if (pyM) result.ukphone = clean(pyM[1]);
    var zyM = /<label>\s*注音\s*<\/label>\s*(?:<[^>]*>\s*)*?<span[^>]*>([\s\S]*?)<\/span>/.exec(html);
    if (zyM) result.zhuyin = clean(zyM[1]);

    // 正文：id=ciContent 内按 title-line-cross 分段，取「词语解释」段
    var ci = html.indexOf("id=ciContent");
    if (ci < 0) ci = html.indexOf("ci-content");
    if (ci < 0) return null;
    var seg = html.slice(ci, ci + 40000);

    var sections = [];
    var splitRe = /<div class=title-line-cross>\s*<h3>([\s\S]*?)<\/h3>\s*<\/div>/g;
    var marks = [];
    var sm;
    while ((sm = splitRe.exec(seg)) !== null) {
      marks.push({ title: clean(sm[1]), at: sm.index, bodyStart: sm.index + sm[0].length });
    }
    for (var i = 0; i < marks.length; i++) {
      var end = i + 1 < marks.length ? marks[i + 1].at : seg.length;
      sections.push({ title: marks[i].title, body: seg.slice(marks[i].bodyStart, end) });
    }
    if (sections.length === 0) sections = [{ title: "", body: seg }];

    var target = null;
    for (var si = 0; si < sections.length; si++) {
      if (sections[si].title.indexOf("词语解释") >= 0) { target = sections[si]; break; }
    }
    if (!target) target = sections[0];

    var entries = target.body;
    var ei = entries.indexOf("ci-entries");
    if (ei >= 0) {
      var eStart = entries.lastIndexOf("<div", ei);
      entries = entries.slice(eStart >= 0 ? eStart : ei, entries.length);
    }

    var pRe = /<p([^>]*)>([\s\S]*?)<\/p>/g;
    var pm;
    var first = true;
    while ((pm = pRe.exec(entries)) !== null) {
      var cls = attrClass(pm[1]);
      var inner = pm[2];
      if (/explain/.test(cls)) {
        var noM = /<span class=no>([\s\S]*?)<\/span>/.exec(inner);
        var no = noM ? clean(noM[1]) : "";
        var text = clean(inner.replace(/<span class=no>[\s\S]*?<\/span>/, ""));
        if (!text) continue;
        result.translations.push({
          pos: first ? "词语解释" : "",
          meaning: (no ? no + " " : "") + truncate(text, 300),
          details: []
        });
        first = false;
        continue;
      }
      if (/extra/.test(cls)) {
        var last = result.translations[result.translations.length - 1];
        if (!last) continue;
        var label = "";
        var tm = /<span class=("tag[^"]*"|tag[^ >]*)>([\s\S]*?)<\/span>/.exec(inner);
        if (tm) label = clean(tm[2]);
        if (!label) label = "补充";
        var body = inner.replace(/<span class=("tag[^"]*"|tag[^ >]*)>[\s\S]*?<\/span>/, "");
        var cM = /<span class=content>([\s\S]*?)<\/span>\s*$/.exec(inner);
        if (cM) body = cM[1];
        var dv = truncate(cleanLines(body), 600);
        if (dv) last.details.push({ label: label, text: dv });
      }
    }

    if (result.translations.length === 0 && !result.ukphone) return null;
    if (result.translations.length > 24) result.translations = result.translations.slice(0, 24);
    return result;
  }

  // 取页面 HTML：
  //   wordURL 走站内搜索，命中唯一词条时站点用 301/302 跳转。NSURLConnection 默认跟随跳转
  //   （mn-docs：currentRequest「会经重定向等变更」），但为防个别环境不跟随，这里再兜一层：
  //   响应是 3xx 时读 Location 头手工再请求（最多 3 跳），读不到头就报明确错误。
  function fetchHTML(url, depth) {
    var d = depth || 0;
    return MNNetwork.fetch(url, {
      method: "GET",
      timeout: 15,
      headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
    }).then(function (res) {
      var status = res.status || 0;
      if (status >= 300 && status < 400) {
        var loc = "";
        try {
          var headers = res.nsResponse && typeof res.nsResponse.allHeaderFields === "function"
            ? res.nsResponse.allHeaderFields()
            : null;
          if (headers) loc = String(headers.Location || headers.location || "");
        } catch (e) {
          loc = "";
        }
        if (loc && d < 3) {
          var next = loc.indexOf("http") === 0 ? loc : (HOST + (loc.charAt(0) === "/" ? "" : "/") + loc);
          return fetchHTML(next, d + 1);
        }
        throw new Error("汉语国学跳转失败（HTTP " + status + "）");
      }
      if (status < 200 || status >= 300) {
        throw new Error("汉语国学 HTTP " + status);
      }
      return res.text();
    });
  }

  // ---------- 对外接口 ----------

  function isSingleChar(text) {
    var s = String(text || "");
    if (s.length === 1) {
      var c = s.charCodeAt(0);
      return (c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
    }
    if (s.length === 2) {
      var cp = codePointOf(s);
      return cp >= 0x20000 && cp <= 0x3134f;
    }
    return false;
  }

  function hasChinese(text) {
    var s = String(text || "");
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) return true;
    }
    return false;
  }

  var EDGE_PUNCT = /^[\s，。！？；：、·—～…“”‘’（）〈〉《》【】〔〕「」『』!?,.;:'"()\[\]{}<>+\-=|~`@#$%^&*]+|[\s，。！！？；：、·—～…“”‘’（）〈〉《》【】〔〕「」『』!?,.;:'"()\[\]{}<>+\-=|~`@#$%^&*]+$/g;

  function trimPunct(text) {
    var t = String(text == null ? "" : text);
    var prev = null;
    while (prev !== t) {
      prev = t;
      t = t.replace(EDGE_PUNCT, "");
    }
    return t.trim();
  }

  // 汉字直链：/zidian/zi-<码点十进制>（实测 遇=36935、好=22909、一=19968、龙=40857、
  // 扩展 B 异体字 𨔆=165126 均命中，可离线推导，无需先搜索）
  function charURL(ch) {
    return HOST + "/zidian/zi-" + codePointOf(ch);
  }

  // 词语/成语：词页 id 是哈希（ci-1391ad532），无法离线推导，故走站内搜索接口，
  // 命中唯一词条时站点 301/302 跳到正式页（NSURLConnection 默认跟随跳转）。
  // 站点未收录时停留在搜索结果页（HTTP 200），解析拿不到词条 → 判为未收录。
  function wordURL(word) {
    return HOST + "/cidian/search?words=" + encodeURIComponent(String(word));
  }

  function urlFor(text) {
    return isSingleChar(text) ? charURL(text) : wordURL(text);
  }

  return {
    lookup: function (word) {
      var text = trimPunct(word);
      if (!text) return Promise.reject(new Error("查询内容为空"));
      if (!hasChinese(text)) {
        return Promise.reject(new Error("汉语国学仅支持中文查询（汉字 / 词语 / 成语）；查英文单词请切换到其它查词服务"));
      }
      var single = isSingleChar(text);
      return fetchHTML(urlFor(text)).then(function (html) {
        var parsed = single ? parseCharPage(html, text) : parseWordPage(html, text);
        if (!parsed) {
          throw new Error("汉语国学未收录「" + text + "」（或站点结构已变化）");
        }
        return parsed;
      });
    },

    // 供自测/诊断
    urlFor: urlFor,

    // 汉字读音音频（拼音录音）：字页 data-voice 直链，供发音兜底链使用。
    // 返回 Promise<{ url }>，失败时 url 为空串（调用方回退原生 TTS）。
    pronounceFor: function (ch) {
      var text = trimPunct(ch);
      if (!isSingleChar(text)) return Promise.resolve({ url: "" });
      return fetchHTML(charURL(text)).then(function (html) {
        var head = html;
        var cut = head.indexOf("id=details");
        if (cut > 0) head = head.slice(0, cut);
        var m = /<span class=voice data-voice=([^ >]+)>/.exec(head);
        if (!m) return { url: "" };
        return { url: VOICE_HOST + m[1] };
      }).catch(function () {
        return { url: "" };
      });
    }
  };
})();
