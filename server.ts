import express from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { BUS_STOPS, BUS_LINES, FARE_INFO } from './src/data/transitData';
import { getArrivalsForStop } from './src/utils/arrivals';
import { getScheduledBuses } from './src/utils/vehicles';
import { planTrips } from './src/utils/planner';
import { syncOfficialAlerts } from './src/services/alertSyncService';
import { operatorTimesResponse } from './src/services/operatorTimes';
import { MAX_QUERY_LENGTH } from './src/utils/searchUtils';
import { CSP_HEADER } from './src/security/csp';
import { rateLimit } from './src/security/rateLimit';

/** Express parses `?q[]=a` into an array and `?q[x]=1` into an object; everything from the query string goes through here. */
function queryString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

/** Content types for the precompressed copies, which express.static would otherwise call octet-streams. */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const ENCODINGS: [string, string][] = [
  ['br', '.br'],
  ['gzip', '.gz'],
];

async function startServer() {
  const isDev = process.argv.includes('--dev');
  const app = express();
  // A URL path is case-sensitive per RFC 3986; without this /api/PLAN reached the planner past the rate limiter's lower-case check.
  app.set('case sensitive routing', true);
  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    // Not in dev: Vite serves an inline preamble and an HMR websocket the policy refuses.
    if (!isDev) res.setHeader('Content-Security-Policy', CSP_HEADER);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), screen-wake-lock=(self), microphone=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', rateLimit);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'Urbanos Lugo Transit API', timestamp: new Date().toISOString() }));
  app.get('/api/lines', (_req, res) => res.json(BUS_LINES));
  app.get('/api/lines/:id', (req, res) => {
    const line = BUS_LINES.find((l) => l.id === req.params.id);
    return line ? res.json(line) : res.status(404).json({ error: 'Line not found' });
  });
  app.get('/api/stops', (req, res) => {
    const query = queryString(req.query.q).toLowerCase().trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return res.json(BUS_STOPS);
    res.json(BUS_STOPS.filter((s) => s.id.toLowerCase().includes(query) || s.code.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || s.zone?.toLowerCase().includes(query)));
  });

  // Scheduled departures for one stop. Every entry carries `precision`; nothing here is a vehicle observation.
  const handleArrivals = (req: express.Request, res: express.Response) => {
    const code = queryString(req.params.code) || queryString(req.params.stopId);
    const { stop, arrivals } = getArrivalsForStop(code);
    if (!stop) return res.status(404).json({ error: 'Stop not found', code });
    // `computedAt` is the clock the minutes were counted against, not a data freshness stamp.
    res.json({ stop, arrivals, computedAt: new Date().toISOString(), source: 'timetable' });
  };
  app.get('/api/arrivals/:code', handleArrivals);
  app.get('/api/stop/:code/arrivals', handleArrivals);
  app.get('/api/realtime/:stopId', handleArrivals); // an old name kept so QR links do not break

  app.get('/api/routes/:lineId', (req, res) => {
    const line = BUS_LINES.find((l) => l.id === req.params.lineId || l.number === req.params.lineId);
    if (!line) return res.status(404).json({ error: 'Route not found' });
    res.json({
      type: 'FeatureCollection',
      features: line.directions.map((dir) => ({
        type: 'Feature',
        properties: { lineId: line.id, lineNumber: line.number, name: line.name, direction: dir.id, color: line.color },
        geometry: { type: 'LineString', coordinates: dir.pathCoordinates.map(([lat, lng]) => [lng, lat]) },
      })),
    });
  });

  // Where each run should be if it is keeping to its timetable: interpolated, never observed.
  const handleScheduledPositions = (_req: express.Request, res: express.Response) => res.json({ source: 'timetable-interpolated', buses: getScheduledBuses() });
  app.get('/api/buses/scheduled-positions', handleScheduledPositions);
  app.get('/api/buses/live', handleScheduledPositions); // the previous name, which said "live" of something nothing observes

  app.get('/api/plan', (req, res) => {
    const from = queryString(req.query.from).slice(0, MAX_QUERY_LENGTH);
    const to = queryString(req.query.to).slice(0, MAX_QUERY_LENGTH);
    if (!from || !to) return res.status(400).json({ error: 'Missing from or to parameter' });
    const route = planTrips(from, to)[0];
    return route ? res.json(route) : res.status(404).json({ error: 'No route found between the specified stops' });
  });

  app.get('/api/alerts', async (req, res) => res.json(await syncOfficialAlerts(queryString(req.query.refresh) === 'true')));
  app.post('/api/alerts/sync', async (_req, res) => res.json(await syncOfficialAlerts(true)));
  // The operator's own minutes at a stop; only a server can ask (no CORS header on their side). Shared with the Deno worker.
  app.get('/api/paradas/:code/agora', async (req, res) => {
    const { status, body } = await operatorTimesResponse(queryString(req.params.code));
    return res.status(status).json(body);
  });
  app.get('/api/fares', (_req, res) => res.json(FARE_INFO));
  // Unknown API paths must not fall through to the SPA shell.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  // Which client to serve is the caller's intent: `--dev` gets Vite, everything else the build, and no build is an error rather than a quiet fallback.
  const distPath = path.join(process.cwd(), 'dist');
  if (isDev) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else if (existsSync(path.join(distPath, 'index.html'))) {
    // Serve the compressed copy the build already wrote (vite.config.ts), when the browser accepts one:
    // express.static sends bytes off disk as they are, and self-hosting put 544 KB on the wire where 116 would do.
    app.get(/.*/, (req, res, next) => {
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const accepted = String(req.headers['accept-encoding'] ?? '');
      for (const [token, suffix] of ENCODINGS) {
        if (!accepted.includes(token)) continue;
        // A request is not allowed to name a file outside the build.
        const target = path.join(distPath, req.path + suffix);
        if (!target.startsWith(distPath) || !existsSync(target)) continue;
        const type = TYPES[path.extname(req.path).toLowerCase()];
        if (type) res.setHeader('Content-Type', type);
        res.setHeader('Content-Encoding', token);
        req.url = req.url.replace(req.path, req.path + suffix);
        return next();
      }
      return next();
    });
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    console.error('No build in dist/. Run `npm run build` first, or `npm run dev` to develop.');
    process.exit(1);
  }

  // Anything that still throws returns JSON, not Express's HTML stack trace page. The URL
  // goes as an argument, never into the format string: `/%s` would swallow the error.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('request failed:', req.method, req.originalUrl, err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });

  // Fails on a busy port rather than quietly moving to the next one; PORT exists for choosing another.
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(` Urbanos Lugo Web App dispoñible en:`);
    console.log(` 👉 http://localhost:${port}`);
    console.log(` 👉 http://127.0.0.1:${port}`);
    console.log(`======================================================\n`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') console.error(`O porto ${port} está ocupado. Libérao, ou escolle outro con PORT=${port + 1}.`);
    else console.error('Error starting server:', err);
    process.exitCode = 1;
  });
}

startServer();
