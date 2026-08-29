// SSR 渲染冒烟测试：vite 会把页面模块整体执行一遍，任何 TDZ（const 暂时性死区）、
// 顶层引用 window/document 的错误都会在此暴露——vite 生产构建不检查这些。
// 运行：cd web && npx vite build --ssr smoke-entry.jsx --outDir .smoke-tmp && node .smoke-tmp/smoke-entry.mjs
// 说明：zustand v5 的 SSR getServerSnapshot 返回初始 state，SettingsPage 在 SSR 中
// 恒为加载页（属预期），故设置页仅验证加载分支不抛错，RouteEditor 单独渲染验证。
import React from "react";
import { renderToString } from "react-dom/server";
import CardPage from "./src/pages/CardPage.jsx";
import SettingsPage, { RouteEditor } from "./src/pages/SettingsPage.jsx";

const cardHtml = renderToString(React.createElement(CardPage));
const settingsHtml = renderToString(React.createElement(SettingsPage));
const routeHtml = renderToString(
  React.createElement(RouteEditor, {
    kind: "robotDouble",
    title: "双击机器人图标",
    hint: "未设置时使用与单击相同的配置。",
  })
);

if (!cardHtml || cardHtml.length < 500) {
  throw new Error("CardPage SSR output suspiciously small: " + cardHtml.length);
}
if (!settingsHtml || !settingsHtml.includes("加载")) {
  throw new Error("SettingsPage SSR did not render loading branch");
}
if (!routeHtml.includes("双击机器人图标") || !routeHtml.includes("未设置时使用与单击相同的配置")) {
  throw new Error("RouteEditor SSR missing expected texts");
}

console.log(`RENDER SMOKE OK ${cardHtml.length} ${settingsHtml.length} ${routeHtml.length}`);
