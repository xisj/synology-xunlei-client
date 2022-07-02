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
                document.getElementById('nas-shared-path').value = args.data.sharedPath
                console.log(args.data)
                if (args.data.hasOwnProperty('regProtocol')) {
                    document.getElementById('reg-protocol').checked = args.data.regProtocol
                }

            }
            break
        case 'confirm-shared-path':
            if (args.data.hasOwnProperty('filePaths')) {
                document.getElementById('nas-shared-path').value = args.data.filePaths
                document.getElementById('nas-shared-path').style.display = "block"
            }
            break
    }
})

setTimeout(() => {

    document.getElementById("confirm-config").addEventListener('click', () => {
        console.log(document.getElementById('nas-url').value)
        ipcRenderer.send('mainWindow-msg', {
            action: "confirm-config",
            data: {
                nasURL: document.getElementById('nas-url').value,
                regProtocol: document.getElementById('reg-protocol').checked,
                sharedPath: document.getElementById('nas-shared-path').value,
            }
        })
    })
    document.getElementById("nas-shared-path").addEventListener('click', () => {
        ipcRenderer.send('mainWindow-msg', {
            action: "confirm-shared-path",
            data: {
                nasURL: document.getElementById('nas-url').value
            }
        })
    })
}, 1000)