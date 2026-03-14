// ============================================================================
// Audio Extractor Tool
// ============================================================================

(function() {

const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm']);

let files = [];
let outputDir = '';
let isProcessing = false;
let log = null;
let progressCleanup = null;

let dropZone, browseBtn, fileList, extractBtn, clearBtn, openOutputBtn;
let outputDirBtn, statusText, processingIndicator;
let audioFormat, bitrate;
let lastOutputDir = '';

function init(ctx) {
  log = ctx.log;

  dropZone = document.getElementById('dropZone');
  browseBtn = document.getElementById('browseBtn');
  fileList = document.getElementById('fileList');
  extractBtn = document.getElementById('extractBtn');
  clearBtn = document.getElementById('clearBtn');
  outputDirBtn = document.getElementById('outputDirBtn');
  statusText = document.getElementById('statusText');
  processingIndicator = document.getElementById('processingIndicator');
  audioFormat = document.getElementById('audioFormat');
  bitrate = document.getElementById('bitrate');
  openOutputBtn = document.getElementById('openOutputBtn');

  bindEvents();
  if (!outputDir && window.applyDefaultOutputDir) outputDir = window.applyDefaultOutputDir(outputDirBtn);
  log('Audio Extractor ready');
}

function cleanup() {
  if (progressCleanup) { progressCleanup(); progressCleanup = null; }
}

function bindEvents() {
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

  extractBtn.addEventListener('click', startExtraction);

  progressCleanup = window.api.onToolProgress((data) => {
    if (data.tool !== 'audio-extractor') return;
    handleProgress(data);
  });
}

async function startExtraction() {
  if (isProcessing) return;
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  if (pending.length === 0) return;

  isProcessing = true;
  extractBtn.disabled = true;
  processingIndicator.classList.add('active');
  statusText.textContent = `Extracting audio from ${pending.length} file(s)...`;

  log(`Starting extraction: ${pending.length} file(s) to ${audioFormat.value.toUpperCase()}, ${bitrate.value}`);

  for (const file of pending) {
    file.state = 'processing';
    file.progress = 0;
    file.status = 'Extracting...';
    renderFileItem(files.indexOf(file));

    try {
      const result = await window.api.extractAudio({
        inputPath: file.path,
        format: audioFormat.value,
        bitrate: bitrate.value,
        outputDir: outputDir
      });

      if (result && result.success) {
        file.state = 'complete';
        file.progress = 1;
        file.status = 'Complete';
        log(`Extracted: ${file.name}`, 'success');
        if (result.output) lastOutputDir = result.output.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
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
  extractBtn.disabled = files.filter(f => f.state === 'pending' || f.state === 'error').length === 0;
  processingIndicator.classList.remove('active');
  const completed = files.filter(f => f.state === 'complete').length;
  const errors = files.filter(f => f.state === 'error').length;
  statusText.textContent = `Done! ${completed} extracted${errors > 0 ? `, ${errors} failed` : ''}`;
  if (completed > 0 && lastOutputDir) openOutputBtn.style.display = '';
  log(`Extraction finished: ${completed} completed, ${errors} failed`, errors > 0 ? 'warn' : 'success');
}

function handleProgress(data) {
  const idx = files.findIndex(f => f.path === data.file);
  if (idx === -1) return;

  if (data.type === 'progress') {
    files[idx].progress = data.progress;
    files[idx].status = data.status || 'Extracting...';
    files[idx].state = 'processing';
  } else if (data.type === 'complete') {
    files[idx].progress = 1;
    files[idx].status = 'Complete';
    files[idx].state = 'complete';
    log(`Extracted: ${files[idx].name}`, 'success');
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
  extractBtn.disabled = pending.length === 0 || isProcessing;
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

window.registerTool('audio-extractor', { init, cleanup });

})();
