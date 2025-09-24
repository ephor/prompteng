import { WorkerEngine, registerCloudflareAssets } from '@prompteng/core/worker';

export default {
  async fetch(request: Request, env: any) {
    if (env?.ASSETS) {
      // Register assets; manifest may be absent in dev, WorkerEngine will fall back to index file
      registerCloudflareAssets(env.ASSETS, (globalThis as any).__STATIC_CONTENT_MANIFEST);
    }

    const engine = new WorkerEngine('/prompts/templates');
    const url = new URL(request.url);

    if (url.pathname === '/render') {
      const sections = await engine.renderMulti('with-system', { name: 'Ada' });
      return new Response(JSON.stringify(sections), { headers: { 'content-type': 'application/json' } });
    }

    return new Response('Not found', { status: 404 });
  }
};
