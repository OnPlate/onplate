/* Encode art/chaise.rgb as the 48×48 grayscale PNG. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
eval(fs.readFileSync(path.join(root, "web/png.js"), "utf8"));
const buf = fs.readFileSync(path.join(root, "art/chaise.rgb"));
const w = buf.readUInt32BE(0);
const h = buf.readUInt32BE(4);
const png = OnPlatePng.thumbnail(buf.subarray(8), w, h, 48);
fs.writeFileSync(path.join(root, "art/thumb.png"), png);
console.log(w, h, png.length);
