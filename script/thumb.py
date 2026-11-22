"""Dump RGB bytes for the thumbnail. The PNG encoder is script/make-thumb.js."""
import struct
import sys
from PIL import Image, ImageOps

src, dest = sys.argv[1], sys.argv[2]
image = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
w, h = image.size
rgb = image.tobytes()
with open(dest, "wb") as out:
    out.write(struct.pack(">II", w, h))
    out.write(rgb)
print(w, h, len(rgb))
