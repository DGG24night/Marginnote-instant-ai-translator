import { useCallback, useEffect, useRef, useState } from "react";
import MNBridge from "../lib/mnBridge";
import { renderMarkdown } from "../lib/markdown";
import { useConfigStore } from "../store/configStore";

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
  const { config, load } = useConfigStore();

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

  // 展开搜索框后聚焦输入框
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      setTimeout(() => {
        if (searchInputRef.current) searchInputRef.current.focus();
      }, 50);
    }
  }, [searchOpen]);

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
          case "error":
            return { ...prev, status: "error", errorMsg: event.message };
          default:
            return prev;
        }
      });

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
      window.__MNIATCardEvent = null;
      window.__MNIATCardOpenSwitch = null;
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("mousedown", onCardMouseDown, true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (regenTimerRef.current) clearTimeout(regenTimerRef.current);
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
    if (isText && measureRef.current) {
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
    const menuEl = switchOpen ? switchMenuRef.current : modelPickerOpen ? modelPickerRef.current : null;
    if (menuEl) {
      const menuBottom = 46 + menuEl.offsetHeight + 8;
      if (height < menuBottom) height = menuBottom;
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
    if (!isStreaming) return undefined;
    const interval = setInterval(() => {
      if (doMeasureRef.current) doMeasureRef.current();
    }, 60);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // 非 streaming（done / 词典 / 加载 / 菜单 / 历史面板等）：状态稳定后一次性测量
  useEffect(() => {
    if (isStreaming) return undefined;
    const timer = setTimeout(() => {
      if (doMeasureRef.current) doMeasureRef.current();
    }, 50);
    return () => clearTimeout(timer);
  }, [state, config.theme, config.fontSize, pronounceHint, searchOpen, switchOpen, modelPickerOpen, historyOpen, historyLoading, historyItems, isStreaming]);

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
      lines.push("**释义**");
      groups.forEach((g) => {
        lines.push(`${g.pos ? g.pos + " " : ""}${g.meanings.join("；")}`);
      });
    }
    return lines.join("\n");
  }, []);

  // 「添加卡片」：把当前结果保存为一条新笔记（Markdown 模式默认开启）。
  // 查词 → 单词为标题、查词结果（音标+释义）为正文；AI 解释 → 单词为标题、解释为正文；
  // 翻译 → 原句为标题、译文为正文。经 bridge 交给插件层在当前文档所属笔记本下创建。
  // 插件侧会调 dc.highlightFromSelection() 让原文自动高亮，并让新节点可点击跳转原文。
  // 颜色按当前任务类型取对应配置（查词/AI 解释 → cardColorLookup，翻译 → cardColorTranslate）。
  const addCard = useCallback(async () => {
    let title = "";
    let body = "";
    let kind = ""; // "translate" | "lookup"
    if (state.status === "dict" && state.dict) {
      title = state.dict.word;
      // 卡片标题已是单词，正文不再重复（includeWord=false）；分组排版见 buildDictBody
      body = buildDictBody(state.dict, false);
      kind = "lookup";
    } else if (state.status === "done" && (state.mode === "explain" || state.mode === "translate")) {
      title = state.sourceText;
      body = state.accumulated;
      kind = state.mode; // "translate" | "explain"（两者都用 cardColorLookup）
    }
    if (!title.trim() && !body.trim()) {
      showHint("暂无内容可添加为卡片");
      return;
    }
    // 规范化正文：markdown 水平线 `---` 前后必须有空行，否则会被渲染成 `## ---` 二级标题
    // （用户实测 2026-08-15：AI 解释输出 `**音标**\n---\n**释义**` 时 MN 排版混乱）
    body = normalizeCardBody(body);
    const colorIndex = kind === "translate"
      ? (Number.isFinite(config.cardColorTranslate) ? config.cardColorTranslate : 0)
      : (Number.isFinite(config.cardColorLookup) ? config.cardColorLookup : 0);
    try {
      await MNBridge.send("addCard", { title, body, markdown: true, colorIndex });
      showHint("已添加卡片到当前笔记本（原文已高亮）");
    } catch (error) {
      showHint(`添加卡片失败：${(error && error.message) || "请重试"}`);
    }
  }, [state.status, state.dict, state.mode, state.sourceText, state.accumulated,
      config.cardColorTranslate, config.cardColorLookup, buildDictBody, showHint]);

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

  // 当前界面对应的历史类型：查词（含 AI 解释）或翻译，各自独立
  const historyKind = state.mode === "translate" ? "translate" : "lookup";

  const openHistory = useCallback(async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryItems([]);
    try {
      const r = await MNBridge.send("getHistory", { kind: historyKind });
      setHistoryItems((r && r.items) || []);
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

  // 点击历史条目：插件层直接推送缓存内容，结果卡片显示（不再请求网络）
  const applyHistoryItem = useCallback(
    async (item) => {
      setHistoryOpen(false);
      setHistoryItems([]);
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

  const switchToAI = () => {
    MNBridge.send("explainWithAI").catch(() => {});
  };

  const retry = () => {
    // 重新触发当前任务（插件侧 job 仍保留）
    MNBridge.send("cardReady").catch(() => {});
  };

  const modeLabel =
    state.mode === "lookup" ? "查词" : state.mode === "explain" ? "AI 解释" : "翻译";

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
    <div className="card-page">
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
                  title="添加为卡片：单词为标题、AI 解释为正文（Markdown）"
                  onClick={addCard}
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
                  state.status === "dict"
                    ? "添加为卡片：单词为标题、查词结果（音标+释义）为正文"
                    : "添加为卡片：原句为标题、翻译为正文（Markdown）"
                }
                onClick={addCard}
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
            {state.status === "dict" && (
              <button className="icon-btn" title="切换为 AI 解释" onClick={switchToAI}>
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
              title={pinned ? "已固定：点击卡片外部不会关闭（点击取消固定）" : "固定卡片：点击卡片外部不再自动关闭"}
              onClick={togglePin}
            >
              <PinIcon />
            </button>
          </span>
        )}
      </div>

      {pronounceHint && (
        <div className="pronounce-hint" role="status">{pronounceHint}</div>
      )}

      <div className="card-body" onDoubleClick={copyResult} title="双击复制结果">
        {state.status === "loading" && (
          <div className="card-loading">
            <span className="spinner" />
            正在{modeLabel}…
          </div>
        )}

        {(state.status === "streaming" || state.status === "done") && (
          <div className="card-result">
            <span
              dangerouslySetInnerHTML={{ __html: renderMarkdown(state.accumulated) }}
            />
            {state.status === "streaming" && <span className="cursor">▍</span>}
          </div>
        )}

        {state.status === "dict" && state.dict && (
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

        {state.status === "error" && (
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
          dangerouslySetInnerHTML={{ __html: renderMarkdown(state.accumulated) }}
        />
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

      {/* 历史记录浮层（数据源 = 查词/翻译缓存，查词与翻译各自独立） */}
      {historyOpen && (
        <div className="history-overlay" onMouseDown={closeHistory}>
          <div className="history-panel" ref={historyPanelRef} onMouseDown={(e) => e.stopPropagation()}>
            <div className="history-panel-head">
              <span className="history-panel-title">
                {historyKind === "translate" ? "翻译历史" : "查词历史"}
              </span>
              <button className="icon-btn" title="关闭" onClick={closeHistory}>
                <CloseIcon />
              </button>
            </div>
            {historyLoading && <div className="history-empty">加载中…</div>}
            {!historyLoading && historyItems.length === 0 && (
              <div className="history-empty">
                {historyKind === "translate"
                  ? "暂无翻译历史。翻译过的内容会保存在 AI 翻译缓存中。"
                  : "暂无查词历史。查询过的单词会保存在查词缓存中。"}
              </div>
            )}
            {!historyLoading && historyItems.length > 0 && (
              <div className="history-list">
                {historyItems.map((item, i) =>
                  historyKind === "translate" ? (
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
