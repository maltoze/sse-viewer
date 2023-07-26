let esUrl
let attachedTabId
let attachedSwId
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
    chrome.debugger.detach({ tabId: attachedTabId })
    attachedSwId && chrome.debugger.detach({ targetId: attachedSwId })
    attached = false
    chrome.action.setIcon({
      tabId: attachedTabId,
      path: 'assets/icon-gray.png',
    })
  } else {
    if (tab.url.startsWith('http')) {
      chrome.debugger.attach({ tabId: tab.id }, '1.2', async function () {
        attachedTabId = tab.id
        attached = true
        sendCommand({ tabId: attachedTabId }, 'Fetch.enable', {
          patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
        })
        chrome.action.setIcon({
          tabId: attachedTabId,
          path: 'assets/icon.png',
        })
        const targets = await chrome.debugger.getTargets()
        const tabUrl = new URL(tab.url)
        const swTarget = targets.find(
          (target) =>
            target.url.startsWith(tabUrl.origin) && target.type === 'worker'
        )
        if (swTarget) {
          // attach to service worker
          chrome.debugger.attach(
            { targetId: swTarget.id },
            '1.2',
            async function () {
              attachedSwId = swTarget.id
              sendCommand({ targetId: swTarget.id }, 'Fetch.enable', {
                patterns: [
                  { requestStage: 'Request' },
                  { requestStage: 'Response' },
                ],
              })
            }
          )
        }
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
          { name: 'Date', value: new Date().toUTCString() },
        ],
        body: bodyQueue.shift(),
      })
    } else {
      const accept =
        params.request.headers.accept || params.request.headers.Accept || ''
      if (accept.includes('text/event-stream')) {
        esUrl = `${esPathPrefix}${reqUrl.pathname}`
        if (params.responseHeaders) {
          const resp = await sendCommand(source, 'Fetch.getResponseBody', {
            requestId: params.requestId,
          })
          bodyQueue.push(resp.body)
          chrome.tabs.sendMessage(attachedTabId, { type: 'create', url: esUrl })
        }
      }
      sendCommand(source, 'Fetch.continueRequest', {
        requestId: params.requestId,
      })
    }
  }
})
