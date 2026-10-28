// Flash-free theme: runs before first paint. Kept as an external file (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "read") document.documentElement.setAttribute("data-theme", t);
    // the intro film (signed-out "/") is made for the dark theme: a visitor who has not chosen a theme sees it dark from the first paint (IntroPage.tsx, useFilmTheme)
    else if (location.pathname === "/" && localStorage.getItem("scholar.signedin") !== "1") document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();
