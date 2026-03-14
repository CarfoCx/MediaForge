# MediaForge

All-in-one desktop media toolkit powered by AI. Upscale images, separate audio stems, convert formats, remove backgrounds, and more — all from a single app.

![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.10--3.13-3776AB?logo=python&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-CUDA-EE4C2C?logo=pytorch&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## Tools

| Tool | Description |
|------|-------------|
| **AI Upscaler** | Enhance image quality and resolution using Real-ESRGAN (2x/4x scale, GPU-accelerated) |
| **Stem Separator** | Isolate vocals, drums, bass, and instruments from any audio track using Meta's Demucs AI |
| **Format Converter** | Convert between image formats (PNG, JPG, WebP, AVIF, TIFF) and video formats (MP4, MKV, WebM, AVI, MOV) with quality control |
| **Audio Extractor** | Extract audio from video files to MP3, WAV, FLAC, AAC, or OGG |
| **GIF Maker** | Create optimized GIFs from video clips with FPS, width, and duration control |
| **Video Compressor** | Reduce video file size with CRF, preset, and resolution options |
| **BG Remover** | Remove image backgrounds using AI (rembg) — outputs transparent PNG |
| **Bulk Imager** | Visual editor for batch image operations: crop, resize, rotate, flip, and watermark with interactive canvas controls |
| **PDF Toolkit** | Merge, split, and extract pages from PDFs with drag-to-reorder support |
| **QR Studio** | Generate styled QR codes (custom colors, size, error correction) and scan/decode QR codes from images |

## Requirements

- **Python 3.10 - 3.13** (3.14 is not yet compatible with PyTorch)
- **Node.js 18+**
- **ffmpeg** — required for video tools (GIF Maker, Video Compressor, Audio Extractor, Format Converter video mode). Install from https://ffmpeg.org/download.html
- **NVIDIA GPU with CUDA** — recommended for fast AI processing. The app works on CPU but will be significantly slower for upscaling and stem separation.

## Setup

### Windows (recommended)

```bash
git clone https://github.com/CarfoCx/MediaForge.git
cd MediaForge
setup.bat
```

The setup script will:
1. Check for Python, Node.js, and ffmpeg
2. Install PyTorch with CUDA support
3. Install all Python dependencies (Real-ESRGAN, Demucs, rembg, etc.)
4. Install Node.js dependencies (Electron, Sharp, etc.)

### Manual Setup

```bash
git clone https://github.com/CarfoCx/MediaForge.git
cd MediaForge

# Install PyTorch with CUDA (for NVIDIA GPU acceleration)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

# Install Python dependencies
pip install -r python/requirements.txt

# Install Node.js dependencies
npm install
```

For CPU-only (no NVIDIA GPU):
```bash
pip install torch torchvision torchaudio
pip install -r python/requirements.txt
```

## Usage

```bash
npm start
```

The app will:
1. Detect your Python installation (3.10-3.13)
2. Start the FastAPI backend server
3. Open the Electron desktop window
4. Detect your GPU and display stats in the sidebar

### Settings

Click the gear icon in the sidebar footer to access Settings:
- **Default Output Directory** — set a global output folder for all tools
- **Default Upscale Factor** — 2x or 4x
- **Model Profile** — General or Anime-optimized
- **System Info** — view app version, Python version, GPU, VRAM, and installed modules

## Hardware Compatibility

| Hardware | Support |
|----------|---------|
| NVIDIA GPU (CUDA) | Full GPU acceleration, adaptive tile sizes based on VRAM |
| 2-4 GB VRAM | Supported with smaller tile sizes and reduced max image resolution |
| 6-8 GB VRAM | Full support with optimized tile sizes |
| 10+ GB VRAM | Maximum performance and resolution support |
| CPU only (no GPU) | Fully functional but slower. Multi-core threading enabled automatically |
| AMD GPU | Falls back to CPU (PyTorch CUDA is NVIDIA-only) |

The app automatically:
- Detects available hardware and adjusts tile sizes
- Scales maximum image resolution based on VRAM
- Retries with smaller tiles on GPU out-of-memory errors
- Falls back to CPU if no NVIDIA GPU is detected

## Project Structure

```
MediaForge/
├── main.js                    # Electron main process
├── preload.js                 # IPC bridge (context isolation)
├── package.json               # Node.js config
├── setup.bat                  # Windows setup script
├── renderer/
│   ├── index.html             # Main UI shell
│   ├── app.js                 # App shell, sidebar, settings
│   ├── app.css                # Global styles (dark theme)
│   └── tools/                 # Each tool has its own folder
│       ├── upscaler/          # AI Upscaler
│       ├── stem-separator/    # Stem Separator
│       ├── format-converter/  # Format Converter
│       ├── audio-extractor/   # Audio Extractor
│       ├── gif-maker/         # GIF Maker
│       ├── video-compressor/  # Video Compressor
│       ├── bg-remover/        # Background Remover
│       ├── bulk-imager/       # Bulk Imager (visual editor)
│       ├── pdf-toolkit/       # PDF Toolkit
│       ├── qr-studio/         # QR Studio
│       └── settings/          # Settings page
├── node-tools/                # Node.js processing backends
│   ├── format-converter.js
│   ├── audio-extractor.js
│   ├── gif-maker.js
│   ├── video-compressor.js
│   ├── bulk-imager.js
│   ├── pdf-toolkit.js
│   ├── qr-studio.js
│   ├── ffmpeg-runner.js
│   └── path-utils.js
└── python/                    # Python AI backend (FastAPI)
    ├── server.py              # FastAPI server with WebSocket
    ├── upscaler.py            # Real-ESRGAN implementation
    ├── requirements.txt
    ├── modules/
    │   ├── bg_remover.py      # rembg wrapper
    │   └── stem_separator.py  # Demucs wrapper
    └── routers/
        ├── bg_remover_routes.py
        └── stem_separator_routes.py
```

## Support

If you find MediaForge useful, consider supporting its development:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Development-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/carfo)

## License

MIT
