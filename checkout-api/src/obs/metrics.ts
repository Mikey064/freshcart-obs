import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';

client.collectDefaultMetrics();

const requests = new client.Counter({ 
    name: 'http_requests_total', help: 'HTTP requests (traffic + errors)',
    labelNames: ['method', 'route', 'status'],
});
const duration = new client.Histogram({
    name: 'http_request_duration_seconds', help: 'Latency',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],     // 0.5 is the latency-SLO threshold 
});
new client.Gauge({
    name: 'db_pool_waiting', help: 'Requests waiting for a DB connection (saturation)', collect() { this.set(pool.waitingCount); },
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
    const end = duration.startTimer();
    res.on('finish', () => {
        const labels = { method: req.method, route: req.route?.path ?? 'unmatched', status: String(res.statusCode) };
        requests.inc(labels);
        end(labels);
    });
    next();
}

export async function metricsHandler(_req: Request, res: Response) {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
}