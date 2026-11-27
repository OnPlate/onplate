(function () {
  if (window.top !== window.self) {
    document.documentElement.replaceChildren();
    return;
  }
  var CHAIN = "__CHAIN__";
  var FACTORY = "__FACTORY__";
  var READ_MS = 8000;
  var URLS = {
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
      "https://sepolia.drpc.org",
      "https://rpc.sepolia.ethpandaops.io",
      "https://1rpc.io/sepolia",
      "https://ethereum-sepolia.publicnode.com"
    ],
    anvil: ["http://127.0.0.1:8545"]
  };
  var CHAIN_ID = { mainnet: 1, sepolia: 11155111, anvil: 31337 };
  var SEL = {
    photoCount: "0x12d28b18",
    photoAt: "0x0d6d931a",
    contentHash: "0x646c2e33",
    chunkCount: "0xf91f0937",
    chunkAt: "0x1bbb6678",
    name: "0x06fdde03",
    description: "0x7284e416",
    title: "0x4a79d50c",
    holder: "0x6352211e",
    mail: "0xd5438eae",
    parked: "0x355a4b9b",
    price: "0x57ed4b2f",
    buyer: "0xbf8ed6b6",
    artist: "0x3a34842e"
  };
  var EXTRA = ["title", "holder", "mail", "parked", "price", "buyer", "artist"];
  var note = document.getElementById("note");
  var list = document.getElementById("list");
  var K = window.OnPlateKeccak;

  function say(text) { note.textContent = text || ""; }

  function pad(n) {
    var h = BigInt(n).toString(16);
    return h.padStart(64, "0");
  }

  function word(hex) {
    var h = String(hex || "").toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]+$/.test(h) || h.length > 64) return null;
    return h.padStart(64, "0");
  }

  function addr(hex) {
    var w = word(hex);
    if (!w) return null;
    var a = "0x" + w.slice(24);
    if (/^0x0{40}$/.test(a)) return null;
    return a;
  }

  function plain(s, min, max) {
    var i, c;
    if (typeof s !== "string" || s.length < min || s.length > max) return "";
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c < 32 || c > 126) return "";
      if (c === 34 || c === 92 || c === 60 || c === 62 || c === 38) return "";
    }
    return s;
  }

  function bytesOf(hex) {
    var h = String(hex || "").replace(/^0x/i, "");
    var out, i;
    if (h.length % 2 || !/^[0-9a-fA-F]*$/.test(h)) return null;
    out = new Uint8Array(h.length / 2);
    for (i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  function textOf(hex) {
    var h = String(hex || "").toLowerCase().replace(/^0x/, "");
    var offset, pos, len, start, s, i;
    if (h.length < 128) return "";
    offset = parseInt(h.slice(0, 64), 16);
    pos = offset * 2;
    if (!Number.isFinite(offset) || pos + 64 > h.length) return "";
    len = parseInt(h.slice(pos, pos + 64), 16);
    if (!Number.isFinite(len) || len > 240) return "";
    start = pos + 64;
    if (start + len * 2 > h.length) return "";
    s = "";
    for (i = 0; i < len; i++) s += String.fromCharCode(parseInt(h.slice(start + i * 2, start + i * 2 + 2), 16));
    return s;
  }

  function num(hex) {
    var w = word(hex);
    return w ? BigInt("0x" + w) : 0n;
  }

  function eth(wei) {
    var n = BigInt(wei), unit = 1000000000000000000n, frac;
    frac = (n % unit).toString().padStart(18, "0").replace(/0+$/, "");
    return frac ? (n / unit) + "." + frac : String(n / unit);
  }

  function sumAddr(a) {
    var hex, hash, out, i;
    if (!a) return "";
    hex = String(a).toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{40}$/.test(hex)) return "";
    hash = K.hex(K.keccak256(new TextEncoder().encode(hex)));
    out = "0x";
    for (i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
    return out;
  }

  function sniff(b) {
    if (!b || b.length < 3) return "";
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
    if (b.length >= 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "image/png";
    if (b[0] === 71 && b[1] === 73 && b[2] === 70) return "image/gif";
    if (b.length >= 12 && b[0] === 82 && b[8] === 87) return "image/webp";
    return "";
  }

  function rpc(url, method, params) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
      signal: AbortSignal.timeout(READ_MS)
    }).then(function (res) {
      if (!res.ok) throw new Error("http");
      return res.json();
    }).then(function (msg) {
      if (!msg || msg.error || typeof msg.result !== "string" || msg.result.length < 66) throw new Error("result");
      return msg.result;
    });
  }

  function need() { return CHAIN === "anvil" ? 1 : 2; }

  function agree(to, data) {
    var urls = URLS[CHAIN] || [];
    var min = need();
    var seen = [];
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("weather"));
      return rpc(urls[i], "eth_call", [{ to: to, data: data }, "latest"]).then(function (hex) {
        var key = hex.toLowerCase();
        var j;
        for (j = 0; j < seen.length; j++) {
          if (seen[j].hex === key) {
            seen[j].n += 1;
            if (seen[j].n >= min) return key;
            return step(i + 1);
          }
        }
        seen.push({ hex: key, n: 1 });
        if (min <= 1) return key;
        return step(i + 1);
      }, function () { return step(i + 1); });
    }
    return step(0);
  }

  function keyFor(plate) {
    return String(CHAIN_ID[CHAIN]) + ":" + plate.toLowerCase() + ":1";
  }

  function indexKey() {
    return String(CHAIN_ID[CHAIN]) + ":" + FACTORY.toLowerCase() + ":index2";
  }

  function db() {
    return new Promise(function (ok, bad) {
      var req = indexedDB.open("onplate", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("photos"); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { bad(req.error); };
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

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function fact(dl, name, value, hash) {
    dl.appendChild(el("dt", name));
    dl.appendChild(el("dd", value, hash ? "hash" : ""));
  }

  function viewOf(m) {
    return {
      title: m.title || "",
      holder: m.holder || "",
      artist: m.artist || "none",
      listing: m.price > 0n && !m.parked ? "Listed for " + eth(m.price) + " ETH" : "Not listed.",
      parked: m.parked ? "Parked at " + (m.mail || "") : "Not parked",
      buyer: m.buyer ? "Only " + m.buyer + " may buy." : ""
    };
  }

  function card(parent, plate, name, description, hash, bytes, view) {
    var box = el("section"), img, type = sniff(bytes), dl;
    if (type && bytes) {
      img = el("img");
      img.alt = name || "Photograph";
      img.src = URL.createObjectURL(new Blob([bytes], { type: type }));
      box.appendChild(img);
    }
    box.appendChild(el("h2", name || "Photograph"));
    if (description) box.appendChild(el("p", description));
    dl = el("dl", "", "facts");
    fact(dl, "Plate address", sumAddr(plate) || plate);
    if (view) {
      fact(dl, "Title owner", view.title);
      fact(dl, "Current holder", view.holder);
      fact(dl, "Artist", view.artist);
      fact(dl, "Listing", view.listing);
      fact(dl, "Parked", view.parked);
      if (view.buyer) fact(dl, "Buyer", view.buyer);
    }
    fact(dl, "Content hash", hash, true);
    box.appendChild(dl);
    parent.appendChild(box);
  }

  function readMeta(plate) {
    return Promise.all(EXTRA.map(function (name) {
      return agree(plate, SEL[name] + (name === "holder" ? pad(1) : ""));
    })).then(function (got) {
      var raw = {}, i, who;
      for (i = 0; i < EXTRA.length; i++) raw[EXTRA[i]] = got[i];
      who = function (key) { return sumAddr(addr(raw[key])); };
      return {
        title: who("title"), holder: who("holder"), artist: who("artist"),
        mail: who("mail"), buyer: who("buyer"),
        parked: num(raw.parked) !== 0n,
        price: num(raw.price)
      };
    });
  }

  function showCache() {
    return idbGet(indexKey()).then(function (row) {
      var plates = row && row.plates ? row.plates : [];
      if (!plates.length) return false;
      return plates.reduce(function (prev, plate) {
        return prev.then(function () {
          return idbGet(keyFor(plate)).then(function (photo) {
            if (!photo || !photo.bytes) return;
            card(list, plate, photo.name, photo.description, photo.hash, new Uint8Array(photo.bytes), photo.view || null);
          });
        });
      }, Promise.resolve()).then(function () { return true; });
    });
  }

  function chunks(url, plate) {
    return rpc(url, "eth_call", [{ to: plate, data: SEL.chunkCount }, "latest"]).then(function (hex) {
      var n = Number(BigInt("0x" + word(hex)));
      var parts = [];
      function one(i) {
        if (!n || n > 1150) throw new Error("chunks");
        if (i >= n) {
          var len = 0, j, out, off;
          for (j = 0; j < n; j++) len += parts[j].length;
          out = new Uint8Array(len);
          off = 0;
          for (j = 0; j < n; j++) { out.set(parts[j], off); off += parts[j].length; }
          return out;
        }
        return rpc(url, "eth_call", [{ to: plate, data: SEL.chunkAt + pad(i) }, "latest"]).then(function (w) {
          var a = addr(w);
          if (!a) throw new Error("chunk");
          return fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [a, "latest"] }),
            signal: AbortSignal.timeout(READ_MS)
          }).then(function (res) { return res.json(); });
        }).then(function (msg) {
          var raw = bytesOf(msg && msg.result);
          if (!raw || raw.length < 2 || raw[0] !== 0) throw new Error("chunk");
          parts[i] = raw.subarray(1);
          return one(i + 1);
        });
      }
      return one(0);
    });
  }

  function imageOf(plate, hash) {
    var urls = URLS[CHAIN] || [];
    function step(i) {
      if (i >= urls.length) return Promise.reject(new Error("hash"));
      return chunks(urls[i], plate).then(function (bytes) {
        var got = "0x" + K.hex(K.keccak256(bytes));
        if (got !== hash.toLowerCase()) throw new Error("mismatch");
        return bytes;
      }).catch(function (err) {
        if (err && err.message === "hash") throw err;
        return step(i + 1);
      });
    }
    return step(0);
  }

  function fromChain() {
    return agree(FACTORY, SEL.photoCount).then(function (hex) {
      var count = BigInt("0x" + word(hex));
      var ids = [];
      var i;
      if (count === 0n) {
        list.replaceChildren();
        say("No photographs yet.");
        return;
      }
      if (count > 100n) count = 100n;
      for (i = 1n; i <= count; i++) ids.push(i);
      var frag = document.createDocumentFragment();
      return ids.reduce(function (prev, id) {
        return prev.then(function (plates) {
          return agree(FACTORY, SEL.photoAt + pad(id)).then(function (hexAt) {
            var plate = addr(hexAt);
            if (!plate) throw new Error("plate");
            return Promise.all([
              agree(plate, SEL.name),
              agree(plate, SEL.description),
              agree(plate, SEL.contentHash),
              readMeta(plate)
            ]).then(function (got) {
              var name = plain(textOf(got[0]), 1, 48);
              var description = plain(textOf(got[1]), 0, 240);
              var hash = "0x" + word(got[2]);
              var view = viewOf(got[3]);
              return imageOf(plate, hash).then(function (bytes) {
                card(frag, plate, name, description, hash, bytes, view);
                var copy = new Uint8Array(bytes.length);
                copy.set(bytes);
                return idbPut(keyFor(plate), {
                  name: name,
                  description: description,
                  hash: hash,
                  bytes: copy.buffer,
                  view: view
                }).then(function () {
                  plates.push(plate);
                  return plates;
                });
              });
            });
          });
        });
      }, Promise.resolve([])).then(function (plates) {
        if (!plates) return;
        list.replaceChildren();
        list.appendChild(frag);
        say("");
        return idbPut(indexKey(), { plates: plates });
      });
    });
  }

  function liveLink() {
    var mark = document.getElementById("mark");
    var live = "http://127.0.0.1:8765/?chain=" + CHAIN + "&factory=" + FACTORY;
    if (!mark) return;
    fetch(live, { mode: "no-cors", signal: AbortSignal.timeout(1500) }).then(function () {
      mark.href = live;
    }, function () {});
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(FACTORY) || !URLS[CHAIN]) {
    say("the chain did not answer.");
    return;
  }

  document.getElementById("again").addEventListener("click", function () {
    fromChain().then(function () { say(""); }).catch(function () { say("the chain did not answer."); });
  });

  liveLink();
  showCache().then(function (had) {
    if (had) return;
    return fromChain();
  }).catch(function () {
    say("the chain did not answer.");
  });
})();
