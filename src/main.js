const { app, BrowserWindow, BrowserView, ipcMain, session, powerSaveBlocker, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const UPDATE_REPO = 'tiagogrieco/multi-idle-launcher';

const TOOLBAR_HEIGHT = 96;
const GAP = 4;

let mainWindow = null;
let views = []; // { slot, view|null, url, partition, suspended, blockMedia, rect }
let layout = { rows: 2, cols: 2 };

// ---------------- Settings (modo leve) ----------------

const settingsFile = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  } catch (_err) {
    return {};
  }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
  } catch (_err) {
    // best-effort
  }
}

let settings = loadSettings();

// Flags de economia de memória — precisam ser aplicadas antes do app.whenReady()
if (settings.liteMode) {
  // Limita o heap JS de cada renderer (slots) a 256 MB
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
  // Limita o cache de disco do Chromium a 50 MB
  app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024));
}

// Rodar em 2º plano (padrão: ligado) — sem isso o Chromium zera timers/render
// quando a janela fica atrás ou minimizada e os jogos idle param de rodar.
const keepBackground = settings.keepBackground !== false;
if (keepBackground) {
  // não reduz timers JS quando a janela perde foco
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  // não rebaixa a prioridade dos processos de renderer em background
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  // no Windows: não tratar janela coberta/minimizada como "oculta" (occlusion),
  // e não limitar timers a 1x/min após 5 min em background
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling');
}

function profilesDir() {
  const dir = path.join(app.getPath('userData'), 'profiles');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const lastStateFile = path.join(app.getPath('userData'), 'last-state.json');

function slotData() {
  return views.map((v) => ({
    url: v.url,
    partition: v.partition,
    suspended: !!v.suspended,
    blockMedia: !!v.blockMedia,
  }));
}

function saveLastState() {
  const data = { layout, slots: slotData() };
  try {
    fs.writeFileSync(lastStateFile, JSON.stringify(data, null, 2));
  } catch (_err) {
    // best-effort, ignore write failures
  }
}

function loadLastState() {
  try {
    if (fs.existsSync(lastStateFile)) {
      return JSON.parse(fs.readFileSync(lastStateFile, 'utf-8'));
    }
  } catch (_err) {
    // corrupt/missing file, fall back to defaults
  }
  return null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('resize', () => {
    layoutViews();
    notifyRenderer();
  });

  const saved = loadLastState();
  if (saved) {
    layout = saved.layout;
    buildSlots(saved.slots.length, saved.slots);
  } else {
    buildSlots(layout.rows * layout.cols);
  }
}

// ---------------- Bloqueio de imagens/mídia por slot ----------------

function applyMediaBlock(entry) {
  const ses = session.fromPartition(entry.partition);
  if (entry.blockMedia) {
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      if (details.resourceType === 'image' || details.resourceType === 'media') {
        return callback({ cancel: true });
      }
      callback({});
    });
  } else {
    ses.webRequest.onBeforeRequest(null);
  }
}

// ---------------- Extensões (aplicadas em todos os slots) ----------------

async function loadExtensionsIntoSession(ses) {
  const list = settings.extensions || [];
  for (const extPath of list) {
    try {
      const already = ses.getAllExtensions().some((e) => path.normalize(e.path) === path.normalize(extPath));
      if (!already) await ses.loadExtension(extPath, { allowFileAccess: true });
    } catch (_err) {
      // extensão incompatível/pasta inválida — ignora
    }
  }
}

// ---------------- Criação / suspensão de slots ----------------

function createSlotView(entry) {
  const view = new BrowserView({
    webPreferences: {
      partition: entry.partition,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !keepBackground,
    },
  });
  mainWindow.addBrowserView(view);
  applyMediaBlock(entry);
  const ses = session.fromPartition(entry.partition);
  loadExtensionsIntoSession(ses).finally(() => {
    view.webContents.loadURL(entry.url).catch(() => {});
  });

  const trackNavigation = (_evt, navigatedUrl) => {
    entry.url = navigatedUrl;
    saveLastState();
  };
  view.webContents.on('did-navigate', trackNavigation);
  view.webContents.on('did-navigate-in-page', trackNavigation);

  entry.view = view;
  entry.suspended = false;
}

