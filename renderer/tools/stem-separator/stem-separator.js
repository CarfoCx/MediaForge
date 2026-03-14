// ============================================================================
// Stem Separator Tool (WebSocket-based, powered by Demucs)
// ============================================================================

(function() {

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm']);

let files = [];
let outputDir = '';
let isProcessing = false;
let ws = null;
let pythonPort = null;
let log = null;

let reconnectDelay = 1000;
let reconnectAttempts = 0;
let reconnectTimerId = null;
const MAX_RECONNECT_DELAY = 30000;

let dropZone, browseBtn, fileList, separateBtn, clearBtn, openOutputBtn;
let outputDirBtn, statusText, processingIndicator;
let modelSelect, stemCheckboxes;
let lastOutputDir = '';

function init(ctx) {
  pythonPort = ctx.pythonPort;
  log = ctx.log;

  dropZone = document.getElementById('dropZone');
  browseBtn = document.getElementById('browseBtn');
  fileList = document.getElementById('fileList');
  separateBtn = document.getElementById('separateBtn');
  clearBtn = document.getElementById('clearBtn');
  openOutputBtn = document.getElementById('openOutputBtn');
  outputDirBtn = document.getElementById('outputDirBtn');
  statusText = document.getElementById('statusText');
  processingIndicator = document.getElementById('processingIndicator');
  modelSelect = document.getElementById('modelSelect');
  stemCheckboxes = document.getElementById('stemCheckboxes');

  bindEvents();
  connectWebSocket(pythonPort);
  if (!outputDir && window.applyDefaultOutputDir) outputDir = window.applyDefaultOutputDir(outputDirBtn);
  log('Stem Separator ready');
}

function cleanup() {
  if (reconnectTimerId) { clearTimeout(reconnectTimerId); reconnectTimerId = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

// ---- WebSocket ----
function connectWebSocket(port) {
  ws = new WebSocket(`ws://127.0.0.1:${port}/stem-separator/ws`);
  ws.onopen = () => {
    reconnectDelay = 1000; reconnectAttempts = 0;
    if (statusText) statusText.textContent = 'Connected to backend';
    log('WebSocket connected', 'success');
  };
  ws.onmessage = (event) => handleWSMessage(JSON.parse(event.data));
  ws.onclose = () => {
    if (!statusText) return;
    statusText.textContent = 'Disconnected - reconnecting...';
    reconnectAttempts++;
    const delay = Math.min(reconnectDelay * Math.pow(1.5, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    log(`WebSocket disconnected, reconnecting in ${(delay / 1000).toFixed(1)}s...`, 'warn');
    reconnectTimerId = setTimeout(() => connectWebSocket(port), delay);
  };
  ws.onerror = () => { if (statusText) statusText.textContent = 'Connection error'; };
}

function handleWSMessage(data) {
  if (data.type === 'log') { log(data.message, data.level || 'info'); return; }

  const fileIndex = files.findIndex(f => f.path === data.file);
  if (fileIndex === -1 && data.type !== 'all_complete') return;

  switch (data.type) {
    case 'progress':
      files[fileIndex].progress = data.progress;
      files[fileIndex].status = data.status || 'Processing...';
      files[fileIndex].state = 'processing';
      renderFileItem(fileIndex);
      break;
    case 'complete':
      files[fileIndex].progress = 1;
      files[fileIndex].state = 'complete';
      files[fileIndex].outputs = data.outputs || {};
      const stemNames = Object.keys(data.outputs || {});
      files[fileIndex].status = `Done: ${stemNames.join(', ')}`;
      if (stemNames.length > 0) {
        const firstOutput = data.outputs[stemNames[0]];
        lastOutputDir = firstOutput.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      }
      renderFileItem(fileIndex);
      log(`Separated: ${files[fileIndex].name} -> ${stemNames.join(', ')}`, 'success');
      break;
    case 'error':
      files[fileIndex].progress = 0;
      files[fileIndex].status = `Error: ${data.error}`;
      files[fileIndex].state = data.error === 'Cancelled' ? 'cancelled' : 'error';
      renderFileItem(fileIndex);
      log(`Error [${files[fileIndex].name}]: ${data.error}`, data.error === 'Cancelled' ? 'warn' : 'error');
      break;
    case 'all_complete':
      isProcessing = false;
      processingIndicator.classList.remove('active');
      separateBtn.disabled = false;
      separateBtn.textContent = 'Separate Stems';
      separateBtn.classList.remove('btn-cancel');
      const completed = files.filter(f => f.state === 'complete').length;
      const errors = files.filter(f => f.state === 'error').length;
      statusText.textContent = `Done! ${completed} separated${errors > 0 ? `, ${errors} failed` : ''}`;
      if (lastOutputDir) openOutputBtn.style.display = '';
      log(`Batch finished: ${completed} completed, ${errors} failed`, errors > 0 ? 'warn' : 'success');
      break;
  }
}

function getSelectedStems() {
  const checks = stemCheckboxes.querySelectorAll('input[type="checkbox"]:checked');
  const stems = Array.from(checks).map(c => c.value);
  return stems.length > 0 ? stems : null; // null = all
}

function bindEvents() {
  outputDirBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    const dir = await window.api.selectOutputDir();
    if (dir) {
      outputDir = dir;
      const parts = dir.replace(/\\/g, '/').split('/');
      const display = parts.length > 2 ? '.../' + parts.slice(-2).join('/') : dir;
      outputDirBtn.textContent = display;
      outputDirBtn.title = dir;
    }
  });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover');
    const paths = [];
    for (const file of e.dataTransfer.files) paths.push(file.path);
    if (paths.length > 0) {
      const resolved = await window.api.resolveDroppedPaths(paths);
      if (resolved.length > 0) addFiles(resolved);
      else addFilesDirect(paths);
    }
  });

  const fileFilter = {
    title: 'Select Audio or Video',
    filters: [
      { name: 'Audio & Video', extensions: ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma', 'mp4', 'avi', 'mkv', 'mov', 'webm'] }
    ]
  };

  browseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const paths = await window.api.selectFiles(fileFilter);
    if (paths.length > 0) addFilesDirect(paths);
  });

  dropZone.addEventListener('click', async (e) => {
    if (e.target.id === 'browseBtn') return;
    const paths = await window.api.selectFiles(fileFilter);
    if (paths.length > 0) addFilesDirect(paths);
  });

  clearBtn.addEventListener('click', () => {
    if (!isProcessing) { clearFiles(); window.clearLog(); openOutputBtn.style.display = 'none'; }
  });

  openOutputBtn.addEventListener('click', () => {
    if (lastOutputDir) window.api.openFolder(lastOutputDir);
  });

  separateBtn.addEventListener('click', () => {
    if (isProcessing) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'cancel' }));
        separateBtn.disabled = true;
        separateBtn.textContent = 'Cancelling...';
        log('Cancelling...', 'warn');
        setTimeout(() => {
          if (isProcessing) {
            separateBtn.disabled = false;
            separateBtn.textContent = 'Cancel';
            log('Cancel may not have completed — you can try again', 'warn');
          }
        }, 10000);
      }
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('Not connected to backend', 'error');
      return;
    }

    const filesToProcess = files
      .filter(f => f.state === 'pending' || f.state === 'error' || f.state === 'cancelled')
      .map(f => { f.state = 'pending'; f.progress = 0; f.status = 'Queued...'; return f.path; });
    if (filesToProcess.length === 0) return;

    isProcessing = true;
    separateBtn.disabled = false;
    separateBtn.textContent = 'Cancel';
    separateBtn.classList.add('btn-cancel');
    processingIndicator.classList.add('active');
    statusText.textContent = `Separating ${filesToProcess.length} file(s)...`;
    renderFileList();

    const stems = getSelectedStems();
    log(`Starting separation: ${filesToProcess.length} file(s), model=${modelSelect.value}, stems=${stems ? stems.join(',') : 'all'}`);

    ws.send(JSON.stringify({
      action: 'separate',
      files: filesToProcess,
      model: modelSelect.value,
      stems: stems,
      output_dir: outputDir
    }));
  });
}

