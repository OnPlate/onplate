#!/usr/bin/env node
/* Host-side sender. The photograph stays in process memory. The keystore
 * password is typed once on a TTY. The private key never leaves this process.
 * Do not pass --password, --password-file, or a private key.
 * Run one upload at a time. Do not store from the page while this script is
 * sending, and do not start a second send. On a public chain this sender
 * reads two endpoints and keeps a value only when they agree. It refuses
 * chain id 1. On Sepolia it passes eth_estimateGas, which may be above
 * 16,777,216. On Anvil it still caps a transaction at that number. */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");


const root = path.join(__dirname, "..");
const CHUNK_MAX = 18432;
const GROUP = 4;
const TX_GAS = 16777216n;
const PROGRESS = path.join(root, "broadcast", "upload-progress.json");
const ZERO = "0x0000000000000000000000000000000000000000";
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const HALF_N = N >> 1n;


function load(file) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  (0, eval)(src);
}

load("web/keccak.js");
load("web/bytecode.js");
load("web/chain.js");

const K = globalThis.OnPlateKeccak;
const OnPlate = globalThis.OnPlate;
OnPlate.ready();

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function shQuote(text) {
  return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

function sendCommand(opts) {
  const names = ["OWNER", "SENDER", "FACTORY", "BATCH", "IMAGE", "THUMB", "NAME", "DESCRIPTION", "ARTIST_NAME", "ARTIST", "ARTIST_BPS", "CONFIRM"];
  const lines = ["cd " + shQuote(root) + " && \\"];
  let i, cmd;
  for (i = 0; i < names.length; i++) lines.push(names[i] + "=" + shQuote(env(names[i])) + " \\");
  cmd = "node script/upload-host.js --broadcast --rpc-url " + shQuote(opts.rpc);
  if (opts.keystore) cmd += " --keystore " + shQuote(path.resolve(opts.keystore));
  else if (opts.account && opts.account !== "onplate") cmd += " --account " + shQuote(opts.account);
  lines.push(cmd);
  return lines.join("\n");
}

function printTerminalStep(opts) {
  console.log("");
  console.log("The check worked. This photograph matches CONFIRM.");
  console.log("");
  console.log("One step left: send it from a new terminal window. Copy and paste the command below into the new terminal window, press Enter, then type the keystore password once. That send stores the groups and registers the photograph.");
  console.log("");
  console.log(sendCommand(opts));
}

function utf8(s) {
  return Buffer.from(String(s), "utf8");
}

function keccak(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return K.keccak256(u8);
}

function keccakHex(bytes) {
  return "0x" + K.hex(keccak(bytes));
}

function workKeyHex(chunks) {
  let body = OnPlate.pad256(32) + OnPlate.pad256(chunks.length);
  let i;
  for (i = 0; i < chunks.length; i++) body += OnPlate.padAddr(chunks[i]);
  return keccakHex(hexToBytes("0x" + body));
}

function hexToBytes(hex) {
  const out = OnPlate.hexToBytes(hex);
  if (!out) throw new Error("hex");
  return out;
}

function bytesToHex(bytes) {
  return "0x" + K.hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

function sameHash(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase() && /^0x[0-9a-f]{64}$/.test(String(a || "").toLowerCase());
}

function checksum(addr) {
  const sum = OnPlate.parseAddr(addr) || OnPlate.toChecksum(addr);
  if (!sum) throw new Error("address");
  return sum;
}

function isZero(addr) {
  return !addr || String(addr).toLowerCase() === ZERO;
}

function unixHome() {
  try {
    const info = os.userInfo();
    if (info && info.homedir) return info.homedir;
  } catch (e) {}
  const home = process.env.HOME || os.homedir();
  if (home && /^0x[0-9a-fA-F]{40}$/.test(home)) die("HOME is an Ethereum address. Unset it so the keystore can be found.");
  return home;
}

function parseArgs(argv) {
  const out = { broadcast: false, rpc: "", keystore: "", account: "onplate" };
  const rest = argv.slice(2);
  function take(flag, hasVal) {
    const i = rest.indexOf(flag);
    if (i < 0) return null;
    if (!hasVal) {
      rest.splice(i, 1);
      return true;
    }
    const v = rest[i + 1];
    if (!v || v.startsWith("-")) die("Missing value for " + flag);
    rest.splice(i, 2);
    return v;
  }
  if (take("--broadcast", false)) out.broadcast = true;
  out.rpc = take("--rpc-url", true) || process.env.RPC || "";
  out.keystore = take("--keystore", true) || "";
  const account = take("--account", true);
  if (account) out.account = account;
  const senderFlag = take("--sender", true);
  if (senderFlag) {
    if (process.env.SENDER && checksum(process.env.SENDER) !== checksum(senderFlag)) {
      die("--sender must match SENDER.");
    }
    if (!process.env.SENDER) process.env.SENDER = senderFlag;
  }
  const banned = rest.filter(function (a) { return a.startsWith("-"); });
  if (banned.length) die("Unknown flag: " + banned[0] + ". Do not pass a password or a private key.");
  if (rest.length) die("Unexpected argument: " + rest[0]);
  return out;
}

function refuseSecrets() {
  ["ETH_PASSWORD", "CAST_PASSWORD", "PRIVATE_KEY", "ETH_PRIVATE_KEY"].forEach(function (name) {
    if (process.env[name]) die("Do not put the password or a private key in an environment variable.");
  });
  process.argv.forEach(function (a) {
    if (/^--(password|password-file|private-key|unlocked|mnemonic)($|=)/.test(a)) {
      die("Do not pass " + a.split("=")[0] + ".");
    }
  });
}

function env(name) {
  const v = process.env[name];
  return v == null ? "" : String(v);
}

function envAddr(name, fallback) {
  const v = env(name);
  if (!v) return fallback || "";
  const a = OnPlate.parseAddr(v);
  if (!a) die(name + " is not an address.");
  return a;
}

function ownerFromEnv(sender) {
  if (env("OWNER")) return envAddr("OWNER");
  const home = env("HOME");
  if (home && home.length === 42 && /^0x[0-9a-fA-F]{40}$/.test(home)) return checksum(home);
  return sender;
}

function checkText(s, min, max, label) {
  if (OnPlate.plain(s, min, max) == null) die(label + " is not allowed text.");
}

function checkThumb(buf) {
  if (buf.length < 29 || buf.length > 4096) die("The thumbnail is not a valid PNG.");
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) die("The thumbnail is not a valid PNG.");
  if (buf[12] !== 0x49 || buf[13] !== 0x48 || buf[14] !== 0x44 || buf[15] !== 0x52) die("The thumbnail is not a valid PNG.");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (!((w === 48 && h === 48) || (w === 32 && h === 32))) die("The thumbnail has to be 32 or 48 pixels square.");
  if (buf[24] !== 8 || (buf[25] !== 0 && buf[25] !== 2) || buf[26] !== 0 || buf[27] !== 0 || buf[28] !== 0) {
    die("The thumbnail is not a valid PNG.");
  }
}

function readFile(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  if (!fs.existsSync(abs)) die("Missing file: " + p);
  return fs.readFileSync(abs);
}

function sliceAt(image, i) {
  const start = i * CHUNK_MAX;
  if (start >= image.length) throw new Error("piece");
  return new Uint8Array(image.subarray(start, Math.min(start + CHUNK_MAX, image.length)));
}

function concatBytes(parts) {
  let n = 0;
  for (let i = 0; i < parts.length; i++) n += parts[i].length;
  const out = new Uint8Array(n);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], at);
    at += parts[i].length;
  }
  return out;
}

