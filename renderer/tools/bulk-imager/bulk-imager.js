// ============================================================================
// Bulk Imager Tool — Visual Editor
// ============================================================================

(function() {

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif']);

let files = [];
let outputDir = '';
let isProcessing = false;
let log = null;
let progressCleanup = null;

let dropZone, browseBtn, fileList, applyBtn, clearBtn, openOutputBtn;
let outputDirBtn, statusText, processingIndicator;
let lastOutputDir = '';

// Editor state
let editorModal, editorOverlay, editorCanvas, editorCtx;
let editorCanvasWrap, cropOverlay, wmDrag;
let currentEditorFile = null;
let editorImg = null;
let editorTool = 'crop';
let canvasScale = 1; // ratio of displayed size to actual image size
let canvasOffsetX = 0, canvasOffsetY = 0;

// Crop state
let cropRect = null; // { x, y, w, h } in image coords
let isCropping = false;
let cropStartX = 0, cropStartY = 0;

// Rotate state
let rotateAngle = 0;

// Flip state
let flipH = false, flipV = false;

// Watermark state
let wmText = 'Watermark', wmSize = 40, wmColor = '#ffffff', wmOpacity = 0.5;
let wmX = 0.5, wmY = 0.5; // normalized position (0-1)
let wmDragging = false, wmDragOffX = 0, wmDragOffY = 0;

// Pending operation to apply
let pendingOperation = null;

function init(ctx) {
  log = ctx.log;

  dropZone = document.getElementById('dropZone');
  browseBtn = document.getElementById('browseBtn');
  fileList = document.getElementById('fileList');
  applyBtn = document.getElementById('applyBtn');
  clearBtn = document.getElementById('clearBtn');
  outputDirBtn = document.getElementById('outputDirBtn');
  statusText = document.getElementById('statusText');
  processingIndicator = document.getElementById('processingIndicator');
  openOutputBtn = document.getElementById('openOutputBtn');

  editorModal = document.getElementById('editorModal');
  editorOverlay = document.getElementById('editorOverlay');
  editorCanvas = document.getElementById('editorCanvas');
  editorCtx = editorCanvas.getContext('2d');
  editorCanvasWrap = document.getElementById('editorCanvasWrap');
  cropOverlay = document.getElementById('cropOverlay');
  wmDrag = document.getElementById('wmDrag');

  bindEvents();
  bindEditorEvents();
  if (!outputDir && window.applyDefaultOutputDir) outputDir = window.applyDefaultOutputDir(outputDirBtn);
  log('Bulk Imager ready — click an image to open visual editor');
}

function cleanup() {
  if (progressCleanup) { progressCleanup(); progressCleanup = null; }
  closeEditor();
}

// ========================================================================
// Main tool events
// ========================================================================

function bindEvents() {
  outputDirBtn.addEventListener('click', async () => {
    if (isProcessing) return;
    const dir = await window.api.selectOutputDir();
    if (dir) {
      outputDir = dir;
      const display = dir.length > 35 ? '...' + dir.slice(-32) : dir;
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
      else log('No supported image files found', 'warn');
    }
  });

  browseBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const paths = await window.api.selectFiles({
      title: 'Select Images',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] }]
    });
    if (paths.length > 0) addFiles(paths);
  });

  dropZone.addEventListener('click', async (e) => {
    if (e.target.id === 'browseBtn') return;
    const paths = await window.api.selectFiles({
      title: 'Select Images',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif'] }]
    });
    if (paths.length > 0) addFiles(paths);
  });

  clearBtn.addEventListener('click', () => {
    if (!isProcessing) { clearFiles(); window.clearLog(); openOutputBtn.style.display = 'none'; }
  });

  openOutputBtn.addEventListener('click', () => {
    if (lastOutputDir) window.api.openFolder(lastOutputDir);
  });

  applyBtn.addEventListener('click', () => {
    if (!pendingOperation) {
      log('Open the editor on an image first to set up an operation', 'warn');
      return;
    }
    applyToAll();
  });

  progressCleanup = window.api.onToolProgress((data) => {
    if (data.tool !== 'bulk-imager') return;
    handleProgress(data);
  });
}

// ========================================================================
// Editor events
// ========================================================================

