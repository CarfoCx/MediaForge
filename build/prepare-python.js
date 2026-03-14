/**
 * MediaForge Build Script
 * Prepares the Python environment for bundling.
 *
 * Usage:
 *   node build/prepare-python.js full   — bundles portable Python + all deps + ffmpeg
 *   node build/prepare-python.js slim   — bundles only ffmpeg (Python auto-installed on first run)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BUNDLE_DIR = path.join(__dirname, 'bundle');
const PYTHON_ENV_DIR = path.join(BUNDLE_DIR, 'python-env');
const FFMPEG_DIR = path.join(BUNDLE_DIR, 'ffmpeg');

const PYTHON_VERSION = '3.13.0';
const PYTHON_EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`;
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`  Downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    const request = (url) => {
      https.get(url, (res) => {
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
            process.stdout.write(`\r  Progress: ${pct}%`);
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
  // Use PowerShell to extract on Windows
  execSync(`powershell -Command "Expand-Archive -Force '${zipPath}' '${destDir}'"`, { stdio: 'inherit' });
}

async function prepareFfmpeg() {
  console.log('\n=== Preparing ffmpeg ===');
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });

  const ffmpegZip = path.join(BUNDLE_DIR, 'ffmpeg.zip');

  if (!fs.existsSync(path.join(FFMPEG_DIR, 'ffmpeg.exe'))) {
    await downloadFile(FFMPEG_URL, ffmpegZip);
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
  } else {
    console.log('  ffmpeg already prepared');
  }
}

async function preparePythonFull() {
  console.log('\n=== Preparing Python environment (full) ===');
  fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });

  const pythonZip = path.join(BUNDLE_DIR, 'python-embed.zip');

  if (!fs.existsSync(path.join(PYTHON_ENV_DIR, 'python.exe'))) {
    // Download Python embeddable
    console.log('Step 1/4: Downloading Python embeddable...');
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
      // Add Lib/site-packages to the path
      if (!content.includes('Lib/site-packages')) {
        content += '\nLib/site-packages\n';
      }
      fs.writeFileSync(pthPath, content);
    }

    // Install pip
    console.log('Step 3/4: Installing pip...');
    const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py';
    const getPipPath = path.join(PYTHON_ENV_DIR, 'get-pip.py');
    await downloadFile(getPipUrl, getPipPath);
    execSync(`"${path.join(PYTHON_ENV_DIR, 'python.exe')}" get-pip.py --no-warn-script-location`, {
      cwd: PYTHON_ENV_DIR,
      stdio: 'inherit'
    });
    fs.rmSync(getPipPath, { force: true });

    // Install all dependencies
    console.log('Step 4/4: Installing dependencies (this will take a while)...');
    const requirementsPath = path.join(__dirname, '..', 'python', 'requirements.txt');
    const pythonExe = path.join(PYTHON_ENV_DIR, 'python.exe');

    // Install PyTorch with CUDA first
    console.log('  Installing PyTorch with CUDA...');
    execSync(`"${pythonExe}" -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124 --no-warn-script-location`, {
      stdio: 'inherit',
      timeout: 600000
    });

    // Install remaining requirements
    console.log('  Installing remaining dependencies...');
    execSync(`"${pythonExe}" -m pip install -r "${requirementsPath}" --no-warn-script-location`, {
      stdio: 'inherit',
      timeout: 600000
    });

    console.log('  Python environment ready');
  } else {
    console.log('  Python environment already prepared');
  }
}

async function main() {
  const mode = process.argv[2] || 'slim';
  console.log(`\nMediaForge Build — Mode: ${mode.toUpperCase()}`);
  console.log('='.repeat(50));

  fs.mkdirSync(BUNDLE_DIR, { recursive: true });

  await prepareFfmpeg();

  if (mode === 'full') {
    await preparePythonFull();
  } else {
    // Slim mode — create empty python-env dir so electron-builder doesn't error
    fs.mkdirSync(PYTHON_ENV_DIR, { recursive: true });
    fs.writeFileSync(path.join(PYTHON_ENV_DIR, '.slim'), 'This is the slim build. Python will be installed on first run.');
    console.log('\n=== Slim mode: Python will be auto-installed on first run ===');
  }

  console.log('\n=== Build preparation complete ===');
  console.log(`Bundle directory: ${BUNDLE_DIR}`);
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
