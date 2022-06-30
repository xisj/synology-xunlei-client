const {clipboard, app, protocol} = require('electron')

module.exports.fixNasURL = (_nasURL) => {
    let _url = _nasURL
    let schema = ""

    if (_nasURL.indexOf('https://') > -1) {
        schema = "https://"
        _nasURL = _nasURL.replace("https://", "")
    } else {
        _nasURL = _nasURL.replace("http://", "")
        schema = "http://"
    }
    _nasURL = _nasURL.replace("//", "/")
    return schema + _nasURL
}


module.exports.registerProtocolClient = () => {
    app.setAsDefaultProtocolClient('magnet', process.execPath);
    app.setAsDefaultProtocolClient('ed2k', process.execPath);
    app.setAsDefaultProtocolClient('thunder', process.execPath);
    app.setAsDefaultProtocolClient('thunderx', process.execPath);
    app.setAsDefaultProtocolClient('ftp', process.execPath);
    // protocol.registerFileProtocol('magnet', (request, callback) => {
    //     console.log("protocol:magnet", request)
    // })
}


module.exports.unRegisterProtocolClient = () => {
    app.removeAsDefaultProtocolClient('magnet', process.execPath);
    app.removeAsDefaultProtocolClient('ed2k', process.execPath);
    app.removeAsDefaultProtocolClient('thunder', process.execPath);
    app.removeAsDefaultProtocolClient('thunderx', process.execPath);
    app.removeAsDefaultProtocolClient('ftp', process.execPath);
}

