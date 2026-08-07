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

function Section({ title, children }) {
  return (
    <section className="section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

// ---------- 提供商卡片 ----------

function ProviderCard({ provider }) {
  const { update, removeProvider } = useConfigStore();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  const runTest = async () => {
    const firstModel = provider.models[0];
    if (!firstModel) {
      setTestResult({ ok: false, message: "请先添加至少一个模型" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await MNBridge.send("testProvider", {
        provider,
        modelId: firstModel.id,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({ ok: false, message: String((error && error.message) || error) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="provider-card">
      <div className="provider-head">
        <input
          className="input provider-name"
          value={provider.name}
          onChange={(e) => patch((p) => { p.name = e.target.value; })}
        />
        <button
          className={`btn btn-danger btn-sm ${confirmingDelete ? "btn-danger-solid" : ""}`}
          onClick={handleDelete}
        >
          {confirmingDelete ? "确认删除？" : "删除"}
        </button>
      </div>

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
              onClick={() => patch((p) => { p.models.splice(index, 1); })}
            >
              移除
            </button>
          </div>
        ))}
        <button
          className="btn btn-sm"
          onClick={() => patch((p) => { p.models.push({ id: "", supportsReasoning: false }); })}
        >
          + 添加模型
        </button>
      </div>

      <div className="provider-actions">
        <button className="btn" disabled={testing} onClick={runTest}>
          {testing ? "测试中…" : "测试连接"}
        </button>
        {testResult && (
          <span className={testResult.ok ? "test-ok" : "test-fail"}>
            {testResult.ok ? "✓ 连接成功" : `✗ ${testResult.message || "连接失败"}`}
          </span>
        )}
      </div>
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
          {(!model || !model.supportsReasoning) ? (
            <span className="field-hint">当前模型未标记支持推理</span>
          ) : (
            <span className="field-hint">Qwen 系发送 enable_thinking，智谱发送 thinking 开关，其他发送 reasoning_effort</span>
          )}
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
        </div>
      </Section>

      <Section title="AI 服务提供商">
        {config.providers.length === 0 && (
          <p className="field-hint">尚未添加提供商。从下方预设中选择添加，然后填入 API Key。</p>
        )}
        {config.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
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
      </Section>

      <Section title="模型路由">
        <RouteEditor kind="translate" title="翻译（句子/段落）" />
        <RouteEditor kind="lookup" title="AI 解释（单词卡切换）" />
      </Section>

      <Section title="Prompt 模板">
        <PromptEditor promptKey="translate" title="翻译 Prompt" />
        <PromptEditor promptKey="explain" title="AI 解释 Prompt" />
      </Section>
    </div>
  );
}

export default SettingsPage;
