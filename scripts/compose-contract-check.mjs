import { readFile } from 'node:fs/promises';

const compose = await readFile('docker-compose.yml', 'utf8');
const edgeCompose = await readFile('docker-compose.edge.yml', 'utf8');
const failures = [];

const requireFragment = (fragment, description) => {
  if (!compose.includes(fragment)) failures.push(description);
};

requireFragment('migrate:', 'missing migrate service');
requireFragment('REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379', 'migrate service must receive REDIS_URL');
requireFragment('command: ["migrate"]', 'migrate service must run the compiled migration role');
const migrationGates = compose.match(/migrate:\n\s+condition: service_completed_successfully/g) ?? [];
if (migrationGates.length !== 2) failures.push(`app and bot must wait for successful migrations (found ${migrationGates.length})`);
requireFragment('command: ["bot"]', 'bot service must run the compiled MAX role');
requireFragment('expose:', 'app and bot must use internal container exposure in the base topology');
if (!edgeCompose.includes('gateway:') || !edgeCompose.includes('nginx:1.27-alpine')) failures.push('edge Compose must define the replaceable Nginx gateway');
if (!edgeCompose.includes('./deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro')) failures.push('edge Compose must mount the gateway config read-only');
if (!edgeCompose.includes('ports: []')) failures.push('edge Compose must remove direct app and bot host ports');

if (failures.length > 0) {
  console.error(`Compose contract failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('Compose contract passed.');
