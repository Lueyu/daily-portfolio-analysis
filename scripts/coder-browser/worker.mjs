/** Fixed JSONL browser worker. It never evaluates caller code or writes caller paths. */
import { createInterface } from 'node:readline';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { chromium } from 'playwright';
import { createNetworkPolicy, networkOrigin } from './network-policy.mjs';

const ACTION_FIELDS = {
  navigate: ['url'], snapshot: ['maxElements'], click: ['ref'], fill: ['ref', 'text'],
  press: ['ref', 'key'], select: ['ref', 'value'], scroll: ['ref', 'x', 'y'],
  wait_for: ['text', 'state', 'timeout_ms'],
  screenshot: ['ref', 'fullPage'], styles: ['ref', 'properties'], errors: ['clear'], close: [],
};
const MAX_EVENTS = 100;
const VIEWPORT = { width: 1280, height: 900 };
let browser;
let networkProxy;
const proxySockets = new Set();
let context;
let page;
let navigationVersion = 0;
let snapshotSequence = 0;
let snapshotVersion = '';
let snapshotRevision = -1;
let references = new Map();
let closed = false;
const events = { console: [], pageErrors: [], networkFailures: [], httpErrors: [] };

function record(kind, entry) {
  events[kind].push({ ...entry, timestamp: new Date().toISOString() });
  if (events[kind].length > MAX_EVENTS) events[kind].shift();
}

function networkPolicy() {
  return createNetworkPolicy(JSON.parse(process.env.AGENT_BROWSER_ALLOWED_ORIGINS || '[]'),
    JSON.parse(process.env.AGENT_BROWSER_ALLOWED_HOSTS || '[]'), process.env.AGENT_BROWSER_EGRESS_PROXY || '');
}

function textArgument(value, name, max = 12_000) {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}

