const {app, BrowserWindow, ipcMain, clipboard, session, dialog} = require('electron')
const path = require('path')
const fs = require('fs')
const func = require('../../common/func')
require('../../common/global')
let psl = require('psl');
let win
module.exports.win = win

function getXunleiURL(_nasURL) {
    let xunleiPatch = "/webman/3rdparty/pan-xunlei-com/index.cgi/#/home"
    let _url = _nasURL
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

module.exports.create = async function create() {
    win = new BrowserWindow({
        width: 1070,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
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
            loadDefaultHTML(20001, 'show-err', e.toString())
        })
    } else {
        win.loadFile(path.join(__dirname, 'mainWindow.html'))
    }

    win.webContents.on('context-menu', async (e, params) => {
        console.log('context-menu', "" !== clipboard.readText(), true === await isInXunleiApp())
        if ("" !== clipboard.readText() && true === await isInXunleiApp()) {
            addXunLeiTask(clipboard.readText())
        } else {
            console.log('context-menu: doCtrlV', clipboard.readText())
            doCtrlV(params.x, params.y)
        }
    })

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
    console.log('mainWindow-msg', global.config, args)
    if (!args.hasOwnProperty('action')) {
        event.reply('mainWindow-msg', global.lang.getMsg(2001, "show-err"))
        return
    }
    switch (args.action) {
        case "confirm-config":
            if (setConfig(args.data)) {
                win.loadURL(global.config.nasURL)
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
    global.config.nasURL = func.fixNasURL(global.config.nasURL)
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
    ).catch(e=>{
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
            console.log("checkNasLoginStatus：has_id,has_stay_login,has_syno_cookie_policy", has_id, has_stay_login, has_syno_cookie_policy)

            //群晖7.2 有 id 和 stay_login , stay_login='1'的时候才能自动登录
            if (has_id && has_stay_login) {
                resolve(true)
            } else {
                resolve(false)
            }
        }).catch(e=>{
            console.log("cannot get cookie:",parsed.domain)
        })
    })


}

let oldTxt = ""

function watchClipboard() {
    clipboard.clear()
    setInterval(() => {
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

var isInXunleiApp = async function () {
    return new Promise(resolve => {
        win.webContents.executeJavaScript(`
    document.querySelector('.create__task')
    `).then(r => {
            if (null === r) {
                //说明不在迅雷页面，没有创建任务按钮
                console.log("addXunLeiTask:not in xunlei app")
                resolve(false)
            } else {
                resolve(true)
            }
        }).catch(e=>{
            console.log("isInXunleiApp：fail:",e)
            resolve(false)
        })
    })
}

var addXunLeiTask = function (_txt) {
    console.log("addXunLeiTask:", _txt)
    if ("" === _txt.trim()) {
        console.log("addXunLeiTask:txt empty")
        return
    }
    win.webContents.executeJavaScript(`
    document.querySelector('.create__task')
    `).then(r => {
        if (null === r) {
            //说明不在迅雷页面，没有创建任务按钮
            console.log("addXunLeiTask:not in xunlei app")
            return false
        }
        win.webContents.executeJavaScript(`
        document.querySelector('.create__task').click()
        `).then(r => {
            win.webContents.executeJavaScript(`
            document.querySelector('.el-textarea__inner').value=""
            `).then(r => {
                // win.focus()
                clipboard.writeText(_txt)
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
    }).catch(e=>{
        console.log('create__task not exists',e)
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
