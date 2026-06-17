// Dr. NIRA — Auth Guard
// Centralized authentication check for all protected pages

(function() {
  var PUBLIC_PAGES = ['index.html', 'auth.html'];
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // Skip check for public pages
  if (PUBLIC_PAGES.indexOf(currentPage) !== -1) return;

  function clearAndRedirect() {
    localStorage.removeItem('nira_session');
    window.location.replace('auth.html');
  }

  // 1. Check session exists
  var raw = localStorage.getItem('nira_session');
  if (!raw) { clearAndRedirect(); return; }

  // 2. Validate JSON structure
  var session;
  try {
    session = JSON.parse(raw);
  } catch(e) { clearAndRedirect(); return; }

  // 3. Check required fields
  if (!session || !session.access_token) { clearAndRedirect(); return; }

  // 4. Check token expiry
  if (session.expires_at) {
    var expiresAt = parseInt(session.expires_at, 10);
    var now = Math.floor(Date.now() / 1000);
    if (now >= expiresAt) { clearAndRedirect(); return; }
  }

  // Session valid — continue
})();
