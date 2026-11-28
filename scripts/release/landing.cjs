/* global __dirname */
// Build a public, indexable site separately from the signed-in Expo web pilot.
const fs = require('node:fs');
const path = require('node:path');
const packageConfig = require('../../app.json');
const courses = require('../../web/landing/courses.json');

const origin = 'https://clu.expo.app';
const pilot = 'https://clu--pilot.expo.app';
const directory = pilot + '/courses/review-directory';
const source = path.resolve(__dirname, '../../web/landing');
const output = path.resolve(__dirname, '../../.expo/clu-landing');
const assetsRoot = path.join(output, 'client');
const pagesRoot = path.join(output, 'server');
const playUrl = 'https://play.google.com/store/apps/details?id=' + packageConfig.expo.android.package;
const playIsLive = process.argv.includes('--play-store');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const guidePath = code => '/sfu-course-reviews/' + code.toLowerCase().replace(' ', '-');
const routes = [];

fs.mkdirSync(assetsRoot, { recursive: true });
fs.cpSync(path.join(source, 'assets'), path.join(assetsRoot, 'assets'), { recursive: true });
for (const asset of ['landing.css', 'landing.js']) fs.copyFileSync(path.join(source, asset), path.join(assetsRoot, asset));

const footer = `<footer class="frame foot"><span>Clu for SFU students. An independent student project.</span>
  <details><summary>Photo credits</summary>
  <p><a href="https://commons.wikimedia.org/wiki/File:Academic_Quadrangle_@_SFU_Campus_@_Burnaby_(7816227366).jpg">Academic Quadrangle</a> by Guilhem Vellut (<a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>).</p>
  <p><a href="https://commons.wikimedia.org/wiki/File:Simon_Fraser_University-Surrey_Campus_interior_2024.jpg">Surrey campus interior</a> by Canmenwalker (<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>). Both photographs resized and cropped for display.</p></details></footer>`;

function page({ route, title, description, body }) {
  const canonical = origin + route;
  const home = route === '/';
  const schema = home ? {
    '@context': 'https://schema.org', '@type': 'WebSite', name: 'Clu', alternateName: 'Clu SFU', url: canonical, description,
  } : {
    '@context': 'https://schema.org', '@type': 'WebPage', name: title, url: canonical, description, isPartOf: { '@type': 'WebSite', name: 'Clu', url: origin + '/' },
  };
  const file = (home ? 'index' : route.slice(1)) + '.html';
  const html = `<!doctype html>
<html lang="en-CA"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${canonical}"><link rel="icon" type="image/png" href="/assets/clu.png">
<meta name="theme-color" content="#faf8f1">
<meta property="og:type" content="website"><meta property="og:site_name" content="Clu"><meta property="og:locale" content="en_CA">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}">
<meta property="og:image" content="${origin}/assets/clu-social.jpg"><meta property="og:image:alt" content="Clu for SFU students and the Academic Quadrangle on the Burnaby campus"><meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/assets/dm-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/landing.css">
<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<','\\u003c')}</script>
${home ? '<script defer src="/landing.js"></script>' : ''}
</head><body><a class="skip" href="#main">Skip to content</a>${body}${footer}</body></html>`;
  const destination = path.join(pagesRoot, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, html);
  routes.push({ file, page: home ? '/index' : route, namedRegex: home ? '^/$' : '^' + route + '/?$', routeKeys: {} });
}

const home = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
  .replace('{{courseLinks}}', courses.map(({code, title}) => `<li><a href="${guidePath(code)}"><b>${escape(code)}</b><span>${escape(title)}</span><i aria-hidden="true"></i></a></li>`).join('\n'))
  .replace('{{androidAccess}}', playIsLive
    ? `<a class="store-note" href="${playUrl}">Get Clu on Google Play</a>`
    : '<span class="store-note">Google Play release pending</span>');
page({ route: '/', title: 'Clu | SFU Course Reviews & Classmates', description: 'Explore SFU course reviews on Clu. Compare workload and difficulty, share your experience, and meet classmates at Simon Fraser University. Open Clu on the web.', body: home });
for (const course of courses) {
  const [subject, number] = course.code.toLowerCase().split(' ');
  const official = 'https://www.sfu.ca/students/calendar/2026/fall/courses/' + subject + '/' + number + '.html';
  const appUrl = pilot + '/courses/reviews?' + new URLSearchParams({ code: course.code });
  const body = `<header class="mast frame"><a class="brand" href="/" aria-label="Clu home"><img src="/assets/clu.png" width="44" height="44" alt=""><span>Clu</span></a><a class="utility" href="${directory}">All course reviews</a></header>
<main id="main" class="guide frame"><a class="back" href="/#course-reviews">Back to the course guide</a>
<h1>${course.code}<em>SFU course reviews</em></h1>
<h2>${escape(course.title)}</h2><p>${escape(course.summary)}</p>
<p class="source"><a href="${official}">SFU Calendar course description</a></p>
<a class="button primary" href="${appUrl}">Open ${course.code} reviews</a>
<p>Sign in to read student feedback or add your experience from a past term. Reviews are anonymous to other students.</p>
<h2>What would you tell the next student?</h2><ul>${course.questions.map(q => '<li>' + escape(q) + '</li>').join('')}</ul></main>`;
  page({ route: guidePath(course.code), title: `${course.code} SFU Course Reviews | ${course.title} | Clu`, description: `Explore ${course.code} at SFU. ${course.summary.split('. ')[0]}. Open Clu for student reviews of workload and difficulty.`, body });
}
const publicPaths = ['/', ...courses.map(course => guidePath(course.code))];
fs.writeFileSync(path.join(assetsRoot, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + publicPaths.map(route => '  <url><loc>' + origin + route + '</loc></url>').join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(assetsRoot, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
const missingFile = '+not-found.html';
fs.writeFileSync(path.join(pagesRoot, missingFile), `<!doctype html><html lang="en-CA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page missing | Clu</title><link rel="stylesheet" href="/landing.css"></head>
<body><main class="guide frame"><h1>Page missing.</h1><p>This link may be out of date.</p><a class="button primary" href="/">Explore SFU course reviews</a></main></body></html>`);
const manifest = {
  version: 1, apiRoutes: [], htmlRoutes: routes,
  notFoundRoutes: [{file: missingFile, page: '/+not-found', namedRegex: '^/.*$', routeKeys: {}}],
  redirects: [], rewrites: [], headers: {'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'},
};
fs.mkdirSync(path.join(pagesRoot, '_expo'), { recursive: true });
fs.writeFileSync(path.join(pagesRoot, '_expo/routes.json'), JSON.stringify(manifest));
console.log('Wrote ' + routes.length + ' public pages to ' + output);
