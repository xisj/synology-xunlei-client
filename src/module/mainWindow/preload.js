const {ipcRenderer, clipboard} = window.require('electron')

// 记录右键时提取到的文件名（用于在菜单点击时识别是哪个文件）
let lastContextFileName = null

// 监听来自页面的速度更新消息
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'speed-update') {
        console.log('[SPEED] Received speed:', e.data.speed)
        ipcRenderer.send('mainWindow-msg', {
            action: 'speed-update',
            data: { speed: e.data.speed }
        })
    }
})

// 从右键事件的 target 向上查找，提取文件名
// 优先策略：找带 title 属性的元素（迅雷通常用 title 显示完整文件名）
function extractFileNameFromTarget(target) {
    if (!target) return null
    let node = target
    let depth = 0
    // 向上最多查找 15 层
    while (node && node !== document.body && depth < 15) {
        // 1. 优先看自身是否有 title 属性
        if (node.getAttribute && node.getAttribute('title')) {
            const t = node.getAttribute('title').trim()
            if (t.length > 0 && t.length < 500) return t
        }
        // 2. 在自身及子树中找带 title 的元素
        if (node.querySelector) {
            const titled = node.querySelector('[title]')
            if (titled) {
                const t = titled.getAttribute('title').trim()
                if (t.length > 0 && t.length < 500) return t
            }
        }
        node = node.parentElement
        depth++
    }
    // 兜底：从最近的"行"中提取最长文本
    node = target
    depth = 0
    while (node && node !== document.body && depth < 8) {
        // 找一个像"行"的容器：有多个兄弟节点
        if (node.parentElement && node.parentElement.children.length > 1) {
            const candidates = node.querySelectorAll ? node.querySelectorAll('*') : []
            let maxLen = 0
            let best = null
            for (const c of candidates) {
                if (c.children.length === 0) {
                    const t = (c.textContent || '').trim()
                    if (t.length > maxLen && t.length < 500) {
                        maxLen = t.length
                        best = t
                    }
                }
            }
            if (best) return best
        }
        node = node.parentElement
        depth++
    }
    return null
}

// 抓包：hook fetch 和 XMLHttpRequest，打印迅雷接口的 URL 和响应体，用于定位下载速度字段
function sniffSpeedApi() {
    console.log('[SNIFF] Starting speed api sniffer...')

    // 先宽松过滤：所有 cgi 相关请求都抓，避免漏掉
    const isInteresting = (url) => {
        if (!url) return false
        const u = String(url)
        return u.indexOf('cgi') > -1 || u.indexOf('api') > -1 || u.indexOf('xunlei') > -1
    }

    // 在响应文本里粗略查找速度相关字段，命中则高亮标记
    const markSpeed = (text) => {
        if (typeof text !== 'string') return false
        return /speed|"dl"|downloadSpeed|"rate"|bytes|B\/s/i.test(text)
    }

    const report = (label, url, body) => {
        let snippet = body
        if (typeof snippet === 'string' && snippet.length > 2000) {
            snippet = snippet.substring(0, 2000) + '...[truncated]'
        }
        const hasSpeed = markSpeed(body)
        console.log(`[SNIFF ${label}]${hasSpeed ? '[SPEED?]' : ''} url=${url}`)
        console.log(`[SNIFF ${label}] body=`, snippet)
        ipcRenderer.send('mainWindow-msg', {
            action: 'sniff-api',
            data: { label, url, hasSpeed, body: snippet }
        })
    }

    // hook fetch
    const originalFetch = window.fetch
    if (originalFetch) {
        console.log('[SNIFF] fetch hook installed')
        window.fetch = function (...args) {
            const url = args[0] && args[0].url ? args[0].url : args[0]
            return originalFetch.apply(this, args).then((resp) => {
                if (isInteresting(url)) {
                    // clone 后读取，避免消费掉原始响应流
                    resp.clone().text().then((text) => {
                        report('fetch', url, text)
                    }).catch((e) => {
                        console.log('[SNIFF] fetch read error:', e)
                    })
                }
                return resp
            })
        }
    } else {
        console.log('[SNIFF] fetch not available')
    }

    // hook XMLHttpRequest
    const OriginalXHR = window.XMLHttpRequest
    if (OriginalXHR) {
        console.log('[SNIFF] XHR hook installed')
        const open = OriginalXHR.prototype.open
        const send = OriginalXHR.prototype.send
        OriginalXHR.prototype.open = function (method, url) {
            this.__sniffUrl = url
            return open.apply(this, arguments)
        }
        OriginalXHR.prototype.send = function (...sendArgs) {
            this.addEventListener('load', function () {
                if (isInteresting(this.__sniffUrl)) {
                    let text = ''
                    try {
                        text = this.responseType === '' || this.responseType === 'text'
                            ? this.responseText
                            : JSON.stringify(this.response)
                    } catch (_) {
                        text = '[unreadable response]'
                    }
                    report('xhr', this.__sniffUrl, text)
                }
            })
            return send.apply(this, sendArgs)
        }
    } else {
        console.log('[SNIFF] XHR not available')
    }

    console.log('[SNIFF] speed api sniffer installed')
}

