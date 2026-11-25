/* Early theme bootstrap (Always Dark by default; Light ONLY if user explicitly toggled it) */
(function () {
  try {
    var t = localStorage.getItem('spread_haking_tr_v1_theme');
    var active = t === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', active);
    document.documentElement.style.colorScheme = active;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
