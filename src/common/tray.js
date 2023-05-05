const {app, Tray, Menu, nativeImage} = require('electron')
const path = require('path')
require('./global')
const isMac = process.platform === 'darwin'

let tray

app.whenReady().then(() => {

    const appPath = app.isPackaged ? path.dirname(app.getPath('exe'))+"/resources/app.asar" : app.getAppPath();
    tray = new Tray(appPath + "/src/icon.png")

    const contextMenu = Menu.buildFromTemplate([
        {
            label: global.lang.getLang('menu', 'configNasUrl'),
            role: '',
            click: async () => {
                require('../module/mainWindow/mainWindow').loadDefaultHTML()
            }
        },
        {
            label: global.lang.getLang('menu', 'logout'),
            role: '',
            click: async () => {
                require('../module/mainWindow/mainWindow').logout()
            }
        },
        {
            label: global.lang.getLang('menu', 'hideMainWindow'),
            role: '',
            click: async () => {
                require('../module/mainWindow/mainWindow').hide()
            }
        },
        {
            label: global.lang.getLang('menu', 'showMainWindow'),
            role: '',
            click: async () => {
                require('../module/mainWindow/mainWindow').show()
            }
        },
        isMac ?
            {label: global.lang.getLang('menu', 'quitApp'), role: 'close'} :
            {label: global.lang.getLang('menu', 'quitApp'), role: 'quit'}
    ])

    tray.setToolTip(global.lang.getLang('menu', 'title'))
    tray.setContextMenu(contextMenu)

    tray.on('click', () => {
        require('../module/mainWindow/mainWindow').show()
    })
})