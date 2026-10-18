// Flash-free theme: runs before first paint. Kept as an external file (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "read") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
