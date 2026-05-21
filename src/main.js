const {app, protocol, clipboard, BrowserWindow} = require('electron')
require('./common/global')
const func = require('./common/func')
require('./common/menu')
const tray = require('./common/tray')
const mainWindow = require('./module/mainWindow/mainWindow')

// 禁用硬件加速，减少GPU进程残留的可能性
app.disableHardwareAcceleration()
console.log('Hardware acceleration disabled')

// 从参数列表中提取有效的协议链接，过滤掉快捷方式、Electron参数等
function extractProtocolUrl(args) {
    return args.find(arg => {
        // 排除以 -- 开头的参数（Electron/Chromium 参数）
        if (arg.startsWith('--')) return false
        // 排除 exe 路径本身
        if (arg.endsWith('.exe')) return false
        // 排除文件路径（包含 .lnk, .url 等）
        if (arg.includes('.lnk') || arg.includes('.url')) return false
        // 排除 Windows 路径格式（如 C:\）
        if (/^[A-Z]:\\/i.test(arg)) return false
        // 只接受有效的协议链接
        return (
            arg.startsWith('magnet:') || 
            arg.startsWith('ed2k://') || 
            arg.startsWith('thunder://') ||
            arg.startsWith('thunderx://') ||
            arg.startsWith('ftp://')
        )
    })
}

// 阻止创建额外窗口（处理协议链接时可能触发）
app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (e, url) => {
        e.preventDefault()
        console.log('new-window prevented:', url)
    })
    // 阻止通过 window.open 创建新窗口
    contents.setWindowOpenHandler(({ url }) => {
        console.log('window.open prevented:', url)
        return { action: 'deny' }
    })
})

app.whenReady().then(() => {
    mainWindow.create("icon.ico")
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow.create()
        }
    })
    if (global.config.hasOwnProperty('regProtocol') && true === global.config.regProtocol) {
        func.registerProtocolClient()
    }

    // 检查启动参数，处理通过协议链接启动的情况（程序关闭后点击链接）
    console.log('Process argv:', process.argv)
    const protocolUrl = extractProtocolUrl(process.argv)
    if (protocolUrl) {
        console.log('Launched with protocol URL:', protocolUrl)
        // 延迟执行，确保窗口和页面已初始化
        setTimeout(() => {
            mainWindow.addXunLeiTask(protocolUrl)
        }, 3000)  // 3秒确保页面完全加载和初始化
    } else {
        console.log('No valid protocol URL found in argv')
    }
})

// 集中退出清理逻辑
let forceExitTimer = null
let cleanupDone = false
app.on('before-quit', (e) => {
    // 如果已经清理过，直接放行，避免重复清理
    if (cleanupDone) {
        console.log('before-quit: already cleaned, skipping')
        return
    }

    // 第一次进入，标记为退出中
    global.__isQuitting = true
    cleanupDone = true
    console.log('before-quit: cleaning up')

    // 清理定时器
    try { mainWindow.cleanupTimers() } catch (err) { console.log('cleanupTimers error:', err) }

    // 销毁窗口和所有资源
    try { mainWindow.destroyWindow() } catch (err) { console.log('destroyWindow error:', err) }

    // 销毁tray
    try { tray.destroy() } catch (err) { console.log('tray destroy error:', err) }

    // 不注销协议处理器，退出后仍应能通过链接唤起客户端
    // 只有在卸载程序时才应该注销协议

    console.log('cleanup completed, exiting in 1s')

    // 兜底：1秒后强制退出，不再等待
    if (!forceExitTimer) {
        forceExitTimer = setTimeout(() => {
            console.log('force exit now')
            app.exit(0)
        }, 1000)
    }
})

app.on('will-quit', () => {
    console.log('will-quit fired')
    try { mainWindow.cleanupTimers() } catch (_) {}
    // 不注销协议处理器
})

app.on('window-all-closed', () => {
    console.log('window-all-closed fired')
    // 如果已经在退出流程中，不再调用 app.quit()，避免重复触发 before-quit
    if (global.__isQuitting) {
        console.log('already quitting, skip app.quit()')
        return
    }
    // 不注销协议处理器
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// 额外兜底：监听 quit 事件，确保退出被执行
app.on('quit', () => {
    console.log('quit event fired, app exiting')
})


const additionalData = {myKey: 'myValue'}
const gotTheLock = app.requestSingleInstanceLock(additionalData)

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
        console.log('second-instance commandLine:', commandLine)
        
        // 先确保窗口可见、再触发任务，避免显示/隐藏闪烁
        if (mainWindow.win) {
            try {
                if (!mainWindow.win.isVisible()) {
                    console.log('Window not visible, showing...')
                    mainWindow.win.show()
                }
                if (mainWindow.win.isMinimized()) {
                    console.log('Window minimized, restoring...')
                    mainWindow.win.restore()
                }
                mainWindow.win.focus()
            } catch (e) {
                console.log('Error showing window:', e)
            }
        }
        
        // 从 commandLine 中提取有效的协议链接，过滤掉快捷方式等参数
        const protocolUrl = extractProtocolUrl(commandLine)
        
        if (protocolUrl) {
            console.log('Valid protocol URL found:', protocolUrl)
            mainWindow.addXunLeiTask(protocolUrl)
        } else {
            console.log('No valid protocol URL in second-instance, ignoring')
        }
    })
}