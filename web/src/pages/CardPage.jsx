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

function CardPage() {
  const [state, setState] = useState(initialState);
  const [copied, setCopied] = useState(false);
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

    return () => {
      document.documentElement.classList.remove("card-fit");
      window.__MNIATCardEvent = null;
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [load, playWithFallback, showHint]);

  // 内容变化后测量实际高度，经 bridge 通知插件调整卡片 WebView 高度。
  // 测量 .card-measure（隐藏测量器）的自然高度 + toolbar 高度，
  // 而非 body.scrollHeight —— 页面高度现在是 100% 布局，toolbar 固定、body 内部滚动。
  const lastHeightRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      const isText = state.status === "streaming" || state.status === "done";
      const toolbarH = toolbarRef.current ? toolbarRef.current.offsetHeight : 0;
      let height = 0;
      if (isText && measureRef.current) {
        height = measureRef.current.offsetHeight + toolbarH;
      } else if (state.status === "dict" && dictRef.current) {
        height = dictRef.current.offsetHeight + toolbarH;
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
  }, [state, config.theme, config.fontSize]);

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

  const closeCard = () => {
    MNBridge.send("closeCard").catch(() => {});
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
          <span className="card-drag-hint" title="按住此处可拖动窗口">⠿</span>
          {modeLabel}
        </span>
        <span className="card-toolbar-actions">
          {state.mode === "explain" && state.status === "done" && (
            <>
              <button
                className="icon-btn"
                title="英音（按「AI 解释发音」配置的词典）"
                onClick={() => playPronounce("uk")}
                disabled={!!speaking}
              >
                {speaking === "uk" ? "…" : "🔊英"}
              </button>
              <button
                className="icon-btn"
                title="美音（按「AI 解释发音」配置的词典）"
                onClick={() => playPronounce("us")}
                disabled={!!speaking}
              >
                {speaking === "us" ? "…" : "🔊美"}
              </button>
            </>
          )}
          <button className="icon-btn" title="复制" onClick={copyResult}>
            {copied ? "✓" : "⧉"}
          </button>
          <button className="icon-btn" title="关闭" onClick={closeCard}>
            ×
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
                className="icon-btn"
                title="英音"
                onClick={() => {
                  const d = state.dict.pronounce;
                  playWithFallback(d.uk, [d.ukFallback || "", d.us].filter(Boolean), "英音");
                }}
              >
                🔊英
              </button>
              <button
                className="icon-btn"
                title="美音"
                onClick={() => {
                  const d = state.dict.pronounce;
                  playWithFallback(d.us, [d.usFallback || "", d.uk].filter(Boolean), "美音");
                }}
              >
                🔊美
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
            <button className="btn btn-sm ai-switch" onClick={switchToAI}>
              切换为 AI 解释
            </button>
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
