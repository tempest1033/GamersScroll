const http = require('http');
const fs = require('fs');
const path = require('path');
const mimes = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.xml':'application/xml','.ico':'image/x-icon'};
const PORT = process.argv[2] || 3001;

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  let fp = path.join(__dirname, url);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    fp = path.join(fp, 'index.html');
  }
  if (!fs.existsSync(fp)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(fp);
  res.writeHead(200, {'Content-Type': mimes[ext] || 'application/octet-stream'});
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => {
  console.log('Serving on http://localhost:' + PORT);
});