function rlpLen(offset, payload) {
  const n = payload.length;
  if (n <= 55) {
    const out = new Uint8Array(1 + n);
    out[0] = offset + n;
    out.set(payload, 1);
    return out;
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const lenBytes = hexToBytes(hex);
  const out = new Uint8Array(1 + lenBytes.length + n);
  out[0] = offset + 55 + lenBytes.length;
  out.set(lenBytes, 1);
  out.set(payload, 1 + lenBytes.length);
  return out;
}

function rlpBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length === 1 && u8[0] < 0x80) return u8;
  return rlpLen(0x80, u8);
}

function rlpUint(n) {
  n = BigInt(n);
  if (n < 0n) throw new Error("rlp");
  if (n === 0n) return new Uint8Array([0x80]);
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return rlpBytes(hexToBytes(hex));
}

function rlpAddr(addr) {
  const b = hexToBytes(checksum(addr));
  if (b.length !== 20) throw new Error("address");
  return rlpBytes(b);
}

function rlpList(items) {
  return rlpLen(0xc0, concatBytes(items));
}

function mod(a, m) {
  a %= m;
  return a < 0n ? a + m : a;
}

function modInv(a, m) {
  let t = 0n;
  let newt = 1n;
  let r = m;
  let newr = mod(a, m);
  while (newr !== 0n) {
    const q = r / newr;
    const oldt = t;
    t = newt;
    newt = oldt - q * newt;
    const oldr = r;
    r = newr;
    newr = oldr - q * newr;
  }
  if (r !== 1n) throw new Error("inv");
  return t < 0n ? t + m : t;
}

function modPow(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function pointAdd(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];
  if (x1 === x2) {
    if (mod(y1 + y2, P) === 0n) return null;
    const lam = mod(3n * x1 * x1 * modInv(2n * y1, P), P);
    const x3 = mod(lam * lam - 2n * x1, P);
    const y3 = mod(lam * (x1 - x3) - y1, P);
    return [x3, y3];
  }
  const lam = mod((y2 - y1) * modInv(mod(x2 - x1, P), P), P);
  const x3 = mod(lam * lam - x1 - x2, P);
  const y3 = mod(lam * (x1 - x3) - y1, P);
  return [x3, y3];
}

function pointMul(point, k) {
  k = mod(k, N);
  let acc = null;
  let base = point;
  while (k > 0n) {
    if (k & 1n) acc = pointAdd(acc, base);
    base = pointAdd(base, base);
    k >>= 1n;
  }
  return acc;
}

function decompress(x, odd) {
  if (x >= P) return null;
  const y2 = mod(x * x * x + 7n, P);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if ((y * y) % P !== y2) return null;
  if ((y & 1n) !== BigInt(odd)) y = P - y;
  return [x, y];
}

function recoverPoint(hash, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const x = r + BigInt(recId >> 1) * N;
  const R = decompress(x, recId & 1);
  if (!R) return null;
  const z = BigInt(bytesToHex(hash)) % N;
  const rInv = modInv(r, N);
  const sR = pointMul(R, s);
  const zG = pointMul([GX, GY], z);
  const negzG = zG ? [zG[0], mod(-zG[1], P)] : null;
  return pointMul(pointAdd(sR, negzG), rInv);
}

function publicFromPriv(priv) {
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(priv);
  const pub = ecdh.getPublicKey(null, "uncompressed");
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("key");
  return pub;
}

