const {app, Tray, Menu, nativeImage} = require('electron')
require('./global')
const isMac = process.platform === 'darwin'

let tray

app.whenReady().then(() => {
    let imageURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABmJLR0QA/wD/AP+gvaeTAAABkklEQVRoge2YsU7DMBCG/z80YWQACSTKE7AyMMEOS+EJmLL1fejWmQmQEM+AWHmDdkCIiTGGHEMTqUCd0vpcE+RPqlTFju8+2Y4vAVoOfQwqV9gw6+kFShxUUR7TzAx5gjftWOoCxW16iBLXALanrwv4TEgv65kHzXiqAnKHHWPSJwCbli6vaWn2eY4XrZiJ1kAAUJisD3vyALBVMOtrxlQVIOXoF32OVWPaGt5v1k5FOBBwVzPgohAypkjeOfu4n9VunQERXoZOHgAE7JZMBrZ2uwDY9ZPSUuzZGlT3QAiiQGiiQGhaL9DxMajIzxNSANBD7asuIDI7UTa0uaC/hJoS9DADrd8DUSA0USA0USA0USA0UQDApFKrfk21Dvm1ryiEdirmBFV5w28X594wQaM0cpoBL1+GF8R9CbmsA4U15C5Qr+tl73VEZxO7SDii9xgNJKF7DgSQ8PNKuUIJPycxgbJ+5tf/PeHlswoAJFMzkXg8MP5vLUTIeJWJzGFka7ALiOR/RGJESh46iUgkEpnNJ/PrWtFBIIjAAAAAAElFTkSuQmCC"
    const icon = nativeImage.createFromDataURL(imageURL)
    tray = new Tray(icon)

    const contextMenu = Menu.buildFromTemplate([
        isMac ?
            {label: global.lang.getLang('menu', 'quitApp'), role: 'close'} :
            {label: global.lang.getLang('menu', 'quitApp'), role: 'quit'},
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
        }
    ])

    tray.setToolTip(global.lang.getLang('menu', 'title'))
    tray.setContextMenu(contextMenu)

    tray.on('click',()=>{
        require('../module/mainWindow/mainWindow').show()
    })
})