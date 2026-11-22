/* A 32 or 48 square grayscale PNG. The bytes are fixed for a given RGB buffer. */
(function (root) {
  var TABLE = null;

  function crcTable() {
    if (TABLE) return TABLE;
    var t = new Uint32Array(256);
    var n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    TABLE = t;
    return t;
  }

  function crc32(bytes) {
    var table = crcTable();
    var c = 0xffffffff;
    var i;
    for (i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    var a = 1;
    var b = 0;
    var i;
    for (i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  function u32(n) {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }

  function concat(parts) {
    var n = 0;
    var i, j, out, off;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    out = new Uint8Array(n);
    off = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], off);
      off += parts[i].length;
    }
    return out;
  }

  function chunk(type, data) {
    var body = new Uint8Array(4 + data.length);
    var crc, out;
    body.set(type, 0);
    body.set(data, 4);
    crc = crc32(body);
    out = new Uint8Array(8 + body.length);
    out.set(u32(data.length), 0);
    out.set(body, 4);
    out.set(u32(crc), 4 + body.length);
    return out;
  }

  /* One zlib stream of stored deflate blocks. No compressor choices. */
  function zlibStore(raw) {
    var parts = [0x78, 0x01];
    var off = 0;
    var n, last, i, ad, bytes;
    while (off < raw.length) {
      n = raw.length - off;
      if (n > 65535) n = 65535;
      last = off + n >= raw.length;
      parts.push(last ? 1 : 0);
      parts.push(n & 255, (n >> 8) & 255, (~n) & 255, ((~n) >> 8) & 255);
      for (i = 0; i < n; i++) parts.push(raw[off + i]);
      off += n;
    }
    ad = adler32(raw);
    parts.push((ad >>> 24) & 255, (ad >>> 16) & 255, (ad >>> 8) & 255, ad & 255);
    bytes = new Uint8Array(parts.length);
    for (i = 0; i < parts.length; i++) bytes[i] = parts[i];
    return bytes;
  }

  function idiv(a, b) {
    return (a - (a % b)) / b;
  }

  /* Integer box average. Luminance is (77R + 150G + 29B) >> 8. */
  function grayFromRgb(rgb, w, h, side) {
    var out = new Uint8Array(side * side);
    var dy, dx, y0, y1, x0, x1, y, x, sum, count, i, lum;
    if (w < 1 || h < 1 || rgb.length < w * h * 3) throw new Error("rgb");
    for (dy = 0; dy < side; dy++) {
      y0 = idiv(dy * h, side);
      y1 = idiv((dy + 1) * h, side);
      if (y1 <= y0) y1 = y0 + 1;
      for (dx = 0; dx < side; dx++) {
        x0 = idiv(dx * w, side);
        x1 = idiv((dx + 1) * w, side);
        if (x1 <= x0) x1 = x0 + 1;
        sum = 0;
        count = 0;
        for (y = y0; y < y1 && y < h; y++) {
          for (x = x0; x < x1 && x < w; x++) {
            i = (y * w + x) * 3;
            lum = (77 * rgb[i] + 150 * rgb[i + 1] + 29 * rgb[i + 2]) >> 8;
            sum += lum;
            count += 1;
          }
        }
        out[dy * side + dx] = idiv(sum, count);
      }
    }
    return out;
  }

  function encodeGray(gray, w, h) {
    var raw, sig, ihdr, idat, iend, y, x, o;
    if ((w !== 48 && w !== 32) || w !== h) throw new Error("side");
    if (gray.length !== w * h) throw new Error("gray");
    raw = new Uint8Array(h * (w + 1));
    for (y = 0; y < h; y++) {
      o = y * (w + 1);
      raw[o] = 0;
      for (x = 0; x < w; x++) raw[o + 1 + x] = gray[y * w + x];
    }
    sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    ihdr = chunk(
      new Uint8Array([73, 72, 68, 82]),
      new Uint8Array(u32(w).concat(u32(h), [8, 0, 0, 0, 0]))
    );
    idat = chunk(new Uint8Array([73, 68, 65, 84]), zlibStore(raw));
    iend = chunk(new Uint8Array([73, 69, 78, 68]), new Uint8Array(0));
    return concat([sig, ihdr, idat, iend]);
  }

  function thumbnail(rgb, w, h, side) {
    return encodeGray(grayFromRgb(rgb, w, h, side || 48), side || 48, side || 48);
  }

  root.OnPlatePng = {
    grayFromRgb: grayFromRgb,
    encodeGray: encodeGray,
    thumbnail: thumbnail
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
