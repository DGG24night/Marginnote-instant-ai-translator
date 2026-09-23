// XinhuaDictionaryService.js —— 新华字典（gushici.net 系列，免费 web 页面，无需 key）
//
// 覆盖：汉字（单字）/ 词语 / 成语。数据源与 URL 规则（2026-09-19 curl 实测）：
//
//   单字  https://zidian.gushici.net/<总笔画>/<unicode 十六进制>.html
//         例：遇 → https://zidian.gushici.net/12/9047.html（12 = 总笔画，9047 = U+9047）
//         页面结构：
//           <div class="entry_title"> … <span class="z_t2">拼音</span>
//             <span class="z_d song">yù<span class="ptr"><a data-src-mp3="//zidian.gushici.net/d/mp3/yù.mp3"></a></span></span>
//             <span class="z_t2">注音</span> <span class="z_d song">ㄩˋ</span>
//           <div class="content definitions jnr">         ← 基本解释
//             <p>● <strong>遇</strong></p>
//             <p><span class="dicpy">yù … ㄩˋ</span></p>
//             <ol><li>相逢，会面，碰到：～到。…</li>…</ol>
//             <div class="enbox">                        ← 英/德/法对照，只取「英语」行
//               <p><span class="z_ts2">英语</span> meet, come across, encounter</p>
//               <p><span class="z_ts2">德语</span> …</p><p><span class="z_ts2">法语</span> …</p></div>
//           多音字（如「好」）在同一 jnr 里重复出现「读音 + <ol>」，各读音的义项分别列出。
//           英语对照作为末条释义返回（pos = "英语"），德语/法语丢弃。
//
//   词语/成语  https://cidian.gushici.net/<md5 前 2 位>/<md5 第 11-22 位>.html
//         例：一诺千金 → md5 01698c4ff9d218ad46aa13bb9dab6813 → /01/d218ad46aa13.html
//         实测命中：一诺千金 / 苹果 / 编码 / 你好 / 一心一意 / 胸有成竹；
//         单字在该站 404（单字走 zidian），未收录的词（如「人工智能」）同样 404。
//         页面结构：条目（可含繁体括注）、拼音、注音、词语解释（cyjj）、成语解释（cyjs）、
//         网络解释（wljs）。
//
//   读音：单字页 data-src-mp3 为真实录音（//zidian.gushici.net/d/mp3/yù.mp3，实测 audio/mpeg）；
//         词语页无 mp3 属性，站点前端用百度 TTS 播放（tts.baidu.com/text2audio），本服务同法拼链接。
//
// 关于「总笔画」：站点检索由前端分片索引本地匹配，无服务端搜索接口，索引是自定义混淆二进制，
//   无法在 JSCore 复现，因此改用离线固化的 MNIATXinhuaStrokes 表（见该文件注释）。
//
// 返回结构与其他词典服务一致，另加 3 个中文专用字段：
//   phoneticLabel: "拼音"  → 前端把音标行渲染为「拼音 yù　ㄩˋ」（而非「英 /…/ 美 /…/」），
//                            并把英/美两个发音按钮合并为一个；
//   zhuyin: 注音（ㄩˋ），无则空串；
//   perLine: true          → 前端每条释义独占一行（义项逐条列出，不做同词性合并）。

