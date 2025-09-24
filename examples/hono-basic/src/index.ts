import app from './app';
import { serve } from '@hono/node-server';

const port = Number(process.env.PORT) || 3000;

serve({
  fetch: app.fetch,
  port,
});

console.log(`Hono example listening on http://localhost:${port}`);
