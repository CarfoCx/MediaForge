import os
import threading
from pathlib import Path

try:
    from rembg import remove
    from PIL import Image
    _available = True
except ImportError:
    _available = False


def is_available():
    return _available


class BGRemover:
    def __init__(self):
        self.cancel_event = threading.Event()

    def cancel(self):
        self.cancel_event.set()

    def reset_cancel(self):
        self.cancel_event.clear()

    def remove_background(self, input_path, output_path, progress_callback=None):
        if not _available:
            raise RuntimeError('rembg is not installed. Run: pip install rembg[gpu]')

        if self.cancel_event.is_set():
            raise RuntimeError('Cancelled')

        if progress_callback:
            progress_callback(0.1, 'Loading image...')

        img = Image.open(input_path)

        if self.cancel_event.is_set():
            raise RuntimeError('Cancelled')

        if progress_callback:
            progress_callback(0.3, 'Removing background...')

        result = remove(img)

        if self.cancel_event.is_set():
            raise RuntimeError('Cancelled')

        if progress_callback:
            progress_callback(0.9, 'Saving...')

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        result.save(output_path)

        if progress_callback:
            progress_callback(1.0, 'Complete')

        return output_path
