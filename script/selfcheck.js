/* Local checks for the hash, the thumbnail, the calldata, and the fallback page. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const root = path.join(__dirname, "..");

function die(msg) {
  console.error(msg);
  process.exit(1);
}
function cast(args) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim();
}
function load(file) {
  eval(fs.readFileSync(path.join(root, file), "utf8"));
}

load("web/keccak.js");
load("web/png.js");
execFileSync("node", ["script/bytecode.js"], { cwd: root });
load("web/bytecode.js");
load("web/chain.js");

const empty = OnPlateKeccak.hex(OnPlateKeccak.keccak256(new Uint8Array()));
const abc = OnPlateKeccak.hex(OnPlateKeccak.keccak256(new TextEncoder().encode("abc")));
if (empty !== "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470") die("empty");
if (abc !== "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45") die("abc");
if (cast(["keccak", "0x"]) !== "0x" + empty) die("cast empty");
if (cast(["keccak", "0x616263"]) !== "0x" + abc) die("cast abc");
OnPlate.ready();
console.log("keccak");

const sum = OnPlate.toChecksum("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
if (sum !== cast(["to-check-sum-address", "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"])) die("checksum");
if (OnPlate.parseAddr("0x0000000000000000000000000000000000000001") === null) die("parse");
if (OnPlate.parseAddr("0x000000000000000000000000000000000000000G") !== null) die("parse bad");
console.log("address");

const host = require(path.join(__dirname, "upload-host.js"));
const priv = Buffer.from("01".padStart(64, "0"), "hex");
const signer = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
if (host.addressFromPriv(priv) !== signer) die("signer address");
{
  const digest = Buffer.from(empty, "hex");
  const sig = host.signHash(priv, digest);
  const halfN = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
  if (digest.length !== 32) die("signer hash");
  if (sig.s > halfN) die("signer low-s");
  if (host.recoverAddress(digest, sig.r, sig.s, sig.recId) !== signer) die("signer recover");
}
if (host.workKeyHex(["0x1111111111111111111111111111111111111111"]) !== "0xf745c1855f76abd5bd5ab1bc927552e903c8a2043b66155df33e5622c61ca9c4") {
  die("workKey");
}
priv.fill(0);
console.log("signer");

if (OnPlate.bpsOf("4.5") !== 450) die("bps");
if (OnPlate.bpsOf("4.50") !== 450) die("bps");
if (OnPlate.bpsOf("0") !== 0) die("bps");
if (OnPlate.bpsOf("100") !== 10000) die("bps");
if (OnPlate.bpsOf("10.5") !== 1050) die("bps");
if (OnPlate.bpsOf("100.01") !== null) die("bps");
if (OnPlate.ethToWei("1") !== 10n ** 18n) die("wei");
if (OnPlate.ethToWei("0") !== null) die("wei");
if (OnPlate.plain('say "hi"', 1, 48) !== null) die("plain");
if (OnPlate.plain("Chaise", 1, 48) !== "Chaise") die("plain");
console.log("terms");

const hash = "0x" + "ab".repeat(32);
const thumb = new Uint8Array([1, 2, 3]);
const built = OnPlate.encodeAddPhoto(
  "Chaise",
  "A photograph.",
  "Ada",
  hash,
  "0x1111111111111111111111111111111111111111",
  thumb,
  450,
  1000,
  "0x2222222222222222222222222222222222222222"
);
const fromCast = cast([
  "calldata",
  "addPhoto(string,string,string,bytes32,address,bytes,uint16,uint16,address)",
  "Chaise",
  "A photograph.",
  "Ada",
  hash,
  "0x1111111111111111111111111111111111111111",
  "0x010203",
  "450",
  "1000",
  "0x2222222222222222222222222222222222222222"
]);
if (built.toLowerCase() !== fromCast.toLowerCase()) die("calldata\n" + built + "\n" + fromCast);
const arg = OnPlate.abiEncodeBytes(thumb);
const argCast = cast(["abi-encode", "f(bytes)", "0x010203"]).replace(/^0x/, "");
if (arg !== argCast) die("abi bytes");
const creation = OnPlate.creationData(thumb);
if (creation.indexOf(OnPlate.bytecode()) !== 0) die("creation");
console.log("abi");

const png = fs.readFileSync(path.join(root, "art/thumb.png"));
if (png.length > 4096 || png[0] !== 0x89 || png[25] !== 0) die("png header");
if (png.readUInt32BE(16) !== 48 || png.readUInt32BE(20) !== 48 || png[24] !== 8) die("png size");
execFileSync("python3", ["script/thumb.py", "art/chaise.jpg", "art/chaise.rgb"], { cwd: root });
execFileSync("node", ["script/make-thumb.js"], { cwd: root });
const again = fs.readFileSync(path.join(root, "art/thumb.png"));
if (Buffer.compare(png, again) !== 0) die("thumb drift");
execFileSync("python3", ["-c", "from PIL import Image; im=Image.open('art/thumb.png'); assert im.size==(48,48) and im.mode=='L'"], { cwd: root });
console.log("thumb");

const inspected = execFileSync("forge", ["inspect", "PlateChunk", "bytecode"], { cwd: root, encoding: "utf8" }).trim().replace(/^0x/, "");
if (OnPlate.bytecode().replace(/^0x/, "") !== inspected) die("bytecode");
console.log("bytecode");

execFileSync("node", ["script/build-fallback.js", "--chain", "anvil", "--factory", sum], { cwd: root });
const page = fs.readFileSync(path.join(root, "web/page.html"));
if (page.length > 18432) die("page size " + page.length);
const text = page.toString("utf8");
if (!text.includes(sum)) die("page factory");
if (text.includes("eth_sendTransaction") || text.includes("eth_sign") || text.includes("innerHTML")) die("page write");
if (!text.startsWith("<!DOCTYPE html>")) die("doctype");
console.log("page", page.length);
console.log("selfcheck ok");
