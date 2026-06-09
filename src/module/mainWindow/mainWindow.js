const {app, BrowserWindow, ipcMain, clipboard, session, dialog, shell} = require('electron')
const path = require('path')
const fs = require('fs')
const url = require('url')
const func = require('../../common/func')
require('../../common/global')
let psl = require('psl');
let win
// 使用getter确保外部模块拿到的总是最新的win引用
Object.defineProperty(module.exports, 'win', {
    get() { return win },
    enumerable: true
})

let xunleiPatch = "/webman/3rdparty/pan-xunlei-com/index.cgi/#/home"

let autoReloadTimer = null
let clipboardWatchTimer = null
let healthCheckTimer = null
let pendingTaskUrl = null  // 协议链接唤醒后待处理的任务URL
let lastHiddenAt = 0  // 窗口隐藏的时间戳，需要在模块级别定义以便addXunLeiTask访问
const STALE_THRESHOLD_MS = 2 * 60 * 1000  // 后台超过2分钟则视为过期
let currentSpeed = null  // 当前下载速度（字符串格式，如 "38224KB/s"）
let speedWindow = null  // 速度浮窗

// 注册浮窗点击事件监听器（只注册一次）
ipcMain.on('speed-window-click', () => {
    console.log('[SPEED WINDOW] Clicked, showing main window')
    show()
})

// 注册浮窗拖拽监听器（只注册一次）
// 使用 screen.getCursorScreenPoint()（DIP）+ 抓取偏移定位，避免高 DPI 缩放下窗口漂移
const SPEED_WINDOW_WIDTH = 170
const SPEED_WINDOW_HEIGHT = 52
let speedDragOffset = { x: 0, y: 0 }
ipcMain.on('speed-window-drag-start', () => {
    if (speedWindow && !speedWindow.isDestroyed()) {
        const { screen } = require('electron')
        const cursor = screen.getCursorScreenPoint()
        const [winX, winY] = speedWindow.getPosition()
        speedDragOffset = { x: winX - cursor.x, y: winY - cursor.y }
    }
})
ipcMain.on('speed-window-drag-move', () => {
    if (speedWindow && !speedWindow.isDestroyed()) {
        const { screen } = require('electron')
        const cursor = screen.getCursorScreenPoint()
        speedWindow.setBounds({
            x: cursor.x + speedDragOffset.x,
            y: cursor.y + speedDragOffset.y,
            width: SPEED_WINDOW_WIDTH,
            height: SPEED_WINDOW_HEIGHT
        })
    }
})

function getXunleiURL(_nasURL) {
    console.log("============================getXunleiURL", null != win, win.webContents.getURL())
    if (null != win
        && "" != win.webContents.getURL()) {

        let parsedUrl = new URL(win.webContents.getURL());
        return _nasURL = `${parsedUrl.protocol}//${parsedUrl.hostname}:${parsedUrl.port}` + xunleiPatch

    } else {

        let schema = ""
        if (_nasURL.indexOf('http://') > -1) {
            schema = "http://"
            _nasURL = _nasURL.replace("http://", "")
        }
        if (_nasURL.indexOf('https://') > -1) {
            schema = "https://"
            _nasURL = _nasURL.replace("https://", "")
        }
        _nasURL = _nasURL + xunleiPatch
        _nasURL = _nasURL.replace("//", "/")
        return schema + _nasURL
    }
}

