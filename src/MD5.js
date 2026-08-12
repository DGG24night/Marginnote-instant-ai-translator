// MD5.js —— 纯 JS MD5 实现（JSCore 环境无内置 MD5/Crypto，百度翻译签名需要）
// 输入：JS 字符串（先按 UTF-8 编码为字节，再计算 MD5 —— 百度要求 q 为 UTF-8 参与签名）
// 输出：32 位小写十六进制字符串
// 算法：RFC 1321；核心移植自 blueimp JavaScript MD5（MIT License，业界广泛验证），
//       https://github.com/blueimp/JavaScript-MD5
// 无任何外部依赖，仅用位运算与数组。

var MNIATMD5 = (function () {
  // UTF-8 编码字符串为字节数组（正确处理代理对 emoji 等）
  function utf8Bytes(str) {
    var bytes = [];
    var i = 0;
    var len = String(str).length;
    while (i < len) {
      var code = String(str).charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code >= 0xd800 && code <= 0xdbff) {
        var code2 = i + 1 < len ? String(str).charCodeAt(i + 1) : 0;
        if (code2 >= 0xdc00 && code2 <= 0xdfff) {
          var cp = ((code - 0xd800) << 10) + (code2 - 0xdc00) + 0x10000;
          bytes.push(
            0xf0 | (cp >> 18),
            0x80 | ((cp >> 12) & 0x3f),
            0x80 | ((cp >> 6) & 0x3f),
            0x80 | (cp & 0x3f)
          );
          i += 2;
          continue;
        }
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
      i += 1;
    }
    return bytes;
  }

  // 32 位加法（16 位分段运算，规避解释器大数加法问题，blueimp 同款）
  function safeAdd(x, y) {
    var lsw = (x & 0xffff) + (y & 0xffff);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function bitRotateLeft(num, cnt) {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  function md5cmn(q, a, b, x, s, t) {
    return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

  // 核心 64 步（blueimp binlMD5 展开版，常数与其逐字一致）
  function md5cycle(x, k) {
    var a = x[0], b = x[1], c = x[2], d = x[3];

    a = md5ff(a, b, c, d, k[0], 7, -680876936);
    d = md5ff(d, a, b, c, k[1], 12, -389564586);
    c = md5ff(c, d, a, b, k[2], 17, 606105819);
    b = md5ff(b, c, d, a, k[3], 22, -1044525330);
    a = md5ff(a, b, c, d, k[4], 7, -176418897);
    d = md5ff(d, a, b, c, k[5], 12, 1200080426);
    c = md5ff(c, d, a, b, k[6], 17, -1473231341);
    b = md5ff(b, c, d, a, k[7], 22, -45705983);
    a = md5ff(a, b, c, d, k[8], 7, 1770035416);
    d = md5ff(d, a, b, c, k[9], 12, -1958414417);
    c = md5ff(c, d, a, b, k[10], 17, -42063);
    b = md5ff(b, c, d, a, k[11], 22, -1990404162);
    a = md5ff(a, b, c, d, k[12], 7, 1804603682);
    d = md5ff(d, a, b, c, k[13], 12, -40341101);
    c = md5ff(c, d, a, b, k[14], 17, -1502002290);
    b = md5ff(b, c, d, a, k[15], 22, 1236535329);

    a = md5gg(a, b, c, d, k[1], 5, -165796510);
    d = md5gg(d, a, b, c, k[6], 9, -1069501632);
    c = md5gg(c, d, a, b, k[11], 14, 643717713);
    b = md5gg(b, c, d, a, k[0], 20, -373897302);
    a = md5gg(a, b, c, d, k[5], 5, -701558691);
    d = md5gg(d, a, b, c, k[10], 9, 38016083);
    c = md5gg(c, d, a, b, k[15], 14, -660478335);
    b = md5gg(b, c, d, a, k[4], 20, -405537848);
    a = md5gg(a, b, c, d, k[9], 5, 568446438);
    d = md5gg(d, a, b, c, k[14], 9, -1019803690);
    c = md5gg(c, d, a, b, k[3], 14, -187363961);
    b = md5gg(b, c, d, a, k[8], 20, 1163531501);
    a = md5gg(a, b, c, d, k[13], 5, -1444681467);
    d = md5gg(d, a, b, c, k[2], 9, -51403784);
    c = md5gg(c, d, a, b, k[7], 14, 1735328473);
    b = md5gg(b, c, d, a, k[12], 20, -1926607734);

    a = md5hh(a, b, c, d, k[5], 4, -378558);
    d = md5hh(d, a, b, c, k[8], 11, -2022574463);
    c = md5hh(c, d, a, b, k[11], 16, 1839030562);
    b = md5hh(b, c, d, a, k[14], 23, -35309556);
    a = md5hh(a, b, c, d, k[1], 4, -1530992060);
    d = md5hh(d, a, b, c, k[4], 11, 1272893353);
    c = md5hh(c, d, a, b, k[7], 16, -155497632);
    b = md5hh(b, c, d, a, k[10], 23, -1094730640);
    a = md5hh(a, b, c, d, k[13], 4, 681279174);
    d = md5hh(d, a, b, c, k[0], 11, -358537222);
    c = md5hh(c, d, a, b, k[3], 16, -722521979);
    b = md5hh(b, c, d, a, k[6], 23, 76029189);
    a = md5hh(a, b, c, d, k[9], 4, -640364487);
    d = md5hh(d, a, b, c, k[12], 11, -421815835);
    c = md5hh(c, d, a, b, k[15], 16, 530742520);
    b = md5hh(b, c, d, a, k[2], 23, -995338651);

    a = md5ii(a, b, c, d, k[0], 6, -198630844);
    d = md5ii(d, a, b, c, k[7], 10, 1126891415);
    c = md5ii(c, d, a, b, k[14], 15, -1416354905);
    b = md5ii(b, c, d, a, k[5], 21, -57434055);
    a = md5ii(a, b, c, d, k[12], 6, 1700485571);
    d = md5ii(d, a, b, c, k[3], 10, -1894986606);
    c = md5ii(c, d, a, b, k[10], 15, -1051523);
    b = md5ii(b, c, d, a, k[1], 21, -2054922799);
    a = md5ii(a, b, c, d, k[8], 6, 1873313359);
    d = md5ii(d, a, b, c, k[15], 10, -30611744);
    c = md5ii(c, d, a, b, k[6], 15, -1560198380);
    b = md5ii(b, c, d, a, k[13], 21, 1309151649);
    a = md5ii(a, b, c, d, k[4], 6, -145523070);
    d = md5ii(d, a, b, c, k[11], 10, -1120210379);
    c = md5ii(c, d, a, b, k[2], 15, 718787259);
    b = md5ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = safeAdd(a, x[0]);
    x[1] = safeAdd(b, x[1]);
    x[2] = safeAdd(c, x[2]);
    x[3] = safeAdd(d, x[3]);
  }

  // 字节数组 → 小端 32 位字数组（blueimp rstr2binl 语义，逐字节组装）
  function bytesToWords(bytes) {
    var words = [];
    var n = bytes.length;
    for (var i = 0; i < n; i++) {
      words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
    }
    return words;
  }

  // 小端 32 位字数组 → 32 位小写十六进制（blueimp binl2hex 语义）
  function wordsToHex(words) {
    var hexTab = "0123456789abcdef";
    var out = "";
    var i;
    for (i = 0; i < words.length * 4; i++) {
      out += hexTab.charAt((words[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
        hexTab.charAt((words[i >> 2] >> ((i % 4) * 8)) & 0xf);
    }
    return out;
  }

  function md5Hex(str) {
    var bytes = utf8Bytes(str);
    var bitLen = bytes.length * 8;

    // 填充：补 0x80，再补 0 直到长度 ≡ 56 (mod 64)，最后 8 字节写原始比特长度（小端）
    // 注意：JS 位运算移位量按 mod 32 处理，>>> 32 等价于 >>> 0，长度字段拆低/高
    // 32 位分别写入（与 blueimp 在 words 数组中写 [14]/[30] 等价）。
    var padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0x00);
    var lenLow = bitLen & 0xffffffff;
    var lenHigh = Math.floor(bitLen / 0x100000000) & 0xffffffff;
    var bi;
    for (bi = 0; bi < 4; bi++) padded.push((lenLow >>> (bi * 8)) & 0xff);
    for (bi = 0; bi < 4; bi++) padded.push((lenHigh >>> (bi * 8)) & 0xff);

    var words = bytesToWords(padded);
    // 初始 state（RFC 1321 魔数，带符号 32 位）
    var state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for (var off = 0; off < words.length; off += 16) {
      var block = [];
      for (var wi = 0; wi < 16; wi++) block[wi] = words[off + wi] || 0;
      // md5cycle 内部以 x 为 state 做累加（x[0..3] = safeAdd(a, olda)），
      // 传入同一数组即可在块间保持状态。
      md5cycle(state, block);
    }

    return wordsToHex(state);
  }

  return {
    hex: md5Hex
  };
})();
