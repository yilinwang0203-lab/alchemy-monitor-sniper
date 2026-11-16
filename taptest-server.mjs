// 点按测速页 + 结果回传
import {createServer} from 'node:http';
import {readFile, appendFile} from 'node:fs/promises';

const PORT = 8788;
const PAGE = '/Users/macmini/Documents/deepseek-harness/default-workspace/df-pool/taptest.html';
const LOG  = '/Users/macmini/Documents/deepseek-harness/default-workspace/df-pool/.runtime/tapspeed.log';

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const j = JSON.parse(body);
        const line = `${new Date().toISOString().slice(11,19)}  ${j.n} 下 / ${j.total}s / 平均 ${j.avg}ms / 最快 ${j.min}ms / 最慢 ${j.max}ms`;
        await appendFile(LOG, line + '\n');
        console.log('收到测速结果 →', line);
      } catch (e) { console.log('结果解析失败', e.message); }
      res.writeHead(204); res.end();
    });
    return;
  }
  try {
    const html = await readFile(PAGE);
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log('测速服务已启动 :' + PORT));
