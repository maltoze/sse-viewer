chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  const es = new EventSource(request.url)
  es.onerror = function (ev) {
    es.close()
  }
})
