// CacheStore.js —— 查词 / AI 翻译 结果缓存（LRU，内存态）
// 需求：查询相同单词或翻译相同句子时直接调用缓存，无需重复请求。
// 设计：
//   - 查词缓存（kind="lookup"）与 AI 翻译缓存（kind="translate"）相互独立，
//     容量分别取自配置 lookupCacheSize / translateCacheSize，设为 0 表示不使用缓存。
//   - 缓存键由调用方构造：查词键含服务商前缀（不同查词服务查同一单词不互用缓存，
//     AI 解释键还含提供商与模型）；翻译键含提供商与模型。
//   - 「重新生成」时调用方传 bypassCache 跳过读取；新结果仍会写入缓存（覆盖旧值）。
//   - 缓存为内存态，插件重启即清空（结果类数据无需持久化）。

var MNIATCache = (function () {
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

  // 读取最新配置的容量；容量变化时重建缓存（清空旧缓存，容量缩小时避免膨胀）
  function ensureCaches() {
    var cfg = MNIATSettings.load();
    var l = parseInt(cfg.lookupCacheSize, 10);
    if (isNaN(l) || l < 0) l = 0;
    var t = parseInt(cfg.translateCacheSize, 10);
    if (isNaN(t) || t < 0) t = 0;
    if (!lookupCache || lookupCache.max !== l) lookupCache = createLRU(l);
    if (!translateCache || translateCache.max !== t) translateCache = createLRU(t);
  }

  function cacheOf(kind) {
    return kind === "translate" ? translateCache : lookupCache;
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
    },

    clear: function (kind) {
      if (kind === "translate") {
        translateCache = createLRU(0);
      } else {
        lookupCache = createLRU(0);
      }
      ensureCaches();
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
