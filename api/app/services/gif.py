"""Bounded GIF validation and composited frames for moderation."""

import io
from collections.abc import Iterator

from PIL import Image, UnidentifiedImageError

# Keep in sync with src/utils/gifTexture.ts.
MAX_DIMENSION = 1024
MAX_FRAMES = 120
MAX_PIXELS = 32 * 1024 * 1024
MAX_BYTES = 10 * 1024 * 1024


def gif_images(content: bytes) -> Iterator[Image.Image]:
  if len(content) > MAX_BYTES:
    raise ValueError("GIF must be 10 MiB or smaller.")
  try:
    with Image.open(io.BytesIO(content)) as image:
      if image.format != "GIF":
        raise ValueError("This file is not a valid GIF image.")
      width, height = image.size
      if min(width, height) < 1 or max(width, height) > MAX_DIMENSION:
        raise ValueError("GIF dimensions must be between 1 and 1024 pixels.")
      # Walk incrementally rather than scanning an unbounded n_frames first.
      index = 0
      while True:
        if image.size != (width, height):
          raise ValueError("Invalid GIF image frame dimensions.")
        if index >= MAX_FRAMES or width * height * (index + 1) > MAX_PIXELS:
          raise ValueError("GIF is too complex: maximum 120 frames and 32 million decoded pixels.")
        image.load()
        # Pillow applies transparency and frame disposal while seeking.
        yield image.convert("RGBA")
        index += 1
        try:
          image.seek(index)
        except EOFError:
          break
  except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
    raise ValueError("This file is not a valid GIF image.") from exc


def validate_gif(content: bytes) -> None:
  for frame in gif_images(content):
    frame.close()


def gif_moderation_images(content: bytes, max_samples: int = 8) -> Iterator[dict]:
  with Image.open(io.BytesIO(content)) as image:
    count = image.n_frames
  samples = min(count, max_samples)
  selected = {i * (count - 1) // max(1, samples - 1) for i in range(samples)}
  for index, frame in enumerate(gif_images(content)):
    # Use a neutral background for moderation; display preserves transparency.
    with frame:
      if index not in selected:
        continue
      with Image.new("RGB", frame.size, "#f8f4ea") as background:
        background.paste(frame, mask=frame.getchannel("A"))
        buffer = io.BytesIO()
        background.save(buffer, format="PNG")
        yield {"Bytes": buffer.getvalue()}