function bindEditorEvents() {
  document.getElementById('editorClose').addEventListener('click', closeEditor);
  editorOverlay.addEventListener('click', closeEditor);

  // Tool switching
  document.querySelectorAll('.editor-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.editor-tool').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.editor-option-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      editorTool = btn.dataset.tool;
      const panel = document.getElementById(`opt-${editorTool}`);
      if (panel) panel.classList.add('active');
      updateEditorOverlays();
      drawEditor();
    });
  });

  // --- Crop ---
  editorCanvasWrap.addEventListener('mousedown', onCanvasMouseDown);
  editorCanvasWrap.addEventListener('mousemove', onCanvasMouseMove);
  editorCanvasWrap.addEventListener('mouseup', onCanvasMouseUp);
  document.getElementById('cropResetBtn').addEventListener('click', () => {
    cropRect = null;
    document.getElementById('cropInfo').textContent = '-';
    updateEditorOverlays();
    drawEditor();
  });

  // --- Resize ---
  const resW = document.getElementById('edResizeW');
  const resH = document.getElementById('edResizeH');
  const resPct = document.getElementById('edResizePct');
  const resLock = document.getElementById('edResizeLock');

  resPct.addEventListener('input', () => {
    if (editorImg && resPct.value) {
      const pct = parseInt(resPct.value) / 100;
      resW.value = Math.round(editorImg.naturalWidth * pct);
      resH.value = Math.round(editorImg.naturalHeight * pct);
    }
    drawEditor();
  });
  resW.addEventListener('input', () => {
    if (resLock.checked && editorImg && resW.value) {
      const ratio = editorImg.naturalHeight / editorImg.naturalWidth;
      resH.value = Math.round(parseInt(resW.value) * ratio);
    }
    resPct.value = '';
    drawEditor();
  });
  resH.addEventListener('input', () => {
    if (resLock.checked && editorImg && resH.value) {
      const ratio = editorImg.naturalWidth / editorImg.naturalHeight;
      resW.value = Math.round(parseInt(resH.value) * ratio);
    }
    resPct.value = '';
    drawEditor();
  });

  // --- Rotate ---
  const rotSlider = document.getElementById('edRotateSlider');
  const rotInfo = document.getElementById('rotateInfo');
  rotSlider.addEventListener('input', () => {
    rotateAngle = parseInt(rotSlider.value);
    rotInfo.innerHTML = `${rotateAngle}&deg;`;
    drawEditor();
  });
  document.getElementById('rotate90CW').addEventListener('click', () => {
    rotateAngle = ((rotateAngle + 90 + 180) % 360) - 180;
    rotSlider.value = rotateAngle;
    rotInfo.innerHTML = `${rotateAngle}&deg;`;
    drawEditor();
  });
  document.getElementById('rotate90CCW').addEventListener('click', () => {
    rotateAngle = ((rotateAngle - 90 + 180) % 360) - 180;
    rotSlider.value = rotateAngle;
    rotInfo.innerHTML = `${rotateAngle}&deg;`;
    drawEditor();
  });
  document.getElementById('rotateResetBtn').addEventListener('click', () => {
    rotateAngle = 0;
    rotSlider.value = 0;
    rotInfo.innerHTML = '0&deg;';
    drawEditor();
  });

  // --- Flip ---
  document.getElementById('flipH').addEventListener('click', () => { flipH = !flipH; drawEditor(); });
  document.getElementById('flipV').addEventListener('click', () => { flipV = !flipV; drawEditor(); });

  // --- Watermark ---
  const wmTextInput = document.getElementById('edWmText');
  const wmSizeInput = document.getElementById('edWmSize');
  const wmColorInput = document.getElementById('edWmColor');
  const wmOpacityInput = document.getElementById('edWmOpacity');

  wmTextInput.addEventListener('input', () => { wmText = wmTextInput.value || 'Watermark'; wmDrag.textContent = wmText; drawEditor(); });
  wmSizeInput.addEventListener('input', () => { wmSize = parseInt(wmSizeInput.value); drawEditor(); });
  wmColorInput.addEventListener('input', () => { wmColor = wmColorInput.value; drawEditor(); });
  wmOpacityInput.addEventListener('input', () => { wmOpacity = parseFloat(wmOpacityInput.value); drawEditor(); });

  // Watermark drag
  wmDrag.addEventListener('mousedown', (e) => {
    wmDragging = true;
    const rect = editorCanvasWrap.getBoundingClientRect();
    wmDragOffX = e.clientX - (wmX * rect.width);
    wmDragOffY = e.clientY - (wmY * rect.height);
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!wmDragging) return;
    const rect = editorCanvasWrap.getBoundingClientRect();
    wmX = Math.max(0, Math.min(1, (e.clientX - wmDragOffX) / rect.width));
    wmY = Math.max(0, Math.min(1, (e.clientY - wmDragOffY) / rect.height));
    positionWmDrag();
    drawEditor();
  });
  document.addEventListener('mouseup', () => { wmDragging = false; });

  // Apply buttons
  document.getElementById('edApplyOne').addEventListener('click', applyToOne);
  document.getElementById('edApplyAll').addEventListener('click', () => { closeEditor(); applyToAll(); });
}