function addressFromPub(pub) {
  const hash = keccak(pub.subarray(1));
  return checksum("0x" + K.hex(hash.subarray(12)));
}

function addressFromPriv(priv) {
  return addressFromPub(publicFromPriv(priv));
}

function recoverAddress(hash, r, s, recId) {
  const pt = recoverPoint(hash, r, s, recId);
  if (!pt) throw new Error("recover");
  const x = Buffer.from(pt[0].toString(16).padStart(64, "0"), "hex");
  const y = Buffer.from(pt[1].toString(16).padStart(64, "0"), "hex");
  if (x.length !== 32 || y.length !== 32) throw new Error("recover");
  return addressFromPub(Buffer.concat([Buffer.from([4]), x, y]));
}

function signHash(priv, hash) {
  const d = BigInt("0x" + Buffer.from(priv).toString("hex"));
  if (d === 0n || d >= N) throw new Error("key");
  const z = BigInt(bytesToHex(hash)) % N;
  const Q = pointMul([GX, GY], d);
  for (let i = 0; i < 16; i++) {
    const kBuf = crypto.randomBytes(32);
    let k = BigInt("0x" + kBuf.toString("hex"));
    kBuf.fill(0);
    k = k % N;
    if (k === 0n) continue;
    const R = pointMul([GX, GY], k);
    if (!R) continue;
    const r = R[0] % N;
    if (r === 0n) continue;
    let s = (modInv(k, N) * (z + r * d)) % N;
    if (s === 0n) continue;
    let recId = (R[1] & 1n) === 1n ? 1 : 0;
    if (R[0] >= N) recId += 2;
    if (s > HALF_N) {
      s = N - s;
      recId ^= 1;
    }
    const w = modInv(s, N);
    const X = pointAdd(pointMul([GX, GY], (z * w) % N), pointMul(Q, (r * w) % N));
    if (!X || X[0] % N !== r) throw new Error("sign");
    return { r: r, s: s, recId: recId };
  }
  throw new Error("sign");
}

function decryptKeystore(json, password) {
  if (!json || json.version !== 3 || !json.crypto) throw new Error("keystore");
  const c = json.crypto;
  if (c.cipher !== "aes-128-ctr" || c.kdf !== "scrypt") throw new Error("keystore");
  const kp = c.kdfparams || {};
  const salt = Buffer.from(kp.salt, "hex");
  const iv = Buffer.from((c.cipherparams || {}).iv, "hex");
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const macWant = Buffer.from(c.mac, "hex");
  if (!salt.length || iv.length !== 16 || ciphertext.length !== 32 || macWant.length !== 32) throw new Error("keystore");
  const n = Number(kp.n);
  const r = Number(kp.r);
  const p = Number(kp.p);
  const dklen = Number(kp.dklen);
  if (!n || !r || !p || dklen !== 32) throw new Error("keystore");
  const dk = crypto.scryptSync(utf8(password), salt, dklen, { N: n, r: r, p: p, maxmem: 64 * 1024 * 1024 });
  const mac = Buffer.from(keccak(Buffer.concat([dk.subarray(16, 32), ciphertext])));
  const ok = crypto.timingSafeEqual(mac, macWant);
  mac.fill(0);
  if (!ok) {
    dk.fill(0);
    throw new Error("password");
  }
  const decipher = crypto.createDecipheriv("aes-128-ctr", dk.subarray(0, 16), iv);
  const priv = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  dk.fill(0);
  if (priv.length !== 32) throw new Error("keystore");
  return priv;
}

function readPassword() {
  if (!process.stdin.isTTY) throw new Error("tty");
  return new Promise(function (ok) {
    const stdin = process.stdin;
    process.stderr.write("Enter keystore password: ");
    stdin.resume();
    stdin.setRawMode(true);
    let buf = "";
    function cleanup() {
      try { stdin.setRawMode(false); } catch (e) {}
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
    }
    function onData(ch) {
      const s = Buffer.from(ch).toString("utf8");
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === "\u0003") {
          cleanup();
          process.exit(1);
        }
        if (c === "\n" || c === "\r") {
          cleanup();
          ok(buf);
          return;
        }
        if (c === "\u007f" || c === "\b") {
          buf = buf.slice(0, -1);
          continue;
        }
        if (c === "\u0015") {
          buf = "";
          continue;
        }
        if (c === "\u001b") {
          i += 1;
          continue;
        }
        buf += c;
      }
    }
    stdin.on("data", onData);
  });
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
  });
  if (!res.ok) throw new Error("http");
  const msg = await res.json();
  if (!msg || msg.error || msg.result === undefined) {
    const text = msg && msg.error && msg.error.message ? String(msg.error.message) : "rpc";
    throw new Error(text);
  }
  return msg.result;
}

function chainName(id) {
  if (id === 31337) return "anvil";
  if (id === 11155111) return "sepolia";
  if (id === 1) return "mainnet";
  return "";
}

function readUrls(rpcUrl, chain) {
  const urls = [];
  function add(u) {
    const n = String(u || "").replace(/\/$/, "");
    if (!n || urls.indexOf(n) >= 0) return;
    urls.push(n);
  }
  add(rpcUrl);
  if (chain === "anvil") return urls;
  const extra = OnPlate.endpoints(chain) || [];
  extra.forEach(add);
  return urls;
}

function readNeed(chain) {
  return chain === "anvil" ? 1 : 2;
}

