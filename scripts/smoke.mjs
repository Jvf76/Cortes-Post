// Real HTTP integration checks. Creates disposable test accounts, never publishes.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const results = [];
async function check(name, fn) {
  await fn(); results.push(name); console.log(`PASS ${name}`);
}
function client() {
  let cookie = '', csrf = '';
  return {
    async request(path, {method = 'GET', body, withCsrf = true} = {}) {
      const headers = {cookie};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (withCsrf && csrf) headers['x-csrf-token'] = csrf;
      const response = await fetch(`${base}/api${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual', signal: AbortSignal.timeout(20000),
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) cookie = cookies.map(v => v.split(';')[0]).join('; ');
      const raw = await response.text();
      let data; try { data = JSON.parse(raw); } catch { data = raw; }
      if (data?.csrf_token) csrf = data.csrf_token;
      return {response, data};
    },
  };
}

const anon = client(), owner = client(), other = client();
await check('health through frontend proxy', async () => {
  const {response, data} = await anon.request('/health');
  assert.equal(response.status, 200); assert.equal(data.status, 'ok');
});
await check('anonymous projects denied', async () => {
  assert.equal((await anon.request('/projects')).response.status, 401);
});
await check('session cookie survives proxy; accounts isolated', async () => {
  for (const c of [owner, other]) {
    const {response, data} = await c.request('/auth/register', {method:'POST', body:{email:`smoke-${randomBytes(8).toString('hex')}@example.org`, password:randomBytes(24).toString('base64url')}});
    assert.equal(response.status, 201, JSON.stringify(data));
    assert.ok(data.user.id); assert.ok(data.csrf_token);
    assert.ok(response.headers.getSetCookie().some(v => /httponly/i.test(v)));
    assert.equal((await c.request('/auth/me')).response.status, 200);
    assert.deepEqual((await c.request('/projects')).data, []);
  }
});
await check('mutation without CSRF denied', async () => {
  const {response} = await owner.request('/projects', {method:'POST',withCsrf:false,body:{title:'Unsafe',source_url:'https://127.0.0.1/a.mp4',duration_seconds:30,rights_confirmed:true}});
  assert.equal(response.status, 403);
});
await check('private URL and missing authorization rejected', async () => {
  for (const source_url of ['https://127.0.0.1/a.mp4','https://[::1]/a.mp4','http://example.org/a.mp4','https://user:password@example.org/a.mp4']) {
    const {response, data} = await owner.request('/projects',{method:'POST',body:{title:'Unsafe',source_url,duration_seconds:30,rights_confirmed:true}});
    assert.equal(response.status,422, JSON.stringify(data));
  }
  const {response} = await owner.request('/projects',{method:'POST',body:{title:'No rights',source_url:'https://example.org/a.mp4',duration_seconds:30,rights_confirmed:false}});
  assert.equal(response.status,422);
});
await check('nonexistent clip not exposed', async () => {
  assert.equal((await other.request('/clips/00000000-0000-0000-0000-000000000000')).response.status,404);
});
await check('capabilities never expose secrets', async () => {
  const {response, data} = await owner.request('/capabilities');
  assert.equal(response.status,200);
  for (const [key,value] of Object.entries(data)) {
    assert.ok(!/secret|password|refresh_token|access_token|api_key/i.test(key),key);
    assert.ok(typeof value === 'boolean' || (key === 'whisper_model' && typeof value === 'string'),key);
  }
});
await check('logout invalidates session', async () => {
  assert.equal((await owner.request('/auth/logout',{method:'POST'})).response.status,204);
  assert.equal((await owner.request('/auth/me')).response.status,401);
});
console.log(`${results.length} HTTP checks passed. No external AI call or publication performed.`);
