"""Regenerate tiny browser-test GIFs and independent Pillow-rendered reference pixels."""
import base64
import io
import json
from pathlib import Path
from PIL import Image

fixtures = []
for name, disposal, loop, transparent in [
    ('transparent-clear', [1, 2, 1], 0, True),
    ('transparent-restore', [1, 3, 1], 0, True),
    ('opaque-clear', [1, 2, 1], 0, False),
    ('once', [1, 1, 1], None, False),
    ('repeat-once', [1, 1, 1], 1, False),
    ('zero-delay', [1, 2, 1], 0, True),
    ('fast-delay', [1, 2, 1], 0, True),
]:
    frames = []
    for i in range(3):
        frame = Image.new('P', (4, 4), 0)
        frame.putpalette([0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0] + [0] * (768 - 12))
        for y in range(2):
            for x in range(2):
                frame.putpixel((x + i % 2 * 2, y + i // 2 * 2), i + 1)
        frames.append(frame)
    options = {'loop': loop} if loop is not None else {}
    if transparent:
        options['transparency'] = 0
    buffer = io.BytesIO()
    delays = [0, 0, 0] if name == 'zero-delay' else [10, 10, 10] if name == 'fast-delay' else [100, 200, 50]
    frames[0].save(buffer, format='GIF', save_all=True, append_images=frames[1:],
                   duration=delays, disposal=disposal, optimize=False, **options)
    content = buffer.getvalue()
    expected = []
    with Image.open(io.BytesIO(content)) as image:
        for i in range(image.n_frames):
            image.seek(i)
            canvas = Image.new('RGBA', image.size, (0, 0, 0, 0))
            canvas.alpha_composite(image.convert('RGBA'))
            expected.append(list(canvas.tobytes()))
    fixtures.append({'name': name, 'base64': base64.b64encode(content).decode(), 'expected': expected,
                     'delays': [max(50, delay or 100) for delay in delays]})

destination = Path(__file__).parent / 'fixtures' / 'gifs.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(fixtures), encoding='utf-8')
