// ============================================================================
// Video Compressor Tool
// ============================================================================

(function() {

const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm']);

let files = [];
let outputDir = '';
let isProcessing = false;
let log = null;
let progressCleanup = null;

let dropZone, browseBtn, fileList, compressBtn, clearBtn, openOutputBtn;
let lastOutputDir = '';
let outputDirBtn, statusText, processingIndicator;
let crfSlider, crfValue, preset, resolution;

function init(ctx) {
  log = ctx.log;

  dropZone = document.getElementById('dropZone');
  browseBtn = document.getElementById('browseBtn');
  fileList = document.getElementById('fileList');
  compressBtn = document.getElementById('compressBtn');
  clearBtn = document.getElementById('clearBtn');
  openOutputBtn = document.getElementById('openOutputBtn');
  outputDirBtn = document.getElementById('outputDirBtn');
  statusText = document.getElementById('statusText');
  processingIndicator = document.getElementById('processingIndicator');
  crfSlider = document.getElementById('crfSlider');
  crfValue = document.getElementById('crfValue');
  preset = document.getElementById('preset');
  resolution = document.getElementById('resolution');

  bindEvents();
  if (!outputDir && window.applyDefaultOutputDir) outputDir = window.applyDefaultOutputDir(outputDirBtn);
  log('Video Compressor ready');
}

function cleanup() {
  if (progressCleanup) { progressCleanup(); progressCleanup = null; }
}

function bindEvents() {
  crfSlider.addEventListener('input', () => {
    crfValue.textContent = crfSlider.value;
  });

  outputDirBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    const dir = await window.api.selectOutputDir();
    if (dir) {
      outputDir = dir;
      const parts = dir.replace(/\\\\/g, '/').split('/');
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
      else log('No supported video files found', 'warn');
    }
  });

  browseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const paths = await window.api.selectFiles({ title: 'Select Videos', filters: [{ name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm'] }] });
    if (paths.length > 0) addFiles(paths);
  });

  dropZone.addEventListener('click', async (e) => {
    if (e.target.id === 'browseBtn') return;
    const paths = await window.api.selectFiles({ title: 'Select Videos', filters: [{ name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm'] }] });
    if (paths.length > 0) addFiles(paths);
  });

  clearBtn.addEventListener('click', () => {
    if (!isProcessing) { clearFiles(); window.clearLog(); openOutputBtn.style.display = 'none'; }
  });

  openOutputBtn.addEventListener('click', () => {
    if (lastOutputDir) window.api.openFolder(lastOutputDir);
  });

  compressBtn.addEventListener('click', startCompression);

  progressCleanup = window.api.onToolProgress((data) => {
    if (data.tool !== 'video-compressor') return;
    handleProgress(data);
  });
}

async function startCompression() {
  if (isProcessing) return;
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  if (pending.length === 0) return;

  isProcessing = true;
  compressBtn.disabled = true;
  processingIndicator.classList.add('active');
  statusText.textContent = `Compressing ${pending.length} file(s)...`;

  pending.forEach(f => { f.state = 'processing'; f.progress = 0; f.status = 'Queued...'; });
  renderFileList();

  log(`Starting compression: ${pending.length} file(s), CRF=${crfSlider.value}, preset=${preset.value}, resolution=${resolution.value}`);

  for (const file of pending) {
    file.state = 'processing';
    file.status = 'Compressing...';
    renderFileItem(files.indexOf(file));

    try {
      const result = await window.api.compressVideo({
        inputPath: file.path,
        crf: parseInt(crfSlider.value),
        preset: preset.value,
        resolution: resolution.value,
        outputDir: outputDir
      });

      if (result && result.success) {
        file.state = 'complete';
        file.progress = 1;
        if (result.output) lastOutputDir = result.output.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        file.status = result.savedPercent ? `Done (${result.savedPercent}% smaller)` : 'Complete';
        log(`Compressed: ${file.name}${result.savedPercent ? ` — ${result.savedPercent}% smaller` : ''}`, 'success');
      } else {
        file.state = 'error';
        file.status = `Error: ${result ? result.error : 'unknown'}`;
        log(`Error [${file.name}]: ${result ? result.error : 'unknown'}`, 'error');
      }
    } catch (err) {
      file.state = 'error';
      file.status = `Error: ${err.message}`;
      log(`Error [${file.name}]: ${err.message}`, 'error');
    }
    renderFileItem(files.indexOf(file));
  }

  isProcessing = false;
  compressBtn.disabled = files.filter(f => f.state === 'pending' || f.state === 'error').length === 0;
  processingIndicator.classList.remove('active');
  const completed = files.filter(f => f.state === 'complete').length;
  const errors = files.filter(f => f.state === 'error').length;
  statusText.textContent = `Done! ${completed} compressed${errors > 0 ? `, ${errors} failed` : ''}`;
  if (completed > 0 && lastOutputDir) openOutputBtn.style.display = '';
  log(`Compression finished: ${completed} completed, ${errors} failed`, errors > 0 ? 'warn' : 'success');
}

function handleProgress(data) {
  const idx = files.findIndex(f => f.path === data.file);
  if (idx === -1) return;

  if (data.type === 'progress') {
    files[idx].progress = data.progress;
    files[idx].status = data.status || 'Compressing...';
    files[idx].state = 'processing';
  } else if (data.type === 'complete') {
    files[idx].progress = 1;
    files[idx].status = 'Complete';
    files[idx].state = 'complete';
    log(`Compressed: ${files[idx].name}`, 'success');
  } else if (data.type === 'error') {
    files[idx].progress = 0;
    files[idx].status = `Error: ${data.error}`;
    files[idx].state = 'error';
    log(`Error [${files[idx].name}]: ${data.error}`, 'error');
  }
  renderFileItem(idx);
}

// ---- File management ----
function getFileExtension(fp) {
  const parts = fp.replace(/\\/g, '/').split('/').pop().split('.');
  return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
}

function getFileName(fp) { return fp.replace(/\\/g, '/').split('/').pop(); }

function addFiles(paths) {
  let added = 0;
  for (const p of paths) {
    const ext = getFileExtension(p);
    if (!VIDEO_EXTS.has(ext)) continue;
    if (files.some(f => f.path === p)) continue;
    files.push({ path: p, name: getFileName(p), progress: 0, status: 'Ready', state: 'pending' });
    added++;
  }
  if (added > 0) log(`Added ${added} video file(s)`);
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
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  compressBtn.disabled = pending.length === 0 || isProcessing;
}

// ---- Rendering ----
function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="empty-state">No files added. Drag videos here, or click browse.</div>';
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

  let progressClass = '';
  if (file.state === 'complete') progressClass = ' complete';
  else if (file.state === 'error') progressClass = ' error';

  el.innerHTML = `
    <span class="file-icon">\u{1F3AC}</span>
    <div class="file-info">
      <div class="file-name" title="${window.escapeHtml(file.path)}">${window.escapeHtml(file.name)}</div>
      <div class="file-status">${window.escapeHtml(file.status)}</div>
    </div>
    <div class="file-progress-bar">
      <div class="file-progress-fill${progressClass}" style="width: ${Math.round(file.progress * 100)}%"></div>
    </div>
    <button class="file-remove" data-index="${index}" title="Remove">\u00D7</button>`;

  el.querySelector('.file-remove').addEventListener('click', (e) => { e.stopPropagation(); if (!isProcessing) removeFile(index); });
  return el;
}

window.registerTool('video-compressor', { init, cleanup });

})();
