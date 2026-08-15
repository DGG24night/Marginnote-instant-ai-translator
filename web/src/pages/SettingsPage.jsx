import { useEffect, useRef, useState } from "react";
import MNBridge from "../lib/mnBridge";
import { PROVIDER_PRESETS, MACHINE_PROVIDER_PRESETS, useConfigStore } from "../store/configStore";

const TARGET_LANGS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const REASONING_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

// 百度领域文本翻译支持领域（fanyi-api.baidu.com/doc/24）：value 为接口 domain 参数
const MT_DOMAINS = [
  { value: "it", label: "信息技术" },
  { value: "finance", label: "金融财经" },
  { value: "machinery", label: "机械制造" },
  { value: "senimed", label: "生物医药" },
  { value: "novel", label: "网络文学" },
  { value: "academic", label: "学术论文" },
  { value: "aerospace", label: "航空航天" },
  { value: "wiki", label: "人文社科" },
  { value: "news", label: "新闻资讯" },
  { value: "law", label: "法律法规" },
  { value: "contract", label: "合同" },
];

// 创建卡片颜色（用户提供的 MarginNote 调色板截图，序号 1-16）
//   idx 为存储索引（0-15，写入 MbBookNote.colorIndex）；
//   用户视角为 1-16，对应 figure 中的色块（标签 = 序号 + 1）。
//   textColor 为色块内文字颜色（深色背景用白字，保证序号可读）。
const CARD_COLORS = [
  { idx: 0,  color: "#FFFACC", name: "浅黄", textColor: "#000" },
  { idx: 1,  color: "#D4F8CC", name: "浅绿", textColor: "#000" },
  { idx: 2,  color: "#D4E6F8", name: "浅蓝", textColor: "#000" },
  { idx: 3,  color: "#F8D4DC", name: "浅粉", textColor: "#000" },
  { idx: 4,  color: "#FFFF66", name: "黄",   textColor: "#000" },
  { idx: 5,  color: "#66E066", name: "绿",   textColor: "#000" },
  { idx: 6,  color: "#66B2FF", name: "蓝",   textColor: "#000" },
  { idx: 7,  color: "#F84C4C", name: "红",   textColor: "#000" },
  { idx: 8,  color: "#FF9933", name: "橙",   textColor: "#000" },
  { idx: 9,  color: "#1F8A3F", name: "深绿", textColor: "#fff" },
  { idx: 10, color: "#2A4D9E", name: "深蓝", textColor: "#fff" },
  { idx: 11, color: "#C8302A", name: "深红", textColor: "#fff" },
  { idx: 12, color: "#E0E0E0", name: "浅灰", textColor: "#000" },
  { idx: 13, color: "#B0B0B0", name: "灰",   textColor: "#000" },
  { idx: 14, color: "#707070", name: "深灰", textColor: "#fff" },
  { idx: 15, color: "#C39EE6", name: "紫",   textColor: "#000" },
];

// 阿里云机器翻译专业版场景（Translate 接口 Scene 参数）
const MT_SCENES = [
  { value: "title", label: "商品标题" },
  { value: "description", label: "商品描述" },
  { value: "communication", label: "商品沟通" },
  { value: "medical", label: "医疗" },
  { value: "social", label: "社交" },
  { value: "finance", label: "金融" },
];

// 设置页顶部导航标签（short 用于窄屏时的缩写）
const SETTINGS_TABS = [
  { id: "general", label: "常规", short: "常规" },
  { id: "providers", label: "服务提供商", short: "提供商" },
  { id: "routing", label: "模型路由", short: "路由" },
  { id: "prompts", label: "Prompt 模板", short: "Prompt" },
];

