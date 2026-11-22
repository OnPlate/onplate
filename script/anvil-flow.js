/* The chaise photograph, through the same encoding the page uses. */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const RPC = "http://127.0.0.1:8545";

function die(msg) {
  console.error(msg);
  process.exit(1);
}
function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) die("missing " + name);
  return process.argv[i + 1];
}
function load(file) {
  eval(fs.readFileSync(path.join(root, file), "utf8"));
}

load("web/keccak.js");
load("web/png.js");
load("web/bytecode.js");
load("web/chain.js");
OnPlate.ready();

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ARTIST = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BUYER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const VAULT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const PAYEE = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const PRIVATE = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const OTHER = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
const factory = OnPlate.parseAddr(arg("--factory"));
if (!factory) die("factory");

let current = ARTIST;
globalThis.ethereum = {
  request: function (req) {
    if (req.method === "eth_chainId") return Promise.resolve("0x7a69");
    if (req.method === "eth_accounts" || req.method === "eth_requestAccounts") return Promise.resolve([current]);
    if (req.method === "wallet_switchEthereumChain" || req.method === "wallet_addEthereumChain") return Promise.resolve(null);
    if (req.method === "eth_sendTransaction") {
      return fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendTransaction", params: req.params })
      }).then(function (res) { return res.json(); }).then(function (msg) {
        if (!msg || msg.error || typeof msg.result !== "string") {
          throw new Error(msg && msg.error ? msg.error.message : "send");
        }
        return msg.result;
      });
    }
    return Promise.reject(new Error(req.method));
  }
};

function filePlanStore(file) {
  function read() {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { return {}; }
  }
  function write(all) {
    fs.writeFileSync(file, JSON.stringify(all));
  }
  return {
    get: function (key) {
      const all = read();
      return all[String(key || "").toLowerCase()] || null;
    },
    put: function (plan) {
      const all = read();
      all[String(plan.hash).toLowerCase()] = JSON.parse(JSON.stringify(plan));
      write(all);
    },
    del: function (key) {
      const all = read();
      delete all[String(key || "").toLowerCase()];
      write(all);
    },
    all: function () { return Object.values(read()); }
  };
}

function rpc(method, params) {
  return fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
  }).then(function (res) { return res.json(); });
}

async function expectRevert(tx) {
  const msg = await rpc("eth_call", [tx, "latest"]);
  if (!msg.error) die("expected revert");
}

async function send(from, fields) {
  current = from;
  const hash = await OnPlate.send("anvil", Object.assign({ from: from }, fields));
  const rec = await OnPlate.waitReceipt("anvil", hash);
  console.log(fields.kind, rec.gasUsed);
  return rec;
}

