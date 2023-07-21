let esUrl
let sseRequestId
let attachedTabId
let attached = false
const esPathPrefix = '/__maltoze-sse-viewer'
const bodyQueue = []

function sendCommand(target, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, function (result) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve(result)
      }
    })
  })
}

chrome.action.onClicked.addListener(async function (tab) {
  if (attached) {
    await chrome.debugger.detach({ tabId: attachedTabId })
    attached = false
    chrome.action.setIcon({
      tabId: attachedTabId,
      path: 'assets/icon-gray.png',
    })
  } else {
    if (tab.url.startsWith('http')) {
      chrome.debugger.attach({ tabId: tab.id }, '1.2', function () {
        attachedTabId = tab.id
        attached = true
        sendCommand({ tabId: attachedTabId }, 'Fetch.enable', {
          patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
        })
        chrome.action.setIcon({
          tabId: attachedTabId,
          path: 'assets/icon.png',
        })
      })
    } else {
      console.log('Debugger can only be attached to HTTP/HTTPS pages.')
    }
  }
})

chrome.debugger.onDetach.addListener(function (source, reason) {
  attached = false
  chrome.action.setIcon({ tabId: attachedTabId, path: 'assets/icon-gray.png' })
})

chrome.debugger.onEvent.addListener(async function (source, method, params) {
  if (method === 'Fetch.requestPaused') {
    const reqUrl = new URL(params.request.url)
    if (reqUrl.pathname === esUrl) {
      await sendCommand(source, 'Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/event-stream' },
          { name: 'Cache-Control', value: 'no-cache' },
        ],
        body: bodyQueue.shift(),
      })
      chrome.tabs.sendMessage(attachedTabId, { type: 'close' })
    } else {
      if (params.request.headers.accept === 'text/event-stream') {
        sseRequestId = params.requestId
        esUrl = `${esPathPrefix}${reqUrl.pathname}`
        if (params.responseHeaders) {
          const resp = await sendCommand(source, 'Fetch.getResponseBody', {
            requestId: params.requestId,
          })
          bodyQueue.push(resp.body)
          chrome.tabs.sendMessage(attachedTabId, { type: 'create', url: esUrl })
        }
        sendCommand(source, 'Fetch.continueRequest', {
          requestId: params.requestId,
        })
      } else {
        sendCommand(source, 'Fetch.continueRequest', {
          requestId: params.requestId,
        })
      }
    }
  }
})