async function agreeRpc(urls, min, method, params) {
  const seen = [];
  let i;
  for (i = 0; i < urls.length; i++) {
    let result;
    try { result = await rpc(urls[i], method, params); }
    catch (e) { continue; }
    const key = JSON.stringify(result);
    let j;
    for (j = 0; j < seen.length; j++) {
      if (seen[j].key === key) {
        seen[j].n += 1;
        if (seen[j].n >= min) return seen[j].result;
        result = null;
        break;
      }
    }
    if (result === null) continue;
    seen.push({ key: key, n: 1, result: result });
    if (min <= 1) return result;
  }
  throw new Error("weather");
}

async function call(url, to, data) {
  const result = await rpc(url, "eth_call", [{ to: to, data: data }, "latest"]);
  if (typeof result !== "string" || result.length < 66) throw new Error("result");
  return result;
}

async function callReads(job, to, data) {
  const result = await agreeRpc(job.reads, job.readNeed, "eth_call", [{ to: to, data: data }, "latest"]);
  if (typeof result !== "string" || result.length < 66) throw new Error("result");
  return result;
}

async function getCode(url, addr) {
  return rpc(url, "eth_getCode", [addr, "latest"]);
}

async function getCodeReads(job, addr) {
  return agreeRpc(job.reads, job.readNeed, "eth_getCode", [addr, "latest"]);
}

// The sending RPC already has the receipt. Other public nodes can still
// return empty code for a few hundred milliseconds. Two of those empties
// would agree and fail the payload check.
async function waitPieceCode(job, addr, want) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    let code = "";
    try { code = await getCode(job.rpc, addr); } catch (e) {}
    if (payloadHash(code) === want) return code;
    try {
      code = await getCodeReads(job, addr);
      if (payloadHash(code) === want) return code;
    } catch (e) {}
    await new Promise(function (ok) { setTimeout(ok, 400); });
  }
  die("The deployed code did not match this piece.");
}

async function pieceMaker(job, chunk) {
  const word = await callReads(job, job.batch, OnPlate.sel("maker") + OnPlate.padAddr(chunk));
  return OnPlate.addrOf(word);
}

async function livePlate(job) {
  if (countStored(job.chunks) !== job.pieces || job.pieces === 0) return "";
  const key = workKeyHex(job.chunks);
  const word = await callReads(job, job.factory, OnPlate.sel("liveWork") + String(key).replace(/^0x/i, ""));
  const plate = OnPlate.addrOf(word);
  if (!plate || isZero(plate)) return "";
  return checksum(plate);
}

async function refuseMaker(job, chunk) {
  const who = await pieceMaker(job, chunk);
  if (!who || isZero(who)) {
    console.error(chunk);
    die("This piece has no maker. Store it through ChunkBatch. Nothing was sent.");
  }
  if (!OnPlate.sameAddr(who, job.sender)) {
    console.error(who);
    die("These pieces were stored by a different account. Nothing was sent.");
  }
  return who;
}

async function requireOwnPieces(job) {
  let i;
  for (i = 0; i < job.pieces; i++) {
    if (!job.chunks[i]) continue;
    const code = await getCodeReads(job, job.chunks[i]);
    if (!isChunkCode(code)) {
      job.chunks[i] = "";
      continue;
    }
    if (payloadHash(code) !== keccakHex(sliceAt(job.image, i))) {
      console.error(job.chunks[i]);
      die("The progress file lists a piece that does not match this photograph. Nothing was sent.");
    }
    await refuseMaker(job, job.chunks[i]);
  }
}

function codeHas(code, sel) {
  const marker = String(sel || "").toLowerCase().replace(/^0x/, "");
  return marker.length === 8 && String(code || "").toLowerCase().indexOf(marker) !== -1;
}

function isChunkCode(code) {
  const raw = String(code || "").toLowerCase().replace(/^0x/, "");
  return raw.length > 2 && raw.slice(0, 2) === "00";
}

function payloadHash(code) {
  const raw = String(code || "").toLowerCase().replace(/^0x/, "");
  if (raw.length < 4 || raw.slice(0, 2) !== "00") return "";
  return keccakHex(hexToBytes("0x" + raw.slice(2)));
}

async function waitReceipt(url, hash) {
  for (let i = 0; i < 600; i++) {
    const rec = await rpc(url, "eth_getTransactionReceipt", [hash]);
    if (rec) return rec;
    await new Promise(function (ok) { setTimeout(ok, 200); });
  }
  throw new Error("receipt");
}

function signLegacy(priv, tx) {
  const unsigned = rlpList([
    rlpUint(tx.nonce),
    rlpUint(tx.gasPrice),
    rlpUint(tx.gas),
    rlpAddr(tx.to),
    rlpUint(0),
    rlpBytes(hexToBytes(tx.data)),
    rlpUint(tx.chainId),
    rlpUint(0),
    rlpUint(0)
  ]);
  const hash = keccak(unsigned);
  const sig = signHash(priv, hash);
  const v = BigInt(tx.chainId) * 2n + 35n + BigInt(sig.recId);
  const raw = rlpList([
    rlpUint(tx.nonce),
    rlpUint(tx.gasPrice),
    rlpUint(tx.gas),
    rlpAddr(tx.to),
    rlpUint(0),
    rlpBytes(hexToBytes(tx.data)),
    rlpUint(v),
    rlpUint(sig.r),
    rlpUint(sig.s)
  ]);
  return bytesToHex(raw);
}

function pieceTopic() {
  return keccakHex(utf8("PieceCreated(address,uint256,address)"));
}

function bookTopic() {
  return keccakHex(utf8("BookOpened(address,address,uint256)"));
}

