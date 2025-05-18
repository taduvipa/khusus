// <!DOCTYPE html> // Ini adalah komentar yang terkadang ditambahkan oleh beberapa editorr, bisa dihapus.
// export default {
  /**
   * @param {import("@cloudflare/workers-types").Request} request
   * @param {{UUID: string, PROXY_IP: string, ASSET_PATH: string}} env
   * @param {import("@cloudflare/workers-types").ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    // Anda perlu mengatur variabel lingkungan (Environment Variables) di pengaturan Worker Anda di dashboard Cloudflare:
    // 1. UUID: UUID VLESS Anda (misalnya, a1b2c3d4-e5f6-7890-1234-567890abcdef)
    // 2. PROXY_IP: Alamat IP atau domain server Xray Anda yang sebenarnya (misalnya, your.backend.server.com atau 123.45.67.89)
    // 3. ASSET_PATH: Path WebSocket yang Anda konfigurasikan di server Xray Anda (misalnya, /your-secret-websocket-path). Diawali dengan '/'.

    const userID = env.UUID || 'YOUR_USER_ID_FALLBACK'; // Ganti dengan UUID VLESS Anda jika tidak menggunakan env
    const proxyIP = env.PROXY_IP || 'YOUR_ACTUAL_BACKEND_SERVER_ADDRESS_OR_IP_FALLBACK'; // Ganti dengan IP/Domain server Xray Anda
    const assetPath = env.ASSET_PATH || '/your-default-path'; // Path WebSocket Anda, harus cocok dengan server Xray

    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      const url = new URL(request.url);
      // Jika bukan permintaan WebSocket, Anda bisa menampilkan halaman statis atau pesan error
      // atau mengalihkan ke frontend yang Anda inginkan.
      // Contoh: mengembalikan status 200 OK dengan pesan sederhana.
      if (url.pathname.startsWith(assetPath) || url.pathname.startsWith('/proxy'+assetPath)) {
         // ini akan mencegah pengguna mengakses path websocket secara langsung dari browser.
        return new Response('Ok', { status: 200 });
      }
      // Untuk permintaan biasa (bukan websocket dan bukan path asset), Anda bisa melakukan proxy ke website lain
      // atau mengembalikan pesan custom.
      // Contoh sederhana:
      return new Response('Hello! This is a Cloudflare Worker. Expecting WebSocket requests on a specific path.', { status: 200 });
    }

    // Jika ini adalah permintaan WebSocket, lanjutkan untuk membuat koneksi proxy
    return await VLESS_WS_request(request, userID, proxyIP, assetPath);
  },
};

/**
 * Handles VLESS over WebSocket requests.
 * @param {Request} request The incoming request object.
 * @param {string} userID The VLESS user ID.
 * @param {string} proxyIP The IP or domain of the backend Xray server.
 * @param {string} assetPath The WebSocket path configured on the Xray server.
 * @returns {Promise<Response>} A Promise that resolves to a WebSocket response object.
 */
