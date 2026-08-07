// base64.js —— Base64 解码与 UTF-8 字节级解码工具
// 来源：mn-docs「网络请求」教程（Base64 部分原文），追加 UTF-8 解码用于流式切包。
// 说明：Base64.decode 输出为「字节语义字符串」（每个 charCode 即一个字节，Latin-1 语义），
//       这样在流式场景中按字节切割不会丢失多字节字符信息，需再用 UTF8.decode 转为文本。

var MNIATBase64 = {
  _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

  decode: function (input) {
    var output = "";
    var i = 0;
    var chr1, chr2, chr3, enc1, enc2, enc3, enc4;

    while (i < input.length) {
      enc1 = this._keyStr.indexOf(input.charAt(i++));
      enc2 = this._keyStr.indexOf(input.charAt(i++));
      enc3 = this._keyStr.indexOf(input.charAt(i++));
      enc4 = this._keyStr.indexOf(input.charAt(i++));

      chr1 = (enc1 << 2) | (enc2 >> 4);
      chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      chr3 = ((enc3 & 3) << 6) | enc4;

      output = output + String.fromCharCode(chr1);
      if (enc3 != 64) {
        output = output + String.fromCharCode(chr2);
      }
      if (enc4 != 64) {
        output = output + String.fromCharCode(chr3);
      }
    }

    return output;
  }
};

var MNIATUTF8 = {
  // 将字节语义字符串（Latin-1）按 UTF-8 解码为 JS 字符串
  decode: function (byteStr) {
    var out = "";
    var i = 0;
    var len = byteStr.length;
    while (i < len) {
      var c = byteStr.charCodeAt(i);
      if (c < 0x80) {
        out += String.fromCharCode(c);
        i += 1;
      } else if (c < 0xe0) {
        // 2 字节
        if (i + 1 < len) {
          var c2 = byteStr.charCodeAt(i + 1);
          out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
        }
        i += 2;
      } else if (c < 0xf0) {
        // 3 字节
        if (i + 2 < len) {
          var c2 = byteStr.charCodeAt(i + 1);
          var c3 = byteStr.charCodeAt(i + 2);
          out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
        }
        i += 3;
      } else {
        // 4 字节（代理对）
        if (i + 3 < len) {
          var c2 = byteStr.charCodeAt(i + 1);
          var c3 = byteStr.charCodeAt(i + 2);
          var c4 = byteStr.charCodeAt(i + 3);
          var codePoint = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
          codePoint -= 0x10000;
          out += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
        }
        i += 4;
      }
    }
    return out;
  }
};
