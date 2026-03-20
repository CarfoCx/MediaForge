'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('./ffmpeg-runner');
const { validateOutputDir } = require('./path-utils');

function registerIPC(ipcMain, getMainWindow) {
  let activeCancel = null;

  ipcMain.handle('gif-maker-create', async (event, options) => {
    const {
      inputPath,
      outputDir,
      fps,          // 10-30, default 15
      width,        // output width, -1 for auto-scale, default 480
      startTime,    // start offset in seconds, default 0
      duration      // clip duration in seconds, default full
    } = options;

    let palettePath = null;

    try {
      if (!ffmpeg.findFfmpeg()) {
        return { success: false, error: 'ffmpeg not found. Please install ffmpeg and add it to your PATH.' };
      }

      const gifFps = Math.max(1, Math.min(30, fps || 15));
      const gifWidth = width || 480;
      const ext = path.extname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outDir = validateOutputDir(outputDir) || path.dirname(inputPath);
      const outputPath = path.join(outDir, baseName + '.gif');

      fs.mkdirSync(outDir, { recursive: true });

      // Temp palette file (declared before try so it's accessible in finally)
      palettePath = path.join(os.tmpdir(), `palette_${Date.now()}.png`);

      // Probe total duration for progress calculation
      const totalDuration = await ffmpeg.probeDuration(inputPath);
      const clipDuration = duration || totalDuration;

      const win = getMainWindow();
      if (win) {
        win.webContents.send('tool-progress', {
          tool: 'gif-maker',
          percent: 0,
          status: 'Generating palette (pass 1/2)...'
        });
      }

      // Build input seek / duration args
      const inputArgs = [];
      if (startTime && startTime !== '00:00:00' && startTime !== '0') {
        inputArgs.push('-ss', String(startTime));
      }
      inputArgs.push('-i', inputPath);
      if (duration && duration > 0) {
        inputArgs.push('-t', String(duration));
      }

      const filterScale = `fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos`;

      // ------- PASS 1: Generate palette -------
      const pass1Args = [
        ...inputArgs,
        '-vf', `${filterScale},palettegen=stats_mode=diff`,
        palettePath
      ];

      const onPass1Progress = (info) => {
        const w = getMainWindow();
        if (w) {
          // Pass 1 accounts for 0-40%
          const pct = Math.min(40, (info.percent || 0) * 0.4);
          w.webContents.send('tool-progress', {
            tool: 'gif-maker',
            percent: pct,
            status: `Generating palette... ${Math.round(pct)}%`
          });
        }
      };

      const pass1 = ffmpeg.run({
        args: pass1Args,
        durationSeconds: clipDuration,
        onProgress: onPass1Progress
      });
      activeCancel = pass1.cancel;
      await pass1.promise;
      activeCancel = null;

      // ------- PASS 2: Create GIF using palette -------
      if (win) {
        win.webContents.send('tool-progress', {
          tool: 'gif-maker',
          percent: 40,
          status: 'Creating GIF (pass 2/2)...'
        });
      }

      const pass2Args = [
        ...inputArgs,
        '-i', palettePath,
        '-lavfi', `${filterScale} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5`,
        outputPath
      ];

      const onPass2Progress = (info) => {
        const w = getMainWindow();
        if (w) {
          // Pass 2 accounts for 40-100%
          const pct = 40 + Math.min(60, (info.percent || 0) * 0.6);
          w.webContents.send('tool-progress', {
            tool: 'gif-maker',
            percent: pct,
            status: `Creating GIF... ${Math.round(pct)}%`
          });
        }
      };

      const pass2 = ffmpeg.run({
        args: pass2Args,
        durationSeconds: clipDuration,
        onProgress: onPass2Progress
      });
      activeCancel = pass2.cancel;
      await pass2.promise;
      activeCancel = null;

      // Clean up palette
      try { fs.unlinkSync(palettePath); } catch {}

      // Get output file size
      let outputSize = 0;
      try { outputSize = fs.statSync(outputPath).size; } catch {}

      const w = getMainWindow();
      if (w) {
        w.webContents.send('tool-progress', {
          tool: 'gif-maker',
          percent: 100,
          status: 'Done'
        });
      }

      return {
        success: true,
        output: outputPath,
        outputSize
      };
    } catch (err) {
      activeCancel = null;
      return { success: false, error: err.message };
    } finally {
      // Always clean up palette file
      if (palettePath) { try { fs.unlinkSync(palettePath); } catch {} }
    }
  });

  ipcMain.handle('gif-maker-cancel', async () => {
    if (activeCancel) {
      activeCancel();
      activeCancel = null;
      return { success: true };
    }
    return { success: false, error: 'No active GIF creation to cancel' };
  });
}

module.exports = { registerIPC };
