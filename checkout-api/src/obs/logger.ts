import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',                  // Cloud logging reads "message"
    formatters: { level: (label) => ({ severity: label.toUpperCase() }) }, //... and severity
    timestamp: pino.stdTimeFunctions.isoTime,
});