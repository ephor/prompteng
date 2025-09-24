import { Hono } from 'hono';
import { WorkerEngine, registerCloudflareAssets } from '@prompteng/core/worker';

type Bindings = {
  ASSETS?: { fetch: (r: Request) => Promise<Response> };
  OPENAI_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', async (c, next) => {
  if (c.env?.ASSETS) {
    // Register assets even if the manifest is missing (dev); WorkerEngine falls back to index files.
    registerCloudflareAssets(c.env.ASSETS, (globalThis as any).__STATIC_CONTENT_MANIFEST);
  }
  const engine = new WorkerEngine('/prompts/templates');
  c.set('prompteng', engine);
  await next();
});

app.get('/some-endpoint', async (c) => {
  const engine = c.get('prompteng') as WorkerEngine;
  const sections = await engine.renderMulti('with-system', { name: 'Bob' });

  const apiKey = c.env.OPENAI_API_KEY;
  if (apiKey) {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { generateText } = await import('ai');
    const openai = createOpenAI({ apiKey });
    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      system: sections.system,
      prompt: sections.prompt,
    });
    return c.json({ res: text });
  }

  const combined = [sections.system, sections.prompt].filter(Boolean).join('\n\n');
  return c.json({ res: combined });
});

app.get('/render', async (c) => {
  const engine = c.get('prompteng') as WorkerEngine;
  const sections = await engine.renderMulti('with-system', { name: 'Bob' });
  return c.json({ sections });
});

export default app;