function suspendSlot(entry) {
  if (!entry.view) return;
  mainWindow.removeBrowserView(entry.view);
  entry.view.webContents.destroy();
  entry.view = null;
  entry.suspended = true;
}

function resumeSlot(entry) {
  if (entry.view) return;
  createSlotView(entry);
  layoutViews();
}

function destroyAllViews() {
  for (const entry of views) {
    if (entry.view) {
      mainWindow.removeBrowserView(entry.view);
      entry.view.webContents.destroy();
    }
  }
  views = [];
}

function buildSlots(count, savedSlots) {
  destroyAllViews();
  for (let i = 0; i < count; i++) {
    const saved = (savedSlots && savedSlots[i]) || {};
    const entry = {
      slot: i,
      view: null,
      url: saved.url || 'https://www.google.com',
      partition: saved.partition || `persist:slot-${i}`,
      suspended: !!saved.suspended,
      blockMedia: !!saved.blockMedia,
      rect: null,
    };
    views.push(entry);
    // Slots suspensos não ganham processo — só são recriados ao retomar
    if (!entry.suspended) createSlotView(entry);
  }
  layoutViews();
  notifyRenderer();
  saveLastState();
}

function layoutViews() {
  if (!mainWindow) return;
  const bounds = mainWindow.getContentBounds();
  const areaW = bounds.width;
  const areaH = bounds.height - TOOLBAR_HEIGHT;
  const { rows, cols } = layout;
  const cellW = Math.floor((areaW - GAP * (cols + 1)) / cols);
  const cellH = Math.floor((areaH - GAP * (rows + 1)) / rows);

  views.forEach((entry, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = GAP + c * (cellW + GAP);
    const y = TOOLBAR_HEIGHT + GAP + r * (cellH + GAP);
    entry.rect = { x, y, width: cellW, height: cellH };
    if (entry.view) {
      entry.view.setBounds(entry.rect);
      entry.view.setAutoResize({ width: false, height: false });
    }
  });
}

function publicState() {
  return {
    layout,
    slots: views.map((v) => ({
      slot: v.slot,
      url: v.url,
      partition: v.partition,
      suspended: !!v.suspended,
      blockMedia: !!v.blockMedia,
      rect: v.rect,
    })),
  };
}

function notifyRenderer() {
  if (!mainWindow) return;
  mainWindow.webContents.send('launcher:state', publicState());
}

app.whenReady().then(() => {
  // impede o Windows de suspender o app em modo de economia de energia
  if (keepBackground) powerSaveBlocker.start('prevent-app-suspension');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => saveLastState());

// ---------------- IPC ----------------

ipcMain.handle('launcher:set-layout', (_evt, { rows, cols }) => {
  layout = { rows, cols };
  buildSlots(rows * cols);
  return true;
});

ipcMain.handle('launcher:navigate', (_evt, { slot, url }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry) return false;
  let target = url;
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  entry.url = target;
  if (entry.view) {
    entry.view.webContents.loadURL(target).catch(() => {});
  } else {
    // navegar num slot suspenso retoma ele
    resumeSlot(entry);
  }
  saveLastState();
  notifyRenderer();
  return true;
});

ipcMain.handle('launcher:reload', (_evt, { slot }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry || !entry.view) return false;
  entry.view.webContents.reload();
  return true;
});

ipcMain.handle('launcher:devtools', (_evt, { slot }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry || !entry.view) return false;
  entry.view.webContents.toggleDevTools();
  return true;
});

