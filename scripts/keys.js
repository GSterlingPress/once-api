import { FileApiKeyStore } from '../src/auth.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'list';
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const store = new FileApiKeyStore();

if (command === 'issue') {
  const name = value('name', 'default');
  const monthlyQuota = Number(value('quota', '10000'));
  const created = await store.issue({ name, monthlyQuota });
  console.log('API KEY CREATED — copy it now; ONCE stores only its hash.');
  console.log(created.apiKey);
  console.log(JSON.stringify({ id: created.id, name: created.name, keyPrefix: created.keyPrefix, monthlyQuota: created.monthlyQuota }, null, 2));
} else if (command === 'revoke') {
  const id = args[1];
  if (!id) throw new Error('Usage: npm run key:revoke -- <key-id>');
  const ok = await store.revoke(id);
  console.log(ok ? `Revoked ${id}` : `No key found for ${id}`);
  process.exitCode = ok ? 0 : 1;
} else if (command === 'list') {
  console.table(await store.list());
} else {
  throw new Error(`Unknown command: ${command}`);
}
