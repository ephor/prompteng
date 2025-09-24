import { Hono } from 'hono';
import { PromptEngine } from '@prompteng/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const templatesDir = join(__dirname, '../templates');
const engine = new PromptEngine(templatesDir);

const app = new Hono();

app.get('/sections', async (c) => {
  const sections = await engine.renderMulti('with-system', { name: 'Ada' });
  return c.json({ sections });
});

app.get('/text', async (c) => {
  const text = await engine.render('with-system', { name: 'Ada' });
  return c.json({ text });
});

export default app;
