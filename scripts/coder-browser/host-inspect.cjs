/** A fixed, read-only host observation. No model-provided URL or browser actions. */
const { chromium } = require('playwright');
const path = require('node:path');
const net = require('node:net');

const API_PATHS = new Set(['/api/portfolio/holdings', '/api/portfolio/dashboard/overview']);
const PROJECT_ROOT = path.resolve(__dirname, '../..').replaceAll('\\', '/');

function validatedOrigin(value) {
  const parsed = new URL(value);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === '::1' || (net.isIPv4(host) && host.startsWith('127.'));
  if (!['http:', 'https:'].includes(parsed.protocol)
      || !loopback || parsed.port === '0'
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/') throw new Error('Invalid local inspection origin');
  return parsed.origin;
}

function allowedRequest(request, origin) {
  if (!['GET', 'HEAD'].includes(request.method) || request.redirected) return false;
  let parsed;
  try { parsed = new URL(request.url); } catch { return false; }
  if (parsed.origin !== origin || parsed.username || parsed.password) return false;
  let pathname;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { return false; }
  if (pathname.includes('\\') || pathname.split('/').some(part => part === '..' || part.startsWith('.env'))) return false;
  if (API_PATHS.has(pathname)) return !parsed.search;
  if (pathname === '/') return !parsed.search;
  if (pathname === '/@vite/client' || pathname === '/@react-refresh') return true;
  if (pathname.startsWith('/@id/')) return true;
  const sourcePrefix = ['/src/', '/client/src/', '/node_modules/', '/assets/', '/public/'];
  const dependencyPrefix = `/@fs/${PROJECT_ROOT}/node_modules/`;
  return (sourcePrefix.some(prefix => pathname.startsWith(prefix)) || pathname.startsWith(dependencyPrefix))
    && /\.(?:js|mjs|cjs|jsx|ts|tsx|css|woff2?|ttf|svg|png|jpe?g|webp|ico)$/.test(pathname);
}

function requestKind(url) {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/portfolio/holdings') return 'holdings';
  if (pathname === '/api/portfolio/dashboard/overview') return 'dashboard';
  return 'page_or_asset';
}

async function inspect(input) {
  const origin = validatedOrigin(input.origin);
  if (Object.keys(input).some(key => key !== 'origin')) throw new Error('Unexpected inspection input');
  const browser = await chromium.launch({ headless: true, args: [
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-first-run', '--no-proxy-server', '--disable-quic',
  ] });
  const watchdog = setTimeout(() => { void browser.close(); }, 25000);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 },
      acceptDownloads: false, serviceWorkers: 'block', permissions: [] });
    let blockedRequests = 0;
    await context.route('**/*', async route => {
      const request = route.request();
      if (allowedRequest({ url: request.url(), method: request.method(),
        redirected: !!request.redirectedFrom() }, origin)) await route.continue();
      else { blockedRequests += 1; await route.abort('blockedbyclient'); }
    });
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage();
    let consoleErrors = 0;
    let javascriptErrors = 0;
    const httpErrors = [];
    const apiResponses = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors += 1; });
    page.on('pageerror', () => { javascriptErrors += 1; });
    page.on('dialog', dialog => void dialog.dismiss());
    page.on('response', response => {
      const entry = { kind: requestKind(response.url()), status: response.status() };
      if (entry.status >= 400 && httpErrors.length < 30) httpErrors.push(entry);
      if (entry.kind !== 'page_or_asset' && apiResponses.length < 20) apiResponses.push(entry);
    });
    let navigationStatus = null;
    let navigationError = null;
    try {
      const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 12000 });
      navigationStatus = response?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    } catch { navigationError = 'navigation_failed_or_timed_out'; }
    // Deliberately return structural counts, not user names, finance data or text.
    const dom = await page.evaluate(() => ({
      headings: document.querySelectorAll('h1,h2,h3,[role="heading"]').length,
      tables: document.querySelectorAll('table,[role="table"],[role="grid"]').length,
      rows: document.querySelectorAll('tbody tr,[role="row"]').length,
      alerts: document.querySelectorAll('[role="alert"]').length,
      loadingIndicators: document.querySelectorAll('[aria-busy="true"],[role="progressbar"]').length,
      bodyPresent: !!document.body,
      errorMessagePresent: /加载失败|连接失败|请求失败|网络错误|failed to fetch|connection refused/i.test(document.body?.innerText || ''),
    }));
    const screenshot = await page.screenshot({ type: 'png', animations: 'disabled',
      // All text/media is masked because a real portfolio can contain private data.
      style: '* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; background-image: none !important; } input, textarea, [contenteditable], img, canvas, svg, video, iframe { visibility: hidden !important; }',
      timeout: 4000 });
    return { ok: true, scope: 'host_main', countsAsVerification: false,
      navigationStatus, navigationError, dom, consoleErrors, javascriptErrors,
      httpErrors, apiResponses, blockedRequests, screenshotRedacted: true,
      limitations: 'Only fixed read-only API and local assets are allowed; writes, external requests and HMR are blocked. Screenshot text and media are redacted.',
      base64: screenshot.toString('base64') };
  } finally { clearTimeout(watchdog); await browser.close(); }
}

module.exports = { allowedRequest, inspect };
if (require.main === module) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; if (text.length > 4096) process.exit(1); });
  process.stdin.on('end', async () => {
    try { process.stdout.write(JSON.stringify(await inspect(JSON.parse(text)))); }
    catch { process.stdout.write(JSON.stringify({ ok: false, errorCategory: 'browser_failed' })); }
  });
}
