import { isIP } from 'node:net';

export function networkOrigin(url, websocket = false) {
  try {
    const parsed = new URL(url);
    if (websocket && parsed.protocol === 'ws:') parsed.protocol = 'http:';
    if (websocket && parsed.protocol === 'wss:') parsed.protocol = 'https:';
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch { return null; }
}

export function createNetworkPolicy(origins, hosts, proxy) {
  if (!Array.isArray(origins) || origins.some(value => typeof value !== 'string' || !networkOrigin(value))) {
    throw new Error('AGENT_BROWSER_ALLOWED_ORIGINS must be a JSON array of HTTP origins');
  }
  if (!Array.isArray(hosts) || hosts.some(value => typeof value !== 'string' || !value)) {
    throw new Error('AGENT_BROWSER_ALLOWED_HOSTS must be a JSON array of domain patterns');
  }
  const previews = new Set(origins.map(value => networkOrigin(value)));
  let egress;
  if (hosts.length) {
    try { egress = new URL(proxy); } catch { throw new Error('External browsing requires an egress proxy'); }
    if (egress.protocol !== 'http:' || egress.username || egress.password) {
      throw new Error('External browsing requires an HTTP egress proxy without credentials');
    }
  }
  const allows = (url, websocket = false) => {
    const origin = networkOrigin(url, websocket);
    if (!origin) return false;
    if (previews.has(origin)) return true;
    if (!egress) return false;
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    if (parsed.port || isIP(hostname) || hostname.includes(':')) return false;
    if (hostname === 'localhost' || /\.(?:localhost|local|internal|invalid|test)$/u.test(hostname)) return false;
    return hosts.some(pattern => pattern.startsWith('*.')
      ? hostname.endsWith(pattern.slice(1)) : hostname === pattern);
  };
  return { previews, egress, allows };
}
