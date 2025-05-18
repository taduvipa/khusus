export default {
  async fetch(request, env, ctx) {
    const userID = env.UUID || 'YOUR_USER_ID_FALLBACK';
    const proxyIP = env.PROXY_IP || 'YOUR_ACTUAL_BACKEND_SERVER_ADDRESS_OR_IP_FALLBACK';
    const assetPath = env.ASSET_PATH || '/your-default-path';

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      const url = new URL(request.url);
      if (url.pathname.startsWith(assetPath) || url.pathname.startsWith('/proxy' + assetPath)) {
        return new Response('Ok', { status: 200 });
      }
      return new Response('Hello! This is a Cloudflare Worker. Expecting WebSocket requests on a specific path.', { status: 200 });
    }

    return await VLESS_WS_request(request, userID, proxyIP, assetPath);
  }
};

async function VLESS_WS_request(request, userID, proxyIP, assetPath) {
  const url = new URL(request.url);
  let destPort = url.port;
  let remoteHost = proxyIP;

  if (proxyIP.includes(':')) {
    const parts = proxyIP.split(':');
    remoteHost = parts[0];
    destPort = parseInt(parts[1]) || (url.protocol === 'https:' ? 443 : 80);
  } else {
    destPort = url.protocol === 'https:' ? 443 : 80;
  }

  const scheme = 'ws';
  const destinationUrl = `${scheme}://${remoteHost}:${destPort}${assetPath}`;

  const newHeaders = new Headers();
  newHeaders.set('Host', remoteHost);
  newHeaders.set('User-Agent', request.headers.get('User-Agent') || 'CloudflareWorker');
  newHeaders.set('Upgrade', 'websocket');
  newHeaders.set('Connection', 'Upgrade');

  const newRequest = new Request(destinationUrl, {
    method: request.method,
    headers: newHeaders,
  });

  try {
    const response = await fetch(newRequest);

    if (response.status === 101 && response.webSocket) {
      const serverSocket = response.webSocket;
      const webSocketPair = new WebSocketPair();
      const [clientWebSocket, workerSideWebSocket] = Object.values(webSocketPair);

      workerSideWebSocket.accept();
      serverSocket.accept();

      serverSocket.addEventListener('message', event => {
        try {
          workerSideWebSocket.send(event.data);
        } catch (e) {
        }
      });

      workerSideWebSocket.addEventListener('message', event => {
        try {
          serverSocket.send(event.data);
        } catch (e) {
        }
      });

      const closeOrErrorHandler = (err) => {
        if (serverSocket.readyState === WebSocket.OPEN) {
            serverSocket.close(1000, "Closing");
        }
        if (workerSideWebSocket.readyState === WebSocket.OPEN) {
            workerSideWebSocket.close(1000, "Closing");
        }
      };

      serverSocket.addEventListener('close', closeOrErrorHandler);
      serverSocket.addEventListener('error', closeOrErrorHandler);
      workerSideWebSocket.addEventListener('close', closeOrErrorHandler);
      workerSideWebSocket.addEventListener('error', closeOrErrorHandler);

      return new Response(null, {
        status: 101,
        webSocket: clientWebSocket,
      });
    } else {
      const responseText = await response.text();
      return new Response(`Backend WebSocket upgrade failed: ${response.status} ${responseText}`, { status: response.status });
    }
  } catch (error) {
    return new Response('Failed to connect to backend WebSocket', { status: 502 });
  }
}
