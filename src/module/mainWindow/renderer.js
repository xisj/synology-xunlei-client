const {ipcRenderer} = window.require('electron')
ipcRenderer.on('mainWindow-msg', (e, args) => {
    console.log('mainWindow-msg', args)
    if (!args.hasOwnProperty('action')) {
        _msg.msg = ""
        event.reply('mainWindow-msg', global.lang.getMsg(2000, "show-err"))
    }
    switch (args.action) {
        case 'show-err':
            document.body.append(JSON.stringify(args))
            break
        case 'set-config':
            if (args.data.hasOwnProperty('nasURL')) {
                document.getElementById('nas-url').value = args.data.nasURL
            }
            break
    }
})


document.getElementById("confirm-config").addEventListener('click', () => {
    console.log(document.getElementById('nas-url').value)
    ipcRenderer.send('mainWindow-msg', {
        action: "confirm-config",
        data: {
            nasURL: document.getElementById('nas-url').value
        }
    })
})