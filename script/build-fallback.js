/* Inline the fallback page. The result has to fit in one chunk. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error("missing " + name);
  return process.argv[i + 1];
}

eval(fs.readFileSync(path.join(root, "web/keccak.js"), "utf8"));

function checksum(addr) {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  const hash = OnPlateKeccak.hex(OnPlateKeccak.keccak256(new TextEncoder().encode(hex)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  return out;
}

const chain = arg("--chain");
const factory = checksum(arg("--factory"));
if (!/^(anvil|sepolia|mainnet)$/.test(chain)) throw new Error("chain");
if (!/^0x[0-9a-fA-F]{40}$/.test(factory)) throw new Error("factory");

// Leading spaces are dropped so the one on-chain file stays under 18,432 bytes.
function tighten(code) {
  return code.split("\n").map(function (line) {
    return line.replace(/^[ \t]+/, "");
  }).filter(function (line) {
    return line.trim() !== "";
  }).join("\n");
}

let page = fs.readFileSync(path.join(root, "web/fallback-shell.html"), "utf8");
const keccak = tighten(fs.readFileSync(path.join(root, "web/keccak.js"), "utf8"));
const app = tighten(fs.readFileSync(path.join(root, "web/fall.js"), "utf8"));
if (page.indexOf("__KECCAK__") < 0 || page.indexOf("__APP__") < 0) throw new Error("shell");
page = page.replace("__KECCAK__", keccak).replace("__APP__", app);
page = page.replaceAll("__CHAIN__", chain).replaceAll("__FACTORY__", factory);
if (page.includes("__")) throw new Error("placeholder");
if ((keccak + app).toLowerCase().includes("</script")) throw new Error("script");
if (Buffer.byteLength(page, "utf8") > 18432) {
  throw new Error("page bytes " + Buffer.byteLength(page, "utf8"));
}
fs.writeFileSync(path.join(root, "web/page.html"), page);
console.log("page", Buffer.byteLength(page, "utf8"), factory);
