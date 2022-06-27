const {app, BrowserWindow, ipcMain, clipboard, session, dialog} = require('electron')
const path = require('path')
const fs = require('fs')
let psl = require('psl');
let win
let xunleiPatch = "/webman/3rdparty/pan-xunlei-com/index.cgi/#/home"
module.exports.win = win


module.exports.create = async function create() {
    win = new BrowserWindow({
        width: 1070,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })
    if (global.config.hasOwnProperty('nasURL')) {
        // let _xunleiURL = global.config.nasURL + "/webman/3rdparty/pan-xunlei-com/index.cgi/#/home"
        let _xunleiURL = global.config.nasURL
        let canAutoLogin = await checkNasLoginStatus(global.config.nasURL).catch(e => {
            console.log(e)
        })
        if (canAutoLogin) {
            _xunleiURL = global.config.nasURL + xunleiPatch
        }
        win.loadURL(_xunleiURL).then(r => {
            if (canAutoLogin) {
                watchClipboard()
            }
        }).catch(e => {
            console.log("loadURL,catch", e)
            loadDefaultHTML(20001, 'show-err', e.toString())
        })
    } else {
        win.loadFile(path.join(__dirname, 'mainWindow.html'))
    }

    win.webContents.on('did-fail-load', (e, errorCode, errorMsg, validateURL, isMainFrame) => {
        console.log("did-fail-load", errorCode, errorMsg, validateURL, isMainFrame)
        loadDefaultHTML(20001, 'show-err', "did-fail-load:" + errorMsg)
    })
    win.webContents.on('did-finish-load', (e) => {
        console.log("did-finish-load")
        // checkNasLoginStatus(global.config.nasURL)
    })

    win.webContents.on('did-frame-finish-load', async (e, isMainFrame) => {
        console.log("did-frame-finish-load", isMainFrame)
    })
    win.webContents.on('dom-ready', (e) => {
        console.log("dom-ready")
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-navigate', async (e, url, isMainFrame, httpResponseCode, httpStatusText) => {
        console.log("did-navigate", url, isMainFrame, httpResponseCode, httpStatusText)
        if (global.config.nasURL.indexOf('http://') > -1) {
            $_nasURL = global.config.nasURL.replace('http://', 'https://')
        }
        if (global.config.nasURL.indexOf('https://') > -1) {
            $_nasURL = global.config.nasURL.replace('https://', 'http://')
        }
        if (await checkNasLoginStatus(global.config.nasURL)
            && ((url === global.config.nasURL || url === global.config.nasURL + "/")
                || (url === $_nasURL || url === $_nasURL + "/"))) {
            _xunleiURL = global.config.nasURL + xunleiPatch

            win.webContents.stop()
            win.webContents.loadURL(_xunleiURL)

        }
    })
    win.webContents.on('did-frame-navigate', (e, url, httpResponseCode, httpStatusText, isMainFrame) => {
        console.log("did-frame-navigate", url, httpResponseCode, httpStatusText, isMainFrame)
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-navigate-in-page', async (e, url, isMainFrame) => {
        console.log("did-navigate-in-page", url, isMainFrame)
        if (await checkNasLoginStatus(global.config.nasURL) && (url === global.config.nasURL || url === global.config.nasURL + "/")) {
            _xunleiURL = global.config.nasURL + xunleiPatch
            win.webContents.loadURL(_xunleiURL)
        }
    })

    win.on('close', (e) => {
        if (dialog.showMessageBoxSync(win, {
            type: "info",
            buttons: [global.lang.getLang('menu', 'minimize2tray'), global.lang.getLang('menu', 'doQuit')],
            title: global.lang.getLang('menu', 'caution'),
            message: global.lang.getLang('menu', 'areYouReallyWantQuit'),
            defaultId: 0,
            cancelId: 1
        }) === 0) {
            e.preventDefault();
            win.hide();
        } else {
            app.exit();
        }
    })

    win.on('minimize', (e) => {
        e.preventDefault();
        win.hide();
    })

}


function loadDefaultHTML(code, action, msg) {
    console.log("loadDefaultHTML::::::", code, action, msg)
    win.loadFile(path.join(__dirname, 'mainWindow.html')).then(() => {

    }).catch(e => {
        console.log(e)
    })
    setTimeout(() => {
        win.webContents.send('mainWindow-msg', global.lang.getMsg(code, action, msg))
        win.webContents.send('mainWindow-msg', global.lang.getMsg(code, "set-config", global.config))
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


ipcMain.on('mainWindow-msg', (e, args) => {
    console.log('mainWindow-msg', global.config, args)
    if (!args.hasOwnProperty('action')) {
        event.reply('mainWindow-msg', global.lang.getMsg(2001, "show-err"))
        return
    }
    switch (args.action) {
        case "confirm-config":
            if (setConfig(args.data)) {
                win.loadURL(args.data.nasURL)
            }
            break
    }
})

function setConfig(data = {}) {
    let oldData = global.config
    if (fs.existsSync(global.configFile)) {
        oldData = JSON.parse(fs.readFileSync(global.configFile))
    }
    if (typeof (data) != "object") {
        return false
    }
    for (var key in data) {
        oldData[key] = data[key]
    }
    fs.writeFileSync(global.configFile, JSON.stringify(oldData))
    global.config = oldData
    return true
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
    )
}

async function checkNasLoginStatus(_url) {
    return new Promise(resolve => {
        let has_id = false
        let has_stay_login = false
        let has_syno_cookie_policy = ''
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
            //群晖7.2 有 id 和 stay_login , stay_login='1'的时候才能自动登录
            if (has_id && has_stay_login && has_syno_cookie_policy) {
                resolve(true)
            } else {
                resolve(false)
            }
        })
    })


}

let oldTxt = ""

function watchClipboard() {
    clipboard.clear()
    setInterval(() => {
        let _txt = clipboard.readText()

        var reg = /.+(thunder[^"]+)[^>]+[>]{1}([^<]+)/g;

        if (_txt.match(/magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32}/i) !== null) {
            // console.log("It's valid, bloody fantastic!");
        } else {
            _txt = ""
            return
        }

        if (_txt != oldTxt) {
            oldTxt = _txt
            win.webContents.executeJavaScript(`
        document.querySelector('.create__task').click()
        `).then(r => {
                win.webContents.executeJavaScript(`
            document.querySelector('.el-textarea__inner').value=""
            `).then(r => {
                    // win.focus()
                    win.webContents.executeJavaScript(`
                // document.querySelector('.el-textarea__inner').value="${_txt}"
                document.querySelector('.el-textarea__inner').focus()
                `).then(r => {

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

                        if (win.isMinimized()) {
                            win.restore()
                        }
                        win.setAlwaysOnTop(true)
                        setTimeout(() => {
                            win.setAlwaysOnTop(false)
                        }, 1000)
                    }).catch(e => {
                        console.log(e)
                    })
                }).catch(e => {
                    console.log(e)
                })
            }).catch(e => {
                console.log(e)
            })

        }

    }, 1000)
}