module.exports.create = async function create(iconPath) {
    win = new BrowserWindow({
        width: 1070,
        height: 700,
        show: false,  // 先不显示窗口，等内容加载完再显示，避免闪烁
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'preload.js')
            // 保留后台节流以节省CPU/电量；通过下方的"按需刷新"机制解决冻结
        },
        icon: iconPath
    })
    // win.webContents.openDevTools()  // 临时打开 DevTools 查看速度提取日志
    
    // 内容准备好后再显示窗口，避免白屏/透明窗口闪烁
    win.once('ready-to-show', () => {
        console.log('ready-to-show: showing window')
        win.show()
    })
    if (global.config.hasOwnProperty('nasURL')) {
        let _xunleiURL = global.config.nasURL
        let canAutoLogin = await checkNasLoginStatus(global.config.nasURL).catch(e => {
            console.log(e)
        })
        if (canAutoLogin) {
            _xunleiURL = getXunleiURL(global.config.nasURL)
        }
        win.loadURL(_xunleiURL).then(r => {
            if (canAutoLogin) {
                watchClipboard()
            }
        }).catch(e => {
            console.log("loadURL,catch", e)
            // 避免因主动切换到本地设置页导致的 ERR_ABORTED 噪音
            if (!(e && e.code === 'ERR_ABORTED')) {
                loadDefaultHTML(20002, 'show-err', e.toString())
            }
        })
    } else {
        win.loadFile(path.join(__dirname, 'mainWindow.html'))
    }

    win.webContents.on('context-menu', (e, params) => {
        console.log('context-menu', "" !== clipboard.readText(), true === isInXunleiApp())
        if ("" !== clipboard.readText() && true === isInXunleiApp()) {
            addXunLeiTask(clipboard.readText())
        } else {
            console.log('context-menu: doCtrlV', clipboard.readText())
            doCtrlV(params.x, params.y)
        }
    })

    // win.webContents.on('did-fail-load', (e, errorCode, errorMsg, validateURL, isMainFrame) => {
    //     console.log("did-fail-load", errorCode, errorMsg, validateURL, isMainFrame)
    //     loadDefaultHTML(20001, 'show-err', "did-fail-load:" + errorMsg)
    // })
    win.webContents.on('did-finish-load', (e) => {
        console.log("did-finish-load", win.webContents.getURL(), win.webContents.getURL().indexOf('pan-xunlei-com'))
        // 如果有待处理的任务URL，页面加载完成后重新添加
        if (pendingTaskUrl) {
            console.log('Resuming pending task after page load:', pendingTaskUrl)
            const taskUrl = pendingTaskUrl
            pendingTaskUrl = null
            // 等待更长时间，让 Vue 应用完全初始化（特别是刚启动时）
            setTimeout(() => {
                addXunLeiTask(taskUrl)
            }, 2000)  // 延迟2秒确保 Vue 应用初始化完成
        }

        // 在迅雷页面注入抓包脚本
        if (win.webContents.getURL().indexOf('pan-xunlei-com') > 0) {
            setTimeout(() => {
                injectSpeedSniffer()
                // 创建速度浮窗
                createSpeedWindow()
            }, 2000)
        }
    })

    win.webContents.on('did-frame-finish-load', async (e, isMainFrame) => {
        console.log("did-frame-finish-load", isMainFrame)
    })
    win.webContents.on('dom-ready', (e) => {
        console.log("dom-ready")
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-stop-loading', (e) => {
        console.log("did-stop-loading")
        // console.log(win.webContents.getTitle(), win.webContents.getTitle().indexOf("Synology"),win.webContents.getTitle().indexOf("NAS"))
        // // checkNasLoginStatus(global.config.nasURL)
        // if(win.webContents.getTitle().indexOf("Synology")> 1 && win.webContents.getTitle().indexOf("NAS") > 3) {
        //
        // }
        setTimeout(() => {
            // if (win.webContents.getURL().indexOf('pan-xunlei-com') < 0) {
            //     win.webContents.loadURL(getXunleiURL(global.config.nasURL))
            // }
        }, 30000)

    })
    win.webContents.on('did-navigate', async (e, url, isMainFrame, httpResponseCode, httpStatusText) => {
        console.log("did-navigate", url, isMainFrame, httpResponseCode, httpStatusText, global.config.nasUR, await checkNasLoginStatus(global.config.nasURL))
        if ("undefined" === typeof (global.config.nasURL)) {
            console.log("nasURL is empty")
            return
        }
        if (global.config.nasURL.indexOf('http://') > -1) {
            _nasURL = global.config.nasURL.replace('http://', 'https://')
        }
        if (global.config.nasURL.toString().indexOf('https://') > -1) {
            _nasURL = global.config.nasURL.replace('https://', 'http://')
        }
        if (await checkNasLoginStatus(global.config.nasURL)
            && ((url === global.config.nasURL || url === global.config.nasURL + "/")
                || (url === _nasURL || url === _nasURL + "/"))) {
            _xunleiURL = getXunleiURL(global.config.nasURL)

            win.webContents.stop()
            win.webContents.loadURL(_xunleiURL)

        }
    })
    win.webContents.on('did-frame-navigate', async (e, url, httpResponseCode, httpStatusText, isMainFrame) => {
        console.log("did-frame-navigate", url, httpResponseCode, httpStatusText, isMainFrame, await checkNasLoginStatus(global.config.nasURL), (url === global.config.nasURL || url === global.config.nasURL + "/"))
        if (await checkNasLoginStatus(global.config.nasURL) && (url === global.config.nasURL || url === global.config.nasURL + "/")) {
            _xunleiURL = getXunleiURL(global.config.nasURL)
            win.webContents.loadURL(_xunleiURL)
        }
    })
    win.webContents.on('did-navigate-in-page', async (e, url, isMainFrame) => {
        console.log("did-navigate-in-page", url, isMainFrame, await checkNasLoginStatus(global.config.nasURL), (url === global.config.nasURL || url === global.config.nasURL + "/"))
        if (await checkNasLoginStatus(global.config.nasURL) && (url === global.config.nasURL || url === global.config.nasURL + "/")) {
            _xunleiURL = getXunleiURL(global.config.nasURL)
            win.webContents.loadURL(_xunleiURL)
        }
    })

    win.on('close', (e) => {
        // 如果已经在退出流程中，不再弹窗，让窗口正常关闭
        if (global.__isQuitting) return
        
        e.preventDefault()  // 总是阻止默认行为，手动控制退出流程
        
        var a = dialog.showMessageBoxSync(win, {
            type: "info",
            buttons: [global.lang.getLang('menu', 'doQuit'), global.lang.getLang('menu', 'minimize2tray')],
            title: global.lang.getLang('menu', 'caution'),
            message: global.lang.getLang('menu', 'areYouReallyWantQuit'),
            defaultId: 0,
            cancelId: 1
        })
        if (a === 1) {
            win.hide()
        } else {
            // 标记退出中，立即清理定时器
            global.__isQuitting = true
            console.log('User chose to quit')
            cleanupTimers()
            // 调用 app.quit() 会触发 before-quit，在那里统一清理
            app.quit()
        }
    })

    win.on('minimize', (e) => {
        e.preventDefault();
        win.hide();
    })

    // ============ 按需刷新机制：解决后台节流导致的页面冻结 ============
    // 思路：保留Electron默认的backgroundThrottling，节省后台CPU；
    //      但记录窗口进入后台的时间，用户回到窗口时若后台过久，则强制刷新页面

    const markHidden = () => {
        if (lastHiddenAt === 0) {
            lastHiddenAt = Date.now()
            console.log('window hidden/blurred at', new Date(lastHiddenAt).toISOString())
        }
    }
    const refreshIfStale = (reason) => {
        if (lastHiddenAt === 0) return
        const hiddenDuration = Date.now() - lastHiddenAt
        lastHiddenAt = 0
        console.log(`window active again (${reason}), hidden for ${hiddenDuration}ms`)
        if (hiddenDuration < STALE_THRESHOLD_MS) return
        if (!win || win.isDestroyed()) return
        const currentUrl = win.webContents.getURL()
        if (currentUrl.indexOf('pan-xunlei-com') < 0) return
        // 检查session是否还有效，再决定刷新还是跳到登录页
        checkNasLoginStatus(global.config.nasURL).then(isLoggedIn => {
            if (!win || win.isDestroyed()) return
            if (isLoggedIn) {
                console.log('stale page detected, reloading xunlei page')
                win.webContents.reload()
            } else {
                console.log('stale page + session expired, navigating to nas login')
                win.webContents.loadURL(global.config.nasURL)
            }
        }).catch(() => {
            try { win.webContents.reload() } catch (_) {}
        })
    }

    win.on('hide', markHidden)
    win.on('blur', markHidden)
    win.on('show', () => refreshIfStale('show'))
    win.on('focus', () => refreshIfStale('focus'))
    win.on('restore', () => refreshIfStale('restore'))

    autoReloadTimer = setInterval(() => {
        if (win && !win.isDestroyed()) {
            // 检查是否在迅雷页面
            const currentUrl = win.webContents.getURL()
            const isInXunlei = currentUrl.indexOf('pan-xunlei-com') > 0

            if (isInXunlei) {
                // 检查session是否过期
                checkNasLoginStatus(global.config.nasURL).then(isLoggedIn => {
                    if (!isLoggedIn) {
                        console.log('Session expired, reloading to login page')
                        win.webContents.loadURL(global.config.nasURL)
                    } else {
                        // Session有效，执行刷新
                        console.log('Auto-reloading xunlei page (every 30 minutes)')
                        win.webContents.reload()
                    }
                }).catch(e => {
                    console.log('Check login status failed, force reload:', e)
                    win.webContents.reload()
                })
            }
        }
    }, 1000 * 60 * 30 )

    // 添加健康检查定时器，每5分钟检查一次页面是否响应（带超时检测）
    healthCheckTimer = setInterval(() => {
        if (!win || win.isDestroyed()) return
        const currentUrl = win.webContents.getURL()
        const isInXunlei = currentUrl.indexOf('pan-xunlei-com') > 0
        if (!isInXunlei) return

        // 用Promise.race设置10秒超时，若渲染进程被挂起则Promise永不返回
        let resolved = false
        const probe = win.webContents.executeJavaScript(
            'Date.now()'
        ).then(ts => {
            resolved = true
            const drift = Date.now() - ts
            console.log('Health check ok, time drift =', drift, 'ms')
        }).catch(e => {
            resolved = true
            console.log('Health check exception, force reload:', e)
            try { win.webContents.reload() } catch (_) {}
        })

        setTimeout(() => {
            if (!resolved) {
                console.log('Health check TIMEOUT (renderer frozen), force reload')
                try {
                    if (win && !win.isDestroyed()) {
                        win.webContents.reload()
                    }
                } catch (_) {}
            }
        }, 10 * 1000)
    }, 1000 * 60 * 5)

}


