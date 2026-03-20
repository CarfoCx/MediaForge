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

module.exports = { validateOutputDir, validateOutputName };
