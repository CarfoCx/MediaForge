import asyncio
import os
import queue as thread_queue
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from modules.bg_remover import BGRemover
from routers.validation import validate_output_dir

remover = None

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff', '.tif'}


@asynccontextmanager
async def bg_lifespan(app):
    global remover
    remover = BGRemover()
    yield

router = APIRouter(lifespan=bg_lifespan)


@router.websocket('/ws')
async def bg_remover_ws(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            try:
                data = await ws.receive_json()
            except Exception:
                await ws.send_json({'type': 'error', 'error': 'Invalid message'})
                continue
            action = data.get('action')

            if action == 'remove':
                remover.reset_cancel()
                files = data['files']
                output_format = data.get('output_format', 'png')
                output_dir = data.get('output_dir', '')

                for file_path in files:
                    if remover.cancel_event.is_set():
                        await ws.send_json({'type': 'error', 'file': file_path, 'error': 'Cancelled'})
                        continue

                    try:
                        name = Path(file_path).stem
                        out_ext = f'.{output_format}'
                        out_dir = validate_output_dir(output_dir) or str(Path(file_path).parent)
                        os.makedirs(out_dir, exist_ok=True)
                        output_path = os.path.join(out_dir, f'{name}_nobg{out_ext}')

                        progress_q = thread_queue.Queue()

                        def on_progress(pct, status, _fp=file_path):
                            progress_q.put_nowait((pct, status))

                        loop = asyncio.get_event_loop()
                        task = loop.run_in_executor(
                            None, remover.remove_background, file_path, output_path, on_progress
                        )

                        while not task.done():
                            while not progress_q.empty():
                                pct, status = progress_q.get_nowait()
                                await ws.send_json({
                                    'type': 'progress', 'file': file_path,
                                    'progress': pct, 'status': status
                                })
                            await asyncio.sleep(0.2)

                        while not progress_q.empty():
                            pct, status = progress_q.get_nowait()
                            await ws.send_json({
                                'type': 'progress', 'file': file_path,
                                'progress': pct, 'status': status
                            })

                        await task

                        await ws.send_json({
                            'type': 'complete', 'file': file_path,
                            'output': output_path, 'progress': 1.0
                        })

                    except Exception as e:
                        await ws.send_json({
                            'type': 'error', 'file': file_path,
                            'error': str(e)
                        })

                await ws.send_json({'type': 'all_complete'})

            elif action == 'cancel':
                remover.cancel()

    except WebSocketDisconnect:
        pass
