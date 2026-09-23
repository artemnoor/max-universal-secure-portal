import { readFile } from 'node:fs/promises';

const events = JSON.parse(await readFile('contracts/events.schema.json', 'utf8'));
const openapi = await readFile('contracts/openapi.yaml', 'utf8');
const source = await readFile('src/portal/contracts.ts', 'utf8');
const failures = [];

if (events.$schema !== 'https://json-schema.org/draft/2020-12/schema') failures.push('events schema must use JSON Schema 2020-12');
if (!Array.isArray(events.required) || !['eventId', 'kind', 'principal', 'payload', 'receivedAt'].every((key) => events.required.includes(key))) failures.push('events schema must require the complete event envelope');
if (!openapi.includes('openapi: 3.1.0') || !openapi.includes('/api/v1/portal/info:') || !openapi.includes('/internal/metrics:') || !openapi.includes('metricsBearer:')) failures.push('OpenAPI contract is missing a required stable path or security scheme');
if (!source.includes('export type PortalEvent') || !source.includes("'message'") || !source.includes("'callback'")) failures.push('runtime event types no longer expose the documented envelope kinds');
if (failures.length > 0) {
  console.error(`Contract check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Shared contract check passed.');
