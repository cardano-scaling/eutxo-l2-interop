import pino from 'pino';

const pinoLevel = process.env.LOGGER_LEVEL || 'info';

export const logger = pino({
  level: pinoLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});
