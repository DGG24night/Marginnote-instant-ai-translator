// 轻量 Markdown 渲染器（无第三方依赖，兼容 UIWebView）
// 支持：标题(#)、粗体(**)、斜体(*)、删除线(~~)、行内代码(`)、链接([text](url))、
//       无序/有序列表、分割线(---/***/___)、引用(>)、围栏代码块(```)、表格(GFM)、段落
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

function renderInlineRaw(escaped) {
  // URL 支持一层括号（如 javascript:alert(1)、wiki(zh)），避免在第一个 ) 处截断
  const linkOrImageRe = /!?\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;
  return escaped
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
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

function renderInline(text) {
  return renderInlineRaw(escapeHTML(text));
}

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
  closeList();
  closeQuote();
  return html.join("");
}
