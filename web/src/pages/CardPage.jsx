import { useCallback, useEffect, useRef, useState } from "react";
import MNBridge from "../lib/mnBridge";
import { renderMarkdown } from "../lib/markdown";
import { useConfigStore } from "../store/configStore";

// 滚动条自动隐藏：页面静止时滚动条透明（见 styles.css 的 ::-webkit-scrollbar 覆写），
// 仅在滚动进行中给滚动容器加 .mniat-scroll-visible 短暂显示，停止滚动 600ms 后隐藏。
// 用 capture 捕获 document 上的 scroll（scroll 不冒泡），一个监听覆盖卡片内所有滚动容器
// （card-body / 拼接 textarea / 历史列表 / 模型选择器等）。
function bindScrollHint() {
  let timer = null;
  const hide = () => {
    const nodes = document.querySelectorAll(".mniat-scroll-visible");
    for (let i = 0; i < nodes.length; i++) nodes[i].classList.remove("mniat-scroll-visible");
  };
  const show = (el) => {
    if (!el || !el.classList) el = document.documentElement;
    if (!el || !el.classList) return;
    el.classList.add("mniat-scroll-visible");
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, 600);
  };
  const onScroll = (e) => show(e.target);
  const onWinScroll = () => show(document.documentElement);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("scroll", onWinScroll);
  return () => {
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("scroll", onWinScroll);
    if (timer) clearTimeout(timer);
  };
}

// 卡片状态机：
//   idle → loading →(delta*)→ done（翻译/解释）
//                → dict（词典结果）
//                → error
const initialState = {
  status: "idle",
  mode: "",
  sourceText: "",
  accumulated: "",
  dict: null,
  errorMsg: "",
  lookupProvider: null, // 当前查词服务（切换菜单高亮用）：youdao | bing | haici | ai | null
};

