let es

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  switch (request.type) {
    case 'close':
      es.close()
      break
    case 'create':
      es = new EventSource(request.url)
      break
    default:
      break
  }
})
