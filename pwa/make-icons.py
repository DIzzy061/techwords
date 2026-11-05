from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    img = Image.new('RGB', (size, size), '#202c28')
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype('C:/Windows/Fonts/georgiab.ttf', int(size * .75))
    draw.text((size * .19, size * .005), 't', font=font, fill='#d7ef71')
    small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', int(size * .25))
    draw.text((size * .62, size * .15), '×', font=small, fill='#d7ef71')
    img.save(root / name)
