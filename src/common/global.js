const {app} = require('electron')
const path = require('path')
const fs = require('fs')
const func = require('./func')

global.configFile = path.join(path.dirname(__dirname), "/config.json")
if (app.isPackaged) {
    global.configFile = path.join(path.dirname(app.getPath('exe')), "/config.json")
}
global.config = {}
if (fs.existsSync(global.configFile)) {
    global.config = JSON.parse(fs.readFileSync(global.configFile))
    global.config.nasURL = func.fixNasURL(global.config.nasURL)
}

global.langDefault = "zh-CN"
global.lang = require(path.join(path.dirname(__dirname), "/lang/lang"))

module.exports = function () {
    console.log("global init")
}
