// network.js —— 网络封装（MNNetwork.fetch）
// 来源：mn-docs「网络请求」教程封装（Response#text 依赖 MNIATBase64/MNIATUTF8）
// 说明：流式（NSURLConnection delegate 分块）在本环境实测不可用（回调不触发且卡死），
//       已整体移除，仅保留一次性请求通道。

function MNIATResponse(data, nsResponse) {
  this.data = data;
  this.nsResponse = nsResponse;
  this.status = nsResponse ? nsResponse.statusCode() : 0;
}

MNIATResponse.isNil = function (obj) {
  return obj === null || typeof obj === "undefined" || obj instanceof NSNull;
};

MNIATResponse.prototype.text = function () {
  if (MNIATResponse.isNil(this.data) || this.data.length() === 0) return "";
  return MNIATUTF8.decode(MNIATBase64.decode(this.data.base64Encoding()));
};

MNIATResponse.prototype.json = function () {
  if (MNIATResponse.isNil(this.data) || this.data.length() === 0) return {};
  try {
    return NSJSONSerialization.JSONObjectWithDataOptions(this.data, 1);
  } catch (e) {
    return null;
  }
};

var MNNetwork = {
  isNil: function (obj) {
    return obj === null || typeof obj === "undefined" || obj instanceof NSNull;
  },

  buildRequest: function (url, options) {
    var fullUrl = String(url).trim();
    if (fullUrl.indexOf("://") === -1) fullUrl = "https://" + fullUrl;

    var request = NSMutableURLRequest.requestWithURL(NSURL.URLWithString(fullUrl));
    request.setHTTPMethod(options.method || "GET");
    request.setTimeoutInterval(options.timeout || 30);

    var headers = {
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)",
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    if (options.headers) {
      for (var k in options.headers) headers[k] = options.headers[k];
    }
    request.setAllHTTPHeaderFields(headers);

    if (options.json) {
      request.setHTTPBody(NSJSONSerialization.dataWithJSONObjectOptions(options.json, 1));
    } else if (options.body) {
      request.setHTTPBody(NSData.dataWithStringEncoding(String(options.body), 4));
    }

    if (options.search) {
      var components = NSURLComponents.componentsWithString(fullUrl);
      var qs = Object.keys(options.search).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(options.search[k]);
      }).join("&");
      components.query = qs;
      request.setURL(components.URL());
    }

    return request;
  },

  fetch: function (url, options) {
    var req = this.buildRequest(url, options || {});
    return new Promise(function (resolve, reject) {
      NSURLConnection.sendAsynchronousRequestQueueCompletionHandler(
        req,
        NSOperationQueue.mainQueue(),
        function (res, data, err) {
          if (!MNNetwork.isNil(err)) {
            reject(String(err.localizedDescription));
          } else {
            resolve(new MNIATResponse(data, res));
          }
        }
      );
    });
  }
};
