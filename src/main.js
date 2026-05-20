const {app, protocol, clipboard, BrowserWindow} = require('electron')
require('./common/global')
const func = require('./common/func')
require('./common/menu')
const tray = require('./common/tray')
const mainWindow = require('./module/mainWindow/mainWindow')

// 禁用硬件加速，减少GPU进程残留的可能性
app.disableHardwareAcceleration()
console.log('Hardware acceleration disabled')

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
    
    // 注销协议
    try { func.unRegisterProtocolClient() } catch (err) { console.log('unRegister error:', err) }
    
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
    try { func.unRegisterProtocolClient() } catch (_) {}
})

app.on('window-all-closed', () => {
    console.log('window-all-closed fired')
    // 如果已经在退出流程中，不再调用 app.quit()，避免重复触发 before-quit
    if (global.__isQuitting) {
        console.log('already quitting, skip app.quit()')
        return
    }
    try { func.unRegisterProtocolClient() } catch (_) {}
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