// YoudaoService.js —— 有道词典查词（免费 web 接口，无需 key）
// 接口：https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&q=<word>
// 发音：https://dict.youdao.com/dictvoice?audio=<word>&type=1(英)/2(美) —— 前端 <audio> 直接播放
// 说明：免费接口非官方承诺稳定，解析做了防御性兜底；失败时调用方提示用户可切换 AI 解释。

var MNIATYoudao = (function () {

  function lookupURL(word) {
    return "https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&q=" +
      encodeURIComponent(word);
  }

  function pronounceURL(word, accent) {
    // accent: "uk" -> type=1, "us" -> type=2
    var type = accent === "uk" ? 1 : 2;
    return "https://dict.youdao.com/dictvoice?audio=" +
      encodeURIComponent(word) + "&type=" + type;
  }

  // 从 jsonapi_s 响应中提取结构化词条，尽量容错
  // 实测结构（2026-08-07 用 curl 验证）：
  //   ec.word = { ukphone, usphone, trs: [{ pos, tran }] }  ← 扁平结构，不是 tr[0].l.i
  //   web_trans["web-translation"][0].trans[].value        ← 网络释义兜底
  function parseResult(obj, word) {
    if (!obj || typeof obj !== "object") return null;

    var result = {
      word: word,
      ukphone: "",
      usphone: "",
      translations: []   // [{pos, meaning}]
    };

    try {
      // ec = English-Chinese 词典
      var ec = obj.ec;
      var entry = null;
      if (ec && ec.word) {
        entry = Array.isArray(ec.word) ? ec.word[0] : ec.word;
      }
      if (entry) {
        result.ukphone = entry.ukphone || "";
        result.usphone = entry.usphone || "";
        if (entry.trs && Array.isArray(entry.trs)) {
          entry.trs.forEach(function (tr) {
            if (!tr) return;
            // 扁平结构：{ pos, tran }
            if (tr.tran) {
              result.translations.push({ pos: tr.pos || "", meaning: String(tr.tran) });
              return;
            }
            // 兼容旧结构：{ tr: [{ l: { i: [...] } }] }
            var item = tr.tr && tr.tr[0];
            var li = item && item.l && item.l.i && item.l.i[0];
            if (li) {
              result.translations.push({ pos: tr.pos || "", meaning: String(li) });
            }
          });
        }
      }

      // 兜底：网络释义（web_trans）
      if (result.translations.length === 0 && obj.web_trans) {
        var webTrans = obj.web_trans["web-translation"];
        if (Array.isArray(webTrans) && webTrans[0] && Array.isArray(webTrans[0].trans)) {
          webTrans[0].trans.forEach(function (t) {
            if (t && t.value) {
              result.translations.push({ pos: "网络", meaning: String(t.value) });
            }
          });
        }
      }

      // 再兜底：ce 结构（中译英场景）
      if (result.translations.length === 0 && obj.ce && obj.ce.word) {
        var ceEntry = Array.isArray(obj.ce.word) ? obj.ce.word[0] : obj.ce.word;
        if (ceEntry && ceEntry.trs) {
          ceEntry.trs.forEach(function (tr) {
            if (tr && tr.tran) {
              result.translations.push({ pos: tr.pos || "", meaning: String(tr.tran) });
            }
          });
        }
      }
    } catch (e) {
      console.log("[MNIATYoudao] parse error: " + e);
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
        timeout: 10,
        headers: { "Accept": "application/json" }
      }).then(function (res) {
        if (res.status < 200 || res.status >= 300) {
          throw new Error("有道接口 HTTP " + res.status);
        }
        var obj = res.json();
        var parsed = parseResult(obj, word);
        if (!parsed) {
          throw new Error("未找到该单词的释义");
        }
        return parsed;
      });
    }
  };
})();