// ========================================================================
// Canvas mouse handlers (crop)
// ========================================================================

function canvasToImage(clientX, clientY) {
  const rect = editorCanvas.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  return {
    x: Math.round(cx / canvasScale),
    y: Math.round(cy / canvasScale)
  };
}

function onCanvasMouseDown(e) {
  if (editorTool !== 'crop' || !editorImg) return;
  const pos = canvasToImage(e.clientX, e.clientY);
  isCropping = true;
  cropStartX = Math.max(0, Math.min(editorImg.naturalWidth, pos.x));
  cropStartY = Math.max(0, Math.min(editorImg.naturalHeight, pos.y));
  cropRect = { x: cropStartX, y: cropStartY, w: 0, h: 0 };
}

function onCanvasMouseMove(e) {
  if (!isCropping || editorTool !== 'crop') return;
  const pos = canvasToImage(e.clientX, e.clientY);
  const ex = Math.max(0, Math.min(editorImg.naturalWidth, pos.x));
  const ey = Math.max(0, Math.min(editorImg.naturalHeight, pos.y));
  cropRect = {
    x: Math.min(cropStartX, ex),
    y: Math.min(cropStartY, ey),
    w: Math.abs(ex - cropStartX),
    h: Math.abs(ey - cropStartY)
  };
  updateCropOverlay();
  document.getElementById('cropInfo').textContent = `${cropRect.w} x ${cropRect.h} at (${cropRect.x}, ${cropRect.y})`;
}

function onCanvasMouseUp() {
  if (!isCropping) return;
  isCropping = false;
  if (cropRect && (cropRect.w < 5 || cropRect.h < 5)) {
    cropRect = null;
    cropOverlay.style.display = 'none';
    document.getElementById('cropInfo').textContent = '-';
  }
}

function updateCropOverlay() {
  if (!cropRect || editorTool !== 'crop') {
    cropOverlay.style.display = 'none';
    return;
  }
  const cRect = editorCanvas.getBoundingClientRect();
  const wrapRect = editorCanvasWrap.getBoundingClientRect();
  const offX = cRect.left - wrapRect.left;
  const offY = cRect.top - wrapRect.top;

  cropOverlay.style.display = 'block';
  cropOverlay.style.left = (offX + cropRect.x * canvasScale) + 'px';
  cropOverlay.style.top = (offY + cropRect.y * canvasScale) + 'px';
  cropOverlay.style.width = (cropRect.w * canvasScale) + 'px';
  cropOverlay.style.height = (cropRect.h * canvasScale) + 'px';
}

// ========================================================================
// Watermark positioning
// ========================================================================

function positionWmDrag() {
  if (editorTool !== 'watermark') { wmDrag.style.display = 'none'; return; }
  const rect = editorCanvasWrap.getBoundingClientRect();
  wmDrag.style.display = 'block';
  wmDrag.style.left = (wmX * rect.width) + 'px';
  wmDrag.style.top = (wmY * rect.height) + 'px';
  wmDrag.style.fontSize = Math.max(12, wmSize * canvasScale) + 'px';
  wmDrag.style.color = wmColor;
  wmDrag.style.opacity = wmOpacity;
}

// ========================================================================
// Editor open/close/draw
// ========================================================================

