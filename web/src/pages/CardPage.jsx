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

// 复制（用户提供的 fuzhi.svg：双层方框）
const COPY_PATHS = [
  "M761.088 715.3152a38.7072 38.7072 0 0 1 0-77.4144 37.4272 37.4272 0 0 0 37.4272-37.4272V265.0112a37.4272 37.4272 0 0 0-37.4272-37.4272H425.6256a37.4272 37.4272 0 0 0-37.4272 37.4272 38.7072 38.7072 0 1 1-77.4144 0 115.0976 115.0976 0 0 1 114.8416-114.8416h335.4624a115.0976 115.0976 0 0 1 114.8416 114.8416v335.4624a115.0976 115.0976 0 0 1-114.8416 114.8416z",
  "M589.4656 883.0976H268.1856a121.1392 121.1392 0 0 1-121.2928-121.2928v-322.56a121.1392 121.1392 0 0 1 121.2928-121.344h321.28a121.1392 121.1392 0 0 1 121.2928 121.2928v322.56c1.28 67.1232-54.1696 121.344-121.2928 121.344zM268.1856 395.3152a43.52 43.52 0 0 0-43.8784 43.8784v322.56a43.52 43.52 0 0 0 43.8784 43.8784h321.28a43.52 43.52 0 0 0 43.8784-43.8784v-322.56a43.52 43.52 0 0 0-43.8784-43.8784z",
];

// 拖动提示（用户提供的 bars.svg：三横线）
const DRAG_PATH =
  "M173.708 319.953h673.184c35.347 0 64-28.654 64-64s-28.653-64-64-64H173.708c-35.346 0-64 28.654-64 64s28.653 64 64 64zM846.892 449.717H173.708c-35.346 0-64 28.654-64 64 0 35.346 28.654 64 64 64h673.184c35.347 0 64-28.654 64-64 0-35.346-28.654-64-64-64zM846.892 704.165H173.708c-35.346 0-64 28.654-64 64s28.654 64 64 64h673.184c35.347 0 64-28.654 64-64s-28.654-64-64-64z";

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

function CopyIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {COPY_PATHS.map((d, i) => (
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

// 机器人（用户提供的 robot.svg）：词典结果时切换为 AI 解释
const ROBOT_PATH =
  "M717.12 274H762c82.842 0 150 67.158 150 150v200c0 82.842-67.158 150-150 150H262c-82.842 0-150-67.158-150-150V424c0-82.842 67.158-150 150-150h44.88l-18.268-109.602c-4.086-24.514 12.476-47.7 36.99-51.786 24.514-4.086 47.7 12.476 51.786 36.99l20 120c0.246 1.472 0.416 2.94 0.516 4.398h228.192c0.1-1.46 0.27-2.926 0.516-4.398l20-120c4.086-24.514 27.272-41.076 51.786-36.99 24.514 4.086 41.076 27.272 36.99 51.786L717.12 274zM262 364c-33.138 0-60 26.862-60 60v200c0 33.138 26.862 60 60 60h500c33.138 0 60-26.862 60-60V424c0-33.138-26.862-60-60-60H262z m50 548c-24.852 0-45-20.148-45-45S287.148 822 312 822h400c24.852 0 45 20.148 45 45S736.852 912 712 912H312z m-4-428c0-24.852 20.148-45 45-45S398 459.148 398 484v40c0 24.852-20.148 45-45 45S308 548.852 308 524v-40z m318 0c0-24.852 20.148-45 45-45S716 459.148 716 484v40c0 24.852-20.148 45-45 45S626 548.852 626 524v-40z";

function RobotIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={ROBOT_PATH} fill="currentColor" />
    </svg>
  );
}

function CardPage() {
  const [state, setState] = useState(initialState);
  const [copied, setCopied] = useState(false);
  const [pinned, setPinned] = useState(false); // 图钉固定：true = 点击卡片外部不自动关闭
  const [speaking, setSpeaking] = useState(null); // uk | us：AI 解释手动发音加载中
  const [pronounceHint, setPronounceHint] = useState(""); // 发音提示（口音回退/不可用）
  const readySentRef = useRef(false);
  const audioRef = useRef(null);
  const hintTimerRef = useRef(null);
  const toolbarRef = useRef(null);
  const measureRef = useRef(null);
  const dictRef = useRef(null);
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
            };
          case "delta":
            return { ...prev, status: "streaming", accumulated: event.accumulated };
          case "translateResult":
            return { ...prev, status: "done", accumulated: event.text };
          case "dictResult":
            return { ...prev, status: "dict", dict: event.data };
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

    // 加载外观配置并通知插件卡片就绪
    load().finally(() => {
      if (!readySentRef.current) {
        readySentRef.current = true;
        MNBridge.send("cardReady").catch(() => {});
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
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("mousedown", onCardMouseDown, true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [load, playWithFallback, showHint]);

  // 内容变化后测量实际高度，经 bridge 通知插件调整卡片 WebView 高度。
  // 测量 .card-measure（隐藏测量器）/ .dict-result 的自然高度 + toolbar 高度，
  // 而非 body.scrollHeight —— 页面高度现在是 100% 布局，toolbar 固定、body 内部滚动。
  const lastHeightRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
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
      height = Math.ceil(height);
      if (height > 0 && Math.abs(height - lastHeightRef.current) > 2) {
        lastHeightRef.current = height;
        MNBridge.send("resizeCard", { height }).catch(() => {});
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [state, config.theme, config.fontSize, pronounceHint]);

  const copyResult = async () => {
    let text = "";
    if (state.status === "dict" && state.dict) {
      const d = state.dict;
      const lines = [d.word];
      if (d.ukphone || d.usphone) {
        lines.push(`英 /${d.ukphone}/  美 /${d.usphone}/`);
      }
      d.translations.forEach((t) => {
        lines.push(`${t.pos ? t.pos + " " : ""}${t.meaning}`);
      });
      text = lines.join("\n");
    } else {
      text = state.accumulated;
    }
    if (!text) return;
    try {
      await MNBridge.send("copyText", { text });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      // ignore
    }
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

  return (
    <div className="card-page">
      <div className="card-toolbar" ref={toolbarRef}>
        <span className="card-mode">
          <span className="card-drag-hint" title="按住此处可拖动窗口"><DragIcon /></span>
          {modeLabel}
        </span>
        <span className="card-toolbar-actions">
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
            </>
          )}
          {state.status === "dict" && (
            <button className="icon-btn" title="切换为 AI 解释" onClick={switchToAI}>
              <RobotIcon />
            </button>
          )}
          <button className="icon-btn" title="复制" onClick={copyResult}>
            {copied ? "✓" : <CopyIcon />}
          </button>
          <button
            className={"icon-btn pin-btn" + (pinned ? " active" : "")}
            title={pinned ? "已固定：点击卡片外部不会关闭（点击取消固定）" : "固定卡片：点击卡片外部不再自动关闭"}
            onClick={togglePin}
          >
            <PinIcon />
          </button>
        </span>
      </div>

      {pronounceHint && (
        <div className="pronounce-hint" role="status">{pronounceHint}</div>
      )}

      <div className="card-body">
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
              {state.dict.translations.map((t, i) => (
                <li key={i}>
                  {t.pos && <span className="dict-pos">{t.pos}</span>}
                  {t.meaning}
                </li>
              ))}
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
    </div>
  );
}

export default CardPage;
