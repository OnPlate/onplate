/* Blank the page when it is framed. Headers are in web/_headers. */
if (window.top !== window.self) {
  document.documentElement.replaceChildren();
} else {
  document.documentElement.classList.add("on");
}