async function VLESS_WS_request(request, userID, proxyIP, assetPath) {
  const url = new URL(request.url);
  // Path di URL Worker bisa berbeda dengan path di server Xray.
  // Di sini kita akan mengganti hostname & path ke target server Xray.
  // Pastikan `assetPath` di server Xray Anda sama dengan yang digunakan di sini.
  const VLESS_PATH = assetPath; // Jika ada prefix pada path worker, Anda mungkin perlu menyesuaikannya.

  let destPort = url.port; // Ambil port dari URL permintaan asli jika ada
                           // Biasanya untuk WebSocket over TLS, port default adalah 443
                           // dan untuk WebSocket biasa adalah 80.
                           // Cloudflare akan menangani TLS, jadi worker akan melihat koneksi HTTP/WS.

  // Jika server Xray Anda berjalan di port non-standar, Anda perlu menentukannya di proxyIP
  // contoh: 'your.backend.server.com:4433'
  // ATAU, jika server Anda SELALU di port tertentu dan proxyIP hanya domain/IP:
  // destPort = 'YOUR_XRAY_SERVER_WS_PORT'; // misalnya 80 untuk ws, atau 443 untuk wss di backend (jika backend juga handle TLS)
  // Jika proxyIP sudah menyertakan port, kode di bawah akan mencoba mengurainya.

  let remoteHost = proxyIP;
  if (proxyIP.includes(':')) {
    const parts = proxyIP.split(':');
    remoteHost = parts[0];
    destPort = parseInt(parts[1]) || (url.protocol === 'https:' ? 443 : 80); // Default ke 443 untuk https, 80 untuk http
  } else {
    destPort = url.protocol === 'https:' ? 443 : 80; // Gunakan port standar jika tidak ada di proxyIP
  }


  // Buat URL baru yang menunjuk ke server Xray Anda
  // Penting: Skema di sini adalah `ws` atau `wss` tergantung apakah server Xray Anda
  // di `proxyIP` mengharapkan koneksi WebSocket terenkripsi atau tidak.
  // Jika Cloudflare menangani TLS (umumnya begitu), maka koneksi dari Worker ke server Xray Anda
  // bisa jadi `ws` jika server Xray Anda berada di jaringan internal atau tidak terekspos langsung ke internet dengan TLS.
  // Jika server Xray Anda juga dikonfigurasi dengan TLS dan mengharapkan `wss`, gunakan `wss`.
  // Untuk kesederhanaan dan karena Cloudflare ada di depan, seringkali `ws` sudah cukup antara Worker dan backend.
  const scheme = 'ws'; // atau 'wss' jika backend Xray Anda juga mengharapkan koneksi WebSocket terenkripsi
  const destinationUrl = `${scheme}://${remoteHost}:${destPort}${VLESS_PATH}`;


  // Siapkan header untuk koneksi ke server Xray
  // Beberapa implementasi Xray mungkin memerlukan header 'Host' yang benar
  const newHeaders = new Headers();
  newHeaders.set('Host', remoteHost); // Atur host ke host server Xray Anda
  newHeaders.set('User-Agent', request.headers.get('User-Agent') || 'CloudflareWorker');
  // Teruskan header upgrade yang diperlukan untuk WebSocket
  newHeaders.set('Upgrade', 'websocket');
  newHeaders.set('Connection', 'Upgrade');

  // Kita perlu meneruskan UUID VLESS. Beberapa implementasi mungkin mengharapkannya
  // di path atau sebagai header kustom. Kode ini tidak secara eksplisit menambahkannya
  // ke header keluar karena protokol VLESS sendiri menangani otentikasi UUID di dalam payload WebSocket.
  // Pastikan konfigurasi VLESS Anda di sisi server Xray menggunakan UUID yang sama dengan `userID`.

  // Buat permintaan baru ke server Xray Anda
  const newRequest = new Request(destinationUrl, {
    method: request.method,
    headers: newHeaders, // Gunakan header yang baru dibuat
    // body: request.body, // Biasanya tidak ada body untuk permintaan upgrade WebSocket awal
    // redirect: 'follow' // Tidak relevan untuk WebSocket
  });

  try {
    // Coba buat koneksi WebSocket ke server Xray
    const { readable, writable } = new TransformStream();
    const response = await fetch(newRequest, {
        // `backend` adalah fitur yang lebih baru untuk membuat koneksi TCP langsung,
        // namun untuk WebSocket proxy, kita cukup melakukan fetch ke endpoint WebSocket backend.
        // Cloudflare akan menangani upgrade WebSocket.
    });

    if (response.status === 101 && response.webSocket) {
      // Jika server Xray berhasil melakukan upgrade ke WebSocket
      const serverSocket = response.webSocket;

      // Buat pasangan WebSocket baru untuk komunikasi antara klien dan Worker
      const webSocketPair = new WebSocketPair();
      const [clientWebSocket, workerSideWebSocket] = Object.values(webSocketPair);

      workerSideWebSocket.accept();
      serverSocket.accept(); // Pastikan server socket juga di-accept

      // Teruskan pesan antara klien dan server Xray
      serverSocket.addEventListener('message', event => {
        try {
          workerSideWebSocket.send(event.data);
        } catch (e) {
          console.error('Error sending message from server to client:', e);
          serverSocket.close(1011, "Client error");
          workerSideWebSocket.close(1011, "Client error");
        }
      });

      workerSideWebSocket.addEventListener('message', event => {
        try {
          serverSocket.send(event.data);
        } catch (e) {
          console.error('Error sending message from client to server:', e);
          serverSocket.close(1011, "Server error");
          workerSideWebSocket.close(1011, "Server error");
        }
      });

      const closeOrErrorHandler = (err) => {
        console.log('WebSocket closed or error:', err ? err.message : 'Closed');
        if (!serverSocket.readyState !== WebSocket.CLOSED) {
            serverSocket.close(1000, "Closing");
        }
        if (!workerSideWebSocket.readyState !== WebSocket.CLOSED) {
            workerSideWebSocket.close(1000, "Closing");
        }
      };

      serverSocket.addEventListener('close', closeOrErrorHandler);
      serverSocket.addEventListener('error', closeOrErrorHandler);
      workerSideWebSocket.addEventListener('close', closeOrErrorHandler);
      workerSideWebSocket.addEventListener('error', closeOrErrorHandler);

      // Kembalikan sisi klien dari pasangan WebSocket ke browser/klien Xray
      return new Response(null, {
        status: 101,
        webSocket: clientWebSocket,
      });
    } else {
      // Jika upgrade WebSocket gagal
      console.error(`Backend WebSocket upgrade failed. Status: ${response.status}`, await response.text());
      return new Response('Backend WebSocket upgrade failed', { status: response.status });
    }
  } catch (error) {
    console.error('Error establishing WebSocket connection to backend:', error);
    return new Response('Failed to connect to backend WebSocket', { status: 502 });
  }
}
