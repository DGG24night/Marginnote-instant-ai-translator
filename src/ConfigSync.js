// ConfigSync.js —— 配置导出/导入（多设备同步）
// 交换格式：config.json 的完整 JSON 文本（含 providers/apiKey/prompts/routing 等全部字段）。
// 导出（两种方式，均含 API Key，用户确认自家设备同步最省事）：
//   a) 文件方式：配置 JSON 写入 tempPath 临时文件 →
//      Application.saveFileWithUti 弹出系统保存面板，用户选择位置保存（推荐，可留档）；
//   b) 剪贴板方式：UIPasteboard 写入系统剪贴板（跨设备快速粘贴，2026-08-11 应前端要求加回）。
// 导入（两种方式）：
//   a) 文件方式：Application.openFileWithUTIs 弹出文件选择器 → block 回调拿路径 → 读取文本导入；
//   b) 粘贴方式：用户粘贴 JSON 文本导入（作为文件选择器不可用时的兜底）。
// 导入处理：JSON 解析 → 结构校验（withDefaults 归一化）→ 整体覆盖写入 config.json。
//   2026-08-10 已移除自动备份 config.backup.json（备份文件难找）；留底改由用户在弹窗内先导出。
// 安全约定：导出含 API Key；导入整体覆盖（前端弹窗二次确认）。

var MNIATConfigSync = (function () {
  var ADDON_DIR_NAME = "whc-instant-ai-translator";
  var JSON_UTI = "public.json";

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  // 导出文件名自带时间戳（年月日 + 时分秒，本地时区），避免重复导出覆盖
  // 例：IAT-20260810-193244.json（冒号不合法用 - 分隔；IAT = Instant AI Translator）
  function exportFileName() {
    var d = new Date();
    return "IAT-" +
      d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "-" +
      pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + ".json";
  }

  function configDir() {
    return Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME;
  }

  function configPath() {
    return configDir() + "/config.json";
  }

  function ensureDir(dir) {
    var fm = NSFileManager.defaultManager();
    if (!fm.fileExistsAtPath(dir)) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributes(dir, true, null);
    }
  }

  // 写文本文件（UTF-8 编码 4），返回是否成功
  function writeTextFile(path, text) {
    try {
      var textData = NSData.dataWithStringEncoding(text, 4);
      return textData.writeToFileAtomically(path, true);
    } catch (e) {
      console.log("[MNIATConfigSync] write failed: " + e);
      return false;
    }
  }

  // 读文本文件；空文件或失败返回 null
  // 注意：JSCore 无「NSData→字符串」API（mn-docs「网络请求」文档确认），
  // 必须走 data.base64Encoding() + Base64/UTF8 解码（与 network.js 的 text() 一致），
  // 不能用 NSString.stringWithContentsOfData（该桥接在插件环境不可靠）。
  function readTextFile(path) {
    try {
      var data = NSData.dataWithContentsOfFile(path);
      if (!data || data.length() === 0) return null;
      return MNIATUTF8.decode(MNIATBase64.decode(data.base64Encoding()));
    } catch (e) {
      console.log("[MNIATConfigSync] read failed: " + e);
      return null;
    }
  }

  // 导出为配置文件：写临时文件 + 弹系统保存面板。
  // saveFileWithUti 无回调（用户选完即完成），返回 { ok, bytes, fileName }。
  function exportConfig() {
    var config = MNIATSettings.load();
    var text = JSON.stringify(config, null, 2);

    var app = Application.sharedInstance();
    var dir = app.tempPath + "/" + ADDON_DIR_NAME;
    ensureDir(dir);
    var fileName = exportFileName();
    var filePath = dir + "/" + fileName;
    if (!writeTextFile(filePath, text)) {
      return { ok: false, error: "写入临时配置文件失败" };
    }
    app.saveFileWithUti(filePath, JSON_UTI);
    return { ok: true, bytes: text.length, fileName: fileName };
  }

  // 导出到系统剪贴板：配置 JSON 文本写入 UIPasteboard（不弹任何面板，粘贴即用）。
  // 返回 { ok, bytes }；剪贴板不可用时返回错误。
  function exportConfigToClipboard() {
    var config = MNIATSettings.load();
    var text = JSON.stringify(config, null, 2);
    try {
      var pb = UIPasteboard.generalPasteboard();
      if (pb && typeof pb.setString === "function") {
        pb.setString(text);
      } else if (pb) {
        pb.string = text;
      } else {
        return { ok: false, error: "系统剪贴板不可用" };
      }
      return { ok: true, bytes: text.length };
    } catch (e) {
      console.log("[MNIATConfigSync] clipboard write failed: " + e);
      return { ok: false, error: "写入剪贴板失败：" + String(e) };
    }
  }

  // 解析并校验导入文本
  function parseImport(text) {
    if (!text || typeof text !== "string") return { ok: false, error: "没有可导入的内容" };
    var trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "没有可导入的内容" };

    var parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return { ok: false, error: "不是有效的 JSON：请确认选择/复制的是完整的导出内容" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "导入内容不是配置对象" };
    }
    // withDefaults 归一化：用默认值补齐所有缺字段，保证后续写入结构安全
    var normalized = MNIATSettings.normalize(parsed);
    return { ok: true, config: normalized };
  }

  // 粘贴方式导入（文本）：返回 { ok, providers, hasPrompts, error? }
  function importConfig(text) {
    var result = parseImport(text);
    if (!result.ok) return { ok: false, error: result.error };

    var saved = MNIATSettings.save(result.config);
    if (!saved) {
      return { ok: false, error: "写入配置失败，请查看日志" };
    }

    var providers = Array.isArray(result.config.providers) ? result.config.providers.length : 0;
    var hasPrompts = !!(result.config.prompts && (
      result.config.prompts.translate || result.config.prompts.explain
    ));
    return { ok: true, providers: providers, hasPrompts: hasPrompts };
  }

  // 文件方式导入：弹系统文件选择器（openFileWithUTIs），选中后读取并导入。
  // openFileWithUTIs 的 block 回调参数文档未明确，这里兼容字符串路径 / {path} / {absoluteString} 等形态。
  // 用户取消时 block 不回调，用 60s 定时器兜底返回（避免前端一直等待）。
  function importConfigFromFile(context) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = NSTimer.scheduledTimerWithTimeInterval(60, false, function () {
        if (!done) {
          done = true;
          resolve({ ok: false, error: "未选择文件（已超时取消）" });
        }
      });

      var block = function (fileInfo) {
        if (done) return;
        done = true;
        timer.invalidate();

        var path = null;
        if (typeof fileInfo === "string") {
          path = fileInfo;
        } else if (fileInfo && typeof fileInfo === "object") {
          path = fileInfo.path || fileInfo.absoluteString || fileInfo.fileURL || null;
        }
        if (!path || typeof path !== "string" || !path.trim()) {
          resolve({ ok: false, error: "未能获取所选文件路径" });
          return;
        }
        var text = readTextFile(path);
        if (text === null) {
          resolve({ ok: false, error: "无法读取所选文件（可能为空或不是文本）" });
          return;
        }
        resolve(importConfig(text));
      };

      try {
        Application.sharedInstance().openFileWithUTIs([JSON_UTI], context.controller, block);
      } catch (e) {
        if (!done) {
          done = true;
          timer.invalidate();
          resolve({ ok: false, error: "无法打开文件选择器：" + String(e) });
        }
      }
    });
  }

  return {
    exportConfig: exportConfig,
    exportConfigToClipboard: exportConfigToClipboard,
    importConfig: importConfig,
    importConfigFromFile: importConfigFromFile
  };
})();
