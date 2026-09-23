import { readFile } from 'node:fs/promises';

const fixture = await readFile('tests/fixtures/modules/unsafe-import.ts', 'utf8');
const forbidden = /@maxhub\/max-bot-api|(?:^|['"/])(?:\.\.\/)+(?:core|platform|max|http|infrastructure)(?:['"/])/u;
if (!forbidden.test(fixture)) {
  console.error('Module boundary check failed: unsafe fixture was not recognized.');
  process.exit(1);
}
console.log('Module boundary check passed.');
