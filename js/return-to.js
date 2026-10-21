// Where to go after signing in. Only screens inside app.html are allowed, so the
// "next" value can never send someone to another site.

const APP_PATH = /^app\.html(#\/[A-Za-z0-9\-/]*)?$/;

export function safeNextPath(value) {
  const text = String(value ?? "").trim();
  return APP_PATH.test(text) ? text : null;
}

export function loginUrl(loginPage, hash = "") {
  const next = safeNextPath(`app.html${hash}`);
  return next ? `${loginPage}?next=${encodeURIComponent(next)}` : loginPage;
}
