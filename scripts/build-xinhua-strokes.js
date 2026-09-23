#!/usr/bin/env node
// build-xinhua-strokes.js —— 生成 src/XinhuaStrokes.js（新华字典字页「总笔画」表）
//
// 背景：
//   新华字典（zidian.gushici.net）单字页 URL 形如 https://zidian.gushici.net/12/9047.html，
//   第一段是「总笔画」，第二段是 Unicode 码点十六进制。客户端要构造该 URL，必须知道
//   某字的总笔画——站点没有服务端搜索接口（搜索是前端用 so.gushici.net 的分片索引
//   做本地匹配，索引文件为自定义混淆二进制，无法在插件 JSCore 里复现）。
//   因此改为离线把整张表抓下来，编码后固化进插件（见 src/XinhuaStrokes.js 注释）。
//
// 原理：
//   站点的搜索前端是 https://so.gushici.net/js/{lz-string.min.js,zidian.min.js}，
//   在 Node 的 vm 里跑这两个脚本，把 fetch 打到真实网络，即得到官方映射：
//     ZidianApp.search("遇") -> "/12/9047.html"
//   遍历 CJK 区块即可得到整张「码点 → 总笔画」表。
//
// 用法（需要联网）：
//   node scripts/build-xinhua-strokes.js
//   产物：src/XinhuaStrokes.js
//
// 说明：本脚本只在表需要重建（站点数据更新 / 覆盖范围调整）时手动执行；
//       日常构建不依赖它，插件运行时也不再访问站点索引。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "src", "XinhuaStrokes.js");

// 覆盖范围：CJK 统一表意文字（基本区）+ 扩展 A + 兼容区。
// 扩展 B 及以后（U+20000+，如 𠮷、𪚥）生僻字不做内嵌：站点虽有收录，
// 但 4 万+ 码点会让数据文件翻倍，收益极低；插件侧对表外字给出明确提示。
const RANGES = [
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xf900, 0xfaff], // CJK 兼容表意文字
];

// 编码字母表：下标 = 总笔画数（0 = 站点未收录 / 表外），共 65 个字符。
// 全部为 JS 字符串里无需转义的 ASCII，一个码点占 1 个字符。
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+_.";

const LZ_URL = "https://so.gushici.net/js/lz-string.min.js";
const APP_URL = "https://so.gushici.net/js/zidian.min.js";
const ROOT_URL = "https://so.gushici.net";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${url} -> HTTP ${res.status}`);
  return await res.text();
}

// 在 vm 里跑站点搜索前端（document/window 用最小桩，fetch 透传真实网络）
async function createSearchEngine() {
  const shim = {
    console: { log() {}, error() {}, warn() {} },
    window: {},
    document: {
      addEventListener() {},
      querySelector() { return null; },
      createElement() {
        return { set src(v) {}, get src() { return ""; }, appendChild() {} };
      },
      body: { appendChild() {} },
      getElementById() { return null; },
    },
    fetch: async (url) => {
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        ok: true,
        status: res.status,
        arrayBuffer: async () => buf,
        text: async () => buf.toString("utf8"),
      };
    },
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    Date,
    JSON,
    String,
    Number,
    Array,
    Object,
    RegExp,
    Error,
    Uint8Array,
    DataView,
    ArrayBuffer,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
  };
  shim.self = shim;
  shim.globalThis = shim;
  const ctx = vm.createContext(shim);

  vm.runInContext(await fetchText(LZ_URL), ctx, { filename: "lz-string.min.js" });
  vm.runInContext(await fetchText(APP_URL), ctx, { filename: "zidian.min.js" });

  const app = shim.window.ZidianApp;
  if (!app || typeof app.search !== "function") {
    throw new Error("站点搜索前端结构已变化：未取到 window.ZidianApp.search");
  }
  app.setRoot(ROOT_URL);
  await app.init();
  return app;
}

async function buildTable(app) {
  const sections = [];
  let covered = 0;
  let total = 0;
  for (const [lo, hi] of RANGES) {
    const chars = [];
    for (let cp = lo; cp <= hi; cp++) {
      total++;
      let strokes = 0;
      try {
        const url = await app.search(String.fromCodePoint(cp));
        const m = url && /^\/(\d+)\/[0-9a-f]+\.html$/.exec(url);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > 0 && n < ALPHABET.length) strokes = n;
        }
      } catch (e) {
        strokes = 0;
      }
      if (strokes > 0) covered++;
      chars.push(ALPHABET.charAt(strokes));
    }
    sections.push({ start: lo, end: hi, data: chars.join("") });
    process.stderr.write(
      `  0x${lo.toString(16)}-0x${hi.toString(16)}: ${chars.length} 码点\n`
    );
  }
  return { sections, covered, total };
}

function renderFile(sections, stats) {
  const body = sections
    .map((s) => `    { start: 0x${s.start.toString(16)}, data: "${s.data}" }`)
    .join(",\n");
  return `// XinhuaStrokes.js —— 新华字典（zidian.gushici.net）单字页所需的「总笔画」表
