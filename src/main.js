const {app, protocol, clipboard} = require('electron')
require('./common/global')
const func = require('./common/func')
require('./common/menu')
require('./common/tray')
const mainWindow = require('./module/mainWindow/mainWindow')


app.whenReady().then(() => {
    mainWindow.create()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow.create()
        }
    })
    func.registerProtocolClient()

})
app.on('will-quit', () => {
    func.unRegisterProtocolClient()
})
app.on('window-all-closed', () => {
    func.unRegisterProtocolClient()

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
        // Print out data received from the second instance.
        // console.log(commandLine, workingDirectory, additionalData)
        console.log(commandLine[2])
        // if(commandLine.hasOwnProperty(2)) {
        mainWindow.addXunLeiTask(commandLine[2])
        // }
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow.win) {
            if (mainWindow.win.isMinimized()) mainWindmainWindow.win.restore()
            mainWindow.win.focus()
        }
    })
}