function loadDefaultHTML(code, action, msg) {
    console.log("loadDefaultHTML::::::", code, action, msg)
    // 停止可能在进行中的网络加载，避免导航互相打断
    try { win.webContents.stop() } catch (e) {}
    // 若已在设置页，则不重复加载，减少 ERR_ABORTED 噪音
    let _cur = ""
    try { _cur = win.webContents.getURL() } catch (e) {}
    const already = (_cur && _cur.indexOf('mainWindow.html') > -1 && _cur.indexOf('file:') === 0)
    if (!already) {
        win.loadFile(path.join(__dirname, 'mainWindow.html')).catch(e => { console.log(e) })
    }
    setTimeout(() => {
        // 仅当提供了 action 时才发送第一条消息，避免渲染进程因 action 缺失报错
        if (typeof action === 'string') {
            win.webContents.send('mainWindow-msg', global.lang.getMsg(code || 0, action, msg || ''))
        }
        win.webContents.send('mainWindow-msg', global.lang.getMsg(0, "set-config", global.config))
        console.log(global.config)
    }, 500)
}

module.exports.loadDefaultHTML = loadDefaultHTML

function show() {
    if (false === win.isDestroyed() && false === win.webContents.isDestroyed()) {
        win.show()
    } else {
        create()
        win.show()
    }
}

