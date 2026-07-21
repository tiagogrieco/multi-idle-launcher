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
  const items = list.map((e) => {
    const active = e.loadedIn > 0;
    const status = active
      ? `ativa em ${e.loadedIn}/${e.activeSlots} slots`
      : (e.error ? `erro: ${e.error}` : 'inativa');
    return `
    <div class="ext-item">
      <span title="${e.path}">
        <span class="ext-dot ${active ? 'ok' : 'off'}" title="${status.replace(/"/g, '&quot;')}"></span>
        ${e.name}${e.version ? ' v' + e.version : ''}
        <span class="ext-status">${status}</span>
      </span>
      <span>
        <button data-popup="${e.path.replace(/"/g, '&quot;')}" title="Abrir a janelinha (popup) da extensão">popup</button>
        <button data-ext="${e.path.replace(/"/g, '&quot;')}">remover</button>
      </span>
    </div>`;
  }).join('');
  extPanel.innerHTML = `
    ${items || '<div class="ext-hint">Nenhuma extensão adicionada.</div>'}
    <div class="ext-add-row">
      <input id="extStoreUrl" type="text" placeholder="Cole a URL da Chrome Web Store" />
      <button id="extStoreBtn">Instalar</button>
    </div>
    <button id="extAddBtn">+ De pasta descompactada</button>
    <div class="ext-hint">Cole o link da página da extensão na Web Store e clique Instalar — o app baixa e aplica em todos os slots. O botão "popup" abre a janelinha da extensão.</div>`;
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
  } else if (btn.id === 'extStoreBtn') {
    const input = document.getElementById('extStoreUrl');
    const idOrUrl = (input && input.value || '').trim();
    if (!idOrUrl) {
      statusEl.textContent = 'cole a URL da extensão no campo antes de clicar Instalar';
      return;
    }
    btn.textContent = 'baixando…';
    btn.disabled = true;
    statusEl.textContent = 'baixando extensão…';
    const res = await window.launcher.extAddStore(idOrUrl);
    statusEl.textContent = res.ok ? 'extensão instalada (slots recarregados)' : `extensão: ${res.error}`;
    await renderExtPanel();
  } else if (btn.dataset.popup) {
    const res = await window.launcher.extPopup(btn.dataset.popup);
    if (!res.ok) statusEl.textContent = `popup: ${res.error}`;
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
    btnUpdate.textContent = `Atualizar para ${res.latest}`;
    btnUpdate.classList.add('on');
    btnUpdate.onclick = async () => {
      btnUpdate.disabled = true;
      btnUpdate.textContent = 'atualizando…';
      const r = await window.launcher.downloadUpdate();
      if (!r.ok) {
        statusEl.textContent = `atualização: ${r.error}`;
        btnUpdate.disabled = false;
        btnUpdate.textContent = `Atualizar para ${res.latest}`;
      }
      // se ok, o app fecha e reabre sozinho já atualizado
    };
  } else {
    btnUpdate.textContent = 'Verificar atualização';
    btnUpdate.classList.remove('on');
    btnUpdate.onclick = () => checkForUpdate(false);
    if (!silent) statusEl.textContent = `você já está na versão mais recente (${res.current})`;
  }
}

btnUpdate.onclick = () => checkForUpdate(false);

window.launcher.onUpdateProgress((msg) => {
  statusEl.textContent = `atualização: ${msg}`;
});

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
