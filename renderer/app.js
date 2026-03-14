// ============================================================================
// MediaForge - App Shell
// Handles sidebar navigation, tool loading, log panel, GPU stats
// ============================================================================

let pythonPort = null;
let currentToolId = null;
let currentToolModule = null;
let vramInterval = null;

// DOM elements
const toolContent = document.getElementById('toolContent');
const logEntries = document.getElementById('logEntries');
const logPanel = document.getElementById('logPanel');
const logToggle = document.getElementById('logToggle');
const gpuBadge = document.getElementById('gpuBadge');
const gpuStats = document.getElementById('gpuStats');
const gpuUtilStat = document.getElementById('gpuUtilStat');
const gpuTempStat = document.getElementById('gpuTempStat');
const gpuMemStat = document.getElementById('gpuMemStat');
// versionBadge removed — version now shown in Settings
const toolStylesheet = document.getElementById('toolStylesheet');

// ============================================================================
// Log panel
// ============================================================================

logToggle.addEventListener('click', () => {
  logPanel.classList.toggle('collapsed');
  saveGlobalSettings();
});

function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${level}">${escapeHtml(message)}</span>`;
  logEntries.appendChild(entry);
  while (logEntries.children.length > 200) {
    logEntries.removeChild(logEntries.firstChild);
  }
  logEntries.parentElement.scrollTop = logEntries.parentElement.scrollHeight;
}

function clearLog() {
  logEntries.innerHTML = '';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Make log and escapeHtml available globally for tools
window.log = log;
window.clearLog = clearLog;
window.escapeHtml = escapeHtml;

// Global clipboard paste support — saves pasted images to temp and dispatches
document.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob && blob.path) {
        // Electron file from clipboard — resolve and add
        const resolved = await window.api.resolveDroppedPaths([blob.path]);
        if (resolved.length > 0) {
          document.dispatchEvent(new CustomEvent('paste-files', { detail: resolved }));
        }
      }
    }
  }
});

// ============================================================================
// Settings
// ============================================================================

let globalSettings = {};

async function loadGlobalSettings() {
  try {
    const all = await window.api.loadSettings();
    globalSettings = all.global || {};
    return all;
  } catch (err) {
    console.warn('Failed to load settings:', err);
    return {};
  }
}

function saveGlobalSettings() {
  window.api.loadSettings().then(all => {
    all.global = {
      ...(all.global || {}),
      logCollapsed: logPanel.classList.contains('collapsed'),
      lastTool: currentToolId,
    };
    globalSettings = all.global;
    window.api.saveSettings(all);
  });
}

// Default output directory helpers — used by all tools
window.getDefaultOutputDir = () => globalSettings.defaultOutputDir || '';
window.applyDefaultOutputDir = (outputDirBtn) => {
  const defaultDir = globalSettings.defaultOutputDir || '';
  if (defaultDir && outputDirBtn) {
    const parts = defaultDir.replace(/\\/g, '/').split('/');
    const display = parts.length > 2 ? '.../' + parts.slice(-2).join('/') : defaultDir;
    outputDirBtn.textContent = display;
    outputDirBtn.title = defaultDir;
  }
  return defaultDir;
};

// Expose settings helpers for tools
window.loadAllSettings = () => window.api.loadSettings();
window.saveAllSettings = (settings) => window.api.saveSettings(settings);

// ============================================================================
// GPU monitoring
// ============================================================================

function startGpuPolling() {
  if (vramInterval) return;
  vramInterval = setInterval(pollGpuStats, 2000);
  pollGpuStats();
}

async function pollGpuStats() {
  try {
    const resp = await fetch(`http://127.0.0.1:${pythonPort}/vram`);
    const data = await resp.json();
    if (!data.available) return;

    gpuStats.classList.add('active');

    if (data.gpu_util != null) {
      gpuUtilStat.textContent = `GPU ${data.gpu_util}%`;
      gpuUtilStat.className = 'gpu-stat';
      if (data.gpu_util > 90) gpuUtilStat.classList.add('danger');
      else if (data.gpu_util > 70) gpuUtilStat.classList.add('warn');
    }

    if (data.temperature != null) {
      gpuTempStat.textContent = `${data.temperature}\u00B0C`;
      gpuTempStat.className = 'gpu-stat';
      if (data.temperature > 85) gpuTempStat.classList.add('danger');
      else if (data.temperature > 75) gpuTempStat.classList.add('warn');
    }

    if (data.total) {
      const totalGB = (data.total / (1024 ** 3)).toFixed(1);
      const usedGB = (data.used / (1024 ** 3)).toFixed(1);
      const memPct = Math.round((data.used / data.total) * 100);
      gpuMemStat.textContent = `${usedGB}/${totalGB} GB`;
      gpuMemStat.className = 'gpu-stat';
      if (memPct > 90) gpuMemStat.classList.add('danger');
      else if (memPct > 75) gpuMemStat.classList.add('warn');
    }
  } catch (err) {
    // GPU polling unavailable — hide stats silently
    gpuStats.classList.remove('active');
  }
}

