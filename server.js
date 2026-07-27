const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const {
  createSummary,
  defaultUrl,
  getAnalysisOptions,
} = require('./index');
const { sendSummaryEmail } = require('./mailer');

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

async function readJson(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 1_000_000) {
      throw new Error('Request body is too large.');
    }
  }

  return JSON.parse(body);
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

async function handleEmail(request, response) {
  try {
    const { to, summary } = await readJson(request);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to ?? '')) {
      throw new Error('Enter a valid recipient email address.');
    }
    if (!summary?.bestFlights) {
      throw new Error('Search results are required before sending an email.');
    }

    const message = await sendSummaryEmail(to, summary);
    sendJson(response, 200, { messageId: message.messageId });
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

  if (request.method === 'POST' && requestUrl.pathname === '/api/email') {
    await handleEmail(request, response);
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
