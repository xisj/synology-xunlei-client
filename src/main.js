const {app, protocol, clipboard, BrowserWindow} = require('electron')
require('./common/global')
const func = require('./common/func')
require('./common/menu')
const tray = require('./common/tray')
const mainWindow = require('./module/mainWindow/mainWindow')


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

})

// 集中退出清理逻辑
let forceExitTimer = null
app.on('before-quit', () => {
    global.__isQuitting = true
    console.log('before-quit: cleaning up')
    try { mainWindow.cleanupTimers() } catch (_) {}
    try { tray.destroy() } catch (_) {}
    try { func.unRegisterProtocolClient() } catch (_) {}
    // 兜底：3秒内若仍未退出，强制结束所有子进程
    if (!forceExitTimer) {
        forceExitTimer = setTimeout(() => {
            console.log('force exit after timeout')
            try { app.exit(0) } catch (_) { process.exit(0) }
        }, 3000)
        forceExitTimer.unref && forceExitTimer.unref()
    }
})

app.on('will-quit', () => {
    try { mainWindow.cleanupTimers() } catch (_) {}
    try { func.unRegisterProtocolClient() } catch (_) {}
})

app.on('window-all-closed', () => {
    try { func.unRegisterProtocolClient() } catch (_) {}
    if (process.platform !== 'darwin') {
        app.quit()
    }
})


const additionalData = {myKey: 'myValue'}
const gotTheLock = app.requestSingleInstanceLock(additionalData)

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
        console.log(commandLine[2])
        // 先确保窗口可见、再触发任务，避免显示/隐藏闪烁
        if (mainWindow.win) {
            if (!mainWindow.win.isVisible()) mainWindow.win.show()
            if (mainWindow.win.isMinimized()) mainWindow.win.restore()
            mainWindow.win.focus()
        }
        mainWindow.addXunLeiTask(commandLine[2])
    })
}