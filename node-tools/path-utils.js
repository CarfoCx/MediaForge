'use strict';

const path = require('path');

/**
 * Validate and normalize an output directory path to prevent path traversal.
 * Returns the normalized absolute path, or null if input is falsy.
 * Throws on invalid/unsafe paths.
 */
function validateOutputDir(outputDir) {
  if (!outputDir) return null;
  // Check for path traversal in the raw input BEFORE resolving
  const segments = outputDir.split(/[/\\]/);
  if (segments.includes('..')) {
    throw new Error('Invalid output directory: path traversal not allowed');
  }
  const normalized = path.resolve(outputDir);
  if (!path.isAbsolute(normalized)) {
    throw new Error('Output directory must be an absolute path');
  }
  return normalized;
}

/**
 * Validate an output filename to prevent path traversal via filenames.
 * Returns the sanitized basename (no directory components).
 */
function validateOutputName(outputName) {
  if (!outputName) return null;
  const basename = path.basename(outputName);
  if (basename !== outputName || basename.includes('..')) {
    throw new Error('Invalid output filename: must not contain directory separators');
  }
  return basename;
}

/**
 * Common file extension sets used across tools for input validation.
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif', '.bmp', '.avif']);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a', '.wma']);
const PDF_EXTS = new Set(['.pdf']);

/**
 * Validate that a file's extension is in the allowed set.
 * Returns the lowercase extension if valid, throws on invalid.
 */
function validateFileType(filePath, allowedExts, toolName) {
  if (!filePath) throw new Error('No file path provided');
  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExts.has(ext)) {
    const allowed = [...allowedExts].join(', ');
    throw new Error(`${toolName || 'Tool'}: unsupported file type "${ext}". Accepted: ${allowed}`);
  }
  return ext;
}

module.exports = { validateOutputDir, validateOutputName, validateFileType, IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, PDF_EXTS };
