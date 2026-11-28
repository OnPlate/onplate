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
  Promise.all([
    P.chainGasPrice(P.chainOf()),
    P.ethUsd().catch(function () { return 0; })
  ]).then(function (pair) {
    var q = P.storeQuote(P.OPEN_MAX, pair[0], P.chainOf());
    var money = P.moneyText(q.about, q.costWei, pair[1]);
    var line = "Today, storing an open-size photograph is about " + money + ". That figure is storage only; registration is a separate cost.";
    if (P.chainOf() === "sepolia") line += " On Sepolia that ETH is test ETH.";
    quote.textContent = line;
  }).catch(function () {
    quote.textContent = "The studio shows today’s amount, in ETH and USD, before you send.";
  });
})();
