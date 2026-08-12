// SHA1.js —— 纯 JS SHA1 + HMAC-SHA1（JSCore 环境无原生 crypto，需自行实现）
// 用途：阿里云机器翻译 RPC 签名（Signature = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))）
// 实现：标准 SHA-1（FIPS 180-1）+ RFC 2104 HMAC；输入为 JS 字符串（自动按 UTF-8 编码）。
// 对外接口：
//   MNIATSHA1.hex(str)            —— sha1(str) 的 40 位小写十六进制（测试对照用）
//   MNIATSHA1.hmacHex(key, msg)   —— HMAC-SHA1 的 40 位小写十六进制
//   MNIATSHA1.hmacBase64(key,msg) —— HMAC-SHA1 结果的 Base64（阿里云签名用）
//
// 验证向量：
//   sha1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d
//   HMAC(key="key", msg="The quick brown fox jumps over the lazy dog")
//     = de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9（RFC 2202 风格）
//   阿里云 RPC 官方示例（ECS）见代码内注释。

var MNIATSHA1 = (function () {
  "use strict";

  // ---- UTF-8 编码：JS 字符串 → 字节数组（与 MD5.js 同款）----
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

  function rotateLeft(num, cnt) {
    return ((num << cnt) | (num >>> (32 - cnt))) >>> 0;
  }

  // ---- SHA-1 核心：字节数组 → 20 字节摘要数组 ----
  function sha1Bytes(bytes) {
    var h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

    // 填充：0x80 + 0 直到长度 ≡ 56 (mod 64)，最后 8 字节 = 原始比特长度（64 位大端）
    var ml = bytes.length * 8;
    var lenLow = ml & 0xffffffff;
    var lenHigh = Math.floor(ml / 0x100000000) & 0xffffffff;

    var padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0x00);
    // 大端写入 64 位长度（高 4 字节在前）
    padded.push((lenHigh >>> 24) & 0xff, (lenHigh >>> 16) & 0xff, (lenHigh >>> 8) & 0xff, lenHigh & 0xff);
    padded.push((lenLow >>> 24) & 0xff, (lenLow >>> 16) & 0xff, (lenLow >>> 8) & 0xff, lenLow & 0xff);

    var w = new Array(80);
    for (var off = 0; off < padded.length; off += 64) {
      var i;
      for (i = 0; i < 16; i++) {
        var b = off + i * 4;
        w[i] = ((padded[b] << 24) | (padded[b + 1] << 16) | (padded[b + 2] << 8) | padded[b + 3]) >>> 0;
      }
      for (i = 16; i < 80; i++) {
        w[i] = rotateLeft(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      }

      var a = h0, b2 = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b2 & c) | (~b2 & d); k = 0x5a827999; }
        else if (i < 40) { f = b2 ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b2 & c) | (b2 & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b2 ^ c ^ d; k = 0xca62c1d6; }
        // JS 数字为双精度，加法结果 < 2^53 无精度损失，最后取低 32 位
        var temp = (rotateLeft(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotateLeft(b2, 30); b2 = a; a = temp;
      }

      h0 = (h0 + a) >>> 0; h1 = (h1 + b2) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }

    return [
      (h0 >>> 24) & 0xff, (h0 >>> 16) & 0xff, (h0 >>> 8) & 0xff, h0 & 0xff,
      (h1 >>> 24) & 0xff, (h1 >>> 16) & 0xff, (h1 >>> 8) & 0xff, h1 & 0xff,
      (h2 >>> 24) & 0xff, (h2 >>> 16) & 0xff, (h2 >>> 8) & 0xff, h2 & 0xff,
      (h3 >>> 24) & 0xff, (h3 >>> 16) & 0xff, (h3 >>> 8) & 0xff, h3 & 0xff,
      (h4 >>> 24) & 0xff, (h4 >>> 16) & 0xff, (h4 >>> 8) & 0xff, h4 & 0xff
    ];
  }

  // ---- HMAC-SHA1（RFC 2104）：字节数组 → 20 字节数组 ----
  function hmacSha1Bytes(keyBytes, msgBytes) {
    var blockSize = 64;
    var key = keyBytes.slice();
    if (key.length > blockSize) {
      key = sha1Bytes(key);
    }
    var ipad = new Array(blockSize);
    var opad = new Array(blockSize);
    var i;
    for (i = 0; i < blockSize; i++) {
      var kb = i < key.length ? key[i] : 0;
      ipad[i] = kb ^ 0x36;
      opad[i] = kb ^ 0x5c;
    }
    var inner = sha1Bytes(ipad.concat(msgBytes));
    return sha1Bytes(opad.concat(inner));
  }

  // ---- Base64 编码：字节数组 → 字符串 ----
  var B64_TAB = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToBase64(bytes) {
    var out = "";
    var i;
    for (i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64_TAB.charAt(b0 >> 2);
      out += B64_TAB.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
      out += i + 1 < bytes.length ? B64_TAB.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : "=";
      out += i + 2 < bytes.length ? B64_TAB.charAt(b2 & 0x3f) : "=";
    }
    return out;
  }

  // ---- 对外接口 ----
  function bytesToHex(bytes) {
    var hexTab = "0123456789abcdef";
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += hexTab.charAt(bytes[i] >> 4) + hexTab.charAt(bytes[i] & 0x0f);
    }
    return out;
  }

  return {
    // sha1(str) 十六进制（测试对照）
    hex: function (str) {
      return bytesToHex(sha1Bytes(utf8Bytes(String(str))));
    },
    // HMAC-SHA1(key, msg) 十六进制
    hmacHex: function (key, msg) {
      return bytesToHex(hmacSha1Bytes(utf8Bytes(String(key)), utf8Bytes(String(msg))));
    },
    // HMAC-SHA1(key, msg) Base64 —— 阿里云 RPC 签名用
    hmacBase64: function (key, msg) {
      return bytesToBase64(hmacSha1Bytes(utf8Bytes(String(key)), utf8Bytes(String(msg))));
    }
  };
})();