window.onload = function () {
    setInterval(() => {
        const statusBar = document.querySelector('.switch__status')
        // 容器存在且按钮不存在时才注入（切换菜单后容器会被重新渲染，需重新注入）
        if (statusBar !== null && document.querySelector('#nas-xunlei-openfolder-btn') === null) {
            statusBar.appendChild(parseElement('<div class="switch_item" style="margin-left: 50px" id="nas-xunlei-openfolder-btn"><button style="display: flex; align-items: center; gap: 4px; padding: 4px 10px; background: #409eff; border: none; border-radius: 4px; color: white; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.3s ease;" onmouseover="this.style.background=\'#66b1ff\'" onmouseout="this.style.background=\'#409eff\'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H12L10 5H5C3.89543 5 3 5.89543 3 7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>打开下载文件夹</span></button></div>'))
            document.querySelector('#nas-xunlei-openfolder-btn').addEventListener('click', () => {
                ipcRenderer.send('mainWindow-msg', {
                    action: "open-shared-path"
                })
            })
        }
    }, 1000)
    watchDesktop()
    injectContextMenuHandler()
    sniffSpeedApi()
}

// 在网页自定义的右键菜单上追加 "打开文件夹" 选项
function injectContextMenuHandler() {
    // 捕获右键事件，从 e.target 向上提取文件名
    document.addEventListener('contextmenu', (e) => {
        lastContextFileName = extractFileNameFromTarget(e.target)
        console.log('contextmenu fileName captured:', lastContextFileName)
    }, true)

    // 使用 MutationObserver 监听菜单出现
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue
                // 在新插入的节点（及其子树）中查找"查看文件位置"项
                tryAppendOpenFolderItem(node)
            }
        }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    console.log('context menu observer started')
}

