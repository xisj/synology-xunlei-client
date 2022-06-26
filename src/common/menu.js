const {app, Menu, shell} = require('electron')
require('./global')
const isMac = process.platform === 'darwin'

const template = [
    // { role: 'appMenu' }
    ...(isMac ? [{
        label: app.name,
        submenu: [
            {role: 'about'},
            {type: 'separator'},
            {role: 'services'},
            {type: 'separator'},
            {role: 'hide'},
            {role: 'hideOthers'},
            {role: 'unhide'},
            {type: 'separator'},
            {role: 'quit'}
        ]
    }] : []),
    // { role: 'fileMenu' }
    {
        label: global.lang.getLang('menu', 'startMenu'),
        submenu: [
            isMac ?
                {label: global.lang.getLang('menu', 'quitApp'), role: 'close'} :
                {label: global.lang.getLang('menu', 'quitApp'), role: 'quit'}

        ]
    },
    {
        label: global.lang.getLang('menu', 'userMenu'),
        submenu: [
            {label: global.lang.getLang('menu', 'logout'), role: ''}

        ]
    },

    // { role: 'viewMenu' }
    {
        label: 'View',
        submenu: [
            {role: 'reload'},
            {role: 'forceReload'},
            {role: 'toggleDevTools'},
            {type: 'separator'},
            {role: 'resetZoom'},
            {role: 'zoomIn'},
            {role: 'zoomOut'},
            {type: 'separator'},
            {role: 'togglefullscreen'}
        ]
    },
    // { role: 'windowMenu' }
    {
        label: 'Window',
        submenu: [
            {role: 'minimize'},
            {role: 'zoom'},
            ...(isMac ? [
                {type: 'separator'},
                {role: 'front'},
                {type: 'separator'},
                {role: 'window'}
            ] : [
                {role: 'close'}
            ])
        ]
    },
    {
        role: 'help',
        label: global.lang.getLang('menu', 'aboutMe'),
        submenu: [
            {
                label:  global.lang.getLang('menu', 'homepage'),
                click: async () => {
                    const {shell} = require('electron')
                    await shell.openExternal('http://xisj.com')
                }
            },
            {
                label:  global.lang.getLang('menu', 'weibo'),
                click: async () => {
                    const {shell} = require('electron')
                    await shell.openExternal('https://weibo.com/iamlive798/home')
                }
            }
        ]
    }
]

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)