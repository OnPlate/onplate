/* Static About and Questions pages. No wallet. */
(function () {
  var mark = document.getElementById("mark");
  var menu = document.getElementById("site-menu");
  var quote = document.getElementById("open-quote");
  var P = window.OnPlate;

  function closeMenu() {
    if (!mark || !menu || menu.hidden) return;
    menu.hidden = true;
    mark.setAttribute("aria-expanded", "false");
  }

  if (mark && menu) {
    mark.addEventListener("click", function (ev) {
      var open = menu.hidden;
      ev.stopPropagation();
      menu.hidden = !open;
      mark.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function (ev) {
      var brand = document.querySelector(".brand");
      if (brand && brand.contains(ev.target)) return;
      closeMenu();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeMenu();
    });
  }

  if (!P || !quote) return;

  function moneyOf(chain, price, rate) {
    var q;
    if (!price) return "";
    try {
      q = P.storeQuote(P.OPEN_MAX, price, chain);
      return P.moneyText(q.about, q.costWei, rate);
    } catch (e) {
      return "";
    }
  }

  Promise.all([
    P.chainGasPrice("sepolia").catch(function () { return 0n; }),
    P.chainGasPrice("mainnet").catch(function () { return 0n; }),
    P.ethUsd().catch(function () { return 0; })
  ]).then(function (triple) {
    var rate = triple[2];
    var test = moneyOf("sepolia", triple[0], rate);
    var main = moneyOf("mainnet", triple[1], rate);
    var parts = [];
    if (test) parts.push("On the Sepolia test network, storing an open-size photograph is about " + test + ". That ETH is test ETH.");
    if (main) parts.push("On Ethereum mainnet, the same photograph is about " + main + " at today’s rates. That is the price someone can expect to pay through March.");
    if (!parts.length) {
      quote.textContent = "The studio shows today’s amount, in ETH and USD, before you send.";
      return;
    }
    quote.textContent = parts.join(" ") + " Those figures are storage only; registration is a separate cost.";
  }).catch(function () {
    quote.textContent = "The studio shows today’s amount, in ETH and USD, before you send.";
  });
})();
