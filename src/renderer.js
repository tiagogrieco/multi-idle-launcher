const slotsRow = document.getElementById('slots-row');
const layoutSelect = document.getElementById('layoutSelect');
const statusEl = document.getElementById('status');
const profileName = document.getElementById('profileName');
const profileSelect = document.getElementById('profileSelect');
const placeholders = document.getElementById('placeholders');
const liteMode = document.getElementById('liteMode');
const keepBg = document.getElementById('keepBg');
const btnExt = document.getElementById('btnExt');
const extPanel = document.getElementById('extPanel');
const btnUpdate = document.getElementById('btnUpdate');

let lastSlots = [];

function renderSlots(slots) {
  lastSlots = slots;
  slotsRow.innerHTML = '';
  slots.forEach((s) => {
    const box = document.createElement('div');
    box.className = 'slot-ctrl';
    box.innerHTML = `
      <span>#${s.slot + 1}</span>
      <input type="text" value="${s.url}" data-slot="${s.slot}" class="url-input" />
      <button data-act="go" data-slot="${s.slot}">Ir</button>
      <button data-act="reload" data-slot="${s.slot}">⟳</button>
      <button data-act="dev" data-slot="${s.slot}">DevTools</button>
      <button data-act="inject" data-slot="${s.slot}">Script</button>
      <button data-act="suspend" data-slot="${s.slot}" class="${s.suspended ? 'on' : ''}"
        title="${s.suspended ? 'Retomar slot (recria o processo)' : 'Suspender slot (libera a RAM, mantém login)'}">💤</button>
      <button data-act="media" data-slot="${s.slot}" class="${s.blockMedia ? 'on' : ''}"
        title="${s.blockMedia ? 'Imagens/mídia bloqueadas — clique pra liberar' : 'Bloquear imagens/mídia (economiza RAM)'}">🖼</button>
      <span class="ram" data-ram="${s.slot}">${s.suspended ? 'susp.' : '…'}</span>
    `;
    slotsRow.appendChild(box);
  });
  renderPlaceholders(slots);
}

function renderPlaceholders(slots) {
  placeholders.innerHTML = '';
  slots.forEach((s) => {
    if (!s.suspended || !s.rect) return;
    const div = document.createElement('div');
    div.className = 'placeholder';
    div.style.left = `${s.rect.x}px`;
    div.style.top = `${s.rect.y}px`;
    div.style.width = `${s.rect.width}px`;
    div.style.height = `${s.rect.height}px`;
    div.innerHTML = `<div style="font-size:24px">💤</div><div>Slot ${s.slot + 1} suspenso — clique para retomar</div>`;
    div.addEventListener('click', () => window.launcher.toggleSuspend(s.slot));
    placeholders.appendChild(div);
  });
}

slotsRow.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const slot = Number(btn.dataset.slot);
  const act = btn.dataset.act;
  if (act === 'go') {
    const input = slotsRow.querySelector(`input[data-slot="${slot}"]`);
    await window.launcher.navigate(slot, input.value.trim());
  } else if (act === 'reload') {
    await window.launcher.reload(slot);
  } else if (act === 'dev') {
    await window.launcher.devtools(slot);
  } else if (act === 'inject') {
    const code = prompt('Cole o script (JS) a executar neste slot:');
    if (code) {
      const res = await window.launcher.inject(slot, code);
      statusEl.textContent = res.ok ? `slot ${slot + 1}: ok` : `slot ${slot + 1}: erro ${res.error}`;
    }
  } else if (act === 'suspend') {
    await window.launcher.toggleSuspend(slot);
  } else if (act === 'media') {
    await window.launcher.toggleMedia(slot);
  }
});

layoutSelect.addEventListener('change', async () => {
  const [rows, cols] = layoutSelect.value.split('x').map(Number);
  await window.launcher.setLayout(rows, cols);
});

document.getElementById('btnSave').addEventListener('click', async () => {
  const name = profileName.value.trim();
  if (!name) return;
  await window.launcher.saveProfile(name);
  await refreshProfiles();
  statusEl.textContent = `perfil "${name}" salvo`;
});

document.getElementById('btnLoad').addEventListener('click', async () => {
  const name = profileSelect.value;
  if (!name) return;
  await window.launcher.loadProfile(name);
  statusEl.textContent = `perfil "${name}" carregado`;
});