function photoTopic() {
  return keccakHex(utf8("PhotoAdded(uint256,address,address)"));
}

function countStored(chunks) {
  let n = 0;
  for (let i = 0; i < chunks.length; i++) if (chunks[i] && !isZero(chunks[i])) n += 1;
  return n;
}

function saveProgress(job) {
  fs.mkdirSync(path.dirname(PROGRESS), { recursive: true });
  const stored = job.chunks.map(function (a) { return a && !isZero(a) ? checksum(a) : ZERO; });
  const body = JSON.stringify({
    hash: job.hash,
    factory: job.factory,
    sender: job.sender,
    home: job.home,
    batch: job.batch,
    book: job.book && !isZero(job.book) ? checksum(job.book) : ZERO,
    plate: job.plate && !isZero(job.plate) ? checksum(job.plate) : ZERO,
    chunks: stored
  }) + "\n";
  fs.writeFileSync(PROGRESS, body);
}

function loadProgress(job) {
  job.chunks = new Array(job.pieces).fill("");
  job.book = "";
  job.plate = "";
  if (!fs.existsSync(PROGRESS)) return;
  let json;
  try { json = JSON.parse(fs.readFileSync(PROGRESS, "utf8")); }
  catch (e) { die("broadcast/upload-progress.json is not JSON. Move that file aside. Nothing was sent."); }
  const hash = String(json.hash || "").toLowerCase();
  const home = json.home ? checksum(json.home) : job.sender;
  if (
    hash !== job.hash.toLowerCase()
    || !OnPlate.sameAddr(json.factory, job.factory)
    || !OnPlate.sameAddr(json.sender, job.sender)
    || !OnPlate.sameAddr(json.batch, job.batch)
    || !OnPlate.sameAddr(home, job.home)
  ) {
    die("broadcast/upload-progress.json is for a different photograph or a different OWNER. Move that file aside. Nothing was sent.");
  }
  const stored = Array.isArray(json.chunks) ? json.chunks : [];
  if (stored.length > job.pieces) die("progress");
  job.book = json.book && !isZero(json.book) ? checksum(json.book) : "";
  job.plate = json.plate && !isZero(json.plate) ? checksum(json.plate) : "";
  for (let i = 0; i < stored.length; i++) {
    if (!stored[i] || isZero(stored[i])) continue;
    job.chunks[i] = checksum(stored[i]);
  }
}

async function dropMissing(job) {
  let skipped = false;
  for (let i = 0; i < job.chunks.length; i++) {
    if (!job.chunks[i]) continue;
    const code = await getCodeReads(job, job.chunks[i]);
    if (!isChunkCode(code)) {
      skipped = true;
      job.chunks[i] = "";
      continue;
    }
    const got = payloadHash(code);
    const want = keccakHex(sliceAt(job.image, i));
    if (got !== want) {
      console.error(job.chunks[i]);
      die("The progress file lists a piece that does not match this photograph. Nothing was sent.");
    }
    await refuseMaker(job, job.chunks[i]);
  }
  if (job.book) {
    const code = await getCodeReads(job, job.book);
    if (!code || code === "0x") {
      console.log("The progress file names a book that was never mined. A new book will be opened.");
      job.book = "";
    }
  }
  if (job.plate) {
    const code = await getCodeReads(job, job.plate);
    if (!code || code === "0x") {
      console.log("The progress file names a plate that was never mined. It will be registered again.");
      job.plate = "";
    }
  }
  if (skipped) console.log("A progress entry was never mined. That piece will be stored again.");
}

async function adopt(job) {
  const want = [];
  const taken = [];
  for (let i = 0; i < job.pieces; i++) {
    want.push(keccakHex(sliceAt(job.image, i)));
    taken.push(false);
    if (!job.chunks[i]) continue;
    const code = await getCodeReads(job, job.chunks[i]);
    if (payloadHash(code) !== want[i]) {
      console.error(job.chunks[i]);
      die("The progress file lists a piece that does not match this photograph. Nothing was sent.");
    }
    taken[i] = true;
  }
  const logs = await OnPlate.getLogsOn(job.rpc, chainName(job.chainId), job.batch, [pieceTopic()]);
  let foreign = "";
  for (let n = 0; n < logs.length; n++) {
    const log = logs[n];
    if (!log.topics || log.topics.length < 4) continue;
    const payer = OnPlate.addrOf(log.topics[1]);
    const chunk = OnPlate.addrOf(log.topics[3]);
    if (!payer || !chunk) continue;
    const got = payloadHash(await getCodeReads(job, chunk));
    if (OnPlate.sameAddr(payer, job.sender)) {
      const who = await pieceMaker(job, chunk);
      if (!who || isZero(who) || !OnPlate.sameAddr(who, job.sender)) continue;
      for (let i = 0; i < want.length; i++) {
        if (taken[i] || want[i] !== got) continue;
        job.chunks[i] = chunk;
        taken[i] = true;
        break;
      }
    }
  }
  for (let n = 0; n < logs.length; n++) {
    const log = logs[n];
    if (!log.topics || log.topics.length < 4) continue;
    const payer = OnPlate.addrOf(log.topics[1]);
    if (!payer || OnPlate.sameAddr(payer, job.sender)) continue;
    const chunk = OnPlate.addrOf(log.topics[3]);
    const got = payloadHash(await getCodeReads(job, chunk));
    for (let i = 0; i < want.length; i++) {
      if (!taken[i] && want[i] === got) {
        foreign = payer;
        break;
      }
    }
  }
  if (foreign) {
    for (let i = 0; i < job.pieces; i++) {
      if (!taken[i]) {
        console.error(foreign);
        die("These pieces were stored by a different account. Nothing was sent.");
      }
    }
  }
}

