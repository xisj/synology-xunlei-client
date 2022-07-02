const {ipcRenderer, clipboard} = window.require('electron')

window.onload = function () {
    let addButtonIntervalID = -1
    addButtonIntervalID = setInterval(() => {
        if (null !== document.querySelector('.switch__status')) {
            document.querySelector('.switch__status').appendChild(parseElement('<div class="switch_item" style="margin-left: 50px" id="nas-xunlei-openfolder-btn"><span class="status__text" data-v-nasxunleiapp="">【打开迅雷下载文件夹】</span></div>'))
            clearInterval(addButtonIntervalID)
            document.querySelector('#nas-xunlei-openfolder-btn').addEventListener('click', () => {
                ipcRenderer.send('mainWindow-msg', {
                    action: "open-shared-path"
                })
            })
        }
    }, 1000)
}

function parseElement(htmlString) {
    return new DOMParser().parseFromString(htmlString, 'text/html').body.childNodes[0]
}

function addXunleiTask(_url) {
    if(null !== document.querySelector('.create__task')) {

    }
}