const {BrowserWindow, ipcMain, clipboard} = require('electron')
const path = require('path')
const fs = require('fs')
let win
module.exports.win = win
module.exports.create = async () => {
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
            _xunleiURL = global.config.nasURL + "/webman/3rdparty/pan-xunlei-com/index.cgi/#/home"
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
    win.webContents.on('did-finish-load', (e, errorCode, errorMsg, validateURL, isMainFrame) => {
        console.log("did-finish-load", errorCode, errorMsg, validateURL, isMainFrame)
        // checkNasLoginStatus(global.config.nasURL)
    })

    win.webContents.on('did-frame-finish-load', (e, isMainFrame) => {
        console.log("did-frame-finish-load", isMainFrame)
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('dom-ready', (e) => {
        console.log("dom-ready")
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-navigate', (e, url, isMainFrame, httpResponseCode, httpStatusText) => {
        console.log("did-navigate", url, isMainFrame, httpResponseCode, httpStatusText)
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-frame-navigate', (e, url, httpResponseCode, httpStatusText, isMainFrame) => {
        console.log("did-frame-navigate", url, httpResponseCode, httpStatusText, isMainFrame)
        // checkNasLoginStatus(global.config.nasURL)
    })
    win.webContents.on('did-navigate-in-page', (e, url, isMainFrame) => {
        console.log("did-navigate-in-page", url, isMainFrame)
        checkNasLoginStatus(global.config.nasURL)
    })

}

function loadDefaultHTML(code, action, msg) {
    console.log("loadDefaultHTML::::::", code, action, msg)
    win.loadFile(path.join(__dirname, 'mainWindow.html')).then(() => {
        setTimeout(() => {
            win.webContents.send('mainWindow-msg', global.lang.getMsg(code, action, msg))
            win.webContents.send('mainWindow-msg', global.lang.getMsg(code, "set-config", global.config))
        }, 1000)
    })
}

ipcMain.on('mainWindow-msg', (e, args) => {
    console.log('mainWindow-msg', global.config, args)
    if (!args.hasOwnProperty('action')) {
        event.reply('mainWindow-msg', global.lang.getMsg(2001, "show-err"))
        return
    }
    switch (args.action) {
        case "confirm-config":
            setConfig(args.data)
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

async function checkNasLoginStatus(_url) {
    return new Promise(resolve => {
        let has_id = false
        let has_stay_login = false
        win.webContents.session.cookies.get({url: _url}).then(cookies => {
            if (cookies.length > 0) {
                cookies.forEach((v, k) => {
                    if (v.hasOwnProperty('name')) {
                        if ('id' === v.name) {
                            console.log(v)
                            has_id = true
                        }
                        if ('stay_login' === v.name && '1' === v.value) {
                            console.log(v)
                            has_stay_login = true
                        }
                    }
                })
            }
            //群晖7.2 有 id 和 stay_login , stay_login='1'的时候才能自动登录
            if (has_id && has_stay_login) {
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
        var torrent = "magnet:?xt=urn:sha1:YNCKHTQCWBTRNJIV4WNAE52SJUQCZO5C";

        if (_txt.match(/magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32}/i) !== null) {
            // console.log("It's valid, bloody fantastic!");
        } else {
            _txt = ""
            return
        }
        console.log(_txt)

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

