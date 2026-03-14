// ============================================================================
// Format Converter Tool
// ============================================================================

(function() {

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mkv', '.mov', '.webm']);

let files = [];
let outputDir = '';
let isProcessing = false;
let log = null;
let progressCleanup = null;

let dropZone, browseBtn, fileList, convertBtn, clearBtn, openOutputBtn;
let outputDirBtn, statusText, processingIndicator;
let outputFormat, qualitySlider, qualityValue;
let lastOutputDir = '';

function init(ctx) {
  log = ctx.log;

  dropZone = document.getElementById('dropZone');
  browseBtn = document.getElementById('browseBtn');
  fileList = document.getElementById('fileList');
  convertBtn = document.getElementById('convertBtn');
  openOutputBtn = document.getElementById('openOutputBtn');
  clearBtn = document.getElementById('clearBtn');
  outputDirBtn = document.getElementById('outputDirBtn');
  statusText = document.getElementById('statusText');
  processingIndicator = document.getElementById('processingIndicator');
  outputFormat = document.getElementById('outputFormat');
  qualitySlider = document.getElementById('qualitySlider');
  qualityValue = document.getElementById('qualityValue');

  bindEvents();
  if (!outputDir && window.applyDefaultOutputDir) outputDir = window.applyDefaultOutputDir(outputDirBtn);
  log('Format Converter ready');
}

function cleanup() {
  if (progressCleanup) { progressCleanup(); progressCleanup = null; }
}

function bindEvents() {
  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value;
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

  // Drop zone
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragover');
    const paths = [];
    for (const file of e.dataTransfer.files) paths.push(file.path);
    if (paths.length > 0) {
      const resolved = await window.api.resolveDroppedPaths(paths);
      if (resolved.length > 0) addFiles(resolved);
      else log('No supported files found in dropped items', 'warn');
    }
  });

  browseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const paths = await window.api.selectFiles();
    if (paths.length > 0) addFiles(paths);
  });

  dropZone.addEventListener('click', async (e) => {
    if (e.target.id === 'browseBtn') return;
    const paths = await window.api.selectFiles();
    if (paths.length > 0) addFiles(paths);
  });

  clearBtn.addEventListener('click', () => {
    if (!isProcessing) { clearFiles(); window.clearLog(); openOutputBtn.style.display = 'none'; }
  });

  openOutputBtn.addEventListener('click', () => {
    if (lastOutputDir) window.api.openFolder(lastOutputDir);
  });

  convertBtn.addEventListener('click', startConversion);

  // Listen for progress
  progressCleanup = window.api.onToolProgress((data) => {
    if (data.tool !== 'format-converter') return;
    handleProgress(data);
  });
}

async function startConversion() {
  if (isProcessing) {
    // Cancel
    convertBtn.disabled = true;
    convertBtn.textContent = 'Cancelling...';
    try { await window.api.cancelFormatConversion && window.api.cancelFormatConversion(); } catch {}
    return;
  }
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  if (pending.length === 0) return;

  isProcessing = true;
  convertBtn.disabled = false;
  convertBtn.textContent = 'Cancel';
  convertBtn.classList.add('btn-cancel');
  processingIndicator.classList.add('active');
  statusText.textContent = `Converting ${pending.length} file(s)...`;

  const targetFmt = outputFormat.value;
  const imageFormats = new Set(['png', 'jpg', 'webp', 'avif', 'tiff']);
  const videoFormats = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov']);
  const targetIsImage = imageFormats.has(targetFmt);
  const targetIsVideo = videoFormats.has(targetFmt);

  log(`Starting conversion: ${pending.length} file(s) to ${targetFmt.toUpperCase()}, quality ${qualitySlider.value}`);

  for (const file of pending) {
    const fileExt = getFileExtension(file.path);
    const fileIsImage = IMAGE_EXTS.has(fileExt);
    const fileIsVideo = VIDEO_EXTS.has(fileExt);

    if (fileIsImage && targetIsVideo) {
      file.state = 'error';
      file.status = 'Cannot convert image to video format';
      log(`Skipped ${file.name}: cannot convert image to video format`, 'warn');
      renderFileItem(files.indexOf(file));
      continue;
    }
    if (fileIsVideo && targetIsImage) {
      file.state = 'error';
      file.status = 'Cannot convert video to image format';
      log(`Skipped ${file.name}: cannot convert video to image format`, 'warn');
      renderFileItem(files.indexOf(file));
      continue;
    }
    file.state = 'processing';
    file.progress = 0;
    file.status = 'Converting...';
    renderFileItem(files.indexOf(file));

    try {
      const result = await window.api.convertFormat({
        inputPath: file.path,
        targetFormat: outputFormat.value,
        quality: parseInt(qualitySlider.value),
        outputDir: outputDir
      });

      if (result && result.success) {
        file.state = 'complete';
        file.progress = 1;
        file.status = 'Complete';
        if (result.output) lastOutputDir = result.output.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        log(`Converted: ${file.name}`, 'success');
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
  convertBtn.textContent = 'Convert';
  convertBtn.classList.remove('btn-cancel');
  convertBtn.disabled = files.filter(f => f.state === 'pending' || f.state === 'error').length === 0;
  processingIndicator.classList.remove('active');
  const completed = files.filter(f => f.state === 'complete').length;
  const errors = files.filter(f => f.state === 'error').length;
  statusText.textContent = `Done! ${completed} converted${errors > 0 ? `, ${errors} failed` : ''}`;
  if (completed > 0 && lastOutputDir) openOutputBtn.style.display = '';
  log(`Conversion finished: ${completed} completed, ${errors} failed`, errors > 0 ? 'warn' : 'success');
}

function handleProgress(data) {
  const idx = files.findIndex(f => f.path === data.file);
  if (idx === -1) return;

  if (data.type === 'progress') {
    files[idx].progress = data.progress;
    files[idx].status = data.status || 'Converting...';
    files[idx].state = 'processing';
  } else if (data.type === 'complete') {
    files[idx].progress = 1;
    files[idx].status = 'Complete';
    files[idx].state = 'complete';
    log(`Converted: ${files[idx].name}`, 'success');
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
    if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) continue;
    if (files.some(f => f.path === p)) { log(`Skipped duplicate: ${getFileName(p)}`, 'warn'); continue; }
    files.push({ path: p, name: getFileName(p), progress: 0, status: 'Ready', state: 'pending' });
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
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  convertBtn.disabled = pending.length === 0 || isProcessing;
}

// ---- Rendering ----
function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="empty-state">No files added. Drag images or videos here, or click browse.</div>';
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

  const ext = getFileExtension(file.path);
  const icon = IMAGE_EXTS.has(ext) ? '\u{1F5BC}' : '\u{1F3AC}';
  let progressClass = '';
  if (file.state === 'complete') progressClass = ' complete';
  else if (file.state === 'error') progressClass = ' error';

  el.innerHTML = `
    <span class="file-icon">${icon}</span>
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

window.registerTool('format-converter', { init, cleanup });

})();