module.exports.show = show

function hide() {
    if (false === win.isDestroyed() && false === win.webContents.isDestroyed()) {
        win.hide()
    } else {
        create()
        win.hide()
    }
}

module.exports.hide = hide


ipcMain.on('mainWindow-msg', (e, args) => {
    console.log('mainWindow-msg', global.config, args)
    if (!args.hasOwnProperty('action')) {
        event.reply('mainWindow-msg', global.lang.getMsg(2001, "show-err"))
        return
    }
    switch (args.action) {
        case "desktop-ready":
            if (win.webContents.getURL().indexOf('pan-xunlei-com') < 0) {
                console.log("/////////////global.config.nasURL",
                    global.config.nasURL
                    , getXunleiURL(global.config.nasURL))
                win.webContents.loadURL(getXunleiURL(global.config.nasURL))
            }

            break
        case "confirm-config":
            if (setConfig(args.data)) {
                win.loadURL(global.config.nasURL)
            }

            break
        case "confirm-shared-path":
            const result = dialog.showOpenDialog(win, {
                properties: ['openDirectory']
            }).then(r => {
                win.webContents.send('mainWindow-msg', {
                    action: "confirm-shared-path",
                    data: {
                        filePaths: r.filePaths
                    }
                })
                console.log('directories selected', r.filePaths)
            })
            break
        case "open-shared-path":
            if (null != global.config.sharedPath && "" !== global.config.sharedPath) {
                shell.openPath(global.config.sharedPath).then(r => {
                    console.log("open-shared-path:succ", r, r.toString())
                    if (null != r && r.toString().indexOf("Fail") > -1) {
                        showOpenSharedPathFailMessageBox(20005)
                    }
                }).catch(e => {
                    showOpenSharedPathFailMessageBox(20003)
                    console.log("open-shared-path:err", e)
                })
            } else {
                showOpenSharedPathFailMessageBox(20004)
            }
            break
        case "open-file-folder":
            // 打开文件所在文件夹并选中文件
            handleOpenFileFolder(args.data && args.data.fileName)
            break
        case "speed-update":
            // 接收速度更新并保存
            if (args.data && args.data.speed) {
                currentSpeed = args.data.speed
                console.log(`===== [SPEED UPDATE] =====`)
                console.log('SPEED:', currentSpeed)
                console.log('===== END SPEED =====')
                // 更新 tray tooltip
                updateTrayTooltip()
                // 更新速度浮窗
                updateSpeedWindow()
            }
            break
        case "sniff-api":
            // 抓包：打印迅雷接口的 URL 和响应体，定位下载速度字段
            if (args.data) {
                const tag = args.data.hasSpeed ? '【疑似速度接口】' : ''
                console.log(`===== [SNIFF ${args.data.label}]${tag} =====`)
                console.log('URL :', args.data.url)
                console.log('BODY:', args.data.body)
                console.log('===== END SNIFF =====')
            }
            break
        case "debug-menu-dom":
            // 调试用：打印菜单 DOM 结构
            console.log('===== 菜单 DOM 调试信息 =====')
            if (args.data && args.data.info) {
                args.data.info.forEach(item => {
                    console.log(`[depth=${item.depth}] tag=${item.tag}, class="${item.class}", childCount=${item.childCount}`)
                    console.log(`  HTML: ${item.outerHTMLSnippet}`)
                })
            }
            console.log('===== END =====')
            break
    }
})

