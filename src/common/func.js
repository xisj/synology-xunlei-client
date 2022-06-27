const {clipboard} = require('electron')

module.exports.fixNasURL = (_nasURL) => {
    let _url = _nasURL
    let schema = ""

    if (_nasURL.indexOf('https://') > -1) {
        schema = "https://"
        _nasURL = _nasURL.replace("https://", "")
    } else {
        schema = "http://"
    }
    _nasURL = _nasURL.replace("//", "/")
    return schema + _nasURL
}