function takePieces(rec, job, start, k) {
  const topic = pieceTopic();
  const found = [];
  const logs = rec && rec.logs || [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (!log.topics || log.topics.length < 4) continue;
    if (String(log.topics[0]).toLowerCase() !== topic) continue;
    if (!OnPlate.sameAddr(log.address, job.batch)) continue;
    const payer = OnPlate.addrOf(log.topics[1]);
    const which = Number(OnPlate.u256(log.topics[2]));
    const chunk = OnPlate.addrOf(log.topics[3]);
    if (!OnPlate.sameAddr(payer, job.sender) || !chunk) continue;
    found.push({ which: which, address: chunk });
  }
  found.sort(function (a, b) { return a.which - b.which; });
  let accepted = 0;
  for (let i = 0; i < found.length && i < k; i++) {
    if (found[i].which !== i) break;
    job.chunks[start + i] = found[i].address;
    accepted += 1;
  }
  return accepted;
}

function takeBook(rec, job) {
  const topic = bookTopic();
  const logs = rec && rec.logs || [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (!log.topics || log.topics.length < 3) continue;
    if (String(log.topics[0]).toLowerCase() !== topic) continue;
    if (!OnPlate.sameAddr(log.address, job.factory)) continue;
    const book = OnPlate.addrOf(log.topics[1]);
    const artist = OnPlate.addrOf(log.topics[2]);
    const count = Number(OnPlate.u256(log.data));
    if (book && OnPlate.sameAddr(artist, job.home) && count === job.pieces) return book;
  }
  return "";
}

function takePlate(rec, job) {
  const topic = photoTopic();
  const logs = rec && rec.logs || [];
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (!log.topics || log.topics.length < 3) continue;
    if (String(log.topics[0]).toLowerCase() !== topic) continue;
    if (!OnPlate.sameAddr(log.address, job.factory)) continue;
    const plate = OnPlate.addrOf(log.topics[2]);
    if (plate) return plate;
  }
  return "";
}

async function loadJob(opts) {
  const sender = envAddr("SENDER");
  const factory = envAddr("FACTORY");
  const batch = envAddr("BATCH");
  const name = env("NAME");
  const description = env("DESCRIPTION");
  const artistName = env("ARTIST_NAME");
  const imagePath = env("IMAGE");
  const thumbPath = env("THUMB");
  if (!sender || !factory || !batch) die("Set SENDER, FACTORY, and BATCH.");
  if (!opts.rpc) die("Pass --rpc-url.");
  if (!imagePath) die("Set IMAGE.");
  if (!thumbPath) die("Set THUMB.");
  checkText(name, 1, 48, "NAME");
  checkText(description, 0, 240, "DESCRIPTION");
  checkText(artistName, 0, 48, "ARTIST_NAME");
  const image = readFile(imagePath);
  const thumb = readFile(thumbPath);
  if (!image.length) die("image");
  checkThumb(thumb);
  const chainId = Number(OnPlate.u256(await rpc(opts.rpc, "eth_chainId", [])));
  if (chainId === 1) die("This sender refuses mainnet.");
  const chain = chainName(chainId);
  if (!chain) die("chain");
  const reads = readUrls(opts.rpc, chain);
  const need = readNeed(chain);
  if (need > 1 && reads.length < 2) die("This chain needs two RPC URLs.");
  const jobReads = { reads: reads, readNeed: need, rpc: opts.rpc, factory: factory, batch: batch };
  const factoryCode = await getCodeReads(jobReads, factory);
  const batchCode = await getCodeReads(jobReads, batch);
  if (!factoryCode || factoryCode === "0x" || !batchCode || batchCode === "0x") die("address");
  const devBps = Number(OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("devBps"))));
  const defaultArtist = Number(OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("defaultArtistBps"))));
  const maxChunks = Number(OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("maxChunks"))));
  const openMax = Number(OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("openMax"))));
  const appendMax = Number(OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("appendMax"))));
  const canAdd = OnPlate.u256(await callReads(jobReads, factory, OnPlate.sel("canAdd") + OnPlate.padAddr(sender))) !== 0n;
  let artistBps = env("ARTIST_BPS") === "" ? defaultArtist : Number(env("ARTIST_BPS"));
  if (!Number.isInteger(artistBps) || artistBps < 0 || artistBps > 10000 || devBps + artistBps > 10000) die("royalty");
  const artist = env("ARTIST") ? envAddr("ARTIST") : sender;
  if (artistBps > 0 && (!artist || isZero(artist))) die("recipient");
  if (OnPlate.sameAddr(artist, factory)) die("recipient");
  const home = ownerFromEnv(sender) || sender;
  if (isZero(home)) die("home");
  if (OnPlate.sameAddr(home, factory)) {
    console.log("OWNER cannot be the factory. Nothing was sent.");
    die("home");
  }
  const hash = keccakHex(image);
  const pieces = Math.ceil(image.length / CHUNK_MAX);
  if (!pieces || pieces > maxChunks) die("pieces");
  if (!canAdd && pieces > openMax) {
    console.log("pieces", pieces);
    console.log("A photograph larger than the open tier needs a nomination. Nothing was sent.");
    die("open");
  }
  if (!OnPlate.sameAddr(home, sender)) {
    const need = pieces <= openMax ? OnPlate.sel("linkPhotoHome") : OnPlate.sel("openBookHome");
    if (!codeHas(factoryCode, need)) {
      console.log("This factory cannot give the photograph to OWNER. Nothing was sent.");
      die("home");
    }
  }
  console.log("content hash", hash);
  console.log("pieces", pieces);
  console.log("factory", factory);
  console.log("batch", batch);
  console.log("sender", sender);
  console.log("owner", home);
  if (!OnPlate.sameAddr(home, sender)) console.log("The keystore signs. The photograph will be owned by OWNER.");
  console.log("name", name);
  console.log("artist", artist);
  console.log("chain", chainId);
  if (need > 1) console.log("rpc reads", reads.length);
  console.log("Check this script against the git commit you cloned. A hash printed beside a download is not a check.");
  const confirm = env("CONFIRM");
  if (!confirm) {
    console.log("Set CONFIRM to the content hash above and run again with --broadcast. Nothing was sent.");
    die("CONFIRM");
  }
  if (!sameHash(confirm, hash)) {
    console.log("CONFIRM does not match this photograph. Nothing was sent.");
    die("CONFIRM");
  }
  return {
    sender: sender,
    home: home,
    factory: factory,
    batch: batch,
    artist: artist,
    hash: hash,
    pieces: pieces,
    devBps: devBps,
    artistBps: artistBps,
    name: name,
    description: description,
    artistName: artistName,
    image: image,
    thumb: new Uint8Array(thumb),
    chunks: [],
    book: "",
    plate: "",
    openMax: openMax,
    appendMax: appendMax,
    canAdd: canAdd,
    factoryCode: factoryCode,
    chainId: chainId,
    rpc: opts.rpc,
    reads: reads,
    readNeed: need
  };
}