function openEditor(fileIndex) {
  currentEditorFile = fileIndex;
  const file = files[fileIndex];
  document.getElementById('editorTitle').textContent = `Edit: ${file.name}`;

  // Reset state
  cropRect = null;
  rotateAngle = 0;
  flipH = false;
  flipV = false;
  wmText = 'Watermark';
  wmX = 0.75; wmY = 0.85;
  document.getElementById('edRotateSlider').value = 0;
  document.getElementById('rotateInfo').innerHTML = '0&deg;';
  document.getElementById('cropInfo').textContent = '-';
  document.getElementById('edWmText').value = wmText;
  cropOverlay.style.display = 'none';

  // Load image
  editorImg = new Image();
  editorImg.onload = () => {
    document.getElementById('editorImageInfo').textContent =
      `${editorImg.naturalWidth} x ${editorImg.naturalHeight}`;
    document.getElementById('edResizeW').value = editorImg.naturalWidth;
    document.getElementById('edResizeH').value = editorImg.naturalHeight;
    document.getElementById('edResizePct').value = 100;
    drawEditor();
    updateEditorOverlays();
  };
  editorImg.src = `file://${file.path.replace(/\\/g, '/')}`;

  editorOverlay.classList.add('active');
  editorModal.classList.add('active');
}

function closeEditor() {
  editorOverlay.classList.remove('active');
  editorModal.classList.remove('active');
  cropOverlay.style.display = 'none';
  wmDrag.style.display = 'none';
  currentEditorFile = null;
}

function drawEditor() {
  if (!editorImg || !editorImg.naturalWidth) return;

  const wrap = editorCanvasWrap;
  const maxW = wrap.clientWidth;
  const maxH = wrap.clientHeight;
  let iw = editorImg.naturalWidth;
  let ih = editorImg.naturalHeight;

  // Fit image to canvas area
  canvasScale = Math.min(maxW / iw, maxH / ih, 1);
  const cw = Math.round(iw * canvasScale);
  const ch = Math.round(ih * canvasScale);

  editorCanvas.width = cw;
  editorCanvas.height = ch;
  editorCtx.clearRect(0, 0, cw, ch);

  editorCtx.save();
  editorCtx.translate(cw / 2, ch / 2);

  // Apply rotation
  if (rotateAngle !== 0) {
    editorCtx.rotate(rotateAngle * Math.PI / 180);
  }

  // Apply flip
  const sx = flipH ? -1 : 1;
  const sy = flipV ? -1 : 1;
  editorCtx.scale(sx, sy);

  editorCtx.drawImage(editorImg, -cw / 2, -ch / 2, cw, ch);
  editorCtx.restore();

  // Draw crop darkened overlay
  if (cropRect && editorTool === 'crop') {
    editorCtx.fillStyle = 'rgba(0,0,0,0.5)';
    // Top
    editorCtx.fillRect(0, 0, cw, cropRect.y * canvasScale);
    // Bottom
    const cropBottom = (cropRect.y + cropRect.h) * canvasScale;
    editorCtx.fillRect(0, cropBottom, cw, ch - cropBottom);
    // Left
    editorCtx.fillRect(0, cropRect.y * canvasScale, cropRect.x * canvasScale, cropRect.h * canvasScale);
    // Right
    const cropRight = (cropRect.x + cropRect.w) * canvasScale;
    editorCtx.fillRect(cropRight, cropRect.y * canvasScale, cw - cropRight, cropRect.h * canvasScale);
  }

  // Draw watermark preview
  if (editorTool === 'watermark' && wmText) {
    editorCtx.save();
    editorCtx.globalAlpha = wmOpacity;
    editorCtx.fillStyle = wmColor;
    editorCtx.font = `${Math.max(10, wmSize * canvasScale)}px Arial, Helvetica, sans-serif`;
    editorCtx.fillText(wmText, wmX * cw, wmY * ch);
    editorCtx.restore();
  }

  // Draw resize preview outline
  if (editorTool === 'resize') {
    const rw = parseInt(document.getElementById('edResizeW').value) || iw;
    const rh = parseInt(document.getElementById('edResizeH').value) || ih;
    if (rw !== iw || rh !== ih) {
      const previewW = rw * canvasScale;
      const previewH = rh * canvasScale;
      editorCtx.strokeStyle = '#4ade80';
      editorCtx.lineWidth = 2;
      editorCtx.setLineDash([6, 4]);
      editorCtx.strokeRect(0, 0, Math.min(previewW, cw), Math.min(previewH, ch));
      editorCtx.setLineDash([]);
    }
  }

  updateCropOverlay();
  positionWmDrag();
}

