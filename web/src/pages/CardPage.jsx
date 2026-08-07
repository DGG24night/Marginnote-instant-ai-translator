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
  const readySentRef = useRef(false);
  const audioRef = useRef(null);
  const { config, load } = useConfigStore();

  // 播放发音
  const pronounce = useCallback((url) => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch (error) {
      // 播放失败静默
    }
  }, []);

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
          case "error":
            return { ...prev, status: "error", errorMsg: event.message };
          default:
            return prev;
        }
      });

      // 词典结果到达后自动发音
      if (event.type === "dictResult" && event.data && event.data.pronounce) {
        const p = event.data.pronounce;
        if (p.auto) {
          pronounce(p.accent === "uk" ? p.uk : p.us);
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
  }, [load, pronounce]);

  // 内容变化后测量实际高度，经 bridge 通知插件调整卡片 WebView 高度
  const lastHeightRef = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      const height = Math.ceil(document.body.scrollHeight);
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
      <div className="card-toolbar">
        <span className="card-mode">{modeLabel}</span>
        <span className="card-toolbar-actions">
          <button className="icon-btn" title="复制" onClick={copyResult}>
            {copied ? "✓" : "⧉"}
          </button>
          <button className="icon-btn" title="关闭" onClick={closeCard}>
            ×
          </button>
        </span>
      </div>

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
          <div className="dict-result">
            <div className="dict-head">
              <span className="dict-word">{state.dict.word}</span>
              <button
                className="icon-btn"
                title="英音"
                onClick={() => pronounce(state.dict.pronounce.uk)}
              >
                🔊英
              </button>
              <button
                className="icon-btn"
                title="美音"
                onClick={() => pronounce(state.dict.pronounce.us)}
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
    </div>
  );
}

export default CardPage;
