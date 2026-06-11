const {app, BrowserWindow, ipcMain, clipboard, session, dialog, shell} = require('electron')
const path = require('path')
const fs = require('fs')
const url = require('url')
const func = require('../../common/func')
require('../../common/global')
let psl = require('psl');
// 原生窗口管理模块，用于检测前台是否有全屏应用（视频/游戏）。
// 用 try/catch 包裹，加载失败时优雅降级，不影响主流程。
let windowManager = null
try {
    windowManager = require('node-window-manager').windowManager
} catch (e) {
    console.log('[FULLSCREEN] node-window-manager load failed:', e.message)
}
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
let speedWindowTopmostTimer = null  // 速度窗口置顶状态检查定时器
let hiddenForFullscreen = false  // 是否因检测到全屏应用而隐藏了速度窗口

// 检测前台窗口是否为全屏应用（全屏视频/全屏游戏等）
// 原理：取前台活动窗口，若其矩形完全覆盖所在显示器的整个屏幕（含任务栏区域），
// 则视为全屏。排除本应用自身的窗口，避免误判。
function isForegroundFullscreen() {
    if (!windowManager) return false
    try {
        const active = windowManager.getActiveWindow()
        if (!active) return false

        // 排除本应用自身窗口（按可执行文件路径比对）
        try {
            if (active.path && process.execPath &&
                active.path.toLowerCase() === process.execPath.toLowerCase()) {
                return false
            }
        } catch (e) { /* ignore */ }

        const b = active.getBounds()
        if (!b || !b.width || !b.height) return false

        // 使用活动窗口所在显示器的边界（与窗口边界同一坐标系，避免 DPI 不一致）
        const monitor = active.getMonitor()
        if (!monitor || typeof monitor.getBounds !== 'function') return false
        const full = monitor.getBounds()  // 整个屏幕（含任务栏区域）
        if (!full || !full.width || !full.height) return false

        const scale = (typeof monitor.getScaleFactor === 'function' && monitor.getScaleFactor()) || 1

        // 容差：最大化窗口会向外扩出约 8px 边框，且底部停在任务栏上方（约留 40px）。
        // 左右上用较大容差（覆盖边框），底部用较小容差，
        // 仅当窗口底部确实覆盖到任务栏区域（真全屏）时才判定。
        const EDGE_TOL = 12
        const BOTTOM_TOL = 4
        // 检查给定边界是否完全覆盖屏幕
        const coversWith = (x, y, w, h) =>
            x <= full.x + EDGE_TOL &&
            y <= full.y + EDGE_TOL &&
            (x + w) >= (full.x + full.width - EDGE_TOL) &&
            (y + h) >= (full.y + full.height - BOTTOM_TOL)

        // 同时考虑窗口边界为物理像素或 DIP（缩放）两种情况，
        // 任一解释下覆盖整屏即判定为全屏。最大化窗口因任务栏间隙在两种解释下都不会通过底部判定。
        const coversRaw = coversWith(b.x, b.y, b.width, b.height)
        const coversScaled = scale !== 1
            ? coversWith(b.x * scale, b.y * scale, b.width * scale, b.height * scale)
            : false
        return coversRaw || coversScaled
    } catch (e) {
        return false
    }
}
let currentTaskList = []  // 当前任务列表（从 drive/v1/tasks 接口获取）
let currentOverallProgress = 0  // 总任务进度（加权平均，0-100）
let currentTaskCount = 0  // 总任务数

// 重新确保速度窗口可见并置顶
// 解决：其他窗口进入全屏（如视频播放）后，Windows 会隐藏置顶窗口，
// 且退出全屏后不会自动恢复，导致速度窗口"消失"且找不回。
function restoreSpeedWindow() {
    if (!speedWindow || speedWindow.isDestroyed()) return
    if (!speedWindow.isVisible()) {
        speedWindow.showInactive()
    }
    // 先关后开，强制 Windows 重新应用 topmost 标志；使用最高级别 'screen-saver'
    speedWindow.setAlwaysOnTop(false)
    speedWindow.setAlwaysOnTop(true, 'screen-saver')
}

// 注册浮窗点击事件监听器（只注册一次）
ipcMain.on('speed-window-click', () => {
    console.log('[SPEED WINDOW] Clicked, showing main window')
    show()
    // 点击后重新置顶速度窗口，避免被主窗口或全屏窗口盖住后消失
    restoreSpeedWindow()
})

// 注册浮窗拖拽监听器（只注册一次）
// 使用 screen.getCursorScreenPoint()（DIP）+ 抓取偏移定位，避免高 DPI 缩放下窗口漂移
const SPEED_WINDOW_WIDTH = 510