function updateEditorOverlays() {
  cropOverlay.style.display = (editorTool === 'crop' && cropRect) ? 'block' : 'none';
  wmDrag.style.display = editorTool === 'watermark' ? 'block' : 'none';
  if (editorTool === 'watermark') positionWmDrag();
}

// ========================================================================
// Build operation from editor state
// ========================================================================

function buildOperation() {
  if (editorTool === 'crop' && cropRect && cropRect.w > 0 && cropRect.h > 0) {
    return {
      operation: 'crop',
      operationOptions: {
        left: cropRect.x,
        top: cropRect.y,
        width: cropRect.w,
        height: cropRect.h
      }
    };
  }
  if (editorTool === 'resize') {
    const w = parseInt(document.getElementById('edResizeW').value) || null;
    const h = parseInt(document.getElementById('edResizeH').value) || null;
    const pct = parseInt(document.getElementById('edResizePct').value) || null;
    return {
      operation: 'resize',
      operationOptions: { width: w, height: h, percentage: pct }
    };
  }
  if (editorTool === 'rotate') {
    return {
      operation: 'rotate',
      operationOptions: { angle: rotateAngle }
    };
  }
  if (editorTool === 'flip') {
    if (flipH && flipV) {
      // Both flips = 180 rotate
      return { operation: 'rotate', operationOptions: { angle: 180 } };
    }
    return {
      operation: 'flip',
      operationOptions: { direction: flipH ? 'horizontal' : 'vertical' }
    };
  }
  if (editorTool === 'watermark') {
    // Map normalized position to named position
    let position = 'center';
    if (wmY < 0.33) position = wmX < 0.5 ? 'top-left' : 'top-right';
    else if (wmY > 0.66) position = wmX < 0.5 ? 'bottom-left' : 'bottom-right';

    return {
      operation: 'watermark',
      operationOptions: {
        text: wmText,
        fontSize: wmSize,
        color: wmColor,
        opacity: wmOpacity,
        position: position
      }
    };
  }
  return null;
}

// ========================================================================
// Apply operations
// ========================================================================

async function applyToOne() {
  const op = buildOperation();
  if (!op) { log('No operation configured', 'warn'); return; }

  const file = files[currentEditorFile];
  if (!file) return;

  log(`Applying ${op.operation} to ${file.name}...`);
  file.state = 'processing';
  file.status = 'Processing...';

  try {
    const result = await window.api.bulkProcess({
      files: [file.path],
      operation: op.operation,
      operationOptions: op.operationOptions,
      outputDir: outputDir
    });

    if (result && result.success) {
      file.state = 'complete';
      file.progress = 1;
      file.status = 'Complete';
      if (outputDir) lastOutputDir = outputDir;
      else lastOutputDir = file.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      openOutputBtn.style.display = '';
      log(`Done: ${file.name}`, 'success');
    } else {
      file.state = 'error';
      file.status = `Error: ${result ? result.error : 'unknown'}`;
      log(`Error: ${result ? result.error : 'unknown'}`, 'error');
    }
  } catch (err) {
    file.state = 'error';
    file.status = `Error: ${err.message}`;
    log(`Error: ${err.message}`, 'error');
  }

  renderFileList();
  closeEditor();
}