async function main() {
  const file = fs.readFileSync(path.join(root, "art/chaise.jpg"));
  const rgb = fs.readFileSync(path.join(root, "art/chaise.rgb"));
  const thumb = fs.readFileSync(path.join(root, "art/thumb.png"));
  const w = rgb.readUInt32BE(0);
  const h = rgb.readUInt32BE(4);
  const made = OnPlatePng.thumbnail(rgb.subarray(8), w, h, 48);
  if (Buffer.compare(made, thumb) !== 0) die("thumb");
  const chunks = OnPlate.splitChunks(file);
  if (file.length !== 221081 || chunks.length !== 12) die("chunks " + chunks.length);
  const hash = OnPlate.contentHash(file);
  console.log("hash", hash);

  const devBps = OnPlate.u256(await OnPlate.agree("anvil", factory, OnPlate.sel("devBps")));
  const artistBps = OnPlate.u256(await OnPlate.agree("anvil", factory, OnPlate.sel("defaultArtistBps")));
  OnPlate.usePlanStore(filePlanStore(path.join(root, "script", "anvil-plan.json")));
  let plan = await OnPlate.planGet(hash);
  const samePlan = plan && plan.chain === "anvil" && OnPlate.sameAddr(plan.wallet, ARTIST) && OnPlate.sameAddr(plan.factory, factory);
  if (!samePlan) {
    const count = OnPlate.u256(await OnPlate.agree("anvil", factory, OnPlate.sel("photoCount")));
    plan = OnPlate.makePlan({
      hash: hash,
      chain: "anvil",
      factory: factory,
      wallet: ARTIST,
      name: "Chaise",
      description: "A photograph.",
      dev: Number(devBps),
      artistBps: Number(artistBps),
      artist: PAYEE,
      thumb: thumb,
      chunks: chunks,
      expectedPhotoId: (count + 1n).toString()
    });
    await OnPlate.planSave(plan);
    console.log("plan saved", plan.hash, "photo", plan.expectedPhotoId);
  } else {
    console.log("plan resume", plan.hash, "photo", plan.expectedPhotoId || "");
  }
  current = ARTIST;
  if (!OnPlate.planDone(plan)) {
    for (let i = 0; i < plan.chunks.length; i++) {
      const result = await OnPlate.deployPlannedChunk("anvil", plan, i, {
        onWait: function (fee) { console.log("base fee wait", fee.toString()); },
        onSend: function () { console.log("send piece", i + 1); }
      });
      const at = OnPlate.parseAddr(plan.chunks[i].address);
      if (!at) die("create");
      await OnPlate.codeMatches("anvil", at, chunks[i]);
      if (result.skipped) console.log("piece", i + 1, at, "skipped");
      else console.log("piece", i + 1, at, "gas", result.receipt.gasUsed, "limit", result.receipt.chunkGas, "base", result.receipt.baseFee.toString(), "block", result.receipt.blockNumber);
    }
    const registered = await OnPlate.registerPlanned("anvil", plan, {
      onSend: function () { console.log("send register"); }
    });
    if (!registered.plate) die("plate");
    console.log("addPhoto", registered.skipped ? "skipped" : registered.receipt.gasUsed, registered.plate);
  }
  const plate = OnPlate.parseAddr(plan.plate);
  if (!plate) die("plate");
  const pinned = await OnPlate.pinPlate("anvil", factory, plate);
  const back = await OnPlate.reassemble("anvil", pinned, hash);
  if (Buffer.compare(Buffer.from(back), file) !== 0) die("reassembly");
  const fields = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (fields.name !== "Chaise" || fields.devBps !== devBps || fields.artistBps !== artistBps) die("fields");
  if (!OnPlate.sameAddr(fields.artistRecipient, PAYEE)) die("payee");
  if (!OnPlate.sameAddr(fields.devRecipient, OWNER)) die("dev");
  console.log("plate", pinned);

  const uri = OnPlate.decodeBytes(await OnPlate.agree("anvil", pinned, OnPlate.callData("tokenURI", OnPlate.pad256(1))));
  const json = Buffer.from(uri).toString("utf8");
  if (!json.startsWith("data:application/json;base64,")) die("uri");
  const body = Buffer.from(json.slice("data:application/json;base64,".length), "base64").toString("utf8");
  if (!body.includes(hash) || body.includes("http") || body.includes("ipfs") || body.includes("ar://")) die("json");
  const b64 = body.split("data:image/png;base64,")[1].replace(/"}\s*$/, "");
  if (Buffer.compare(Buffer.from(b64, "base64"), thumb) !== 0) die("uri thumb");
  console.log("tokenURI");

  const one = 10n ** 18n;
  const two = 2n * one;
  await send(ARTIST, { kind: "list", data: OnPlate.callData("list", OnPlate.pad256(one)), to: pinned });
  await send(ARTIST, { kind: "list", data: OnPlate.callData("list", OnPlate.pad256(two)), to: pinned });
  const listed = await OnPlate.listedPair("anvil", pinned);
  if (listed !== two) die("price");
  const open = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (open.buyer) die("public");
  await send(BUYER, { kind: "buy", data: OnPlate.sel("buy"), to: pinned, price: listed });
  const after = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (!OnPlate.sameAddr(after.holder, BUYER) || !OnPlate.sameAddr(after.title, BUYER) || after.price !== 0n) die("sold");

  const devCut = two * fields.devBps / 10000n;
  const artistCut = two * fields.artistBps / 10000n;
  const sellerCut = two - devCut - artistCut;
  if (await OnPlate.claimOf("anvil", pinned, OWNER) !== devCut) die("dev cut");
  if (await OnPlate.claimOf("anvil", pinned, PAYEE) !== artistCut) die("artist cut");
  if (await OnPlate.claimOf("anvil", pinned, ARTIST) !== sellerCut) die("seller cut");
  await send(OWNER, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  await send(PAYEE, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  await send(ARTIST, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  if (await OnPlate.claimOf("anvil", pinned, OWNER) !== 0n) die("withdraw");
  if (await OnPlate.claimOf("anvil", pinned, PAYEE) !== 0n) die("withdraw");
  if (await OnPlate.claimOf("anvil", pinned, ARTIST) !== 0n) die("withdraw");
  console.log("sale", devCut.toString(), artistCut.toString(), sellerCut.toString());

  await expectRevert({ to: pinned, from: ARTIST, data: OnPlate.callData("list", OnPlate.pad256(one)) });
  await expectRevert({ to: pinned, from: ARTIST, data: OnPlate.callData("setAllowedBuyer", OnPlate.pad256(BigInt(PRIVATE))) });
  await send(BUYER, { kind: "setAllowedBuyer", data: OnPlate.callData("setAllowedBuyer", OnPlate.pad256(BigInt(PRIVATE))), to: pinned });
  await send(BUYER, { kind: "list", data: OnPlate.callData("list", OnPlate.pad256(one)), to: pinned });
  const reserved = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (!OnPlate.sameAddr(reserved.buyer, PRIVATE) || reserved.price !== one) die("private");
  await expectRevert({ to: pinned, from: OTHER, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) });
  await expectRevert({ to: pinned, from: ARTIST, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) });
  await send(PRIVATE, { kind: "buy", data: OnPlate.sel("buy"), to: pinned, price: one });
  const priv = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (!OnPlate.sameAddr(priv.holder, PRIVATE) || !OnPlate.sameAddr(priv.title, PRIVATE) || priv.price !== 0n) die("private sale");
  const devCut2 = one * fields.devBps / 10000n;
  const artistCut2 = one * fields.artistBps / 10000n;
  const sellerCut2 = one - devCut2 - artistCut2;
  if (await OnPlate.claimOf("anvil", pinned, OWNER) !== devCut2) die("dev cut 2");
  if (await OnPlate.claimOf("anvil", pinned, PAYEE) !== artistCut2) die("artist cut 2");
  if (await OnPlate.claimOf("anvil", pinned, BUYER) !== sellerCut2) die("seller cut 2");
  await send(OWNER, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  await send(PAYEE, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  await send(BUYER, { kind: "withdraw", data: OnPlate.sel("withdraw"), to: pinned });
  console.log("private", devCut2.toString(), artistCut2.toString(), sellerCut2.toString());

  await send(PRIVATE, { kind: "setAllowedBuyer", data: OnPlate.callData("setAllowedBuyer", OnPlate.pad256(BigInt(OTHER))), to: pinned });
  await send(PRIVATE, { kind: "list", data: OnPlate.callData("list", OnPlate.pad256(one)), to: pinned });
  const prepark = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (!OnPlate.sameAddr(prepark.buyer, OTHER) || prepark.price !== one) die("prepark");
  await send(PRIVATE, { kind: "setMailbox", data: OnPlate.callData("setMailbox", OnPlate.pad256(BigInt(VAULT))), to: pinned });
  const parked = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (!parked.parked || !OnPlate.sameAddr(parked.holder, VAULT) || !OnPlate.sameAddr(parked.title, PRIVATE)) die("park");
  if (parked.price !== 0n || parked.buyer) die("park clear");
  await expectRevert({ to: pinned, from: PRIVATE, data: OnPlate.callData("setAllowedBuyer", OnPlate.pad256(0)) });
  await expectRevert({ to: pinned, from: PRIVATE, data: OnPlate.sel("cancel") });
  await expectRevert({ to: pinned, from: OTHER, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) });
  await expectRevert({ to: pinned, from: PRIVATE, data: OnPlate.callData("list", OnPlate.pad256(one)) });
  await send(VAULT, { kind: "release", data: OnPlate.sel("release"), to: pinned });
  const home = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (home.parked || !OnPlate.sameAddr(home.holder, PRIVATE) || !OnPlate.sameAddr(home.mailbox, VAULT)) die("release");
  if (home.price !== 0n || home.buyer) die("release clear");
  await expectRevert({ to: pinned, from: OTHER, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) });
  await send(PRIVATE, { kind: "list", data: OnPlate.callData("list", OnPlate.pad256(one)), to: pinned });
  const again = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (again.price !== one || again.buyer) die("relist");
  const openBuy = await rpc("eth_call", [{ to: pinned, from: OTHER, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) }, "latest"]);
  if (openBuy.error) die("relist buy");
  await send(PRIVATE, { kind: "cancel", data: OnPlate.sel("cancel"), to: pinned });
  await expectRevert({ to: pinned, from: OTHER, data: OnPlate.sel("buy"), value: "0x" + one.toString(16) });
  await send(PRIVATE, { kind: "clearMailbox", data: OnPlate.sel("clearMailbox"), to: pinned });
  const cleared = OnPlate.parsePlate(await OnPlate.readFields("anvil", pinned));
  if (cleared.mailbox || cleared.parked) die("clear");
  await expectRevert({ to: pinned, from: VAULT, data: OnPlate.sel("release") });
  console.log("vault");

  const pageAddr = OnPlate.addrOf(await OnPlate.agree("anvil", factory, OnPlate.sel("page")));
  const html = OnPlate.decodeBytes(await OnPlate.agree("anvil", pageAddr, OnPlate.sel("page")));
  const onDisk = fs.readFileSync(path.join(root, "web/page.html"));
  if (Buffer.compare(Buffer.from(html), onDisk) !== 0) die("page");
  if (!onDisk.includes(Buffer.from(factory))) die("page factory");
  console.log("page", pageAddr, html.length);
  console.log("ANVIL_OK", pinned);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
