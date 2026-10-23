import './obs/tracing';
import "dotenv/config";

import express from "express";
import { healthRouter } from "./routes/health";
import { productsRouter } from "./routes/products";
import { ordersRouter } from "./routes/orders";
import pinoHttp from 'pino-http';
import { logger } from './obs/logger';
import { metricsMiddleware, metricsHandler } from './obs/metrics';
import { faultInjection } from './obs/fault';


const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(pinoHttp({ 
  logger,
  autoLogging: { ignore: (req) => ['/metrics', '/healthz', '/api/healthz'].includes(req.url ?? '') },
 }));

app.use(metricsMiddleware);
app.get('/metrics', metricsHandler);
app.use(faultInjection);

// Permissive CORS for local/dev use across services. Fine for this course's
// purposes — a real production API would scope this to a known storefront origin.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(healthRouter);
app.use(productsRouter);
app.use(ordersRouter);

app.listen(port, () => {
  logger.info(`FreshCart checkout-api listening on port ${port}`);
});
