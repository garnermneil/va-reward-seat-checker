const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { createSummary, defaultUrl, getAnalysisOptions } = require('./index');

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const staticFiles = {
  '/': { path: 'public/index.html', contentType: 'text/html; charset=utf-8' },
  '/results.html': { path: 'public/results.html', contentType: 'text/html; charset=utf-8' },
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function handleSummary(requestUrl, response) {
  try {
    const options = getAnalysisOptions(
      Number(requestUrl.searchParams.get('slotLength')),
      requestUrl.searchParams.get('startDate'),
      requestUrl.searchParams.get('endDate'),
    );
    sendJson(response, 200, await createSummary({ url: defaultUrl, ...options }));
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

async function handleStaticFile(file, response) {
  try {
    response.writeHead(200, { 'Content-Type': file.contentType });
    response.end(await readFile(file.path));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`Unable to load ${file.path}: ${error.message}`);
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host ?? host}`);

  if (request.method === 'GET' && requestUrl.pathname === '/api/summary') {
    await handleSummary(requestUrl, response);
    return;
  }

  if (request.method === 'GET' && staticFiles[requestUrl.pathname]) {
    await handleStaticFile(staticFiles[requestUrl.pathname], response);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('Not found.');
});

server.listen(port, host, () => {
  console.log(`Reward Seat Checker is running at http://${host}:${port}`);
});
