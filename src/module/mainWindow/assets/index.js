(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const t of document.querySelectorAll('link[rel="modulepreload"]'))c(t);new MutationObserver(t=>{for(const s of t)if(s.type==="childList")for(const i of s.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&c(i)}).observe(document,{childList:!0,subtree:!0});function n(t){const s={};return t.integrity&&(s.integrity=t.integrity),t.referrerPolicy&&(s.referrerPolicy=t.referrerPolicy),t.crossOrigin==="use-credentials"?s.credentials="include":t.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function c(t){if(t.ep)return;t.ep=!0;const s=n(t);fetch(t.href,s)}})();const p=document.getElementById("app");p.innerHTML=`
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
`;const a=document.getElementById("nas-shared-path");if(a){let d=!1,e=!1;document.addEventListener("keydown",n=>{n.key==="Tab"&&(d=!0)}),document.addEventListener("mousedown",()=>{d=!1}),document.addEventListener("focusin",n=>{n.target!==a&&(e=!1)}),a.addEventListener("focus",()=>{!d||e||(d=!1,e=!0,a.click())})}const{ipcRenderer:l}=window.require("electron");function o(d,e){const n=document.getElementById(d);n&&(n.value=e??"")}function r(d,e){const n=document.getElementById(d);n&&(n.checked=!!e,n.setAttribute("aria-checked",!!e))}l.on("mainWindow-msg",(d,e)=>{console.log("ui2 mainWindow-msg",e),e.action==="set-config"&&e.data?e.data.hasOwnProperty("nasURL")&&(o("nas-url",e.data.nasURL),o("nas-shared-path",e.data.sharedPath),e.data.hasOwnProperty("regProtocol")&&r("reg-protocol",e.data.regProtocol),e.data.hasOwnProperty("showSpeedWindow")&&r("show-speed-window",e.data.showSpeedWindow)):e.action==="confirm-shared-path"&&e.data&&e.data.filePaths&&o("nas-shared-path",e.data.filePaths)});const u=document.getElementById("confirm-config");u&&u.addEventListener("click",()=>{l.send("mainWindow-msg",{action:"confirm-config",data:{nasURL:document.getElementById("nas-url")?document.getElementById("nas-url").value:"",regProtocol:document.getElementById("reg-protocol")?document.getElementById("reg-protocol").checked:!1,sharedPath:document.getElementById("nas-shared-path")?document.getElementById("nas-shared-path").value:"",showSpeedWindow:document.getElementById("show-speed-window")?document.getElementById("show-speed-window").checked:!1}})});a&&a.addEventListener("click",()=>{l.send("mainWindow-msg",{action:"confirm-shared-path",data:{nasURL:document.getElementById("nas-url")?document.getElementById("nas-url").value:""}})});
