// 로컬 미리보기: docs/ 를 http://localhost:3000 으로 서빙 (수집은 npm run once)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { DOCS } from './store.js';

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/]\.\.)+/, '');
  const file = join(DOCS, p.endsWith('/') || p === '\\' ? 'index.html' : p);
  if (!file.startsWith(DOCS)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(3000, '127.0.0.1', () => console.log('미리보기: http://localhost:3000'));
