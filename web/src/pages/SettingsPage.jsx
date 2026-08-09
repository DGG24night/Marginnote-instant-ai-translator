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
      <span className="mniat-hint-icon" aria-label="帮助说明">!</span>
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
        >
          {confirmingDelete ? "确认删除？" : "删除"}
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
                    ? `✓ ${testResult.modelId} 连接成功`
                    : `✗ ${testResult.modelId}：${testResult.message || "连接失败"}`}
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
                          {r.ok ? "连接成功" : r.message || "连接失败"}
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

        <Field label={`Temperature：${route.temperature}`}>
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

        <Field label="Reasoning Effort">
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

// ---------- 设置主页 ----------

function SettingsPage() {
  const { config, loaded, saving, saveError, load, update, addProvider } = useConfigStore();
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

      <button
        className={`master-toggle ${config.enabled !== false ? "is-on" : "is-off"}`}
        onClick={() => update((c) => { c.enabled = !(config.enabled !== false); })}
      >
        <span className="master-toggle-dot" />
        <span className="master-toggle-text">
          {config.enabled !== false ? "插件已启用" : "插件已停用"}
        </span>
        <span className="master-toggle-hint">
          {config.enabled !== false ? "点击停用划词翻译" : "点击启用划词翻译"}
        </span>
      </button>

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
                  <option value="ai">AI 解释（调用 AI）</option>
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

              <Field label="打字机效果" hint="AI 翻译/解释结果以打字机效果逐字显示（兼容所有网络环境）。">
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
            </div>
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