// 在共享目录中查找文件并打开其所在文件夹（选中该文件）
function handleOpenFileFolder(fileName) {
    console.log('handleOpenFileFolder:', fileName)
    if (!global.config.sharedPath || global.config.sharedPath === '') {
        showOpenSharedPathFailMessageBox(20004)
        return
    }
    const sharedPath = global.config.sharedPath
    
    // 没有文件名则直接打开共享目录
    if (!fileName) {
        shell.openPath(sharedPath).catch(e => console.log('open shared path err:', e))
        return
    }
    
    // 在共享目录中查找匹配的文件/文件夹
    try {
        const target = findFileInDir(sharedPath, fileName, 3)
        if (target) {
            console.log('found target:', target)
            shell.showItemInFolder(target)
        } else {
            console.log('file not found, opening shared dir instead')
            shell.openPath(sharedPath).catch(e => console.log('open shared path err:', e))
        }
    } catch (e) {
        console.log('handleOpenFileFolder error:', e)
        shell.openPath(sharedPath).catch(_ => {})
    }
}

// 在指定目录下递归查找文件名匹配的文件/文件夹（限制递归深度防止卡死）
function findFileInDir(dir, fileName, maxDepth = 3) {
    if (maxDepth < 0) return null
    let entries
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (e) {
        return null
    }
    // 优先精确匹配当前层
    for (const entry of entries) {
        if (entry.name === fileName) {
            return path.join(dir, entry.name)
        }
    }
    // 模糊匹配（去除可能的扩展名差异）
    for (const entry of entries) {
        if (entry.name.indexOf(fileName) === 0 || fileName.indexOf(entry.name) === 0) {
            return path.join(dir, entry.name)
        }
    }
    // 递归子目录
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const found = findFileInDir(path.join(dir, entry.name), fileName, maxDepth - 1)
            if (found) return found
        }
    }
    return null
}

async function showOpenSharedPathFailMessageBox(code) {
    return new Promise(resolve => {
        dialog.showMessageBox(win, {
            type: "warning",
            title: global.lang.getLang('msg', code),
            message: global.lang.getLang('msg', code),
            buttons: [global.lang.getLang('menu', 'goToConfig'), global.lang.getLang('menu', 'cancel')],
            defaultId: 0,
            cancelId: 1
        }).then(r => {
            console.log('click:', r)
            if (r.hasOwnProperty('response') && 0 === r.response) {
                //点击了确认
                loadDefaultHTML(code, 'show-err', global.lang.getLang('msg', code))
            }
        }).catch(e => {

        })
    })
}

function setConfig(data = {}) {
    let oldData = global.config
    if (fs.existsSync(global.configFile)) {
        try {
            oldData = JSON.parse(fs.readFileSync(global.configFile))
        } catch (e) {
            console.log("setConfig:parse old fail")
        }
    }
    if (typeof (data) != "object") {
        return false
    }
    for (var key in data) {
        oldData[key] = data[key]
    }
    fs.writeFileSync(global.configFile, JSON.stringify(oldData))
    global.config = oldData
    global.config.nasURL = func.fixNasURL(global.config.nasURL)
    if (global.config.hasOwnProperty('regProtocol') && true === global.config.regProtocol) {
        func.registerProtocolClient()
    } else {
        func.unRegisterProtocolClient()
    }
    return true
}

// 注入速度提取脚本到迅雷页面（hook drive/v1/tasks 接口，累加运行中任务速度，页面无关）
function injectSpeedSniffer() {
    if (!win || win.isDestroyed()) return
    const script = `
        (function() {
            if (window.__speedHookInstalled) { console.log('[SPEED] hook already installed'); return; }
            window.__speedHookInstalled = true;
            // 记录每个运行中任务的速度（id -> bytes/s），跨页面累计
            window.__taskSpeeds = {};
            console.log('[SPEED] Installing drive/v1/tasks API hook...');

            function formatSpeed(bytes) {
                if (bytes >= 1024 * 1024) {
                    return (bytes / 1024 / 1024).toFixed(1) + 'MB/s';
                }
                return (bytes / 1024).toFixed(1) + 'KB/s';
            }

            function parseTasksAndReport(text) {
                try {
                    const data = JSON.parse(text);
                    if (!data || !Array.isArray(data.tasks)) return;
                    for (const t of data.tasks) {
                        const id = t.id;
                        if (!id) continue;
                        const p = t.params || {};
                        const sp = parseInt(p.speed || '0', 10);
                        const done = t.phase === 'PHASE_TYPE_COMPLETE' || t.progress === 100;
                        if (done || isNaN(sp) || sp <= 0) {
                            delete window.__taskSpeeds[id];
                        } else {
                            window.__taskSpeeds[id] = sp;
                        }
                    }
                    let total = 0;
                    for (const k in window.__taskSpeeds) total += window.__taskSpeeds[k];
                    const speedStr = formatSpeed(total);
                    console.log('[SPEED] total bytes/s:', total, '->', speedStr);
                    window.postMessage({ type: 'speed-update', speed: speedStr }, '*');
                } catch (e) {
                    console.log('[SPEED] parse error:', e.message);
                }
            }

            const isTasks = (url) => String(url || '').indexOf('drive/v1/tasks') > -1;

            // hook fetch
            const of = window.fetch;
            if (of) {
                window.fetch = function(...a) {
                    const url = (a[0] && a[0].url) ? a[0].url : a[0];
                    return of.apply(this, a).then((r) => {
                        try {
                            if (isTasks(url)) r.clone().text().then(parseTasksAndReport).catch(() => {});
                        } catch (e) {}
                        return r;
                    });
                };
            }

            // hook XHR
            const OX = window.XMLHttpRequest;
            if (OX) {
                const open = OX.prototype.open;
                const send = OX.prototype.send;
                OX.prototype.open = function(m, u) { this.__su = u; return open.apply(this, arguments); };
                OX.prototype.send = function(...s) {
                    this.addEventListener('load', function() {
                        try {
                            if (isTasks(this.__su)) {
                                let t = '';
                                try { t = (this.responseType === '' || this.responseType === 'text') ? this.responseText : JSON.stringify(this.response); } catch (_) {}
                                parseTasksAndReport(t);
                            }
                        } catch (e) {}
                    });
                    return send.apply(this, s);
                };
            }

            console.log('[SPEED] tasks API hook installed');
        })();
    `
    win.webContents.executeJavaScript(script).then(() => {
        console.log('[SPEED] Script injected successfully')
    }).catch(e => {
        console.log('[SPEED] Script injection failed:', e)
    })
}