async function applyToAll() {
  const op = pendingOperation || buildOperation();
  if (!op) { log('Open the editor and configure an operation first', 'warn'); return; }

  pendingOperation = op;
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  if (pending.length === 0) { log('No pending files to process', 'warn'); return; }

  isProcessing = true;
  applyBtn.disabled = true;
  processingIndicator.classList.add('active');
  statusText.textContent = `Applying ${op.operation} to ${pending.length} file(s)...`;
  log(`Applying ${op.operation} to ${pending.length} file(s)...`);

  try {
    const result = await window.api.bulkProcess({
      files: pending.map(f => f.path),
      operation: op.operation,
      operationOptions: op.operationOptions,
      outputDir: outputDir
    });

    if (result && result.success && result.results) {
      for (const r of result.results) {
        const idx = files.findIndex(f => f.path === r.input);
        if (idx === -1) continue;
        if (r.success) {
          files[idx].state = 'complete';
          files[idx].progress = 1;
          files[idx].status = 'Complete';
        } else {
          files[idx].state = 'error';
          files[idx].status = `Error: ${r.error}`;
        }
      }
      if (outputDir) lastOutputDir = outputDir;
      else if (pending.length > 0) lastOutputDir = pending[0].path.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    } else if (result && result.error) {
      pending.forEach(f => { f.state = 'error'; f.status = `Error: ${result.error}`; });
      log(`Error: ${result.error}`, 'error');
    }
  } catch (err) {
    pending.forEach(f => { f.state = 'error'; f.status = `Error: ${err.message}`; });
    log(`Error: ${err.message}`, 'error');
  }

  renderFileList();
  isProcessing = false;
  applyBtn.disabled = files.filter(f => f.state === 'pending' || f.state === 'error').length === 0;
  processingIndicator.classList.remove('active');
  const completed = files.filter(f => f.state === 'complete').length;
  const errors = files.filter(f => f.state === 'error').length;
  statusText.textContent = `Done! ${completed} processed${errors > 0 ? `, ${errors} failed` : ''}`;
  if (lastOutputDir) openOutputBtn.style.display = '';
  log(`Finished: ${completed} completed, ${errors} failed`, errors > 0 ? 'warn' : 'success');
}

// ========================================================================
// Progress handler (from IPC)
// ========================================================================

function handleProgress(data) {
  if (data.status) statusText.textContent = data.status;
}

// ========================================================================
// File management
// ========================================================================

function getFileExtension(fp) {
  const parts = fp.replace(/\\/g, '/').split('/').pop().split('.');
  return parts.length > 1 ? '.' + parts.pop().toLowerCase() : '';
}

function getFileName(fp) { return fp.replace(/\\/g, '/').split('/').pop(); }

function addFiles(paths) {
  let added = 0;
  for (const p of paths) {
    const ext = getFileExtension(p);
    if (!IMAGE_EXTS.has(ext)) continue;
    if (files.some(f => f.path === p)) { log(`Skipped duplicate: ${getFileName(p)}`, 'warn'); continue; }
    files.push({ path: p, name: getFileName(p), progress: 0, status: 'Ready', state: 'pending' });
    added++;
  }
  if (added > 0) log(`Added ${added} image file(s) — click an image to edit`);
  renderFileList();
  updateButton();
}

function removeFile(index) { files.splice(index, 1); renderFileList(); updateButton(); }

function clearFiles() {
  files = [];
  pendingOperation = null;
  renderFileList();
  updateButton();
  statusText.textContent = 'Ready';
}

function updateButton() {
  const pending = files.filter(f => f.state === 'pending' || f.state === 'error');
  applyBtn.disabled = pending.length === 0 || isProcessing;
}

// ========================================================================
// Rendering
// ========================================================================

function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="empty-state">No files added yet. Drag images above or click browse.</div>';
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
  el.className = 'file-item file-editable';

  let progressClass = '';
  if (file.state === 'complete') progressClass = ' complete';
  else if (file.state === 'error') progressClass = ' error';

  el.innerHTML = `
    <span class="file-icon">\u{1F5BC}</span>
    <div class="file-info">
      <div class="file-name" title="${window.escapeHtml(file.path)}">${window.escapeHtml(file.name)}<span class="file-edit-badge">click to edit</span></div>
      <div class="file-status">${window.escapeHtml(file.status)}</div>
    </div>
    <div class="file-progress-bar">
      <div class="file-progress-fill${progressClass}" style="width: ${Math.round(file.progress * 100)}%"></div>
    </div>
    <button class="file-remove" data-index="${index}" title="Remove">\u00D7</button>`;

  el.addEventListener('click', (e) => {
    if (e.target.closest('.file-remove')) return;
    if (!isProcessing) openEditor(index);
  });
  el.querySelector('.file-remove').addEventListener('click', (e) => { e.stopPropagation(); if (!isProcessing) removeFile(index); });
  return el;
}

window.registerTool('bulk-imager', { init, cleanup });

})();
