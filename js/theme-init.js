/* Early theme bootstrap (external script for strict CSP script-src 'self') */
(function () {
  try {
    var t = localStorage.getItem('spread_haking_tr_v1_theme');
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
