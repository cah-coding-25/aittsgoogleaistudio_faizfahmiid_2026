import { Request } from 'express';
import { sanitizeClientId } from '../config/config.ts';

export function extractClientId(req: Request): string {
  const header = (req.headers['x-client-id'] || req.headers['x-session-token']) as string | undefined;
  const query = req.query.clientId as string | undefined;
  const body = req.body?.clientId as string | undefined;
  return sanitizeClientId(header || query || body || 'default');
}
