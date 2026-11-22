/* Write the chunk creation bytecode from forge. Do not hand-copy it. */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const root = path.join(__dirname, "..");
const out = execFileSync("forge", ["inspect", "PlateChunk", "bytecode"], { cwd: root, encoding: "utf8" }).trim();
const hex = out.replace(/^0x/, "");
if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 64) throw new Error("bytecode");
fs.writeFileSync(path.join(root, "web/bytecode.js"), "globalThis.OnPlateBytecode = " + JSON.stringify(hex) + ";\n");
console.log("bytecode", hex.length / 2);