function checkHealth() {
  fetch(`http://127.0.0.1:${pythonPort}/health`)
    .then(r => r.json())
    .then(data => {
      gpuBadge.textContent = data.device === 'cuda' ? data.gpu_name || 'GPU Ready' : 'CPU Mode (slower)';
      gpuBadge.style.borderColor = data.device === 'cuda' ? '#4ade80' : '#fbbf24';
      log(`Device: ${data.device.toUpperCase()}`, data.device === 'cuda' ? 'success' : 'warn');
      if (data.gpu_name) log(`GPU: ${data.gpu_name}`);
      if (data.device !== 'cuda') {
        log('No NVIDIA GPU detected — processing will be slower. An NVIDIA GPU with CUDA is recommended for best performance.', 'warn');
      }
      if (data.python_version) log(`Python ${data.python_version}`);
    })
    .catch(() => {
      gpuBadge.textContent = 'Backend Error';
      gpuBadge.style.borderColor = '#f87171';
      log('Failed to reach backend', 'error');
    });
}

// ============================================================================
// Tool loading / sidebar navigation
// ============================================================================

const toolRegistry = {};

function registerTool(id, module) {
  toolRegistry[id] = module;
}

// Make this available globally so tool scripts can self-register
window.registerTool = registerTool;
window.pythonPort = null; // will be set during init

async function loadTool(toolId) {
  if (toolId === currentToolId) return;

  // Cleanup current tool
  if (currentToolModule && currentToolModule.cleanup) {
    currentToolModule.cleanup();
  }
  currentToolModule = null;

  // Update sidebar
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tool === toolId);
  });

  currentToolId = toolId;

  // Load tool CSS
  toolStylesheet.href = `tools/${toolId}/${toolId}.css`;

  // Load tool HTML
  try {
    const resp = await fetch(`tools/${toolId}/${toolId}.html`);
    if (!resp.ok) throw new Error('not found');
    const html = await resp.text();
    toolContent.innerHTML = html;
  } catch {
    toolContent.innerHTML = `
      <div class="tool-placeholder">
        <div class="tool-placeholder-icon">&#128679;</div>
        <div class="tool-placeholder-text">This tool is coming soon</div>
      </div>`;
    saveGlobalSettings();
    return;
  }

  // Load and execute tool JS
  try {
    // Remove old tool script if any
    const oldScript = document.getElementById('toolScript');
    if (oldScript) oldScript.remove();

    const script = document.createElement('script');
    script.id = 'toolScript';
    script.src = `tools/${toolId}/${toolId}.js`;
    document.body.appendChild(script);

    // Wait for script to register and init
    await new Promise((resolve) => {
      script.onload = () => {
        if (toolRegistry[toolId]) {
          currentToolModule = toolRegistry[toolId];
          if (currentToolModule.init) {
            currentToolModule.init({ pythonPort, log, escapeHtml, clearLog });
          }
        }
        resolve();
      };
      script.onerror = resolve;
    });
  } catch (e) {
    log(`Failed to load tool: ${toolId}`, 'error');
  }

  saveGlobalSettings();
}

// Sidebar click handlers
document.querySelectorAll('.sidebar-item').forEach(item => {
  item.addEventListener('click', () => {
    loadTool(item.dataset.tool);
  });
});

// ============================================================================
// Init
// ============================================================================

async function init() {
  log('Starting MediaForge...');

  const allSettings = await loadGlobalSettings();
  if (allSettings.global?.logCollapsed) {
    logPanel.classList.add('collapsed');
  }

  pythonPort = await window.api.getPythonPort();
  window.pythonPort = pythonPort;
  log(`Backend port: ${pythonPort}`);

  checkHealth();
  startGpuPolling();

  window.api.onPythonCrashed((code) => {
    log(`Python backend crashed (exit code ${code})`, 'error');
  });

  // Load last used tool or default to upscaler
  const startTool = allSettings.global?.lastTool || 'upscaler';
  loadTool(startTool);
}

init();
