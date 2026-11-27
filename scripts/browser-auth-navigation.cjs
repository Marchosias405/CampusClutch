// Exercise in-app navigation without replacing the current document.
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

async function reloadSignedIn(page) {
  await page.reload();
}

module.exports = { openRoute, reloadSignedIn };
