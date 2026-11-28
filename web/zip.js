/* STORE-method zip. No compression, no extra fields, CRC-32 of IEEE 0xEDB88320.
   The page must not load a zip library from the network. */
(function () {
  var TABLE = (function () {
    var t = new Uint32Array(256);
    var i, c, k;
    for (i = 0; i < 256; i++) {
      c = i;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    var i;
    for (i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }

  function u32(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function concat(parts) {
    var n = 0;
    var i, out, at;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    out = new Uint8Array(n);
    at = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], at);
      at += parts[i].length;
    }
    return out;
  }

  function nameBytes(name) {
    var s = String(name || "");
    var raw, i, c;
    if (s === "." || s === "..") throw new Error("name");
    raw = new TextEncoder().encode(s);
    if (!raw.length || raw.length > 180) throw new Error("name");
    for (i = 0; i < raw.length; i++) {
      c = raw[i];
      if (c < 32 || c === 47 || c === 92) throw new Error("name");
    }
    return raw;
  }

  // files: [{ name, bytes: Uint8Array }]
  function pack(files) {
    var locals = [];
    var centrals = [];
    var offset = 0;
    var i, name, data, crc, local, central, end, key, seen;
    if (!files || !files.length) throw new Error("files");
    seen = {};
    for (i = 0; i < files.length; i++) {
      name = nameBytes(files[i].name);
      key = String(files[i].name).toLowerCase();
      if (seen[key]) throw new Error("name");
      seen[key] = 1;
      data = files[i].bytes;
      if (!(data instanceof Uint8Array)) throw new Error("bytes");
      crc = crc32(data);
      local = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        name,
        data
      ]);
      central = concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    end = concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
      u16(0),
      u16(0),
      u16(files.length),
      u16(files.length),
      u32(centrals.reduce(function (n, part) { return n + part.length; }, 0)),
      u32(offset),
      u16(0)
    ]);
    return concat(locals.concat(centrals).concat([end]));
  }

  window.OnPlateZip = { pack: pack };
})();
