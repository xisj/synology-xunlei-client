const {app} = require('electron')
const fs = require('fs')
const path = require('path')
let locale = global.langDefault
let langList = {}
module.exports.setLang = (localeValue = "") => {
    if ("" !== localeValue) {
        if (fs.existsSync(path.join(__dirname, localeValue, 'msg.json'))) {
            locale = localeValue
            return locale
        }
    }
    if (fs.existsSync(path.join(__dirname, locale, 'msg.json'))) {
        return locale
    }
    if (fs.existsSync(path.join(__dirname, app.getLocale(), 'msg.json'))) {
        locale = app.getLocale()
        return locale
    }
    if (fs.existsSync(path.join(__dirname, global.langDefault, 'msg.json'))) {
        locale = global.langDefault
        return locale
    }
    console.log(path.join(__dirname, locale))
}

module.exports.getMsg = (code, action, data = "") => {
    return {
        code: code,
        action: action,
        msg: getLang("msg", code),
        data: data
    }
}

function getLang(file, key) {
    if (typeof (key) != "string") {
        key = "" + key
    }
    if (langList.hasOwnProperty(file)
        && langList[file].hasOwnProperty(key)) {
        return langList[file][key]
    }

    if (fs.existsSync(path.join(__dirname, locale, file + '.json'))) {
        let _l = JSON.parse(fs.readFileSync(path.join(__dirname, locale, file + '.json')))
        if (_l.hasOwnProperty(key)) {
            if (!langList.hasOwnProperty(file)) {
                langList[file] = {}
            }
            langList[file][key] = _l[key]
            return langList[file][key]
        }
    }

    if (fs.existsSync(path.join(__dirname, app.getLocale(), file + '.json'))) {
        let _l = JSON.parse(fs.readFileSync(path.join(__dirname, app.getLocale(), file + '.json')))
        if (_l.hasOwnProperty(key)) {
            langList[file][key] = _l[key]
            return langList[file][key]
        }
    }

    if (fs.existsSync(path.join(__dirname, global.langDefault, file + '.json'))) {
        let _l = JSON.parse(fs.readFileSync(path.join(__dirname, global.langDefault, file + '.json')))
        if (_l.hasOwnProperty(key)) {
            langList[file][key] = _l[key]
            return langList[file][key]
        }
    }
    return "error,lang " + file + ":" + key + " not exists"


}

module.exports.getLang = getLang
module.exports.locale = locale
