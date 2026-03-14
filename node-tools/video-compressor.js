'use strict';

const path = require('path');
const fs = require('fs');
const ffmpeg = require('./ffmpeg-runner');
const { validateOutputDir } = require('./path-utils');

const VALID_PRESETS = [
  'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
  'medium', 'slow', 'slower', 'veryslow'
];

function registerIPC(ipcMain, getMainWindow) {
  let activeCancel = null;

  ipcMain.handle('video-compressor-compress', async (event, options) => {
    const {
      inputPath,
      outputDir,
      crf,          // 18-28, default 23
      preset,       // ultrafast..veryslow, default 'medium'
      resolution,   // e.g. '1280x720', '1920x1080', or null for original
      audioBitrate  // e.g. '128k', default '128k'
    } = options;

    try {
      if (!ffmpeg.findFfmpeg()) {
        return { success: false, error: 'ffmpeg not found. Please install ffmpeg and add it to your PATH.' };
      }

      const crfValue = Math.max(0, Math.min(51, crf != null ? crf : 23));
      const presetValue = VALID_PRESETS.includes(preset) ? preset : 'medium';
      const audioBr = audioBitrate || '128k';

      const ext = path.extname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outDir = validateOutputDir(outputDir) || path.dirname(inputPath);
      const outputPath = path.join(outDir, baseName + '_compressed.mp4');

      fs.mkdirSync(outDir, { recursive: true });

      // Get input file size for compression ratio
      let inputSize = 0;
      try { inputSize = fs.statSync(inputPath).size; } catch (err) { console.warn('Could not read input size:', err.message); }

      // Probe duration
      const duration = await ffmpeg.probeDuration(inputPath);

      const win = getMainWindow();
      if (win) {
        win.webContents.send('tool-progress', {
          tool: 'video-compressor',
          percent: 0,
          status: 'Compressing video...',
          inputSize,
          duration
        });
      }

      // Build args
      const args = ['-i', inputPath];
      args.push('-c:v', 'libx264');
      args.push('-crf', String(crfValue));
      args.push('-preset', presetValue);

      // Optional resolution scaling
      if (resolution) {
        const [w, h] = resolution.split('x').map(Number);
        if (w && h && w <= 7680 && h <= 4320) {
          // Scale to exact resolution, padding if needed to maintain aspect ratio
          args.push('-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
        }
      }

      args.push('-c:a', 'aac', '-b:a', audioBr);
      args.push('-movflags', '+faststart');
      args.push(outputPath);

      const onProgress = (info) => {
        const w = getMainWindow();
        if (w) {
          // Estimate output size based on current progress
          const estimatedSize = info.sizeKB ? info.sizeKB * 1024 : null;
          const estimatedFinalSize = (estimatedSize && info.percent > 0)
            ? Math.round(estimatedSize / (info.percent / 100))
            : null;
          const compressionRatio = (estimatedFinalSize && inputSize > 0)
            ? (estimatedFinalSize / inputSize).toFixed(2)
            : null;

          w.webContents.send('tool-progress', {
            tool: 'video-compressor',
            percent: info.percent || 0,
            frame: info.frame,
            speed: info.speed,
            currentSizeKB: info.sizeKB,
            estimatedFinalSize,
            compressionRatio,
            status: `Compressing... ${Math.round(info.percent || 0)}%`
          });
        }
      };

      const { promise, cancel } = ffmpeg.run({ args, durationSeconds: duration, onProgress });
      activeCancel = cancel;

      await promise;
      activeCancel = null;

      // Get output file size and compute ratio
      let outputSize = 0;
      try { outputSize = fs.statSync(outputPath).size; } catch (err) { console.warn('Could not read output size:', err.message); }
      const compressionRatio = inputSize > 0 ? (outputSize / inputSize).toFixed(2) : null;
      const savedBytes = inputSize - outputSize;
      const savedPercent = inputSize > 0 ? ((savedBytes / inputSize) * 100).toFixed(1) : 0;

      const w = getMainWindow();
      if (w) {
        w.webContents.send('tool-progress', {
          tool: 'video-compressor',
          percent: 100,
          status: 'Done'
        });
      }

      return {
        success: true,
        output: outputPath,
        inputSize,
        outputSize,
        compressionRatio,
        savedBytes,
        savedPercent: parseFloat(savedPercent)
      };
    } catch (err) {
      activeCancel = null;
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('video-compressor-cancel', async () => {
    if (activeCancel) {
      activeCancel();
      activeCancel = null;
      return { success: true };
    }
    return { success: false, error: 'No active compression to cancel' };
  });

  ipcMain.handle('video-compressor-estimate', async (event, options) => {
    // Rough size estimate based on CRF and duration
    try {
      const duration = await ffmpeg.probeDuration(options.inputPath);
      let inputSize = 0;
      try { inputSize = fs.statSync(options.inputPath).size; } catch {}

      // Very rough estimate: CRF 23 roughly halves the file for most content
      // Each CRF +6 roughly halves the size
      const crfDiff = (options.crf || 23) - 18;
      const factor = Math.pow(0.5, crfDiff / 6);
      const estimatedSize = Math.round(inputSize * factor);

      return {
        success: true,
        duration,
        inputSize,
        estimatedOutputSize: estimatedSize,
        estimatedRatio: inputSize > 0 ? (estimatedSize / inputSize).toFixed(2) : null
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerIPC };
