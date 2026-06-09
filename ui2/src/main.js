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
              <input id="reg-protocol" class="native-switch" type="checkbox" />
              <span class="switch-ui"></span>
            </div>
          </label>

          <label class="toggle-card" for="show-speed-window">
            <div>
              <div class="toggle-title">显示速度球</div>
              <div class="toggle-desc">控制速度球的启动、显示与销毁。</div>
            </div>
            <div class="toggle-wrap">
              <input id="show-speed-window" class="native-switch" type="checkbox" />
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