// 思考过程折叠块（reasoning_content 流式展示；正文开始后由调用方自动折叠）：
//   live = 思考进行中（正文未开始）→ 标题「思考中…」并滚动跟随；完成后标题「思考过程」，
//   保持折叠可展开回看。<details> 原生交互；open 由父级受控（onToggle 同步用户手动开合）。
function ReasonBlock({ text, open, onToggle, live }) {
  const bodyRef = useRef(null);
  useEffect(() => {
    if (live && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, live]);
  if (!text) return null;
  return (
    <details
      className={"reason-block" + (live ? " reason-live" : "")}
      open={open}
      onToggle={(e) => onToggle && onToggle(e.target.open)}
    >
      <summary className="reason-summary">{live ? "思考中…" : "思考过程"}</summary>
      <div className="reason-body" ref={bodyRef}>{text}</div>
    </details>
  );
}

// ---------- 单色图标（fill=currentColor，颜色随按钮的 color 统一，亮/暗主题自适应） ----------

// 扬声器（用户提供的 fayin.svg：喇叭主体 + 两圈声波）
const SPEAKER_PATHS = [
  "M477.098667 176.853333c50.133333 0 90.752 40.661333 90.752 90.794667v471.168a90.752 90.752 0 0 1-141.098667 75.52L314.026667 739.2l-105.088-14.165333a90.752 90.752 0 0 1-78.506667-85.290667l-0.085333-4.693333V384.64c0-45.098667 33.109333-83.370667 77.781333-89.813333l104.533333-15.104 109.056-83.968c14.421333-11.136 31.829333-17.621333 49.92-18.730667l5.461334-0.170667z m0 65.194667a25.6 25.6 0 0 0-15.616 5.290667l-115.797334 89.173333-6.741333 5.248-8.490667 1.237333-113.024 16.298667a25.6 25.6 0 0 0-21.930666 25.344v250.453333a25.6 25.6 0 0 0 22.186666 25.344l112.469334 15.189334 7.466666 0.981333 6.272 4.181333 118.997334 79.36a25.6 25.6 0 0 0 39.808-21.333333V267.648a25.6 25.6 0 0 0-25.6-25.6z",
  "M668.885333 350.293333a32.597333 32.597333 0 0 1 45.994667 2.304c35.413333 39.125333 55.893333 96.341333 55.893333 157.482667 0 72.106667-28.458667 138.410667-75.52 176.085333a32.597333 32.597333 0 0 1-40.704-50.901333c30.72-24.576 51.072-71.978667 51.072-125.184 0-45.525333-14.848-87.04-39.04-113.792a32.597333 32.597333 0 0 1 2.304-46.037333z",
  "M758.869333 245.888a32.597333 32.597333 0 0 1 45.696-5.973333c71.509333 54.826667 105.813333 156.928 105.813334 270.165333 0 96.554667-49.834667 226.730667-105.642667 270.08a32.597333 32.597333 0 1 1-39.978667-51.413333c37.973333-29.525333 80.469333-140.544 80.469334-218.666667 0-95.018667-28.032-178.346667-80.341334-218.496a32.597333 32.597333 0 0 1-5.973333-45.653333z",
];

// 图钉（用户提供的 tuding-2.svg）：active=固定（主题色高亮，由 CSS .pin-btn.active 控制），未固定=次要色
const PIN_PATH =
  "M742.826667 398.890667l-28.16-28.16v-102.826667a246.101333 246.101333 0 0 0 42.666666-139.946667 32 32 0 0 0-32-32H298.666667a32 32 0 0 0-32 32 245.973333 245.973333 0 0 0 42.666666 139.989334v102.741333l-28.16 28.16a338.773333 338.773333 0 0 0-99.84 241.109333c0 17.664 14.336 32 32 32h266.666667V896a32 32 0 1 0 64 0v-224H810.666667a32 32 0 0 0 32-32 338.688 338.688 0 0 0-99.84-241.109333z m-495.658667 209.066666A274.773333 274.773333 0 0 1 326.4 444.16l37.546667-37.504a32 32 0 0 0 9.386666-22.613333v-128a31.872 31.872 0 0 0-9.386666-22.613334 148.394667 148.394667 0 0 1-30.421334-73.301333h356.992a149.077333 149.077333 0 0 1-30.464 73.386667 32 32 0 0 0-9.386666 22.613333v128c0 8.490667 3.370667 16.64 9.386666 22.613333l37.546667 37.504a274.645333 274.645333 0 0 1 79.232 163.84l-529.664-0.128z";

// 历史记录（用户提供的 lishi-.svg：时钟圆环 + 指针）
const HISTORY_PATHS = [
  "M512 47.104C253.952 47.104 47.104 253.952 47.104 512S256 978.944 512 978.944c258.048 0 466.944-208.896 466.944-466.944C978.944 253.952 770.048 47.104 512 47.104zM512 901.12C296.96 901.12 122.88 727.04 122.88 512S296.96 122.88 512 122.88s389.12 174.08 389.12 389.12-174.08 389.12-389.12 389.12z",
  "M548.864 532.48V303.104c0-20.48-16.384-36.864-36.864-36.864s-36.864 16.384-36.864 36.864v243.712c0 10.24 4.096 18.432 10.24 26.624l172.032 172.032c8.192 8.192 16.384 10.24 26.624 10.24s18.432-4.096 26.624-10.24c14.336-14.336 14.336-36.864 0-53.248L548.864 532.48z",
];

// 拖动提示（用户提供的 bars.svg：三横线）
const DRAG_PATH =
  "M173.708 319.953h673.184c35.347 0 64-28.654 64-64s-28.653-64-64-64H173.708c-35.346 0-64 28.654-64 64s28.653 64 64 64zM846.892 449.717H173.708c-35.346 0-64 28.654-64 64 0 35.346 28.654 64 64 64h673.184c35.347 0 64-28.654 64-64 0-35.346-28.654-64-64-64zM846.892 704.165H173.708c-35.346 0-64 28.654-64 64s28.654 64 64 64h673.184c35.347 0 64-28.654 64-64s-28.654-64-64-64z";

// 机器人（用户提供的 robot.svg）：词典结果时切换为 AI 解释
const ROBOT_PATH =
  "M717.12 274H762c82.842 0 150 67.158 150 150v200c0 82.842-67.158 150-150 150H262c-82.842 0-150-67.158-150-150V424c0-82.842 67.158-150 150-150h44.88l-18.268-109.602c-4.086-24.514 12.476-47.7 36.99-51.786 24.514-4.086 47.7 12.476 51.786 36.99l20 120c0.246 1.472 0.416 2.94 0.516 4.398h228.192c0.1-1.46 0.27-2.926 0.516-4.398l20-120c4.086-24.514 27.272-41.076 51.786-36.99 24.514 4.086 41.076 27.272 36.99 51.786L717.12 274zM262 364c-33.138 0-60 26.862-60 60v200c0 33.138 26.862 60 60 60h500c33.138 0 60-26.862 60-60V424c0-33.138-26.862-60-60-60H262z m50 548c-24.852 0-45-20.148-45-45S287.148 822 312 822h400c24.852 0 45 20.148 45 45S736.852 912 712 912H312z m-4-428c0-24.852 20.148-45 45-45S398 459.148 398 484v40c0 24.852-20.148 45-45 45S308 548.852 308 524v-40z m318 0c0-24.852 20.148-45 45-45S716 459.148 716 484v40c0 24.852-20.148 45-45 45S626 548.852 626 524v-40z";

// 搜索（用户提供的 sousuo.svg：放大镜，单 path）
const SEARCH_PATH =
  "M435.2 746.057143a310.857143 310.857143 0 1 0 0-621.714286 310.857143 310.857143 0 0 0 0 621.714286z m288.036571-56.905143l231.424 232.521143a36.571429 36.571429 0 0 1-51.858285 51.565714l-232.96-234.057143a384 384 0 1 1 53.394285-50.029714z";

// 重新生成（用户提供的 a-shuaxinzhongxinzairu.svg：顺时针箭头，单 path）
const REFRESH_PATH =
  "M761.3 209.2c-19.1-13.8-45.8-9.5-59.6 9.6-13.8 19.1-9.5 45.8 9.6 59.6 88.9 64.1 141.9 167.7 141.9 277.1 0 188.2-153.1 341.3-341.3 341.3S170.7 743.7 170.7 555.5c0-165.9 119.1-304.4 276.2-334.9l-7.7 7.7c-16.7 16.7-16.7 43.7 0 60.3 8.3 8.3 19.2 12.5 30.2 12.5s21.8-4.2 30.2-12.5l87-87c16.7-16.7 16.7-43.7 0-60.3l-87-87c-16.6-16.7-43.7-16.7-60.3 0-16.7 16.7-16.7 43.7 0 60.3l18.1 18.1C248 159.7 85.5 338.8 85.5 555.4c0 235.3 191.4 426.7 426.7 426.7s426.7-191.4 426.7-426.7c-0.2-136.6-66.5-266.1-177.6-346.2z";

// 关闭（用户提供的 chahao.svg：圆底 + 叉号，3 path，单色 currentColor）
const CLOSE_PATHS = [
  "M512 1023.998046A511.999023 511.999023 0 0 1 312.610948 41.080156a511.999023 511.999023 0 0 1 398.778104 942.839689 508.993158 508.993158 0 0 1-199.389052 40.078201z m0-943.841643C273.534702 80.156403 80.15738 274.53568 80.15738 511.999023s193.377322 431.84262 431.84262 431.84262 431.84262-193.377322 431.84262-431.84262S749.463343 80.156403 512 80.156403z",
  "M320.626588 743.450636a40.078201 40.078201 0 0 1-28.054741-68.132942l381.744869-381.744869a40.383798 40.383798 0 0 1 57.111437 57.111437L349.683284 731.427176a40.078201 40.078201 0 0 1-29.056696 12.02346z",
  "M702.371457 743.450636a40.078201 40.078201 0 0 1-28.054741-12.02346L292.571847 349.682307a40.383798 40.383798 0 0 1 57.111437-57.111437l380.742914 382.746824a40.078201 40.078201 0 0 1-28.054741 68.132942z",
];

// 添加卡片（用户提供的 foller.svg：圆角矩形边框 + 中心加号，2 path，单色 currentColor）
const ADD_PATHS = [
  "M831.6 639.6h-63.9v127.9H639.9v63.9h127.8v127.9h63.9V831.4h127.9v-63.9H831.6z",
  "M564.3 925.2c0-18.5-15-33.6-33.6-33.6H287.3c-86.2 0-156.4-70.2-156.4-156.4V286.9c0-86.2 70.1-156.4 156.4-156.4h448.4c86.2 0 156.4 70.2 156.4 156.4v238.8c0 18.5 15 33.6 33.6 33.6s33.6-15 33.6-33.6V286.9C959.2 163.6 859 63.3 735.7 63.3H287.3C164 63.3 63.7 163.6 63.7 286.8v448.3c0 123.2 100.3 223.5 223.6 223.5h243.4c18.6 0.1 33.6-14.9 33.6-33.4z",
];

function SpeakerIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {SPEAKER_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={PIN_PATH} fill="currentColor" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {HISTORY_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function DragIcon() {
  return (
    <svg className="icon-svg drag-icon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={DRAG_PATH} fill="currentColor" />
    </svg>
  );
}

function RobotIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={ROBOT_PATH} fill="currentColor" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={SEARCH_PATH} fill="currentColor" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={REFRESH_PATH} fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {CLOSE_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

function AddIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {ADD_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 发送（用户提供的 fasong.svg：圆底 + 纸飞机，3 path，单色 currentColor）
const SEND_PATHS = [
  "M512 1015.873016c-278.267937 0-503.873016-225.605079-503.873016-503.873016 0-278.267937 225.605079-503.873016 503.873016-503.873016 278.267937 0 503.873016 225.605079 503.873016 503.873016 0 278.267937-225.605079 503.873016-503.873016 503.873016z m0-48.761905c251.351365 0 455.111111-203.759746 455.111111-455.111111s-203.759746-455.111111-455.111111-455.111111-455.111111 203.759746-455.111111 455.111111 203.759746 455.111111 455.111111 455.111111z",
  "M410.201397 796.444444c-3.006984 0-6.013968-0.666413-9.037207-2.015492a22.674286 22.674286 0 0 1-13.702095-20.805079V606.630603c0-7.054222 3.006984-13.425778 8.695873-17.781841 5.347556-4.356063 12.36927-5.688889 19.407238-4.356064l232.171683 55.669842 46.827682-334.051556c0.666413-5.36381-4.681143-9.05346-9.362285-6.371555l-424.553651 246.507682 77.287619 19.797333c11.052698 2.681905 19.082159 12.743111 18.074413 24.153397a22.576762 22.576762 0 0 1-28.119365 20.122413l-132.144762-33.87327a22.576762 22.576762 0 0 1-16.70908-18.789587 22.658032 22.658032 0 0 1 11.036445-22.804318l523.556571-304.209269a23.080635 23.080635 0 0 1 24.088381 0.666412c7.037968 4.713651 11.052698 13.425778 9.703619 21.796572l-58.546793 417.922031a23.30819 23.30819 0 0 1-9.70362 15.76635c-5.347556 3.673397-11.702857 4.681143-18.058158 3.348317l-228.498286-54.678349v85.869714l45.511111-42.585397c8.35454-7.720635 21.065143-9.411048 30.102349-2.356825 11.377778 8.712127 11.702857 25.144889 1.674159 34.539682l-84.309333 79.481905a22.300444 22.300444 0 0 1-15.392508 6.046476z",
  "M412.249397 617.650794c-5.250032 0-10.500063-1.999238-14.791111-5.656381a22.820571 22.820571 0 0 1-1.625397-31.939048l117.890032-133.721397a22.121651 22.121651 0 0 1 31.532698-1.674158c9.199746 8.322032 9.849905 22.625524 1.641651 31.939047l-117.890032 133.737651c-4.599873 4.989968-10.841397 7.314286-16.741587 7.314286z",
];

function SendIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {SEND_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 暂停（用户提供的 zanting.svg：圆底 + 双竖条，1 path，单色 currentColor）
const PAUSE_PATHS = [
  "M512 0C230.4 0 0 230.4 0 512s230.4 512 512 512 512-230.4 512-512S793.6 0 512 0zM454.4 723.2c0 19.2-19.2 32-44.8 32-25.6 0-44.8-12.8-44.8-32L364.8 300.8c0-19.2 19.2-32 44.8-32 25.6 0 44.8 12.8 44.8 32L454.4 723.2zM665.6 723.2c0 19.2-19.2 32-44.8 32-25.6 0-44.8-12.8-44.8-32L576 300.8c0-19.2 19.2-32 44.8-32 25.6 0 44.8 12.8 44.8 32L665.6 723.2z",
];

function PauseIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {PAUSE_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 新建对话（用户提供的 xinjian.svg：圆底 + 加号，3 path，单色 currentColor）
const NEWCHAT_PATHS = [
  "M500.48 106.1888a416.9728 416.9728 0 1 0 416.9728 416.9728 417.4336 417.4336 0 0 0-416.9728-416.9728z m0 767.6928a350.72 350.72 0 1 1 350.72-350.72 350.72 350.72 0 0 1-350.72 350.72z",
  "M661.76 553.8816h-322.56a30.72 30.72 0 1 1 0-61.44h322.56a30.72 30.72 0 1 1 0 61.44z",
  "M500.48 715.1616a30.72 30.72 0 0 1-30.72-30.72v-322.56a30.72 30.72 0 0 1 61.44 0v322.56a30.72 30.72 0 0 1-30.72 30.72z",
];

function NewChatIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {NEWCHAT_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 复制（两层圆角矩形，单色 currentColor）：AI 对话回答气泡的操作按钮
const COPY_PATHS = [
  "M832 896H320c-35.3 0-64-28.7-64-64V320c0-35.3 28.7-64 64-64h448c35.3 0 64 28.7 64 64v512c0 35.3-28.7 64-64 64z m-512-64h448V320H320v512z",
  "M704 128H192c-35.3 0-64 28.7-64 64v512c0 17.7 14.3 32 32 32s32-14.3 32-32V192h512c17.7 0 32-14.3 32-32s-14.3-32-32-32z",
];

function CopyIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {COPY_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 拼接模式追加文本的智能连接策略（用户可编辑修正，此处仅为默认拼接规则）：
//   - 前段以连字符结尾（PDF 跨行断词，如 "inter-"）→ 去连字符直接连接
//   - 前段以句子终止符结尾 → 换行（视为新句子/段落起点）
//   - 新段以 CJK 开头 → 直接连接（中文无需空格）
//   - 其余（英文同一句子续接，如上一页尾 + 下一页头）→ 空格连接
function smartJoin(prev, piece) {
  let a = String(prev || "").replace(/\s+$/g, "");
  const b = String(piece || "").replace(/^\s+|\s+$/g, "");
  if (!a) return b;
  if (!b) return a;
  if (/[‐\-]$/.test(a)) a = a.slice(0, -1);
  const isCJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(b);
  const ended = isCJK ? /[。！？…]$/.test(a) : /[.?!;:]$/.test(a);
  if (ended) return a + "\n" + b;
  return isCJK ? a + b : a + " " + b;
}

// AI 对话思考强度档位（与设置「模型路由 → Reasoning Effort」同一套值）。
// 选择后持久化到 chat 路由；实际请求参数由插件侧 buildReasoningBody 按「厂商 + 模型」
// 适配（thinking.type / reasoning_effort / enable_thinking / reasoning.effort 等）；
// 是否可调由模型探测的 supportsReasoning 决定。
const CHAT_EFFORT_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const CHAT_EFFORT_LABEL = { off: "关闭", low: "低", medium: "中", high: "高" };

// ---------- 快捷键（结果卡片内，均可在设置中自定义） ----------
// 配置格式："d" / "alt+s" / "ctrl+shift+p"（修饰键支持 alt/option、ctrl/control、shift、cmd/command/meta）；
// 历史切换键支持逗号分隔多个键，如 "ArrowUp,ArrowLeft"。
// 解析为 { main, mods:{alt,ctrl,shift,cmd} }；非法输入返回 null。
function parseShortcut(str) {
  const parts = String(str || "").trim().split("+").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  const main = parts[parts.length - 1];
  if (!main || main === "alt" || main === "ctrl" || main === "shift" || main === "cmd") return null;
  const mods = { alt: false, ctrl: false, shift: false, cmd: false };
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (p === "alt" || p === "option" || p === "⌥") mods.alt = true;
    else if (p === "ctrl" || p === "control") mods.ctrl = true;
    else if (p === "shift") mods.shift = true;
    else if (p === "cmd" || p === "command" || p === "meta") mods.cmd = true;
  }
  return { main, mods };
}

// 按键名匹配：macOS 上 Option 组合会改变 e.key（Option+S → "ß"），
// 字母/数字键额外用 e.code（键位码，不受修饰键影响）匹配。
function keyNameMatches(e, main) {
  const k = String(e.key || "").toLowerCase();
  if (k === main) return true;
  const code = String(e.code || "").toLowerCase();
  return code === "key" + main;
}

function matchShortcut(e, sc) {
  if (!sc) return false;
  if (!keyNameMatches(e, sc.main)) return false;
  return e.altKey === sc.mods.alt &&
    e.ctrlKey === sc.mods.ctrl &&
    e.metaKey === sc.mods.cmd &&
    e.shiftKey === sc.mods.shift;
}

// 多键匹配（逗号分隔）："ArrowUp,ArrowLeft"
function matchAnyShortcut(e, listStr) {
  const parts = String(listStr || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (keyNameMatches(e, parts[i])) return true;
  }
  return false;
}

function CardPage() {
  const [state, setState] = useState(initialState);
  const [pinned, setPinned] = useState(false); // 图钉固定：true = 点击卡片外部不自动关闭
  const [speaking, setSpeaking] = useState(null); // uk | us：AI 解释手动发音加载中
  const [pronounceHint, setPronounceHint] = useState(""); // 发音提示（口音回退/不可用）
  const [searchOpen, setSearchOpen] = useState(false); // 工具栏搜索框展开
  const [searchText, setSearchText] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false); // 查词服务切换菜单（bar 图标）
  const [modelPickerOpen, setModelPickerOpen] = useState(false); // 重新生成选模型弹层
  const [collapsedProviders, setCollapsedProviders] = useState({}); // 模型选择器：供应商折叠状态（默认全部展开）
  const [historyOpen, setHistoryOpen] = useState(false); // 历史记录浮层
  const [historyItems, setHistoryItems] = useState([]); // 历史条目（getHistory 返回）
  const [historyLoading, setHistoryLoading] = useState(false);
  const [appendMode, setAppendMode] = useState(false); // 拼接模式（双击图钉）：划词追加原文，编辑后翻译
  const [appendText, setAppendText] = useState(""); // 拼接编辑区内容（前端为真源，用户可编辑）
  const [noteOpen, setNoteOpen] = useState(false); // 笔记编辑界面（N 键 / 双击「添加」按钮进入）
  const [noteTitle, setNoteTitle] = useState(""); // 笔记标题（默认为单词/原句，可编辑）
  const [noteText, setNoteText] = useState(""); // 笔记编辑区内容（可含自动附带的查词/翻译结果）
  const [chatOpen, setChatOpen] = useState(false); // AI 对话界面（长按机器人图标进入）
  const [chatMessages, setChatMessages] = useState([]); // [{role:"user"|"assistant", text}]
  const [chatDraft, setChatDraft] = useState(""); // AI 回复流式草稿（chatDelta 累积）
  const [reasonDraft, setReasonDraft] = useState(""); // 思考过程流式内容（reasoning 事件全量累积）
  const [reasonOpen, setReasonOpen] = useState(true); // 思考块展开状态（正文开始后自动折叠，可手动展开）
  const [chatReasonDraft, setChatReasonDraft] = useState(""); // 对话思考过程流式内容（chatReasoning 累积）
  const [chatReasonOpen, setChatReasonOpen] = useState(true); // 对话思考块展开状态
  const [chatInput, setChatInput] = useState(""); // 对话输入框
  const [chatSending, setChatSending] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false); // 对话模型选择弹层
  const [chatPickerTarget, setChatPickerTarget] = useState(null); // 弹层用途：null=切换模型 | 数字=重新回答该条回答的索引
  const [chatEffortOpen, setChatEffortOpen] = useState(false); // 对话思考强度选择弹层（输入行「思考」按钮）
  const [searchFocusTick, setSearchFocusTick] = useState(0); // 搜索框聚焦重试触发器（D 键重复触发聚焦）
  const reasonCollapsedRef = useRef(false); // 本次任务正文是否已开始（首帧后自动折叠思考块，仅一次）
  const chatReasonCollapsedRef = useRef(false); // 对话：本次回答正文是否已开始（首帧后自动折叠）
  const readySentRef = useRef(false);
  const audioRef = useRef(null);
  const hintTimerRef = useRef(null);
  const toolbarRef = useRef(null);
  const measureRef = useRef(null);
  const dictRef = useRef(null);
  const searchInputRef = useRef(null);
  const switchMenuRef = useRef(null); // 查词服务切换菜单（测量高度用）
  const modelPickerRef = useRef(null); // 重新生成选模型弹层（测量高度用）
  const historyPanelRef = useRef(null); // 历史记录面板（打开时测量内容高度，卡片自适应变高）
  const regenTimerRef = useRef(null); // 重新生成按钮长按计时
  const regenLongPressRef = useRef(false); // 长按已触发（抑制随后的 click）
  const regenTouchAtRef = useRef(0); // 最近一次触摸时间戳：触摸后的合成 mouse 事件（500ms 窗口内）一律忽略
  const regenTouchCleanupRef = useRef(null); // 按钮卸载时解绑原生 touch 监听
  const cardLimitsRef = useRef(null); // 卡片高度上下限 { min, max }（cardReady 返回，测量钳制用）
  const pinTimerRef = useRef(null); // 图钉单击/双击判定计时器
  const prevPinnedRef = useRef(false); // 进入拼接模式前的 pinned 状态：「开始翻译」后据此决定是否恢复
  const appendTextareaRef = useRef(null); // 拼接编辑区（auto-grow 用）
  const noteTextareaRef = useRef(null); // 笔记编辑区（聚焦用；高度由 flex 布局接管）
  const addTimerRef = useRef(null); // 「添加」按钮单击/双击判定计时器
  const robotTimerRef = useRef(null); // 机器人单击/双击判定计时器
  const robotPressTimerRef = useRef(null); // 机器人长按计时器（进入 AI 对话）
  const robotLongFiredRef = useRef(false); // 机器人长按已触发（抑制随后的 click）
  const robotTouchAtRef = useRef(0); // 机器人最近触摸时间戳（忽略触摸后的合成 mouse 事件）
  const robotTouchCleanupRef = useRef(null); // 机器人按钮卸载时解绑原生 touch 监听
  const chatListRef = useRef(null); // 对话消息列表（滚动到底用）
  const chatPickerRef = useRef(null); // 对话模型选择弹层（测量高度用）
  const chatEffortMenuRef = useRef(null); // 对话思考强度选择弹层（测量高度用）
  const chatAddTimerRef = useRef(null); // 对话「添加笔记」单击/双击判定计时器
  const reAnsTimerRef = useRef(null); // 「重新回答」长按计时器
  const reAnsLongRef = useRef(false); // 「重新回答」长按已触发（抑制随后的 click）
  const reAnsTouchAtRef = useRef(0); // 「重新回答」最近触摸时间戳（忽略触摸后的合成 mouse 事件）
  const noteKindRef = useRef(""); // 笔记编辑上下文类型（chat 回答进入编辑时用 lookup 颜色）
  const histNavListRef = useRef(null); // 快捷键历史导航：已加载的历史列表
  const histNavKindRef = useRef(""); // 快捷键历史导航：列表对应的类型（lookup/translate）
  const histNavIdxRef = useRef(-1); // 快捷键历史导航：当前所在索引（-1 = 未开始）
  const histNavAppliedRef = useRef(""); // 快捷键历史导航：最近应用条目的原文（区分历史回放与新任务）
  const shortcutsRef = useRef(null); // 最新快捷键处理函数（每次渲染重建，监听器只绑一次）
  const { config, load, update } = useConfigStore();

  // 显示发音提示，几秒后自动消失
  const showHint = useCallback((msg) => {
    setPronounceHint(msg);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setPronounceHint(""), 3500);
  }, []);

  // 播放发音：按顺序尝试 [url, ...fallbacks]，逐个回退。
  // 失败条件：加载错误（网络/解码，如有道 500 JSON 错误体）、音频残缺（时长 <0.7s，如损坏的美音文件）、
  // play() 非 NotAllowedError 失败。全部失败则提示不可用。
  // 典型回退链：原词首字母大写（dictvoice 可能 500，如 Desolvation）→ 小写词 → 另一口音。
  const playWithFallback = useCallback(
    (url, fallbacks, label) => {
      const list = [url, ...(fallbacks || [])].filter(Boolean);
      const tryIndex = (i) => {
        if (i >= list.length) {
          showHint(`「${label}」发音暂不可用`);
          return;
        }
        const u = list[i];
        try {
          if (audioRef.current) {
            audioRef.current.pause();
          }
          const audio = new Audio(u);
          audioRef.current = audio;
          let failed = false;
          const onFail = () => {
            if (failed) return;
            failed = true;
            if (i > 0) {
              showHint(`「${label}」发音不可用，已自动切换另一口音`);
            }
            tryIndex(i + 1);
          };
          // 网络/解码失败（如有道 500 JSON 错误体）
          audio.addEventListener("error", onFail);
          // 残缺音频检测：正常单词发音一般 >0.7s，极短文件视为损坏（如 interfacial 美音 0.56s 无声）
          audio.addEventListener("loadedmetadata", () => {
            const d = audio.duration;
            if (typeof d === "number" && isFinite(d) && d > 0 && d < 0.7) {
              onFail();
            }
          });
          const p = audio.play();
          if (p && typeof p.catch === "function") {
            p.catch((e) => {
              // NotAllowedError = WebView 无手势拦截，回退同样会被拦截，静默避免误报
              if (e && e.name === "NotAllowedError") return;
              onFail();
            });
          }
        } catch (error) {
          onFail();
        }
      };
      tryIndex(0);
    },
    [showHint]
  );

  // AI 解释结果的手动发音：经 bridge 让插件按「AI 解释发音」配置解析发音 URL 再播放
  const playPronounce = useCallback(
    async (accent) => {
      if (speaking || !state.sourceText) return;
      setSpeaking(accent);
      try {
        const r = await MNBridge.send("getPronounceURL", {
          word: state.sourceText,
          accent,
        });
        if (r && r.url) {
          playWithFallback(r.url, r.fallbacks || [], accent === "uk" ? "英音" : "美音");
        } else {
          showHint("该单词发音暂不可用");
        }
      } catch (error) {
        showHint("发音获取失败，请稍后重试");
      } finally {
        setSpeaking(null);
      }
    },
    [speaking, state.sourceText, playWithFallback, showHint]
  );

  // ---------- 重新生成（点击 / 长按选模型） ----------

  const regenerate = useCallback(async (override) => {
    try {
      await MNBridge.send("regenerate", override || null);
    } catch (e) {
      // 插件层已抛错兜底，此处静默
    }
  }, []);

  // 长按阈值 400ms：UIWebView 的系统长按手势约 500ms 识别，
  // 提前触发可避免系统手势抢先、以及用户过早抬手导致计时未到
  const REGEN_LONG_PRESS_MS = 400;

  const clearRegenTimer = () => {
    if (regenTimerRef.current) {
      clearTimeout(regenTimerRef.current);
      regenTimerRef.current = null;
    }
  };

  // 触摸结束后的 500ms 窗口内，UIWebView 会补发合成 mouse 事件（mousedown/mouseup/click）。
  // 一律忽略，避免长按打开模型列表后又被误关、或单击重复触发重新生成。
  const isRecentTouch = () => Date.now() - regenTouchAtRef.current < 500;

  const onRegenerateMouseDown = () => {
    if (isRecentTouch()) return;
    regenLongPressRef.current = false;
    clearRegenTimer();
    regenTimerRef.current = setTimeout(() => {
      regenLongPressRef.current = true;
      load(); // 打开前刷新提供商/模型列表（设置页可能已改）
      setModelPickerOpen(true);
    }, REGEN_LONG_PRESS_MS);
  };

  const onRegenerateMouseUp = () => {
    if (isRecentTouch()) return;
    clearRegenTimer();
    if (regenLongPressRef.current) {
      regenLongPressRef.current = false;
      return; // 长按已触发选模型，点击不重复重新生成
    }
    regenerate(null);
  };

  const onRegenerateMouseLeave = () => {
    if (isRecentTouch()) return;
    clearRegenTimer();
    if (regenLongPressRef.current) regenLongPressRef.current = false;
  };

  // iPad 手指 / Apple Pencil 触摸长按支持（MarginNote WebView 为 UIWebView，无 Pointer Events）：
  // 1) iOS 触摸不会立即合成 mousedown（系统先做手势判定），基于 onMouseDown 的计时器启动不了；
  // 2) 按钮是条件渲染的，挂载时才出现 —— 必须用 callback ref 在按钮挂载/卸载时动态绑定/解绑，
  //    否则触摸监听绑定时机与按钮渲染脱节（上一版 useEffect 只在组件挂载时跑一次，条件渲染场景漏绑）。
  const bindRegenTouch = useCallback(
    (el) => {
      if (regenTouchCleanupRef.current) {
        regenTouchCleanupRef.current();
        regenTouchCleanupRef.current = null;
      }
      if (!el) return;

      let active = false; // 当前触摸是否仍停留在按钮上

      const onTouchStart = (e) => {
        regenTouchAtRef.current = Date.now();
        active = true;
        regenLongPressRef.current = false;
        clearRegenTimer();
        if (e.cancelable) e.preventDefault(); // 抑制系统长按手势（放大镜/选词/callout）
        regenTimerRef.current = setTimeout(() => {
          if (!active) return;
          regenLongPressRef.current = true;
          load(); // 打开前刷新提供商/模型列表（设置页可能已改）
          setModelPickerOpen(true);
        }, REGEN_LONG_PRESS_MS);
      };

      const onTouchMove = (e) => {
        // 仅当触摸点明显移出按钮区域（带 12px 容差，容忍手指抖动）才取消长按
        const t = e.touches && e.touches[0];
        if (t) {
          const r = el.getBoundingClientRect();
          if (
            t.clientX >= r.left - 12 &&
            t.clientX <= r.right + 12 &&
            t.clientY >= r.top - 12 &&
            t.clientY <= r.bottom + 12
          ) {
            return;
          }
        }
        active = false; // 滑出按钮：视为取消长按
        clearRegenTimer();
      };

      const onTouchEnd = () => {
        regenTouchAtRef.current = Date.now();
        const wasLong = regenLongPressRef.current;
        const wasActive = active;
        active = false;
        clearRegenTimer();
        if (wasLong) {
          regenLongPressRef.current = false;
          return; // 长按已打开选模型，抬起不再触发重新生成
        }
        if (wasActive) {
          regenerate(null); // 单击 → 重新生成
        }
      };

      const onTouchCancel = () => {
        regenTouchAtRef.current = Date.now();
        active = false;
        clearRegenTimer();
        if (regenLongPressRef.current) regenLongPressRef.current = false;
      };

      try {
        el.addEventListener("touchstart", onTouchStart, { passive: false });
      } catch (err) {
        // 极老引擎不支持 options 对象，退化为 capture 参数
        el.addEventListener("touchstart", onTouchStart, false);
      }
      el.addEventListener("touchmove", onTouchMove, { passive: true });
      el.addEventListener("touchend", onTouchEnd);
      el.addEventListener("touchcancel", onTouchCancel);
      regenTouchCleanupRef.current = () => {
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        el.removeEventListener("touchend", onTouchEnd);
        el.removeEventListener("touchcancel", onTouchCancel);
      };
    },
    [load, regenerate]
  );

  // ---------- 搜索框 ----------

  const submitSearch = useCallback(async () => {
    const t = searchText.trim();
    if (!t) return;
    setSearchOpen(false);
    setSearchText("");
    try {
      await MNBridge.send("cardLookup", { text: t });
    } catch (e) {
      // 插件层已兜底
    }
  }, [searchText]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText("");
  }, []);

  // 展开搜索框后聚焦输入框（多次重试 + window.focus 兜底）：
  // UIWebView 中点击按钮展开后 WebView 可能未持有 DOM 焦点，单次 focus 会静默失败，
  // 表现为「还得手动点一下输入框才能打字」——先 window.focus() 抢回焦点再 focus 输入框，
  // 未成功则间隔重试（最多 5 次）。
  useEffect(() => {
    if (!searchOpen) return undefined;
    let attempts = 0;
    let timer = null;
    const focusAttempt = () => {
      if (!searchInputRef.current) return;
      try { window.focus(); } catch (err) { /* ignore */ }
      try { searchInputRef.current.focus(); } catch (err) { /* ignore */ }
      attempts += 1;
      if (attempts < 5 && document.activeElement !== searchInputRef.current) {
        timer = setTimeout(focusAttempt, 120);
      }
    };
    timer = setTimeout(focusAttempt, 50);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchOpen, searchFocusTick]);

  // ---------- 查词服务切换（bar 图标菜单） ----------

  const switchLookup = useCallback(async (provider) => {
    setSwitchOpen(false);
    try {
      await MNBridge.send("cardLookupProvider", { provider });
    } catch (e) {
      // 插件层已兜底
    }
  }, []);

  // ---------- 模型选择器（重新生成长按） ----------

  const toggleProvider = (id) => {
    setCollapsedProviders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const pickModel = (providerId, modelId) => {
    setModelPickerOpen(false);
    regenerate({ providerId, modelId });
  };

  // 长按选「机器翻译服务」：临时切换机器翻译提供商重跑当前翻译（不写回 machineRouting 配置）
  const pickMachine = (machineProviderId) => {
    setModelPickerOpen(false);
    regenerate({ machineProviderId });
  };

  useEffect(() => {
    // 卡片模式：高度由内容决定（配合 styles.css 的 html.card-fit）
    document.documentElement.classList.add("card-fit");
    const scrollHintCleanup = bindScrollHint(); // 结果卡片滚动条：静止自动隐藏、滚动时显示

    // 接收插件事件
    window.__MNIATCardEvent = (raw) => {
      let event;
      try {
        event = JSON.parse(raw);
      } catch (error) {
        return;
      }

      // 新任务（reset=复用卡片 / loading=首次加载）时刷新外观配置：
      // 卡片 WebView 常驻复用，设置页里改的字号/主题需要在此重新拉取才会生效
      if (event.type === "reset" || event.type === "loading") {
        load();
        // 新任务开始：清除上一任务的卡片高度基准，高度从当前内容重新测量增长
        lastHeightRef.current = 0;
        // 翻译/查词开始：退出拼接界面（「开始翻译」后回到正常结果展示）
        setAppendMode(false);
        setAppendText("");
        // 新任务开始：退出笔记编辑 / AI 对话界面（回到结果展示）
        setNoteOpen(false);
        setNoteTitle("");
        setNoteText("");
        setChatOpen(false);
        setChatMessages([]);
        setChatDraft("");
        setChatInput("");
        setChatSending(false);
        setChatEffortOpen(false);
        // 新任务开始：思考块复位（展开、清空上一任务内容），折叠标记复位
        setReasonDraft("");
        setReasonOpen(true);
        reasonCollapsedRef.current = false;
        setChatReasonDraft("");
        setChatReasonOpen(true);
        chatReasonCollapsedRef.current = false;
        // 快捷键历史导航：回放历史（文本与最近应用条目一致）保持索引，
        // 新任务（新选区/搜索词）重置为未开始。
        // 注意：仅依据 loading 事件判断（携带 text）；reset 事件不携带 text，
        // 且 applyHistory 会先推 reset 再推 loading，若对 reset 也比对会把索引
        // 误重置回 -1，导致每次按上键都停在第一条（已踩坑）。
        if (event.type === "loading" &&
          (!histNavAppliedRef.current || String(event.text || "").trim() !== histNavAppliedRef.current)) {
          histNavIdxRef.current = -1;
        }
      }

      // 思考过程（AI 解释/翻译/机器人）：全量累积渲染；正文到达或出结果/报错时自动折叠
      // （仅本任务首帧折叠一次，之后用户手动展开不再被流式增量压回）
      if (event.type === "reasoning") {
        setReasonDraft(event.accumulated || "");
      }
      if ((event.type === "delta" || event.type === "translateResult" || event.type === "error") &&
        !reasonCollapsedRef.current) {
        reasonCollapsedRef.current = true;
        setReasonOpen(false);
      }

      // AI 对话事件（与结果区 delta/translateResult 通道独立，仅在对话界面渲染）
      if (event.type === "chatReasoning") {
        setChatReasonDraft(event.accumulated || "");
      } else if (event.type === "chatDelta") {
        // 正文开始：思考块自动折叠（内容保留，可展开回看）
        if (!chatReasonCollapsedRef.current) {
          chatReasonCollapsedRef.current = true;
          setChatReasonOpen(false);
        }
        setChatDraft(event.accumulated || "");
      } else if (event.type === "chatDone") {
        setChatDraft("");
        // 思考内容随回答一起存档（折叠块默认收起，可展开回看）
        setChatMessages((prev) => [...prev, {
          role: "assistant",
          text: String(event.text || ""),
          reason: chatReasonDraftRef.current || "",
        }]);
        setChatReasonDraft("");
        setChatSending(false);
      } else if (event.type === "chatError") {
        setChatDraft("");
        setChatReasonDraft("");
        setChatSending(false);
        showHint(`AI 对话失败：${event.message || "请重试"}`);
      }

      setState((prev) => {
        switch (event.type) {
          case "reset":
            return { ...initialState };
          case "loading":
            return {
              ...initialState,
              status: "loading",
              mode: event.mode,
              sourceText: event.text,
              // explain = AI 解释（查词服务菜单高亮「AI 解释」）
              lookupProvider: event.mode === "explain" ? "ai" : null,
            };
          case "delta":
            return { ...prev, status: "streaming", accumulated: event.accumulated };
          case "translateResult":
            return { ...prev, status: "done", accumulated: event.text };
          case "dictResult":
            return {
              ...prev,
              status: "dict",
              dict: event.data,
              // 词典结果自带服务商标记（含临时切换），切换菜单据此高亮
              lookupProvider: event.data.provider || prev.lookupProvider,
            };
          case "speak":
            // 外部指定发音（如 AI 解释返回后朗读单词），仅返回原状态；
            // 实际播放放在 setState 之外的副作用区，避免被 React 调度吞掉
            return prev;
          case "appendMode":
            // 进入拼接模式（双击图钉）：清空上一任务的翻译/查词结果，
            // 只展示拼接编辑区；appendMode 事件由 enterAppendMode 推来，state 切到 idle。
            return { ...initialState };
          case "appendText":
            // 拼接模式划词追加：结果区不变，文本由下方独立 state 处理
            return prev;
          case "error":
            return { ...prev, status: "error", errorMsg: event.message };
          default:
            return prev;
        }
      });

      // 拼接模式独立状态（不参与结果区状态机）：
      //   appendMode 事件（双击图钉）→ 切换到拼接编辑界面，固定卡片；
      //   appendText 事件（划词追加）→ 智能连接进编辑区（可编辑修正）。
      if (event.type === "appendMode") {
        setAppendMode(true);
        setAppendText(event.text || "");
        setPinned(true);
      }
      if (event.type === "appendText") {
        setAppendText((prevText) => smartJoin(prevText, event.text || ""));
      }

      // 词典结果到达后自动发音（首选口音不可用时依次回退：小写词 → 另一口音）
      if (event.type === "dictResult" && event.data && event.data.pronounce) {
        const p = event.data.pronounce;
        if (p.auto) {
          const preferred = p.accent === "uk" ? p.uk : p.us;
          const lowerSame = p.accent === "uk" ? (p.ukFallback || "") : (p.usFallback || "");
          const other = p.accent === "uk" ? p.us : p.uk;
          playWithFallback(
            preferred,
            [lowerSame, other].filter(Boolean),
            p.accent === "uk" ? "英音" : "美音"
          );
        }
      }

      // 外部指定发音（AI 解释返回后朗读单词）——放在 setState 之外确保立即执行
      if (event.type === "speak") {
        if (event.url) {
          playWithFallback(
            event.url,
            event.fallbacks || [],
            event.accent === "uk" ? "英音" : "美音"
          );
        } else {
          showHint("该单词发音暂不可用");
        }
      }
    };

    // 原生拖动条点击（bar 图标区域）→ 打开查词服务切换菜单
    window.__MNIATCardOpenSwitch = () => setSwitchOpen(true);

    // 加载外观配置并通知插件卡片就绪
    load().finally(() => {
      if (!readySentRef.current) {
        readySentRef.current = true;
        MNBridge.send("cardReady")
          .then((r) => {
            // 记录卡片高度上下限：测量结果按此钳制（打字机渐进增长封顶依赖 maxHeight）
            if (r && typeof r.maxHeight === "number") {
              cardLimitsRef.current = {
                min: typeof r.minHeight === "number" ? r.minHeight : 80,
                max: r.maxHeight,
              };
            }
          })
          .catch(() => {});
      }
    });

    // blur 方案：WebView 失焦（用户点击卡片外部）→ 通知插件关闭（图钉固定时插件侧忽略）
    const onWindowBlur = () => {
      MNBridge.send("cardLostFocus").catch(() => {});
    };
    window.addEventListener("blur", onWindowBlur);

    // 卡片内部点击后确保焦点留在 WebView：
    // macOS 上点击可聚焦 DOM 元素（按钮等）可能使窗口焦点脱离卡片，
    // 之后点外部不再触发 blur（表现为取消图钉后点外部不关闭）。mousedown 时清除 DOM 焦点并尝试恢复。
    const onCardMouseDown = () => {
      try {
        if (typeof document.hasFocus === "function" && !document.hasFocus()) {
          window.focus();
        }
        if (document.activeElement && document.activeElement !== document.body) {
          document.activeElement.blur();
        }
      } catch (e) { /* ignore */ }
    };
    document.addEventListener("mousedown", onCardMouseDown, true);

    return () => {
      document.documentElement.classList.remove("card-fit");
      if (typeof scrollHintCleanup === "function") scrollHintCleanup();
      window.__MNIATCardEvent = null;
      window.__MNIATCardOpenSwitch = null;
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("mousedown", onCardMouseDown, true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
      if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
      if (addTimerRef.current) clearTimeout(addTimerRef.current);
      if (chatAddTimerRef.current) clearTimeout(chatAddTimerRef.current);
      if (reAnsTimerRef.current) clearTimeout(reAnsTimerRef.current);
      clearRobotTimers();
      if (robotTouchCleanupRef.current) {
        robotTouchCleanupRef.current();
        robotTouchCleanupRef.current = null;
      }
    };
  }, [load, playWithFallback, showHint]);

  // 内容变化后测量实际高度，经 bridge 通知插件调整卡片 WebView 高度。
  // 测量 .card-measure（隐藏测量器）/ .dict-result 的自然高度 + toolbar 高度，
  // 而非 body.scrollHeight —— 页面高度现在是 100% 布局，toolbar 固定、body 内部滚动。
  // 下拉菜单（查词服务切换 / 重新生成选模型）打开时，若卡片高度不足会裁掉菜单底部选项，
  // 这里把「菜单底部所需高度」计入，让卡片自动变高；菜单关闭后随内容高度回落。
  const lastHeightRef = useRef(0);
  // 最新测量函数：每次渲染重建（闭包读取最新 state/菜单开关）。
  // 定时器统一经 doMeasureRef 调用，避免定时器随 state 变化被反复重建
  // （v0.7.5 教训：interval 放在依赖 state 的 effect 里，每 30ms 的 delta
  // 都会清掉未到期的定时器，测量被无限推迟，卡片高度最后一次性展开）。
  const doMeasureRef = useRef(null);
  doMeasureRef.current = () => {
    const isText = state.status === "streaming" || state.status === "done";
    const toolbarH = toolbarRef.current ? toolbarRef.current.offsetHeight : 0;
    // 发音提示条（toolbar 下方）出现时占高，需计入
    const hintEl = document.querySelector(".pronounce-hint");
    const hintH = hintEl ? hintEl.offsetHeight : 0;
    let height = 0;
    if (noteOpen) {
      // 笔记编辑界面：tip + 标题框 + textarea + actions 自然高度 + padding。
      // textarea 取「内容高度钳制在 [96, 356]」——超出部分由 flex 布局内部滚动
      // （见 .card-body.note-open .note-textarea），保证按钮行始终可见、不被遮住
      const panelEl = document.querySelector(".note-panel");
      const tipEl = panelEl ? panelEl.querySelector(".note-tip") : null;
      const titleEl = panelEl ? panelEl.querySelector(".note-title-input") : null;
      const taEl = panelEl ? panelEl.querySelector(".note-textarea") : null;
      const actionsEl = panelEl ? panelEl.querySelector(".note-actions") : null;
      const bodyPad = 24; // card-body 上下 padding 12+12
      const tipH = tipEl ? tipEl.offsetHeight : 0;
      const titleH = titleEl ? titleEl.offsetHeight : 0;
      const actionsH = actionsEl ? actionsEl.offsetHeight : 0;
      const taH = taEl ? Math.min(Math.max(taEl.scrollHeight, 96), 356) : 96;
      height = tipH + titleH + taH + actionsH + 24 + bodyPad + toolbarH + hintH;
    } else if (chatOpen) {
      // AI 对话界面：tip + 消息列表（scrollHeight 不受 max-height 裁剪影响）
      //   + 输入行（输入框+发送按钮，.chat-input-line）+ 间距(6) + 按钮行（模型/思考/新建对话/关闭）
      const panelEl = document.querySelector(".chat-panel");
      const tipEl = panelEl ? panelEl.querySelector(".chat-tip") : null;
      const listEl = panelEl ? panelEl.querySelector(".chat-list") : null;
      const lineEl = panelEl ? panelEl.querySelector(".chat-input-line") : null;
      const rowEl = panelEl ? panelEl.querySelector(".chat-input-row") : null;
      const bodyPad = 24;
      const tipH = tipEl ? tipEl.offsetHeight : 0;
      const listH = listEl ? Math.max(listEl.scrollHeight, 120) : 120;
      const inputH = lineEl ? lineEl.offsetHeight : 0;
      const rowH = rowEl ? rowEl.offsetHeight : 0;
      height = tipH + listH + inputH + 6 + rowH + 16 + bodyPad + toolbarH + hintH;
    } else if (appendMode) {
      // 拼接模式：按「内容自然高度」计算，而不是 panel.offsetHeight。
      // panel 高度受卡片 maxHeight 钳制（flex 布局），文本越多 textarea 越早进入
      // 溢出滚动，offsetHeight 不再增长反而随卡片缩小——必须用 textarea.scrollHeight
      // （完整内容高度，含溢出滚动部分）计算，卡片才能正确跟随内容变大。
      const panelEl = document.querySelector(".append-panel");
      const tipEl = panelEl ? panelEl.querySelector(".append-tip") : null;
      const taEl = panelEl ? panelEl.querySelector(".append-textarea") : null;
      const actionsEl = panelEl ? panelEl.querySelector(".append-actions") : null;
      const cardBody = panelEl ? panelEl.parentElement : null;
      const bodyPad = cardBody
        ? (parseFloat(getComputedStyle(cardBody).paddingTop) || 0) +
          (parseFloat(getComputedStyle(cardBody).paddingBottom) || 0)
        : 24;
      const tipH = tipEl ? tipEl.offsetHeight : 0;
      const actionsH = actionsEl ? actionsEl.offsetHeight : 0;
      const gap = 16; // panel gap 8px × 2（tip / textarea / actions 之间）
      const taH = taEl ? Math.max(taEl.scrollHeight, taEl.offsetHeight) : 96;
      height = tipH + taH + actionsH + gap + bodyPad + toolbarH + hintH;
    } else if (isText && measureRef.current) {
      // .card-measure 自带与 .card-body 一致的 padding，直接量即可
      height = measureRef.current.offsetHeight + toolbarH + hintH;
    } else if (state.status === "dict" && dictRef.current) {
      // .dict-result 自身高度不含 .card-body 的上下 padding（12+12px），
      // 漏算会导致卡片高度偏小、最后一行被裁剪（查词卡片"遮半行"根因）
      const bodyEl = dictRef.current.parentElement;
      const padV = bodyEl
        ? (parseFloat(getComputedStyle(bodyEl).paddingTop) || 0) +
          (parseFloat(getComputedStyle(bodyEl).paddingBottom) || 0)
        : 24;
      height = dictRef.current.offsetHeight + padV + toolbarH + hintH;
    } else {
      height = document.body.scrollHeight;
    }
    // 下拉菜单打开：确保卡片高度 ≥ 菜单顶部偏移(46) + 菜单高度 + 底部边距(8)
    const menuEl = switchOpen ? switchMenuRef.current
      : modelPickerOpen ? modelPickerRef.current
      : chatPickerOpen ? chatPickerRef.current
      : null;
    if (menuEl) {
      const menuBottom = 46 + menuEl.offsetHeight + 8;
      if (height < menuBottom) height = menuBottom;
    }
    // 思考强度弹层从输入行向上展开（底部锚定，距底约 58px）：
    // 所需卡片高度 = 距底偏移 + 菜单高度 + 余量，避免矮卡片裁掉弹层顶部
    if (chatEffortOpen && chatEffortMenuRef.current) {
      const menuNeeded = 58 + chatEffortMenuRef.current.offsetHeight + 8;
      if (height < menuNeeded) height = menuNeeded;
    }
    // 历史记录面板打开：卡片高度自适应历史记录数量。
    // 注意：不能量 .history-panel 自身的 scrollHeight —— 面板是 overflow:hidden 的
    // flex 容器且带 max-height，卡片矮时内容被压缩，scrollHeight 只反映被裁剪后的
    // 可见高度，永远撑不大卡片。改为量列表容器 .history-list 的 scrollHeight
    // （滚动容器内容总高不受裁剪影响）+ 标题栏高度，算出面板内容自然高度。
    if (historyOpen && historyPanelRef.current) {
      const panelEl = historyPanelRef.current;
      const headEl = panelEl.querySelector(".history-panel-head");
      const listEl = panelEl.querySelector(".history-list");
      const emptyEl = panelEl.querySelector(".history-empty");
      const headH = headEl ? headEl.offsetHeight : 0;
      const contentH = listEl
        ? listEl.scrollHeight
        : emptyEl ? emptyEl.offsetHeight : 0;
      const panelH = headH + contentH + 8; // 面板上下 padding 4+4
      const panelBottom = 46 + panelH + 8;
      if (height < panelBottom) height = panelBottom;
    }
    height = Math.ceil(height);

    // 打字机期间高度只增不减：delta 每 30ms 到达，markdown 局部渲染（如代码块/标题
    // 未闭合）可能让测量高度短暂回缩，强制单调递增可避免卡片上下抖动，保证「逐渐、
    // 平滑增大」；完成（done）后按最终内容精确落位。
    if (state.status === "streaming" && height < lastHeightRef.current) {
      height = lastHeightRef.current;
    }

    // 按卡片高度上下限钳制（cardReady 返回）：避免超过原生最大高度导致溢出
    const limits = cardLimitsRef.current || { min: 80, max: 420 };
    height = Math.max(limits.min, Math.min(height, limits.max));

    if (height > 0 && Math.abs(height - lastHeightRef.current) > 2) {
      lastHeightRef.current = height;
      MNBridge.send("resizeCard", { height }).catch(() => {});
    }
  };

  // 打字机期间（delta 每 30ms 到达）：固定间隔轮询测量，与渲染/事件节奏解耦，
  // 卡片高度随逐字输出同步渐进增长。
  // 关键：定时器只在「进入/退出 streaming」时启停（依赖仅 isStreaming），
  // 回调经 doMeasureRef 读取最新测量上下文——若依赖整个 state，每 30ms 的
  // delta 都会重建 interval，测量将永远无法触发（v0.7.5 已踩坑）。
  const isStreaming = state.status === "streaming";
  useEffect(() => {
    if (!isStreaming && !chatSending) return undefined;
    const interval = setInterval(() => {
      if (doMeasureRef.current) doMeasureRef.current();
    }, 60);
    return () => clearInterval(interval);
  }, [isStreaming, chatSending]);

  // 非 streaming（done / 词典 / 加载 / 菜单 / 历史面板 / 笔记 / 对话等）：状态稳定后一次性测量
  // 思考块相关状态也列入依赖：纯思考阶段（loading）块从无到有/长高、完成后手动展开/收起
  // 都需要重测卡片高度（loading 期走 body.scrollHeight，思考块才会被计入）
  useEffect(() => {
    if (isStreaming) return undefined;
    const timer = setTimeout(() => {
      if (doMeasureRef.current) doMeasureRef.current();
    }, 50);
    return () => clearTimeout(timer);
  }, [state, config.theme, config.fontSize, pronounceHint, searchOpen, switchOpen, modelPickerOpen, chatPickerOpen, chatEffortOpen, historyOpen, historyLoading, historyItems, isStreaming, appendMode, appendText, noteOpen, noteText, chatOpen, chatDraft, chatMessages, chatSending, reasonDraft, reasonOpen, chatReasonDraft, chatReasonOpen]);

// 拼接模式：textarea 高度 auto-grow（基于 scrollHeight），到 CSS max-height 上限内部滚动。
  //   - onChange 触发的内容增长：见 onAppendChange，用 rAF 同步设 height；
  //   - 非 onChange 触发的内容变化（appendMode 初始文本由插件回传、appendText 划词追加
  //     由插件推来、不走 onChange）：这里 setTimeout 16ms 等 textarea 内容渲染完再量；
  //   - scrollTop = scrollHeight：追加文字后强制滚到底，让用户看到刚划词追加的最新内容。
  const adjustAppendTextarea = useCallback(() => {
    const ta = appendTextareaRef.current;
    if (!ta) return;
    // 先清空再量 scrollHeight，避免上一次显式 height 限制让 scrollHeight 失真
    ta.style.height = "auto";
    const maxH = parseFloat(getComputedStyle(ta).maxHeight) || 356;
    const target = Math.min(ta.scrollHeight, maxH);
    ta.style.height = target + "px";
    ta.scrollTop = ta.scrollHeight;
  }, []);

  useEffect(() => {
    if (!appendMode) return undefined;
    const t = setTimeout(adjustAppendTextarea, 16);
    return () => clearTimeout(t);
  }, [appendText, appendMode, adjustAppendTextarea]);

  // 词典结果 → Markdown 正文（音标/释义分组），「添加卡片」与「复制」共用
  //   includeWord: true 表示首行包含单词（用于复制到剪贴板场景）；
  //                false 表示不包含（用于「添加卡片」，标题已是单词）
  //   排版：音标分组（**音标** + 英/美各一行）、释义分组（**释义** + 每个词性一行），
  //   配合 excerptTextMarkdown=1 由 markdown.js 渲染为粗体小节标题。
  const buildDictBody = useCallback((d, includeWord) => {
    const lines = [];
    if (includeWord && d.word) {
      lines.push(d.word);
    }
    if (d.ukphone || d.usphone) {
      lines.push("**音标**");
      if (d.ukphone) lines.push(`英 /${d.ukphone}/`);
      if (d.usphone) lines.push(`美 /${d.usphone}/`);
    }
    // 同一词性的释义合并成一行（用「；」分隔），不同词性分多行 —— 与有道展示一致
    const groups = [];
    (d.translations || []).forEach((t) => {
      const pos = t.pos || "";
      if (groups.length > 0 && groups[groups.length - 1].pos === pos) {
        groups[groups.length - 1].meanings.push(t.meaning);
      } else {
        groups.push({ pos, meanings: [t.meaning] });
      }
    });
    if (groups.length > 0) {
      // 音标与释义两部分都存在时，在中间插入 `---` 分隔线（上下各空一行）；
      // 仅有其一不插入（用户可能只查到一个字段）。
      // `normalizeCardBody` 在保存卡片时也会兜底补空行，但这里显式加上更稳。
      if (d.ukphone || d.usphone) {
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      lines.push("**释义**");
      groups.forEach((g) => {
        lines.push(`${g.pos ? g.pos + " " : ""}${g.meanings.join("；")}`);
      });
    }
    return lines.join("\n");
  }, []);

  // 当前结果 → 卡片内容组成（「添加卡片」与笔记编辑共用）：
  // 查词 → 单词为标题、查词结果（音标+释义）为正文；AI 解释 → 单词为标题、解释为正文；
  // 翻译 → 原句为标题、译文为正文。kind: "translate" | "lookup" | "explain"（决定卡片颜色）。
  const buildResultParts = useCallback(() => {
    if (state.status === "dict" && state.dict) {
      // 卡片标题已是单词，正文不再重复（includeWord=false）；分组排版见 buildDictBody
      return { title: state.dict.word, body: buildDictBody(state.dict, false), kind: "lookup" };
    }
    if (state.status === "done" && (state.mode === "explain" || state.mode === "translate")) {
      return { title: state.sourceText, body: state.accumulated, kind: state.mode };
    }
    return { title: "", body: "", kind: "" };
  }, [state.status, state.dict, state.mode, state.sourceText, state.accumulated, buildDictBody]);

  // 按任务类型取卡片颜色配置（查词/AI 解释 → cardColorLookup，翻译 → cardColorTranslate）
  const colorIndexForKind = useCallback((kind) => (
    kind === "translate"
      ? (Number.isFinite(config.cardColorTranslate) ? config.cardColorTranslate : 0)
      : (Number.isFinite(config.cardColorLookup) ? config.cardColorLookup : 0)
  ), [config.cardColorTranslate, config.cardColorLookup]);

  // 「添加卡片」：把当前结果保存为一条新笔记（Markdown 模式默认开启）。
  // 经 bridge 交给插件层在「当前打开的脑图」下创建一条文字卡片（标题+正文）。
  const addCard = useCallback(async () => {
    const parts = buildResultParts();
    if (!parts.title.trim() && !parts.body.trim()) {
      showHint("暂无内容可添加为卡片");
      return;
    }
    // 规范化正文：markdown 水平线 `---` 前后必须有空行，否则会被渲染成 `## ---` 二级标题
    // （用户实测 2026-08-15：AI 解释输出 `**音标**\n---\n**释义**` 时 MN 排版混乱）
    const body = normalizeCardBody(parts.body);
    try {
      const res = await MNBridge.send("addCard", {
        title: parts.title,
        body,
        markdown: true,
        colorIndex: colorIndexForKind(parts.kind),
      });
      showHint(res && res.highlighted ? "已添加卡片到当前脑图（原文已高亮）" : "已添加卡片到当前脑图");
    } catch (error) {
      showHint(`添加卡片失败：${(error && error.message) || "请重试"}`);
    }
  }, [buildResultParts, colorIndexForKind, showHint]);

  // 「添加」按钮：单击 = 直接创建卡片（延迟 280ms 与双击区分）；双击 = 进入笔记编辑界面
  const onAddClick = () => {
    if (addTimerRef.current) {
      // 280ms 内第二次点击：判定为双击，由 onAddDoubleClick 处理
      clearTimeout(addTimerRef.current);
      addTimerRef.current = null;
      return;
    }
    addTimerRef.current = setTimeout(() => {
      addTimerRef.current = null;
      addCard();
    }, 280);
  };

  const onAddDoubleClick = (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (addTimerRef.current) {
      clearTimeout(addTimerRef.current);
      addTimerRef.current = null;
    }
    openNoteEditor();
  };

  // ---------- 笔记编辑界面（N 键 / 双击「添加」按钮进入） ----------

  // 编辑区高度由 flex 布局接管（.card-body.note-open .note-textarea）：
  // 卡片手动放大时编辑区跟随撑满、缩小时内部滚动，按钮行固定在底部始终可见，
  // 不再用 JS auto-grow（auto-grow 的显式 height 会与 flex 伸缩互相打架）。

  // 进入笔记编辑：按设置决定是否自动附带查词/翻译结果（或对话回答），
  // 附带时笔记添加在结果之后，以「---」分隔（上下各空一行，避免 MarginNote 渲染错误）。
  // customParts = {title, body, kind}：来自 AI 对话回答（气泡「添加笔记」双击），不传则取当前结果
  const openNoteEditor = useCallback((customParts) => {
    const isCustom = !!(customParts && (customParts.title || customParts.body));
    const parts = isCustom
      ? { title: customParts.title || "", body: customParts.body || "", kind: customParts.kind || "" }
      : buildResultParts();
    if (!String(parts.title).trim() && !String(parts.body).trim()) {
      showHint(isCustom ? "内容为空" : "暂无查词/翻译结果，先查询后再编辑笔记");
      return;
    }
    noteKindRef.current = parts.kind || "";
    const includeResult = config.noteIncludeResult !== false;
    setNoteTitle(parts.title || "");
    setNoteText(includeResult ? parts.body + "\n\n---\n\n" : "");
    setNoteOpen(true);
    // 聚焦到编辑区末尾（紧接分隔线之后，直接开始写笔记）
    setTimeout(() => {
      const ta = noteTextareaRef.current;
      if (!ta) return;
      try { window.focus(); } catch (err) { /* ignore */ }
      ta.focus();
      const pos = ta.value.length;
      try { ta.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
    }, 60);
  }, [buildResultParts, config.noteIncludeResult, showHint]);

  const closeNoteEditor = useCallback(() => {
    setNoteOpen(false);
    setNoteTitle("");
    setNoteText("");
    noteKindRef.current = "";
  }, []);

  // 保存笔记并创建卡片：正文 = 编辑区内容（含自动附带的结果时已是「结果 --- 笔记」结构），
  // 标题 = 标题框内容（默认为单词/原句，可编辑，为空时回落结果标题）；
  // Option+S 快捷键与「保存并创建卡片」按钮共用。
  // 卡片颜色按进入编辑时的上下文类型（noteKindRef：结果任务类型 / 对话回答 = lookup）
  const saveNote = useCallback(async () => {
    if (!noteText.trim()) {
      showHint("笔记内容为空");
      return;
    }
    const parts = buildResultParts();
    const body = normalizeCardBody(noteText);
    const title = noteTitle.trim() || parts.title;
    try {
      await MNBridge.send("addCard", {
        title,
        body,
        markdown: true,
        colorIndex: colorIndexForKind(noteKindRef.current || parts.kind),
      });
      showHint("笔记已保存并创建卡片");
      closeNoteEditor();
    } catch (error) {
      showHint(`保存笔记失败：${(error && error.message) || "请重试"}`);
    }
  }, [noteTitle, noteText, buildResultParts, colorIndexForKind, closeNoteEditor, showHint]);

  const onNoteChange = (e) => {
    setNoteText(e.target.value);
  };

  // ---------- 机器人图标：单击/双击触发不同 prompt，长按进入 AI 对话 ----------

  const runRobotPrompt = useCallback(async (promptKey) => {
    try {
      await MNBridge.send("robotRun", { promptKey });
    } catch (e) {
      // 请求级失败（如当前没有进行中的任务）：插件层无 error 事件，此处提示
      showHint(`执行失败：${(e && e.message) || "请重试"}`);
    }
  }, [showHint]);

  // AI 对话（长按机器人进入）：自动将选中文本（当前任务文本）填入输入框
  const openChat = useCallback(() => {
    load(); // 打开前刷新配置（路由/开关可能在设置页已改）
    setChatOpen(true);
    setChatInput(state.sourceText || "");
    setTimeout(() => {
      const input = document.querySelector(".chat-input");
      if (input) {
        try { window.focus(); } catch (err) { /* ignore */ }
        input.focus();
        const pos = input.value.length;
        try { input.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
      }
    }, 60);
  }, [state.sourceText, load]);

  const openChatRef = useRef(null);
  openChatRef.current = openChat;

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatMessages([]);
    setChatDraft("");
    setChatInput("");
    setChatSending(false);
    setChatEffortOpen(false);
    setChatReasonDraft("");
    setChatReasonOpen(true);
    chatReasonCollapsedRef.current = false;
  }, []);

  // 新建对话：清空当前消息与流式草稿（已保存的历史不受影响），输入框保留选中内容，
  // 下一条消息从新对话开始；回复中禁用（避免流式增量把刚清空的界面又填回来）
  const startNewChat = useCallback(() => {
    if (chatSending) return;
    setChatMessages([]);
    setChatDraft("");
    setChatEffortOpen(false);
    setChatReasonDraft("");
    setChatReasonOpen(true);
    chatReasonCollapsedRef.current = false;
  }, [chatSending]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    const msgs = [...chatMessages, { role: "user", text }];
    setChatMessages(msgs);
    setChatInput("");
    setChatSending(true);
    // 新一轮回答：思考块复位（本轮思考内容从零累积）
    setChatReasonDraft("");
    setChatReasonOpen(true);
    chatReasonCollapsedRef.current = false;
    try {
      // 前端持有对话状态，每次发送全量历史；回复经 chatDelta/chatDone/chatError 事件推回。
      // 模型/思考强度不随请求覆盖：插件侧读 chat 路由（对话界面切换时已持久化）
      await MNBridge.send("chatSend", {
        messages: msgs.map((m) => ({ role: m.role, content: m.text })),
      });
    } catch (e) {
      setChatSending(false);
      showHint(`发送失败：${(e && e.message) || "请重试"}`);
    }
  }, [chatInput, chatMessages, chatSending, showHint]);

  // 暂停生成（发送按钮切换而来）：取消插件侧流式请求，已生成的部分保留并追加为回答。
  // 用 ref 读最新状态：await 返回时 chatDone 可能已先到（回答自然完成），避免重复追加
  // （StrictMode 下不能在 setState updater 里再触发其它 setState）
  const chatSendingRef = useRef(false);
  const chatDraftRef = useRef("");
  const chatReasonDraftRef = useRef(""); // 对话思考内容镜像（chatDone/暂停收尾时随消息存档）
  useEffect(() => { chatSendingRef.current = chatSending; }, [chatSending]);
  useEffect(() => { chatDraftRef.current = chatDraft; }, [chatDraft]);
  useEffect(() => { chatReasonDraftRef.current = chatReasonDraft; }, [chatReasonDraft]);

  const stopChat = useCallback(async () => {
    if (!chatSendingRef.current) return;
    try {
      await MNBridge.send("chatStop");
    } catch (e) { /* 取消失败也本地收尾（流可能已自行结束） */ }
    if (!chatSendingRef.current) return; // chatDone 已先到，由其收尾
    setChatSending(false);
    const partial = (chatDraftRef.current || "").trim();
    if (partial) {
      setChatMessages((prev) => [...prev, {
        role: "assistant",
        text: partial,
        reason: chatReasonDraftRef.current || "",
      }]);
    }
    setChatDraft("");
    setChatReasonDraft("");
  }, []);

  // ---------- AI 对话：模型选择 / 思考强度 / 重新回答 / 回答操作 ----------

  // 当前生效的对话模型与思考强度（持久化在 chat 路由：对话界面切换时写入，= 上次使用）
  const chatRoute = (config.routing && config.routing.chat) || {};
  const chatModelId = chatRoute.modelId || "";
  const chatModelShort = chatModelId ? chatModelId.split("/").pop() : "未选择";

  const chatEffort = chatRoute.reasoningEffort || "off";

  // 当前模型是否「确认」支持思考（与设置页同一判定：模型经「测试」探测
  // supportsReasoning === true 才放开；false = 探测不支持，null/未知 = 未探测）。
  // 未确认支持的模型禁用思考强度按钮，避免发出厂商不认识的思考参数导致 400。
  const chatEffortProvider = config.providers.find((p) => p.id === chatRoute.providerId);
  const chatEffortModel = chatEffortProvider &&
    chatEffortProvider.models.find((m) => m.id === chatModelId);
  const chatModelSupportsReasoning = !!(chatEffortProvider && chatEffortModel &&
    chatEffortModel.supportsReasoning === true);

  // AI 对话面板是否可见：笔记编辑界面打开时隐藏对话（双击回答「添加笔记」进入编辑时
  // 不再在编辑框下方露出之前的对话）；退出编辑后对话恢复（消息保留可继续追问）。
  // 注意：historyKind / modeLabel 等都在本组件更靠前的位置引用，必须在此处（首次使用前）定义
  const chatPanelVisible = chatOpen && !noteOpen;

  // 重新回答第 index 条回答：截断该条之前的对话（含触发它的提问）重新发送
  const reAnswerAt = useCallback(async (index) => {
    const prefix = chatMessages.slice(0, index).filter((m) => m && (m.role === "user" || m.role === "assistant"));
    if (prefix.length === 0) return;
    setChatMessages(prefix);
    setChatDraft("");
    setChatSending(true);
    // 重答：思考块复位（新回答的思考内容从零累积）
    setChatReasonDraft("");
    setChatReasonOpen(true);
    chatReasonCollapsedRef.current = false;
    try {
      await MNBridge.send("chatSend", {
        messages: prefix.map((m) => ({ role: m.role, content: m.text })),
      });
    } catch (e) {
      setChatSending(false);
      showHint(`重新回答失败：${(e && e.message) || "请重试"}`);
    }
  }, [chatMessages, showHint]);

  // 模型选择弹层确认：写入 chat 路由并持久化（= 上次使用的模型，跨会话记忆）；
  // target 非空时同时触发该条重新回答（await 持久化完成，保证插件读到新路由）
  const pickChatModel = async (providerId, modelId) => {
    setChatPickerOpen(false);
    const target = chatPickerTarget;
    setChatPickerTarget(null);
    await update((c) => {
      c.routing.chat = {
        providerId: providerId || "",
        modelId: modelId || "",
        temperature: (c.routing.chat && c.routing.chat.temperature) || 0.3,
        reasoningEffort: (c.routing.chat && c.routing.chat.reasoningEffort) || "off",
      };
    });
    if (target != null) reAnswerAt(target);
  };

  // 思考强度弹层确认：写入 chat 路由并持久化（随下一次对话请求生效）
  const pickChatEffort = (value) => {
    setChatEffortOpen(false);
    update((c) => {
      if (c.routing.chat) c.routing.chat.reasoningEffort = value;
    });
  };

  // 回答气泡 → 笔记内容：标题取该回答前面的最近提问（无则当前任务文本），正文为回答全文
  const chatNoteParts = (i) => {
    const answer = String((chatMessages[i] && chatMessages[i].text) || "");
    let q = "";
    for (let j = i - 1; j >= 0; j--) {
      if (chatMessages[j] && chatMessages[j].role === "user") {
        q = chatMessages[j].text;
        break;
      }
    }
    return { title: q || state.sourceText || "AI 问答", body: answer };
  };

  const copyChatAnswer = async (text) => {
    if (!text) return;
    try {
      await MNBridge.send("copyText", { text });
      showHint("已复制到剪贴板");
    } catch (e) {
      showHint("复制失败，请重试");
    }
  };

  // 「添加笔记」：单击直接创建卡片；双击进入笔记编辑（与结果卡片「添加」按钮一致）
  const addChatNoteDirect = async (i) => {
    const { title, body } = chatNoteParts(i);
    if (!body.trim()) {
      showHint("内容为空");
      return;
    }
    try {
      const res = await MNBridge.send("addCard", {
        title,
        body: normalizeCardBody(body),
        markdown: true,
        colorIndex: colorIndexForKind("lookup"),
      });
      showHint(res && res.highlighted ? "已添加卡片到当前脑图（原文已高亮）" : "已添加卡片到当前脑图");
    } catch (error) {
      showHint(`添加卡片失败：${(error && error.message) || "请重试"}`);
    }
  };

  const onChatAddClick = (i) => () => {
    if (chatAddTimerRef.current) {
      clearTimeout(chatAddTimerRef.current);
      chatAddTimerRef.current = null;
      return;
    }
    chatAddTimerRef.current = setTimeout(() => {
      chatAddTimerRef.current = null;
      addChatNoteDirect(i);
    }, 280);
  };

  const onChatAddDoubleClick = (i) => (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (chatAddTimerRef.current) {
      clearTimeout(chatAddTimerRef.current);
      chatAddTimerRef.current = null;
    }
    const { title, body } = chatNoteParts(i);
    openNoteEditor({ title, body, kind: "lookup" });
  };

  // 「重新回答」长按阈值（与「重新生成」一致，早于系统长按手势）
  const REANS_LONG_PRESS_MS = 400;
  const isRecentReAnsTouch = () => Date.now() - reAnsTouchAtRef.current < 500;

  const startReAnsTimer = (i) => {
    if (reAnsTimerRef.current) clearTimeout(reAnsTimerRef.current);
    reAnsTimerRef.current = setTimeout(() => {
      reAnsLongRef.current = true;
      load(); // 打开前刷新提供商/模型列表（设置页可能已改）
      setChatPickerTarget(i);
      setChatPickerOpen(true);
    }, REANS_LONG_PRESS_MS);
  };

  const stopReAnsTimer = () => {
    if (reAnsTimerRef.current) {
      clearTimeout(reAnsTimerRef.current);
      reAnsTimerRef.current = null;
    }
  };

  // 鼠标路径（每条回答各一份 handler，闭包捕获索引）
  const onReAnsMouseDown = (i) => () => {
    if (isRecentReAnsTouch()) return;
    reAnsLongRef.current = false;
    startReAnsTimer(i);
  };

  const onReAnsMouseUp = () => () => {
    if (isRecentReAnsTouch()) return;
    stopReAnsTimer();
  };

  const onReAnsMouseLeave = () => () => {
    if (isRecentReAnsTouch()) return;
    stopReAnsTimer();
    if (reAnsLongRef.current) reAnsLongRef.current = false;
  };

  const onReAnsClick = (i) => () => {
    if (isRecentReAnsTouch()) return;
    stopReAnsTimer();
    if (reAnsLongRef.current) {
      reAnsLongRef.current = false;
      return; // 长按已打开选模型，点击不重复回答
    }
    reAnswerAt(i, null);
  };

  // 触摸路径（iPad / Apple Pencil）：长按 → 选模型；轻点 → 重新回答
  const onReAnsTouchStart = (i) => () => {
    reAnsTouchAtRef.current = Date.now();
    reAnsLongRef.current = false;
    startReAnsTimer(i);
  };

  const onReAnsTouchEnd = (i) => () => {
    reAnsTouchAtRef.current = Date.now();
    const wasLong = reAnsLongRef.current;
    stopReAnsTimer();
    if (wasLong) {
      reAnsLongRef.current = false;
      return; // 长按已打开选模型
    }
    reAnswerAt(i, null);
  };

  const onReAnsTouchCancel = () => () => {
    reAnsTouchAtRef.current = Date.now();
    stopReAnsTimer();
    reAnsLongRef.current = false;
  };

  // 对话消息更新后滚动到底部（最新消息可见）
  useEffect(() => {
    const list = chatListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatMessages, chatDraft, chatOpen]);

  // 机器人长按阈值（同「重新生成」400ms，早于系统长按手势）
  const ROBOT_LONG_PRESS_MS = 400;
  const clearRobotTimers = () => {
    if (robotTimerRef.current) {
      clearTimeout(robotTimerRef.current);
      robotTimerRef.current = null;
    }
    if (robotPressTimerRef.current) {
      clearTimeout(robotPressTimerRef.current);
      robotPressTimerRef.current = null;
    }
  };
  const isRecentRobotTouch = () => Date.now() - robotTouchAtRef.current < 500;

  const robotLongPressFire = () => {
    robotLongFiredRef.current = true;
    openChatRef.current(); // 长按进入 AI 对话：功能常开（设置开关已移除）
  };

  // 鼠标路径：mousedown 起长按计时；click 经 280ms 延迟与双击区分；长按后抑制 click
  const onRobotMouseDown = () => {
    if (isRecentRobotTouch()) return;
    robotLongFiredRef.current = false;
    if (robotPressTimerRef.current) clearTimeout(robotPressTimerRef.current);
    robotPressTimerRef.current = setTimeout(robotLongPressFire, ROBOT_LONG_PRESS_MS);
  };

  const onRobotMouseUp = () => {
    if (isRecentRobotTouch()) return;
    if (robotPressTimerRef.current) {
      clearTimeout(robotPressTimerRef.current);
      robotPressTimerRef.current = null;
    }
  };

  const onRobotMouseLeave = () => {
    if (isRecentRobotTouch()) return;
    if (robotPressTimerRef.current) {
      clearTimeout(robotPressTimerRef.current);
      robotPressTimerRef.current = null;
    }
    if (robotLongFiredRef.current) robotLongFiredRef.current = false;
  };

  const onRobotClick = () => {
    if (isRecentRobotTouch()) return;
    if (robotLongFiredRef.current) {
      robotLongFiredRef.current = false;
      return; // 长按已进入 AI 对话，点击不触发 prompt
    }
    if (robotTimerRef.current) {
      // 280ms 内第二次点击：判定为双击，由 onRobotDoubleClick 处理
      clearTimeout(robotTimerRef.current);
      robotTimerRef.current = null;
      return;
    }
    robotTimerRef.current = setTimeout(() => {
      robotTimerRef.current = null;
      runRobotPrompt("explain"); // 单击 = AI 解释 prompt（与设置「AI 解释 Prompt」同一模板）
    }, 280);
  };

  const onRobotDoubleClick = (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (isRecentRobotTouch()) return;
    if (robotTimerRef.current) {
      clearTimeout(robotTimerRef.current);
      robotTimerRef.current = null;
    }
    if (robotLongFiredRef.current) {
      robotLongFiredRef.current = false;
      return;
    }
    runRobotPrompt("robotDouble");
  };

  // 触摸路径（iPad / Apple Pencil）：长按 → AI 对话；轻点 → 单击 prompt
  // （触摸后的合成 mouse 事件 500ms 内一律忽略，避免双触发；触摸双击暂不支持）
  const bindRobotTouch = useCallback((el) => {
    if (robotTouchCleanupRef.current) {
      robotTouchCleanupRef.current();
      robotTouchCleanupRef.current = null;
    }
    if (!el) return;

    let active = false;

    const onTouchStart = (e) => {
      robotTouchAtRef.current = Date.now();
      active = true;
      robotLongFiredRef.current = false;
      if (robotPressTimerRef.current) clearTimeout(robotPressTimerRef.current);
      if (e.cancelable) e.preventDefault(); // 抑制系统长按手势
      robotPressTimerRef.current = setTimeout(() => {
        if (!active) return;
        robotLongPressFire();
      }, ROBOT_LONG_PRESS_MS);
    };

    const onTouchMove = (e) => {
      const t = e.touches && e.touches[0];
      if (t) {
        const r = el.getBoundingClientRect();
        if (
          t.clientX >= r.left - 12 &&
          t.clientX <= r.right + 12 &&
          t.clientY >= r.top - 12 &&
          t.clientY <= r.bottom + 12
        ) {
          return;
        }
      }
      active = false;
      if (robotPressTimerRef.current) {
        clearTimeout(robotPressTimerRef.current);
        robotPressTimerRef.current = null;
      }
    };

    const onTouchEnd = () => {
      robotTouchAtRef.current = Date.now();
      const wasLong = robotLongFiredRef.current;
      const wasActive = active;
      active = false;
      if (robotPressTimerRef.current) {
        clearTimeout(robotPressTimerRef.current);
        robotPressTimerRef.current = null;
      }
      if (wasLong) {
        robotLongFiredRef.current = false;
        return; // 长按已进入 AI 对话
      }
      if (wasActive) {
        runRobotPrompt("explain"); // 轻点 = 单击（AI 解释 prompt）
      }
    };

    const onTouchCancel = () => {
      robotTouchAtRef.current = Date.now();
      active = false;
      if (robotPressTimerRef.current) {
        clearTimeout(robotPressTimerRef.current);
        robotPressTimerRef.current = null;
      }
      if (robotLongFiredRef.current) robotLongFiredRef.current = false;
    };

    try {
      el.addEventListener("touchstart", onTouchStart, { passive: false });
    } catch (err) {
      el.addEventListener("touchstart", onTouchStart, false);
    }
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    robotTouchCleanupRef.current = () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [runRobotPrompt]);

  // ---------- 快捷键历史导航（上/左 = 上一条，下/右 = 下一条） ----------

  // step: +1 = 上一个（更早），-1 = 下一个（更新）；列表按最近使用优先（与历史面板一致）。
  // 从头开始导航（idx=-1）时重新拉取：缓存持久化后新查询会追加，旧列表可能过期
  const navHistory = useCallback(async (step) => {
    const kind = state.mode === "translate" ? "translate" : "lookup";
    if (!histNavListRef.current || histNavKindRef.current !== kind || histNavIdxRef.current === -1) {
      try {
        const r = await MNBridge.send("getHistory", { kind });
        histNavListRef.current = (r && r.items) || [];
        histNavKindRef.current = kind;
        if (histNavIdxRef.current !== -1) histNavIdxRef.current = -1;
      } catch (e) {
        histNavListRef.current = [];
      }
    }
    const list = histNavListRef.current;
    if (!list.length) {
      showHint("暂无历史记录");
      return;
    }
    const idx = histNavIdxRef.current + step;
    if (idx < 0) {
      showHint("已是最新一条");
      return;
    }
    if (idx >= list.length) {
      showHint("没有更早的历史记录");
      return;
    }
    histNavIdxRef.current = idx;
    // 与事件侧一致取 trim 后文本（插件 applyHistory 推 loading 时会 trim），
    // 否则首尾空白差异会导致索引被误判为新任务而重置
    histNavAppliedRef.current = String(list[idx].sourceText || "").trim();
    try {
      await MNBridge.send("applyHistory", { kind, item: list[idx] });
      showHint(`历史 ${idx + 1}/${list.length}`);
    } catch (e) {
      // 插件层已兜底
    }
  }, [state.mode, showHint]);

  // ---------- 快捷键统一入口（D / N / C / Option+S / 方向键，设置中可自定义） ----------

  // D：聚焦搜索框（Enter 查询走搜索框已有逻辑）；N：进入笔记编辑；C：进入 AI 对话；
  // Option+S：保存笔记并创建卡片（仅笔记编辑界面内生效，且需拦截避免输入特殊字符）；
  // 上/左、下/右：历史导航。输入框/编辑区内（除 Option+S）不触发，避免误伤打字。
  shortcutsRef.current = (e) => {
    const sc = config.shortcuts || {};
    const saveSc = parseShortcut(sc.save || "alt+s");
    if (matchShortcut(e, saveSc)) {
      // Option+S 会输入特殊字符（如 ß）：在笔记编辑界面内拦截并保存，其他场景放行
      if (noteOpen) {
        e.preventDefault();
        saveNote();
      }
      return;
    }
    const t = e.target;
    const inEditable = !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
    if (inEditable) return; // 打字中：单键快捷键不触发（方向键移动光标等保持原生行为）
    if (noteOpen || chatOpen) return; // 笔记/对话界面：方向键等留给编辑器
    if (appendMode) return; // 拼接编辑界面同理
    if (matchAnyShortcut(e, sc.historyPrev || "ArrowUp,ArrowLeft")) {
      e.preventDefault();
      navHistory(1); // 上一个（更早）
      return;
    }
    if (matchAnyShortcut(e, sc.historyNext || "ArrowDown,ArrowRight")) {
      e.preventDefault();
      navHistory(-1); // 下一个（更新）
      return;
    }
    if (matchShortcut(e, parseShortcut(sc.lookup || "d"))) {
      e.preventDefault();
      setSearchText("");
      setSearchOpen(true);
      setSearchFocusTick((v) => v + 1); // 已展开时也重新触发聚焦
      return;
    }
    if (matchShortcut(e, parseShortcut(sc.note || "n"))) {
      e.preventDefault();
      openNoteEditor();
      return;
    }
    if (matchShortcut(e, parseShortcut(sc.chat || "c"))) {
      e.preventDefault();
      openChatRef.current(); // 同长按机器人图标：进入 AI 对话
    }
  };

  // 快捷键监听只绑定一次，回调经 shortcutsRef 读取最新闭包（同 doMeasureRef 模式）
  useEffect(() => {
    const onKeydown = (e) => {
      if (shortcutsRef.current) shortcutsRef.current(e);
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, []);

  // 规范化卡片正文的 markdown 水平线：
  //   - 识别单独成行的 `---`（允许行尾空格）；
  //   - 若该行前一行非空，则补一个空行；若后一行非空，则补一个空行；
  //   - 已带空行的（`\n\n---\n\n`）保持原样不重复添加。
  // 这是纯函数（不依赖组件状态），独立于 useCallback 之外。
  const normalizeCardBody = (src) => {
    if (!src) return src;
    const lines = src.split("\n");
    const out = [];
    let needBlankBefore = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isHr = /^---[ \t]*$/.test(line);
      if (isHr) {
        // 前一行非空 → 补空行（避免 `---` 与上文粘连）
        if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
        out.push(line);
        needBlankBefore = true; // 后一行非空时补空行
        continue;
      }
      if (needBlankBefore && line.trim() !== "") out.push("");
      out.push(line);
      needBlankBefore = false;
    }
    return out.join("\n");
  };

  // 复制当前结果文本（工具栏复制按钮已移除，改为结果卡片内双击自动复制）
  const copyResult = async (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault(); // 阻止双击默认选词
    let text = "";
    if (state.status === "dict" && state.dict) {
      // 复制场景：完整内容（单词 + 音标 + 释义），includeWord=true
      text = buildDictBody(state.dict, true);
    } else {
      text = state.accumulated;
    }
    if (!text) return;
    try {
      await MNBridge.send("copyText", { text });
      showHint("已复制到剪贴板");
    } catch (error) {
      showHint("复制失败，请重试");
    }
  };

  // ---------- 历史记录（数据源 = 查词/翻译缓存） ----------

  // 当前界面对应的历史类型：AI 问答（对话界面）/ 查词（含 AI 解释）/ 翻译，各自独立
  const historyKind = chatPanelVisible
    ? "chat"
    : (state.mode === "translate" ? "translate" : "lookup");

  const openHistory = useCallback(async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryItems([]);
    try {
      if (historyKind === "chat") {
        // AI 问答历史：[{question, answer, at}]，列表显示发送给 AI 的问题
        const r = await MNBridge.send("getChatHistory");
        setHistoryItems((r && r.items) || []);
      } else {
        const r = await MNBridge.send("getHistory", { kind: historyKind });
        setHistoryItems((r && r.items) || []);
      }
    } catch (e) {
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOpen, historyKind]);

  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    setHistoryItems([]);
  }, []);

  // 点击历史条目：AI 问答 → 回放该轮问答到对话界面；查词/翻译 → 插件层推送缓存内容
  const applyHistoryItem = useCallback(
    async (item) => {
      setHistoryOpen(false);
      setHistoryItems([]);
      if (historyKind === "chat") {
        // 回放：作为对话上下文载入，可继续追问（后续发送全量历史）
        setChatMessages([
          { role: "user", text: String(item.question || "") },
          { role: "assistant", text: String(item.answer || "") },
        ].filter((m) => m.text));
        return;
      }
      try {
        await MNBridge.send("applyHistory", { kind: historyKind, item });
      } catch (e) {
        // 插件层已兜底
      }
    },
    [historyKind]
  );

  // 查词历史标签：不同查词服务不同底色（白字）
  const LOOKUP_TAG = {
    youdao: { label: "YD", bg: "rgb(250, 100, 100)" },
    bing: { label: "BY", bg: "rgb(85, 166, 242)" },
    haici: { label: "HC", bg: "rgb(85, 211, 242)" },
    kingsoft: { label: "JS", bg: "rgb(112, 181, 120)" },
    ai: { label: "AI", bg: "rgb(229, 173, 255)" },
  };

  // 查词历史条目的标签：AI 解释（type=ai）→ AI 标签；词典 → 按服务商标签，未知回落有道
  const lookupTag = (item) => {
    if (item.type === "ai") return LOOKUP_TAG.ai;
    return LOOKUP_TAG[item.provider] || LOOKUP_TAG.youdao;
  };

  // 图钉固定：切换固定状态并通知插件层（原生层据此决定点击外部是否关闭卡片）
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    MNBridge.send("setCardPinned", { pinned: next }).catch(() => {});
  };

  // ---------- 拼接模式（双击图钉：跨页段落手动拼接翻译） ----------
  // 单击图钉 = 固定/取消固定（延迟 280ms 判定，避免与双击冲突）；
  // 双击图钉 = 进入/退出拼接模式（进入时固定卡片）。

  const toggleAppendMode = async () => {
    if (appendMode) {
      // 退出拼接模式（未翻译时）：清编辑区，通知插件清会话，
      // 恢复进入拼接模式前的 pinned 状态（拼接期间只是临时固定）
      setAppendMode(false);
      setAppendText("");
      const wasPinned = !!prevPinnedRef.current;
      if (!wasPinned) {
        setPinned(false);
        MNBridge.send("setCardPinned", { pinned: false }).catch(() => {});
      }
      try {
        await MNBridge.send("exitAppendMode");
      } catch (e) { /* 插件已兜底 */ }
      return;
    }
    // 进入拼接模式：记录原 pinned 状态（用于「开始翻译」后恢复），
    // 插件取消当前翻译、固定卡片，并返回最近选区文本作为拼接起点
    prevPinnedRef.current = pinned;
    try {
      const r = await MNBridge.send("enterAppendMode");
      setAppendMode(true);
      setAppendText((r && r.text) || "");
      setPinned(true); // 拼接期间临时固定：划词追加时点空白不关闭卡片
    } catch (e) { /* 插件已兜底 */ }
  };

  const onPinClick = () => {
    if (pinTimerRef.current) {
      // 第二次点击在 280ms 内：判定为双击，由 onPinDoubleClick 处理，这里取消单击
      clearTimeout(pinTimerRef.current);
      pinTimerRef.current = null;
      return;
    }
    pinTimerRef.current = setTimeout(() => {
      pinTimerRef.current = null;
      togglePin();
    }, 280);
  };

  const onPinDoubleClick = (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (pinTimerRef.current) {
      clearTimeout(pinTimerRef.current);
      pinTimerRef.current = null;
    }
    toggleAppendMode();
  };

// 拼接编辑区输入：实时 setAppendText + requestAnimationFrame 同步调高度，
  //   避免 useEffect 异步延迟导致 textarea 高度落后于输入（闪一下再变高）。
const onAppendChange = (e) => {
  setAppendText(e.target.value);
  requestAnimationFrame(adjustAppendTextarea);
};

  // 「开始翻译」：把编辑后的拼接文本交给插件走正常翻译/查词流程
  const startAppendTranslate = async () => {
    const t = (appendText || "").trim();
    if (!t) return;
    try {
      await MNBridge.send("appendTranslate", { text: appendText });
      // 翻译开始：恢复原 pinned 状态。
      //   - 进入拼接前已固定 → 翻译后保持固定（用户主动选择固定）
      //   - 进入拼接前未固定 → 翻译后取消固定，方便翻译结束后点空白关闭卡片
      if (!prevPinnedRef.current) {
        setPinned(false);
        MNBridge.send("setCardPinned", { pinned: false }).catch(() => {});
      }
      // 插件推送 reset/loading 后，事件处理里会自动退出拼接界面
    } catch (e) { /* 插件已兜底 */ }
  };

  const clearAppend = () => {
    setAppendText("");
    requestAnimationFrame(adjustAppendTextarea);
  };

  const retry = () => {
    // 重新触发当前任务（插件侧 job 仍保留）
    MNBridge.send("cardReady").catch(() => {});
  };

  // 对话界面时工具栏左侧文字切换为「AI问答」（历史按钮提示随之变化）
  const modeLabel = chatPanelVisible
    ? "AI问答"
    : (state.mode === "lookup" ? "查词" : state.mode === "explain" ? "AI 解释" : "翻译");

  // AI 类结果（翻译 / AI 解释）显示「重新生成」按钮
  const isAIMode = state.mode === "explain" || state.mode === "translate";
  const canRegenerate = isAIMode && ["done", "streaming", "error"].includes(state.status);

  // 查词服务切换菜单选项
  const LOOKUP_OPTIONS = [
    { value: "youdao", label: "有道词典" },
    { value: "bing", label: "必应词典" },
    { value: "haici", label: "海词词典" },
    { value: "kingsoft", label: "金山词霸" },
    { value: "ai", label: "AI 解释" },
  ];

  return (
    <div className={"card-page" + (state.status === "dict" ? " dict-mode" : "")}>
      <div className="card-toolbar" ref={toolbarRef}>
        <span className="card-mode">
          <button
            className="card-drag-hint"
            title="点击切换查词服务 / AI 解释（按住此处可拖动窗口）"
            onClick={() => setSwitchOpen(true)}
          >
            <DragIcon />
          </button>
          {modeLabel}
        </span>

        {searchOpen ? (
          <span className="card-search">
            <input
              ref={searchInputRef}
              className="card-search-input"
              placeholder="输入单词查询…"
              value={searchText}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
                if (e.key === "Escape") closeSearch();
              }}
            />
            <button className="icon-btn" title="查询" onClick={submitSearch}>
              <SearchIcon />
            </button>
            <button className="icon-btn" title="关闭搜索" onClick={closeSearch}>
              <CloseIcon />
            </button>
          </span>
        ) : (
          <span className="card-toolbar-actions">
            {/* AI 解释界面：发音按钮在前，搜索/重新生成后移；「添加」按钮紧随发音按钮 */}
            {state.mode === "explain" && state.status === "done" && (
              <>
                <button
                  className="icon-btn speak-btn"
                  title="英音（按「AI 解释发音」配置的词典）"
                  onClick={() => playPronounce("uk")}
                  disabled={!!speaking}
                >
                  <SpeakerIcon />
                  <span className="speak-label">{speaking === "uk" ? "…" : "英"}</span>
                </button>
                <button
                  className="icon-btn speak-btn"
                  title="美音（按「AI 解释发音」配置的词典）"
                  onClick={() => playPronounce("us")}
                  disabled={!!speaking}
                >
                  <SpeakerIcon />
                  <span className="speak-label">{speaking === "us" ? "…" : "美"}</span>
                </button>
                <button
                  className="icon-btn add-btn"
                  title="添加为卡片：单词为标题、AI 解释为正文（Markdown）；双击进入笔记编辑"
                  onClick={onAddClick}
                  onDoubleClick={onAddDoubleClick}
                >
                  <AddIcon />
                </button>
              </>
            )}
            {/* 查词结果 / 翻译结果：「添加」按钮位于搜索按钮之前 */}
            {(state.status === "dict" ||
              (state.mode === "translate" && state.status === "done")) && (
              <button
                className="icon-btn add-btn"
                title={
                  (state.status === "dict"
                    ? "添加为卡片：单词为标题、查词结果（音标+释义）为正文"
                    : "添加为卡片：原句为标题、翻译为正文（Markdown）") +
                  "；双击进入笔记编辑"
                }
                onClick={onAddClick}
                onDoubleClick={onAddDoubleClick}
              >
                <AddIcon />
              </button>
            )}
            <button
              className="icon-btn search-btn"
              title="搜索单词（用默认查词服务查询）"
              onClick={() => {
                setSearchText("");
                setSearchOpen(true);
              }}
            >
              <SearchIcon />
            </button>
            {canRegenerate && (
              <button
                ref={bindRegenTouch}
                className="icon-btn regen-btn"
                title="点击重新生成；长按选择模型"
                onMouseDown={onRegenerateMouseDown}
                onMouseUp={onRegenerateMouseUp}
                onMouseLeave={onRegenerateMouseLeave}
              >
                <RefreshIcon />
              </button>
            )}
            {/* 机器人：单击 = AI 解释（与「AI 解释 Prompt」同一模板）；双击 = 深度分析（robotDouble prompt）；
                长按 = AI 对话（自动填入选中文本，路由见设置「模型路由 → AI 对话」）。
                两种 prompt 均可在设置「Prompt 模板」中自定义 */}
            {(state.status === "dict" || state.status === "done") && (
              <button
                ref={bindRobotTouch}
                className="icon-btn robot-btn"
                title="单击：AI 解释；双击：长难句解释；长按或按 C：AI 对话"
                onMouseDown={onRobotMouseDown}
                onMouseUp={onRobotMouseUp}
                onMouseLeave={onRobotMouseLeave}
                onClick={onRobotClick}
                onDoubleClick={onRobotDoubleClick}
              >
                <RobotIcon />
              </button>
            )}
            <button
              className="icon-btn history-btn"
              title={`查看${modeLabel}历史记录（缓存）`}
              onClick={openHistory}
            >
              <HistoryIcon />
            </button>
            <button
              className={"icon-btn pin-btn" + (pinned ? " active" : "")}
              title={appendMode
                ? "拼接模式：继续划词追加，编辑后点「开始翻译」（双击退出拼接）"
                : (pinned
                  ? "已固定：点击取消固定；双击进入拼接模式"
                  : "固定卡片（点击）；双击进入拼接模式（跨页段落拼接翻译）")}
              onClick={onPinClick}
              onDoubleClick={onPinDoubleClick}
            >
              <PinIcon />
            </button>
          </span>
        )}
      </div>

      {pronounceHint && (
        <div className="pronounce-hint" role="status">{pronounceHint}</div>
      )}

      {/* chat-open / note-open：card-body 转纵向 flex（见 styles.css），
          卡片被手动拉大/缩小时对话输入区与笔记编辑面板跟随伸缩、按钮行贴住卡片底部 */}
      <div
        className={
          "card-body" +
          (chatPanelVisible ? " chat-open" : "") +
          (noteOpen ? " note-open" : "")
        }
        onDoubleClick={copyResult}
        title="双击复制结果"
      >
        {appendMode && (
          <div className="append-panel" onDoubleClick={(e) => e.stopPropagation()}>
            <div className="append-tip">
              拼接模式：继续在文档中划词自动追加；可编辑修正后点「开始翻译」
            </div>
            <textarea
              ref={appendTextareaRef}
              className="append-textarea"
              value={appendText}
              onChange={onAppendChange}
              placeholder="在此编辑拼接的原文…"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <div className="append-actions">
              <button className="btn btn-sm" onClick={clearAppend}>清空</button>
              <button className="btn btn-sm" onClick={startAppendTranslate}>开始翻译</button>
              <button className="btn btn-sm" onClick={() => toggleAppendMode()}>退出</button>
            </div>
          </div>
        )}
        {/* 笔记编辑界面（N 键 / 双击「添加」按钮进入）：
            标题默认为单词/原句可编辑；查词/翻译结果自动附带在正文上方（可在设置关闭），
            笔记写在「---」分隔线之后，保存（按钮或 Option+S）后自动创建卡片 */}
        {noteOpen && (
          <div className="note-panel" onDoubleClick={(e) => e.stopPropagation()}>
            <div className="note-tip">
              笔记编辑：在分隔线下方书写笔记，保存后自动创建卡片
              {config.noteIncludeResult !== false ? "（上方为查词/翻译结果）" : ""}
            </div>
            <input
              className="note-title-input"
              value={noteTitle}
              placeholder="标题（默认为单词/原句，可修改）"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <textarea
              ref={noteTextareaRef}
              className="note-textarea"
              value={noteText}
              onChange={onNoteChange}
              placeholder={config.noteIncludeResult !== false ? "结果下方书写笔记…" : "书写笔记…"}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <div className="note-actions">
              <button className="btn btn-sm" onClick={() => setNoteText("")}>清空笔记</button>
              <button className="btn btn-sm btn-primary" onClick={saveNote}>
                保存并创建卡片
              </button>
              <button className="btn btn-sm" onClick={closeNoteEditor}>退出</button>
            </div>
          </div>
        )}
        {/* AI 对话界面（长按机器人图标进入）：选中文本已自动填入输入框，
            模型/思考强度走 chat 路由（上次使用的，输入行可切换并持久化）；
            笔记编辑界面打开时隐藏（chatPanelVisible） */}
        {chatPanelVisible && (
          <div className="chat-panel" onDoubleClick={(e) => e.stopPropagation()}>
            <div className="chat-tip">AI 对话：基于选中内容继续提问（回车发送）</div>
            <div className="chat-list" ref={chatListRef}>
              {chatMessages.length === 0 && !chatDraft && !chatSending && (
                <div className="chat-empty">输入内容后回车发送，开始与 AI 对话…</div>
              )}
              {chatMessages.map((m, i) => (
                m.role === "assistant" ? (
                  // AI 回复按 markdown 渲染（代码块/加粗/列表等与结果区一致）；
                  // 气泡下方操作行：复制 / 添加笔记（单击建卡、双击编辑）/ 重新回答（长按选模型）
                  <div key={i} className="chat-msg-wrap">
                    {/* 已完成回答附带的思考过程：默认收起，可展开回看（非受控 details） */}
                    {m.reason ? (
                      <details className="reason-block">
                        <summary className="reason-summary">思考过程</summary>
                        <div className="reason-body">{m.reason}</div>
                      </details>
                    ) : null}
                    <div
                      className="chat-msg chat-msg-assistant"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                    />
                    <div className="chat-msg-actions">
                      <button
                        className="icon-btn chat-act-btn"
                        title="复制回答"
                        onClick={() => copyChatAnswer(m.text)}
                      >
                        <CopyIcon />
                      </button>
                      <button
                        className="icon-btn chat-act-btn"
                        title="添加笔记：单击直接创建卡片；双击进入笔记编辑"
                        onClick={onChatAddClick(i)}
                        onDoubleClick={onChatAddDoubleClick(i)}
                      >
                        <AddIcon />
                      </button>
                      <button
                        className="icon-btn chat-act-btn"
                        title="点击重新回答；长按选择模型"
                        onMouseDown={onReAnsMouseDown(i)}
                        onMouseUp={onReAnsMouseUp()}
                        onMouseLeave={onReAnsMouseLeave()}
                        onClick={onReAnsClick(i)}
                        onTouchStart={onReAnsTouchStart(i)}
                        onTouchEnd={onReAnsTouchEnd(i)}
                        onTouchCancel={onReAnsTouchCancel()}
                      >
                        <RefreshIcon />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="chat-msg chat-msg-user">{m.text}</div>
                )
              ))}
              {/* 等待回复：三个连续跃动的点；收到首个增量后切换为流式草稿 */}
              {chatSending && !chatDraft && (
                <div className="chat-msg chat-msg-assistant chat-loading">
                  <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                </div>
              )}
              {/* 思考进行中（chatReasoning 流式）：实时展示，正文开始后自动折叠 */}
              {chatSending && chatReasonDraft && (
                <ReasonBlock
                  text={chatReasonDraft}
                  open={chatReasonOpen}
                  onToggle={setChatReasonOpen}
                  live={!chatDraft}
                />
              )}
              {chatDraft && (
                <div
                  className="chat-msg chat-msg-assistant"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(chatDraft) }}
                />
              )}
            </div>
            {/* 输入区：第一行 = 输入框 + 发送按钮；第二行 = 模型/思考 + 新建对话/关闭 */}
            <div className="chat-input-area">
              <div className="chat-input-line">
                <input
                  className="chat-input"
                  value={chatInput}
                  placeholder="输入问题，回车发送…"
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendChat();
                  }}
                />
                {/* 发送 / 暂停：发送后变为暂停（zanting.svg），回答完成或暂停后恢复发送（fasong.svg） */}
                {chatSending ? (
                  <button
                    className="icon-btn chat-send-btn"
                    title="暂停"
                    onClick={stopChat}
                  >
                    <PauseIcon />
                  </button>
                ) : (
                  <button
                    className="icon-btn chat-send-btn"
                    title="发送"
                    disabled={!chatInput.trim()}
                    onClick={sendChat}
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
              <div className="chat-input-row">
                {/* 模型选择：显示当前生效模型，点击切换；选择持久化 = 上次使用的模型 */}
                <button
                  className="chat-model-btn"
                  title={`AI 对话模型：${chatModelId || "未选择"}，点击切换（记住上次选择）`}
                  onClick={() => {
                    load(); // 打开前刷新提供商/模型列表（设置页可能已改）
                    setChatPickerTarget(null);
                    setChatEffortOpen(false);
                    setChatPickerOpen(true);
                  }}
                >
                  {chatModelShort}
                </button>
                {/* 思考强度：显示当前生效档位，点击弹列表；选择持久化。
                    仅「测试」探测确认支持思考的模型可调（与设置页同一判定），
                    实际请求参数由插件侧按厂商/模型适配 */}
                <button
                  className="chat-model-btn chat-effort-btn"
                  disabled={!chatModelSupportsReasoning}
                  title={chatModelSupportsReasoning
                    ? `思考强度：${CHAT_EFFORT_LABEL[chatEffort] || chatEffort}，点击调整（记住上次选择）`
                    : "当前模型未确认支持思考（设置 → 服务提供商 → 测试可探测），不可调整"}
                  onClick={() => {
                    setChatPickerOpen(false);
                    setChatPickerTarget(null);
                    setChatEffortOpen(true);
                  }}
                >
                  思考：{CHAT_EFFORT_LABEL[chatEffort] || chatEffort}
                </button>
                {/* 弹性占位：新建对话/关闭靠右 */}
                <span className="chat-input-spacer" />
                {/* 新建对话：xinjian.svg 圆底加号图标；清空当前消息开始新对话（历史记录保留） */}
                <button
                  className="icon-btn chat-newchat-btn"
                  title="新建对话：清空当前消息（已存历史不受影响），输入框保留"
                  disabled={chatSending}
                  onClick={startNewChat}
                >
                  <NewChatIcon />
                </button>
                <button className="icon-btn chat-close-btn" title="关闭对话" onClick={closeChat}>
                  <CloseIcon />
                </button>
              </div>
            </div>
          </div>
        )}
        {!noteOpen && !chatOpen && state.status === "loading" && (
          reasonDraft ? (
            // 思考进行中：实时展示思考内容，替代加载行（正文到达后切到结果区渲染并自动折叠）
            <ReasonBlock text={reasonDraft} open={reasonOpen} onToggle={setReasonOpen} live />
          ) : (
            <div className="card-loading">
              <span className="spinner" />
              正在{modeLabel}…
            </div>
          )
        )}

        {!noteOpen && !chatOpen && (state.status === "streaming" || state.status === "done") && (
          <div className="card-result">
            <ReasonBlock
              text={reasonDraft}
              open={reasonOpen}
              onToggle={setReasonOpen}
              live={state.status === "streaming" && !state.accumulated}
            />
            <span
              dangerouslySetInnerHTML={{ __html: renderMarkdown(state.accumulated) }}
            />
            {state.status === "streaming" && <span className="cursor">▍</span>}
          </div>
        )}

        {!noteOpen && !chatOpen && state.status === "dict" && state.dict && (
          <div className="dict-result" ref={dictRef}>
            <div className="dict-head">
              <span className="dict-word">{state.dict.word}</span>
              <button
                className="icon-btn speak-btn"
                title="英音"
                onClick={() => {
                  const d = state.dict.pronounce;
                  playWithFallback(d.uk, [d.ukFallback || "", d.us].filter(Boolean), "英音");
                }}
              >
                <SpeakerIcon />
                <span className="speak-label">英</span>
              </button>
              <button
                className="icon-btn speak-btn"
                title="美音"
                onClick={() => {
                  const d = state.dict.pronounce;
                  playWithFallback(d.us, [d.usFallback || "", d.uk].filter(Boolean), "美音");
                }}
              >
                <SpeakerIcon />
                <span className="speak-label">美</span>
              </button>
            </div>
            {(state.dict.ukphone || state.dict.usphone) && (
              <div className="dict-phones">
                {state.dict.ukphone && <span>英 /{state.dict.ukphone}/</span>}
                {state.dict.usphone && <span>美 /{state.dict.usphone}/</span>}
              </div>
            )}
            <ul className="dict-trans">
              {/* 同一词性的多个释义合并成一行，用「；」分隔（与有道展示一致）；不同词性仍分多行 */}
              {(() => {
                const groups = [];
                state.dict.translations.forEach((t) => {
                  const pos = t.pos || "";
                  if (groups.length > 0 && groups[groups.length - 1].pos === pos) {
                    groups[groups.length - 1].meanings.push(t.meaning);
                  } else {
                    groups.push({ pos, meanings: [t.meaning] });
                  }
                });
                return groups.map((g, i) => (
                  <li key={i}>
                    {g.pos && <span className="dict-pos">{g.pos}</span>}
                    {g.meanings.join("；")}
                  </li>
                ));
              })()}
            </ul>
          </div>
        )}

        {!noteOpen && !chatOpen && state.status === "error" && (
          <div className="card-error">
            <p>{state.errorMsg}</p>
            <button className="btn btn-sm" onClick={retry}>
              重试
            </button>
          </div>
        )}
      </div>

      {(state.status === "streaming" || state.status === "done") && (
        <div
          className="card-measure"
          ref={measureRef}
        >
          {/* 思考块与结果区同参渲染：折叠/展开状态一致，高度测量才准确 */}
          <ReasonBlock text={reasonDraft} open={reasonOpen} live={false} />
          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(state.accumulated) }} />
        </div>
      )}

      {/* 查词服务切换菜单（bar 图标）：临时切换，不影响默认查词服务设置 */}
      {switchOpen && (
        <div className="menu-overlay" onMouseDown={() => setSwitchOpen(false)}>
          <div className="switch-menu" ref={switchMenuRef} onMouseDown={(e) => e.stopPropagation()}>
            <div className="switch-menu-title">查词服务（临时切换，不影响默认设置）</div>
            {LOOKUP_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={"switch-menu-item" + (state.lookupProvider === opt.value ? " is-current" : "")}
                onClick={() => switchLookup(opt.value)}
              >
                <span className="switch-menu-label">{opt.label}</span>
                {state.lookupProvider === opt.value && <span className="switch-menu-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 重新生成：长按选模型（供应商一级 / 模型二级缩进，可折叠，默认全部展开） */}
      {modelPickerOpen && (
        <div className="menu-overlay" onMouseDown={() => setModelPickerOpen(false)}>
          <div className="model-picker" ref={modelPickerRef} onMouseDown={(e) => e.stopPropagation()}>
            <div className="model-picker-title">选择模型重新生成</div>
            {config.providers.length === 0 && config.machineProviders.length === 0 && (
              <div className="model-picker-empty">暂无可用的服务提供商，请先在设置中添加。</div>
            )}
            {config.providers.map((p) => (
              <div className="model-picker-group" key={p.id}>
                <div
                  className="model-picker-provider"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => toggleProvider(p.id)}
                  title={collapsedProviders[p.id] ? "展开" : "折叠"}
                >
                  <span className={`model-picker-caret ${collapsedProviders[p.id] ? "" : "is-open"}`}>▶</span>
                  <span className="model-picker-provider-name">{p.name}</span>
                  <span className="model-picker-count">{p.models.length}</span>
                </div>
                {!collapsedProviders[p.id] && p.models.length === 0 && (
                  <div className="model-picker-no-model">该提供商暂无模型</div>
                )}
                {!collapsedProviders[p.id] && p.models.length > 0 && (
                  <div className="model-picker-models">
                    {p.models.map((m) => (
                      <button
                        key={m.id}
                        className="model-picker-item"
                        title={m.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => pickModel(p.id, m.id)}
                      >
                        {m.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {/* 机器翻译服务（仅翻译任务且已配置账户时显示）：整体作为一项可选服务，点击即用该账户重跑翻译 */}
            {state.mode === "translate" && config.machineProviders.length > 0 && (
              <div className="model-picker-group">
                <div
                  className="model-picker-provider"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => toggleProvider("__mt__")}
                  title={collapsedProviders["__mt__"] ? "展开" : "折叠"}
                >
                  <span className={`model-picker-caret ${collapsedProviders["__mt__"] ? "" : "is-open"}`}>▶</span>
                  <span className="model-picker-provider-name">机器翻译服务</span>
                  <span className="model-picker-count">{config.machineProviders.length}</span>
                </div>
                {!collapsedProviders["__mt__"] && (
                  <div className="model-picker-models">
                    {config.machineProviders.map((mp) => (
                      <button
                        key={mp.id}
                        className="model-picker-item"
                        title={`${mp.name}（接口类型与领域按「模型路由 → 机器翻译路由」配置）`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => pickMachine(mp.id)}
                      >
                        {mp.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI 对话模型选择（输入框左侧按钮 / 「重新回答」长按）：临时覆盖 chat 路由，不写回设置 */}
      {chatPickerOpen && (
        <div className="menu-overlay" onMouseDown={() => { setChatPickerOpen(false); setChatPickerTarget(null); }}>
          <div className="model-picker" ref={chatPickerRef} onMouseDown={(e) => e.stopPropagation()}>
            <div className="model-picker-title">
              {chatPickerTarget != null ? "选择模型重新回答" : "选择 AI 对话模型"}
            </div>
            {config.providers.length === 0 && (
              <div className="model-picker-empty">暂无可用的服务提供商，请先在设置中添加。</div>
            )}
            {config.providers.map((p) => (
              <div className="model-picker-group" key={p.id}>
                <div
                  className="model-picker-provider"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => toggleProvider(p.id)}
                  title={collapsedProviders[p.id] ? "展开" : "折叠"}
                >
                  <span className={`model-picker-caret ${collapsedProviders[p.id] ? "" : "is-open"}`}>▶</span>
                  <span className="model-picker-provider-name">{p.name}</span>
                  <span className="model-picker-count">{p.models.length}</span>
                </div>
                {!collapsedProviders[p.id] && p.models.length === 0 && (
                  <div className="model-picker-no-model">该提供商暂无模型</div>
                )}
                {!collapsedProviders[p.id] && p.models.length > 0 && (
                  <div className="model-picker-models">
                    {p.models.map((m) => (
                      <button
                        key={m.id}
                        className="model-picker-item"
                        title={m.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => pickChatModel(p.id, m.id)}
                      >
                        {m.id}{chatModelId === m.id ? " ✓" : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 思考强度选择（输入行「思考」按钮）：列表展示档位，写入 chat 路由持久化，
          实际请求参数由插件侧按厂商/模型适配；弹层锚在输入行上方（向上展开） */}
      {chatEffortOpen && (
        <div className="menu-overlay" onMouseDown={() => setChatEffortOpen(false)}>
          <div
            className="switch-menu chat-effort-menu"
            ref={chatEffortMenuRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="switch-menu-title">思考强度（记住上次选择）</div>
            {CHAT_EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={"switch-menu-item" + (chatEffort === opt.value ? " is-current" : "")}
                onClick={() => pickChatEffort(opt.value)}
              >
                <span className="switch-menu-label">{opt.label}</span>
                {chatEffort === opt.value && <span className="switch-menu-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 历史记录浮层（数据源 = 查词/翻译缓存，查词与翻译各自独立） */}
      {historyOpen && (
        <div className="history-overlay" onMouseDown={closeHistory}>
          <div className="history-panel" ref={historyPanelRef} onMouseDown={(e) => e.stopPropagation()}>
            <div className="history-panel-head">
              <span className="history-panel-title">
                {historyKind === "chat" ? "AI 问答历史" : historyKind === "translate" ? "翻译历史" : "查词历史"}
              </span>
              <button className="icon-btn" title="关闭" onClick={closeHistory}>
                <CloseIcon />
              </button>
            </div>
            {historyLoading && <div className="history-empty">加载中…</div>}
            {!historyLoading && historyItems.length === 0 && (
              <div className="history-empty">
                {historyKind === "chat"
                  ? "暂无问答历史。与 AI 的每轮问答会自动保存（最近 50 条）。"
                  : historyKind === "translate"
                  ? "暂无翻译历史。翻译过的内容会保存在 AI 翻译缓存中。"
                  : "暂无查词历史。查询过的单词会保存在查词缓存中。"}
              </div>
            )}
            {!historyLoading && historyItems.length > 0 && (
              <div className="history-list">
                {historyItems.map((item, i) =>
                  historyKind === "chat" ? (
                    <button
                      key={item.at || i}
                      className="history-item history-item-trans"
                      title="点击回放该轮问答（可继续追问）"
                      onClick={() => applyHistoryItem(item)}
                    >
                      <span className="history-item-src">{item.question}</span>
                      <span className="history-item-text">{item.answer}</span>
                    </button>
                  ) : historyKind === "translate" ? (
                    <button
                      key={item.key || i}
                      className="history-item history-item-trans"
                      title="点击查看该翻译"
                      onClick={() => applyHistoryItem(item)}
                    >
                      <span className="history-item-src">{item.sourceText}</span>
                      <span className="history-item-text">{item.text}</span>
                    </button>
                  ) : (
                    <button
                      key={item.key || i}
                      className="history-item history-item-word"
                      title="点击查看该单词"
                      onClick={() => applyHistoryItem(item)}
                    >
                      <span
                        className="history-tag"
                        style={{
                          background: lookupTag(item).bg,
                        }}
                      >
                        {lookupTag(item).label}
                      </span>
                      <span className="history-item-src">{item.sourceText}</span>
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CardPage;
