#!/usr/bin/env node
/* ============================================================
   관리 페이지 서버 — GitHub Codespace에서 실행
     node admin/server.js
   → 포트 3789 포워딩을 열고 브라우저에서 접속
   js/config.js 를 읽고 씁니다 (추가 의존성 없음).
   ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'js', 'config.js');
const PAGE_PATH = path.join(__dirname, 'index.html');
const PORT = process.env.PORT || 3789;

const HEADER = `/* ============================================================
   MT_CONFIG — 운영 설정 (이 파일이 곧 관리 페이지의 저장 대상)
   편집: Codespace에서  node admin/server.js  → 브라우저 UI로 수정
   직접 고칠 때는 포맷(JSON)을 유지하세요.
   version을 올리면 광고 쿨다운·해제 상태가 재무장(reset)됩니다.
   ============================================================ */
`;

function readConfig() {
  const txt = fs.readFileSync(CFG_PATH, 'utf8');
  const i = txt.indexOf('{'), j = txt.lastIndexOf('}');
  if (i < 0 || j < 0) throw new Error('config parse');
  return JSON.parse(txt.slice(i, j + 1));
}
function writeConfig(obj) {
  const body = 'window.MT_CONFIG = ' + JSON.stringify(obj, null, 2) + ';\n';
  fs.writeFileSync(CFG_PATH, HEADER + body, 'utf8');
}
function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const grp = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return 'MT-' + grp() + '-' + grp() + '-' + grp();
}

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2e6) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  try {
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(PAGE_PATH));
    }
    if (url === '/api/config' && req.method === 'GET') return json(res, 200, readConfig());
    if (url === '/api/config' && req.method === 'POST') {
      const body = await readBody(req);
      const cur = readConfig();
      const next = Object.assign({}, cur, body);
      // keep shape strict
      next.version = Math.max(1, (parseInt(body.version, 10) || cur.version || 1));
      next.support = Object.assign({ toss: '', kakao: '', bmc: '' }, body.support || {});
      next.ad = Object.assign({ enabled: false, html: '' }, body.ad || {});
      next.triggers = {
        export: Object.assign({ on: true, every: 3 }, (body.triggers || {}).export || {}),
        designs: Object.assign({ on: true, min: 5 }, (body.triggers || {}).designs || {})
      };
      next.adCloseMutes = body.adCloseMutes !== false;
      next.donorHashes = Array.isArray(body.donorHashes) ? body.donorHashes.map(String) : [];
      writeConfig(next);
      return json(res, 200, { ok: true, config: next });
    }
    if (url === '/api/donors' && req.method === 'POST') {
      const cfg = readConfig();
      const code = genCode();
      const hash = sha256Hex(code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase());
      cfg.donorHashes = cfg.donorHashes || [];
      if (!cfg.donorHashes.includes(hash)) cfg.donorHashes.push(hash);
      writeConfig(cfg);
      return json(res, 200, { ok: true, code, hash, config: cfg });
    }
    if (url === '/api/donors/revoke' && req.method === 'POST') {
      const { hash } = await readBody(req);
      const cfg = readConfig();
      cfg.donorHashes = (cfg.donorHashes || []).filter(h => h !== hash);
      writeConfig(cfg);
      return json(res, 200, { ok: true, config: cfg });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e && e.message || e) });
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('MT admin → http://localhost:' + PORT + '  (Codespace: PORT 탭에서 포워딩 열기)');
  console.log('config  : ' + CFG_PATH);
});
