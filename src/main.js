const {app} = require('electron')
require('./common/global')
require('./common/menu')
const mainWindow = require('./module/mainWindow/mainWindow')


app.whenReady().then(() => {
    mainWindow.create()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            mainWindow.create()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