// ---- File management ----
function getFileExtension(fp) {
  const parts = fp.replace(/\\/g, '/').split('/').pop().split('.');
  return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
}

function getFileName(fp) { return fp.replace(/\\/g, '/').split('/').pop(); }

function isSupported(fp) {
  const ext = getFileExtension(fp);
  return AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

function addFiles(paths) {
  addFilesDirect(paths.filter(p => isSupported(p)));
}

function addFilesDirect(paths) {
  let added = 0;
  for (const p of paths) {
    if (!isSupported(p)) continue;
    if (files.some(f => f.path === p)) { log(`Skipped duplicate: ${getFileName(p)}`, 'warn'); continue; }
    const ext = getFileExtension(p);
    const type = AUDIO_EXTS.has(ext) ? 'audio' : 'video';
    files.push({ path: p, name: getFileName(p), type, progress: 0, status: 'Ready', state: 'pending', outputs: {} });
    added++;
  }
  if (added > 0) log(`Added ${added} file(s)`);
  renderFileList();
  updateButton();
}

function removeFile(index) { files.splice(index, 1); renderFileList(); updateButton(); }

function clearFiles() {
  files = [];
  renderFileList();
  updateButton();
  statusText.textContent = 'Ready';
}

function updateButton() {
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error' || f.state === 'cancelled');
  separateBtn.disabled = pending.length === 0 && !isProcessing;
}

// ---- Rendering ----
function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="empty-state">No files added. Drag audio or video files here, or click browse.</div>';
    return;
  }
  fileList.innerHTML = '';
  files.forEach((f, i) => fileList.appendChild(createFileElement(f, i)));
}

function renderFileItem(index) {
  const existing = fileList.children[index];
  if (!existing) return;
  fileList.replaceChild(createFileElement(files[index], index), existing);
}

function createFileElement(file, index) {
  const el = document.createElement('div');
  el.className = 'file-item';

  const icon = file.type === 'audio' ? '\u{1F3B5}' : '\u{1F3AC}';
  let progressClass = '';
  if (file.state === 'complete') progressClass = ' complete';
  else if (file.state === 'error' || file.state === 'cancelled') progressClass = ' error';

  let stemBadges = '';
  if (file.state === 'complete' && file.outputs) {
    const badges = Object.keys(file.outputs).map(s => `<span class="stem-badge">${s}</span>`).join('');
    stemBadges = `<div class="stem-outputs">${badges}</div>`;
  }

  el.innerHTML = `
    <span class="file-icon">${icon}</span>
    <div class="file-info">
      <div class="file-name" title="${window.escapeHtml(file.path)}">${window.escapeHtml(file.name)}</div>
      <div class="file-status">${window.escapeHtml(file.status)}</div>
      ${stemBadges}
    </div>
    <div class="file-progress-bar">
      <div class="file-progress-fill${progressClass}" style="width: ${Math.round(file.progress * 100)}%"></div>
    </div>
    <button class="file-remove" data-index="${index}" title="Remove">\u00D7</button>`;

  el.querySelector('.file-remove').addEventListener('click', (e) => { e.stopPropagation(); if (!isProcessing) removeFile(index); });
  return el;
}

window.registerTool('stem-separator', { init, cleanup });

})();
