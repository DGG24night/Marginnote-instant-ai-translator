// 轻量 Markdown 渲染器（无第三方依赖，兼容 UIWebView）
// 支持：标题(#)、粗体(**)、斜体(*)、删除线(~~)、行内代码(`)、链接([text](url))、
//       无序/有序列表、分割线(---/***/___)、引用(>)、围栏代码块(```)、表格(GFM)、段落
// 数学公式：$...$ / \(...\) 行内公式、$$...$$（可跨行）块级公式
// 安全：先做 HTML 转义，再套用 Markdown 规则，输出可直接用于 dangerouslySetInnerHTML

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 只允许常见安全协议，其余一律置为 #（防 javascript:/data: 注入）
function sanitizeURL(url) {
  const value = String(url || "").replace(/[\s"']/g, "");
  const match = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (match) {
    const scheme = match[1].toLowerCase();
    if (["http", "https", "mailto", "ftp"].indexOf(scheme) >= 0) return value;
    return "#";
  }
  return value; // 相对链接
}

/* ================= 数学公式（轻量 LaTeX 子集） ================= */

// 命令 → Unicode 符号（覆盖化学/物理/数学常用）
const MATH_SYMBOLS = {
  // 希腊字母（小写）
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ",
  varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", varkappa: "ϰ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ",
  sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "ϕ",
  varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  // 希腊字母（大写）
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // 二元运算符
  pm: "±", mp: "∓", times: "×", div: "÷", cdot: "⋅", ast: "∗",
  star: "⋆", circ: "∘", bullet: "•", oplus: "⊕", ominus: "⊖",
  otimes: "⊗", oslash: "⊘", odot: "⊙", wedge: "∧", vee: "∨",
  cap: "∩", cup: "∪", sqcap: "⊓", sqcup: "⊔", setminus: "∖",
  // 关系符
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  equiv: "≡", approx: "≈", sim: "∼", simeq: "≃", cong: "≅",
  propto: "∝", asymp: "≍", subset: "⊂", supset: "⊃",
  subseteq: "⊆", supseteq: "⊇", nsubseteq: "⊈", nsupseteq: "⊉",
  in: "∈", notin: "∉", ni: "∋", owns: "∋", mid: "∣", nmid: "∤",
  parallel: "∥", perp: "⊥", models: "⊨", vdash: "⊢", dashv: "⊣",
  prec: "≺", succ: "≻", preceq: "≼", succeq: "≽", ll: "≪", gg: "≫",
  // 箭头
  to: "→", rightarrow: "→", gets: "←", leftarrow: "←",
  leftrightarrow: "↔", Leftarrow: "⇐", Rightarrow: "⇒",
  Leftrightarrow: "⇔", longrightarrow: "⟶", longleftarrow: "⟵",
  mapsto: "↦", hookrightarrow: "↪", hookleftarrow: "↩",
  uparrow: "↑", downarrow: "↓", updownarrow: "↕",
  Uparrow: "⇑", Downarrow: "⇓", nearrow: "↗", searrow: "↘",
  swarrow: "↙", nwarrow: "↖", rightleftharpoons: "⇌",
  rightharpoonup: "⇀", rightharpoondown: "⇁",
  // 杂项符号
  infty: "∞", partial: "∂", nabla: "∇", forall: "∀", exists: "∃",
  nexists: "∄", neg: "¬", lnot: "¬", emptyset: "∅", varnothing: "∅",
  angle: "∠", measuredangle: "∡", triangle: "△", square: "□",
  Box: "□", Diamond: "◇", clubsuit: "♣", diamondsuit: "♦",
  heartsuit: "♥", spadesuit: "♠", aleph: "ℵ", hbar: "ℏ", ell: "ℓ",
  imath: "ı", jmath: "ȷ", prime: "′", backprime: "‵", degree: "°",
  S: "§", P: "¶", dag: "†", ddag: "‡", copyright: "©", registered: "®",
  ldots: "…", dots: "…", cdots: "⋯", vdots: "⋮", ddots: "⋱",
  lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", vert: "|",
  Vert: "‖", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  backslash: "\\", "%": "%", _: "_", "#": "#", "&": "&", $: "$",
  bigcap: "⋂", bigcup: "⋃", bigoplus: "⨁", bigotimes: "⨂",
  bigvee: "⋁", bigwedge: "⋀"
};

// 数学函数名（正体渲染，与斜体变量区分）
const MATH_FUNCS =
  "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh " +
  "log ln lg exp lim limsup liminf max min sup inf arg deg det " +
  "dim ker hom gcd mod Pr Re Im".split(" ");

const MATH_ENV = {
  matrix: ["", ""],
  pmatrix: ["(", ")"],
  bmatrix: ["[", "]"],
  Bmatrix: ["{", "}"],
  vmatrix: ["|", "|"],
  Vmatrix: ["‖", "‖"],
  array: ["", ""],
  aligned: ["", ""],
  split: ["", ""],
  gathered: ["", ""]
};

function deentity(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function delimHtml(d) {
  const map = {
    "(": "(", ")": ")", "[": "[", "]": "]",
    "|": "|", ".": "", "\\": "", "": "",
    "{": "{", "}": "}", "<": "⟨", ">": "⟩"
  };
  return map[d] !== undefined ? map[d] : d;
}

// 解析一段 LaTeX 表达式，返回 HTML 字符串
// stopSet：遇到这些字符停止（null 表示解析到末尾）
function parseExpr(s, pos, stopSet) {
  let i = pos;
  const n = s.length;
  let out = "";
  const isAlpha = (c) => c >= "a" && c <= "z" || c >= "A" && c <= "Z";

  // 读取命令名（当前位置必须是 "\"）；非字母命令（\$ \% \{ 等）按字面量返回
  function readCommand() {
    let j = i + 1;
    while (j < n && isAlpha(s[j])) j++;
    if (j === i + 1) {
      const ch = s[j] || "";
      i = j + 1;
      return { esc: true, ch };
    }
    const cmd = s.slice(i + 1, j);
    i = j;
    return { esc: false, cmd };
  }

  // 读取花括号组（当前位置必须是 "{"），返回组内原始内容
  function readBrace() {
    let depth = 1;
    let j = i + 1;
    while (j < n && depth > 0) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}") depth--;
      j++;
    }
    const content = s.slice(i + 1, Math.max(i + 1, j - 1));
    i = j;
    return content;
  }

  // 读取一个参数：{...} 组 / 单命令 / 单字符
  function readArg() {
    if (i < n && s[i] === "{") return readBrace();
    if (i < n && s[i] === "\\") {
      const t = readCommand();
      return t.esc ? t.ch : "\\" + t.cmd;
    }
    if (i < n) {
      const c = s[i];
      i++;
      return c;
    }
    return "";
  }

  const renderSub = (text) => parseExpr(text, 0, null);

  function renderEnv(env, body) {
    const rows = body
      .split("\\\\")
      .map((r) => r.split("&").map((c) => c.trim()));
    if (
      rows.length &&
      rows[rows.length - 1].length === 1 &&
      rows[rows.length - 1][0] === ""
    ) {
      rows.pop();
    }
    if (env === "cases") {
      return (
        `<span class="math-cases">` +
        rows
          .map(
            (r) =>
              `<span class="math-case-row"><span class="math-case-val">${renderSub(
                r[0] || ""
              )}</span>${
                r.length > 1
                  ? `<span class="math-case-cond">${renderSub(r[1])}</span>`
                  : ""
              }</span>`
          )
          .join("") +
        `<span class="math-cases-brace">{</span></span>`
      );
    }
    const pair = MATH_ENV[env] || ["", ""];
    return (
      `<span class="math-matrix">${pair[0]}` +
      `<span class="math-matrix-table">` +
      rows
        .map(
          (r) =>
            `<span class="math-matrix-row">` +
            r
              .map((c) => `<span class="math-matrix-cell">${renderSub(c)}</span>`)
              .join("") +
            `</span>`
        )
        .join("") +
      `</span>${pair[1]}</span>`
    );
  }

  while (i < n) {
    const c = s[i];
    if (stopSet && stopSet.indexOf(c) >= 0) break;
    if (c === "\\") {
      const t = readCommand();
      if (t.esc) {
        // \\ 换行、\$ \{ 等按字面量
        if (t.ch === "\\") {
          out += "<br/>";
        } else if (t.ch === " ") {
          out += " ";
        } else {
          out += escapeHTML(t.ch);
        }
        continue;
      }
      const cmd = t.cmd;
      switch (cmd) {
        case "frac":
        case "dfrac":
        case "tfrac":
        case "cfrac": {
          const num = readArg();
          const den = readArg();
          out += `<span class="math-frac"><span class="math-num">${renderSub(
            num
          )}</span><span class="math-den">${renderSub(den)}</span></span>`;
          continue;
        }
        case "sqrt": {
          let index = "";
          if (i < n && s[i] === "[") {
            const j = s.indexOf("]", i);
            if (j > i) {
              index = s.slice(i + 1, j);
              i = j + 1;
            }
          }
          const arg = readArg();
          if (index) {
            out += `<span class="math-root"><span class="math-radicand">${renderSub(
              arg
            )}</span><span class="math-root-index">${renderSub(
              index
            )}</span></span>`;
          } else {
            out += `<span class="math-sqrt">√<span class="math-radicand">${renderSub(
              arg
            )}</span></span>`;
          }
          continue;
        }
        case "text":
        case "mathrm":
        case "textrm":
        case "operatorname":
        case "textbf":
        case "textit":
        case "mbox": {
          out += `<span class="math-text">${escapeHTML(readArg())}</span>`;
          continue;
        }
        case "left":
        case "right":
        case "big":
        case "Big":
        case "bigg":
        case "Bigg":
        case "bigl":
        case "bigr":
        case "Bigl":
        case "Bigr":
        case "biggl":
        case "biggr":
        case "Biggl":
        case "Biggr": {
          let d = "";
          if (i < n && s[i] === "\\") {
            i++;
            if (i < n) {
              d = s[i];
              i++;
            }
          } else if (i < n) {
            d = s[i];
            i++;
          }
          out += delimHtml(d);
          continue;
        }
        case "quad":
          out += "　";
          continue;
        case "qquad":
          out += "　　";
          continue;
        case ",":
          out += " ";
          continue;
        case ":":
        case ";":
          out += " ";
          continue;
        case "!":
          continue;
        case "sum":
          out += '<span class="math-op">∑</span>';
          continue;
        case "prod":
          out += '<span class="math-op">∏</span>';
          continue;
        case "coprod":
          out += '<span class="math-op">∐</span>';
          continue;
        case "int":
          out += '<span class="math-op">∫</span>';
          continue;
        case "iint":
          out += '<span class="math-op">∬</span>';
          continue;
        case "iiint":
          out += '<span class="math-op">∭</span>';
          continue;
        case "oint":
          out += '<span class="math-op">∮</span>';
          continue;
        case "begin": {
          let j = i;
          while (j < n && s[j] !== "{") j++;
          let k = j + 1;
          let env = "";
          while (k < n && s[k] !== "}") {
            env += s[k];
            k++;
          }
          i = k + 1;
          const endPat = "\\end{" + env + "}";
          const endIdx = s.indexOf(endPat, i);
          const body = endIdx >= 0 ? s.slice(i, endIdx) : s.slice(i);
          i = endIdx >= 0 ? endIdx + endPat.length : n;
          out += renderEnv(env.replace(/[*]/g, ""), body);
          continue;
        }
        case "end":
          // 孤立的 \end（begin 分支已消费成对内容）
          continue;
        default: {
          const sym = MATH_SYMBOLS[cmd];
          if (sym !== undefined) {
            out += sym;
            continue;
          }
          if (MATH_FUNCS.indexOf(cmd) >= 0) {
            out += `<span class="math-fn">${cmd}</span>`;
            continue;
          }
          // 未知命令保留原文（含 {参数}），避免信息丢失
          out += "\\" + cmd;
          if (i < n && s[i] === "{") {
            out += "{" + readBrace() + "}";
          }
          continue;
        }
      }
    } else if (c === "^" || c === "_") {
      const isSup = c === "^";
      i++;
      const arg = readArg();
      const tag = isSup ? "sup" : "sub";
      out += `<${tag} class="math-script">${renderSub(arg)}</${tag}>`;
    } else if (c === "{") {
      i++; // 分组括号无输出
    } else if (c === "}") {
      i++;
    } else if (c === " ") {
      out += " ";
      while (i < n && s[i] === " ") i++;
    } else if (c === "&") {
      out += " ";
      i++;
    } else if (c === "\n") {
      out += " ";
      i++;
    } else {
      out += escapeHTML(c);
      i++;
    }
  }
  return out;
}

// 行内公式：$...$ 或 \(...\)
function renderMath(tex) {
  const raw = deentity(tex);
  return `<span class="math">${parseExpr(raw, 0, null)}</span>`;
}

// 块级公式：$$...$$
function renderMathBlock(tex) {
  const raw = deentity(tex);
  return `<div class="math-block">${parseExpr(raw, 0, null)}</div>`;
}

/* ================= 行内 Markdown 规则 ================= */

// 对已转义的普通文本段套用行内规则（链接/粗体/斜体/删除线）
function applyInlineChain(text) {
  const linkOrImageRe = /!?\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;
  return text
    .replace(linkOrImageRe, function (match, label, url) {
      const safeURL = sanitizeURL(url);
      if (match[0] === "!") {
        return `<img src="${safeURL}" alt="${label}"/>`;
      }
      return `<a href="${safeURL}">${renderInlineRaw(label)}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
}

function renderInlineRaw(escaped) {
  // 扫描式：行内代码与公式优先切分（两者内部禁止互相解析），
  // 其余普通文本段再套用行内规则
  const SEG_RE =
    /(`[^`\n]+`)|(\$\$[^$\n]+\$\$)|(\$[^$\n]+\$)|(\\\([^\\\n]+\\\))/g;
  let result = "";
  let last = 0;
  let m;
  while ((m = SEG_RE.exec(escaped))) {
    result += applyInlineChain(escaped.slice(last, m.index));
    if (m[1]) {
      // 行内代码原样输出（内部 $ 不渲染为公式）
      result += `<code>${m[1].slice(1, -1)}</code>`;
    } else if (m[2]) {
      result += renderMath(m[2].slice(2, -2)); // $$...$$
    } else if (m[3]) {
      result += renderMath(m[3].slice(1, -1)); // $...$
    } else {
      result += renderMath(m[4].slice(2, -2)); // \(...\)
    }
    last = m.index + m[0].length;
  }
  result += applyInlineChain(escaped.slice(last));
  return result;
}

function renderInline(text) {
  return renderInlineRaw(escapeHTML(text));
}

/* ================= 块级结构 ================= */

function parseTableRow(line) {
  return String(line)
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDelimiterRow(line) {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function renderMarkdown(source) {
  const lines = String(source || "").split(/\r?\n/);
  const html = [];
  let inList = false;
  let listTag = "ul";
  let inQuote = false;
  let inCode = false;
  let inMathBlock = false;
  let mathBuf = [];
  let mathClose = ""; // 当前块级公式闭合标记：$$ 或 \]

  const closeList = () => {
    if (inList) {
      html.push(`</${listTag}>`);
      inList = false;
    }
  };
  const closeQuote = () => {
    if (inQuote) {
      html.push("</blockquote>");
      inQuote = false;
    }
  };

  const FENCE_RE = /^(`{3,}|~{3,})\s*.*$/;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 围栏代码块内：原样输出（转义后保留换行），直到闭合围栏
    if (inCode) {
      if (/^(`{3,}|~{3,})\s*$/.test(trimmed)) {
        html.push("</code></pre>");
        inCode = false;
      } else {
        html.push(escapeHTML(rawLine) + "\n");
      }
      continue;
    }

    // 块级公式：$$...$$（可跨多行，也可用 \[...\] 形式）
    if (inMathBlock) {
      const closeIdx = rawLine.indexOf(mathClose);
      if (closeIdx >= 0) {
        mathBuf.push(rawLine.slice(0, closeIdx));
        html.push(renderMathBlock(mathBuf.join("\n")));
        inMathBlock = false;
        mathBuf = [];
        const rest = rawLine.slice(closeIdx + mathClose.length);
        if (rest.trim()) {
          // 闭合后同一行还有内容：作为新段落继续处理
          html.push(`<p>${renderInline(rest.trim())}</p>`);
        }
      } else {
        mathBuf.push(rawLine);
      }
      continue;
    }
    if (/^\$\$/.test(trimmed)) {
      closeList();
      closeQuote();
      if (trimmed.length > 2 && /\$\$$/.test(trimmed)) {
        // 单行 $$...$$
        html.push(renderMathBlock(trimmed.slice(2, -2)));
      } else {
        inMathBlock = true;
        mathClose = "$$";
        mathBuf.push(trimmed.slice(2));
      }
      continue;
    }
    const lbrackSingle = trimmed.match(/^\\\[(.*)\\\]$/);
    if (lbrackSingle) {
      // 单行 \[...\]
      closeList();
      closeQuote();
      html.push(renderMathBlock(lbrackSingle[1]));
      continue;
    }
    if (/^\\\[$/.test(trimmed)) {
      closeList();
      closeQuote();
      inMathBlock = true;
      mathClose = "\\]";
      mathBuf.push("");
      continue;
    }

    if (!trimmed) {
      closeList();
      closeQuote();
      continue;
    }

    // 围栏代码块开始（``` 或 ~~~，可带语言标识）
    if (FENCE_RE.test(trimmed)) {
      closeList();
      closeQuote();
      html.push("<pre><code>");
      inCode = true;
      continue;
    }

    // 标题（#~###### 语义化映射 h1-h6，字号差异由样式表 .card-result/.card-measure 控制）
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      closeQuote();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    // 分割线（--- / *** / ___，允许空格变体如 - - -）
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      closeList();
      closeQuote();
      html.push("<hr/>");
      continue;
    }

    // 表格：表头行 + 分隔行（列数一致且 ≥2 列才识别为表格，避免误伤普通文本）
    if (i + 1 < lines.length && trimmed.indexOf("|") >= 0) {
      const headers = parseTableRow(trimmed);
      const delimCells = parseTableRow(lines[i + 1]);
      if (headers.length >= 2 && headers.length === delimCells.length && isDelimiterRow(lines[i + 1])) {
        closeList();
        closeQuote();
        html.push("<table><thead><tr>");
        headers.forEach((h) => html.push(`<th>${renderInline(h)}</th>`));
        html.push("</tr></thead><tbody>");
        i += 2;
        while (i < lines.length) {
          const t = lines[i].trim();
          if (!t || t.indexOf("|") < 0 || isDelimiterRow(t)) break;
          html.push("<tr>");
          parseTableRow(t).forEach((c) => html.push(`<td>${renderInline(c)}</td>`));
          html.push("</tr>");
          i++;
        }
        html.push("</tbody></table>");
        continue;
      }
    }

    // 引用（连续 > 行合并为一个 blockquote）
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      if (!inQuote) {
        closeList();
        html.push("<blockquote>");
        inQuote = true;
      }
      if (quote[1]) html.push(`<p>${renderInline(quote[1])}</p>`);
      continue;
    }

    // 列表项（-、* 无序 / 1. 有序）
    const listItem = trimmed.match(/^([-*]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      const nextTag = /^\d+[.)]/.test(listItem[1]) ? "ol" : "ul";
      if (!inList) {
        html.push(`<${nextTag}>`);
        inList = true;
        listTag = nextTag;
      } else if (listTag !== nextTag) {
        html.push(`</${listTag}><${nextTag}>`);
        listTag = nextTag;
      }
      html.push(`<li>${renderInline(listItem[2])}</li>`);
      continue;
    }

    closeList();
    closeQuote();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  if (inCode) html.push("</code></pre>"); // 未闭合围栏兜底，避免破坏后续 HTML
  if (inMathBlock) html.push(renderMathBlock(mathBuf.join("\n"))); // 未闭合块级公式兜底
  closeList();
  closeQuote();
  return html.join("");
}