// 更新 tray tooltip，显示下载速度
function updateTrayTooltip() {
    const trayModule = require('../../common/tray')
    if (!trayModule || !trayModule.updateTooltip) return

    const baseTitle = global.lang.getLang('menu', 'title')
    let tooltip = baseTitle

    // 解析速度值，判断是否大于 10k
    if (currentSpeed) {
        const match = currentSpeed.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)\/s/i)
        if (match) {
            const value = parseFloat(match[1])
            const unit = match[2].toUpperCase()
            let speedInKB = value

            // 转换为 KB/s
            if (unit === 'MB') {
                speedInKB = value * 1024
            } else if (unit === 'GB') {
                speedInKB = value * 1024 * 1024
            }

            // 如果速度大于 10k，在第二行显示
            if (speedInKB > 10) {
                tooltip = baseTitle + '\n' + currentSpeed
            }
        }
    }

    trayModule.updateTooltip(tooltip)
}

// 创建速度浮窗
function createSpeedWindow() {
    if (speedWindow && !speedWindow.isDestroyed()) {
        console.log('[SPEED WINDOW] Already exists, skipping creation')
        return
    }

    console.log('[SPEED WINDOW] Creating speed window...')
    const { BrowserWindow, screen } = require('electron')
    const path = require('path')

    // 获取屏幕尺寸，设置位置在右上角
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
    const windowWidth = SPEED_WINDOW_WIDTH
    const windowHeight = SPEED_WINDOW_HEIGHT
    const x = screenWidth - windowWidth - 20
    const y = 20

    console.log('[SPEED WINDOW] Position:', x, y)

    speedWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: windowWidth,
        minHeight: windowHeight,
        maxWidth: windowWidth,
        maxHeight: windowHeight,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        hasShadow: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        useContentSize: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    speedWindow.loadFile(path.join(__dirname, '../speedWindow/speedWindow.html'))

    speedWindow.on('ready-to-show', () => {
        console.log('[SPEED WINDOW] Ready to show')
        speedWindow.show()
    })

    speedWindow.webContents.on('did-finish-load', () => {
        console.log('[SPEED WINDOW] HTML loaded successfully')
    })

    speedWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
        console.log('[SPEED WINDOW] Failed to load HTML:', errorCode, errorDescription)
    })

    speedWindow.on('closed', () => {
        console.log('[SPEED WINDOW] Closed')
        speedWindow = null
    })
}

// 更新速度浮窗显示
function updateSpeedWindow() {
    if (speedWindow && !speedWindow.isDestroyed()) {
        speedWindow.webContents.send('speed-update', currentSpeed)
    }
}

// 销毁速度浮窗
function destroySpeedWindow() {
    if (speedWindow && !speedWindow.isDestroyed()) {
        speedWindow.destroy()
        speedWindow = null
    }
}

module.exports.logout = async () => {
    win.webContents.session.cookies.get({}).then(cookies => {
            if (cookies.length > 0) {
                cookies.forEach(cookie => {
                    let url = '';
                    // get prefix, like https://www.
                    url += cookie.secure ? 'https://' : 'http://';
                    url += cookie.domain.charAt(0) === '.' ? 'www' : '';
                    // append domain and path
                    url += cookie.domain;
                    url += cookie.path;
                    session.defaultSession.cookies.remove(url, cookie.name, (error) => {
                        if (error) console.log(`error removing cookie ${cookie.name}`, error);
                    })
                })
            }
            win.webContents.loadURL(global.config.nasURL)
        }
    ).catch(e => {
        console.log('get cookie fail')
    })
}

