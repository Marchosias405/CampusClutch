// A web session lives in the open document. Exercise signed-in routes through
// the browser history API that Expo Router listens to. A real reload needs login.
async function openRoute(page, url) {
  // Reopening a URL should mount the screen again, including lists whose
  // selected item lives in component state instead of the URL.
  if (new URL(url).href === page.url() && new URL(url).pathname !== '/') {
    await openRoute(page, new URL(url).origin);
    await page.getByRole('tab', { name: 'Home', exact: true }).waitFor();
  }
  await page.evaluate(destination => {
    const next = new URL(destination, window.location.href);
    if (next.origin !== window.location.origin) throw Error('Expected a same-origin app route');
    window.history.pushState(null, '', next.href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

async function reloadSignedIn(page, credentials) {
  const destination = page.url();
  await page.reload();
  await page.getByRole('textbox', { name: 'student@example.com', exact: true }).fill(credentials.email);
  await page.getByPlaceholder('Enter your password').fill(credentials.password);
  await page.getByText('Sign In', { exact: true }).click();
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  const suspended = page.getByText('Account temporarily suspended', { exact: true });
  const notice = page.getByText('Account notice', { exact: true });
  await home.or(suspended).or(notice).first().waitFor();
  if (await home.isVisible() && page.url() !== destination) await openRoute(page, destination);
}

module.exports = { openRoute, reloadSignedIn };