// 注册速度窗口任务列表请求监听器
ipcMain.on('get-task-list', (e) => {
    e.reply('task-list-response', { tasks: currentTaskList })
})

// 注册速度窗口高度调整监听器
ipcMain.on('resize-speed-window', (e, height) => {
    if (speedWindow && !speedWindow.isDestroyed()) {
        const [currentX, currentY] = speedWindow.getPosition()
        speedWindow.setBounds({
            x: currentX,
            y: currentY,
            width: SPEED_WINDOW_WIDTH,
            height: height
        })
    }
})

// 注册速度窗口任务项打开文件夹请求
ipcMain.on('speed-window-open-task-folder', (e, data) => {
    if (!win || win.isDestroyed()) return
    console.log('[SPEED WINDOW] Open task folder:', data.taskName)
    // 转发到渲染进程，由 preload.js 处理
    win.webContents.send('open-task-folder-from-speed-window', data)
})

// 注册速度窗口右键菜单请求（使用 Electron 原生 Menu）
ipcMain.on('speed-window-contextmenu', (e, data) => {
    const { Menu, screen } = require('electron')
    console.log('[SPEED WINDOW] Context menu request:', data.type)

    if (!speedWindow || speedWindow.isDestroyed()) return

    // 获取窗口位置和尺寸
    const [winX, winY] = speedWindow.getPosition()
    const [winWidth, winHeight] = speedWindow.getSize()

    if (data.type === 'speed-window') {
        // 速度窗口菜单：固定位置（速度胶囊正下方，左边缘与窗口右边缘左偏100px对齐）
        const menuX = winWidth - 100  // 窗口右边缘向左100px
        const menuY = SPEED_WINDOW_HEIGHT  // 速度胶囊初始高度（66px）

        console.log('[SPEED WINDOW] Speed window menu pos:', menuX, menuY)

        const template = [
            {
                label: '打开下载文件夹',
                click: () => {
                    const { shell } = require('electron')
                    if (global.config && global.config.sharedPath) {
                        shell.openPath(global.config.sharedPath).catch(err => {
                            console.log('open download folder error:', err)
                        })
                    }
                }
            },
            { type: 'separator' },
            {
                label: '显示窗口',
                click: () => show()
            },
            {
                label: '隐藏窗口',
                click: () => {
                    if (win && !win.isDestroyed()) {
                        win.hide()
                    }
                }
            },
            { type: 'separator' },
            {
                label: '隐藏速度球',
                click: () => {
                    // 修改配置文件，设置 showSpeedWindow 为 false
                    setConfig({ showSpeedWindow: false })
                    // 销毁速度球
                    destroySpeedWindow()
                }
            },
            { type: 'separator' },
            {
                label: '设置中心',
                click: () => loadDefaultHTML()
            },
            { type: 'separator' },
            {
                label: '退出客户端',
                click: () => {
                    const { app } = require('electron')
                    global.__isQuitting = true
                    cleanupTimers()
                    app.quit()
                }
            }
        ]
        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window: speedWindow, x: menuX, y: menuY })
    } else if (data.type === 'task-item') {
        // 任务项菜单：使用鼠标位置
        const menuX = data.x
        const menuY = data.y

        console.log('[SPEED WINDOW] Task item menu pos:', menuX, menuY)

        const template = [
            {
                label: '打开文件夹',
                click: () => {
                    if (!win || win.isDestroyed()) return
                    console.log('[SPEED WINDOW] Open task folder:', data.taskName)
                    // 转发到渲染进程，由 preload.js 处理
                    win.webContents.send('open-task-folder-from-speed-window', { taskName: data.taskName })
                }
            }
        ]
        const menu = Menu.buildFromTemplate(template)
        menu.popup({ window: speedWindow, x: menuX, y: menuY })
    }
})
const SPEED_WINDOW_HEIGHT = 80
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

