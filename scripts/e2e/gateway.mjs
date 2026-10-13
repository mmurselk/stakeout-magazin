import http from 'node:http';
http.createServer((req, res) => {
  if (req.url.startsWith('/auth/v1/user')) {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: p.sub, aud: 'authenticated', role: 'authenticated', email: 'x@x.io', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }));
    } catch { res.writeHead(401); return res.end('{}'); }
  }
  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const up = http.request({ host: 'localhost', port: 3000, path, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(3001);
