import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('optional edge topology forwards only bounded transport traffic without secrets', async () => {
  const nginx = `${await readFile('deploy/nginx/nginx.conf', 'utf8')}\n${await readFile('deploy/nginx/conf.d/portal.conf', 'utf8')}`;
  const edgeCompose = await readFile('docker-compose.edge.yml', 'utf8');
  const baseCompose = await readFile('docker-compose.yml', 'utf8');
  assert.match(nginx, /server_tokens off/u);
  assert.match(nginx, /server app:8787/u);
  assert.match(nginx, /server bot:3000/u);
  assert.match(nginx, /location = \/max\/webhook/u);
  assert.match(nginx, /X-Forwarded-Proto/u);
  assert.doesNotMatch(nginx, /BOT_TOKEN|WEBHOOK_SECRET|POSTGRES_PASSWORD|REDIS_PASSWORD|postgres:\/\//u);
  assert.match(edgeCompose, /gateway:/u);
  assert.doesNotMatch(edgeCompose, /postgres:|redis:/u);
  assert.doesNotMatch(baseCompose, /app:\s+[\s\S]*?\n\s+ports:/u);
  assert.doesNotMatch(baseCompose, /bot:\s+[\s\S]*?\n\s+ports:/u);
});