async function checkNasLoginStatus(_url) {
    return new Promise((resolve) => {
        let has_id = false
        let has_stay_login = false
        let has_syno_cookie_policy = '' //只有远程登陆的时候才有这个
        if (typeof (_url) != "string") {
            console.log("checkNasLoginStatus:url empty")
            return resolve(false)
        }

        let parsed = psl.parse(_url)
        win.webContents.session.cookies.get({domain: parsed.domain}).then(cookies => {
            if (cookies.length > 0) {
                cookies.forEach((v, k) => {
                    if (v.hasOwnProperty('name')) {
                        if ('id' === v.name) {
                            has_id = true
                        }
                        if ('stay_login' === v.name && '1' === v.value) {
                            has_stay_login = true
                        }
                        if ('syno-cookie-policy' === v.name && 'ok' === v.value) {
                            has_syno_cookie_policy = true
                        }
                    }
                })
            }
            // console.log("checkNasLoginStatus：has_id,has_stay_login,has_syno_cookie_policy", has_id, has_stay_login, has_syno_cookie_policy)

            //群晖7.2 有 id 和 stay_login , stay_login='1'的时候才能自动登录
            if (has_id && has_stay_login) {
                resolve(true)
            } else {
                resolve(false)
            }
        }).catch(e => {
            console.log("cannot get cookie:", parsed.domain)
        })
    })


}

let oldTxt = ""

function watchClipboard() {
    clipboard.clear()
    clipboardWatchTimer = setInterval(() => {
        let _txt = clipboard.readText()
        if (_txt != oldTxt) {
            oldTxt = _txt
            // if (_txt.match(/magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32}/i) !== null) {
            //
            // } else

            if (!checkURL(_txt)) {
                _txt = ""
                return
            }
            addXunLeiTask(_txt)
        }

    }, 1000)
}

var isInXunleiApp = function () {
    if (!win || win.isDestroyed()) return false
    if (win.webContents.getURL().indexOf('3rdparty/pan-xunlei-com/index.cgi') > 0) {
        return true
    } else {
        return false
    }
}

// 等待页面中指定选择器的元素就绪（支持重试），避免 Vue 应用未初始化完就操作
function waitForSelector(selector, timeoutMs = 15000, intervalMs = 300) {
    return new Promise((resolve, reject) => {
        const start = Date.now()
        const check = () => {
            if (!win || win.isDestroyed()) {
                return reject(new Error('window destroyed'))
            }
            win.webContents.executeJavaScript(
                `!!document.querySelector(${JSON.stringify(selector)})`
            ).then(found => {
                if (found) return resolve(true)
                if (Date.now() - start >= timeoutMs) {
                    return reject(new Error('timeout waiting for ' + selector))
                }
                setTimeout(check, intervalMs)
            }).catch(err => {
                if (Date.now() - start >= timeoutMs) {
                    return reject(err)
                }
                setTimeout(check, intervalMs)
            })
        }
        check()
    })
}

var addXunLeiTask = function (_txt) {

    console.log("addXunLeiTask:", _txt)
    if (typeof (_txt) != "undefined" && "" === _txt.trim()) {
        console.log("addXunLeiTask:txt empty")
        return
    }

    // 保存任务URL，如果页面被刷新后会重新执行
    pendingTaskUrl = _txt

    // 检查是否在迅雷页面，如果不在，先导航到迅雷页面
    if (false === isInXunleiApp()) {
        console.log("addXunLeiTask:not in xunlei app, navigating first")
        win.webContents.loadURL(getXunleiURL(global.config.nasURL))
        return
    }

    // 如果页面可能冻结（后台过久），先刷新页面
    if (lastHiddenAt > 0 && (Date.now() - lastHiddenAt) > STALE_THRESHOLD_MS) {
        console.log('addXunLeiTask: page may be frozen, reloading first')
        lastHiddenAt = 0  // 先清零，避免 show 事件再次触发 refreshIfStale 重复 reload
        win.webContents.reload()
        return
    }

    // 清除待处理标志（防止重复执行）
    pendingTaskUrl = null

    // 确保窗口处于可见且聚焦状态，弹层依赖焦点状态
    // 注意：main.js 的 second-instance 中已经处理了显示，这里只是兜底
    try {
        if (!win.isVisible()) {
            console.log('addXunLeiTask: window not visible, showing')
            win.show()
        }
        if (win.isMinimized()) {
            console.log('addXunLeiTask: window minimized, restoring')
            win.restore()
        }
        if (!win.isFocused()) {
            win.focus()
        }
    } catch (_) {}

    // 等待 .create__task 元素就绪后再点击，避免 Vue 还未渲染完
    console.log('Waiting for .create__task button...')
    waitForSelector('.create__task').then(() => {
        console.log('.create__task button found, clicking...')
        return win.webContents.executeJavaScript(
            `document.querySelector('.create__task').click()`
        )
    }).then(() => {
        console.log('Button clicked, waiting for .el-textarea__inner...')
        // 弹层中的输入框需要再等一下渲染
        return waitForSelector('.el-textarea__inner', 10000)
    }).then(() => {
        console.log('.el-textarea__inner found, focusing...')
        return win.webContents.executeJavaScript(`
            (function(){
                var el = document.querySelector('.el-textarea__inner');
                if (!el) return false;
                el.value = '';
                el.focus();
                return true;
            })()
        `)
    }).then(() => {
        console.log('Input focused, pasting text...')
        clipboard.writeText(_txt)
        win.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Ctrl'})
        win.webContents.sendInputEvent({type: 'keyDown', keyCode: 'V', modifiers: ['control']})
        win.webContents.sendInputEvent({type: 'keyUp', keyCode: 'V', modifiers: ['control']})
        win.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Ctrl'})
        console.log('addXunLeiTask completed successfully')
    }).catch(e => {
        console.log('addXunLeiTask failed:', e && e.message ? e.message : e)
    })
}