// 找到 "查看文件位置" 菜单项并在其后追加 "打开文件夹"
function tryAppendOpenFolderItem(rootNode) {
    // 查找所有可能的菜单项（通过文本匹配）
    const allElements = rootNode.querySelectorAll
        ? rootNode.querySelectorAll('*')
        : []

    let viewLocationItem = null
    for (const el of allElements) {
        // 只考虑叶子节点或文本节点容器（避免误匹配父容器）
        const text = (el.textContent || '').trim()
        if (text === '查看文件位置' && el.children.length === 0) {
            viewLocationItem = el
            break
        }
    }

    // 如果根节点本身就是"查看文件位置"
    if (!viewLocationItem && rootNode.nodeType === 1) {
        const text = (rootNode.textContent || '').trim()
        if (text === '查看文件位置') {
            viewLocationItem = rootNode
        }
    }

    if (!viewLocationItem) return

    // 找到承载该项的真正菜单项容器：向上查找直到找到与"重命名"等其他菜单项是兄弟关系的层级
    // 策略：先找到菜单容器（包含多个菜单项的父），再回到第一层子（即真正的菜单项）
    let menuItem = viewLocationItem
    let menuContainer = null
    
    // 向上查找包含多个兄弟项的容器（即菜单容器）
    let probe = viewLocationItem
    while (probe && probe.parentElement) {
        const parent = probe.parentElement
        // 如果父容器有多个子元素，且其中一个子元素的文本包含"重命名"或"删除任务"等，说明这是菜单容器
        if (parent.children.length > 1) {
            const siblingTexts = Array.from(parent.children).map(c => (c.textContent || '').trim())
            const hasMenuSiblings = siblingTexts.some(t => 
                t === '重命名' || t === '删除任务' || t === '复制链接' || t === '重新下载' || t === '任务详情页'
            )
            if (hasMenuSiblings) {
                menuContainer = parent
                menuItem = probe  // probe 此时就是真正的菜单项
                break
            }
        }
        probe = parent
    }
    
    // 如果没找到，说明 DOM 结构不同，把信息发回主进程让我们调试
    if (!menuContainer) {
        console.log('菜单容器未找到，输出DOM结构供调试')
        const debugInfo = []
        let p = viewLocationItem
        let depth = 0
        while (p && depth < 10) {
            debugInfo.push({
                depth,
                tag: p.tagName,
                class: p.className,
                childCount: p.children ? p.children.length : 0,
                outerHTMLSnippet: (p.outerHTML || '').substring(0, 500)
            })
            p = p.parentElement
            depth++
        }
        ipcRenderer.send('mainWindow-msg', {
            action: 'debug-menu-dom',
            data: { info: debugInfo }
        })
        return
    }
    
    console.log('found menu container:', menuContainer, 'menuItem:', menuItem)

    // 防止重复添加
    if (menuContainer.querySelector('.nas-xunlei-open-folder-item')) {
        return
    }

    // 克隆该菜单项作为新项，完全复用其样式（包括布局）
    const newItem = menuItem.cloneNode(true)
    newItem.classList.add('nas-xunlei-open-folder-item')
    // 替换文本
    const textEls = newItem.querySelectorAll('*')
    let textReplaced = false
    for (const el of textEls) {
        if (el.children.length === 0 && (el.textContent || '').trim() === '查看文件位置') {
            el.textContent = '打开文件夹'
            textReplaced = true
            break
        }
    }
    if (!textReplaced) {
        newItem.textContent = '打开文件夹'
    }

    // 绑定点击事件
    newItem.addEventListener('click', (e) => {
        e.stopPropagation()
        e.preventDefault()
        console.log('open-folder clicked, fileName:', lastContextFileName)

        ipcRenderer.send('mainWindow-msg', {
            action: 'open-file-folder',
            data: { fileName: lastContextFileName }
        })

        // 关闭菜单
        document.body.click()
    }, true)

    // 插入到 "查看文件位置" 这一项后面
    if (menuItem.nextSibling) {
        menuContainer.insertBefore(newItem, menuItem.nextSibling)
    } else {
        menuContainer.appendChild(newItem)
    }
    console.log('「打开文件夹」 menu item appended')
}

function parseElement(htmlString) {
    return new DOMParser().parseFromString(htmlString, 'text/html').body.childNodes[0]
}

function watchDesktop() {

    let _id = setInterval(()=>{
        let _a = document.getElementById("sds-desktop");
        if (_a) {
            ipcRenderer.send('mainWindow-msg', {
                action: "desktop-ready"
            })
            clearInterval(_id)
        }

        if(window.location.href.indexOf("pan-xunlei-com") > 3) {
            ipcRenderer.send('mainWindow-msg', {
                action: "xunlei-ready"
            })
            clearInterval(_id)
        }

    },1000)
}

function addXunleiTask(_url) {
    if(null !== document.querySelector('.create__task')) {

    }
}