async function startNetworkProxy(policy) {
  // Browser routing alone misses redirects after the first hop. An isolated
  // local forward proxy enforces the same allowlist on every actual HTTP/TLS
  // connection, including redirect chains, while preserving response streaming.
  const proxy = createServer((incoming, outgoing) => {
    const origin = networkOrigin(incoming.url);
    if (!policy.allows(incoming.url)) {
      record('networkFailures', { url: incoming.url, error: 'Proxy origin not allowed', blocked: true });
      incoming.socket.destroy();
      return;
    }
    const target = new URL(incoming.url);
    if (target.protocol !== 'http:') {
      incoming.socket.destroy();
      return;
    }
    const headers = { ...incoming.headers, host: target.host };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const external = !policy.previews.has(origin);
    const upstream = httpRequest(external ? policy.egress : target, {
      method: incoming.method, headers, ...(external ? { path: target.href } : {}),
    }, response => {
      outgoing.writeHead(response.statusCode || 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', error => {
      record('networkFailures', { url: incoming.url, error: error.message });
      outgoing.destroy();
    });
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  proxy.on('connection', socket => {
    proxySockets.add(socket);
    socket.on('close', () => proxySockets.delete(socket));
  });
  proxy.on('connect', (incoming, socket, head) => {
    const origin = networkOrigin(`https://${incoming.url}`);
    if (!policy.allows(`https://${incoming.url}`)) {
      record('networkFailures', { url: `https://${incoming.url}`, error: 'TLS origin not allowed', blocked: true });
      socket.destroy();
      return;
    }
    const target = new URL(origin);
    const relay = upstream => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
      proxySockets.add(upstream);
      upstream.on('close', () => proxySockets.delete(upstream));
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    };
    if (policy.previews.has(origin)) {
      const upstream = connect(Number(target.port) || 443, target.hostname, () => relay(upstream));
      upstream.on('error', () => socket.destroy());
    } else {
      const request = httpRequest(policy.egress, {
        method: 'CONNECT', path: `${target.hostname}:443`, headers: { host: `${target.hostname}:443` },
      });
      request.on('connect', (response, upstream, remoteHead) => {
        if (response.statusCode !== 200) {
          record('networkFailures', { url: origin, error: 'Egress proxy denied TLS connection', blocked: true });
          upstream.destroy();
          socket.destroy();
          return;
        }
        relay(upstream);
        if (remoteHead.length) socket.write(remoteHead);
      });
      request.on('error', () => socket.destroy());
      socket.on('close', () => request.destroy());
      request.end();
    }
  });
  proxy.on('upgrade', (incoming, socket, head) => {
    const origin = networkOrigin(incoming.url, true);
    if (!policy.allows(incoming.url, true)) {
      record('networkFailures', { url: incoming.url, error: 'WebSocket origin not allowed', blocked: true });
      socket.destroy();
      return;
    }
    const target = new URL(incoming.url);
    target.protocol = 'http:';
    const external = !policy.previews.has(origin);
    const upstream = httpRequest(external ? policy.egress : target, {
      headers: incoming.headers, ...(external ? { path: target.href } : {}),
    });
    upstream.on('upgrade', (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (const [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${value}\r\n`);
      socket.write('\r\n');
      if (remoteHead.length) socket.write(remoteHead);
      if (head.length) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
      proxySockets.add(remote);
      remote.on('close', () => proxySockets.delete(remote));
      remote.on('error', () => socket.destroy());
      socket.on('error', () => remote.destroy());
      socket.on('close', () => remote.destroy());
    });
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  networkProxy = proxy;
  return `http://127.0.0.1:${proxy.address().port}`;
}

async function closeBrowser() {
  await browser?.close();
  for (const socket of proxySockets) socket.destroy();
  if (networkProxy) await new Promise(resolve => networkProxy.close(resolve));
  browser = undefined;
  networkProxy = undefined;
  context = undefined;
  page = undefined;
  snapshotVersion = '';
}

async function startBrowser() {
  if (page) return;
  const policy = networkPolicy();
  const proxyServer = await startNetworkProxy(policy);
  browser = await chromium.launch({
    headless: true,
    proxy: { server: proxyServer, bypass: '<-loopback>' },
    args: ['--disable-extensions', '--disable-background-networking', '--dns-prefetch-disable',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  context = await browser.newContext({
    viewport: VIEWPORT, acceptDownloads: false, serviceWorkers: 'block', permissions: [],
  });
  context.setDefaultTimeout(5000);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (policy.allows(url)) return route.continue();
    record('networkFailures', { url, error: 'Origin not allowed', blocked: true });
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    if (policy.allows(socket.url(), true)) socket.connectToServer();
    else {
      record('networkFailures', { url: socket.url(), error: 'WebSocket origin not allowed', blocked: true });
      socket.close();
    }
  });
  await context.addInitScript(() => {
    let revision = 0;
    Object.defineProperty(window, '__coderBrowserRevision', { get: () => revision });
    new MutationObserver(() => { revision += 1; }).observe(document, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
  });
  page = await context.newPage();
  // Each worker owns exactly one fresh page/context. Popups never become host tabs.
  context.on('page', popup => { if (popup !== page) void popup.close(); });
  page.on('download', download => { void download.cancel(); });
  page.on('dialog', dialog => { void dialog.dismiss(); });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      navigationVersion += 1;
      snapshotVersion = '';
    }
  });
  page.on('console', message => record('console', {
    type: message.type(), text: message.text().slice(0, 4000), location: message.location(),
  }));
  page.on('pageerror', error => record('pageErrors', { message: error.message.slice(0, 4000) }));
  page.on('requestfailed', request => record('networkFailures', {
    url: request.url(), error: request.failure()?.errorText || 'Request failed',
  }));
  page.on('response', response => {
    if (response.status() >= 400) record('httpErrors', {
      url: response.url(), status: response.status(), statusText: response.statusText(),
      method: response.request().method(), resourceType: response.request().resourceType(),
    });
  });
}

async function revision() {
  return page.evaluate(() => window.__coderBrowserRevision || 0);
}

async function clearReferences() {
  await Promise.all([...references.values()].map(handle => handle.dispose().catch(() => {})));
  references = new Map();
}

async function elementFor(ref) {
  textArgument(ref, 'ref', 100);
  if (!snapshotVersion || !ref.startsWith(`${snapshotVersion}:`) || await revision() !== snapshotRevision) {
    throw new Error('Stale element ref; take a fresh snapshot');
  }
  const handle = references.get(ref);
  if (!handle || !await handle.evaluate(element => element.isConnected)) {
    throw new Error('Stale or unknown element ref; take a fresh snapshot');
  }
  return handle;
}

async function metadata() {
  return { url: page.url(), title: await page.title(), version: snapshotVersion || `${navigationVersion}.${await revision()}` };
}

async function snapshot(maxElements = 250) {
  if (!Number.isInteger(maxElements) || maxElements < 1 || maxElements > 1000) {
    throw new Error('maxElements must be an integer from 1 to 1000');
  }
  await clearReferences();
  snapshotVersion = '';
  const initialRevision = await revision();
  const nodeList = await page.evaluateHandle(limit => {
    return Array.from(document.querySelectorAll('body *')).filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') return false;
      if (element.closest('[aria-hidden="true"]')) return false;
      return element.matches('button,a,input,select,textarea,h1,h2,h3,h4,h5,h6,img,[role],[tabindex]')
        || (!element.children.length && element.textContent.trim());
    }).slice(0, limit);
  }, maxElements);
  const descriptions = await nodeList.evaluate(nodes => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const roleOf = element => {
      if (element.getAttribute('role')) return element.getAttribute('role');
      const tag = element.tagName.toLowerCase();
      if (tag === 'input') {
        return ({ checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button',
          range: 'slider', number: 'spinbutton', search: 'searchbox' })[element.type] || 'textbox';
      }
      if (/^h[1-6]$/.test(tag)) return 'heading';
      return ({ button: 'button', a: 'link', select: 'combobox', textarea: 'textbox', img: 'img' })[tag] || 'text';
    };
    return nodes.map(element => {
      const rect = element.getBoundingClientRect();
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/)
        .map(id => document.getElementById(id)?.textContent || '').join(' ');
      const labels = element.labels ? [...element.labels].map(label => label.textContent).join(' ') : '';
      const name = normalize(element.getAttribute('aria-label') || labelledBy.trim() || labels
        || element.getAttribute('alt') || element.getAttribute('title') || element.textContent);
      let ancestor = element.parentElement;
      while (ancestor && !nodes.includes(ancestor)) ancestor = ancestor.parentElement;
      return {
        role: roleOf(element), name, tag: element.tagName.toLowerCase(), text: normalize(element.textContent),
        parentIndex: nodes.indexOf(ancestor), disabled: Boolean(element.disabled),
        ...(typeof element.value === 'string' ? { value: element.value.slice(0, 500) } : {}),
        ...(typeof element.checked === 'boolean' ? { checked: element.checked } : {}),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
  });
  snapshotRevision = await revision();
  if (snapshotRevision !== initialRevision) {
    await nodeList.dispose();
    throw new Error('Page changed while taking snapshot; request a fresh snapshot');
  }
  snapshotVersion = `${navigationVersion}.${snapshotRevision}.${++snapshotSequence}`;
  const properties = await nodeList.getProperties();
  const elements = descriptions.map((description, index) => {
    const ref = `${snapshotVersion}:${index}`;
    const handle = properties.get(String(index)).asElement();
    references.set(ref, handle);
    const { parentIndex, ...rest } = description;
    return { ref, ...rest, parentRef: parentIndex >= 0 ? `${snapshotVersion}:${parentIndex}` : null };
  });
  await nodeList.dispose();
  return { ...await metadata(), elements, truncated: elements.length === maxElements };
}

async function inspectStyles(ref, properties = []) {
  if (!Array.isArray(properties) || properties.length > 50
      || properties.some(name => typeof name !== 'string' || !/^[a-zA-Z-]{1,64}$/.test(name))) {
    throw new Error('properties must contain up to 50 CSS property names');
  }
  const handle = await elementFor(ref);
  const result = await handle.evaluate((element, requestedProperties) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const names = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'display', 'position',
      'width', 'height', 'minWidth', 'maxWidth', 'overflow', 'overflowX', 'overflowY', 'whiteSpace',
      'textOverflow', 'opacity', 'padding', 'margin', 'border', 'zIndex', 'flex', 'gap'];
    const styles = Object.fromEntries(names.map(name => [name, computed[name]]));
    for (const name of requestedProperties) styles[name] = computed.getPropertyValue(name) || computed[name] || '';
    const backgrounds = [];
    for (let current = element; current; current = current.parentElement) {
      backgrounds.push(getComputedStyle(current).backgroundColor);
    }
    return { styles, backgrounds,
      layout: { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        clientWidth: element.clientWidth, clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight },
    };
  }, properties);
  const rgb = value => {
    const match = value.match(/^rgba?\(([^)]+)\)$/);
    return match ? match[1].split(',').map(Number) : null;
  };
  const foreground = rgb(result.styles.color);
  const background = result.backgrounds.map(rgb).find(color => color && (color.length === 3 || color[3] === 1));
  let contrastRatio = null;
  if (foreground && background && (foreground.length === 3 || foreground[3] === 1)) {
    const luminance = color => color.slice(0, 3).map(channel => {
      const linear = channel / 255;
      return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    contrastRatio = Number(((values[0] + 0.05) / (values[1] + 0.05)).toFixed(2));
  }
  return { ...result, contrastRatio, contrastNote: 'Estimate for solid opaque colors; inspect screenshot for overlays and gradients.',
    ...await metadata() };
}

async function settleAction() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function run(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Request must be an object');
  const fields = ACTION_FIELDS[request.action];
  if (!fields) throw new Error(`Unsupported action: ${String(request.action)}`);
  for (const key of Object.keys(request)) {
    if (!['id', 'action', ...fields].includes(key)) throw new Error(`Unsupported field: ${key}`);
  }
  if (request.action === 'close') {
    closed = true;
    await closeBrowser();
    return { closed: true };
  }
  if (closed) throw new Error('Browser worker is closed');
  if (request.action === 'navigate') {
    const url = textArgument(request.url, 'url', 4096);
    if (!networkPolicy().allows(url)) throw new Error('Navigation origin or scheme not allowed');
  }
  try {
    await startBrowser();
  } catch (error) {
    await closeBrowser();
    throw error;
  }
  switch (request.action) {
    case 'navigate': {
      await clearReferences();
      Object.values(events).forEach(entries => { entries.length = 0; });
      try {
        const preview = networkPolicy().previews.has(networkOrigin(request.url));
        // Public documentation may include slow or blocked third-party assets.
        // Its DOM is enough to start reading; local preview checks still wait
        // for load so their screenshot/style evidence observes loaded assets.
        await page.goto(request.url, { waitUntil: preview ? 'load' : 'domcontentloaded',
          timeout: preview ? 15_000 : 30_000 });
      } catch (error) {
        // Aborted navigations can asynchronously commit Chromium's error page.
        // Close that context so it cannot race the next authorized navigation.
        await closeBrowser();
        throw error;
      }
      return metadata();
    }
    case 'snapshot': return snapshot(request.maxElements);
    case 'wait_for': {
      const text = textArgument(request.text, 'text', 1000);
      const state = request.state ?? 'visible';
      const timeout = request.timeout_ms ?? 10000;
      if (!['visible', 'hidden'].includes(state)) throw new Error('Invalid wait state');
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error('Invalid wait timeout');
      await page.getByText(text, { exact: true }).first().waitFor({ state, timeout });
      snapshotVersion = '';
      return { ...await metadata(), matchedText: text, state };
    }
    case 'styles': return inspectStyles(request.ref, request.properties);
    case 'errors': {
      const result = structuredClone(events);
      if (request.clear === true) Object.values(events).forEach(entries => { entries.length = 0; });
      return { ...result, ...await metadata() };
    }
    case 'screenshot': {
      if (request.fullPage !== undefined && typeof request.fullPage !== 'boolean') throw new Error('Invalid fullPage');
      const target = request.ref ? await elementFor(request.ref) : page;
      if (request.fullPage) {
        const pixels = await page.evaluate(() => document.documentElement.scrollWidth * document.documentElement.scrollHeight);
        if (pixels > 12_000_000) throw new Error('Full-page screenshot exceeds 12 megapixels; use viewport screenshot');
      }
      const bytes = await target.screenshot({ type: 'png', ...(request.ref ? {} : { fullPage: request.fullPage || false }) });
      if (bytes.length > 12_000_000) throw new Error('Screenshot exceeds 12 MB');
      return { mimeType: 'image/png', base64: bytes.toString('base64'), width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20), ...await metadata() };
    }
    case 'click': await (await elementFor(request.ref)).click(); break;
    case 'fill': {
      if (typeof request.text !== 'string' || request.text.length > 12_000) throw new Error('Invalid text');
      await (await elementFor(request.ref)).fill(request.text); break;
    }
    case 'press': await (await elementFor(request.ref)).press(textArgument(request.key, 'key', 100)); break;
    case 'select': {
      const values = Array.isArray(request.value) ? request.value : [request.value];
      if (!values.length || values.length > 50) throw new Error('Invalid value');
      values.forEach(value => textArgument(value, 'value', 1000));
      await (await elementFor(request.ref)).selectOption(values); break;
    }
    case 'scroll': {
      const x = request.x ?? 0;
      const y = request.y ?? 0;
      if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 10_000)) throw new Error('Invalid scroll offset');
      if (request.ref) await (await elementFor(request.ref)).evaluate((element, offset) => element.scrollBy(offset), { left: x, top: y });
      else await page.evaluate(offset => window.scrollBy(offset), { left: x, top: y });
      await settleAction();
      snapshotVersion = '';
      return { ...await metadata(), ...await page.evaluate(() => ({ scrollX, scrollY })) };
    }
    default: throw new Error('Unsupported action');
  }
  await settleAction();
  snapshotVersion = '';
  return metadata();
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of input) {
    let request;
    try {
      if (line.length > 128_000) throw new Error('Request exceeds 128 KB');
      request = JSON.parse(line);
      const result = await run(request);
      process.stdout.write(`${JSON.stringify({ id: request.id ?? null, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ id: request?.id ?? null, ok: false, error: String(error.message || error).slice(0, 4000) })}\n`);
    }
    if (closed) break;
  }
} finally {
  input.close();
  await closeBrowser();
}
