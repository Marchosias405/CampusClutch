/* global __PUBLIC_CONFIG__, window, document, history, location, URLSearchParams, fetch, AbortSignal */
(() => {
  "use strict";
  const config = __PUBLIC_CONFIG__;
  // Fragments never reach the hosting server. Remove all link credentials before
  // fetching, rendering account data, or allowing the user to navigate elsewhere.
  let fragment = new URLSearchParams(location.hash.slice(1));
  let token = fragment.get("access_token");
  const isRecovery = fragment.get("type") === "recovery";
  const invalidLink = fragment.has("error") || new URLSearchParams(location.search).has("error");
  fragment = null; // Do not retain or store the recovery refresh token.
  history.replaceState(null, "", location.pathname);
  const form = document.getElementById("form");
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  const password = document.getElementById("password");
  const confirm = document.getElementById("confirm");
  const submit = document.getElementById("submit");
  const retrySignOut = document.getElementById("retry-signout");
  const title = document.getElementById("title");
  let busy = false;
  let passwordSaved = false;
  let signingOut = false;
  function unavailable() {
    token = null;
    form.hidden = true;
    retrySignOut.hidden = true;
    password.value = confirm.value = "";
    status.textContent = "This reset link has expired or was already used. In CampusClutch, choose Forgot password to request a new one.";
  }
  async function auth(path, options = {}) {
    return fetch(`${config.url}/auth/v1/${path}`, {
      ...options,
      headers: { apikey: config.key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
  }
  async function finishSignOut() {
    if (!token || !passwordSaved || signingOut) return;
    signingOut = true;
    retrySignOut.disabled = true;
    status.textContent = "Signing out of this reset session…";
    let retired = false;
    try {
      const response = await auth("logout?scope=global", { method: "POST" });
      retired = response.ok;
      if (response.status === 401 || response.status === 403) {
        const body = await response.json().catch(() => ({}));
        retired = body.error_code === "session_not_found" || body.code === "session_not_found";
      }
    } catch { /* A sign-out with a lost response can be retried safely. */ }
    signingOut = false;
    if (!token) return;
    if (retired) {
      token = null;
      retrySignOut.hidden = true;
      title.textContent = "Password updated";
      status.textContent = "Return to CampusClutch on your phone and sign in with your new password. You can close this page.";
    } else {
      status.textContent = "Your password was saved. Keep this page open and retry sign-out.";
      retrySignOut.hidden = false;
      retrySignOut.disabled = false;
    }
  }
  retrySignOut.addEventListener("click", finishSignOut);
  window.addEventListener("pagehide", () => {
    token = null;
    password.value = confirm.value = "";
    form.hidden = retrySignOut.hidden = true;
  });
  window.addEventListener("pageshow", event => { if (event.persisted) unavailable(); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !token || passwordSaved || form.hidden) return;
    error.textContent = "";
    if (password.value.length < 8 || password.value.length > 128) {
      error.textContent = "Use a password with 8 to 128 characters."; password.focus(); return;
    }
    if (password.value !== confirm.value) {
      error.textContent = "The passwords do not match."; confirm.focus(); return;
    }
    busy = true; submit.disabled = password.disabled = confirm.disabled = true;
    submit.textContent = "Saving…";
    try {
      const response = await auth("user", { method: "PUT", body: JSON.stringify({ password: password.value }) });
      if (!token) return;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401 || response.status === 403) { unavailable(); return; }
        const code = typeof body.code === "string" ? body.code : body.error_code;
        error.textContent = code === "same_password"
          ? "Choose a different password. If you already saved this one, return to the app and sign in."
          : code === "weak_password"
            ? "Choose a stronger password and try again."
            : response.status === 429
              ? "Too many attempts. Please wait before trying again."
              : "Could not save your password. Try again, or request a new reset link in the app.";
        return;
      }
      passwordSaved = true;
      password.value = confirm.value = "";
      form.hidden = true;
      title.textContent = "Password saved";
      document.getElementById("help").hidden = true;
      await finishSignOut();
    } catch {
      error.textContent = "We could not confirm the change. Check your connection and retry, or try your new password in the app.";
    } finally {
      busy = false; submit.disabled = password.disabled = confirm.disabled = false;
      submit.textContent = "Save new password";
    }
  });
  if (!token || !isRecovery || invalidLink || window.top !== window.self) { unavailable(); return; }
  auth("user").then(response => {
    if (!token) return;
    if (!response.ok) { unavailable(); return; }
    status.textContent = "Choose a new password for your account.";
    form.hidden = false;
  }).catch(() => {
    token = null;
    status.textContent = "Could not check your reset link. Check your connection, then open the email link again. If it was already used, request a new one in the app.";
  });
})();
