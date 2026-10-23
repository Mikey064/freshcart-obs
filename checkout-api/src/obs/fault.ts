import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { logger } from './logger';

const SKIP = ['/metrics', '/healthz', '/api/healthz'];

export async function faultInjection(req: Request, _res: Response, next: NextFunction) {
    const delayMs = Number(process.env.FAULT_DB_DELAY_MS ?? 0);
    if (delayMs <= 0 || SKIP.includes(req.path)) return next();
    try {
        await pool.query('SELECT pg_sleep($1)', [delayMs / 1000]);
        next();
    } catch (err) {
        logger.error({ err, path: req.path }, 'db query failed or timed out waiting for  conection');
        next(err);
    }
}