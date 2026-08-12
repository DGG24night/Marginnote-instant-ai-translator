// KingsoftDictionaryService.js —— 金山词霸查词（免费 web 接口，无需 key）
// 接口：https://www.iciba.com/word?w=<word> （服务端渲染 Next.js 页面，
//   HTML 中内嵌 <script id="__NEXT_DATA__"> JSON，结构化数据来源）
// 发音：baesInfo.symbols[0].ph_en_mp3 / ph_am_mp3 / ph_tts_mp3，直接 <audio> 播放
// 说明：
//   - **必须用桌面 UA**：插件默认 UA 是 iPhone（Mozilla/5.0 (iPhone; ...)），
//     金山词霸对手机 UA 返回 302 → m.iciba.com（Nuxt 空壳页，无 __NEXT_DATA__，
//     解析永远失败 → "未找到该单词的释义"）。故请求头覆盖为桌面 Mac Safari UA。
//   - 直接 GET 页面 HTML，提取 __NEXT_DATA__ JSON（JSCore 用 NSJSONSerialization 解析）；
//   - 关键数据在 props.pageProps.initialReduxState.word.wordInfo.baesInfo：
//       word_name: 实际命中的词（可能与请求词大小写不同）
//       symbols[0]: { ph_en, ph_am, ph_en_mp3, ph_am_mp3, ph_tts_mp3, parts: [{part, means}] }
//       baesElse: 大小写变形的其他词条（如请求 INTERFACE 时小写 interface 在此）；
//   - miss 情况（拼写错等）→ baesInfo 内无 symbols，转写 baesInfo.translate_result 兜底；
//     此时视为「未命中」，由调用方提示用户切 AI 解释。

var MNIATKingsoft = (function () {

  // 桌面 Safari UA：www.iciba.com 对手机 UA 302 → m.iciba.com 空壳页
  var DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15";

  function pageURL(word) {
    return "https://www.iciba.com/word?w=" + encodeURIComponent(word);
  }

  // 把 //cdn.xxx/... 或 http://cdn.xxx/... 统一为 https://，避免 WebView 解析混合协议失败
  function normalizeURL(u) {
    if (!u) return "";
    var s = String(u).trim();
    if (!s) return "";
    if (s.indexOf("//") === 0) return "https:" + s;
    if (s.indexOf("http://") === 0) return "https://" + s.slice("http://".length);
    return s;
  }

  // 从 __NEXT_DATA__ JSON 文本中提取并解析。
  // 注意：必须用 JSON.parse（JSCore 标准内置对象，mn-docs「JavaScript 原生环境」
  // 文档确认 JSON 可用），**不要**用 NSString.stringWithString(...).dataUsingEncoding(4)
  // 转 NSData 再 NSJSONSerialization——该桥接路径在 JSCore 中不可靠（实测
  // 2026-08-12：金山词霸所有词都"未找到该单词的释义"即因此），
  // 且 NSJSONSerialization 只能直接解析 NSData（网络回调里的 data），
  // 不能对 JS 字符串反复编解码。
  function parseNextData(html) {
    if (!html || typeof html !== "string") return null;
    var m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m || !m[1]) return null;
    try {
      return JSON.parse(m[1]) || null;
    } catch (e) {
      console.log("[MNIATKingsoft] parseNextData error: " + e);
      return null;
    }
  }

  // 从 wordInfo 抽出结构化词条
  // 返回 null = 未命中（拼错/不存在）
  function parseResult(data, word) {
    if (!data || typeof data !== "object") return null;
    var wordInfo;
    try {
      wordInfo = data.props.pageProps.initialReduxState.word.wordInfo;
    } catch (e) {
      return null;
    }
    if (!wordInfo || typeof wordInfo !== "object") return null;

    var baes = wordInfo.baesInfo;
    if (!baes || typeof baes !== "object") return null;

    var symbols = baes.symbols;
    // miss 情况（拼错/不存在）：baesInfo.translate_result 兜底，无 symbols
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return null;
    }
    var sym = symbols[0] || {};

    // 词头用金山给出的 word_name（大小写正确），与用户输入不同时以前端约定不强行覆盖
    var result = {
      word: (baes.word_name || word || "").trim() || word,
      ukphone: sym.ph_en || "",
      usphone: sym.ph_am || "",
      // 发音链接：优先真实词库音频，回退 TTS
      ukMp3: normalizeURL(sym.ph_en_mp3) || normalizeURL(sym.ph_tts_mp3),
      usMp3: normalizeURL(sym.ph_am_mp3) || normalizeURL(sym.ph_tts_mp3),
      translations: []
    };

    // 主释义：symbols[0].parts = [{ part: "n.", means: ["界面", "接口", ...] }, ...]
    if (Array.isArray(sym.parts)) {
      sym.parts.forEach(function (p) {
        if (!p || typeof p !== "object") return;
        var pos = (p.part || "").toString().trim();
        var means = Array.isArray(p.means) ? p.means : [];
        means.forEach(function (m) {
          var t = (m == null ? "" : String(m)).trim();
          if (t) result.translations.push({ pos: pos, meaning: t });
        });
      });
    }

    // 兜底 1：collins 柯林斯英文释义（将中文译放在 meaning 里，前面拼上英文原句太长，作为补充）
    if (result.translations.length === 0 && Array.isArray(wordInfo.collins)) {
      wordInfo.collins.forEach(function (g) {
        if (!g || !Array.isArray(g.entry)) return;
        g.entry.forEach(function (e) {
          if (!e || !e.tran) return;
          var def = (e.def || "").toString().replace(/<[^>]*>/g, "").trim();
          var pos = (e.posp || "").toString().trim();
          var lines = [];
          if (def) lines.push(def);
          lines.push(e.tran);
          var combined = lines.filter(Boolean).join(" / ");
          if (combined) result.translations.push({ pos: pos, meaning: combined });
        });
      });
    }

    // 兜底 2：bidec 简明英汉词典（前面是释义列表，最末可能含截断 </seg> 残留，清洗掉）
    if (result.translations.length === 0 && wordInfo.bidec && Array.isArray(wordInfo.bidec.parts)) {
      wordInfo.bidec.parts.forEach(function (p) {
        if (!p) return;
        var pos = (p.part_name || "").toString().trim();
        (p.means || []).forEach(function (m) {
          if (!m) return;
          var t = (m.word_mean || "").toString().replace(/<[^>]*>/g, "").replace(/<\/seg>/g, "").trim();
          if (t) result.translations.push({ pos: pos, meaning: t });
        });
      });
    }

    // 兜底 3：机器翻译结果（拼错词时页面会带 baesInfo.translate_result，已在 miss 路径外不会进到这）
    if (result.translations.length === 0) {
      var tr = (baes.translate_result || "").toString().trim();
      if (tr) result.translations.push({ pos: "", meaning: tr });
    }

    if (result.translations.length === 0 && !result.ukphone && !result.usphone) {
      return null;
    }
    return result;
  }

  return {
    // 返回 Promise<result>，结构与其他词典服务一致（含 ukMp3/usMp3）
    lookup: function (word) {
      return MNNetwork.fetch(pageURL(word), {
        method: "GET",
        timeout: 12,
        headers: {
          "User-Agent": DESKTOP_UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          "Accept": "text/html"
        }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) {
          throw new Error("金山词霸接口 HTTP " + res.status);
        }
        var data = parseNextData(res.text());
        var parsed = parseResult(data, word);
        if (!parsed) {
          throw new Error("未找到该单词的释义");
        }
        return parsed;
      });
    }
  };
})();