async function sendTx(job, priv, to, data, gas) {
  const nonceHex = await rpc(job.rpc, "eth_getTransactionCount", [job.sender, "latest"]);
  const nonce = Number(OnPlate.u256(nonceHex));
  const gasPrice = OnPlate.u256(await rpc(job.rpc, "eth_gasPrice", []));
  const raw = signLegacy(priv, {
    nonce: nonce,
    gasPrice: gasPrice,
    gas: gas,
    to: to,
    data: data,
    chainId: job.chainId
  });
  const hash = await rpc(job.rpc, "eth_sendRawTransaction", [raw]);
  console.log("tx", hash);
  const rec = await waitReceipt(job.rpc, hash);
  if (!rec || rec.status !== "0x1") die("The transaction reverted.");
  return rec;
}

async function estimateGas(job, to, data) {
  const hex = await rpc(job.rpc, "eth_estimateGas", [{ from: job.sender, to: to, data: data, value: "0x0" }]);
  let gas = OnPlate.u256(hex);
  gas += gas / 64n;
  if (gas < 21000n) throw new Error("gas");
  if (job.chainId === 11155111) {
    const block = await rpc(job.rpc, "eth_getBlockByNumber", ["latest", false]);
    const cap = OnPlate.u256(block && block.gasLimit);
    if (!cap || gas > cap) gas = cap;
    if (gas < 21000n) throw new Error("gas");
    return gas;
  }
  if (gas > TX_GAS) gas = TX_GAS;
  return gas;
}

async function storeGroups(job, priv) {
  for (let i = 0; i < job.pieces; ) {
    if (job.chunks[i]) {
      i += 1;
      continue;
    }
    let k = 0;
    while (i + k < job.pieces && !job.chunks[i + k] && k < GROUP) k += 1;
    let rec = null;
    let accepted = 0;
    while (k >= 1 && !rec) {
      const inits = [];
      for (let j = 0; j < k; j++) inits.push(OnPlate.creationData(sliceAt(job.image, i + j)));
      const data = OnPlate.encodeCreatePieces(inits);
      let gas;
      try {
        gas = await estimateGas(job, job.batch, data);
      } catch (e) {
        k -= 1;
        continue;
      }
      rec = await sendTx(job, priv, job.batch, data, gas);
      accepted = takePieces(rec, job, i, k);
    }
    if (!rec) die("This group did not fit one transaction.");
    for (let j = 0; j < accepted; j++) {
      const want = keccakHex(sliceAt(job.image, i + j));
      await waitPieceCode(job, job.chunks[i + j], want);
    }
    saveProgress(job);
    console.log("stored", countStored(job.chunks));
    console.log("pieces", job.pieces);
    if (accepted !== k) {
      console.log("A group stored fewer pieces than it was given. Run the same command again to continue. The photograph was not registered.");
      die("short");
    }
    i += k;
  }
  return true;
}

