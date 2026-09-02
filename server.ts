import express from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { BUS_STOPS, BUS_LINES, FARE_INFO, poleCode } from './src/data/transitData';
import { findStop, getArrivalsForStop, getScheduledBuses, planRouteBetweenStops } from './src/utils/transitEngine';
import { syncOfficialAlerts } from './src/services/alertSyncService';
import { operatorTimesForStop } from './src/services/operatorTimes';
// The same cap the search inputs enforce, imported rather than repeated: two numbers
// that must agree are one number.
import { MAX_QUERY_LENGTH } from './src/utils/searchUtils';
import { CSP_HEADER } from './src/security/csp';
import { rateLimit } from './src/security/rateLimit';

/**
 * Express parses `?q[]=a&q[]=b` into an array and `?q[x]=1` into an object, so reading a
 * query param as a string and calling .toLowerCase() on it threw and returned a stack
 * trace as HTML. Everything from the query string goes through here.
 */
function queryString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

async function startServer() {
  // Read once: the CSP below has to know, and so does the choice of Vite or dist.
  const isDev = process.argv.includes('--dev');
  const app = express();
  // Express matches routes case-insensitively by default, so /api/PLAN reached the
  // planner while every path comparison in this file and in rateLimit.ts is written in
  // lower case. The rate limiter asked `req.path.startsWith('/plan')`, got false for
  // /api/PLAN, and let 120 plans a minute through instead of 30 -- four times the CPU a
  // client can take on the one endpoint measured at ~24 ms a call. The Cache-Control
  // no-store check below had the same shape.
  //
  // Fixed here rather than at each comparison: the bug is two layers disagreeing about
  // what the path is, so there is now one rule. A URL path is case-sensitive per RFC
  // 3986 anyway, and every documented endpoint is lower case.
  app.set('case sensitive routing', true);

  app.use(express.json({ limit: '32kb' }));

  app.use((req, res, next) => {
    // The app serves no user content and embeds no third-party frames, so a tight
    // baseline costs nothing. Tiles and fonts are the only remote origins.
    //
    // Not in dev. Vite serves an inline preamble and talks to an HMR websocket, both
    // of which this policy refuses -- sending it here served a blank page and an
    // "@vitejs/plugin-react can't detect preamble" in the console. Loosening the
    // production policy to admit a development socket would be the wrong way round;
    // `pnpm build && pnpm start` serves the real thing with the header on.
    if (!isDev) res.setHeader('Content-Security-Policy', CSP_HEADER);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', rateLimit);

  // API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'Urbanos Lugo Transit API', timestamp: new Date().toISOString() });
  });

  // Get all lines
  app.get('/api/lines', (_req, res) => {
    res.json(BUS_LINES);
  });

  // Get specific line
  app.get('/api/lines/:id', (req, res) => {
    const line = BUS_LINES.find((l) => l.id === req.params.id);
    if (!line) {
      return res.status(404).json({ error: 'Line not found' });
    }
    res.json(line);
  });

  // Get all stops
  app.get('/api/stops', (req, res) => {
    const query = queryString(req.query.q).toLowerCase().trim().slice(0, MAX_QUERY_LENGTH);
    if (query) {
      const filtered = BUS_STOPS.filter(
        (s) =>
          s.id.toLowerCase().includes(query) ||
          s.code.toLowerCase().includes(query) ||
          s.name.toLowerCase().includes(query) ||
          s.address?.toLowerCase().includes(query)
      );
      return res.json(filtered);
    }
    res.json(BUS_STOPS);
  });

  // Scheduled departures for one stop, addressable by the code printed on the pole.
  //
  // Every entry carries `precision`: 'published' when the operator prints that time for
  // that stop, 'estimated' when it is computed from a departure plus measured road time.
  // Nothing here is a vehicle observation — this network publishes no position feed.
  const handleArrivals = (req: express.Request, res: express.Response) => {
    const code = queryString(req.params.code) || queryString(req.params.stopId);
    const { stop, arrivals } = getArrivalsForStop(code);

    if (!stop) {
      return res.status(404).json({ error: 'Stop not found', code });
    }

    res.json({
      stop,
      arrivals,
      // The clock the minutes were counted against, not a data freshness stamp: the
      // timetable behind this response does not change between requests.
      computedAt: new Date().toISOString(),
      source: 'timetable',
    });
  };

  app.get('/api/arrivals/:code', handleArrivals);
  app.get('/api/stop/:code/arrivals', handleArrivals);
  // Kept so existing QR links and bookmarks do not break. The name is a leftover and a
  // misleading one: it serves the same timetable-derived answer as the routes above.
  app.get('/api/realtime/:stopId', handleArrivals);

  // Get GeoJSON route for a specific line
  app.get('/api/routes/:lineId', (req, res) => {
    const lineId = req.params.lineId;
    const line = BUS_LINES.find((l) => l.id === lineId || l.number === lineId);
    if (!line) {
      return res.status(404).json({ error: 'Route not found' });
    }
    res.json({
      type: 'FeatureCollection',
      features: line.directions.map((dir) => ({
        type: 'Feature',
        properties: {
          lineId: line.id,
          lineNumber: line.number,
          name: line.name,
          direction: dir.id,
          color: line.color,
        },
        geometry: {
          type: 'LineString',
          coordinates: dir.pathCoordinates.map(([lat, lng]) => [lng, lat]),
        },
      })),
    });
  });

  // Where each run should be right now if it is keeping to its timetable.
  //
  // These are not observed vehicles. The positions are interpolated along the surveyed
  // route from the published departure, so a bus held up in traffic is still drawn on
  // schedule. Anyone consuming this must not present it as tracking.
  const handleScheduledPositions = (_req: express.Request, res: express.Response) => {
    res.json({ source: 'timetable-interpolated', buses: getScheduledBuses() });
  };

  app.get('/api/buses/scheduled-positions', handleScheduledPositions);
  // Previous name for the route above. It said "live" of something nothing observes.
  app.get('/api/buses/live', handleScheduledPositions);

  // Plan route between stops
  app.get('/api/plan', (req, res) => {
    const from = queryString(req.query.from).slice(0, MAX_QUERY_LENGTH);
    const to = queryString(req.query.to).slice(0, MAX_QUERY_LENGTH);

    if (!from || !to) {
      return res.status(400).json({ error: 'Missing from or to parameter' });
    }

    const route = planRouteBetweenStops(from, to);
    if (!route) {
      return res.status(404).json({ error: 'No route found between the specified stops' });
    }

    res.json(route);
  });

  // Service alerts (automated synchronization with official sources)
  app.get('/api/alerts', async (req, res) => {
    const force = queryString(req.query.refresh) === 'true';
    const data = await syncOfficialAlerts(force);
    res.json(data);
  });

  /**
   * What the operator says is coming at one stop.
   *
   * Only a server can ask: info.urbanoslugo.com sends no CORS header, so the browser is
   * refused. That also means this endpoint simply does not exist on the static build, and
   * the app carries on with its own estimates — which is the honest fallback, not a
   * degraded one.
   */
  app.get('/api/paradas/:code/agora', async (req, res) => {
    // Only stops this app knows. queryString narrows the type and nothing more, and
    // encodeURIComponent keeps the request inside their one path -- but without this
    // anybody could use this server to fire arbitrary codes at theirs, which is both
    // rude and pointless. A code we cannot resolve is a code they cannot either.
    const stop = findStop(queryString(req.params.code));
    if (!stop) return res.status(404).json({ error: 'Unknown stop' });
    const code = poleCode(stop);
    if (!code) return res.status(404).json({ error: 'That stop has no operator code' });
    const times = await operatorTimesForStop(code);
    // Null means the page could not be read, which is not the same as no buses coming.
    if (!times) return res.status(502).json({ error: 'The operator could not be read' });
    return res.json(times);
  });

  app.post('/api/alerts/sync', async (_req, res) => {
    const data = await syncOfficialAlerts(true);
    res.json(data);
  });

  // Fare info
  app.get('/api/fares', (_req, res) => {
    res.json(FARE_INFO);
  });

  // Unknown API paths must not fall through to the SPA shell.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  // Which client to serve is the caller's intent, not something to infer.
  //
  // Asking NODE_ENV was wrong: `npm start` does not set it, so the documented
  // production command started the dev server, which serves the whole project root —
  // package.json, server.ts, src/data, node_modules. Asking whether dist/ exists was
  // wrong the other way: after one build, `npm run dev` silently stopped using Vite and
  // served a frozen dist, so edits did nothing and a stale chunk hash broke the map.
  //
  // So `npm run dev` passes --dev and always gets Vite, and everything else serves the
  // build. With no build to serve, this says so and stops rather than quietly falling
  // back to the dev server in production.
  const distPath = path.join(process.cwd(), 'dist');

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (existsSync(path.join(distPath, 'index.html'))) {
    /**
     * Serve the compressed copy the build already wrote, when the browser accepts one.
     *
     * express.static sends bytes off disk as they are, so self-hosting was putting 544 KB
     * of entry chunk on the wire where 116 KB of brotli would do -- measured, four times
     * over, to a phone on mobile data at a bus stop. GitHub Pages compresses on its own,
     * so the published site never had this; `npm start` is the documented way to
     * self-host and it did.
     *
     * No compression happens here: vite.config.ts writes a .br and a .gz beside every
     * asset at build time, where brotli's slowest setting is affordable and is paid once
     * rather than per request. This only picks one and lets express.static do the rest --
     * which means the Content-Type still comes from the original extension, and the
     * ETag and Last-Modified come from the file actually being sent.
     *
     * Vary matters even on the misses: without it a shared cache could hand a brotli body
     * to a client that never asked for one.
     */
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
    const ENCODINGS: [string, string][] = [['br', '.br'], ['gzip', '.gz']];
    app.get(/.*/, (req, res, next) => {
      res.setHeader('Vary', 'Accept-Encoding');
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const accepted = String(req.headers['accept-encoding'] ?? '');
      for (const [token, suffix] of ENCODINGS) {
        if (!accepted.includes(token)) continue;
        // `express.static` has already refused anything outside distPath by the time this
        // matters, but the join is done from the resolved path and checked anyway: a
        // request is not allowed to name a file outside the build.
        const target = path.join(distPath, req.path + suffix);
        if (!target.startsWith(distPath) || !existsSync(target)) continue;
        // Set explicitly, because the URL now ends in .br and express.static would call
        // it an octet-stream. Only the extensions the build compresses need to be here.
        const type = TYPES[path.extname(req.path).toLowerCase()];
        if (type) res.setHeader('Content-Type', type);
        res.setHeader('Content-Encoding', token);
        req.url = req.url.replace(req.path, req.path + suffix);
        return next();
      }
      return next();
    });
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    console.error('No build in dist/. Run `npm run build` first, or `npm run dev` to develop.');
    process.exit(1);
  }

  // Anything that still throws returns JSON, not Express's HTML stack trace page.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(`${req.method} ${req.originalUrl}:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
  });

  const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

  function listenOnPort(portToTry: number) {
    const server = app.listen(portToTry, '0.0.0.0', () => {
      console.log(`\n======================================================`);
      console.log(` Urbanos Lugo Web App dispoñible en:`);
      console.log(` 👉 http://localhost:${portToTry}`);
      console.log(` 👉 http://127.0.0.1:${portToTry}`);
      console.log(`======================================================\n`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`⚠️ O porto ${portToTry} está ocupado. Probando no porto ${portToTry + 1}...`);
        listenOnPort(portToTry + 1);
      } else {
        console.error('Error starting server:', err);
      }
    });
  }

  listenOnPort(defaultPort);
}

startServer();
