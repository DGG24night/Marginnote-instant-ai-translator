import { useEffect, useRef, useState } from "react";
import MNBridge from "../lib/mnBridge";
import { PROVIDER_PRESETS, useConfigStore } from "../store/configStore";

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

// 设置页顶部导航标签（short 用于窄屏时的缩写）
const SETTINGS_TABS = [
  { id: "general", label: "常规", short: "常规" },
  { id: "providers", label: "AI 服务提供商", short: "提供商" },
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
            <input
              className="input"
              type="password"
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
        <code>{"{target_lang}"}</code> 目标语言。
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
  const [activeTab, setActiveTab] = useState("general");

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

              <Field label="查词自动发音">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.pronounceAuto}
                    onChange={(e) => update((c) => { c.pronounceAuto = e.target.checked; })}
                  />
                  开启
                </label>
              </Field>

              <Field label="打字机效果" hint="AI 翻译/解释结果以打字机效果逐字显示。">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={config.streamMode !== false}
                    onChange={(e) => update((c) => { c.streamMode = e.target.checked; })}
                  />
                  {config.streamMode !== false ? "开启" : "关闭"}
                </label>
              </Field>

              <Field label="记住卡片大小">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!!config.rememberCardSize}
                    onChange={(e) => update((c) => { c.rememberCardSize = e.target.checked; })}
                  />
                  {config.rememberCardSize ? "开启" : "关闭"}
                </label>
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
          <Section title="AI 服务提供商">
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
          </Section>
        )}

        {activeTab === "routing" && (
          <Section title="模型路由">
            <RouteEditor kind="translate" title="翻译（句子/段落）" />
            <RouteEditor kind="lookup" title="AI 解释（单词卡切换）" />
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
