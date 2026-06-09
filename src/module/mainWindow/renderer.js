const {ipcRenderer} = window.require('electron')
function getEl(id) {
    return document.getElementById(id)
}

function setValue(id, value) {
    const el = getEl(id)
    if (!el) return
    el.value = value == null ? '' : value
}

function setChecked(id, checked) {
    const el = getEl(id)
    if (!el) return
    el.checked = !!checked
    el.setAttribute('aria-checked', !!checked)
}

function bindEvents() {
    const confirmBtn = getEl('confirm-config')
    const sharedPathEl = getEl('nas-shared-path')
    if (confirmBtn && !confirmBtn.dataset.bound) {
        confirmBtn.dataset.bound = '1'
        confirmBtn.addEventListener('click', () => {
            ipcRenderer.send('mainWindow-msg', {
                action: 'confirm-config',
                data: {
                    nasURL: getEl('nas-url') ? getEl('nas-url').value : '',
                    regProtocol: getEl('reg-protocol') ? getEl('reg-protocol').checked : false,
                    sharedPath: getEl('nas-shared-path') ? getEl('nas-shared-path').value : '',
                    showSpeedWindow: getEl('show-speed-window') ? getEl('show-speed-window').checked : false,
                }
            })
        })
    }

    if (sharedPathEl && !sharedPathEl.dataset.bound) {
        sharedPathEl.dataset.bound = '1'
        sharedPathEl.addEventListener('click', () => {
            ipcRenderer.send('mainWindow-msg', {
                action: 'confirm-shared-path',
                data: {
                    nasURL: getEl('nas-url') ? getEl('nas-url').value : ''
                }
            })
        })
    }
}

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
                setValue('nas-url', args.data.nasURL)
                setValue('nas-shared-path', args.data.sharedPath)
                console.log(args.data)
                if (args.data.hasOwnProperty('regProtocol')) {
                    setChecked('reg-protocol', args.data.regProtocol)
                }
                if (args.data.hasOwnProperty('showSpeedWindow')) {
                    setChecked('show-speed-window', args.data.showSpeedWindow)
                }

            }
            break
        case 'confirm-shared-path':
            if (args.data.hasOwnProperty('filePaths')) {
                setValue('nas-shared-path', args.data.filePaths)
                if (getEl('nas-shared-path')) {
                    getEl('nas-shared-path').style.display = 'block'
                }
            }
            break
    }
})

window.addEventListener('DOMContentLoaded', bindEvents)
setTimeout(bindEvents, 300)
setTimeout(bindEvents, 1000)