module.exports.addXunLeiTask = addXunLeiTask

function doCtrlV(x = 0, y = 0) {
    if (0 !== x && 0 !== y) {
        win.webContents.sendInputEvent({
            type: 'mouseEnter',
            x: x,
            y: y
        });
        // win.webContents.sendInputEvent({
        //     type: 'mouseDown',
        //     x: x,
        //     y: y
        // });
        // win.webContents.sendInputEvent({
        //     type: 'mouseUp',
        //     x: x,
        //     y: y
        // });

    }
    win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Ctrl'
    });

    win.webContents.sendInputEvent({
        type: 'keyDown',
        keyCode: 'V',
        modifiers: ['control']
    });

    win.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'V',
        modifiers: ['control']
    });

    win.webContents.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Ctrl'
    });
}

function checkURL(_url) {
    if (
        // _url.indexOf("http://") === 0
        // || _url.indexOf("https://") === 0
        _url.indexOf("ftp://") === 0
    ) {
        let ext = _url.split('/').pop().split('.').pop().split('#').shift().split('?').shift()
        console.log(_url, true)
        return true
    }
    if (_url.indexOf("thunder://") === 0
        || _url.indexOf("thunderx://") === 0
        || _url.indexOf("ed2k://") === 0
        || _url.indexOf("magnet:?xt=") === 0
    ) {
        console.log(_url, true)
        return true
    } else {
        console.log(_url, false)
        return false
    }
}

function cleanupTimers() {
    console.log('cleanupTimers called')
    if (autoReloadTimer) {
        clearInterval(autoReloadTimer)
        autoReloadTimer = null
        console.log('autoReloadTimer cleared')
    }
    if (clipboardWatchTimer) {
        clearInterval(clipboardWatchTimer)
        clipboardWatchTimer = null
        console.log('clipboardWatchTimer cleared')
    }
    if (healthCheckTimer) {
        clearInterval(healthCheckTimer)
        healthCheckTimer = null
        console.log('healthCheckTimer cleared')
    }
}

// 彻底销毁窗口和所有资源
function destroyWindow() {
    console.log('destroyWindow called')
    // 销毁速度浮窗
    destroySpeedWindow()
    if (!win) {
        console.log('win already null')
        return
    }
    try {
        // 检查窗口是否已被销毁
        let isDestroyed = false
        try {
            isDestroyed = win.isDestroyed()
        } catch (_) {
            // 如果 isDestroyed() 本身抛异常，说明对象已失效
            console.log('win object already invalid')
            win = null
            return
        }

        if (isDestroyed) {
            console.log('win already destroyed')
            win = null
            return
        }

        // 停止所有加载和导航
        if (win.webContents && !win.webContents.isDestroyed()) {
            try {
                win.webContents.stop()
                win.webContents.closeDevTools()
                console.log('webContents stopped')
            } catch (_) {}
        }

        // 移除所有监听器（防止清理过程中触发事件）
        try {
            win.removeAllListeners()
            if (win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.removeAllListeners()
            }
            console.log('all listeners removed')
        } catch (_) {}

        // 直接销毁窗口，不等待异步清理
        win.destroy()
        console.log('window destroyed')
        win = null
    } catch (e) {
        console.log('destroyWindow error:', e)
        win = null
    }
}

module.exports.cleanupTimers = cleanupTimers
module.exports.destroyWindow = destroyWindow
