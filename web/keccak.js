/* Keccak-256. The padding byte is 0x01. This is not NIST SHA-3. */
(function (root) {
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  var ROT = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14]
  ];
  var MASK = (1n << 64n) - 1n;

  function rotl(x, n) {
    n = BigInt(n);
    if (n === 0n) return x;
    return ((x << n) | (x >> (64n - n))) & MASK;
  }

  function keccakF(a) {
    var C = [0n, 0n, 0n, 0n, 0n];
    var D = [0n, 0n, 0n, 0n, 0n];
    var B = [
      [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]
    ];
    var round, x, y;
    for (round = 0; round < 24; round++) {
      for (x = 0; x < 5; x++) C[x] = a[x][0] ^ a[x][1] ^ a[x][2] ^ a[x][3] ^ a[x][4];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) a[x][y] = (a[x][y] ^ D[x]) & MASK;
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rotl(a[x][y], ROT[x][y]);
      for (x = 0; x < 5; x++) for (y = 0; y < 5; y++) {
        a[x][y] = (B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y])) & MASK;
      }
      a[0][0] = (a[0][0] ^ RC[round]) & MASK;
    }
  }

  function blank() {
    return [
      [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n]
    ];
  }

  function xorRate(a, block) {
    var i, x, y, lane, k;
    for (i = 0; i < 17; i++) {
      lane = 0n;
      for (k = 0; k < 8; k++) lane |= BigInt(block[i * 8 + k]) << BigInt(8 * k);
      x = i % 5;
      y = (i / 5) | 0;
      a[x][y] = (a[x][y] ^ lane) & MASK;
    }
  }

  function keccak256(bytes) {
    var msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var rate = 136;
    var a = blank();
    var off = 0;
    var block, rem, i, out, lane, x, y, k;
    while (off + rate <= msg.length) {
      xorRate(a, msg.subarray(off, off + rate));
      keccakF(a);
      off += rate;
    }
    block = new Uint8Array(rate);
    rem = msg.length - off;
    for (i = 0; i < rem; i++) block[i] = msg[off + i];
    block[rem] ^= 0x01;
    block[rate - 1] ^= 0x80;
    xorRate(a, block);
    keccakF(a);
    out = new Uint8Array(32);
    for (i = 0; i < 4; i++) {
      x = i % 5;
      y = (i / 5) | 0;
      lane = a[x][y];
      for (k = 0; k < 8; k++) out[i * 8 + k] = Number((lane >> BigInt(8 * k)) & 0xffn);
    }
    return out;
  }

  function hex(bytes) {
    var s = "";
    var i, b;
    for (i = 0; i < bytes.length; i++) {
      b = bytes[i].toString(16);
      s += b.length === 1 ? "0" + b : b;
    }
    return s;
  }

  root.OnPlateKeccak = { keccak256: keccak256, hex: hex };
})(typeof globalThis !== "undefined" ? globalThis : this);