async function link(job, priv) {
  await requireOwnPieces(job);
  if (countStored(job.chunks) !== job.pieces) die("pieces");
  {
    const live = await livePlate(job);
    if (live) {
      job.plate = live;
      saveProgress(job);
      console.log("This photograph is already registered.");
      console.log(live);
      return;
    }
  }
  const useHome = !OnPlate.sameAddr(job.home, job.sender);
  const hasLink = codeHas(job.factoryCode, OnPlate.sel("linkPhoto"));
  if (
    !job.book
    && job.pieces > 0
    && hasLink
    && job.pieces <= job.appendMax
    && (job.pieces <= job.openMax || job.canAdd)
  ) {
    const chunks = job.chunks.slice();
    const data = useHome
      ? OnPlate.encodeLinkPhoto(job.name, job.description, job.artistName, job.hash, chunks, job.thumb, job.devBps, job.artistBps, job.artist, job.home)
      : OnPlate.encodeLinkPhoto(job.name, job.description, job.artistName, job.hash, chunks, job.thumb, job.devBps, job.artistBps, job.artist);
    const rec = await sendTx(job, priv, job.factory, data, await estimateGas(job, job.factory, data));
    const plate = takePlate(rec, job);
    if (!plate) die("plate");
    job.plate = plate;
    const book = takeBook(rec, job);
    if (book) job.book = book;
    saveProgress(job);
    return;
  }
  if (!job.book) {
    const data = useHome ? OnPlate.encodeOpenBook(job.pieces, job.home) : OnPlate.encodeOpenBook(job.pieces);
    const rec = await sendTx(job, priv, job.factory, data, await estimateGas(job, job.factory, data));
    const book = takeBook(rec, job);
    if (!book) die("book");
    job.book = book;
    saveProgress(job);
    console.log("book", job.book);
  }
  const artist = OnPlate.addrOf(await callReads(job, job.book, OnPlate.sel("artist")));
  const expected = Number(OnPlate.u256(await callReads(job, job.book, OnPlate.sel("expected"))));
  if (!OnPlate.sameAddr(artist, job.home) || expected !== job.pieces) die("book");
  const used = OnPlate.u256(await callReads(job, job.book, OnPlate.sel("used"))) !== 0n;
  if (used) {
    die("This chunk book was already used. The progress file has no plate. Nothing further was sent.");
  }
  let linked = Number(OnPlate.u256(await callReads(job, job.book, OnPlate.sel("chunkCount"))));
  const append = job.appendMax;
  if (!append || append > 80 || linked > job.pieces) die("append");
  while (linked < job.pieces) {
    let n = job.pieces - linked;
    if (n > append) n = append;
    const group = job.chunks.slice(linked, linked + n);
    const data = OnPlate.encodeAddChunks(job.book, group);
    await sendTx(job, priv, job.factory, data, await estimateGas(job, job.factory, data));
    const now = Number(OnPlate.u256(await callReads(job, job.book, OnPlate.sel("chunkCount"))));
    if (now !== linked + n) die("book");
    linked = now;
  }
  const locked = OnPlate.u256(await callReads(job, job.book, OnPlate.sel("locked"))) !== 0n;
  if (!locked) {
    const data = OnPlate.encodeSealBook(job.book);
    await sendTx(job, priv, job.factory, data, await estimateGas(job, job.factory, data));
  }
  const data = OnPlate.encodeAddPhoto(
    job.name,
    job.description,
    job.artistName,
    job.hash,
    job.book,
    job.thumb,
    job.devBps,
    job.artistBps,
    job.artist
  );
  const rec = await sendTx(job, priv, job.factory, data, await estimateGas(job, job.factory, data));
  const plate = takePlate(rec, job);
  if (!plate) die("plate");
  job.plate = plate;
  saveProgress(job);
}

async function sendAll(job, opts) {
  loadProgress(job);
  await dropMissing(job);
  await adopt(job);
  await requireOwnPieces(job);
  console.log("pieces already on-chain", countStored(job.chunks));
  if (job.book) console.log("book", job.book);
  if (job.plate) {
    const code = await getCodeReads(job, job.plate);
    if (!code || code === "0x") {
      console.log("The progress file names a plate that was never mined. It will be registered again.");
      job.plate = "";
    } else {
      console.log("This photograph is already registered.");
      console.log(job.plate);
      return;
    }
  }
  {
    const live = await livePlate(job);
    if (live) {
      job.plate = live;
      saveProgress(job);
      console.log("This photograph is already registered.");
      console.log(live);
      return;
    }
  }
  const keystorePath = opts.keystore
    ? path.resolve(opts.keystore)
    : path.join(unixHome(), ".foundry", "keystores", opts.account || "onplate");
  if (!fs.existsSync(keystorePath)) die("Missing keystore: " + keystorePath);
  const json = JSON.parse(fs.readFileSync(keystorePath, "utf8"));
  if (!process.stdin.isTTY) {
    printTerminalStep(opts);
    return;
  }
  const password = await readPassword();
  console.log("Unlocking keystore...");
  let priv;
  try { priv = decryptKeystore(json, password); }
  catch (e) {
    if (e && e.message === "password") die("Wrong keystore password. Nothing was sent.");
    die("The keystore could not be unlocked. Nothing was sent.");
  }
  try {
    const addr = addressFromPriv(priv);
    if (!OnPlate.sameAddr(addr, job.sender)) {
      console.log("This keystore is", addr);
      console.log("SENDER is", job.sender);
      die("SENDER must be the onplate keystore address. Nothing was sent.");
    }
    console.log("Keystore unlocked.");
    await storeGroups(job, priv);
    await link(job, priv);
  } finally {
    if (priv) priv.fill(0);
  }
  if (job.plate) {
    console.log("Registered.");
    console.log(job.plate);
  }
}

async function main() {
  refuseSecrets();
  process.chdir(root);
  const opts = parseArgs(process.argv);
  const job = await loadJob(opts);
  if (!opts.broadcast) {
    console.log("Check finished. Pass --broadcast to send.");
    return;
  }
  await sendAll(job, opts);
}

if (require.main === module) {
  main().catch(function (err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg === "cancel") die("Stopped.");
    die(msg);
  });
}

module.exports = {
  decryptKeystore: decryptKeystore,
  signHash: signHash,
  addressFromPriv: addressFromPriv,
  recoverAddress: recoverAddress,
  signLegacy: signLegacy,
  keccakHex: keccakHex,
  workKeyHex: workKeyHex
};
