// Local API contract test, never downloads a YouTube video.
// Requires the project's worker AND scheduler stopped; guard checks Docker first.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const docker = process.env.DOCKER_EXE || resolve(process.env.LOCALAPPDATA, 'Programs/DockerDesktop/resources/bin/docker.exe');
const running = execFileSync(docker, ['compose', 'ps', '--status', 'running', '--services'], {encoding:'utf8'}).trim().split(/\s+/);
assert.ok(!running.includes('worker') && !running.includes('scheduler'), 'Stop worker and scheduler before this contract-only test');
const base = 'http://localhost:3000/api';
let cookie = '', csrf = '';
async function request(path, method='GET', body) {
  const response = await fetch(base + path, {
    method, headers:{cookie, 'x-csrf-token':csrf, 'content-type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(15000),
  });
  const cookies = response.headers.getSetCookie();
  if(cookies.length) cookie = cookies.map(v => v.split(';')[0]).join('; ');
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if(data?.csrf_token) csrf = data.csrf_token;
  return {status:response.status, data};
}
const registered = await request('/auth/register','POST', {
  email:`youtube-contract-${randomBytes(8).toString('hex')}@example.org`, password:randomBytes(24).toString('base64url'),
});
assert.equal(registered.status,201);
const body = {title:'Contrato local sem download', source_url:'https://youtu.be/AbCdEf12_-3?list=PL123', duration_seconds:30, rights_confirmed:true, editing_instructions:'Priorize exemplos práticos; evite a introdução.'};
for (const source_url of ['https://youtube.com/playlist?list=PL123','https://youtube.com/@canal','https://youtube.com.evil.example/watch?v=AbCdEf12_-3']) {
  assert.equal((await request('/projects','POST',{...body,source_url})).status,422);
}
assert.equal((await request('/projects','POST',{...body,rights_confirmed:false})).status,422);
assert.equal((await request('/projects','POST',{...body,editing_instructions:'x'.repeat(2001)})).status,422);
const created = await request('/projects','POST',body);
assert.equal(created.status,201,JSON.stringify(created.data));
const id = created.data.id;
try {
  assert.equal(created.data.status,'queued');
  assert.equal(created.data.editing_instructions,body.editing_instructions);
  const detail = await request(`/projects/${id}`);
  assert.equal(detail.status,200);
  assert.equal(detail.data.editing_instructions,body.editing_instructions);
  assert.equal(detail.data.status,'queued');
} finally {
  assert.equal((await request(`/projects/${id}`,'DELETE')).status,204);
}
assert.equal((await request(`/projects/${id}`)).status,404);
console.log('PASS YouTube URL creation, rights/URL/length rejection, instruction persistence and cancellation before worker start; no download performed');
