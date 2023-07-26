chrome.runtime.onMessage.addListener(
  function (request, _sender, _sendResponse) {
    const es = new EventSource(request.url)
    es.onerror = function (_ev) {
      es.close()
    }
  },
)
