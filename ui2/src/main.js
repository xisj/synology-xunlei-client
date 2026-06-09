import './style.css'

const app = document.getElementById('app')

app.innerHTML = `
  <div class="page-shell">
    <main class="settings-card">
      <section class="panel">
        <div class="panel-header">
          <h2>Nas 迅雷设置中心</h2>
        </div>

        <div class="form-grid">
          <label class="field field-inline field-wide">
            <span class="field-label">Nas首页地址</span>
            <input id="nas-url" class="text-input" type="text" placeholder="例如：http://nas" />
          </label>

          <label class="field field-inline field-wide field-clickable">
            <span class="field-label">迅雷共享文件夹</span>
            <input id="nas-shared-path" class="text-input" type="text" placeholder="点击选择共享文件夹" readonly />
          </label>

          <label class="toggle-card" for="reg-protocol">
            <div>
              <div class="toggle-title">点击链接后自动弹窗</div>
              <div class="toggle-desc">注册协议后可直接拉起客户端添加任务。</div>
            </div>
            <div class="toggle-wrap">
              <input id="reg-protocol" class="native-switch" type="checkbox" checked />
              <span class="switch-ui"></span>
            </div>
          </label>

          <label class="toggle-card" for="show-speed-window">
            <div>
              <div class="toggle-title">显示速度球</div>
              <div class="toggle-desc">控制速度球的启动、显示与销毁。</div>
            </div>
            <div class="toggle-wrap">
              <input id="show-speed-window" class="native-switch" type="checkbox" checked />
              <span class="switch-ui"></span>
            </div>
          </label>
        </div>

        <div class="action-row">
          <button id="confirm-config" class="primary-button" type="button">保存配置</button>
        </div>
      </section>
    </main>
  </div>
`

const sharedPathInput = document.getElementById('nas-shared-path')
if (sharedPathInput) {
  let tabFocusArmed = false
  let suppressRepeatedFocusOpen = false

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      tabFocusArmed = true
    }
  })

  document.addEventListener('mousedown', () => {
    tabFocusArmed = false
  })

  document.addEventListener('focusin', (event) => {
    if (event.target !== sharedPathInput) {
      suppressRepeatedFocusOpen = false
    }
  })

  sharedPathInput.addEventListener('focus', () => {
    if (!tabFocusArmed || suppressRepeatedFocusOpen) return
    tabFocusArmed = false
    suppressRepeatedFocusOpen = true
    sharedPathInput.click()
  })
}

// IPC 通信
const { ipcRenderer } = window.require('electron')

function setValue(id, value) {
  const el = document.getElementById(id)
  if (!el) return
  el.value = value == null ? '' : value
}

function setChecked(id, checked) {
  const el = document.getElementById(id)
  if (!el) return
  el.checked = !!checked
  el.setAttribute('aria-checked', !!checked)
}

// 监听配置消息
ipcRenderer.on('mainWindow-msg', (e, args) => {
  console.log('ui2 mainWindow-msg', args)
  if (args.action === 'set-config' && args.data) {
    if (args.data.hasOwnProperty('nasURL')) {
      setValue('nas-url', args.data.nasURL)
      setValue('nas-shared-path', args.data.sharedPath)
      // 如果配置中有这两个选项的值，则使用配置的值；否则保持默认选中状态
      if (args.data.hasOwnProperty('regProtocol')) {
        setChecked('reg-protocol', args.data.regProtocol)
      }
      if (args.data.hasOwnProperty('showSpeedWindow')) {
        setChecked('show-speed-window', args.data.showSpeedWindow)
      }
    }
  } else if (args.action === 'confirm-shared-path' && args.data && args.data.filePaths) {
    setValue('nas-shared-path', args.data.filePaths)
  }
})

// 绑定保存按钮
const confirmBtn = document.getElementById('confirm-config')
if (confirmBtn) {
  confirmBtn.addEventListener('click', () => {
    ipcRenderer.send('mainWindow-msg', {
      action: 'confirm-config',
      data: {
        nasURL: document.getElementById('nas-url') ? document.getElementById('nas-url').value : '',
        regProtocol: document.getElementById('reg-protocol') ? document.getElementById('reg-protocol').checked : false,
        sharedPath: document.getElementById('nas-shared-path') ? document.getElementById('nas-shared-path').value : '',
        showSpeedWindow: document.getElementById('show-speed-window') ? document.getElementById('show-speed-window').checked : false,
      }
    })
  })
}

// 绑定共享文件夹选择
if (sharedPathInput) {
  sharedPathInput.addEventListener('click', () => {
    ipcRenderer.send('mainWindow-msg', {
      action: 'confirm-shared-path',
      data: {
        nasURL: document.getElementById('nas-url') ? document.getElementById('nas-url').value : ''
      }
    })
  })
}
