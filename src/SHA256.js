// SHA256.js —— 纯 JS SHA256 + HMAC-SHA256（JSCore 环境无原生 crypto，需自行实现）
// 用途：腾讯云机器翻译 TMT 的 TC3-HMAC-SHA256 签名
// 实现：FIPS 180-4 SHA-256（标准 32 位字运算）+ RFC 2104 HMAC；输入 JS 字符串（UTF-8）。
// 对外接口：
//   MNIATSHA256.hex(str)              —— sha256(str) 的 64 位小写十六进制
//   MNIATSHA256.hmacHex(keyStr, msg)  —— HMAC-SHA256 的 64 位小写十六进制（key 为字符串）
//   MNIATSHA256.hmacBytes(keyBytes,msg)—— HMAC-SHA256 的 32 字节数组结果
//                                        （TC3 派生密钥链式用：key 为上一层的二进制字节数组）
//
// 验证向量：
//   sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
//   sha256("")    = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
//   HMAC(key="key", "The quick brown fox jumps over the lazy dog")
//     = f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8
//   腾讯云 TC3 官方示例（cvm, 2019-02-25, SecretKey=Gu5t9xGARNpq86cd98joQYCN3Cozk1qA）：
//     SecretDate=da98fb70dcf6b112dc21038d1eeeb3a95c74b4dcb12c1131f864f6066bd02be0
//     SecretService=8d70cbefb03939f929db64d32dc2ba89b1095620119fe3e050e2b18c5bd2752f
//     SecretSigning=b596b923aad85185e2d1f6659d2a062e0a86731226e021e61bfe06f7ed05f5af
//     Signature=10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f

var MNIATSHA256 = (function () {
  "use strict";

  // ---- UTF-8 编码：JS 字符串 → 字节数组（与 MD5.js / SHA1.js 同款）----
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

  // ---- SHA-256 轮常量（前 64 个素数的立方根小数部分）----
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  // 内部：对字节数组做 SHA-256，返回 32 字节大端结果
  function sha256Bytes(bytes) {
    // 位长度（64 位）：高 32 位 = 字节数 / 2^29，低 32 位 = (字节数*8) & 0xffffffff
    var bitLenHigh = Math.floor(bytes.length / 0x20000000);
    var bitLenLow = (bytes.length * 8) & 0xffffffff;

    var padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0x00);
    var j;
    for (j = 3; j >= 0; j--) padded.push((bitLenHigh >>> (j * 8)) & 0xff);
    for (j = 3; j >= 0; j--) padded.push((bitLenLow >>> (j * 8)) & 0xff);

    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    for (var off = 0; off < padded.length; off += 64) {
      var w = [];
      var i, b;
      for (i = 0; i < 16; i++) {
        b = off + i * 4;
        w[i] = ((padded[b] << 24) | (padded[b + 1] << 16) | (padded[b + 2] << 8) | padded[b + 3]) | 0;
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], bv = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & bv) ^ (a & c) ^ (bv & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bv; bv = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + bv) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + hh) | 0;
    }

    var out = [];
    for (var oi = 0; oi < 8; oi++) {
      out.push((h[oi] >>> 24) & 0xff, (h[oi] >>> 16) & 0xff, (h[oi] >>> 8) & 0xff, h[oi] & 0xff);
    }
    return out;
  }

  function bytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      if (h.length < 2) h = "0" + h;
      hex += h;
    }
    return hex;
  }

  // HMAC-SHA256：key 为字节数组（允许二进制派生密钥），返回 32 字节数组
  function hmacBytes(keyBytes, msgStr) {
    var key = keyBytes;
    if (key.length > 64) key = sha256Bytes(key);
    var ipad = [];
    var opad = [];
    for (var i = 0; i < 64; i++) {
      var kb = i < key.length ? key[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    var inner = sha256Bytes(ipad.concat(utf8Bytes(msgStr)));
    return sha256Bytes(opad.concat(inner));
  }

  // 对外接口
  function hex(str) {
    return bytesToHex(sha256Bytes(utf8Bytes(str)));
  }

  function hmacHex(keyStr, msgStr) {
    return bytesToHex(hmacBytes(utf8Bytes(keyStr), msgStr));
  }

  return {
    hex: hex,
    hmacHex: hmacHex,
    hmacBytes: hmacBytes,
    // TC3 派生链辅助：字符串 → UTF-8 字节数组；字节数组 → 小写 hex
    toBytes: utf8Bytes,
    bytesToHex: bytesToHex
  };
})();
