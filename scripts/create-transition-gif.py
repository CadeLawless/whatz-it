"""Build the lightweight looping orientation-transition animation."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "images" / "goose-shuffling.png"
OUTPUT = ROOT / "assets" / "images" / "goose-shuffling.gif"
CANVAS_SIZE = 320
TEAL = (37, 107, 115, 255)


source = Image.open(SOURCE).convert("RGBA")
alpha_box = source.getchannel("A").getbbox()
if alpha_box is None:
    raise RuntimeError("Goose source has no visible pixels")

subject = source.crop(alpha_box)
subject.thumbnail((260, 276), Image.Resampling.LANCZOS)

rotations = (-1.4, -0.8, 0.0, 0.8, 1.4, 0.8, 0.0, -0.8)
x_offsets = (0, -2, -3, -2, 0, 2, 3, 2)
y_offsets = (2, 0, -3, -5, -3, 0, 2, 3)
frames = []

for rotation, x_offset, y_offset in zip(rotations, x_offsets, y_offsets, strict=True):
    frame = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), TEAL)
    pose = subject.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)
    x = (CANVAS_SIZE - pose.width) // 2 + x_offset
    y = (CANVAS_SIZE - pose.height) // 2 + y_offset
    frame.alpha_composite(pose, (x, y))
    frames.append(frame.convert("RGB"))

frames[0].save(
    OUTPUT,
    save_all=True,
    append_images=frames[1:],
    duration=85,
    loop=0,
    optimize=True,
)
