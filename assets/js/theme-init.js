// Applies the saved light/dark theme before the page paints (no flash).
// Loaded as a normal blocking script in <head>; default theme comes from data-default.
!function () {
  var t = document.currentScript && document.currentScript.getAttribute('data-default') || 'light';
  try { t = localStorage.getItem('kk-theme') || t; } catch (e) { /* storage blocked */ }
  document.documentElement.setAttribute('data-theme', t);
}();