ipcMain.on('speed-window-drag-end', () => {
    if (speedWindow && !speedWindow.isDestroyed()) {
        const [x, y] = speedWindow.getPosition()
        console.log('[SPEED WINDOW] Drag end, saving position:', x, y)
        setConfig({ speedWindowPosition: { x, y } })
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
                // 根据配置决定是否创建速度浮窗
                if (global.config.showSpeedWindow !== false) {
                    createSpeedWindow()
                }
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
        // 如果已经在退出流程中，不再处理，让窗口正常关闭
        if (global.__isQuitting) return

        // 标记退出中，立即清理定时器
        global.__isQuitting = true
        console.log('User chose to quit')
        cleanupTimers()
        // 调用 app.quit() 会触发 before-quit，在那里统一清理
        app.quit()
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
    // console.log('mainWindow-msg', global.config, args)
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
                // console.log(`===== [SPEED UPDATE] =====`)
                // console.log('SPEED:', currentSpeed)
                // console.log('===== END SPEED =====')
                // 更新 tray tooltip
                updateTrayTooltip()
                // 更新速度浮窗
                updateSpeedWindow()
            }
            break
        case "task-list-update":
            // 接收任务列表更新并保存到全局变量
            if (args.data && args.data.tasks) {
                currentTaskList = args.data.tasks
                // 通知速度窗口任务列表已更新（如果任务列表正在显示则自动刷新）
                if (speedWindow && !speedWindow.isDestroyed()) {
                    speedWindow.webContents.send('task-list-update')
                }
            }
            break
        case "overall-progress-update":
            // 接收总进度更新
            if (args.data) {
                currentOverallProgress = args.data.progress
                currentTaskCount = args.data.taskCount
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
    // 处理速度球配置
    if (global.config.hasOwnProperty('showSpeedWindow')) {
        if (global.config.showSpeedWindow) {
            // 如果启用速度球且速度球不存在，则创建
            if (!speedWindow || speedWindow.isDestroyed()) {
                createSpeedWindow()
            }
        } else {
            // 如果禁用速度球且速度球存在，则销毁
            if (speedWindow && !speedWindow.isDestroyed()) {
                destroySpeedWindow()
            }
        }
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
            // 记录每个运行中任务的完整信息（id -> {lastSeen, info}），跨页面累计
            window.__taskMap = {};
            // 任务过期阈值：超过此时间未在接口响应中出现则清理（跨页面保留）
            window.__taskStaleMs = 5 * 60 * 1000;
            console.log('[SPEED] Installing drive/v1/tasks API hook...');

            function formatSpeed(bytes) {
                if (bytes >= 1024 * 1024) {
                    return (bytes / 1024 / 1024).toFixed(1) + 'M/s';
                }
                return (bytes / 1024).toFixed(1) + 'K/s';
            }

            function parseTasksAndReport(text) {
                try {
                    const data = JSON.parse(text);
                    if (!data || !Array.isArray(data.tasks)) return;
                    const now = Date.now();
                    for (const t of data.tasks) {
                        const id = t.id;
                        if (!id) continue;
                        const p = t.params || {};
                        const sp = parseInt(p.speed || '0', 10);
                        const done = t.phase === 'PHASE_TYPE_COMPLETE' || t.progress === 100;
                        // 失败任务：phase 包含 FAILED/ERROR 或 message 包含失败关键词
                        const phaseStr = String(t.phase || '').toLowerCase();
                        const messageStr = String(t.message || '').toLowerCase();
                        const isFailed = phaseStr.includes('failed') || phaseStr.includes('error') || messageStr.includes('失败') || messageStr.includes('error');
                        // 暂停任务：phase 包含 PAUSED 或暂停
                        const isPaused = phaseStr.includes('paused') || phaseStr.includes('pause') || messageStr.includes('暂停');
                        // 占位/系统任务（如 "群晖-nas"）：无文件大小且无速度
                        const fileSize = parseInt(t.file_size || '0', 10);
                        const isPlaceholder = (isNaN(fileSize) || fileSize <= 0) && (isNaN(sp) || sp <= 0);
                        // 完成/失败/暂停/占位任务从累计字典中移除
                        if (done || isFailed || isPaused || isPlaceholder) {
                            delete window.__taskSpeeds[id];
                            delete window.__taskMap[id];
                            continue;
                        }
                        // 速度累计（速度为0也保留，避免任务闪烁）
                        window.__taskSpeeds[id] = sp;
                        // 任务信息累计（按 id 维护，不完全覆盖，避免不同页面返回不同子集导致列表跳变）
                        window.__taskMap[id] = {
                            lastSeen: now,
                            info: {
                                id: t.id,
                                name: t.name || '',
                                fileName: t.file_name || '',
                                fileSize: t.file_size || '',
                                phase: t.phase || '',
                                progress: t.progress || 0,
                                speed: sp,
                                isRunning: true
                            }
                        };
                    }
                    // 清理长时间未更新的任务（已删除/已完成但未在响应中体现）
                    for (const k in window.__taskMap) {
                        if (now - window.__taskMap[k].lastSeen > window.__taskStaleMs) {
                            delete window.__taskMap[k];
                            delete window.__taskSpeeds[k];
                        }
                    }
                    // 汇总速度
                    let total = 0;
                    for (const k in window.__taskSpeeds) total += window.__taskSpeeds[k];
                    const speedStr = formatSpeed(total);
                    console.log('[SPEED] total bytes/s:', total, '->', speedStr);
                    window.postMessage({ type: 'speed-update', speed: speedStr }, '*');
                    // 汇总任务列表
                    const taskList = [];
                    for (const k in window.__taskMap) taskList.push(window.__taskMap[k].info);
                    window.postMessage({ type: 'task-list-update', tasks: taskList }, '*');
                    // 计算加权平均总进度（按文件大小加权）
                    let totalSize = 0;
                    let totalProgress = 0;
                    for (const k in window.__taskMap) {
                        const info = window.__taskMap[k].info;
                        const fileSize = parseInt(info.fileSize || '0', 10);
                        const progress = parseInt(info.progress || '0', 10);
                        if (fileSize > 0) {
                            totalSize += fileSize;
                            totalProgress += fileSize * progress;
                        }
                    }
                    const overallProgress = totalSize > 0 ? Math.round(totalProgress / totalSize) : 0;
                    window.postMessage({ type: 'overall-progress-update', progress: overallProgress, taskCount: taskList.length }, '*');
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

    // 优先使用保存的位置，否则使用默认右上角位置
    let x, y
    if (global.config && global.config.speedWindowPosition) {
        x = global.config.speedWindowPosition.x
        y = global.config.speedWindowPosition.y
        console.log('[SPEED WINDOW] Using saved position:', x, y)
    } else {
        x = screenWidth - windowWidth - 20
        y = 20
        console.log('[SPEED WINDOW] Using default position:', x, y)
    }

    speedWindow = new BrowserWindow({
        width: windowWidth,
        height: windowHeight,
        minWidth: windowWidth,
        maxWidth: windowWidth,
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

    // 使用最高置顶级别，确保即使其他应用全屏（如视频播放）也不会被隐藏
    speedWindow.setAlwaysOnTop(true, 'screen-saver')

    speedWindow.loadFile(path.join(__dirname, '../speedWindow/speedWindow.html'))

    speedWindow.on('ready-to-show', () => {
        console.log('[SPEED WINDOW] Ready to show')
        speedWindow.showInactive()
        speedWindow.setAlwaysOnTop(true, 'screen-saver')
    })

    // 定时器：检测全屏应用并维护置顶状态
    // 1) 检测到前台全屏应用（视频/游戏）时隐藏速度窗口
    // 2) 全屏结束后恢复显示并重新置顶
    // 3) 安全网：避免全屏退出后窗口"丢失"
    if (speedWindowTopmostTimer) {
        clearInterval(speedWindowTopmostTimer)
    }
    speedWindowTopmostTimer = setInterval(() => {
        if (!speedWindow || speedWindow.isDestroyed()) {
            clearInterval(speedWindowTopmostTimer)
            speedWindowTopmostTimer = null
            return
        }

        if (isForegroundFullscreen()) {
            // 前台有全屏应用：隐藏速度窗口
            if (speedWindow.isVisible()) {
                console.log('[FULLSCREEN] Detected fullscreen app, hiding speed window')
                speedWindow.hide()
            }
            hiddenForFullscreen = true
            return
        }

        // 非全屏：若之前因全屏隐藏过，则恢复显示
        if (hiddenForFullscreen) {
            console.log('[FULLSCREEN] Fullscreen ended, restoring speed window')
            hiddenForFullscreen = false
            restoreSpeedWindow()
            return
        }

        // 常规维护：确保置顶且可见
        if (!speedWindow.isAlwaysOnTop() || !speedWindow.isVisible()) {
            restoreSpeedWindow()
        }
    }, 1000)

    speedWindow.webContents.on('did-finish-load', () => {
        console.log('[SPEED WINDOW] HTML loaded successfully')
        // 自动打开开发者工具（调试窗口）
       // speedWindow.webContents.openDevTools()
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
        speedWindow.webContents.send('overall-progress-update', { progress: currentOverallProgress, taskCount: currentTaskCount })
    }
}

// 销毁速度浮窗
function destroySpeedWindow() {
    if (speedWindowTopmostTimer) {
        clearInterval(speedWindowTopmostTimer)
        speedWindowTopmostTimer = null
    }
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
    if (speedWindowTopmostTimer) {
        clearInterval(speedWindowTopmostTimer)
        speedWindowTopmostTimer = null
        console.log('speedWindowTopmostTimer cleared')
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
