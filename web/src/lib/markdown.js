// 轻量 Markdown 渲染器（无第三方依赖，兼容 UIWebView）
// 支持：标题(#)、粗体(**)、斜体(*)、行内代码(`)、无序/有序列表、段落
// 安全：先做 HTML 转义，再套用 Markdown 规则，输出可直接用于 dangerouslySetInnerHTML

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text) {
  return escapeHTML(text)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

export function renderMarkdown(source) {
  const lines = String(source || "").split(/\r?\n/);
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    // 标题
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 2; // h3-h6，卡片内避免过大标题
      html.push(`<h${Math.min(level, 6)}>${renderInline(heading[2])}</h${Math.min(level, 6)}>`);
      continue;
    }

    // 列表项（-、*、1.）
    const listItem = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.*)$/);
    if (listItem) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInline(listItem[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeList();
  return html.join("");
}
