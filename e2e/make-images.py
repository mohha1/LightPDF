"""Writes the image fixtures and a large scanned-style PDF into e2e/fixtures/. Needs Pillow."""
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

out = pathlib.Path(__file__).parent / 'fixtures'
out.mkdir(exist_ok=True)

photo = Image.new('RGB', (1200, 800), (40, 120, 200))
ImageDraw.Draw(photo).ellipse([300, 200, 900, 600], fill=(250, 200, 40))
photo.save(out / 'photo.jpg', quality=85)

# Stored sideways with EXIF orientation 6, like many phone photos.
exif = Image.Exif()
exif[0x0112] = 6
rotated = Image.new('RGB', (800, 400), (200, 60, 60))
ImageDraw.Draw(rotated).rectangle([0, 0, 200, 400], fill=(20, 20, 20))
rotated.save(out / 'rotated.jpg', exif=exif.tobytes())

Image.new('RGBA', (300, 500), (0, 160, 90, 200)).save(out / 'shape.png')
Image.new('RGB', (400, 300), (120, 60, 200)).save(out / 'pic.webp')

# A noisy "scan" so compression has something to do (about 1.3 MB).
random.seed(1)
scan = Image.new('RGB', (1700, 2200), (245, 240, 230))
draw = ImageDraw.Draw(scan)
for y in range(150, 2100, 60):
    draw.rectangle([150, y, 150 + random.randint(800, 1400), y + 22], fill=(40, 40, 40))
scan = scan.filter(ImageFilter.GaussianBlur(1))
pixels = scan.load()
for _ in range(400000):
    x, y = random.randrange(1700), random.randrange(2200)
    value = max(0, min(255, pixels[x, y][0] + random.randint(-25, 25)))
    pixels[x, y] = (value, value, value)
scan.save(out / 'scan.pdf', 'PDF', resolution=200, quality=95)
print(f'Image fixtures written to {out}')
