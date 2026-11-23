/* Reads and writes. A transaction leaves this file only after the selector check. */
(function (root) {
  var K = root.OnPlateKeccak;
  var READ_MS = 8000;
  var QUIET = "the chain did not answer.";
  var CHUNK = 18432;
  // The factory stops at 1,150 pieces. Image bytes stay in chunk code.
  // Osaka (Anvil, mainnet now): one full piece through ChunkBatch is about 4,115,033 gas.
  // Sepolia (Glamsterdam): a live eth_estimateGas of one full PlateChunk create was 28,730,342.
  // The cost line multiplies gasPerChunk(chain) by the piece count and that chain's gas price.
  var CONTRACT_CHUNKS = 1150;
  var PIECE_CEILING = 1150;
  // Four full pieces fit in one Osaka transaction. Five do not.
  // OPEN_MAX is frozen in a deployed factory. STORE_GROUP_MAX is only how
  // many pieces one createPieces call may hold. Raising it does not change
  // the per-byte storage bill.
  var OPEN_MAX = 4;
  var STORE_GROUP_MAX = 16;
  var GAS_PER_CHUNK = 4115033n;
  var GAS_PER_CHUNK_SEPOLIA = 28730342n;
  var ENTROPY_MIN = 4;
  var CHAINS = {
    mainnet: [
      "https://ethereum.publicnode.com",
      "https://eth.drpc.org",
      "https://1rpc.io/eth",
      "https://rpc.mevblocker.io",
      "https://gateway.tenderly.co/public/mainnet",
      "https://eth.api.pocket.network"
    ],
    sepolia: [
      "https://ethereum-sepolia-rpc.publicnode.com",
      "https://gateway.tenderly.co/public/sepolia",
      "https://sepolia.drpc.org",
      "https://rpc.sepolia.ethpandaops.io",
      "https://1rpc.io/sepolia",
      "https://ethereum-sepolia.publicnode.com"
    ],
    anvil: ["http://127.0.0.1:8545"]
  };
  var CHAIN_ID = { mainnet: 1, sepolia: 11155111, anvil: 31337 };
  var CHAIN_HEX = { mainnet: "0x1", sepolia: "0xaa36a7", anvil: "0x7a69" };
  var FACTORIES = { mainnet: "", sepolia: "0xA4538835b53e19A5ad2B4b21104FF8DEbAd9B520" };
  var SIG = {
    photoCount: "photoCount()",
    photoAt: "photoAt(uint256)",
    contentHash: "contentHash()",
    chunkCount: "chunkCount()",
    chunkAt: "chunkAt(uint256)",
    name: "name()",
    description: "description()",
    devBps: "devBps()",
    defaultArtistBps: "defaultArtistBps()",
    artistBps: "artistBps()",
    devRecipient: "devRecipient()",
    artistRecipient: "artistRecipient()",
    title: "title()",
    mailbox: "mailbox()",
    parked: "parked()",
    listedPrice: "listedPrice()",
    allowedBuyer: "allowedBuyer()",
    ownerOf: "ownerOf(uint256)",
    claimable: "claimable(address)",
    canAdd: "canAdd(address)",
    owner: "owner()",
    authorized: "authorized(address)",
    page: "page()",
    addPhoto: "addPhoto(string,string,string,bytes32,address,bytes,uint16,uint16,address)",
    linkPhoto: "linkPhoto(bytes32,address[],uint16,uint16,address,bytes)",
    linkPhotoHome: "linkPhoto(bytes32,address[],uint16,uint16,address,bytes,address)",
    openBook: "openBook(uint256)",
    openBookHome: "openBook(uint256,address)",
    artistName: "artistName()",
    nominationAllowed: "nominationAllowed()",
    openMax: "openMax()",
    addChunks: "addChunks(address,address[])",
    sealBook: "sealBook(address)",
    maxChunks: "maxChunks()",
    appendMax: "appendMax()",
    artist: "artist()",
    expected: "expected()",
    locked: "locked()",
    used: "used()",
    list: "list(uint256)",
    cancel: "cancel()",
    buy: "buy()",
    setAllowedBuyer: "setAllowedBuyer(address)",
    setMailbox: "setMailbox(address)",
    release: "release()",
    clearMailbox: "clearMailbox()",
    withdraw: "withdraw()",
    burn: "burn()",
    book: "book()",
    plateId: "plateId()",
    accounted: "accounted()",
    thumbnail: "thumbnail()",
    isPhoto: "isPhoto(address)",
    tokenURI: "tokenURI(uint256)",
    originalPrice: "originalPrice()",
    nominated: "nominated()",
    nominationRevoked: "nominationRevoked()",
    vaultedSince: "vaultedSince()",
    nominate: "nominate(address)",
    createPieces: "createPieces(bytes[])",
    printed: "printed()",
    pieceExpect: "pieceExpect()",
    maker: "maker(address)",
    batch: "batch()",
    liveWork: "liveWork(bytes32)"
  };
  var WANT = {
    photoCount: "0x12d28b18",
    photoAt: "0x0d6d931a",
    contentHash: "0x646c2e33",
    chunkCount: "0xf91f0937",
    chunkAt: "0x1bbb6678",
    name: "0x06fdde03",
    description: "0x7284e416",
    devBps: "0x78b2c179",
    defaultArtistBps: "0x26f2785f",
    artistBps: "0x71424249",
    devRecipient: "0x9b7f48d8",
    artistRecipient: "0x3a34842e",
    title: "0x4a79d50c",
    mailbox: "0xd5438eae",
    parked: "0x355a4b9b",
    listedPrice: "0x57ed4b2f",
    allowedBuyer: "0xbf8ed6b6",
    ownerOf: "0x6352211e",
    claimable: "0x402914f5",
    canAdd: "0x289420c1",
    owner: "0x8da5cb5b",
    authorized: "0xb9181611",
    page: "0x0df813b9",
    addPhoto: "0xb3953a83",
    linkPhoto: "0xea7daa0f",
    linkPhotoHome: "0x96597d16",
    artistName: "0x5b2f515b",
    nominationAllowed: "0x554d6b44",
    openMax: "0xc2773d4e",
    openBook: "0xbdc2bde3",
    openBookHome: "0xb5a3d743",
    addChunks: "0xab2f49b3",
    sealBook: "0xb64419f0",
    maxChunks: "0xbb881e41",
    appendMax: "0x521afe60",
    artist: "0x43bc1612",
    expected: "0x1ce62383",
    locked: "0xcf309012",
    used: "0x63898e2b",
    list: "0x80c9419e",
    cancel: "0xea8a1af0",
    buy: "0xa6f2ae3a",
    setAllowedBuyer: "0xd2c540c8",
    setMailbox: "0xf3c61d6b",
    release: "0x86d1a69f",
    clearMailbox: "0x7cb887d2",
    withdraw: "0x3ccfd60b",
    burn: "0x44df8e70",
    book: "0x05a8da72",
    plateId: "0xbd62b216",
    accounted: "0x19f8dcf1",
    thumbnail: "0x5afc2ab4",
    isPhoto: "0x0b08ad68",
    tokenURI: "0xc87b56dd",
    originalPrice: "0x76a24f25",
    nominated: "0x8450ccb5",
    nominationRevoked: "0xbd891b1e",
    vaultedSince: "0x78e6f6d2",
    nominate: "0xb332180b",
    createPieces: "0x8d580411",
    printed: "0xa10654f2",
    pieceExpect: "0x354bc1a6",
    maker: "0xcbb31da9",
    batch: "0xaf713566",
    liveWork: "0x42b48ebb"
  };
  var SEND = {
    addPhoto: 1, linkPhoto: 1, openBook: 1, addChunks: 1, sealBook: 1, list: 1, cancel: 1, buy: 1,
    setAllowedBuyer: 1, setMailbox: 1, release: 1, clearMailbox: 1, withdraw: 1, nominate: 1, burn: 1
  };
  var OFF = "onplate-off";
  var planStore = null;
  // Anvil uses this address, or ?batch= on localhost. Mainnet stays empty.
  var BATCHES = {
    mainnet: "",
    sepolia: "0xdd275A792eD54b723da035717CA16b4c8Ee64367",
    anvil: "0x663F3ad617193148711d28f5334eE4Ed07016602"
  };
  // Public Sepolia nodes refuse eth_getLogs from block 0 (50,000-block cap).
  // Factory and ChunkBatch were created in this block. Anvil starts at 0.
  var LOG_START = { sepolia: 12190877 };
  var LOG_WINDOW = 40000n;

  function utf8(s) {
    return new TextEncoder().encode(s);
  }

  function sel(name) {
    var sig = SIG[name];
    var want = WANT[name];
    var got;
    if (!sig || !want || !K) throw new Error("selector");
    got = "0x" + K.hex(K.keccak256(utf8(sig))).slice(0, 8);
    if (got !== want) throw new Error("selector");
    return got;
  }

  function ready() {
    var name;
    for (name in WANT) sel(name);
    return true;
  }

  function hexToBytes(hex) {
    var h = String(hex || "").replace(/^0x/i, "");
    var out, i;
    if (h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) return null;
    out = new Uint8Array(h.length / 2);
    for (i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function pad256(n) {
    var h = BigInt(n).toString(16);
    if (h.length > 64) throw new Error("word");
    return h.padStart(64, "0");
  }

  function wordHex(hex) {
    var h = String(hex || "").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]+$/.test(h) || h.length > 64) return null;
    return h.padStart(64, "0");
  }

  function u256(hex) {
    var w = wordHex(hex);
    if (!w) throw new Error("word");
    return BigInt("0x" + w);
  }

  function flag(hex) {
    return u256(hex) !== 0n;
  }

  function toChecksum(addr) {
    var hex = String(addr || "").toLowerCase().replace(/^0x/, "");
    var hash, out, i;
    if (!/^[0-9a-f]{40}$/.test(hex)) return null;
    hash = K.hex(K.keccak256(utf8(hex)));
    out = "0x";
    for (i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
    return out;
  }

  // The connected address is shown with a break in the middle. A paste of an
  // older copy can still carry a zero-width space. Spaces and format
  // characters are not part of the address.
  function cleanAddressText(s) {
    return String(s || "").replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB\s]/g, "");
  }

  function parseAddr(s) {
    var t = cleanAddressText(s);
    var body, sum;
    if (!/^0x[0-9a-fA-F]{40}$/.test(t)) return null;
    body = t.slice(2);
    sum = toChecksum(t);
    if (!sum) return null;
    if (body !== body.toLowerCase() && body !== body.toUpperCase() && t !== sum) return null;
    return sum;
  }

  function padAddr(addr) {
    var sum = parseAddr(addr);
    if (!sum) throw new Error("address");
    return wordHex(sum);
  }

  function addrOf(hex) {
    var w = wordHex(hex);
    var a;
    if (!w) return null;
    a = "0x" + w.slice(24);
    if (/^0x0{40}$/.test(a)) return null;
    return toChecksum(a);
  }

  function plain(s, min, max) {
    var i, c;
    if (typeof s !== "string" || s.length < min || s.length > max) return null;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) return null;
      if (c === 34 || c === 92 || c === 60 || c === 62 || c === 38) return null;
    }
    return s;
  }

  function bpsOf(text) {
    var s = String(text == null ? "" : text).trim();
    var parts, whole, frac, bps;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
    parts = s.split(".");
    whole = Number(parts[0]);
    frac = parts[1] || "";
    if (frac.length === 1) frac += "0";
    if (!frac) frac = "00";
    bps = whole * 100 + Number(frac);
    if (bps > 10000) return null;
    return bps;
  }

  function ethToWei(text) {
    var s = String(text == null ? "" : text).trim();
    var parts, frac, wei;
    if (!/^\d{1,7}(\.\d{1,18})?$/.test(s)) return null;
    parts = s.split(".");
    frac = parts[1] || "";
    while (frac.length < 18) frac += "0";
    wei = BigInt(parts[0]) * (10n ** 18n) + BigInt(frac);
    if (wei <= 0n) return null;
    return wei;
  }

  function weiToEth(wei) {
    var n = BigInt(wei);
    var whole = n / (10n ** 18n);
    var frac = (n % (10n ** 18n)).toString().padStart(18, "0").replace(/0+$/, "");
    if (!frac) return whole.toString();
    return whole.toString() + "." + frac;
  }

  function hexQty(n) {
    return "0x" + BigInt(n).toString(16);
  }

  function sameAddr(a, b) {
    var left = parseAddr(a);
    var right = parseAddr(b);
    return !!left && left === right;
  }

  function chainOf() {
    try {
      var q = new URLSearchParams(root.location.search).get("chain");
      if (q === "mainnet" || q === "sepolia" || q === "anvil") return q;
    } catch (e) {}
    if (FACTORIES.mainnet) return "mainnet";
    return "sepolia";
  }

  function factoryOf(chain) {
    var host, raw;
    if (chain === "mainnet" || chain === "sepolia") return FACTORIES[chain];
    if (chain !== "anvil") return "";
    try {
      host = root.location.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") return "";
      raw = new URLSearchParams(root.location.search).get("factory") || "";
    } catch (e) {
      return "";
    }
    return parseAddr(raw) || "";
  }

  function batchOf(chain) {
    var host, raw, fallback;
    fallback = BATCHES[chain] || "";
    if (chain !== "anvil") return parseAddr(fallback) || "";
    try {
      host = root.location.hostname;
      if (host !== "localhost" && host !== "127.0.0.1") return "";
      raw = new URLSearchParams(root.location.search).get("batch") || "";
    } catch (e) {
      return parseAddr(fallback) || "";
    }
    return parseAddr(raw) || parseAddr(fallback) || "";
  }

  function pieceMakerOf(chain, chunk) {
    var helper = batchOf(chain);
    if (!helper || !chunk) return Promise.resolve(null);
    return agree(chain, helper, sel("maker") + padAddr(chunk)).then(function (hex) {
      return addrOf(hex) || "";
    }).catch(function () { return ""; });
  }

  function endpoints(chain) {
    return CHAINS[chain] || [];
  }

  function need(chain) {
    return chain === "anvil" ? 1 : 2;
  }

  function rpc(url, method, params, ms) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      signal: AbortSignal.timeout(ms || READ_MS)
    }).then(function (res) {
      if (!res.ok) throw new Error("http");
      return res.json();
    }).then(function (msg) {
      if (!msg || msg.error || msg.result === undefined) throw new Error("result");
      return msg.result;
    });
  }

  function ethCall(url, to, data) {
    return rpc(url, "eth_call", [{ to: to, data: data }, "latest"]).then(function (result) {
      if (typeof result !== "string" || result.length < 66) throw new Error("result");
      return result;
    });
  }

  function agree(chain, to, data) {
    var urls = endpoints(chain);
    var min = need(chain);
    var seen = [];
    function step(i) {
      if (i >= urls.length) {
        var j;
        for (j = 0; j < seen.length; j++) if (seen[j].n >= min) return Promise.resolve(seen[j].hex);
        return Promise.reject(new Error("weather"));
      }
      return ethCall(urls[i], to, data).then(function (hex) {
        var key = hex.toLowerCase();
        var j;
        for (j = 0; j < seen.length; j++) {
          if (seen[j].hex === key) {
            seen[j].n += 1;
            if (seen[j].n >= min) return seen[j].hex;
            return step(i + 1);
          }
        }
        seen.push({ hex: key, n: 1 });
        if (min <= 1) return key;
        return step(i + 1);
      }).catch(function (err) {
        if (err && err.message === "weather") throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function decodeBytes(hex) {
    var h = String(hex || "").toLowerCase().replace(/^0x/, "");
    var offset, pos, len, start, out, i;
    if (h.length < 128 || h.length % 2 || !/^[0-9a-f]+$/.test(h)) return null;
    offset = parseInt(h.slice(0, 64), 16);
    if (!Number.isFinite(offset)) return null;
    pos = offset * 2;
    if (pos + 64 > h.length) return null;
    len = parseInt(h.slice(pos, pos + 64), 16);
    if (!Number.isFinite(len) || len < 0 || len > 200000) return null;
    start = pos + 64;
    if (start + len * 2 > h.length) return null;
    out = new Uint8Array(len);
    for (i = 0; i < len; i++) out[i] = parseInt(h.slice(start + i * 2, start + i * 2 + 2), 16);
    return out;
  }

  function decodeString(hex) {
    var bytes = decodeBytes(hex);
    var s = "";
    var i;
    if (!bytes) return null;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function payloadOfCode(hex) {
    var bytes = hexToBytes(hex);
    if (!bytes || bytes.length < 2 || bytes[0] !== 0) return null;
    return bytes.subarray(1);
  }

  function contentHash(bytes) {
    return "0x" + K.hex(K.keccak256(bytes));
  }

  function u16be(bytes, i) {
    return (bytes[i] << 8) | bytes[i + 1];
  }

  function u32be(bytes, i) {
    return bytes[i] * 0x1000000 + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
  }

  function photoKind(bytes) {
    if (!bytes || bytes.length < 12) return "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
    return "";
  }

  function jpegBounds(bytes) {
    var i = 2;
    var marker, len, w, h;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      while (i < bytes.length && bytes[i] === 0xff) i += 1;
      if (i >= bytes.length) return null;
      marker = bytes[i];
      i += 1;
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 1 >= bytes.length) return null;
      len = u16be(bytes, i);
      if (len < 2 || i + len > bytes.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (len < 7) return null;
        h = u16be(bytes, i + 3);
        w = u16be(bytes, i + 5);
        if (!w || !h) return null;
        return { width: w, height: h };
      }
      i += len;
    }
    return null;
  }

  function pngBounds(bytes) {
    var w, h;
    if (!bytes || bytes.length < 24) return null;
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
    w = u32be(bytes, 16);
    h = u32be(bytes, 20);
    if (!w || !h) return null;
    return { width: w, height: h };
  }

  function webpBounds(bytes) {
    var tag, w, h, bits, o;
    if (!bytes || bytes.length < 21) return null;
    tag = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (tag === "VP8X") {
      if (bytes.length < 30) return null;
      w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    } else if (tag === "VP8 ") {
      o = 20;
      if (bytes.length < o + 10) return null;
      if (bytes[o + 3] !== 0x9d || bytes[o + 4] !== 0x01 || bytes[o + 5] !== 0x2a) return null;
      w = (bytes[o + 6] | (bytes[o + 7] << 8)) & 0x3fff;
      h = (bytes[o + 8] | (bytes[o + 9] << 8)) & 0x3fff;
    } else if (tag === "VP8L") {
      o = 20;
      if (bytes.length < o + 5 || bytes[o] !== 0x2f) return null;
      bits = (bytes[o + 1] | (bytes[o + 2] << 8) | (bytes[o + 3] << 16) | (bytes[o + 4] << 24)) >>> 0;
      w = (bits & 0x3fff) + 1;
      h = ((bits >>> 14) & 0x3fff) + 1;
    } else {
      return null;
    }
    if (!w || !h) return null;
    return { width: w, height: h };
  }

  function photoBounds(bytes, kind) {
    if (kind === "jpeg") return jpegBounds(bytes);
    if (kind === "png") return pngBounds(bytes);
    if (kind === "webp") return webpBounds(bytes);
    return null;
  }

  // A sample of the file. Almost-constant bytes score near zero. A photograph scores near eight.
  function payloadEntropy(bytes) {
    var sample, n, i, counts, c, p, h, mid;
    if (!bytes || !bytes.length) return 0;
    if (bytes.length <= 65536) {
      sample = bytes;
    } else {
      sample = new Uint8Array(49152);
      sample.set(bytes.subarray(0, 16384), 0);
      mid = (bytes.length >> 1) - 8192;
      if (mid < 0) mid = 0;
      sample.set(bytes.subarray(mid, mid + 16384), 16384);
      sample.set(bytes.subarray(bytes.length - 16384), 32768);
    }
    n = sample.length;
    counts = new Uint32Array(256);
    for (i = 0; i < n; i++) counts[sample[i]] += 1;
    h = 0;
    for (i = 0; i < 256; i++) {
      c = counts[i];
      if (!c) continue;
      p = c / n;
      h -= p * Math.log2(p);
    }
    return h;
  }

  function overPixels(bounds) {
    return bounds.width > 12000 || bounds.height > 12000 || bounds.width * bounds.height > 100000000;
  }

  // Empty string means the bytes may be prepared. Any other word is a refusal.
  function photoGate(bytes, cap) {
    var kind = photoKind(bytes);
    var bounds, pieces, limit;
    limit = Number(cap || CONTRACT_CHUNKS);
    if (!limit || limit > CONTRACT_CHUNKS) limit = CONTRACT_CHUNKS;
    if (!kind) return "format";
    bounds = photoBounds(bytes, kind);
    if (bounds && overPixels(bounds)) return "dimensions";
    if (payloadEntropy(bytes) < ENTROPY_MIN) return "empty";
    if (!bounds) return "read";
    if (bytes.length > CHUNK * limit) return "size";
    pieces = Math.ceil(bytes.length / CHUNK);
    if (pieces > limit) return "pieces";
    return "";
  }

  function ethUp(wei, places) {
    var scale, units, base, whole, frac;
    wei = BigInt(wei);
    if (wei <= 0n) return "0";
    scale = 10n ** BigInt(18 - places);
    units = (wei + scale - 1n) / scale;
    base = 10n ** BigInt(places);
    whole = units / base;
    frac = (units % base).toString().padStart(places, "0").replace(/0+$/, "");
    if (!frac) return whole.toString();
    return whole.toString() + "." + frac;
  }

  function gasPerChunk(chain) {
    return chain === "sepolia" ? GAS_PER_CHUNK_SEPOLIA : GAS_PER_CHUNK;
  }

  function storeQuote(count, weiPerGas, chain) {
    var cost, keep, places;
    count = BigInt(count);
    weiPerGas = BigInt(weiPerGas);
    if (count <= 0n || weiPerGas <= 0n) throw new Error("gasprice");
    cost = count * gasPerChunk(chain) * weiPerGas;
    keep = cost * 2n;
    // Amounts below 0.000001 ETH use 12 decimal places.
    places = cost > 0n && cost < 10n ** 12n ? 12 : 6;
    return { about: ethUp(cost, places), keep: ethUp(keep, places) };
  }

  // The higher of the node's suggested price and the latest base fee.
  // A suggested price under the base fee cannot pay for the transaction.
  function quotedGasPrice(url) {
    return rpc(url, "eth_gasPrice", []).then(function (hex) {
      var price = u256(hex);
      if (price <= 0n) throw new Error("gasprice");
      return rpc(url, "eth_getBlockByNumber", ["latest", false]).then(function (block) {
        var base = block && block.baseFeePerGas != null ? u256(block.baseFeePerGas) : 0n;
        return base > price ? base : price;
      }).catch(function () {
        return price;
      });
    });
  }

  function mainnetGasPrice() {
    return chainGasPrice("mainnet");
  }

  function chainGasPrice(chain) {
    var urls = endpoints(chain);
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("gasprice"));
      return quotedGasPrice(urls[i]).catch(function (err) {
        if (err && err.message === "gasprice" && i + 1 >= urls.length) throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function splitChunks(bytes, cap) {
    var out = [];
    var off = 0;
    var end;
    var limit = Number(cap || CONTRACT_CHUNKS);
    if (!limit || limit > CONTRACT_CHUNKS) limit = CONTRACT_CHUNKS;
    if (!bytes || !bytes.length || bytes.length > CHUNK * limit) throw new Error("size");
    while (off < bytes.length) {
      end = off + CHUNK;
      if (end > bytes.length) end = bytes.length;
      out.push(new Uint8Array(bytes.subarray(off, end)));
      off = end;
    }
    return out;
  }

  function padBytes(bytes) {
    var hex = K.hex(bytes);
    var pad = (32 - (bytes.length % 32)) % 32;
    var i;
    for (i = 0; i < pad; i++) hex += "00";
    return pad256(bytes.length) + hex;
  }

  function abiEncodeBytes(bytes) {
    return pad256(32) + padBytes(bytes);
  }

  function bytecode() {
    var bc = String(root.OnPlateBytecode || "").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]+$/.test(bc) || bc.length < 64 || bc.length % 2) throw new Error("bytecode");
    return "0x" + bc;
  }

  function creationData(payload) {
    var bc = bytecode();
    var data = bc + abiEncodeBytes(payload);
    if (data.indexOf(bc) !== 0) throw new Error("bytecode");
    return data;
  }

  function encodeAddPhoto(name, description, artistName, hashHex, book, thumb, devBps, artistBps, artist) {
    var nameEnc = padBytes(utf8(name));
    var descEnc = padBytes(utf8(description));
    var artistEnc = padBytes(utf8(artistName || ""));
    var thumbEnc = padBytes(thumb);
    var hash = String(hashHex || "").toLowerCase().replace(/^0x/, "");
    var stored = parseAddr(book);
    var oName, oDesc, oArtist, oThumb, head;
    if (!/^[0-9a-f]{64}$/.test(hash) || hash === "0".repeat(64)) throw new Error("hash");
    if (!stored) throw new Error("book");
    oName = 9 * 32;
    oDesc = oName + nameEnc.length / 2;
    oArtist = oDesc + descEnc.length / 2;
    oThumb = oArtist + artistEnc.length / 2;
    head = pad256(oName) + pad256(oDesc) + pad256(oArtist) + hash + padAddr(stored) + pad256(oThumb)
      + pad256(devBps) + pad256(artistBps) + padAddr(artist);
    return sel("addPhoto") + head + nameEnc + descEnc + artistEnc + thumbEnc;
  }

  // ABI of name, description, artist name, and thumbnail. The factory reads one field at a time.
  function encodePlateText(name, description, artistName, thumb) {
    var nameEnc = padBytes(utf8(name));
    var descEnc = padBytes(utf8(description));
    var artistEnc = padBytes(utf8(artistName || ""));
    var thumbEnc = padBytes(thumb);
    var oName = 4 * 32;
    var oDesc = oName + nameEnc.length / 2;
    var oArtist = oDesc + descEnc.length / 2;
    var oThumb = oArtist + artistEnc.length / 2;
    return pad256(oName) + pad256(oDesc) + pad256(oArtist) + pad256(oThumb)
      + nameEnc + descEnc + artistEnc + thumbEnc;
  }

  function encodeAddrArray(chunks) {
    var body = "";
    var i, chunk;
    if (!chunks || !chunks.length) throw new Error("chunks");
    body = pad256(chunks.length);
    for (i = 0; i < chunks.length; i++) {
      chunk = parseAddr(chunks[i]);
      if (!chunk) throw new Error("chunks");
      body += padAddr(chunk);
    }
    return body;
  }

  // One call that opens, links, seals, and registers. A stranger still stops at OPEN_MAX
  // on the factory. A nominated signer may pass up to CONTRACT_CHUNKS addresses.
  // Pass home when the signer is not the title wallet. The zero address is refused.
  function encodeLinkPhoto(name, description, artistName, hashHex, chunks, thumb, devBps, artistBps, artist, home) {
    var hash = String(hashHex || "").toLowerCase().replace(/^0x/, "");
    var chunkBody, inner, innerBytes, textEnc, chunksOff, textOff, head, homeAddr;
    if (!/^[0-9a-f]{64}$/.test(hash) || hash === "0".repeat(64)) throw new Error("hash");
    if (!chunks || !chunks.length || chunks.length > CONTRACT_CHUNKS) throw new Error("chunks");
    homeAddr = home ? parseAddr(home) : null;
    if (home && !homeAddr) throw new Error("home");
    chunkBody = encodeAddrArray(chunks);
    inner = encodePlateText(name, description, artistName, thumb);
    innerBytes = hexToBytes(inner);
    if (!innerBytes) throw new Error("text");
    textEnc = padBytes(innerBytes);
    chunksOff = (homeAddr ? 7 : 6) * 32;
    textOff = chunksOff + chunkBody.length / 2;
    head = hash + pad256(chunksOff) + pad256(devBps) + pad256(artistBps) + padAddr(artist) + pad256(textOff);
    if (homeAddr) head += padAddr(homeAddr);
    return sel(homeAddr ? "linkPhotoHome" : "linkPhoto") + head + chunkBody + textEnc;
  }

  function encodeOpenBook(count, home) {
    var n = Number(count);
    var homeAddr;
    if (!n || n > CONTRACT_CHUNKS) throw new Error("size");
    homeAddr = home ? parseAddr(home) : null;
    if (home && !homeAddr) throw new Error("home");
    if (homeAddr) return sel("openBookHome") + pad256(n) + padAddr(homeAddr);
    return sel("openBook") + pad256(n);
  }

  function encodeAddChunks(book, addresses) {
    var stored = parseAddr(book);
    var body = "";
    var i;
    if (!stored || !addresses || !addresses.length || addresses.length > 80) throw new Error("chunks");
    body = pad256(addresses.length);
    for (i = 0; i < addresses.length; i++) body += padAddr(addresses[i]);
    return sel("addChunks") + padAddr(stored) + pad256(64) + body;
  }

  function encodeSealBook(book) {
    var stored = parseAddr(book);
    if (!stored) throw new Error("book");
    return sel("sealBook") + padAddr(stored);
  }

  function chunksAt(url, plate) {
    return ethCall(url, plate, sel("chunkCount")).then(function (hex) {
      var n = Number(u256(hex));
      var parts = [];
      var next = 0;
      var width, w, jobs;
      if (!n || n > CONTRACT_CHUNKS) throw new Error("chunks");
      // A few pieces at a time. The caller still checks the content hash.
      function one() {
        var i = next;
        if (i >= n) return Promise.resolve();
        next += 1;
        return ethCall(url, plate, sel("chunkAt") + pad256(i)).then(function (word) {
          var a = addrOf(word);
          if (!a) throw new Error("chunk");
          return rpc(url, "eth_getCode", [a, "latest"]);
        }).then(function (code) {
          var raw = payloadOfCode(code);
          if (!raw || !raw.length || raw.length > CHUNK) throw new Error("chunk");
          parts[i] = new Uint8Array(raw);
          return one();
        });
      }
      width = n < 6 ? n : 6;
      jobs = [];
      for (w = 0; w < width; w++) jobs.push(one());
      return Promise.all(jobs).then(function () {
        var len = 0;
        var j, out, off;
        for (j = 0; j < n; j++) {
          if (!parts[j]) throw new Error("chunk");
          len += parts[j].length;
        }
        out = new Uint8Array(len);
        off = 0;
        for (j = 0; j < n; j++) {
          out.set(parts[j], off);
          off += parts[j].length;
        }
        return out;
      });
    });
  }

  function reassemble(chain, plate, expectHash) {
    var urls = endpoints(chain);
    var want = String(expectHash || "").toLowerCase();
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("hash"));
      return chunksAt(urls[i], plate).then(function (bytes) {
        if (contentHash(bytes) !== want) throw new Error("mismatch");
        return bytes;
      }).catch(function (err) {
        if (err && err.message === "hash") throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function readFields(chain, plate) {
    var list = [
      ["name", sel("name")],
      ["description", sel("description")],
      ["artistName", sel("artistName")],
      ["nominationAllowed", sel("nominationAllowed")],
      ["contentHash", sel("contentHash")],
      ["devBps", sel("devBps")],
      ["artistBps", sel("artistBps")],
      ["devRecipient", sel("devRecipient")],
      ["artistRecipient", sel("artistRecipient")],
      ["title", sel("title")],
      ["mailbox", sel("mailbox")],
      ["parked", sel("parked")],
      ["listedPrice", sel("listedPrice")],
      ["allowedBuyer", sel("allowedBuyer")],
      ["ownerOf", sel("ownerOf") + pad256(1)],
      ["thumbnail", sel("thumbnail")],
      ["chunkCount", sel("chunkCount")],
      ["originalPrice", sel("originalPrice")],
      ["nominated", sel("nominated")],
      ["nominationRevoked", sel("nominationRevoked")],
      ["vaultedSince", sel("vaultedSince")],
      ["printed", sel("printed")],
      ["pieceExpect", sel("pieceExpect")]
    ];
    var urls = endpoints(chain);
    var min = need(chain);
    var got = [];
    function take(url) {
      // These fields do not depend on each other. One wave is enough.
      return Promise.all(list.map(function (pair) {
        return ethCall(url, plate, pair[1]).then(function (hex) {
          return [pair[0], String(hex).toLowerCase()];
        });
      })).then(function (rows) {
        var out = {};
        var i;
        for (i = 0; i < rows.length; i++) out[rows[i][0]] = rows[i][1];
        return out;
      });
    }
    function same(a, b) {
      var key;
      for (key in a) if (a[key] !== b[key]) return false;
      for (key in b) if (a[key] !== b[key]) return false;
      return true;
    }
    function step(i) {
      if (i >= urls.length) {
        var j;
        for (j = 0; j < got.length; j++) if (got[j].n >= min) return Promise.resolve(got[j].fields);
        return Promise.reject(new Error("weather"));
      }
      return take(urls[i]).then(function (fields) {
        var j;
        for (j = 0; j < got.length; j++) {
          if (same(fields, got[j].fields)) {
            got[j].n += 1;
            if (got[j].n >= min) return got[j].fields;
            return step(i + 1);
          }
        }
        got.push({ fields: fields, n: 1 });
        if (min <= 1) return fields;
        return step(i + 1);
      }).catch(function (err) {
        if (err && err.message === "weather") throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function parsePlate(fields) {
    var name = plain(decodeString(fields.name), 1, 48);
    var description = plain(decodeString(fields.description), 0, 240);
    var artistName = plain(decodeString(fields.artistName) || "", 0, 48);
    var hash = "0x" + wordHex(fields.contentHash);
    var thumb = decodeBytes(fields.thumbnail);
    return {
      name: name,
      description: description,
      artistName: artistName || "",
      nominationAllowed: flag(fields.nominationAllowed),
      hash: hash,
      devBps: u256(fields.devBps),
      artistBps: u256(fields.artistBps),
      devRecipient: addrOf(fields.devRecipient),
      artistRecipient: addrOf(fields.artistRecipient),
      title: addrOf(fields.title),
      mailbox: addrOf(fields.mailbox),
      parked: flag(fields.parked),
      price: u256(fields.listedPrice),
      buyer: addrOf(fields.allowedBuyer),
      holder: addrOf(fields.ownerOf),
      thumbnail: thumb,
      chunkCount: u256(fields.chunkCount),
      originalPrice: u256(fields.originalPrice),
      nominated: flag(fields.nominated),
      revoked: flag(fields.nominationRevoked),
      vaultedSince: u256(fields.vaultedSince),
      printed: flag(fields.printed),
      pieceExpect: u256(fields.pieceExpect)
    };
  }

  function pinPlate(chain, factory, plate) {
    var pinned = parseAddr(plate);
    var factorySum = parseAddr(factory);
    if (!pinned || !factorySum) return Promise.reject(new Error("plate"));
    return agree(chain, pinned, sel("plateId")).then(function (hex) {
      var id = u256(hex);
      if (id === 0n) throw new Error("plate");
      return agree(chain, factorySum, sel("photoAt") + pad256(id));
    }).then(function (hex) {
      if (!sameAddr(addrOf(hex), pinned)) throw new Error("plate");
      return agree(chain, factorySum, sel("isPhoto") + padAddr(pinned));
    }).then(function (hex) {
      if (!flag(hex)) throw new Error("plate");
      return pinned;
    });
  }

  function listedPair(chain, plate) {
    return agree(chain, plate, sel("listedPrice")).then(u256);
  }

  function canAdd(chain, factory, account) {
    return agree(chain, factory, sel("canAdd") + padAddr(account)).then(flag);
  }

  function claimOf(chain, plate, account) {
    return agree(chain, plate, sel("claimable") + padAddr(account)).then(u256);
  }

  function codeMatches(chain, address, payload) {
    var urls = endpoints(chain);
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("code"));
      return rpc(urls[i], "eth_getCode", [address, "latest"], 20000).then(function (code) {
        var raw = payloadOfCode(code);
        var j;
        if (!raw || raw.length !== payload.length) throw new Error("mismatch");
        for (j = 0; j < payload.length; j++) if (raw[j] !== payload[j]) throw new Error("mismatch");
        return parseAddr(address);
      }).catch(function (err) {
        if (err && err.message === "code") throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  // Empty code is a successful RPC result. Right after a create, a public node
  // can still return 0x. Skip that node so a later URL can supply the bytes.
  function liveCode(chain, address) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getCode", [address, "latest"], 20000).then(function (code) {
        var bytes = hexToBytes(code);
        if (!bytes || bytes.length < 2 || bytes[0] !== 0) throw new Error("empty");
        return code;
      });
    });
  }

  function waitPieceCode(chain, address, payload) {
    var start = Date.now();
    function step() {
      return codeMatches(chain, address, payload).catch(function (err) {
        if (Date.now() - start > 20000) {
          return Promise.reject(err && err.message === "code" ? err : new Error("mismatch"));
        }
        return wait(800).then(step);
      });
    }
    return step();
  }

  function firstOk(chain, fn) {
    var urls = endpoints(chain);
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("weather"));
      return fn(urls[i]).catch(function () { return step(i + 1); });
    }
    return step(0);
  }

  // Older factories do not have linkPhoto. Their code does not contain its selector.
  function factoryLinksInOne(chain, factory) {
    var marker = String(WANT.linkPhoto || "").toLowerCase().replace(/^0x/, "");
    if (!parseAddr(factory) || marker.length !== 8) return Promise.resolve(false);
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getCode", [factory, "latest"]);
    }).then(function (code) {
      return String(code || "").toLowerCase().indexOf(marker) !== -1;
    }).catch(function () { return false; });
  }

  function wait(ms) {
    return new Promise(function (ok) { setTimeout(ok, ms); });
  }

  function txExists(chain, hash) {
    if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(String(hash))) return Promise.resolve(false);
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getTransactionByHash", [hash]).then(function (tx) {
        if (tx) return true;
        return rpc(url, "eth_getTransactionReceipt", [hash]).then(function (rec) {
          return !!rec;
        });
      });
    }).catch(function () { return false; });
  }

  function waitReceipt(chain, hash) {
    var start = Date.now();
    function step() {
      if (Date.now() - start > 120000) return Promise.reject(new Error("receipt"));
      return firstOk(chain, function (url) {
        return rpc(url, "eth_getTransactionReceipt", [hash]).then(function (rec) {
          if (!rec) return null;
          if (typeof rec !== "object") throw new Error("receipt");
          return rec;
        });
      }).then(function (rec) {
        if (!rec) return wait(800).then(step);
        if (rec.status !== "0x1") throw new Error("revert");
        return rec;
      });
    }
    return step();
  }

  function isOff() {
    try { return root.localStorage.getItem(OFF) === "1"; }
    catch (e) { return false; }
  }

  function setOff(value) {
    try {
      if (value) root.localStorage.setItem(OFF, "1");
      else root.localStorage.removeItem(OFF);
    } catch (e) {}
  }

  function sameChain(id, chain) {
    try { return BigInt(id) === BigInt(CHAIN_HEX[chain]); }
    catch (e) { return false; }
  }

  function ensureChain(eth, chain) {
    var want = CHAIN_HEX[chain];
    return eth.request({ method: "eth_chainId" }).then(function (id) {
      if (sameChain(id, chain)) return;
      return eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] }).catch(function () {
        if (chain !== "anvil") throw new Error("chain");
        return eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: want,
            chainName: "Anvil",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["http://127.0.0.1:8545"]
          }]
        });
      });
    }).then(function () {
      return eth.request({ method: "eth_chainId" });
    }).then(function (id) {
      if (!sameChain(id, chain)) throw new Error("chain");
    });
  }

  function loopbackUrl(chain) {
    var urls, i, parsed;
    if (chain !== "anvil") return "";
    urls = endpoints(chain);
    for (i = 0; urls && i < urls.length; i++) {
      try { parsed = new URL(urls[i]); }
      catch (e) { continue; }
      if (parsed.protocol !== "http:") continue;
      if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") continue;
      return urls[i];
    }
    return "";
  }

  function rpcMessage(url, method, params) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      signal: AbortSignal.timeout(READ_MS)
    }).then(function (res) {
      if (!res.ok) throw new Error("http");
      return res.json();
    }).then(function (msg) {
      var text;
      if (!msg) throw new Error("result");
      if (msg.error) {
        text = String(msg.error.message || "result");
        if (text.length > 180) text = text.slice(0, 180);
        throw new Error(text);
      }
      if (msg.result === undefined) throw new Error("result");
      return msg.result;
    });
  }

  // The local node can send as the connected account. The artist buttons do not
  // use this. It stays available for a local test that sets tx.local, and only
  // for piece creates and linking, on the loopback Anvil URL.
  function sendLocal(out) {
    var url = loopbackUrl("anvil");
    if (!url || !out || !parseAddr(out.from)) return Promise.reject(new Error("chain"));
    return rpcMessage(url, "anvil_impersonateAccount", [out.from]).then(function () {
      return rpcMessage(url, "eth_sendTransaction", [out]).then(function (hash) {
        return rpcMessage(url, "anvil_stopImpersonatingAccount", [out.from]).catch(function () {}).then(function () {
          if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("result");
          return hash;
        });
      }, function (err) {
        return rpcMessage(url, "anvil_stopImpersonatingAccount", [out.from]).catch(function () {}).then(function () {
          throw err;
        });
      });
    });
  }

  function localKind(kind) {
    return kind === "create" || kind === "openBook" || kind === "addChunks" || kind === "sealBook" || kind === "addPhoto" || kind === "linkPhoto";
  }

  function send(chain, tx) {
    var eth = root.ethereum;
    var data = tx && tx.data;
    var to = tx && tx.to ? tx.to : "";
    var value = "0x0";
    var kind = tx && tx.kind;
    var local = !!(tx && tx.local);
    if (isOff()) return Promise.reject(new Error("off"));
    if (!eth || !eth.request) return Promise.reject(new Error("wallet"));
    if (!CHAIN_HEX[chain]) return Promise.reject(new Error("chain"));
    if (local) {
      if (chain !== "anvil" || !loopbackUrl(chain)) return Promise.reject(new Error("chain"));
      if (!localKind(kind)) return Promise.reject(new Error("kind"));
    }
    if (kind === "create") {
      if (to) return Promise.reject(new Error("to"));
      if (!data || data.indexOf(bytecode()) !== 0) return Promise.reject(new Error("bytecode"));
    } else if (kind === "createPieces") {
      // The helper creates the pieces and returns any attached ETH. Value stays zero.
      // Gas is paid by the caller. This is not a local impersonation.
      if (local) return Promise.reject(new Error("kind"));
      if (!parseAddr(to) || !sameAddr(to, batchOf(chain))) return Promise.reject(new Error("to"));
      if (!data || data.slice(0, 10).toLowerCase() !== sel("createPieces")) return Promise.reject(new Error("selector"));
      if (data.length < 10 + 256) return Promise.reject(new Error("selector"));
    } else if (SEND[kind]) {
      var want = sel(kind);
      if (!parseAddr(to) || !data || data.slice(0, 10).toLowerCase() !== want) return Promise.reject(new Error("selector"));
      if (kind === "buy") {
        if (data !== want) return Promise.reject(new Error("selector"));
        if (typeof tx.price !== "bigint" || tx.price <= 0n) return Promise.reject(new Error("price"));
        value = hexQty(tx.price);
      } else if (kind === "list" || kind === "setMailbox" || kind === "setAllowedBuyer" || kind === "nominate" || kind === "openBook" || kind === "sealBook") {
        if (data.length !== 10 + 64) return Promise.reject(new Error("selector"));
      } else if (kind !== "addPhoto" && kind !== "addChunks" && kind !== "linkPhoto" && data.length !== 10) {
        return Promise.reject(new Error("selector"));
      }
      if (kind === "addPhoto" || kind === "linkPhoto" || kind === "openBook" || kind === "addChunks" || kind === "sealBook") {
        if (!tx.factory || !sameAddr(to, tx.factory)) return Promise.reject(new Error("to"));
        if (data.length < 10 + 64) return Promise.reject(new Error("selector"));
      }
      if (kind === "addChunks" && data.length < 10 + 192) return Promise.reject(new Error("selector"));
    } else {
      return Promise.reject(new Error("kind"));
    }
    function sendOnce(accounts) {
      var raw = pickFrom(accounts, tx.from);
      var out;
      var dest;
      var nonceHex;
      if (isOff()) throw new Error("off");
      if (!raw) throw new Error("account");
      out = { from: raw, data: data, value: value };
      if (to) {
        dest = parseAddr(to);
        if (!dest) throw new Error("to");
        out.to = dest;
      }
      if (kind === "create") {
        delete out.to;
        out.value = "0x0";
      }
      if (kind === "create" || kind === "createPieces") {
        if (tx.gas != null) {
          if (typeof tx.gas !== "string" || !/^0x[0-9a-fA-F]+$/.test(tx.gas)) throw new Error("gas");
          if (BigInt(tx.gas) < 21000n) throw new Error("gas");
          out.gas = tx.gas;
        }
      }
      // A later group has to use the next number. Leaving it off let the wallet
      // sign with a number that was already used. A zero nonce is left to the wallet
      // so a reset account can query the chain instead of being handed 0x0.
      if (tx.nonce != null) {
        nonceHex = typeof tx.nonce === "bigint" ? hexQty(tx.nonce) : String(tx.nonce);
        if (!/^0x[0-9a-fA-F]+$/.test(nonceHex)) throw new Error("nonce");
        if (BigInt(nonceHex) !== 0n) out.nonce = nonceHex;
      }
      if (typeof tx.onSend === "function") tx.onSend();
      if (local) return sendLocal(out);
      return eth.request({ method: "eth_sendTransaction", params: [out] });
    }
    return ensureChain(eth, chain).then(function () {
      if (isOff()) throw new Error("off");
      return requestAccounts(eth);
    }).then(sendOnce).catch(function (err) {
      if (local || !isUnauthorized(err)) throw err;
      if (isOff()) throw new Error("off");
      return requestSendGrant(eth).then(sendOnce);
    });
  }

  // Half of the maximum EIP-1559 step (one eighth). A full chunk moves the
  // fee by nearly one whole step, so the next contract waits instead of
  // joining that run of blocks. Within range means at or under this line.
  function feeSharp(fee, anchor) {
    return fee * 16n > anchor * 17n;
  }

  function chunkSet() {
    return { anchor: null, lastBlock: null, trace: [] };
  }

  function yieldPaint() {
    return new Promise(function (ok) {
      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(function () {
          root.requestAnimationFrame(function () { ok(); });
        });
      } else {
        setTimeout(ok, 0);
      }
    });
  }

  function headOf(chain) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_blockNumber", []).then(u256);
    });
  }

  function readBlock(chain, tag) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getBlockByNumber", [tag, false]).then(function (block) {
        if (!block || block.baseFeePerGas == null || block.gasLimit == null) throw new Error("fee");
        return block;
      });
    });
  }

  function readNextBaseFee(chain) {
    return readBlock(chain, "pending").then(function (block) {
      return u256(block.baseFeePerGas);
    }).catch(function () {
      return readBlock(chain, "latest").then(function (block) {
        var base = u256(block.baseFeePerGas);
        var used = u256(block.gasUsed);
        var target = u256(block.gasLimit) / 2n;
        var delta;
        if (used === target) return base;
        if (used > target) {
          delta = base * (used - target) / target / 8n;
          if (delta < 1n) delta = 1n;
          return base + delta;
        }
        delta = base * (target - used) / target / 8n;
        if (base <= delta) return 0n;
        return base - delta;
      });
    });
  }

  function advanceBlock(chain) {
    if (chain === "anvil") {
      return firstOk(chain, function (url) {
        return rpc(url, "anvil_mine", ["0x1"]);
      });
    }
    return headOf(chain).then(function (n) {
      var start = Date.now();
      function poll() {
        if (Date.now() - start > 20000) throw new Error("fee");
        return headOf(chain).then(function (m) {
          if (m > n) return m;
          return wait(1000).then(poll);
        });
      }
      return poll();
    });
  }

  function waitForFee(chain, set, onWait) {
    var spins = 0;
    function step() {
      return readNextBaseFee(chain).then(function (fee) {
        set.trace.push({ at: "read", fee: fee.toString() });
        if (set.anchor == null || !feeSharp(fee, set.anchor)) return fee;
        if (spins >= 40) throw new Error("fee");
        spins += 1;
        set.trace.push({ at: "wait", fee: fee.toString() });
        if (onWait) onWait(fee);
        return yieldPaint().then(function () {
          return advanceBlock(chain);
        }).then(step);
      });
    }
    return step();
  }

  function chunkGasLimit(chain, from, data) {
    return readBlock(chain, "latest").then(function (block) {
      var cap = u256(block.gasLimit);
      return postAny(chain, "eth_estimateGas", [{ from: from, data: data, value: "0x0" }]).then(function (hex) {
        var est = u256(hex);
        var gas = est + est / 64n;
        if (est < 21000n || est > cap) throw new Error("gas");
        if (gas > cap) gas = cap;
        return hexQty(gas);
      });
    });
  }

  function deployChunk(chain, set, tx, hooks) {
    var note = hooks || {};
    if (!set || !set.trace || !tx || !tx.from || !tx.data) return Promise.reject(new Error("chunk"));
    return waitForFee(chain, set, note.onWait).then(function () {
      return chunkGasLimit(chain, tx.from, tx.data);
    }).then(function (gas) {
      set.trace.push({ at: "send", gas: gas });
      return send(chain, {
        kind: "create",
        data: tx.data,
        from: tx.from,
        gas: gas,
        onSend: note.onSend
      }).then(function (hash) {
        return waitReceipt(chain, hash).then(function (rec) {
          return readBlock(chain, rec.blockNumber).then(function (block) {
            var included = u256(block.baseFeePerGas);
            var number = u256(block.number);
            if (set.anchor == null) set.anchor = included;
            set.lastBlock = number;
            rec.baseFee = included;
            rec.chunkGas = gas;
            set.trace.push({
              at: "landed",
              block: number.toString(),
              baseFee: included.toString(),
              gasUsed: u256(rec.gasUsed).toString(),
              gas: gas
            });
            return rec;
          });
        });
      });
    });
  }

  function bytesOf(value) {
    if (!value) return new Uint8Array();
    if (value instanceof Uint8Array) return value;
    if (typeof value === "string") return hexToBytes(value) || new Uint8Array();
    return new Uint8Array(value);
  }

  function rlpItem(bytes) {
    var out;
    if (bytes.length === 1 && bytes[0] < 0x80) return new Uint8Array(bytes);
    if (bytes.length >= 56) throw new Error("rlp");
    out = new Uint8Array(1 + bytes.length);
    out[0] = 0x80 + bytes.length;
    out.set(bytes, 1);
    return out;
  }

  function rlpNonce(nonce) {
    var n = BigInt(nonce);
    var hex, bytes;
    if (n < 0n) throw new Error("nonce");
    if (n === 0n) return new Uint8Array([0x80]);
    hex = n.toString(16);
    if (hex.length % 2) hex = "0" + hex;
    bytes = hexToBytes(hex);
    if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
    return rlpItem(bytes);
  }

  function rlpList(encoded) {
    var len = 0;
    var i, out, at;
    for (i = 0; i < encoded.length; i++) len += encoded[i].length;
    if (len >= 56) throw new Error("rlp");
    out = new Uint8Array(1 + len);
    out[0] = 0xc0 + len;
    at = 1;
    for (i = 0; i < encoded.length; i++) {
      out.set(encoded[i], at);
      at += encoded[i].length;
    }
    return out;
  }

  function createAddress(from, nonce) {
    var addr = hexToBytes(from);
    var encoded, hash;
    if (!addr || addr.length !== 20) throw new Error("address");
    encoded = rlpList([rlpItem(addr), rlpNonce(nonce)]);
    hash = K.hex(K.keccak256(encoded));
    return toChecksum("0x" + hash.slice(24));
  }

  function errDetail(err) {
    var parts = [];
    function take(value) {
      var text;
      if (value == null) return;
      if (typeof value === "string") text = value;
      else if (typeof value === "object") {
        text = value.message || (value.data && value.data.message) || "";
        if (!text && value.code != null) text = String(value.code);
      } else text = String(value);
      text = String(text || "").replace(/\s+/g, " ").trim();
      if (!text || text === "[object Object]") return;
      if (parts.indexOf(text) >= 0) return;
      parts.push(text);
    }
    take(err && err.message);
    take(err && err.data);
    take(err && err.data && err.data.originalError);
    take(err && err.reason);
    return parts.join(" — ").slice(0, 180);
  }

  function isUnauthorized(err) {
    var code = err && (err.code || (err.data && err.data.code));
    if (code === 4100 || code === "4100") return true;
    return /not been authorized/i.test(errDetail(err));
  }

  function requestAccounts(eth) {
    return eth.request({ method: "eth_requestAccounts" });
  }

  // A silent eth_accounts / eth_requestAccounts can still leave send refused (4100).
  // This opens the wallet permission sheet. A page load must not call it.
  function requestSendGrant(eth) {
    return eth.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }]
    }).then(function () {
      return requestAccounts(eth);
    }, function (err) {
      if (err && (err.code === 4001 || err.code === "4001")) throw err;
      if (/user rejected|rejected the request|denied|cancel/i.test(errDetail(err))) throw err;
      return requestAccounts(eth);
    });
  }

  function pickFrom(accounts, want) {
    var i, raw;
    for (i = 0; accounts && i < accounts.length; i++) {
      raw = accounts[i];
      if (raw && sameAddr(raw, want)) return raw;
    }
    return "";
  }

  function reasonText(err, kind) {
    var message = String(err && err.message || "");
    var detail = errDetail(err);
    if (message === "cancel") return "";
    if (message === "off") return "Disconnected.";
    if (message === "wallet") return "Connect a wallet that can send on this chain.";
    if (message === "account") return "Connect the account that prepared this photograph, then store again.";
    if (message === "chain") return "The wallet is not on this chain.";
    if (isUnauthorized(err) || /not been authorized|\b4100\b/i.test(detail)) {
      return "The address on the page is visible, but the wallet has not approved sending from it. Click Connect, approve that account, then store again.";
    }
    if (/insufficient funds/i.test(detail)) return "This account does not have enough ETH for gas on this chain.";
    if (message === "batch") return "This chain has no batch contract yet.";
    if (message === "fit") return "This piece does not fit in one block through the batch contract.";
    if (/user rejected|rejected the request|denied|cancel/i.test(detail)) return "The wallet did not send this contract.";
    if (message === "revert") return "The contract creation reverted.";
    if (/nonce too high|invalid nonce|correct nonce/i.test(detail)) {
      return "This chain was restarted. In the wallet, reset the account for this network, then store again.";
    }
    if (message === "nonce") return "Another transaction is still pending.";
    if (/nonce too low|already known|already used/i.test(detail)) {
      return "The wallet reused a transaction number that was already used. These pieces were not sent.";
    }
    if (message === "fee") return "The base fee did not fall back in range.";
    if (message === "gas") return "The gas limit could not be set.";
    if (/exceeds block gas limit|intrinsic gas|gas required exceeds|tx gas cap|transaction gas limit/i.test(detail)) {
      return "The wallet asked for more gas than this chain allows for one transaction.";
    }
    if (/max fee per gas less than|underpriced|replacement transaction/i.test(detail)) {
      return "The wallet fee was too low for this chain. Store again.";
    }
    if (message === "code" || message === "mismatch") return "The deployed code did not match this piece.";
    if (message === "weather") return "The chain did not answer.";
    if (message === "receipt") return "The chain did not include this contract.";
    if (message === "chunks") return "Every piece has to be on-chain before the photograph is registered.";
    if (message === "book") return "The chunk list did not match this photograph.";
    if (message === "limit") return "This factory cannot link that many pieces in one transaction.";
    if (detail && !/^(kind|to|selector|bytecode|http|result|idb)$/i.test(message)) {
      return (kind === "register" ? "The photograph was not registered. " : "The contract was not stored. ") + detail;
    }
    return kind === "register" ? "The photograph was not registered." : "The contract was not stored.";
  }

  function usePlanStore(store) {
    planStore = store || null;
  }

  function planTx(mode, run) {
    return db().then(function (base) {
      return new Promise(function (ok, bad) {
        var tx = base.transaction("plans", mode);
        var result;
        var settled = false;
        function finish(err) {
          if (settled) return;
          settled = true;
          if (err) bad(err);
          else ok(result);
        }
        tx.oncomplete = function () { finish(); };
        tx.onerror = function () { finish(tx.error || new Error("idb")); };
        tx.onabort = function () { finish(tx.error || new Error("idb")); };
        try { run(tx.objectStore("plans"), function (value) { result = value; }); }
        catch (err) { finish(err); }
      });
    });
  }

  function planGet(hash) {
    var key = String(hash || "").toLowerCase();
    if (planStore) return Promise.resolve(planStore.get(key));
    return planTx("readonly", function (store, set) {
      var q = store.get(key);
      q.onsuccess = function () { set(q.result || null); };
    });
  }

  function planSave(plan) {
    if (!plan || !plan.hash) return Promise.reject(new Error("plan"));
    plan.hash = String(plan.hash).toLowerCase();
    if (planStore) return Promise.resolve(planStore.put(plan)).then(function () { return plan; });
    return planTx("readwrite", function (store, set) {
      var q = store.put(plan, plan.hash);
      q.onsuccess = function () { set(plan); };
    });
  }

  function planDelete(hash) {
    var key = String(hash || "").toLowerCase();
    if (planStore) return Promise.resolve(planStore.del(key));
    return planTx("readwrite", function (store, set) {
      var q = store.delete(key);
      q.onsuccess = function () { set(true); };
    });
  }

  function planAll() {
    if (planStore) return Promise.resolve(planStore.all());
    return planTx("readonly", function (store, set) {
      var q = store.getAll();
      q.onsuccess = function () { set(q.result || []); };
    });
  }

  function makePlan(fields) {
    var chunks = [];
    var i, piece;
    if (!fields || !fields.hash || !fields.chunks || !fields.chunks.length) throw new Error("plan");
    for (i = 0; i < fields.chunks.length; i++) {
      piece = bytesOf(fields.chunks[i]);
      if (!piece.length) throw new Error("plan");
      chunks.push({
        hash: contentHash(piece),
        bytes: K.hex(piece),
        status: "pending",
        tx: "",
        address: "",
        nonce: "",
        error: ""
      });
    }
    return {
      hash: String(fields.hash).toLowerCase(),
      chain: fields.chain,
      factory: fields.factory,
      wallet: fields.wallet,
      name: fields.name,
      description: fields.description,
      dev: fields.dev,
      artistBps: fields.artistBps,
      artist: fields.artist,
      artistName: fields.artistName || "",
      thumb: K.hex(bytesOf(fields.thumb)),
      expectedPhotoId: fields.expectedPhotoId || "",
      plate: "",
      photoId: "",
      registerStatus: "pending",
      registerTx: "",
      registerError: "",
      book: "",
      bookTx: "",
      bookStatus: "pending",
      linked: 0,
      sealTx: "",
      sealStatus: "pending",
      appendMax: 0,
      anchorFee: "",
      nextNonce: "",
      chunks: chunks
    };
  }

  function planDone(plan) {
    var i;
    if (!plan || plan.registerStatus !== "mined" || !plan.plate) return false;
    for (i = 0; i < plan.chunks.length; i++) {
      if (plan.chunks[i].status !== "mined" || !plan.chunks[i].address) return false;
    }
    return true;
  }

  function txCount(chain, from, tag) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getTransactionCount", [from, tag]).then(u256);
    });
  }

  function lookupReceipt(chain, hash) {
    if (!hash) return Promise.resolve(null);
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getTransactionReceipt", [hash]).then(function (rec) {
        return rec || null;
      });
    }).catch(function () { return null; });
  }

  function contractCode(chain, address) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getCode", [address, "latest"]);
    });
  }

  function codeIsPayload(codeHex, payload) {
    var raw = payloadOfCode(codeHex);
    var i;
    if (!raw || raw.length !== payload.length) return false;
    for (i = 0; i < payload.length; i++) if (raw[i] !== payload[i]) return false;
    return true;
  }

  function photoTopic() {
    return "0x" + K.hex(K.keccak256(utf8("PhotoAdded(uint256,address,address)")));
  }

  function claimNonce(chain, plan, from, nonce) {
    var addr;
    try { addr = createAddress(from, nonce); }
    catch (e) { return Promise.resolve(false); }
    return contractCode(chain, addr).then(function (code) {
      var i, payload;
      for (i = 0; i < plan.chunks.length; i++) {
        if (plan.chunks[i].status === "mined") continue;
        payload = bytesOf(plan.chunks[i].bytes);
        if (!codeIsPayload(code, payload)) continue;
        plan.chunks[i].status = "mined";
        plan.chunks[i].address = addr;
        plan.chunks[i].nonce = nonce.toString();
        plan.chunks[i].error = "";
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  function pieceTopic() {
    return "0x" + K.hex(K.keccak256(utf8("PieceCreated(address,uint256,address)")));
  }

  function sameHash(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase() && /^0x[0-9a-f]{64}$/.test(String(a || ""));
  }

  // A helper receipt has no contractAddress. The chunk addresses are in the logs.
  function applyHelperReceipt(chain, plan, rec) {
    var topic = pieceTopic();
    var logs = rec && rec.logs || [];
    var found = [];
    var waiting = [];
    var helper = batchOf(plan.chain || chain);
    var i, log, payer, chunkAddr;
    function writeReport() {
      var missed = [];
      var landed = 0;
      var n, chunk;
      for (n = 0; n < waiting.length; n++) {
        chunk = plan.chunks[waiting[n]];
        if (chunk.status === "mined" && chunk.address) {
          chunk.missed = false;
          landed += 1;
        } else {
          chunk.missed = true;
          missed.push(waiting[n] + 1);
        }
      }
      plan.batchReport = { sent: waiting.length, landed: landed, missed: missed };
    }
    function failWaiting(text, clearTx) {
      for (i = 0; i < waiting.length; i++) {
        if (plan.chunks[waiting[i]].status === "mined") continue;
        plan.chunks[waiting[i]].status = "failed";
        plan.chunks[waiting[i]].error = text;
        plan.chunks[waiting[i]].missed = true;
        if (clearTx) plan.chunks[waiting[i]].tx = "";
      }
      writeReport();
      return false;
    }
    for (i = 0; i < plan.chunks.length; i++) {
      if (plan.chunks[i].tx && sameHash(plan.chunks[i].tx, rec && rec.transactionHash) && !(plan.chunks[i].status === "mined" && plan.chunks[i].address)) {
        waiting.push(i);
      }
    }
    if (!rec || rec.status !== "0x1") return Promise.resolve(failWaiting("The contract creation reverted.", true));
    for (i = 0; i < logs.length; i++) {
      log = logs[i];
      if (!log || !log.topics || log.topics.length < 4 || String(log.topics[0]).toLowerCase() !== topic) continue;
      if (!helper || !sameAddr(log.address, helper)) continue;
      payer = addrOf(log.topics[1]);
      chunkAddr = addrOf(log.topics[3]);
      if (!payer || !sameAddr(payer, plan.wallet) || !chunkAddr) continue;
      found.push({ which: u256(log.topics[2]), address: chunkAddr });
    }
    found.sort(function (a, b) {
      if (a.which < b.which) return -1;
      if (a.which > b.which) return 1;
      return 0;
    });
    if (!found.length || found.length > waiting.length) {
      return Promise.resolve(failWaiting("The piece was stored, but this page could not read it yet.", false));
    }
    function one(n) {
      var idx, payload;
      if (n >= found.length) {
        for (i = found.length; i < waiting.length; i++) {
          plan.chunks[waiting[i]].status = "pending";
          plan.chunks[waiting[i]].tx = "";
          plan.chunks[waiting[i]].error = "";
          plan.chunks[waiting[i]].nonce = "";
          plan.chunks[waiting[i]].missed = true;
        }
        return Promise.resolve(true);
      }
      idx = waiting[n];
      payload = bytesOf(plan.chunks[idx].bytes);
      return waitPieceCode(chain, found[n].address, payload).then(function () {
        plan.chunks[idx].status = "mined";
        plan.chunks[idx].address = found[n].address;
        plan.chunks[idx].tx = rec.transactionHash || plan.chunks[idx].tx || "";
        plan.chunks[idx].nonce = "";
        plan.chunks[idx].error = "";
        plan.chunks[idx].missed = false;
        return one(n + 1);
      }, function () {
        plan.chunks[idx].status = "failed";
        plan.chunks[idx].error = "The deployed code did not match this piece.";
        return false;
      });
    }
    return one(0).then(function (ok) {
      writeReport();
      if (!ok) return false;
      return readBlock(chain, rec.blockNumber).then(function (block) {
        if (!plan.anchorFee) plan.anchorFee = u256(block.baseFeePerGas).toString();
        rec.baseFee = u256(block.baseFeePerGas);
        return true;
      });
    });
  }

  function takeChunkReceipt(chain, plan, index, rec) {
    var chunk = plan.chunks[index];
    var payload = bytesOf(chunk.bytes);
    if (!rec || rec.status !== "0x1") {
      chunk.status = "failed";
      chunk.error = "The contract creation reverted.";
      return Promise.resolve(false);
    }
    if (!rec.contractAddress) return applyHelperReceipt(chain, plan, rec);
    return waitPieceCode(chain, rec.contractAddress, payload).then(function () {
      chunk.status = "mined";
      chunk.address = parseAddr(rec.contractAddress);
      chunk.tx = rec.transactionHash || chunk.tx || "";
      chunk.error = "";
      chunk.missed = false;
      if (rec.nonce != null) chunk.nonce = u256(rec.nonce).toString();
      return readBlock(chain, rec.blockNumber).then(function (block) {
        if (!plan.anchorFee) plan.anchorFee = u256(block.baseFeePerGas).toString();
        rec.baseFee = u256(block.baseFeePerGas);
        return true;
      });
    }, function () {
      chunk.status = "failed";
      chunk.error = "The deployed code did not match this piece.";
      return false;
    });
  }

  function digest(bytes) {
    if (!bytes || !bytes.length) return "";
    return K.hex(K.keccak256(bytes));
  }

  function codeDigest(codeHex) {
    var raw = payloadOfCode(codeHex);
    if (!raw || !raw.length) return "";
    return digest(raw);
  }

  function logStart(chain) {
    return BigInt(LOG_START[chain] || 0);
  }

  function getLogsOn(url, chain, address, topics) {
    return rpc(url, "eth_blockNumber", []).then(function (hex) {
      var latest = u256(hex);
      var start = logStart(chain);
      var rows = [];
      if (start > latest) start = 0n;
      function step(from) {
        var to;
        if (from > latest) return rows;
        to = from + LOG_WINDOW - 1n;
        if (to > latest) to = latest;
        return rpc(url, "eth_getLogs", [{
          address: address,
          fromBlock: hexQty(from),
          toBlock: hexQty(to),
          topics: topics
        }]).then(function (part) {
          var i;
          if (Array.isArray(part)) {
            for (i = 0; i < part.length; i++) rows.push(part[i]);
          }
          if (to >= latest) return rows;
          return step(to + 1n);
        });
      }
      return step(start);
    });
  }

  function getLogs(chain, address, topics) {
    return firstOk(chain, function (url) {
      return getLogsOn(url, chain, address, topics);
    }).then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    });
  }

  // PhotoAdded records the account that registered the photograph. A later sale
  // changes the title. This map does not.
  function uploaders(chain, factory) {
    var topic = "0x" + K.hex(K.keccak256(utf8("PhotoAdded(uint256,address,address)")));
    return getLogs(chain, factory, [topic]).then(function (rows) {
      var map = {};
      var i, log, plate, artist;
      for (i = 0; i < rows.length; i++) {
        log = rows[i];
        if (!log || !log.topics || String(log.topics[0]).toLowerCase() !== topic) continue;
        plate = addrOf(log.topics[2]);
        artist = addrOf(log.topics[3]);
        if (plate && artist) map[plate.toLowerCase()] = artist;
      }
      return map;
    });
  }

  function each(items, fn) {
    function step(i) {
      if (!items || i >= items.length) return Promise.resolve();
      return Promise.resolve(fn(items[i], i)).then(function () { return step(i + 1); });
    }
    return step(0);
  }

  // Forge cannot read this browser's saved plan. The page reads the chain and
  // writes the piece addresses, and the book address, into that same plan.
  function discoverChain(chain, plan) {
    var hashes = [];
    var used = {};
    var foreignHits = [];
    var helper, i, payload;
    if (!plan || !plan.wallet || !plan.chunks) return Promise.resolve();
    plan.otherAccount = "";
    plan.shareError = "";
    plan.scanLimited = false;
    helper = batchOf(chain);
    for (i = 0; i < plan.chunks.length; i++) {
      payload = bytesOf(plan.chunks[i].bytes);
      hashes.push(digest(payload));
      if (plan.chunks[i].status === "mined" && plan.chunks[i].address) {
        used[String(plan.chunks[i].address).toLowerCase()] = i;
      }
    }
    function freeIndex(hash) {
      var n;
      for (n = 0; n < hashes.length; n++) {
        if (hashes[n] !== hash) continue;
        if (plan.chunks[n].status === "mined" && plan.chunks[n].address) continue;
        return n;
      }
      return -1;
    }
    function hold(index, address) {
      var addr = parseAddr(address);
      var key, chunk, prev;
      if (index < 0 || !addr) return;
      key = addr.toLowerCase();
      if (used[key] != null && used[key] !== index) return;
      chunk = plan.chunks[index];
      prev = chunk.address ? String(chunk.address).toLowerCase() : "";
      if (chunk.status === "mined" && chunk.address && prev !== key) return;
      if (prev && prev !== key) delete used[prev];
      chunk.status = "mined";
      chunk.address = addr;
      chunk.error = "";
      used[key] = index;
    }
    function force(index, address) {
      var addr = parseAddr(address);
      var key, chunk, prev, other;
      if (index < 0 || !addr) return;
      key = addr.toLowerCase();
      chunk = plan.chunks[index];
      prev = chunk.address ? String(chunk.address).toLowerCase() : "";
      if (prev && prev !== key) delete used[prev];
      if (used[key] != null && used[key] !== index) {
        other = plan.chunks[used[key]];
        if (other && sameAddr(other.address, addr)) {
          other.address = "";
          other.status = "";
        }
      }
      chunk.status = "mined";
      chunk.address = addr;
      chunk.error = "";
      used[key] = index;
    }
    function consider(address, codeHex, payer) {
      var hash = codeDigest(codeHex);
      var index = freeIndex(hash);
      if (!hash || index < 0) return;
      if (payer && !sameAddr(payer, plan.wallet)) {
        foreignHits.push({ hash: hash, payer: parseAddr(payer) });
        return;
      }
      hold(index, address);
    }
    function readOpenedBook(book) {
      return Promise.all([
        agree(chain, book, sel("chunkCount")),
        agree(chain, book, sel("locked")),
        agree(chain, book, sel("used")),
        agree(chain, book, sel("expected"))
      ]).then(function (parts) {
        var count = Number(u256(parts[0]));
        var locked = u256(parts[1]) !== 0n;
        var bookUsed = u256(parts[2]) !== 0n;
        var expected = Number(u256(parts[3]));
        var addresses = [];
        function one(n) {
          if (expected !== plan.chunks.length || count < 1 || count > plan.chunks.length) return Promise.resolve(null);
          if (n >= count) {
            return { matched: count, locked: locked, used: bookUsed, addresses: addresses };
          }
          return agree(chain, book, sel("chunkAt") + pad256(n)).then(function (word) {
            var addr = addrOf(word);
            if (!addr) return null;
            return contractCode(chain, addr).then(function (code) {
              if (codeDigest(code) !== hashes[n]) return null;
              addresses[n] = addr;
              return one(n + 1);
            });
          });
        }
        return one(0);
      }).catch(function () { return null; });
    }
    function findPlateByHash() {
      return agree(chain, plan.factory, sel("photoCount")).then(function (hex) {
        var n = u256(hex);
        var want = String(plan.hash || "").toLowerCase();
        function step(id) {
          if (id < 1n) return null;
          return agree(chain, plan.factory, sel("photoAt") + pad256(id)).then(function (word) {
            var plate = addrOf(word);
            if (!plate) return step(id - 1n);
            return agree(chain, plate, sel("contentHash")).then(function (got) {
              if (String(got || "").toLowerCase() === want) return { id: id.toString(), plate: plate };
              return step(id - 1n);
            });
          });
        }
        return step(n);
      }).catch(function () { return null; });
    }
    function applyBook(info) {
      var n;
      if (!info) return Promise.resolve();
      plan.book = info.book;
      plan.bookStatus = "mined";
      plan.linked = info.matched;
      if (info.locked) plan.sealStatus = "mined";
      for (n = 0; n < info.addresses.length; n++) force(n, info.addresses[n]);
      if (!info.used) return Promise.resolve();
      return findPlateByHash().then(function (found) {
        if (!found) return;
        plan.registerStatus = "mined";
        plan.registerError = "";
        plan.photoId = found.id;
        plan.plate = found.plate;
      });
    }
    var logPromise = helper
      ? getLogs(chain, helper, [pieceTopic()]).catch(function () {
        plan.shareError = "history";
        return [];
      })
      : Promise.resolve([]);
    return logPromise.then(function (logs) {
      return each(logs, function (log) {
        var chunk, payer;
        if (!log || !log.topics || log.topics.length < 4) return;
        if (String(log.topics[0]).toLowerCase() !== pieceTopic()) return;
        payer = addrOf(log.topics[1]);
        chunk = addrOf(log.topics[3]);
        if (!chunk) return;
        return liveCode(chain, chunk).then(function (code) {
          consider(chunk, code, payer);
        }).catch(function () {});
      });
    }).then(function () {
      return txCount(chain, plan.wallet, "latest");
    }).then(function (latest) {
      // One direct store uses one nonce, and so does every other transaction
      // from this account. Scanning only the piece count would miss a piece
      // after any other send. 2,048 covers the 1,150-piece maximum, linking,
      // and some other use. Batch pieces come from the helper logs.
      var limit = 2048n;
      var start = latest > limit ? latest - limit : 0n;
      var width = 8n;
      plan.scanLimited = latest > limit;
      function scan(nonce) {
        var jobs = [];
        var n;
        var end;
        if (nonce >= latest) return Promise.resolve();
        end = nonce + width;
        if (end > latest) end = latest;
        for (n = nonce; n < end; n++) jobs.push(claimNonce(chain, plan, plan.wallet, n));
        return Promise.all(jobs).then(function () { return scan(end); });
      }
      return scan(start);
    }).then(function () {
      if (!plan.factory || plan.shareError) return null;
      return getLogs(chain, plan.factory, [bookTopic()]).catch(function () {
        plan.shareError = "history";
        return null;
      });
    }).then(function (bookLogs) {
      var best = null;
      var foreignBook = "";
      if (!bookLogs || plan.shareError) return;
      return each(bookLogs, function (log) {
        var book, artist, count;
        if (!log || !log.topics || log.topics.length < 3) return;
        if (String(log.topics[0]).toLowerCase() !== bookTopic()) return;
        book = addrOf(log.topics[1]);
        artist = addrOf(log.topics[2]);
        count = log.data ? u256(log.data) : 0n;
        if (!book || count !== BigInt(plan.chunks.length)) return;
        return readOpenedBook(book).then(function (info) {
          if (!info) return;
          info.book = book;
          if (!sameAddr(artist, plan.wallet)) {
            foreignBook = artist || foreignBook;
            return;
          }
          if (!best || info.matched > best.matched) best = info;
        });
      }).then(function () {
        if (best) return applyBook(best);
        if (!plan.book) {
          if (foreignBook) plan.otherAccount = foreignBook;
          return;
        }
        return readOpenedBook(plan.book).then(function (info) {
          if (!info) {
            plan.book = "";
            plan.bookStatus = "";
            plan.linked = 0;
            if (foreignBook) plan.otherAccount = foreignBook;
            return;
          }
          info.book = plan.book;
          return applyBook(info);
        });
      });
    }).then(function () {
      var n;
      if (plan.shareError) return;
      for (n = 0; n < foreignHits.length; n++) {
        if (freeIndex(foreignHits[n].hash) >= 0 && foreignHits[n].payer) {
          plan.otherAccount = foreignHits[n].payer;
        }
      }
    }).catch(function () {
      plan.shareError = "history";
    });
  }

  function shareBlock(plan) {
    if (!plan || !plan.shareError) {
      if (plan && plan.otherAccount && !sameAddr(plan.otherAccount, plan.wallet)) throw new Error("other");
      return;
    }
    throw new Error("history");
  }

  function reconcilePlan(chain, plan) {
    var from = plan.wallet;
    function receipts(i) {
      var chunk, payload;
      if (i >= plan.chunks.length) return Promise.resolve();
      chunk = plan.chunks[i];
      payload = bytesOf(chunk.bytes);
      if (chunk.status === "mined" && chunk.address) {
        return contractCode(chain, chunk.address).then(function (code) {
          // A restarted chain keeps the saved address and drops the code.
          // The piece has to be stored again, so the old transaction is not waited on.
          if (!codeIsPayload(code, payload)) {
            chunk.status = "pending";
            chunk.error = "";
            chunk.address = "";
            chunk.tx = "";
            chunk.nonce = "";
            return receipts(i + 1);
          }
          return pieceMakerOf(chain, chunk.address).then(function (who) {
            // Resume only pieces this wallet stored. Another account's addresses
            // cannot be registered, and a raw create has no maker on this factory.
            if (who === null) return receipts(i + 1);
            if (plan.wallet && who && !sameAddr(who, plan.wallet)) {
              plan.otherAccount = who;
              chunk.status = "pending";
              chunk.error = "";
              chunk.address = "";
              chunk.tx = "";
              chunk.nonce = "";
            } else if (plan.wallet && who === "") {
              chunk.status = "pending";
              chunk.error = "";
              chunk.address = "";
              chunk.tx = "";
              chunk.nonce = "";
            }
            return receipts(i + 1);
          });
        }).catch(function () { return receipts(i + 1); });
      }
      if (chunk.tx) {
        return lookupReceipt(chain, chunk.tx).then(function (rec) {
          if (!rec) return receipts(i + 1);
          return takeChunkReceipt(chain, plan, i, rec).then(function (ok) {
            if (!ok) plan.chunks[i].tx = "";
            return receipts(i + 1);
          });
        });
      }
      if (chunk.nonce !== "" && chunk.nonce != null) {
        return claimNonce(chain, plan, from, BigInt(chunk.nonce)).then(function () { return receipts(i + 1); });
      }
      return receipts(i + 1);
    }
    // The browser can remember a registration after the chain was replaced.
    // Only a plate this factory still lists, with the same content hash, stays registered.
    function confirmRegistration() {
      var want;
      if (plan.registerStatus !== "mined" || !plan.plate || !plan.factory) return Promise.resolve();
      want = String(plan.hash || "").toLowerCase();
      return agree(chain, plan.factory, sel("photoCount")).then(function (hex) {
        var n = u256(hex);
        function step(id) {
          if (id < 1n) return null;
          return agree(chain, plan.factory, sel("photoAt") + pad256(id)).then(function (word) {
            var plate = addrOf(word);
            if (!plate) return step(id - 1n);
            return agree(chain, plate, sel("contentHash")).then(function (got) {
              if (String(got || "").toLowerCase() === want) return { id: id.toString(), plate: plate };
              return step(id - 1n);
            }).catch(function () { return step(id - 1n); });
          });
        }
        return step(n);
      }).then(function (found) {
        if (found) {
          plan.plate = found.plate;
          plan.photoId = found.id;
          plan.registerStatus = "mined";
          plan.registerError = "";
          return;
        }
        plan.registerStatus = "pending";
        plan.registerError = "";
        plan.plate = "";
        plan.photoId = "";
        plan.registerTx = "";
        plan.book = "";
        plan.bookTx = "";
        plan.bookStatus = "pending";
        plan.linked = 0;
        plan.sealTx = "";
        plan.sealStatus = "pending";
      }, function () {});
    }
    return receipts(0).then(function () {
      if (plan.registerTx && plan.registerStatus !== "mined") {
        return lookupReceipt(chain, plan.registerTx).then(function (rec) {
          if (rec && rec.status === "0x1") return finishRegister(plan, rec);
          if (rec && rec.status !== "0x1") {
            plan.registerStatus = "failed";
            plan.registerError = "The photograph was not registered.";
          }
        });
      }
    }).then(function () {
      return confirmRegistration();
    }).then(function () {
      if (!from) return planSave(plan);
      return discoverChain(chain, plan).then(function () {
        return txCount(chain, from, "pending");
      }).then(function (pending) {
        plan.nextNonce = pending.toString();
        return planSave(plan);
      });
    });
  }

  function takePhotoLog(plan, rec) {
    var topic = photoTopic();
    var logs = rec && rec.logs || [];
    var i, log;
    if (!rec || rec.status !== "0x1") return null;
    for (i = 0; i < logs.length; i++) {
      log = logs[i];
      if (!log || !log.topics || log.topics[0] !== topic) continue;
      if (!sameAddr(log.address, plan.factory)) continue;
      return {
        id: u256(log.topics[1]).toString(),
        plate: addrOf(log.topics[2])
      };
    }
    return null;
  }

  function finishRegister(plan, rec) {
    var found = takePhotoLog(plan, rec);
    if (!found || !found.plate) {
      plan.registerStatus = "failed";
      plan.registerError = "The photograph was not registered.";
      return planSave(plan).then(function () { return null; });
    }
    plan.registerStatus = "mined";
    plan.registerError = "";
    plan.photoId = found.id;
    plan.plate = found.plate;
    plan.registerTx = rec.transactionHash || plan.registerTx || "";
    return planSave(plan).then(function () { return found; });
  }

  function minedAddrs(plan) {
    var out = [];
    var i, chunk;
    if (!plan || !plan.chunks || !plan.chunks.length) return null;
    for (i = 0; i < plan.chunks.length; i++) {
      chunk = plan.chunks[i];
      if (chunk.status !== "mined" || !chunk.address) return null;
      out.push(chunk.address);
    }
    return out;
  }

  function postAny(chain, method, params) {
    var urls = endpoints(chain);
    var last = new Error("weather");
    function step(i) {
      if (!urls || i >= urls.length) return Promise.reject(last);
      return rpcMessage(urls[i], method, params).catch(function (err) {
        last = err || last;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function balanceOf(chain, addr) {
    return firstOk(chain, function (url) {
      return rpc(url, "eth_getBalance", [addr, "latest"]).then(u256);
    });
  }

  function deployPlannedChunk(chain, plan, index, hooks) {
    var note = hooks || {};
    var chunk;
    if (!plan || !plan.chunks || !plan.chunks[index]) return Promise.reject(new Error("chunk"));
    if (note.local && chain !== "anvil") return Promise.reject(new Error("chain"));
    return reconcilePlan(chain, plan).then(function () {
      chunk = plan.chunks[index];
      if (chunk.status === "mined" && chunk.address) {
        return { skipped: true, address: chunk.address };
      }
      shareBlock(plan);
      if (chunk.tx) {
        return waitReceipt(chain, chunk.tx).then(function (rec) {
          return takeChunkReceipt(chain, plan, index, rec).then(function (ok) {
            if (!ok) plan.chunks[index].tx = "";
            return planSave(plan).then(function () {
              if (!ok) throw new Error("mismatch");
              return { skipped: true, address: plan.chunks[index].address, receipt: rec };
            });
          });
        }).catch(function (err) {
          if (plan.chunks[index].status === "mined") throw err;
          if (err && err.message === "revert") plan.chunks[index].tx = "";
          plan.chunks[index].status = "failed";
          plan.chunks[index].error = reasonText(err);
          return planSave(plan).then(function () { throw err; });
        });
      }
      return Promise.all([
        txCount(chain, plan.wallet, "latest"),
        txCount(chain, plan.wallet, "pending")
      ]).then(function (pair) {
        var nonce;
        if (pair[1] !== pair[0]) throw new Error("nonce");
        nonce = pair[0];
        chunk.status = "submitted";
        chunk.nonce = nonce.toString();
        chunk.tx = "";
        chunk.error = "";
        plan.nextNonce = (nonce + 1n).toString();
        return planSave(plan).then(function () { return nonce; });
      }).then(function (nonce) {
        var payload = bytesOf(chunk.bytes);
        var helper = batchOf(chain);
        var init = creationData(payload);
        var data = helper ? encodeCreatePieces([init]) : init;
        var set = {
          anchor: plan.anchorFee ? BigInt(plan.anchorFee) : null,
          lastBlock: null,
          trace: []
        };
        if (!helper && !note.local) return Promise.reject(new Error("batch"));
        return waitForFee(chain, set, note.onWait).then(function () {
          if (helper) return estimateCall(chain, plan.wallet, helper, data).then(function (got) { return got.gas; });
          return chunkGasLimit(chain, plan.wallet, data);
        }).then(function (gas) {
          return send(chain, helper ? {
            kind: "createPieces",
            data: data,
            to: helper,
            from: plan.wallet,
            gas: gas,
            nonce: nonce,
            onSend: note.onSend
          } : {
            kind: "create",
            data: data,
            from: plan.wallet,
            gas: gas,
            nonce: nonce,
            local: note.local === true,
            onSend: note.onSend
          }).then(function (hash) {
            chunk.tx = hash;
            chunk.status = "submitted";
            return planSave(plan).then(function () { return hash; });
          }).then(function (hash) {
            return waitReceipt(chain, hash).then(function (rec) {
              rec.chunkGas = gas;
              var applied = helper
                ? applyHelperReceipt(chain, plan, rec)
                : takeChunkReceipt(chain, plan, index, rec);
              return applied.then(function (ok) {
                if (!ok) plan.chunks[index].tx = "";
                plan.nextNonce = (nonce + 1n).toString();
                return planSave(plan).then(function () {
                  if (!ok) throw new Error("mismatch");
                  return { skipped: false, address: plan.chunks[index].address, receipt: rec };
                });
              });
            });
          });
        });
      }).catch(function (err) {
        if (plan.chunks[index].status === "mined") throw err;
        plan.chunks[index].status = "failed";
        plan.chunks[index].error = reasonText(err);
        if (!plan.chunks[index].tx && err && err.message !== "revert" && err.message !== "mismatch" && plan.chunks[index].nonce !== "" && plan.chunks[index].nonce != null) {
          plan.nextNonce = plan.chunks[index].nonce;
        }
        return planSave(plan).then(function () { throw err; });
      });
    });
  }

  // One wallet transaction holds only as many pieces as eth_estimateGas can fit,
  // and never more than STORE_GROUP_MAX. On Osaka (Anvil, mainnet now) a
  // transaction cannot ask for more than 16,777,216 gas. On Sepolia that cap
  // is execution only; the page passes the estimate, which may be higher, so
  // the extra can pay for new contract code.
  function pendingIndexes(plan) {
    var out = [];
    var i, chunk;
    for (i = 0; i < plan.chunks.length; i++) {
      chunk = plan.chunks[i];
      if (chunk.status === "mined" && chunk.address) continue;
      out.push(i);
    }
    return out;
  }

  function encodeCreatePieces(inits) {
    var n = inits.length;
    var bodies = [];
    var offsets = "";
    var packed = "";
    var cursor = 32 * n;
    var i, hex, body;
    if (!n || n > STORE_GROUP_MAX) throw new Error("fit");
    for (i = 0; i < n; i++) {
      hex = String(inits[i] || "").toLowerCase().replace(/^0x/, "");
      if (!hex || hex.length % 2 || !/^[0-9a-f]+$/.test(hex)) throw new Error("bytecode");
      body = pad256(hex.length / 2) + hex;
      while (body.length % 64) body += "0";
      bodies.push(body);
    }
    for (i = 0; i < n; i++) {
      offsets += pad256(cursor);
      cursor += bodies[i].length / 2;
    }
    for (i = 0; i < n; i++) packed += bodies[i];
    return sel("createPieces") + pad256(32) + pad256(n) + offsets + packed;
  }

  // EIP-7825. Osaka applies this to the whole transaction. Sepolia applies it
  // to execution gas; state gas for new code may sit above it.
  var TX_GAS_CAP = 16777216n;

  function totalGasCap(chain) {
    return chain === "sepolia" ? 0n : TX_GAS_CAP;
  }

  function estimateCall(chain, from, to, data) {
    return readBlock(chain, "latest").then(function (block) {
      var cap = u256(block.gasLimit);
      var totalCap = totalGasCap(chain);
      return postAny(chain, "eth_estimateGas", [{ from: from, to: to, data: data, value: "0x0" }]).then(function (hex) {
        var est = u256(hex);
        var gas = est + est / 64n;
        if (est < 21000n || est > cap) throw new Error("fit");
        if (totalCap && est > totalCap) throw new Error("fit");
        if (gas > cap) gas = cap;
        if (totalCap && gas > totalCap) gas = totalCap;
        if (gas < est) throw new Error("fit");
        return { est: est, gas: hexQty(gas), cap: cap };
      });
    });
  }

  function chooseBatch(chain, from, helper, indexes, plan) {
    function dataFor(k) {
      var list = [];
      var i;
      for (i = 0; i < k; i++) list.push(creationData(bytesOf(plan.chunks[indexes[i]].bytes)));
      return encodeCreatePieces(list);
    }
    var capCount = indexes.length > STORE_GROUP_MAX ? STORE_GROUP_MAX : indexes.length;
    return estimateCall(chain, from, helper, dataFor(1)).then(function (one) {
      var guess = Number(one.cap / one.est);
      var byTx;
      if (chain !== "sepolia") {
        byTx = Number(TX_GAS_CAP / one.est);
        if (byTx && byTx < guess) guess = byTx;
      }
      if (!guess || guess < 1) guess = 1;
      if (guess > capCount) guess = capCount;
      function fit(k) {
        if (k <= 1) return Promise.resolve({ k: 1, gas: one.gas, data: dataFor(1) });
        return estimateCall(chain, from, helper, dataFor(k)).then(function (got) {
          return { k: k, gas: got.gas, data: dataFor(k) };
        }, function () {
          return fit(k - 1);
        });
      }
      return fit(guess);
    });
  }

  function deployPieceBatch(chain, plan, hooks) {
    var note = hooks || {};
    var helper = batchOf(chain);
    var indexes = [];
    var picked = null;
    if (!helper) return Promise.reject(new Error("batch"));
    if (note.local) return Promise.reject(new Error("kind"));
    if (!plan || !plan.chunks || !plan.wallet) return Promise.reject(new Error("chunk"));
    return reconcilePlan(chain, plan).then(function () {
      var set;
      indexes = pendingIndexes(plan);
      if (!indexes.length) return { skipped: true, count: 0 };
      shareBlock(plan);
      function sendGroup() {
      set = {
        anchor: plan.anchorFee ? BigInt(plan.anchorFee) : null,
        lastBlock: null,
        trace: []
      };
      if (note.onEstimate) note.onEstimate();
      return waitForFee(chain, set, note.onWait).then(function () {
        return chooseBatch(chain, plan.wallet, helper, indexes, plan);
      }).then(function (choice) {
        var i;
        picked = choice;
        for (i = 0; i < picked.k; i++) {
          plan.chunks[indexes[i]].status = "submitted";
          plan.chunks[indexes[i]].nonce = "";
          plan.chunks[indexes[i]].tx = "";
          plan.chunks[indexes[i]].error = "";
        }
        return planSave(plan);
      }).then(function () {
        return Promise.all([
          txCount(chain, plan.wallet, "latest"),
          txCount(chain, plan.wallet, "pending")
        ]);
      }).then(function (pair) {
        // The next group has to use the next number. A wallet on this local chain reused 0.
        if (pair[1] !== pair[0]) throw new Error("nonce");
        if (note.onSend) note.onSend();
        return send(chain, {
          kind: "createPieces",
          data: picked.data,
          to: helper,
          from: plan.wallet,
          gas: picked.gas,
          nonce: pair[0]
        });
      }).then(function (hash) {
        var i;
        for (i = 0; i < picked.k; i++) {
          plan.chunks[indexes[i]].tx = hash;
          plan.chunks[indexes[i]].status = "submitted";
          plan.chunks[indexes[i]].nonce = "";
        }
        return planSave(plan).then(function () { return hash; });
      }).then(function (hash) {
        return waitReceipt(chain, hash).then(function (rec) {
          return applyHelperReceipt(chain, plan, rec).then(function (ok) {
            plan.lastStoreError = "";
            return planSave(plan).then(function () {
              if (!ok) throw new Error("mismatch");
              return { skipped: false, count: picked.k, receipt: rec };
            });
          });
        });
      });
      }
      if (plan.chunks[indexes[0]].tx) {
        return txExists(chain, plan.chunks[indexes[0]].tx).then(function (exists) {
          var i;
          if (exists) {
            return waitReceipt(chain, plan.chunks[indexes[0]].tx).then(function (rec) {
              return applyHelperReceipt(chain, plan, rec).then(function (ok) {
                return planSave(plan).then(function () {
                  if (!ok) throw new Error("mismatch");
                  return { skipped: true, count: 0 };
                });
              });
            });
          }
          for (i = 0; i < indexes.length; i++) {
            if (!plan.chunks[indexes[i]]) continue;
            plan.chunks[indexes[i]].tx = "";
            plan.chunks[indexes[i]].status = "pending";
          }
          return planSave(plan).then(sendGroup);
        });
      }
      return sendGroup();
    }).catch(function (err) {
      var i, chunk, landed, missedNums, sentTx;
      if (!picked) {
        plan.lastStoreError = reasonText(err);
        return planSave(plan).then(function () { throw err; });
      }
      sentTx = false;
      for (i = 0; i < picked.k; i++) {
        chunk = plan.chunks[indexes[i]];
        if (chunk && chunk.tx) sentTx = true;
      }
      if (!sentTx) {
        for (i = 0; i < picked.k; i++) {
          chunk = plan.chunks[indexes[i]];
          if (!chunk) continue;
          chunk.status = "pending";
          chunk.nonce = "";
          chunk.tx = "";
          chunk.missed = false;
          chunk.error = "";
        }
        plan.batchReport = null;
        plan.lastStoreError = reasonText(err);
        return planSave(plan).then(function () { throw err; });
      }
      landed = 0;
      missedNums = [];
      for (i = 0; i < picked.k; i++) {
        chunk = plan.chunks[indexes[i]];
        if (!chunk) continue;
        if (chunk.status === "mined" && chunk.address) {
          chunk.missed = false;
          landed += 1;
          continue;
        }
        chunk.status = "failed";
        chunk.nonce = "";
        chunk.missed = true;
        chunk.error = reasonText(err);
        missedNums.push(indexes[i] + 1);
      }
      plan.lastStoreError = "";
      plan.batchReport = { sent: picked.k, landed: landed, missed: missedNums };
      return planSave(plan).then(function () { throw err; });
    });
  }

  // How many of the next pieces fit in one transaction, and how many
  // transactions the whole photograph still needs. Linking stays separate.
  function storePlanShape(chain, plan) {
    var helper = batchOf(chain);
    var indexes;
    if (!plan || !plan.chunks || !plan.chunks.length) return Promise.resolve(null);
    indexes = pendingIndexes(plan);
    if (!helper) {
      return Promise.resolve({
        helper: false,
        per: 0,
        storeTx: indexes.length,
        linkTx: 0,
        remaining: indexes.length,
        total: plan.chunks.length
      });
    }
    return factoryLinksInOne(chain, plan.factory).then(function (oneCall) {
      return Promise.all([
        readAppendMax(chain, plan.factory),
        plan.wallet ? canAdd(chain, plan.factory, plan.wallet).catch(function () { return false; }) : Promise.resolve(false)
      ]).then(function (pair) {
      var appendMax = pair[0];
      var allowed = pair[1];
      var started = !!(plan.book || plan.bookTx || plan.bookStatus === "mined" || plan.sealStatus === "mined");
      var n = plan.chunks.length;
      var one = oneCall && !started && n > 0 && (n <= OPEN_MAX || allowed) && n <= appendMax;
      var linkTx = one ? 1 : 3 + Math.ceil(n / appendMax);
      if (!indexes.length) {
        return { helper: true, per: 0, storeTx: 0, linkTx: linkTx, remaining: 0, total: plan.chunks.length };
      }
      return chooseBatch(chain, plan.wallet, helper, indexes, plan).then(function (choice) {
        return {
          helper: true,
          per: choice.k,
          storeTx: Math.ceil(indexes.length / choice.k),
          linkTx: linkTx,
          remaining: indexes.length,
          total: plan.chunks.length
        };
      });
      });
    });
  }

  function readAppendMax(chain, factory) {
    return agree(chain, factory, sel("appendMax")).then(function (hex) {
      var n = Number(u256(hex));
      if (!n || n > 80) throw new Error("limit");
      return n;
    });
  }

  function bookTopic() {
    return "0x" + K.hex(K.keccak256(utf8("BookOpened(address,address,uint256)")));
  }

  function takeBook(plan, rec) {
    var topic = bookTopic();
    var logs = rec && rec.logs || [];
    var i, log, book, artist, count;
    if (!rec || rec.status !== "0x1") return false;
    for (i = 0; i < logs.length; i++) {
      log = logs[i];
      if (!log || !log.topics || log.topics[0] !== topic) continue;
      if (!sameAddr(log.address, plan.factory)) continue;
      book = addrOf(log.topics[1]);
      artist = addrOf(log.topics[2]);
      count = log.data ? u256(log.data) : 0n;
      if (!book || !sameAddr(artist, plan.wallet)) continue;
      if (count !== BigInt(plan.chunks.length)) continue;
      plan.book = book;
      plan.bookStatus = "mined";
      plan.bookTx = rec.transactionHash || plan.bookTx || "";
      return true;
    }
    return false;
  }

  function verifyPrefix(chain, plan, from, to) {
    function one(i) {
      if (i >= to) return Promise.resolve();
      return agree(chain, plan.book, sel("chunkAt") + pad256(i)).then(function (word) {
        var got = addrOf(word);
        if (!got || !sameAddr(got, plan.chunks[i].address)) throw new Error("book");
        return one(i + 1);
      });
    }
    if (from < 0) from = 0;
    return one(from);
  }

  function syncBook(chain, plan, checkFrom) {
    if (!plan.book) return Promise.resolve();
    return Promise.all([
      agree(chain, plan.book, sel("chunkCount")),
      agree(chain, plan.book, sel("artist")),
      agree(chain, plan.book, sel("expected")),
      agree(chain, plan.book, sel("locked")),
      agree(chain, plan.book, sel("used"))
    ]).then(function (parts) {
      var count = Number(u256(parts[0]));
      var artist = addrOf(parts[1]);
      var expected = Number(u256(parts[2]));
      var locked = u256(parts[3]) !== 0n;
      if (!artist || !sameAddr(artist, plan.wallet)) throw new Error("book");
      if (expected !== plan.chunks.length || count > plan.chunks.length) throw new Error("book");
      plan.linked = count;
      if (locked) plan.sealStatus = "mined";
      return verifyPrefix(chain, plan, checkFrom || 0, count);
    });
  }

  function sendFactory(chain, plan, kind, data, note) {
    var hooks = note || {};
    return Promise.all([
      txCount(chain, plan.wallet, "latest"),
      txCount(chain, plan.wallet, "pending")
    ]).then(function (pair) {
      var nonce;
      if (pair[0] !== pair[1]) throw new Error("nonce");
      nonce = pair[0];
      plan.nextNonce = (nonce + 1n).toString();
      return planSave(plan).then(function () { return nonce; });
    }).then(function (nonce) {
      return send(chain, {
        kind: kind,
        data: data,
        to: plan.factory,
        from: plan.wallet,
        factory: plan.factory,
        nonce: nonce,
        local: hooks.local === true,
        onSend: hooks.onSend
      });
    }).then(function (hash) {
      if (kind === "openBook") plan.bookTx = hash;
      else if (kind === "sealBook") plan.sealTx = hash;
      else if (kind === "addPhoto" || kind === "linkPhoto") plan.registerTx = hash;
      else plan.linkTx = hash;
      return planSave(plan).then(function () { return waitReceipt(chain, hash); });
    });
  }

  function ensureBook(chain, plan, note) {
    if (plan.book && plan.bookStatus === "mined") return syncBook(chain, plan, 0);
    if (plan.bookTx) {
      return waitReceipt(chain, plan.bookTx).then(function (rec) {
        if (!takeBook(plan, rec)) {
          plan.bookTx = "";
          plan.bookStatus = "failed";
          return planSave(plan).then(function () { throw new Error("revert"); });
        }
        return planSave(plan).then(function () { return syncBook(chain, plan, 0); });
      });
    }
    return sendFactory(chain, plan, "openBook", encodeOpenBook(plan.chunks.length), note).then(function (rec) {
      if (!takeBook(plan, rec)) {
        plan.bookTx = "";
        plan.bookStatus = "failed";
        return planSave(plan).then(function () { throw new Error("revert"); });
      }
      return planSave(plan).then(function () { return syncBook(chain, plan, 0); });
    });
  }

  function ensureLinked(chain, plan, note) {
    function step() {
      var from, room, batch, i;
      if (plan.linked == null || plan.linked === "") plan.linked = 0;
      if (note.onLink) note.onLink(plan.linked || 0, plan.chunks.length);
      if ((plan.linked || 0) >= plan.chunks.length) return Promise.resolve();
      room = Number(plan.appendMax);
      if (!room || room > 80) return Promise.reject(new Error("limit"));
      if (plan.linked + room > plan.chunks.length) room = plan.chunks.length - plan.linked;
      batch = [];
      for (i = 0; i < room; i++) batch.push(plan.chunks[plan.linked + i].address);
      from = plan.linked;
      return sendFactory(chain, plan, "addChunks", encodeAddChunks(plan.book, batch), note).then(function (rec) {
        if (!rec || rec.status !== "0x1") throw new Error("revert");
        return syncBook(chain, plan, from);
      }).then(function () {
        if (plan.linked !== from + batch.length) throw new Error("book");
        return planSave(plan).then(step);
      });
    }
    return step();
  }

  function ensureSeal(chain, plan, note) {
    return syncBook(chain, plan, plan.linked || 0).then(function () {
      if (plan.sealStatus === "mined") return;
      if (plan.linked !== plan.chunks.length) throw new Error("chunks");
      return sendFactory(chain, plan, "sealBook", encodeSealBook(plan.book), note).then(function (rec) {
        if (!rec || rec.status !== "0x1") throw new Error("revert");
        plan.sealStatus = "mined";
        return planSave(plan);
      });
    });
  }

  function ensurePhoto(chain, plan, note) {
    var data;
    if (plan.registerStatus === "mined" && plan.plate) {
      return Promise.resolve({ skipped: true, plate: plan.plate, photoId: plan.photoId });
    }
    if (plan.registerTx) {
      return waitReceipt(chain, plan.registerTx).then(function (rec) {
        return finishRegister(plan, rec).then(function (found) {
          if (!found) throw new Error("mismatch");
          return { skipped: true, plate: found.plate, photoId: found.id, receipt: rec };
        });
      });
    }
    data = encodeAddPhoto(
      plan.name,
      plan.description,
      plan.artistName || "",
      plan.hash,
      plan.book,
      bytesOf(plan.thumb),
      plan.dev,
      plan.artistBps,
      plan.artist
    );
    return sendFactory(chain, plan, "addPhoto", data, note).then(function (rec) {
      return finishRegister(plan, rec).then(function (found) {
        if (!found) throw new Error("mismatch");
        return { skipped: false, plate: found.plate, photoId: found.id, receipt: rec };
      });
    });
  }

  // One factory call for an open-tier photograph that does not already have a book.
  function linkOnce(chain, plan, note) {
    var chunks = [];
    var i, data;
    if (plan.registerTx) {
      return waitReceipt(chain, plan.registerTx).then(function (rec) {
        return finishRegister(plan, rec).then(function (found) {
          if (!found) throw new Error("mismatch");
          return { skipped: true, plate: found.plate, photoId: found.id, receipt: rec };
        });
      });
    }
    for (i = 0; i < plan.chunks.length; i++) chunks.push(plan.chunks[i].address);
    data = encodeLinkPhoto(
      plan.name,
      plan.description,
      plan.artistName || "",
      plan.hash,
      chunks,
      bytesOf(plan.thumb),
      plan.dev,
      plan.artistBps,
      plan.artist
    );
    return sendFactory(chain, plan, "linkPhoto", data, note).then(function (rec) {
      if (!rec || rec.status !== "0x1") {
        plan.registerTx = "";
        throw new Error("revert");
      }
      if (takeBook(plan, rec)) {
        plan.linked = plan.chunks.length;
        plan.sealStatus = "mined";
      }
      return planSave(plan).then(function () {
        return finishRegister(plan, rec);
      }).then(function (found) {
        if (!found) throw new Error("mismatch");
        return { skipped: false, plate: found.plate, photoId: found.id, receipt: rec };
      });
    });
  }

  function registerPlanned(chain, plan, hooks) {
    var note = hooks || {};
    var i;
    return reconcilePlan(chain, plan).then(function () {
      for (i = 0; i < plan.chunks.length; i++) {
        if (plan.chunks[i].status !== "mined" || !plan.chunks[i].address) throw new Error("chunks");
      }
      shareBlock(plan);
      if (plan.registerStatus === "mined" && plan.plate) {
        return { skipped: true, plate: plan.plate, photoId: plan.photoId };
      }
      plan.registerStatus = "submitted";
      plan.registerError = "";
      return factoryLinksInOne(chain, plan.factory).then(function (oneCall) {
      return Promise.all([
        readAppendMax(chain, plan.factory),
        plan.wallet ? canAdd(chain, plan.factory, plan.wallet).catch(function () { return false; }) : Promise.resolve(false)
      ]).then(function (pair) {
        var max = pair[0];
        var allowed = pair[1];
        var n = plan.chunks.length;
        var started = !!(plan.book || plan.bookTx || plan.bookStatus === "mined");
        plan.appendMax = max;
        // A book that is already open keeps the four calls, so a half-finished upload can resume.
        // An older factory has no linkPhoto, so it keeps the four calls as well.
        // A nominated signer (or the owner) may link up to one addChunks batch in that same call.
        if (oneCall && n > 0 && !started && (n <= OPEN_MAX || allowed) && n <= max) {
          return linkOnce(chain, plan, note);
        }
        return ensureBook(chain, plan, note).then(function () {
          return ensureLinked(chain, plan, note);
        }).then(function () {
          return ensureSeal(chain, plan, note);
        }).then(function () {
          return ensurePhoto(chain, plan, note);
        });
      });
      });
    }).catch(function (err) {
      if (plan.registerStatus === "mined") throw err;
      plan.registerStatus = "failed";
      plan.registerError = reasonText(err, "register") || "The photograph was not registered.";
      if (err && err.message === "revert") {
        if (plan.bookStatus !== "mined") plan.bookTx = "";
        if (plan.sealStatus !== "mined") plan.sealTx = "";
        plan.linkTx = "";
        plan.registerTx = "";
      }
      return planSave(plan).then(function () { throw err; });
    });
  }

  function sniff(bytes) {
    if (!bytes || bytes.length < 3) return "";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
    return "";
  }

  function db() {
    return new Promise(function (ok, bad) {
      var req;
      if (!root.indexedDB) { bad(new Error("idb")); return; }
      req = root.indexedDB.open("onplate", 2);
      req.onupgradeneeded = function () {
        var base = req.result;
        if (!base.objectStoreNames.contains("photos")) base.createObjectStore("photos");
        if (!base.objectStoreNames.contains("plans")) base.createObjectStore("plans");
      };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { bad(req.error || new Error("idb")); };
    });
  }

  function idbGet(key) {
    return db().then(function (store) {
      return new Promise(function (ok) {
        var q = store.transaction("photos").objectStore("photos").get(key);
        q.onsuccess = function () { ok(q.result || null); };
        q.onerror = function () { ok(null); };
      });
    }).catch(function () { return null; });
  }

  function idbPut(key, value) {
    return db().then(function (store) {
      return new Promise(function (ok) {
        var q = store.transaction("photos", "readwrite").objectStore("photos").put(value, key);
        q.onsuccess = function () { ok(true); };
        q.onerror = function () { ok(false); };
      });
    }).catch(function () { return false; });
  }

  function imageKey(chain, plate) {
    return String(CHAIN_ID[chain]) + ":" + String(plate || "").toLowerCase() + ":1";
  }

  function indexKey(chain, factory) {
    return String(CHAIN_ID[chain]) + ":" + String(factory || "").toLowerCase() + ":index";
  }

  function cacheGet(chain, plate) {
    return idbGet(imageKey(chain, plate)).then(function (row) {
      if (!row || !row.bytes) return null;
      row.bytes = new Uint8Array(row.bytes);
      return row;
    });
  }

  function cachePut(chain, plate, row) {
    var copy = new Uint8Array(row.bytes.length);
    copy.set(row.bytes);
    return idbPut(imageKey(chain, plate), {
      name: row.name || "",
      description: row.description || "",
      hash: row.hash || "",
      bytes: copy.buffer
    });
  }

  function cacheIndex(chain, factory) {
    return idbGet(indexKey(chain, factory)).then(function (row) {
      return row && row.plates ? row.plates : [];
    });
  }

  function cacheRemember(chain, factory, plates) {
    return idbPut(indexKey(chain, factory), { plates: plates });
  }

  function callData(name, tail) {
    var s = sel(name);
    var data = s + (tail || "");
    if (data.slice(0, 10).toLowerCase() !== s) throw new Error("selector");
    return data;
  }

  root.OnPlate = {
    QUIET: QUIET,
    CHUNK: CHUNK,
    CONTRACT_CHUNKS: CONTRACT_CHUNKS,
    PIECE_CEILING: PIECE_CEILING,
    OPEN_MAX: OPEN_MAX,
    STORE_GROUP_MAX: STORE_GROUP_MAX,
    GAS_PER_CHUNK: GAS_PER_CHUNK,
    gasPerChunk: gasPerChunk,
    photoGate: photoGate,
    storeQuote: storeQuote,
    mainnetGasPrice: mainnetGasPrice,
    chainGasPrice: chainGasPrice,
    CHAINS: CHAINS,
    CHAIN_ID: CHAIN_ID,
    CHAIN_HEX: CHAIN_HEX,
    FACTORIES: FACTORIES,
    ready: ready,
    sel: sel,
    utf8: utf8,
    hexToBytes: hexToBytes,
    parseAddr: parseAddr,
    cleanAddressText: cleanAddressText,
    toChecksum: toChecksum,
    plain: plain,
    bpsOf: bpsOf,
    ethToWei: ethToWei,
    weiToEth: weiToEth,
    hexQty: hexQty,
    sameAddr: sameAddr,
    chainOf: chainOf,
    factoryOf: factoryOf,
    endpoints: endpoints,
    need: need,
    rpc: rpc,
    agree: agree,
    readBlock: readBlock,
    decodeBytes: decodeBytes,
    decodeString: decodeString,
    payloadOfCode: payloadOfCode,
    contentHash: contentHash,
    splitChunks: splitChunks,
    abiEncodeBytes: abiEncodeBytes,
    bytecode: bytecode,
    creationData: creationData,
    encodeCreatePieces: encodeCreatePieces,
    encodeAddPhoto: encodeAddPhoto,
    encodeLinkPhoto: encodeLinkPhoto,
    encodeOpenBook: encodeOpenBook,
    encodeAddChunks: encodeAddChunks,
    encodeSealBook: encodeSealBook,
    minedAddrs: minedAddrs,
    reassemble: reassemble,
    readFields: readFields,
    parsePlate: parsePlate,
    pinPlate: pinPlate,
    listedPair: listedPair,
    canAdd: canAdd,
    claimOf: claimOf,
    codeMatches: codeMatches,
    waitReceipt: waitReceipt,
    chunkSet: chunkSet,
    deployChunk: deployChunk,
    usePlanStore: usePlanStore,
    planGet: planGet,
    planSave: planSave,
    planDelete: planDelete,
    planAll: planAll,
    makePlan: makePlan,
    planDone: planDone,
    createAddress: createAddress,
    reconcilePlan: reconcilePlan,
    discoverChain: discoverChain,
    getLogs: getLogs,
    getLogsOn: getLogsOn,
    liveCode: liveCode,
    waitPieceCode: waitPieceCode,
    deployPlannedChunk: deployPlannedChunk,
    deployPieceBatch: deployPieceBatch,
    storePlanShape: storePlanShape,
    registerPlanned: registerPlanned,
    balanceOf: balanceOf,
    batchOf: batchOf,
    isOff: isOff,
    setOff: setOff,
    send: send,
    sniff: sniff,
    cacheGet: cacheGet,
    cachePut: cachePut,
    cacheIndex: cacheIndex,
    cacheRemember: cacheRemember,
    uploaders: uploaders,
    callData: callData,
    pad256: pad256,
    padAddr: padAddr,
    addrOf: addrOf,
    u256: u256,
    wordHex: wordHex
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