//
// ⚠️ 本文件由 scripts/build-xinhua-strokes.js 生成，请勿手工编辑。
//
// 用途：MNIATXinhua 查单字时要把 URL 拼成
//   https://zidian.gushici.net/<总笔画>/<unicode 十六进制>.html
//   例：遇 → /12/9047.html，一 → /1/4e00.html
// 站点没有服务端搜索接口（检索由前端用分片索引在本地完成，索引是自定义混淆二进制，
// 无法在 JSCore 里复现），因此这里把「码点 → 总笔画」离线抓下来固化。
//
// 编码：每段 RANGES[i].data 中，第 k 个字符对应码点 (start + k)，
//       字符取值 = ALPHABET 的下标 = 总笔画数；下标 0 表示站点未收录该字。
//       覆盖范围：CJK 扩展 A（3400-4DBF）+ 基本区（4E00-9FFF）+ 兼容区（F900-FAFF），
//       共 ${stats.total} 个码点，其中站点收录 ${stats.covered} 个。
//       表外（如扩展 B 𠮷 等生僻字）返回 0，由调用方给出「未收录」提示。

var MNIATXinhuaStrokes = (function () {
  var ALPHABET = "${ALPHABET}";

  var RANGES = [
${body}
  ];

  // 返回码点对应的总笔画数；0 = 不在表内/站点未收录。
  // 只覆盖 BMP 内上述区间：表外字符（含代理对）直接返回 0。
  function strokesOf(text) {
    var s = String(text == null ? "" : text);
    if (s.length === 0) return 0;
    var cp = s.charCodeAt(0);
    for (var i = 0; i < RANGES.length; i++) {
      var r = RANGES[i];
      if (cp >= r.start && cp < r.start + r.data.length) {
        var idx = ALPHABET.indexOf(r.data.charAt(cp - r.start));
        return idx > 0 ? idx : 0;
      }
    }
    return 0;
  }

  return {
    strokesOf: strokesOf,
    // 便于自测/诊断：实际覆盖范围
    coverage: RANGES.map(function (r) {
      return { start: r.start, end: r.start + r.data.length - 1 };
    })
  };
})();
`;
}

async function main() {
  process.stderr.write("× 下载站点搜索前端…\n");
  const app = await createSearchEngine();
  process.stderr.write("√ 引擎就绪，开始遍历码点…\n");
  const { sections, covered, total } = await buildTable(app);
  fs.writeFileSync(OUT_FILE, renderFile(sections, { covered, total }), "utf8");
  process.stderr.write(
    `√ 已写入 ${path.relative(ROOT, OUT_FILE)}（覆盖 ${covered}/${total} 码点）\n`
  );
}

main().catch((err) => {
  process.stderr.write(`× 生成失败：${err && err.message}\n`);
  process.exit(1);
});
