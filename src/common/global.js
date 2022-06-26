const path = require('path')
const fs = require('fs')
global.configFile = path.join(path.dirname(__dirname), "/config.json")
global.config = {}
if (fs.existsSync(global.configFile)) {
    global.config = JSON.parse(fs.readFileSync(global.configFile))
}

global.langDefault = "zh-CN"
global.lang = require(path.join(path.dirname(__dirname), "/lang/lang"))