liteMode.addEventListener('change', async () => {
  await window.launcher.setLiteMode(liteMode.checked);
  const ok = confirm('Modo leve ' + (liteMode.checked ? 'ativado' : 'desativado') + '. Reiniciar agora para aplicar?');
  if (ok) await window.launcher.restart();
  else statusEl.textContent = 'modo leve: aplica no próximo reinício';
});

keepBg.addEventListener('change', async () => {
  await window.launcher.setKeepBackground(keepBg.checked);
  const ok = confirm('Rodar em 2º plano ' + (keepBg.checked ? 'ativado' : 'desativado') + '. Reiniciar agora para aplicar?');
  if (ok) await window.launcher.restart();
  else statusEl.textContent = 'rodar em 2º plano: aplica no próximo reinício';
});

// ---------------- Extensões ----------------

async function renderExtPanel() {
  const list = await window.launcher.extList();
  const items = list.map((e) => `
    <div class="ext-item">
      <span title="${e.path}">${e.name}</span>
      <button data-ext="${e.path.replace(/"/g, '&quot;')}">remover</button>
    </div>`).join('');
  extPanel.innerHTML = `
    ${items || '<div class="ext-hint">Nenhuma extensão adicionada.</div>'}
    <button id="extAddBtn">+ Adicionar (pasta descompactada)</button>
    <div class="ext-hint">Escolha a pasta da extensão com o manifest.json. Aplica em todos os slots. Extensões simples/content-scripts funcionam melhor.</div>`;
}

btnExt.addEventListener('click', async () => {
  extPanel.classList.toggle('hidden');
  if (!extPanel.classList.contains('hidden')) await renderExtPanel();
});

extPanel.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'extAddBtn') {
    const res = await window.launcher.extAdd();
    statusEl.textContent = res.ok ? 'extensão adicionada (slots recarregados)' : `extensão: ${res.error}`;
    await renderExtPanel();
  } else if (btn.dataset.ext) {
    await window.launcher.extRemove(btn.dataset.ext);
    statusEl.textContent = 'extensão removida';
    await renderExtPanel();
  }
});

// ---------------- Verificar atualização ----------------

async function checkForUpdate(silent) {
  const res = await window.launcher.checkUpdate();
  if (!res.ok) {
    if (!silent) statusEl.textContent = `erro ao checar atualização: ${res.error}`;
    return;
  }
  if (res.hasUpdate) {
    btnUpdate.textContent = `Atualização ${res.latest} disponível!`;
    btnUpdate.classList.add('on');
    btnUpdate.onclick = () => window.launcher.openExternal(res.url);
  } else {
    btnUpdate.textContent = 'Verificar atualização';
    btnUpdate.classList.remove('on');
    btnUpdate.onclick = () => checkForUpdate(false);
    if (!silent) statusEl.textContent = `você já está na versão mais recente (${res.current})`;
  }
}

btnUpdate.onclick = () => checkForUpdate(false);

async function refreshProfiles() {
  const names = await window.launcher.listProfiles();
  profileSelect.innerHTML = names.map((n) => `<option value="${n}">${n}</option>`).join('');
}

// ---------------- Monitor de RAM ----------------

async function updateMetrics() {
  try {
    const data = await window.launcher.metrics();
    let total = 0;
    data.forEach((m) => {
      const el = slotsRow.querySelector(`[data-ram="${m.slot}"]`);
      if (!el) return;
      if (m.mb == null) {
        el.textContent = 'susp.';
      } else {
        el.textContent = `${m.mb} MB`;
        total += m.mb;
      }
    });
    if (total > 0) statusEl.textContent = `RAM slots: ${total} MB`;
  } catch (_err) {
    // ignore
  }
}
setInterval(updateMetrics, 3000);

window.launcher.onState((data) => {
  renderSlots(data.slots);
  const val = `${data.layout.rows}x${data.layout.cols}`;
  if ([...layoutSelect.options].some((o) => o.value === val)) layoutSelect.value = val;
});

(async () => {
  const state = await window.launcher.getState();
  renderSlots(state.slots);
  const settings = await window.launcher.getSettings();
  liteMode.checked = !!settings.liteMode;
  keepBg.checked = settings.keepBackground !== false;
  await refreshProfiles();
  updateMetrics();
  checkForUpdate(true);
})();
