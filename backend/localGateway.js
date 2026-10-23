'use strict';
const http = require('node:http');
const https = require('node:https');

// Enabled only by the root local launcher. API bodies must stream before express.json().
function registerLocalGateway(app, env = process.env) {
  if (env.DAI_LOCAL !== 'true') return;
  const web = new URL(env.DAI_PORTAL_WEB_ORIGIN || 'http://127.0.0.1:3104');
  const api = new URL(env.DAI_PORTAL_API_ORIGIN || 'http://127.0.0.1:8100');
  function target(req) {
    const pathname = req.url.split('?')[0];
    if (pathname === '/hospital-admin/api' || pathname.startsWith('/hospital-admin/api/')) {
      return { origin: api, url: req.url.slice('/hospital-admin'.length) };
    }
    if (pathname === '/hospital-admin' || pathname.startsWith('/hospital-admin/')) return { origin: web, url: req.url };
    return null;
  }
  app.use((req, res, next) => {
    const route = target(req);
    if (!route) return next();
    const transport = route.origin.protocol === 'https:' ? https : http;
    const upstream = transport.request(new URL(route.url, route.origin), {
      method: req.method,
      headers: { ...req.headers, host: route.origin.host, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http' }
    }, response => {
      const headers = { ...response.headers };
      // Scope the hospital refresh cookie to its own API, separate from patient/doctor login.
      if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(cookie => cookie.replace(/Path=\/api\/auth(?=;|$)/i, 'Path=/hospital-admin/api/auth'));
      res.writeHead(response.statusCode, headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.status(503).json({ error: 'Hospital/Admin service is starting or unavailable. Check the npm start terminal.' });
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  return function attachUpgrade(server) {
    server.on('upgrade', (req, socket, head) => {
      const route = target(req);
      if (!route || route.origin !== web) return socket.destroy();
      const upstream = http.request(new URL(route.url, web), { headers: { ...req.headers, host: web.host } });
      upstream.on('upgrade', (response, peer, peerHead) => {
        socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
        for (const [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${value}\r\n`);
        socket.write('\r\n');
        if (peerHead.length) socket.write(peerHead);
        if (head.length) peer.write(head);
        socket.pipe(peer).pipe(socket);
        peer.on('error', () => socket.destroy());
        socket.on('error', () => peer.destroy());
      });
      upstream.on('error', () => socket.destroy());
      upstream.end();
    });
  };
}
module.exports = { registerLocalGateway };