var MNIATXinhua = (function () {

  var ZIDIAN_HOST = "https://zidian.gushici.net";
  var CIDIAN_HOST = "https://cidian.gushici.net";

  // ---------- 文本清洗 ----------

  // 码点 → 字符。JSCore 老版本不保证有 String.fromCodePoint，手工处理代理对。
  function fromCodePoint(cp) {
    if (!(cp > 0) || cp > 0x10ffff) return "";
    if (cp <= 0xffff) return String.fromCharCode(cp);
    var v = cp - 0x10000;
    return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
  }

  // 字符串首字符的码点（兼容代理对；不依赖 String.prototype.codePointAt）
  function codePointOf(s) {
    var str = String(s || "");
    if (!str.length) return 0;
    var hi = str.charCodeAt(0);
    if (hi >= 0xd800 && hi <= 0xdbff && str.length > 1) {
      var lo = str.charCodeAt(1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        return ((hi - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
      }
    }
    return hi;
  }

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&#(\d+);/g, function (_, n) {
        return fromCodePoint(Number(n));
      })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) {
        return fromCodePoint(parseInt(n, 16));
      })
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&ldquo;/g, "“")
      .replace(/&rdquo;/g, "”")
      .replace(/&lsquo;/g, "‘")
      .replace(/&rsquo;/g, "’")
      .replace(/&mdash;/g, "—")
      .replace(/&ndash;/g, "–")
      .replace(/&hellip;/g, "…")
      .replace(/&middot;/g, "·")
      .replace(/&times;/g, "×");
  }

  function stripTags(s) {
    return String(s || "").replace(/<[^>]*>/g, "");
  }

  // 去标签 + 解实体 + 折叠空白（含全角空格 U+3000 与不换行空格）
  function clean(s) {
    var t = decodeEntities(stripTags(s));
    t = t.replace(/[\u00a0\u3000]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    return t;
  }

  function truncate(s, max) {
    var t = String(s || "");
    return t.length > max ? t.slice(0, max) + "…" : t;
  }

  function firstIn(html, re, group) {
    var m = html.match(re);
    return m ? m[group || 1] : "";
  }

  // 拼音/注音拆分：拼音 = 拉丁字母（含声调符），注音 = 注音符号（Bopomofo + 调号）
  var ZHUYIN_RE = /[\u3105-\u312f\u02c9\u02ca\u02c7\u02cb\u02d9]+/g;
  var PINYIN_RE = /[A-Za-z\u00c0-\u024f]+/;

  function splitReading(text) {
    var s = clean(text);
    var m = s.match(ZHUYIN_RE);
    var zhuyin = m ? m.join(" ") : "";
    var rest = zhuyin ? s.replace(ZHUYIN_RE, " ") : s;
    var pm = rest.match(PINYIN_RE);
    return { pinyin: pm ? pm[0] : "", zhuyin: zhuyin };
  }

  // ---------- 单字 ----------

  function isSingleChar(text) {
    // 单个 CJK 字符（含扩展 A/B、兼容区）；代理对算一个字符
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

  function charURL(ch) {
    var strokes = MNIATXinhuaStrokes.strokesOf(ch);
    if (!strokes) return "";
    return ZIDIAN_HOST + "/" + strokes + "/" + codePointOf(ch).toString(16) + ".html";
  }

  // 单字页 → 结构化词条
  // 返回 null = 未命中（页面异常/结构变化）
  function parseChar(html, ch) {
    if (!html || typeof html !== "string") return null;

    var result = {
      word: firstIn(html, /class="pox"\s*>([^<]*)</) || ch,
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

    // 1) 拼音 / 注音 / 读音音频：限定在「拼音」标签到「注音」标签之间，
    //    避免匹配到页面其它位置（同音字、拼音索引等）的同名结构。
    var pi = html.indexOf('<span class="z_t2">拼音</span>');
    if (pi >= 0) {
      var zi = html.indexOf('<span class="z_t2">注音</span>', pi);
      var seg = html.slice(pi, zi > pi ? zi : pi + 800);
      var phones = [];
      var pre = /<span class="z_d song">([\s\S]*?)<\/span>/g;
      var pm;
      while ((pm = pre.exec(seg)) !== null) {
        var t = clean(pm[1]);
        if (t) phones.push(t);
      }
      result.ukphone = phones.join(" ");
      var am = /data-src-mp3="([^"]+)"/.exec(seg);
      if (am) {
        result.ukMp3 = normalizeURL(am[1]);
        result.usMp3 = result.ukMp3;
      }
    }
    if (zi > pi && pi >= 0) {
      var zseg = html.slice(zi, zi + 400);
      var zEnd = zseg.indexOf("</p>");
      if (zEnd >= 0) zseg = zseg.slice(0, zEnd);
      var zphones = [];
      var zre = /<span class="z_d song">([\s\S]*?)<\/span>/g;
      var zm;
      while ((zm = zre.exec(zseg)) !== null) {
        var zt = clean(zm[1]);
        if (zt) zphones.push(zt);
      }
      result.zhuyin = zphones.join(" ");
    }
    // 音频兜底：站点音频路径就是拼音本身（//zidian.gushici.net/d/mp3/<拼音>.mp3）
    if (!result.ukMp3 && result.ukphone) {
      var firstPinyin = splitReading(result.ukphone).pinyin;
      if (firstPinyin) {
        result.ukMp3 = ZIDIAN_HOST + "/d/mp3/" + encodeURIComponent(firstPinyin) + ".mp3";
        result.usMp3 = result.ukMp3;
      }
    }

    // 2) 基本解释（.jnr 区块）：可能含多组「读音 + 义项列表」（多音字）
    var ji = html.indexOf('class="content definitions jnr"');
    if (ji >= 0) {
      var jEnd = html.indexOf('<div class="div copyright"', ji);
      if (jEnd < 0) jEnd = ji + 20000;
      var jSeg = html.slice(ji, jEnd);
      // 英语对照（enbox 的「英语」行）属于「基本解释」，先取出再剔除整个 enbox
      // （德语/法语对照不属于基本字义，丢弃）。
      var englishBox = extractEnglishBox(jSeg);
      jSeg = jSeg.replace(/<div class="enbox">[\s\S]*?<\/div>\s*<\/div>/g, "");
      jSeg = jSeg.replace(/<div class="enbox">[\s\S]*?<\/div>/g, "");

      var groups = [];
      var searchFrom = 0;
      while (true) {
        var olStart = jSeg.indexOf("<ol", searchFrom);
        if (olStart < 0) break;
        var olBodyStart = jSeg.indexOf(">", olStart);
        var olEnd = jSeg.indexOf("</ol>", olBodyStart);
        if (olBodyStart < 0 || olEnd < 0) break;
        var body = jSeg.slice(olBodyStart + 1, olEnd);
        // 该组读音：向前回看最近的 dicpy（上一个 </ol> 之后）。
        // dicpy 内含嵌套 <span class="ptr">，不能按 </span> 截断——截到 </p> 后去标签，
        // 得到「拼音 + 注音」（如 "hǎo  ㄏㄠˇ"），再由 splitReading 拆分。
        var before = jSeg.slice(searchFrom, olStart);
        var dIdx = before.lastIndexOf('<span class="dicpy">');
        var reading = { pinyin: "", zhuyin: "" };
        if (dIdx >= 0) {
          var dEnd = before.indexOf("</p>", dIdx);
          var dRaw = before.slice(dIdx, dEnd > dIdx ? dEnd : dIdx + 200);
          reading = splitReading(dRaw);
        }
        groups.push({ reading: reading, body: body });
        searchFrom = olEnd + 5;
      }

      var multi = groups.length > 1;
      for (var gi = 0; gi < groups.length; gi++) {
        var items = extractListItems(groups[gi].body);
        if (items.length === 0) continue;
        for (var ii = 0; ii < items.length; ii++) {
          var label = "";
          if (multi && groups[gi].reading.pinyin) {
            label = groups[gi].reading.pinyin +
              (groups[gi].reading.zhuyin ? " " + groups[gi].reading.zhuyin : "");
          }
          result.translations.push({
            // pos 即「读音」标签：多音字每组义项首个条目带上（前端按小标签展示）
            pos: ii === 0 ? label : "",
            meaning: (ii + 1) + ". " + truncate(clean(items[ii]), 300)
          });
        }
      }

      // 英语对照排在义项之后（pos 作「英语」小标签，前端 perLine 渲染为独立一行）
      for (var ei = 0; ei < englishBox.length; ei++) {
        result.translations.push({ pos: "英语", meaning: truncate(englishBox[ei], 300) });
      }
    }

    if (result.translations.length === 0 && !result.ukphone) return null;
    return result;
  }

  // 基本字义末尾的 enbox（<div class="enbox">）是站点给该字配的英/德/法对照：
  //   <p><span class="z_ts2">英语</span> save money, store, reserve; heir</p>
  //   <p><span class="z_ts2">德语</span> …</p>
  //   <p><span class="z_ts2">法语</span> …</p>
  // 这些内容归属「基本解释」，按需求只取「英语」一行（德语/法语不取），
  // 返回去重后的文本数组；无 enbox 或只有其它语种时返回空数组。
  function extractEnglishBox(seg) {
    var out = [];
    var boxRe = /<div class="enbox">([\s\S]*?)<\/div>/g;
    var bm;
    while ((bm = boxRe.exec(seg)) !== null) {
      var pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
      var pm;
      while ((pm = pRe.exec(bm[1])) !== null) {
        var raw = pm[1];
        var lm = /<span class="z_ts2">([\s\S]*?)<\/span>/.exec(raw);
        if (!lm) continue;
        // 语种标签：英语 / 英文（不要德语、法语）；老 JSCore 不用 startsWith
        if (clean(lm[1]).indexOf("英") !== 0) continue;
        var t = clean(raw.replace(/<span class="z_ts2">[\s\S]*?<\/span>/, ""))
          .replace(/^[:：]\s*/, "");
        if (t && out.indexOf(t) < 0) out.push(t);
      }
    }
    return out;
  }

  // 从 <ol> 内容里取义项：优先 <li>，个别字（如「淼」）写成 <ol><p>…</p></ol>
  function extractListItems(body) {
    var items = [];
    var liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
    var m;
    while ((m = liRe.exec(body)) !== null) {
      var t = clean(m[1]).replace(/^[◎●•·]\s*/, "");
      if (t) items.push(t);
    }
    if (items.length > 0) return items;
    var pRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
    while ((m = pRe.exec(body)) !== null) {
      var p = clean(m[1]).replace(/^[◎●•·]\s*/, "");
      if (p) items.push(p);
    }
    return items;
  }

  function normalizeURL(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    if (s.indexOf("//") === 0) s = "https:" + s;
    else if (s.indexOf("http://") === 0) s = "https://" + s.slice(7);
    return encodeNonAscii(s);
  }

  // 站点音频路径含原始 UTF-8 拼音（//zidian.gushici.net/d/mp3/yù.mp3）。
  // 老 WebKit（MarginNote 卡片 WebView）对未编码的非 ASCII URL 支持不稳，
  // 统一转成百分号编码（实测 y%C3%B9.mp3 可正常返回 audio/mpeg）。
  function encodeNonAscii(url) {
    var s = String(url || "");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) {
        out += s.charAt(i);
      } else {
        // 按 UTF-8 逐字节百分号编码（含代理对）
        var cp = c;
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
          var lo = s.charCodeAt(i + 1);
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            cp = ((c - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
            i++;
          }
        }
        var bytes = [];
        if (cp < 0x800) {
          bytes = [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
        } else if (cp < 0x10000) {
          bytes = [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
        } else {
          bytes = [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
        }
        for (var bi = 0; bi < bytes.length; bi++) {
          var b = bytes[bi].toString(16).toUpperCase();
          out += "%" + (b.length < 2 ? "0" + b : b);
        }
      }
    }
    return out;
  }

  // ---------- 词语 / 成语 ----------

  // 词语页 URL：md5(词) 前 2 位作目录，第 11-22 位（12 个字符）作文件名
  function wordURL(word) {
    var hex = MNIATMD5.hex(String(word));
    return CIDIAN_HOST + "/" + hex.slice(0, 2) + "/" + hex.slice(10, 22) + ".html";
  }

  // 词语/成语：站点自己用百度 TTS 朗读（tts.baidu.com/text2audio?tex=…），
  // 但该接口现已返回 {"err_no":502,"err_msg":"Not verified user."}（2026-09-19 实测），
  // 拼出来只会 100% 播放失败 → 不再返回音频链接（ukMp3 留空），
  // 由卡片侧统一回退 MarginNote 原生 TTS（SpeechManager.playText）。
  function ttsURL() {
    return "";
  }

  // 取某个 nr-box 区块（cyjj 词语解释 / cyjs 成语解释 / wljs 网络解释）的内容片段
  function boxSegment(html, cls) {
    var i = html.indexOf(cls);
    if (i < 0) return "";
    var next = html.indexOf("nr-box nr-box-shiyi", i + cls.length);
    return html.slice(i, next > i ? next : i + 12000);
  }

  function paraItems(seg) {
    var items = [];
    var re = /<p[^>]*>([\s\S]*?)<\/p>/g;
    var m;
    while ((m = re.exec(seg)) !== null) {
      var t = clean(m[1]).replace(/^[◎●•·]\s*/, "");
      if (t) items.push(t);
    }
    return items;
  }

  function paraRawItems(seg) {
    var items = [];
    var re = /<p[^>]*>([\s\S]*?)<\/p>/g;
    var m;
    while ((m = re.exec(seg)) !== null) items.push(m[1]);
    return items;
  }

  // 「◎ 一诺千金 yīnuò-qiānjīn」这类词头行：含拼音标注（dicpy）且去掉词与拼音后
  // 无剩余文字 → 与词条标题重复，不进释义列表（真正的释义行通常带 [英文] 或整句解释）。
  function isWordHeadLine(raw, cleaned, word) {
    if (!/class="dicpy"/.test(raw)) return false;
    if (cleaned.indexOf("[") >= 0) return false;
    var rest = cleaned.split(String(word)).join(" ");
    rest = rest.replace(ZHUYIN_RE, " ").replace(/[A-Za-z\u00c0-\u024f\-·]+/g, " ")
      .replace(/\s+/g, "");
    return rest.length === 0;
  }

  function parseWord(html, word) {
    if (!html || typeof html !== "string") return null;

    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      zhuyin: "",
      phoneticLabel: "拼音",
      perLine: true,
      translations: [],
      wordForms: [],
      ukMp3: ttsURL(),
      usMp3: ttsURL()
    };

    var pm = firstIn(html, /<span class="z_ts2">拼音<\/span>\s*<span class="dicpy">([\s\S]*?)<\/span>/);
    if (pm) result.ukphone = clean(pm);
    var zm = firstIn(html, /<span class="z_ts2">注音<\/span>\s*<span class="dicpy">([\s\S]*?)<\/span>/);
    if (zm) result.zhuyin = clean(zm);

    // 词语解释（cyjj）：只要「解释」段落，跳过「◎ 词 拼音」这种重复词头的行；
    // 国语辞典（gnr）是长篇古籍引证，卡片放不下，不取。
    var jj = boxSegment(html, "nr-box nr-box-shiyi cyjj");
    if (jj) {
      var ji = jj.indexOf('<div class="jnr">');
      if (ji >= 0) {
        var jBody = jj.slice(ji, jj.length);
        var cut = jBody.indexOf('<div class="h_line1">');
        if (cut < 0) cut = jBody.indexOf("<span class=\"z_ts4\">");
        if (cut > 0) jBody = jBody.slice(0, cut);
        paraRawItems(jBody).forEach(function (raw) {
          var t = clean(raw).replace(/^[◎●•·]\s*/, "");
          if (!t) return;
          if (isWordHeadLine(raw, t, word)) return;
          result.translations.push({ pos: "", meaning: truncate(t, 300) });
        });
      }
    }

    // 成语解释（cyjs）：【解释】【出处】【示例】【近义词】【反义词】【语法】逐条一行
    var cy = boxSegment(html, "nr-box nr-box-shiyi cyjs");
    if (cy) {
      paraItems(cy).forEach(function (t) {
        if (t) result.translations.push({ pos: "", meaning: truncate(t, 300) });
      });
    }

    // 网络解释（wljs）兜底：仅当前面两类都没取到时使用
    if (result.translations.length === 0) {
      var wl = boxSegment(html, "nr-box nr-box-shiyi wljs");
      if (wl) {
        var liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
        var lm;
        while ((lm = liRe.exec(wl)) !== null) {
          var t = clean(lm[1]);
          if (t && t.length > String(word).length) {
            result.translations.push({ pos: "", meaning: truncate(t, 300) });
          }
        }
      }
    }

    if (result.translations.length === 0 && !result.ukphone) return null;
    // 卡片高度有限：释义条数上限，避免超长词条把卡片撑爆
    if (result.translations.length > 12) {
      result.translations = result.translations.slice(0, 12);
    }
    return result;
  }

  // ---------- 对外接口 ----------

  // 是否含中文（CJK 基本区/扩展 A/兼容区 + 扩展 B 及以上代理对）
  function isChineseText(text) {
    var s = String(text || "");
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) return true;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var cp = codePointOf(s.slice(i, i + 2));
        if (cp >= 0x20000 && cp <= 0x3134f) return true;
      }
    }
    return false;
  }

  function fetchHTML(url) {
    return MNNetwork.fetch(url, {
      method: "GET",
      timeout: 12,
      headers: { "Accept-Language": "zh-CN,zh;q=0.9" }
    }).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        if (res.status === 404) {
          throw new Error("新华词典未收录该词条（HTTP 404）");
        }
        throw new Error("新华词典 HTTP " + res.status);
      }
      return res.text();
    });
  }

  // 选中的文本常带首尾标点（「遇，」「（遇）」），查词前去掉，避免被当成多字词条。
  // 只去首尾，保留词内字符（如「一诺千金」中的连字符不受影响）。
  var EDGE_PUNCT = /^[\s，。！？；：、·—～…“”‘’（）〈〉《》【】〔〕「」『』!?,.;:'"()\[\]{}<>+\-=|~`@#$%^&*]+|[\s，。！？；：、·—～…“”‘’（）〈〉《》【】〔〕「」『』!?,.;:'"()\[\]{}<>+\-=|~`@#$%^&*]+$/g;

  function trimPunct(text) {
    var t = String(text == null ? "" : text);
    var prev = null;
    // 循环剥离：反复去掉两端标点，直到稳定（如「（遇）」→「遇」）
    while (prev !== t) {
      prev = t;
      t = t.replace(EDGE_PUNCT, "");
    }
    return t.trim();
  }

  return {
    // 返回 Promise<result>，result 结构见文件头注释
    lookup: function (word) {
      var text = trimPunct(word);
      if (!text) {
        return Promise.reject(new Error("查询内容为空"));
      }
      if (!isChineseText(text)) {
        return Promise.reject(new Error("新华词典仅支持中文查询（汉字 / 词语 / 成语）；查英文单词请切换到其它查词服务"));
      }
      if (isSingleChar(text)) {
        var url = charURL(text);
        if (!url) {
          return Promise.reject(new Error("新华词典暂未收录生僻字「" + text + "」（扩展 B 区及以上），可切换其它查词服务"));
        }
        return fetchHTML(url).then(function (html) {
          var parsed = parseChar(html, text);
          if (!parsed) throw new Error("未找到该字的释义");
          return parsed;
        });
      }
      return fetchHTML(wordURL(text)).then(function (html) {
        var parsed = parseWord(html, text);
        if (!parsed) throw new Error("未找到该词语的释义");
        return parsed;
      });
    },

    // 供自测/诊断：暴露 URL 规则
    urlFor: function (word) {
      var text = trimPunct(word);
      if (!text) return "";
      return isSingleChar(text) ? charURL(text) : wordURL(text);
    }
  };
})();