function Section({ title, children }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

// 紧凑式颜色选择器：默认显示一个当前色块 + 序号 + 「选择」按钮；
// 点击按钮弹出 4×4 色块网格，点选后写回并关闭弹窗（点击弹窗外关闭）。
function ColorPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  // 弹窗外点击关闭
  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);
  const safeValue = Number.isFinite(value) ? value : 0;
  const current = CARD_COLORS[safeValue] || CARD_COLORS[0];
  return (
    <div className="color-picker" ref={wrapRef}>
      <div className="color-picker-current">
        <span
          className="color-picker-swatch"
          style={{ background: current.color }}
          title={`当前：${safeValue + 1}（${current.name}）`}
        />
        <button
          type="button"
          className="btn btn-sm color-picker-btn"
          onClick={() => setOpen((v) => !v)}
        >
          选择
        </button>
      </div>
      {open && (
        <div className="color-picker-popup">
          <div className="color-grid">
            {CARD_COLORS.map((opt) => (
              <button
                key={opt.idx}
                type="button"
                className={"color-swatch" + (safeValue === opt.idx ? " is-selected" : "")}
                style={{ background: opt.color, color: opt.textColor }}
                title={`${opt.idx + 1}（${opt.name}）`}
                onClick={() => {
                  onChange(opt.idx);
                  setOpen(false);
                }}
              >
                <span className="color-num">{opt.idx + 1}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 帮助提示气泡：圆形感叹号图标，鼠标悬停或点按展开说明文字。
// 气泡挂在图标容器内，鼠标从图标移到气泡不会消失；触屏（无 hover）环境下点按切换。
// 信息提示图标（参考用户提供的 icon_info_tip-2 SVG）：
// 用基础 circle/rect 元素重绘，避免 arc 命令在 UIWebView 老内核上的解析异常。
// 结构：外圈圆环（stroke 描边）+ 右上角圆点 + 感叹号（圆头矩形）。

// 垃圾桶图标（用户提供的 shanchu SVG：垃圾桶 + 两条删除线，单色 currentColor）
const TRASH_PATHS = [
  "M922.7 250.7H736v-37.3C736 130.9 669.1 64 586.7 64H437.3C354.9 64 288 130.9 288 213.3v37.3H101.3C80.7 250.7 64 267.4 64 288c0 20.6 16.7 37.3 37.3 37.3H176v485.3c0 82.5 66.9 149.3 149.3 149.3h373.3c82.5 0 149.3-66.9 149.3-149.3V325.3h74.7c20.6 0 37.3-16.7 37.3-37.3 0.1-20.6-16.6-37.3-37.2-37.3z m-560-37.4c0-41.2 33.4-74.7 74.7-74.7h149.3c41.2 0 74.7 33.4 74.7 74.7v37.3H362.7v-37.3z m410.6 597.4c0 41.2-33.4 74.7-74.7 74.7H325.3c-41.2 0-74.7-33.4-74.7-74.7V325.3h522.7v485.4z",
  "M624 433.1c-20.6 0-37.3 16.7-37.3 37.3v261.3c0 20.6 16.7 37.3 37.3 37.3 20.6 0 37.3-16.7 37.3-37.3V470.4c0-20.6-16.7-37.3-37.3-37.3zM400 433.1c-20.6 0-37.3 16.7-37.3 37.3v261.3c0 20.6 16.7 37.3 37.3 37.3 20.6 0 37.3-16.7 37.3-37.3V470.4c0-20.6-16.7-37.3-37.3-37.3z",
];

function TrashIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {TRASH_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 眼睛图标（用户提供的 yanjing SVG：眼球轮廓 + 瞳孔，单色 currentColor）
const EYE_PATHS = [
  "M512 780.538776c-173.97551 0-321.828571-131.134694-394.44898-208.979592-30.82449-33.436735-30.82449-85.159184 0-118.595919 72.620408-77.844898 220.473469-208.979592 394.44898-208.979592s321.828571 131.134694 394.44898 208.979592c30.82449 33.436735 30.82449 85.159184 0 118.595919-72.620408 77.844898-220.473469 208.979592-394.44898 208.979592z m0-495.281633c-158.302041 0-295.706122 122.77551-364.146939 195.918367-16.195918 17.240816-16.195918 44.408163 0 61.64898 67.918367 73.142857 205.844898 195.918367 364.146939 195.918367s295.706122-122.77551 364.146939-195.918367c16.195918-17.240816 16.195918-44.408163 0-61.64898-68.440816-73.142857-205.844898-195.918367-364.146939-195.918367z",
  "M512 643.134694c-72.097959 0-131.134694-58.514286-131.134694-131.134694S439.902041 380.865306 512 380.865306s131.134694 58.514286 131.134694 131.134694-59.036735 131.134694-131.134694 131.134694z m0-220.47347c-49.110204 0-89.338776 40.228571-89.338776 89.338776s40.228571 89.338776 89.338776 89.338776 89.338776-40.228571 89.338776-89.338776-40.228571-89.338776-89.338776-89.338776z",
];

function EyeIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      {EYE_PATHS.map((d, i) => (
        <path key={i} d={d} fill="currentColor" />
      ))}
    </svg>
  );
}

// 敏感字段输入框：默认密文显示（····），点击右侧眼睛按钮切换明文/密文
function SecretInput({ className, placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="secret-input-wrap">
      <input
        className={className || "input"}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className={`secret-eye-btn${show ? " is-visible" : ""}`}
        onClick={() => setShow((v) => !v)}
        title={show ? "隐藏内容" : "显示内容"}
        aria-label={show ? "隐藏内容" : "显示内容"}
      >
        <EyeIcon />
      </button>
    </div>
  );
}

function Hint({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="mniat-hint"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <svg className="mniat-hint-icon" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
        <circle cx="512" cy="512" r="468" fill="none" stroke="currentColor" strokeWidth="88" />
        <circle cx="521" cy="273" r="77" fill="currentColor" />
        <rect x="452" y="401" width="138" height="367" rx="69" fill="currentColor" />
      </svg>
      {open && <span className="mniat-hint-bubble">{children}</span>}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {hint ? <Hint>{hint}</Hint> : null}
      </span>
      {children}
    </div>
  );
}

// ---------- 提供商卡片 ----------

function ProviderCard({ provider }) {
  const { update, removeProvider } = useConfigStore();
  const [isOpen, setIsOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingModel, setTestingModel] = useState(null);
  const [testResult, setTestResult] = useState(null); // { modelId, ok, message }
  const [bulkTesting, setBulkTesting] = useState(false);
  const [bulkResults, setBulkResults] = useState({}); // { modelId: { ok, message } }
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [modelsShown, setModelsShown] = useState(false);
  const [modelsFetching, setModelsFetching] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [modelsList, setModelsList] = useState([]);
  const [selectedModels, setSelectedModels] = useState({});
  const [modelQuery, setModelQuery] = useState("");
  const confirmTimerRef = useRef(null);

  // 延时格式化：<1000ms 显示 ms，≥1s 显示 s 并保留 1 位小数；无数据返回 "—"
  const formatLatency = (ms) => {
    if (ms == null || Number.isNaN(Number(ms))) return "—";
    const n = Number(ms);
    return n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`;
  };

  // UIWebView 不支持 window.confirm，改为两段式确认：
  // 第一次点击变为「确认删除？」（3 秒内有效），再次点击才真正删除
  const handleDelete = () => {
    if (confirmingDelete) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      removeProvider(provider.id);
      return;
    }
    setConfirmingDelete(true);
    confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  };

  const patch = (mutator) =>
    update((config) => {
      const target = config.providers.find((p) => p.id === provider.id);
      if (target) mutator(target);
    });

  // 测试指定模型：连通性 + 思考能力探测（probeReasoning）
  // 走插件侧 MNIAIService.test：先 POST {baseURL}/chat/completions 最小请求验证连通，
  // 再发一次带思考参数的请求判断模型是否支持推理，结果自动更新「支持推理」标记
  const runTest = async (modelId) => {
    if (!modelId || testing || bulkTesting) return;
    setTesting(true);
    setTestingModel(modelId);
    setTestResult(null);
    try {
      const result = await MNBridge.send("testProvider", { provider, modelId, probeReasoning: true });
      setTestResult({ modelId, ...result });
      // 探测到明确结论时，自动更新该模型的「支持推理」标记
      if (result && typeof result.supportsReasoning === "boolean") {
        const sr = result.supportsReasoning;
        patch((p) => {
          const target = p.models.find((m) => m.id === modelId);
          if (target && !!target.supportsReasoning !== sr) {
            target.supportsReasoning = sr;
          }
        });
      }
    } catch (error) {
      setTestResult({ modelId, ok: false, message: String((error && error.message) || error) });
    } finally {
      setTesting(false);
      setTestingModel(null);
    }
  };

  // 批量测试：逐个测试该供应商下所有已填 ID 的模型，结果实时写入 bulkResults。
  // 与单模型测试一致，附带推理能力探测（probeReasoning），结束后统一更新「支持推理」标记
  const runBulkTest = async () => {
    const targets = provider.models.filter((m) => m && String(m.id).trim());
    if (targets.length === 0 || bulkTesting) return;
    setBulkTesting(true);
    setBulkResults({});
    const detected = {}; // modelId -> supportsReasoning（批量结束后一次保存）
    for (const model of targets) {
      const modelId = String(model.id).trim();
      try {
        const result = await MNBridge.send("testProvider", { provider, modelId, probeReasoning: true });
        setBulkResults((prev) => ({
          ...prev,
          [modelId]: {
            ok: result.ok,
            message: result.message || "连接失败",
            supportsReasoning: result.supportsReasoning,
            latencyMs: result.latencyMs,
          },
        }));
        if (typeof result.supportsReasoning === "boolean") {
          detected[modelId] = result.supportsReasoning;
        }
      } catch (error) {
        setBulkResults((prev) => ({
          ...prev,
          [modelId]: { ok: false, message: String((error && error.message) || error), supportsReasoning: null },
        }));
      }
    }
    // 探测到明确结论时，统一更新标记（一次持久化）
    const keys = Object.keys(detected);
    if (keys.length > 0) {
      patch((p) => {
        keys.forEach((id) => {
          const t = p.models.find((m) => m.id === id);
          if (t && !!t.supportsReasoning !== detected[id]) {
            t.supportsReasoning = detected[id];
          }
        });
      });
    }
    setBulkTesting(false);
  };

  // 获取模型列表：插件侧 GET {baseURL}/models（OpenAI 兼容），再按需勾选添加
  const fetchModels = async () => {
    if (modelsFetching) return;
    setModelsFetching(true);
    setModelsError("");
    setModelsList([]);
    setSelectedModels({});
    setModelQuery("");
    setModelsShown(true);
    try {
      const result = await MNBridge.send("fetchModels", {
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
      });
      if (result && result.models) {
        setModelsList(result.models);
        if (result.models.length === 0 && result.message) {
          setModelsError(result.message);
        }
      } else {
        setModelsError((result && result.message) || "未能获取模型列表");
      }
    } catch (error) {
      setModelsError(String((error && error.message) || error));
    } finally {
      setModelsFetching(false);
    }
  };

  const toggleModel = (id) => {
    setSelectedModels((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const addSelectedModels = () => {
    const chosen = modelsList.filter((m) => selectedModels[m] && String(m).trim());
    if (chosen.length === 0) return;
    update((config) => {
      const target = config.providers.find((p) => p.id === provider.id);
      if (!target) return;
      const existing = new Set(target.models.map((m) => m.id));
      chosen.forEach((m) => {
        if (!existing.has(m)) {
          // 推理能力不在列表阶段判断，统一由「测试」时的探测确认，此处默认不支持
          target.models.push({ id: m, supportsReasoning: false });
          existing.add(m);
        }
      });
    });
    setModelsShown(false);
    setModelsList([]);
    setSelectedModels({});
  };

  const selectedCount = modelsList.filter((m) => selectedModels[m]).length;

  // 搜索过滤（不区分大小写）
  const filteredModels = modelQuery.trim()
    ? modelsList.filter((m) => String(m).toLowerCase().includes(modelQuery.trim().toLowerCase()))
    : modelsList;

  return (
    <div className={`provider-card ${isOpen ? "is-open" : ""}`}>
      <div className="provider-head">
        <button
          className="provider-toggle"
          onClick={() => setIsOpen((v) => !v)}
          aria-label={isOpen ? "收起" : "展开"}
        >
          <span className={`provider-caret ${isOpen ? "is-open" : ""}`}>▶</span>
        </button>
        <input
          className="input provider-name"
          value={provider.name}
          onChange={(e) => patch((p) => { p.name = e.target.value; })}
        />
        <span className="provider-meta">
          {provider.models.length > 0 ? `${provider.models.length} 个模型` : "未配置模型"}
        </span>
        <button
          className={`btn btn-danger btn-sm ${confirmingDelete ? "btn-danger-solid" : ""}`}
          onClick={handleDelete}
          title={confirmingDelete ? "再次点击确认删除" : "删除此提供商"}
        >
          {confirmingDelete ? "确认删除？" : <TrashIcon />}
        </button>
      </div>

      {isOpen && (
        <div className="provider-body">
          <Field label="Base URL">
            <input
              className="input"
              placeholder="https://api.example.com/v1"
              value={provider.baseURL}
              onChange={(e) => patch((p) => { p.baseURL = e.target.value; })}
            />
            <span className="field-hint">
              填到 /v1 这一级即可，<b>不需要</b>填 /chat/completions（插件会自动拼接）。
              例：https://api.deepseek.com/v1
            </span>
          </Field>

          <Field label="API Key（仅保存在本地）">
            <SecretInput
              placeholder="sk-..."
              value={provider.apiKey}
              onChange={(e) => patch((p) => { p.apiKey = e.target.value; })}
            />
          </Field>

          <div className="field">
            <span className="field-label">模型列表</span>
            {provider.models.length === 0 && (
              <p className="field-hint">暂无模型，可手动添加或点击下方「获取模型列表」。</p>
            )}
            {provider.models.map((model, index) => (
              <div className="model-row" key={index}>
                <input
                  className="input"
                  placeholder="模型 ID，如 deepseek-chat"
                  value={model.id}
                  onChange={(e) =>
                    patch((p) => { p.models[index].id = e.target.value; })
                  }
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!model.supportsReasoning}
                    onChange={(e) =>
                      patch((p) => { p.models[index].supportsReasoning = e.target.checked; })
                    }
                  />
                  支持推理
                </label>
                <button
                  className="btn btn-sm"
                  disabled={testing || bulkTesting}
                  onClick={() => runTest(model.id)}
                  title="用该模型发送最小请求验证连通性"
                >
                  {testing && testingModel === model.id ? "测试中…" : "测试"}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => patch((p) => { p.models.splice(index, 1); })}
                >
                  移除
                </button>
              </div>
            ))}
            <div className="model-toolbar">
              <button
                className="btn btn-sm"
                onClick={() => patch((p) => { p.models.push({ id: "", supportsReasoning: false }); })}
              >
                + 添加模型
              </button>
              <button
                className="btn btn-sm"
                onClick={runBulkTest}
                disabled={bulkTesting || provider.models.filter((m) => m && String(m.id).trim()).length === 0}
                title="逐个测试该供应商下所有已填 ID 的模型"
              >
                {bulkTesting ? "批量测试中…" : "批量测试全部"}
              </button>
              <button
                className="btn btn-sm"
                onClick={fetchModels}
                disabled={modelsFetching || !provider.baseURL.trim()}
                title={provider.baseURL.trim() ? "从 {baseURL}/models 拉取模型列表" : "请先填写 Base URL"}
              >
                {modelsFetching ? "获取中…" : "获取模型列表"}
              </button>
            </div>

            {testResult && (
              <div className="model-test-result">
                <span className={testResult.ok ? "test-ok" : "test-fail"}>
                  {testResult.ok
                    ? `✓ ${testResult.modelId} 连接成功（延时 ${formatLatency(testResult.latencyMs)}）`
                    : `✗ ${testResult.modelId}：${testResult.message || "连接失败"}${testResult.latencyMs != null ? `（延时 ${formatLatency(testResult.latencyMs)}）` : ""}`}
                  {testResult.ok && testResult.supportsReasoning === true && "（支持推理，已更新）"}
                  {testResult.ok && testResult.supportsReasoning === false && "（不支持推理，已更新）"}
                  {testResult.ok && testResult.supportsReasoning === null && "（无法探测推理能力）"}
                </span>
              </div>
            )}

            {bulkTesting && (
              <p className="field-hint">
                正在批量测试（{Object.keys(bulkResults).length}/{provider.models.filter((m) => m && String(m.id).trim()).length}）…
              </p>
            )}

            {!bulkTesting && Object.keys(bulkResults).length > 0 && (
              <div className="bulk-results">
                <div className="bulk-results-title">
                  <span>
                    测试完成：
                    {Object.values(bulkResults).filter((r) => r.ok).length} 成功 /
                    {Object.values(bulkResults).filter((r) => !r.ok).length} 失败
                  </span>
                  <button className="btn btn-sm" onClick={() => setBulkResults({})}>
                    清除
                  </button>
                </div>
                {provider.models
                  .filter((m) => m && String(m.id).trim() && bulkResults[String(m.id).trim()])
                  .map((m) => {
                    const r = bulkResults[String(m.id).trim()];
                    return (
                      <div className="bulk-result-row" key={m.id}>
                        <span className={r.ok ? "test-ok" : "test-fail"}>
                          {r.ok ? "✓" : "✗"}
                        </span>
                        <span className="bulk-result-id" title={m.id}>{m.id}</span>
                        <span className="bulk-result-msg">
                          {r.ok ? `连接成功（延时 ${formatLatency(r.latencyMs)}）` : r.message || "连接失败"}
                          {r.ok && r.supportsReasoning === true && "（支持推理）"}
                          {r.ok && r.supportsReasoning === false && "（不支持推理）"}
                          {r.ok && r.supportsReasoning === null && "（无法探测推理）"}
                        </span>
                      </div>
                    );
                  })}
              </div>
            )}

            {modelsShown && (
              <div className="models-picker">
                {modelsFetching && <p className="field-hint">正在请求模型列表，请稍候…</p>}
                {!modelsFetching && modelsError && (
                  <p className="test-fail">{modelsError}</p>
                )}
                {!modelsFetching && !modelsError && modelsList.length > 0 && (
                  <>
                    <p className="field-hint">勾选需要添加的模型，可多选：</p>
                    <input
                      className="input models-search"
                      placeholder="搜索模型名称，如 deepseek…"
                      value={modelQuery}
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      onChange={(e) => setModelQuery(e.target.value)}
                    />
                    {filteredModels.length === 0 ? (
                      <p className="field-hint">未找到与「{modelQuery.trim()}」匹配的模型</p>
                    ) : (
                      <>
                        <div className="models-picker-list">
                          {filteredModels.map((m) => (
                            <label className="checkbox" key={m}>
                              <input
                                type="checkbox"
                                checked={!!selectedModels[m]}
                                onChange={() => toggleModel(m)}
                              />
                              <span className="model-id" title={m}>{m}</span>
                            </label>
                          ))}
                        </div>
                        <div className="models-picker-actions">
                          <button className="btn btn-sm" onClick={addSelectedModels} disabled={selectedCount === 0}>
                            添加选中（{selectedCount}）
                          </button>
                          <button className="btn btn-sm" onClick={() => setModelsShown(false)}>
                            关闭
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 机器翻译服务商卡片：复用 ProviderCard 的「点击 → 显示确认 → 再点确认」两步删除模式
function MachineProviderCard({ mp, idx }) {
  const { update } = useConfigStore();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimerRef = useRef(null);

  // UIWebView 不支持 window.confirm，改为两段式确认：
  // 第一次点击变为「确认删除？」（3 秒内有效），再次点击才真正删除
  const handleDelete = () => {
    if (confirmingDelete) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      update((c) => {
        c.machineProviders.splice(idx, 1);
        if (c.machineRouting.providerId === mp.id) {
          c.machineRouting.providerId = "";
        }
      });
      setConfirmingDelete(false);
      return;
    }
    setConfirmingDelete(true);
    confirmTimerRef.current = setTimeout(() => setConfirmingDelete(false), 3000);
  };

  const patch = (mutator) =>
    update((c) => {
      const target = c.machineProviders[idx];
      if (target) mutator(target);
    });

  const vendorLabel = mp.vendor === "niutrans" ? "小牛" :
    (mp.vendor === "aliyun" ? "阿里云" :
    (mp.vendor === "tencent" ? "腾讯云" :
    (mp.vendor === "volcengine" ? "火山" : "百度")));

  return (
    <div className="machine-provider-card">
      <div className="machine-provider-head">
        <input
          className="input provider-name"
          value={mp.name}
          onChange={(e) => patch((p) => { p.name = e.target.value; })}
        />
        <span className="machine-vendor-tag">{vendorLabel}</span>
        <button
          className={`btn btn-danger btn-sm ${confirmingDelete ? "btn-danger-solid" : ""}`}
          onClick={handleDelete}
          title={confirmingDelete ? "再次点击确认删除" : "删除此服务"}
          aria-label="删除此服务"
        >
          {confirmingDelete ? "确认删除？" : <TrashIcon />}
        </button>
      </div>

      {mp.vendor === "aliyun" ? (
        <>
          <Field
            label="AccessKey ID"
            hint="阿里云 RAM 访问密钥 ID（控制台 → 访问控制 RAM → 用户 → 创建 AccessKey）"
          >
            <SecretInput
              placeholder="LTAI..."
              value={mp.accessKeyId || ""}
              onChange={(e) => patch((p) => { p.accessKeyId = e.target.value; })}
            />
          </Field>
          <Field
            label="AccessKey Secret"
            hint="阿里云 RAM 访问密钥 Secret（仅创建时可见，请妥善保存）"
          >
            <SecretInput
              placeholder="阿里云 AccessKey Secret"
              value={mp.accessKeySecret || ""}
              onChange={(e) => patch((p) => { p.accessKeySecret = e.target.value; })}
            />
          </Field>
        </>
      ) : mp.vendor === "tencent" ? (
        <>
          <Field
            label="SecretId"
            hint="腾讯云 API 密钥 ID（控制台 → 访问管理 → API 密钥管理）"
          >
            <SecretInput
              placeholder="AKID..."
              value={mp.secretId || ""}
              onChange={(e) => patch((p) => { p.secretId = e.target.value; })}
            />
          </Field>
          <Field
            label="SecretKey"
            hint="腾讯云 API 密钥 SecretKey（仅创建时可见，请妥善保存）"
          >
            <SecretInput
              placeholder="腾讯云 SecretKey"
              value={mp.secretKey || ""}
              onChange={(e) => patch((p) => { p.secretKey = e.target.value; })}
            />
          </Field>
        </>
      ) : mp.vendor === "volcengine" ? (
        <>
          <Field
            label="AccessKey ID"
            hint="火山引擎访问密钥 ID（控制台 → 访问控制 → 密钥管理）"
          >
            <SecretInput
              placeholder="AK..."
              value={mp.accessKeyId || ""}
              onChange={(e) => patch((p) => { p.accessKeyId = e.target.value; })}
            />
          </Field>
          <Field
            label="SecretAccessKey"
            hint="火山引擎访问密钥（仅创建时可见，请妥善保存）"
          >
            <SecretInput
              placeholder="火山引擎 SecretAccessKey"
              value={mp.secretAccessKey || ""}
              onChange={(e) => patch((p) => { p.secretAccessKey = e.target.value; })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label="APPID"
            hint={mp.vendor === "niutrans"
              ? "小牛 Flash 需要；仅使用 Pro（大模型）可留空"
              : "百度开放平台 APPID（必填）"}
          >
            <SecretInput
              placeholder={mp.vendor === "niutrans" ? "小牛 Flash 专用（Pro 可留空）" : "百度开放平台 APPID"}
              value={mp.appid}
              onChange={(e) => patch((p) => { p.appid = e.target.value; })}
            />
          </Field>
          <Field
            label="密钥（Secret Key / API Key）"
            hint={mp.vendor === "niutrans"
              ? "小牛开放平台 API Key（控制台→API应用，Flash 与 Pro 通用）"
              : "百度开放平台密钥（必填）"}
          >
            <SecretInput
              placeholder={mp.vendor === "niutrans" ? "小牛 API Key" : "百度开放平台密钥"}
              value={mp.secretKey}
              onChange={(e) => patch((p) => { p.secretKey = e.target.value; })}
            />
          </Field>
        </>
      )}
    </div>
  );
}

// ---------- 路由配置 ----------

function RouteEditor({ kind, title }) {
  const { config, update } = useConfigStore();
  const route = config.routing[kind];
  const provider = config.providers.find((p) => p.id === route.providerId);
  const model = provider && provider.models.find((m) => m.id === route.modelId);

  return (
    <div className="route-editor">
      <h3 className="route-title">{title}</h3>
      <div className="route-grid">
        <Field label="提供商">
          <select
            className="input"
            value={route.providerId}
            onChange={(e) =>
              update((config) => {
                config.routing[kind].providerId = e.target.value;
                config.routing[kind].modelId = "";
              })
            }
          >
            <option value="">未选择</option>
            {config.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>

        <Field label="模型">
          <select
            className="input"
            value={route.modelId}
            onChange={(e) =>
              update((config) => { config.routing[kind].modelId = e.target.value; })
            }
          >
            <option value="">未选择</option>
            {provider &&
              provider.models.map((m, i) => (
                <option key={i} value={m.id}>{m.id}</option>
              ))}
          </select>
        </Field>

        <Field
          label={`Temperature：${route.temperature}`}
          hint="控制输出随机性：值越低回答越稳定保守，越高越多样有创意（0–1）。"
        >
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={route.temperature}
            onChange={(e) =>
              update((config) => {
                config.routing[kind].temperature = Number(e.target.value);
              })
            }
          />
        </Field>

        <Field
          label="Reasoning Effort"
          hint="思考强度：高模型会花更多时间推理，回答更深入但更慢；关闭则直接作答（仅支持推理的模型可设）。"
        >
          <select
            className="input"
            value={route.reasoningEffort}
            disabled={!model || !model.supportsReasoning}
            onChange={(e) =>
              update((config) => {
                config.routing[kind].reasoningEffort = e.target.value;
              })
            }
          >
            {REASONING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

// ---------- Prompt 编辑 ----------

function PromptEditor({ promptKey, title }) {
  const { config, update } = useConfigStore();
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const value = config.prompts[promptKey];

  useEffect(() => {
    MNBridge.send("getDefaultPrompts")
      .then((defaults) => setDefaultPrompt(defaults[promptKey] || ""))
      .catch(() => {});
  }, [promptKey]);

  return (
    <div className="prompt-editor">
      <div className="prompt-head">
        <h3 className="route-title">{title}</h3>
        <button
          className="btn btn-sm"
          onClick={() => update((config) => { config.prompts[promptKey] = ""; })}
        >
          恢复默认
        </button>
      </div>
      <textarea
        className="input textarea"
        rows={6}
        placeholder={defaultPrompt || "加载默认模板…"}
        value={value}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) =>
          update((config) => { config.prompts[promptKey] = e.target.value; })
        }
      />
      <p className="field-hint">
        留空则使用默认模板。可用变量：<code>{"{text}"}</code> 选中文本、
        <code>{"{target_lang}"}</code> 目标语言、
        <code>{"{context}"}</code> 选区上下文（前后文，长度在「常规」设置中配置，0 时不注入）。
      </p>
    </div>
  );
}

// ---------- 导入确认弹窗 ----------

// ---------- 配置导入 / 导出弹窗 ----------
// 上下两区：导出（文件 / 剪贴板，不影响当前配置）与导入（文件 / 粘贴，整体覆盖）。
function ImportDialog({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [importMsgOk, setImportMsgOk] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [exportMsgOk, setExportMsgOk] = useState(false);

  const showImportResult = (res) => {
    if (res && res.ok) {
      setImportMsgOk(true);
      setImportMsg(`导入成功：${res.providers} 个提供商${res.hasPrompts ? "，含自定义 Prompt" : ""}。`);
      setTimeout(onClose, 1200);
    } else {
      setImportMsgOk(false);
      setImportMsg("导入失败：" + ((res && res.error) || "未知错误"));
    }
  };

  // 导出为文件：写临时文件 + 弹系统保存面板
  const onExportFile = async () => {
    if (busy) return;
    setBusy(true);
    setExportMsg("");
    try {
      const res = await useConfigStore.getState().exportConfig();
      if (res && res.ok) {
        setExportMsgOk(true);
        setExportMsg(`已弹出保存面板，请选择保存位置（文件 ${res.fileName}）。`);
      } else {
        setExportMsgOk(false);
        setExportMsg("导出失败：" + ((res && res.error) || "未知错误"));
      }
    } catch (e) {
      setExportMsgOk(false);
      setExportMsg("导出失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  // 复制到剪贴板：配置 JSON 写入系统剪贴板（配合「粘贴导入」跨设备快速同步）
  const onExportClipboard = async () => {
    if (busy) return;
    setBusy(true);
    setExportMsg("");
    try {
      const res = await useConfigStore.getState().exportConfigToClipboard();
      if (res && res.ok) {
        setExportMsgOk(true);
        setExportMsg(`已复制完整配置（${res.bytes} 字符，含供应商与 API Key）到剪贴板，可直接粘贴到文件，或在本弹窗「粘贴导入」中同步。`);
      } else {
        setExportMsgOk(false);
        setExportMsg("导出失败：" + ((res && res.error) || "未知错误"));
      }
    } catch (e) {
      setExportMsgOk(false);
      setExportMsg("导出失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  // 从文件选择器导入（点「选择文件…」触发；文件选择器取消时不回调，等待超时返回）
  const doImportFromFile = async () => {
    if (busy) return;
    setBusy(true);
    setImportMsg("");
    try {
      showImportResult(await useConfigStore.getState().importConfigFromFile());
    } catch (e) {
      setImportMsgOk(false);
      setImportMsg("导入失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  // 粘贴导入（点「粘贴导入」触发，textarea 有内容才可用）
  const doImportPaste = async () => {
    if (busy || !paste.trim()) return;
    setBusy(true);
    setImportMsg("");
    try {
      showImportResult(await useConfigStore.getState().importConfig(paste));
    } catch (e) {
      setImportMsgOk(false);
      setImportMsg("导入失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">导入 / 导出配置</h3>

        <div className="modal-section">
          <div className="modal-section-head">
            <span className="modal-section-title">导出</span>
            <span className="field-hint">不影响当前配置</span>
          </div>
          <div className="modal-actions modal-actions-left">
            <button className="btn" onClick={onExportFile} disabled={busy}>
              导出为文件…
            </button>
            <button className="btn" onClick={onExportClipboard} disabled={busy}>
              复制到剪贴板
            </button>
          </div>
          {exportMsg && (
            <p className={`sync-msg ${exportMsgOk ? "sync-msg-ok" : "sync-msg-err"}`}>{exportMsg}</p>
          )}
        </div>

        <div className="modal-section">
          <div className="modal-section-head">
            <span className="modal-section-title">导入</span>
            <span className="modal-warn-inline">⚠ 会覆盖当前所有配置，不可恢复</span>
          </div>
          <div className="modal-actions modal-actions-left">
            <button className="btn" onClick={doImportFromFile} disabled={busy}>
              选择文件…
            </button>
            <span className="field-hint">选择「导出为文件」生成的 IAT-时间戳.json</span>
          </div>
          <textarea
            className="input textarea modal-textarea"
            rows={3}
            spellCheck={false}
            placeholder="（可选）也可以把配置 JSON 粘贴到这里，再点「粘贴导入」…"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn" onClick={doImportPaste} disabled={busy || !paste.trim()}>
              粘贴导入
            </button>
          </div>
          {importMsg && (
            <p className={`sync-msg ${importMsgOk ? "sync-msg-ok" : "sync-msg-err"}`}>{importMsg}</p>
          )}
        </div>

        <div className="modal-actions modal-actions-foot">
          <button className="btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ---------- 设置主页 ----------

function SettingsPage() {
  const { config, loaded, saving, saveError, load, update, addProvider } = useConfigStore();
  const [importOpen, setImportOpen] = useState(false);

  const [presetIndex, setPresetIndex] = useState(0);
  const [mtPresetIndex, setMtPresetIndex] = useState(0);
  const [activeTab, setActiveTab] = useState("general");
  const [aiProvidersOpen, setAiProvidersOpen] = useState(false); // AI 服务提供商默认折叠
  const [mtOpen, setMtOpen] = useState(true);                     // 机器翻译服务默认展开

  // 当前机器翻译路由所选提供商的 vendor（用于路由页动态显示接口选项）
  const mtProviders = config.machineProviders || [];
  const mtSelected = mtProviders.find((p) => p.id === config.machineRouting.providerId);
  const mtVendor = (mtSelected && mtSelected.vendor) || "baidu";

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) {
    return <div className="loading-page">加载配置中…</div>;
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>即时 AI 翻译 · 设置</h1>
        <span className="save-status">
          {saving ? "保存中…" : saveError ? `保存失败：${saveError}` : "已自动保存"}
        </span>
      </header>

      {/* 查词 / 翻译 独立开关：原「插件总开关」一分为二，可单独控制两类功能 */}
      <div className="dual-toggle">
        <button
          className={`master-toggle ${config.lookupEnabled !== false ? "is-on" : "is-off"}`}
          onClick={() => update((c) => { c.lookupEnabled = !(config.lookupEnabled !== false); })}
        >
          <span className="master-toggle-dot" />
          <span className="master-toggle-text">查词</span>
          <span className="master-toggle-hint">
            {config.lookupEnabled !== false ? "已启用" : "已停用"}
          </span>
        </button>
        <button
          className={`master-toggle ${config.translateEnabled !== false ? "is-on" : "is-off"}`}
          onClick={() => update((c) => { c.translateEnabled = !(config.translateEnabled !== false); })}
        >
          <span className="master-toggle-dot" />
          <span className="master-toggle-text">翻译</span>
          <span className="master-toggle-hint">
            {config.translateEnabled !== false ? "已启用" : "已停用"}
          </span>
        </button>
      </div>
      <p className="dual-toggle-hint">
        查词：选中单词时查词典；翻译：选中句子/段落时 AI 翻译。仅开启查词时，选中句子不会触发翻译。
      </p>

      <nav className="settings-tabs">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            <span className="settings-tab-full">{tab.label}</span>
            <span className="settings-tab-short">{tab.short}</span>
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {activeTab === "general" && (
          <Section title="常规">
            {/* ===== 通用（置顶） ===== */}
            <h3 className="subsection-title">通用</h3>
            <div className="route-grid">
              <Field label="触发方式">
                <select
                  className="input"
                  value={config.triggerMode}
                  onChange={(e) => update((c) => { c.triggerMode = e.target.value; })}
                >
                  <option value="auto">选中后自动翻译</option>
                  <option value="button">选中后显示悬浮按钮</option>
                </select>
              </Field>

              <Field
                label="选区上下文长度"
                hint="划词翻译/解释时，从当前页文本层取选区前后的文字作为上下文，渲染进 prompt 的 {context} 变量，帮助 AI 理解语境（如指代、专业术语）。填写选区前后各取多少字符；设为 0 表示不获取上下文。"
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="2000"
                  step="10"
                  value={config.contextLength}
                  onChange={(e) =>
                    update((c) => {
                      const v = parseInt(e.target.value, 10);
                      c.contextLength = isNaN(v) || v < 0 ? 0 : v;
                    })
                  }
                />
              </Field>

              <Field
                label="触发翻译的单词数"
                hint="选区单词数大于此值时按翻译处理，否则按查词处理（便于用查词服务查词组）。英文按空格分词，中文按字符算（汉字本身就是词）。默认 3；纯英文单词始终按查词。"
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={config.translateWordCount}
                  onChange={(e) =>
                    update((c) => {
                      const v = parseInt(e.target.value, 10);
                      c.translateWordCount = isNaN(v) || v < 0 ? 0 : v;
                    })
                  }
                />
              </Field>

              <Field label="主题">
                <select
                  className="input"
                  value={config.theme}
                  onChange={(e) => update((c) => { c.theme = e.target.value; })}
                >
                  <option value="light">亮色</option>
                  <option value="dark">暗色</option>
                </select>
              </Field>

              <Field label="结果字号">
                <select
                  className="input"
                  value={config.fontSize}
                  onChange={(e) => update((c) => { c.fontSize = e.target.value; })}
                >
                  <option value="small">小</option>
                  <option value="medium">中</option>
                  <option value="large">大</option>
                </select>
              </Field>
            </div>
            <div className="checkbox-grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.streamMode !== false}
                  onChange={(e) => update((c) => { c.streamMode = e.target.checked; })}
                />
                打字机效果
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!config.rememberCardSize}
                  onChange={(e) => update((c) => { c.rememberCardSize = e.target.checked; })}
                />
                记住卡片大小
              </label>
            </div>

            {/* ===== 查词 ===== */}
            <h3 className="subsection-title">查词</h3>
            <div className="route-grid">
              <Field
                label="查词服务提供商"
                hint="划词查询单个单词时使用的词典；选择「AI 解释」则直接调用 AI（使用模型路由中「AI 解释」的提供商与模型）。"
              >
                <select
                  className="input"
                  value={config.lookupProvider || "youdao"}
                  onChange={(e) => update((c) => { c.lookupProvider = e.target.value; })}
                >
                  <option value="youdao">有道词典</option>
                  <option value="bing">必应词典</option>
                  <option value="haici">海词词典</option>
                  <option value="kingsoft">金山词霸</option>
                  <option value="ai">AI 解释</option>
                </select>
              </Field>

              <Field label="发音口音">
                <select
                  className="input"
                  value={config.pronounceAccent}
                  onChange={(e) => update((c) => { c.pronounceAccent = e.target.value; })}
                >
                  <option value="us">美式</option>
                  <option value="uk">英式</option>
                </select>
              </Field>

              <Field
                label="AI 解释发音"
                hint={config.lookupProvider === "ai"
                  ? "查词服务为 AI 解释时生效：AI 返回结果后自动朗读该单词，跟随「查词自动发音」开关，发音口音遵循「发音口音」设置。"
                  : "需将「查词服务提供商」选为「AI 解释」后生效。"}
              >
                <select
                  className="input"
                  value={config.aiExplainPronounce || "youdao"}
                  disabled={config.lookupProvider !== "ai"}
                  onChange={(e) => update((c) => { c.aiExplainPronounce = e.target.value; })}
                >
                  <option value="youdao">有道词典</option>
                  <option value="haici">海词词典</option>
                  <option value="bing">必应词典</option>
                  <option value="kingsoft">金山词霸</option>
                </select>
              </Field>

              <Field
                label="查词缓存数量"
                hint="查过的单词结果会缓存（含 AI 解释），再次查询相同单词时直接使用缓存，无需重复请求；不同查词服务查询同一单词互不串用缓存。设为 0 表示不使用缓存。"
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={config.lookupCacheSize}
                  onChange={(e) =>
                    update((c) => {
                      const v = parseInt(e.target.value, 10);
                      c.lookupCacheSize = isNaN(v) || v < 0 ? 0 : v;
                    })
                  }
                />
              </Field>
            </div>
            <div className="checkbox-grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={config.pronounceAuto}
                  onChange={(e) => update((c) => { c.pronounceAuto = e.target.checked; })}
                />
                查词后自动发音
              </label>
            </div>

            {/* ===== 翻译 ===== */}
            <h3 className="subsection-title">翻译</h3>
            <div className="route-grid">
              <Field
                label="翻译服务"
                hint="翻译句子/段落时使用的引擎：AI 翻译走「模型路由」中配置的大模型；机器翻译走百度等开放平台（无需 AI Key），接口类型与领域在「模型路由」页配置。"
              >
                <select
                  className="input"
                  value={config.translateService === "machine" ? "machine" : "ai"}
                  onChange={(e) => update((c) => { c.translateService = e.target.value; })}
                >
                  <option value="ai">AI 翻译</option>
                  <option value="machine">机器翻译</option>
                </select>
              </Field>

              <Field label="目标语言">
                <select
                  className="input"
                  value={config.targetLang}
                  onChange={(e) => update((c) => { c.targetLang = e.target.value; })}
                >
                  {TARGET_LANGS.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="AI 翻译缓存数量"
                hint="翻译过的句子结果会缓存，再次翻译相同句子时直接使用缓存，无需重复请求。设为 0 表示不使用缓存；点击「重新生成」始终重新请求，不读缓存。"
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={config.translateCacheSize}
                  onChange={(e) =>
                    update((c) => {
                      const v = parseInt(e.target.value, 10);
                      c.translateCacheSize = isNaN(v) || v < 0 ? 0 : v;
                    })
                  }
                />
              </Field>
            </div>

            {/* ===== 卡片颜色（独立分类） ===== */}
            <h3 className="subsection-title">
              卡片颜色
              <Hint>设置「添加」按钮创建卡片时使用的颜色</Hint>
            </h3>
            <div className="color-section-row">
              <div className="color-section">
                <span className="color-section-label">翻译卡片颜色</span>
                <ColorPicker
                  value={config.cardColorTranslate}
                  onChange={(v) => update((c) => { c.cardColorTranslate = v; })}
                />
              </div>
              <div className="color-section">
                <span className="color-section-label">查词 / AI 解释卡片颜色</span>
                <ColorPicker
                  value={config.cardColorLookup}
                  onChange={(v) => update((c) => { c.cardColorLookup = v; })}
                />
              </div>
            </div>

            <div className="config-sync-buttons">
              <span className="sync-btn-wrap">
                <button className="btn" onClick={() => setImportOpen(true)}>
                  导入 / 导出配置
                </button>
                <Hint>
                  导出：将全部设置（常规设置、AI 服务提供商与 API Key、模型路由、Prompt 模板）保存为文件或复制到剪贴板，便于备份与跨设备同步；导入：从文件或粘贴内容整体覆盖当前配置（导入前可先导出留底）。
                </Hint>
              </span>
            </div>
            {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
          </Section>
        )}

        {activeTab === "providers" && (
          <Section title="服务提供商">
            {/* AI 服务提供商：默认折叠，点击展开 */}
            <div className="provider-section">
              <div className="section-collapse-head" onClick={() => setAiProvidersOpen((v) => !v)}>
                <span className={`provider-caret ${aiProvidersOpen ? "is-open" : ""}`}>▶</span>
                <span className="section-collapse-title">AI 服务提供商</span>
              </div>
              {aiProvidersOpen && (
                <div className="section-collapse-body">
                  <div className="add-provider">
                    <select
                      className="input"
                      value={presetIndex}
                      onChange={(e) => setPresetIndex(Number(e.target.value))}
                    >
                      {PROVIDER_PRESETS.map((preset, i) => (
                        <option key={i} value={i}>{preset.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      onClick={() => addProvider(PROVIDER_PRESETS[presetIndex])}
                    >
                      + 添加提供商
                    </button>
                  </div>
                  {config.providers.length === 0 && (
                    <p className="field-hint">尚未添加提供商。从上方预设中选择添加，然后填入 API Key。</p>
                  )}
                  {config.providers.map((provider) => (
                    <ProviderCard key={provider.id} provider={provider} />
                  ))}
                </div>
              )}
            </div>

            {/* 机器翻译服务：百度开放平台等，无需 AI Key */}
            <div className="provider-section">
              <div className="section-collapse-head" onClick={() => setMtOpen((v) => !v)}>
                <span className={`provider-caret ${mtOpen ? "is-open" : ""}`}>▶</span>
                <span className="section-collapse-title">机器翻译服务</span>
              </div>
              {mtOpen && (
                <div className="section-collapse-body">
                  {config.machineProviders.length === 0 && (
                    <p className="field-hint">尚未配置机器翻译账户。在上方下拉中选择要添加的服务商，再点击「+ 添加」。</p>
                  )}
                  {config.machineProviders.map((mp, idx) => (
                    <MachineProviderCard key={mp.id} mp={mp} idx={idx} />
                  ))}
                  <div className="add-provider">
                    <select
                      className="input"
                      value={mtPresetIndex}
                      onChange={(e) => setMtPresetIndex(Number(e.target.value))}
                    >
                      {MACHINE_PROVIDER_PRESETS.map((preset, i) => (
                        <option key={i} value={i}>{preset.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      onClick={() => {
                        const preset = MACHINE_PROVIDER_PRESETS[mtPresetIndex];
                        update((c) => {
                          const id = `mt-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
                          c.machineProviders.push({
                            id,
                            vendor: preset.vendor,
                            name: preset.name,
                            appid: "",
                            secretKey: "",
                            accessKeyId: "",
                            accessKeySecret: "",
                            secretId: "",
                            secretAccessKey: "",
                          });
                        });
                      }}
                    >
                      + 添加
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {activeTab === "routing" && (
          <Section title="模型路由">
            <RouteEditor kind="translate" title="翻译（句子/段落）" />
            <RouteEditor kind="lookup" title="AI 解释（单词卡切换）" />

            <div className="route-editor mt-route-editor">
              <h3 className="route-title">机器翻译路由</h3>
              <div className="route-grid">
                <Field label="机器翻译提供商">
                  <select
                    className="input"
                    value={config.machineRouting.providerId}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const mp = (config.machineProviders || []).find((p) => p.id === pid);
                      update((c) => {
                        c.machineRouting.providerId = pid;
                        // 切换提供商时按 vendor 重置接口类型默认值
                        if (!mp) {
                          c.machineRouting.apiType = "llm";
                        } else if (mp.vendor === "niutrans") {
                          c.machineRouting.apiType = "pro";
                        } else if (mp.vendor === "aliyun") {
                          c.machineRouting.apiType = "general";
                        } else if (mp.vendor === "tencent" || mp.vendor === "volcengine") {
                          // 腾讯/火山：当前均只暴露一个文本翻译接口
                          c.machineRouting.apiType = "text";
                        } else {
                          c.machineRouting.apiType = "llm";
                        }
                      });
                    }}
                  >
                    <option value="">未选择</option>
                    {(config.machineProviders || []).map((mp) => (
                      <option key={mp.id} value={mp.id}>{mp.name}</option>
                    ))}
                  </select>
                </Field>

                {mtVendor === "niutrans" ? (
                  <Field
                    label="产品类型"
                    hint="Flash：高并发低延迟，适合批量短文本；Pro（大模型）：上下文理解更强，适合长文本与专业内容。"
                  >
                    <select
                      className="input"
                      value={config.machineRouting.apiType === "flash" ? "flash" : "pro"}
                      onChange={(e) =>
                        update((c) => { c.machineRouting.apiType = e.target.value; })
                      }
                    >
                      <option value="flash">通用文本 Flash</option>
                      <option value="pro">通用文本 Pro（大模型）</option>
                    </select>
                  </Field>
                ) : mtVendor === "aliyun" ? (
                  <Field
                    label="接口类型"
                    hint="通用版：通用场景翻译；专业版：按场景（商品/医疗/社交/金融等）优化译文。均支持自动识别原文语言。"
                  >
                    <select
                      className="input"
                      value={config.machineRouting.apiType === "pro" ? "pro" : "general"}
                      onChange={(e) =>
                        update((c) => { c.machineRouting.apiType = e.target.value; })
                      }
                    >
                      <option value="general">通用版（TranslateGeneral）</option>
                      <option value="pro">专业版（Translate）</option>
                    </select>
                  </Field>
                ) : mtVendor === "tencent" ? (
                  <Field
                    label="接口类型"
                    hint="腾讯云机器翻译 TMT 文本翻译接口（TextTranslate），支持自动识别原文语言，单次 2000 字符以内。"
                  >
                    <select
                      className="input"
                      value="text"
                      disabled
                    >
                      <option value="text">文本翻译（TextTranslate）</option>
                    </select>
                  </Field>
                ) : mtVendor === "volcengine" ? (
                  <Field
                    label="接口类型"
                    hint="火山引擎文本翻译（TranslateText），单次最多 16 段或 5000 字符；SourceLanguage 未指定时自动检测。"
                  >
                    <select
                      className="input"
                      value="text"
                      disabled
                    >
                      <option value="text">文本翻译（TranslateText）</option>
                    </select>
                  </Field>
                ) : (
                  <Field
                    label="接口类型"
                    hint="大模型翻译走百度大模型接口；通用文本翻译走标准接口；领域文本翻译按领域优化（仅中英互译）。"
                  >
                    <select
                      className="input"
                      value={config.machineRouting.apiType === "domain" ? "domain" :
                        (config.machineRouting.apiType === "llm" ? "llm" : "standard")}
                      onChange={(e) =>
                        update((c) => { c.machineRouting.apiType = e.target.value; })
                      }
                    >
                      <option value="llm">大模型翻译</option>
                      <option value="standard">通用文本翻译</option>
                      <option value="domain">领域文本翻译</option>
                    </select>
                  </Field>
                )}

                {mtVendor === "baidu" && config.machineRouting.apiType === "domain" && (
                  <Field
                    label="翻译领域"
                    hint="领域翻译接口 domain 参数：按领域优化译文（信息技术/金融财经/生物医药等 11 个领域）。"
                  >
                    <select
                      className="input"
                      value={config.machineRouting.domain || "it"}
                      onChange={(e) =>
                        update((c) => { c.machineRouting.domain = e.target.value; })
                      }
                    >
                      {MT_DOMAINS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {mtVendor === "aliyun" && config.machineRouting.apiType === "pro" && (
                  <Field
                    label="专业版场景"
                    hint="阿里云专业版 Translate 接口 Scene 参数：每个场景用对应引擎优化（商品标题/商品描述/商品沟通/医疗/社交/金融）。"
                  >
                    <select
                      className="input"
                      value={config.machineRouting.scene || "title"}
                      onChange={(e) =>
                        update((c) => { c.machineRouting.scene = e.target.value; })
                      }
                    >
                      {MT_SCENES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>
          </Section>
        )}

        {activeTab === "prompts" && (
          <Section title="Prompt 模板">
            <PromptEditor promptKey="translate" title="翻译 Prompt" />
            <PromptEditor promptKey="explain" title="AI 解释 Prompt" />
          </Section>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
