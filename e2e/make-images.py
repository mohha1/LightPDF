"""Writes the image fixtures and a large scanned-style PDF into e2e/fixtures/. Needs Pillow."""
import io
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


# An old typed form, scanned: yellowed, uneven paper with grain and a stain.
random.seed(2)
old = Image.new('RGB', (1240, 1754))
pixels = old.load()
for y in range(1754):
    for x in range(1240):
        shade = (x - 620) ** 2 / 90000 + (y - 877) ** 2 / 160000  # darker towards the edges
        grain = random.randint(-6, 6)
        pixels[x, y] = (int(233 - shade * 9 + grain), int(219 - shade * 10 + grain), int(176 - shade * 12 + grain))
stain = Image.new('L', old.size, 0)
ImageDraw.Draw(stain).ellipse([700, 300, 1100, 650], fill=60)
old.paste((190, 165, 110), mask=stain.filter(ImageFilter.GaussianBlur(60)))
try:
    from PIL import ImageFont
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 44)
except OSError:
    font = None
typed = ImageDraw.Draw(old)
for line, text in enumerate(['APPLICATION FORM', '', 'Name: moha', 'City: Barcelona', 'Phone: 0123 456 789']):
    typed.text((160, 300 + line * 90), text, fill=(45, 40, 38), font=font)
old.filter(ImageFilter.GaussianBlur(0.6)).save(out / 'old-scan.pdf', 'PDF', resolution=150, quality=90)


def pdf_with_image(path, data, width, height, params):
    """Writes a one-page PDF that shows one image stream as it is."""
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] '
        f'/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'.encode(),
        f'<< /Type /XObject /Subtype /Image /Width {width} /Height {height} {params} /Length {len(data)} >>\nstream\n'.encode()
        + data + b'\nendstream',
    ]
    content = f'q {width} 0 0 {height} 0 0 cm /Im0 Do Q'.encode()
    objects.append(f'<< /Length {len(content)} >>\nstream\n'.encode() + content + b'\nendstream')
    pdf, offsets = bytearray(b'%PDF-1.7\n'), []
    for number, body in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(pdf)
    pdf += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    pdf += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets)
    pdf += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    path.write_bytes(pdf)


# Image codecs PDF.js decodes with WebAssembly: JPEG 2000 and CCITT fax (black-and-white scans).
picture = Image.new('RGB', (600, 800), (255, 255, 255))
ImageDraw.Draw(picture).ellipse([100, 200, 500, 600], fill=(30, 30, 160))
jp2 = io.BytesIO()
picture.save(jp2, 'JPEG2000')
pdf_with_image(out / 'jpx.pdf', jp2.getvalue(), 600, 800, '/Filter /JPXDecode')
fax = Image.new('1', (1200, 1600), 1)
ImageDraw.Draw(fax).ellipse([200, 400, 1000, 1200], fill=0)
fax.save(out / 'ccitt.pdf', 'PDF', resolution=150)

print(f'Image fixtures written to {out}')
