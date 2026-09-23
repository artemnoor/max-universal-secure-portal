import { readFile } from 'node:fs/promises';

const compose = await readFile('docker-compose.yml', 'utf8');
const failures = [];

const requireFragment = (fragment, description) => {
  if (!compose.includes(fragment)) failures.push(description);
};

requireFragment('migrate:', 'missing migrate service');
requireFragment('REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379', 'migrate service must receive REDIS_URL');
requireFragment('command: ["node", "dist/entrypoints/db-migrate.js"]', 'migrate service must run the compiled migration entrypoint');
const migrationGates = compose.match(/migrate:\n\s+condition: service_completed_successfully/g) ?? [];
if (migrationGates.length !== 2) failures.push(`app and bot must wait for successful migrations (found ${migrationGates.length})`);
requireFragment('command: ["node", "dist/bot.js"]', 'bot service must run the compiled MAX entrypoint');

if (failures.length > 0) {
  console.error(`Compose contract failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('Compose contract passed.');