ipcMain.handle('launcher:inject', async (_evt, { slot, code }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry) return { ok: false, error: 'slot not found' };
  if (!entry.view) return { ok: false, error: 'slot suspenso' };
  try {
    const result = await entry.view.webContents.executeJavaScript(code, true);
    return { ok: true, result: String(result) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('launcher:toggle-suspend', (_evt, { slot }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry) return false;
  if (entry.view) suspendSlot(entry);
  else resumeSlot(entry);
  saveLastState();
  notifyRenderer();
  return true;
});

ipcMain.handle('launcher:toggle-media', (_evt, { slot }) => {
  const entry = views.find((v) => v.slot === slot);
  if (!entry) return false;
  entry.blockMedia = !entry.blockMedia;
  applyMediaBlock(entry);
  // recarrega pra descartar imagens já carregadas (ou carregar as que faltam)
  if (entry.view) entry.view.webContents.reload();
  saveLastState();
  notifyRenderer();
  return true;
});

ipcMain.handle('launcher:metrics', () => {
  const metrics = app.getAppMetrics();
  return views.map((v) => {
    if (!v.view) return { slot: v.slot, mb: null };
    try {
      const pid = v.view.webContents.getOSProcessId();
      const m = metrics.find((x) => x.pid === pid);
      return { slot: v.slot, mb: m ? Math.round(m.memory.workingSetSize / 1024) : null };
    } catch (_err) {
      return { slot: v.slot, mb: null };
    }
  });
});

ipcMain.handle('launcher:get-settings', () => settings);

ipcMain.handle('launcher:set-lite-mode', (_evt, { enabled }) => {
  settings = { ...settings, liteMode: !!enabled };
  saveSettings(settings);
  return true; // exige reinício para aplicar as flags
});

ipcMain.handle('launcher:set-keep-background', (_evt, { enabled }) => {
  settings = { ...settings, keepBackground: !!enabled };
  saveSettings(settings);
  return true; // exige reinício para aplicar as flags
});

ipcMain.handle('launcher:restart', () => {
  saveLastState();
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('launcher:ext-list', () => {
  return (settings.extensions || []).map((p) => ({ path: p, name: path.basename(p) }));
});

ipcMain.handle('launcher:ext-add', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Escolha a pasta da extensão (descompactada, com manifest.json)',
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, error: 'cancelado' };
  const extPath = res.filePaths[0];
  if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
    return { ok: false, error: 'a pasta não contém manifest.json' };
  }
  const list = settings.extensions || [];
  if (!list.includes(extPath)) {
    settings = { ...settings, extensions: [...list, extPath] };
    saveSettings(settings);
  }
  // carrega nas sessões ativas e recarrega pra aplicar os content scripts
  for (const v of views) {
    if (!v.view) continue;
    await loadExtensionsIntoSession(session.fromPartition(v.partition));
    v.view.webContents.reload();
  }
  return { ok: true };
});

// Instala extensão direto da Chrome Web Store (baixa o .crx e extrai)
function unzipWithPowershell(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`],
      { windowsHide: true },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function crxToZipBuffer(buf) {
  // CRX3: "Cr24" + versão (4 bytes) + tamanho do header (4 bytes LE) + header + zip
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'Cr24') {
    const headerLen = buf.readUInt32LE(8);
    const start = 12 + headerLen;
    if (start < buf.length) return buf.subarray(start);
  }
  // fallback: procura a assinatura do zip (PK\x03\x04)
  const idx = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return idx >= 0 ? buf.subarray(idx) : null;
}

ipcMain.handle('launcher:ext-add-store', async (_evt, { idOrUrl }) => {
  const m = String(idOrUrl || '').match(/[a-p]{32}/);
  if (!m) return { ok: false, error: 'cole a URL da Web Store ou o ID (32 letras)' };
  const id = m[0];
  try {
    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=126.0.6478.127&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
    const res = await net.fetch(crxUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { ok: false, error: `download falhou (HTTP ${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    const zipBuf = crxToZipBuffer(buf);
    if (!zipBuf) return { ok: false, error: 'arquivo baixado não parece um .crx válido' };

    const extRoot = path.join(app.getPath('userData'), 'extensions');
    fs.mkdirSync(extRoot, { recursive: true });
    const extDir = path.join(extRoot, id);
    const zipPath = path.join(extRoot, `${id}.zip`);
    fs.rmSync(extDir, { recursive: true, force: true });
    fs.writeFileSync(zipPath, zipBuf);
    await unzipWithPowershell(zipPath, extDir);
    fs.rmSync(zipPath, { force: true });
    // o Chrome/Electron rejeita pastas _metadata em extensão descompactada
    fs.rmSync(path.join(extDir, '_metadata'), { recursive: true, force: true });
    if (!fs.existsSync(path.join(extDir, 'manifest.json'))) {
      return { ok: false, error: 'extensão extraída sem manifest.json' };
    }

    const list = settings.extensions || [];
    if (!list.includes(extDir)) {
      settings = { ...settings, extensions: [...list, extDir] };
      saveSettings(settings);
    }
    for (const v of views) {
      if (!v.view) continue;
      await loadExtensionsIntoSession(session.fromPartition(v.partition));
      v.view.webContents.reload();
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Abre o popup da extensão (o "botão" que apareceria na barra do Chrome) numa janela própria
ipcMain.handle('launcher:ext-popup', (_evt, { extPath }) => {
  const active = views.find((v) => v.view);
  if (!active) return { ok: false, error: 'nenhum slot ativo' };
  const ses = session.fromPartition(active.partition);
  const ext = ses.getAllExtensions().find((e) => path.normalize(e.path) === path.normalize(extPath));
  if (!ext) return { ok: false, error: 'extensão não carregada (recarregue o app)' };
  const manifest = ext.manifest || {};
  const popup =
    (manifest.action && manifest.action.default_popup) ||
    (manifest.browser_action && manifest.browser_action.default_popup);
  if (!popup) return { ok: false, error: 'essa extensão não tem popup' };
  const w = new BrowserWindow({
    width: 420,
    height: 640,
    title: ext.name,
    autoHideMenuBar: true,
    webPreferences: { partition: active.partition },
  });
  w.loadURL(`chrome-extension://${ext.id}/${popup}`);
  return { ok: true };
});

ipcMain.handle('launcher:ext-remove', (_evt, { extPath }) => {
  settings = { ...settings, extensions: (settings.extensions || []).filter((p) => p !== extPath) };
  saveSettings(settings);
  for (const v of views) {
    if (!v.view) continue;
    const ses = session.fromPartition(v.partition);
    const ext = ses.getAllExtensions().find((e) => path.normalize(e.path) === path.normalize(extPath));
    if (ext) {
      ses.removeExtension(ext.id);
      v.view.webContents.reload();
    }
  }
  return true;
});

ipcMain.handle('launcher:save-profile', (_evt, { name }) => {
  const data = { layout, slots: slotData() };
  fs.writeFileSync(path.join(profilesDir(), `${name}.json`), JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle('launcher:list-profiles', () => {
  return fs.readdirSync(profilesDir()).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
});

ipcMain.handle('launcher:load-profile', (_evt, { name }) => {
  const file = path.join(profilesDir(), `${name}.json`);
  if (!fs.existsSync(file)) return false;
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  layout = data.layout;
  buildSlots(data.slots.length, data.slots);
  return true;
});

ipcMain.handle('launcher:get-state', () => publicState());

// ---------------- Verificar atualização (GitHub Releases, público, sem token) ----------------

function isNewerVersion(latest, current) {
  const a = latest.replace(/^v/i, '').split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

ipcMain.handle('launcher:check-update', async () => {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'multi-idle-launcher' },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    const latest = data.tag_name || '';
    const current = app.getVersion();
    const hasUpdate = latest ? isNewerVersion(latest, current) : false;
    return { ok: true, current, latest, hasUpdate, url: data.html_url };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('launcher:open-external', (_evt, { url }) => {
  shell.openExternal(url);
  return true;
});
