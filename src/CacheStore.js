// CacheStore.js —— 查词 / AI 翻译 结果缓存（LRU，持久化到 documentPath JSON）
// 需求：查询相同单词或翻译相同句子时直接调用缓存，无需重复请求。
// 设计：
//   - 查词缓存（kind="lookup"）与 AI 翻译缓存（kind="translate"）相互独立，
//     容量分别取自配置 lookupCacheSize / translateCacheSize，设为 0 表示不使用缓存。
//   - 缓存键由调用方构造：查词键含服务商前缀（不同查词服务查同一单词不互用缓存，
//     AI 解释键还含提供商与模型）；翻译键含提供商与模型。
//   - 「重新生成」时调用方传 bypassCache 跳过读取；新结果仍会写入缓存（覆盖旧值）。
//   - 持久化（2026-08-27）：{max, map, order} 整体写入 cache-<kind>.json，
//     插件重启后恢复——历史记录跨重启保留（此前为内存态，重启即清空，
//     用户设置容量 50 但重启后只剩重启后查过的几条，被误认为 bug）。
//     容量为 0（关闭缓存）时不落盘；调整容量时保留条目并按新容量逐出。

var MNIATCache = (function () {
  var ADDON_DIR_NAME = "whc-instant-ai-translator";

  function createLRU(maxSize) {
    return {
      max: Math.max(0, maxSize || 0),
      map: {},   // key -> value
      order: []  // 最近使用（尾部）到最久未用（头部）
    };
  }

  function touch(cache, key) {
    var idx = cache.order.indexOf(key);
    if (idx >= 0) cache.order.splice(idx, 1);
    cache.order.push(key);
  }

  // 超出容量时逐出最久未用的条目
  function evict(cache) {
    while (cache.order.length > cache.max) {
      var oldest = cache.order.shift();
      delete cache.map[oldest];
    }
  }

  var lookupCache = null;
  var translateCache = null;

  function cacheOf(kind) {
    return kind === "translate" ? translateCache : lookupCache;
  }

  // ---------- 持久化 ----------

  function cachePath(kind) {
    return Application.sharedInstance().documentPath + "/" + ADDON_DIR_NAME + "/cache-" + kind + ".json";
  }

  function saveCache(kind) {
    var c = cacheOf(kind);
    if (!c || c.max <= 0) return; // 容量为 0 = 不使用缓存，也不落盘
    try {
      var data = NSJSONSerialization.dataWithJSONObjectOptions(
        { max: c.max, map: c.map, order: c.order }, 1);
      data.writeToFileAtomically(cachePath(kind), true);
    } catch (e) {
      console.log("[MNIATCache] save error: " + e);
    }
  }

  // 从磁盘恢复：order 由旧到新 push 重建，逐出超量条目；文件缺失/非法时返回空缓存
  function loadCache(kind, maxSize) {
    var cache = createLRU(maxSize);
    try {
      var fm = NSFileManager.defaultManager();
      var path = cachePath(kind);
      if (fm.fileExistsAtPath(path)) {
        var data = NSData.dataWithContentsOfFile(path);
        if (data && data.length() > 0) {
          var obj = NSJSONSerialization.JSONObjectWithDataOptions(data, 1);
          if (obj && obj.map && Array.isArray(obj.order)) {
            for (var i = 0; i < obj.order.length; i++) {
              var key = obj.order[i];
              if (typeof key === "string" && Object.prototype.hasOwnProperty.call(obj.map, key)) {
                cache.map[key] = obj.map[key];
                cache.order.push(key);
              }
            }
            evict(cache);
          }
        }
      }
    } catch (e) {
      console.log("[MNIATCache] load error: " + e);
    }
    return cache;
  }

  // 容量调整：按原使用顺序（旧→新）迁移条目到新 LRU，超新容量逐出（不清空历史）
  function rebuildWithMax(oldCache, newMax) {
    var next = createLRU(newMax);
    for (var i = 0; i < oldCache.order.length; i++) {
      var key = oldCache.order[i];
      if (Object.prototype.hasOwnProperty.call(oldCache.map, key)) {
        next.map[key] = oldCache.map[key];
        next.order.push(key);
      }
    }
    evict(next);
    return next;
  }

  // 读取最新配置的容量；首次访问从磁盘恢复，容量变化时保留条目并按新容量逐出
  function ensureCaches() {
    var cfg = MNIATSettings.load();
    var l = parseInt(cfg.lookupCacheSize, 10);
    if (isNaN(l) || l < 0) l = 0;
    var t = parseInt(cfg.translateCacheSize, 10);
    if (isNaN(t) || t < 0) t = 0;
    if (!lookupCache) {
      lookupCache = loadCache("lookup", l);
    } else if (lookupCache.max !== l) {
      lookupCache = rebuildWithMax(lookupCache, l);
      saveCache("lookup");
    }
    if (!translateCache) {
      translateCache = loadCache("translate", t);
    } else if (translateCache.max !== t) {
      translateCache = rebuildWithMax(translateCache, t);
      saveCache("translate");
    }
  }

  return {
    // kind: "lookup" | "translate"；命中返回缓存值（对象），未命中或容量为 0 返回 null
    get: function (kind, key) {
      ensureCaches();
      var c = cacheOf(kind);
      if (!c || c.max <= 0) return null;
      if (Object.prototype.hasOwnProperty.call(c.map, key)) {
        touch(c, key);
        return c.map[key];
      }
      return null;
    },

    put: function (kind, key, value) {
      ensureCaches();
      var c = cacheOf(kind);
      if (!c || c.max <= 0) return;
      if (Object.prototype.hasOwnProperty.call(c.map, key)) {
        c.map[key] = value;
        touch(c, key);
      } else {
        c.map[key] = value;
        c.order.push(key);
        evict(c);
      }
      saveCache(kind);
    },

    clear: function (kind) {
      if (kind === "translate") {
        translateCache = createLRU(0);
      } else {
        lookupCache = createLRU(0);
      }
      ensureCaches();
      // ensureCaches 会按配置容量重建（空缓存），此处再落盘覆盖旧文件
      saveCache(kind);
    },

    // 返回缓存全部条目（[{key, value}]，最近使用在前），供历史记录展示；
    // 容量为 0（未启用缓存）时返回空数组。
    entries: function (kind) {
      ensureCaches();
      var c = cacheOf(kind);
      if (!c || c.max <= 0) return [];
      var list = [];
      for (var i = c.order.length - 1; i >= 0; i--) {
        var key = c.order[i];
        if (Object.prototype.hasOwnProperty.call(c.map, key)) {
          list.push({ key: key, value: c.map[key] });
        }
      }
      return list;
    }
  };
})();
