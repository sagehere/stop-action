'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
function run(file,args=[],env={}){const r=spawnSync(process.execPath,[file,...args],{stdio:'inherit',env:{...process.env,...env}});if(r.status!==0)process.exit(r.status||1);}
const assets=['index.html','db.js','app.js','content.js','plans.js','plan-ui.js','training-core.js','backup.js','sw.js','manifest.webmanifest','icon.svg'];
for(const file of assets){assert.ok(fs.existsSync(file),file);if(file.endsWith('.js'))run('--check',[file]);}
const html=fs.readFileSync('index.html','utf8'),ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate HTML IDs');
for(const match of fs.readFileSync('app.js','utf8').matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(match[1]),'Missing DOM reference '+match[1]);
for(const file of assets.filter(f=>f!=='sw.js'&&f!=='index.html'))assert.ok(fs.readFileSync('sw.js','utf8').includes(file),'Offline asset missing '+file);
const compose=fs.readFileSync('deploy/docker-compose.yml','utf8');assert.ok(compose.includes('RATE_LIMIT_BACKEND: redis'));assert.ok(!/^  (nginx|caddy|traefik):/m.test(compose));
for(const file of ['tests/core.cjs','tests/sw.cjs','smoke_runtime.js','relay/test_relay.mjs','relay/test_upstream_contract.mjs','relay/test_rate_limit.mjs','e2e/test_proxy_contract.mjs','tests/security.mjs'])run(file);
run('tests/core.cjs',[],{TZ:'America/New_York'});run('tests/core.cjs',[],{TZ:'Asia/Shanghai'});
console.log('QA OK — syntax, DOM, offline assets, contracts, timezone boundaries');
