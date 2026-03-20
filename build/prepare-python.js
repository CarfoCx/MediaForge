/**
 * MediaForge Build Script
 * Prepares the Python environment and ffmpeg for bundling.
 *
 * Usage:
 *   node build/prepare-python.js full   — bundles portable Python + all deps + ffmpeg
 *   node build/prepare-python.js slim   — bundles only ffmpeg (Python auto-installed on first run)
 *
 * Detects the current platform and downloads the appropriate binaries.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BUNDLE_DIR = path.join(__dirname, 'bundle');
const PYTHON_ENV_DIR = path.join(BUNDLE_DIR, 'python-env');
const FFMPEG_DIR = path.join(BUNDLE_DIR, 'ffmpeg');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Python embeddable (Windows only — macOS uses system Python + venv)
const PYTHON_VERSION = '3.13.0';
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;

// FFmpeg download URLs per platform
const FFMPEG_URLS = {
  win32: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  darwin: {
    ffmpeg: 'https://evermeet.cx/ffmpeg/getrelease/zip',
    ffprobe: 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip'
  }
};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (url) => {
      https.get(url, { headers: { 'User-Agent': 'MediaForge-Builder' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          request(res.headers.location);
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            process.stdout.write(`\r  Progress: ${pct}% (${(downloaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log(''); resolve(); });
      }).on('error', reject);
    };
    request(url);
  });
}

function extractZip(zipPath, destDir) {
  console.log(`  Extracting to ${destDir}...`);
  fs.mkdirSync(destDir, { recursive: true });

  if (IS_WIN) {
    const cmds = [
      `7z x "${zipPath}" -o"${destDir}" -y`,
      `cmd /c "tar -xf ""${zipPath}"" -C ""${destDir}"""`,
      `powershell -Command "Expand-Archive -Force '${zipPath}' '${destDir}'"`,
    ];
    for (const cmd of cmds) {
      try {
        execSync(cmd, { stdio: 'pipe', timeout: 120000 });
        return;
      } catch {}
    }
    throw new Error(`Failed to extract ${zipPath}`);
  } else {
    // macOS / Linux: use unzip
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe', timeout: 120000 });
  }
}

// ─── FFmpeg Bundling ─────────────────────────────────────────────────────────

async function prepareFfmpegWindows() {
  console.log('\n=== Preparing ffmpeg (Windows) ===');
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });

  if (fs.existsSync(path.join(FFMPEG_DIR, 'ffmpeg.exe'))) {
    console.log('  ffmpeg already prepared');
    return;
  }

  const ffmpegZip = path.join(BUNDLE_DIR, 'ffmpeg.zip');
  await downloadFile(FFMPEG_URLS.win32, ffmpegZip);

  const tempDir = path.join(BUNDLE_DIR, 'ffmpeg-temp');
  extractZip(ffmpegZip, tempDir);

  // Find the ffmpeg.exe inside the extracted folder
  const dirs = fs.readdirSync(tempDir);
  const ffmpegRoot = dirs.find(d => d.startsWith('ffmpeg'));
  if (ffmpegRoot) {
    const binDir = path.join(tempDir, ffmpegRoot, 'bin');
    for (const file of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = path.join(binDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(FFMPEG_DIR, file));
      }
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.rmSync(ffmpegZip, { force: true });
  console.log('  ffmpeg ready');
}

async function prepareFfmpegMac() {
  console.log('\n=== Preparing ffmpeg (macOS) ===');
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });

  if (fs.existsSync(path.join(FFMPEG_DIR, 'ffmpeg'))) {
    console.log('  ffmpeg already prepared');
    return;
  }

  // Download ffmpeg binary
  const ffmpegZip = path.join(BUNDLE_DIR, 'ffmpeg-mac.zip');
  await downloadFile(FFMPEG_URLS.darwin.ffmpeg, ffmpegZip);
  extractZip(ffmpegZip, FFMPEG_DIR);
  fs.rmSync(ffmpegZip, { force: true });

  // Download ffprobe binary
  const ffprobeZip = path.join(BUNDLE_DIR, 'ffprobe-mac.zip');
  await downloadFile(FFMPEG_URLS.darwin.ffprobe, ffprobeZip);
  extractZip(ffprobeZip, FFMPEG_DIR);
  fs.rmSync(ffprobeZip, { force: true });

  // Make executable
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const binPath = path.join(FFMPEG_DIR, bin);
    if (fs.existsSync(binPath)) {
      fs.chmodSync(binPath, 0o755);
    }
  }
  console.log('  ffmpeg ready');
}

async function prepareFfmpeg() {
  if (IS_WIN) {
    await prepareFfmpegWindows();
  } else if (IS_MAC) {
    await prepareFfmpegMac();
  } else {
    console.log('\n=== Skipping ffmpeg (Linux — users install via package manager) ===');
    fs.mkdirSync(FFMPEG_DIR, { recursive: true });
  }
}

// ─── Python Environment Bundling ─────────────────────────────────────────────

async function preparePythonFullWindows() {
  console.log('\n=== Preparing Python environment (Windows full) ===');
  fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });

  const pythonExe = path.join(PYTHON_ENV_DIR, 'python.exe');

  if (fs.existsSync(pythonExe)) {
    console.log('  Python environment already prepared');
    return;
  }

  // Download Python embeddable
  console.log('Step 1/4: Downloading Python embeddable...');
  const pythonZip = path.join(BUNDLE_DIR, 'python-embed.zip');
  await downloadFile(PYTHON_EMBED_URL, pythonZip);
  extractZip(pythonZip, PYTHON_ENV_DIR);
  fs.rmSync(pythonZip, { force: true });

  // Enable pip by uncommenting import site in python*._pth
  console.log('Step 2/4: Enabling pip...');
  const pthFiles = fs.readdirSync(PYTHON_ENV_DIR).filter(f => f.endsWith('._pth'));
  for (const pth of pthFiles) {
    const pthPath = path.join(PYTHON_ENV_DIR, pth);
    let content = fs.readFileSync(pthPath, 'utf-8');
    content = content.replace('#import site', 'import site');
    if (!content.includes('Lib/site-packages')) {
      content += '\nLib/site-packages\n';
    }
    fs.writeFileSync(pthPath, content);
  }

  // Install pip
  console.log('Step 3/4: Installing pip...');
  const getPipPath = path.join(PYTHON_ENV_DIR, 'get-pip.py');
  await downloadFile('https://bootstrap.pypa.io/get-pip.py', getPipPath);
  execSync(`"${pythonExe}" get-pip.py --no-warn-script-location`, {
    cwd: PYTHON_ENV_DIR, stdio: 'inherit'
  });
  fs.rmSync(getPipPath, { force: true });

  // Install dependencies
  console.log('Step 4/4: Installing dependencies (this will take a while)...');
  const requirementsPath = path.join(__dirname, '..', 'python', 'requirements.txt');

  console.log('  Installing PyTorch with CUDA...');
  execSync(`"${pythonExe}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124 --no-warn-script-location`, {
    stdio: 'inherit', timeout: 600000
  });

  console.log('  Installing remaining dependencies...');
  execSync(`"${pythonExe}" -m pip install -r "${requirementsPath}" --no-warn-script-location`, {
    stdio: 'inherit', timeout: 600000
  });

  console.log('  Python environment ready');
}

async function preparePythonFullMac() {
  console.log('\n=== Preparing Python environment (macOS full) ===');
  fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });

  const venvPython = path.join(PYTHON_ENV_DIR, 'bin', 'python3');

  if (fs.existsSync(venvPython)) {
    console.log('  Python environment already prepared');
    return;
  }

  // Create venv from system Python
  console.log('Step 1/3: Creating Python virtual environment...');
  const systemPython = findSystemPython();
  if (!systemPython) {
    throw new Error('Python 3.10+ is required on macOS to build the full bundle.\nInstall from https://python.org/downloads or: brew install python@3.12');
  }
  console.log(`  Using: ${systemPython}`);
  execSync(`"${systemPython}" -m venv "${PYTHON_ENV_DIR}"`, { stdio: 'inherit' });

  // Install PyTorch (MPS for Apple Silicon)
  console.log('Step 2/3: Installing PyTorch (MPS)...');
  execSync(`"${venvPython}" -m pip install torch torchvision torchaudio --no-warn-script-location`, {
    stdio: 'inherit', timeout: 600000
  });

  // Install remaining deps
  console.log('Step 3/3: Installing remaining dependencies...');
  const requirementsPath = path.join(__dirname, '..', 'python', 'requirements.txt');
  execSync(`"${venvPython}" -m pip install -r "${requirementsPath}" --no-warn-script-location`, {
    stdio: 'inherit', timeout: 600000
  });

  console.log('  Python environment ready');
}

function findSystemPython() {
  const cmds = ['python3', 'python'];
  for (const cmd of cmds) {
    try {
      const result = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
      const match = result.match(/Python (\d+)\.(\d+)/);
      if (match && parseInt(match[1]) === 3 && parseInt(match[2]) >= 10) {
        return cmd;
      }
    } catch {}
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] || 'slim';
  console.log(`\nMediaForge Build — Mode: ${mode.toUpperCase()} — Platform: ${process.platform}`);
  console.log('='.repeat(60));

  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  await prepareFfmpeg();

  if (mode === 'full') {
    if (IS_WIN) {
      await preparePythonFullWindows();
    } else if (IS_MAC) {
      await preparePythonFullMac();
    } else {
      console.log('\n=== Full build not supported on Linux (use system Python) ===');
    }
  } else {
    // Slim mode — create empty python-env dir with marker
    fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(PYTHON_ENV_DIR, '.slim'),
      'This is the slim build. Python will be installed on first run.'
    );
    console.log('\n=== Slim mode: Python will be auto-installed on first run ===');
  }

  console.log('\n=== Build preparation complete ===');
  console.log(`Bundle directory: ${BUNDLE_DIR}`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
