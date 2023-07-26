let esUrl = null
let attachedTabId = null
let attachedSwId = null
let sseRequestId = null
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

function enableAction(tabId) {
  chrome.action.setIcon({ tabId, path: 'assets/icon.png' })
}

function disableAction(tabId) {
  chrome.action.setIcon({ tabId, path: 'assets/icon-gray.png' })
}

chrome.action.onClicked.addListener(async function (tab) {
  if (attachedTabId) {
    disableAction(attachedTabId)
    chrome.debugger.detach({ tabId: attachedTabId })
    attachedSwId && chrome.debugger.detach({ targetId: attachedSwId })
    attachedTabId = null
    attachedSwId = null
  } else {
    if (tab.url.startsWith('http')) {
      chrome.debugger.attach({ tabId: tab.id }, '1.2', async function () {
        attachedTabId = tab.id
        enableAction(tab.id)
        sendCommand({ tabId: tab.id }, 'Fetch.enable', {
          patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
        })
        sendCommand({ tabId: tab.id }, 'Network.enable', {})
        const targets = await chrome.debugger.getTargets()
        const tabUrl = new URL(tab.url)
        const swTarget = targets.find(
          (target) =>
            target.url.startsWith(tabUrl.origin) && target.type === 'worker',
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
              sendCommand({ targetId: swTarget.id }, 'Network.enable', {})
            },
          )
        }
      })
    } else {
      console.log('Debugger can only be attached to HTTP/HTTPS pages.')
    }
  }
})

chrome.debugger.onDetach.addListener(function (_source, _reason) {
  attachedTabId && disableAction(attachedTabId)
  attachedTabId = null
  attachedSwId = null
})

chrome.debugger.onEvent.addListener(async function (source, method, params) {
  if (!attachedTabId) return

  if (method === 'Network.loadingFinished') {
    if (params.requestId === sseRequestId) {
      const resp = await sendCommand(source, 'Network.getResponseBody', {
        requestId: params.requestId,
      })
      bodyQueue.push(btoa(resp.body))
      chrome.tabs.sendMessage(attachedTabId, { type: 'create', url: esUrl })
    }
  }

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
        sseRequestId = params.networkId
        // if (params.responseHeaders) {
        //   const resp = await sendCommand(source, 'Fetch.getResponseBody', {
        //     requestId: params.requestId,
        //   })
        //   bodyQueue.push(resp.body)
        //   chrome.tabs.sendMessage(attachedTabId, { type: 'create', url: esUrl })
        // }
      }
      sendCommand(source, 'Fetch.continueRequest', {
        requestId: params.requestId,
      })
    }
  }
})
