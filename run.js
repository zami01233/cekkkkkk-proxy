const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const https = require('https');
const { URL } = require('url');

// KONFIGURASI
const TEST_URL = 'http://httpbin.org/ip'; // Target yang lebih ramah
const TIMEOUT = 10000; // 10 detik
const MAX_WORKERS = 200;
const PROXY_FILE = 'proxy.txt';
const ACTIVE_FILE = 'aktif.txt';

if (isMainThread) {
  let proxies = [];
  try {
    proxies = fs.readFileSync(PROXY_FILE, 'utf-8')
      .split('\n')
      .map(p => p.trim())
      .filter(p => p);
  } catch (err) {
    console.error(`Error membaca file proxy: ${err.message}`);
    process.exit(1);
  }

  if (proxies.length === 0) {
    console.log('Tidak ada proxy di file proxy.txt');
    process.exit();
  }

  console.log(`Memulai scan ${proxies.length} proxy...`);
  fs.writeFileSync(ACTIVE_FILE, '');
  
  const chunkSize = Math.ceil(proxies.length / MAX_WORKERS);
  const chunks = [];
  for (let i = 0; i < proxies.length; i += chunkSize) {
    chunks.push(proxies.slice(i, i + chunkSize));
  }

  const activeProxies = [];
  let completedWorkers = 0;
  let checkedCount = 0;

  chunks.forEach((chunk) => {
    const worker = new Worker(__filename, {
      workerData: { 
        proxies: chunk, 
        TEST_URL, 
        TIMEOUT 
      }
    });

    worker.on('message', (message) => {
      if (message.type === 'active') {
        activeProxies.push(message.proxy);
        fs.appendFileSync(ACTIVE_FILE, message.proxy + '\n');
      } else if (message.type === 'progress') {
        checkedCount += message.count;
        process.stdout.write(`\rProxy dicek: ${checkedCount}/${proxies.length} | Aktif: ${activeProxies.length}`);
      }
    });

    worker.on('error', (err) => {
      console.error(`\nWorker error: ${err.message}`);
    });

    worker.on('exit', () => {
      completedWorkers++;
      if (completedWorkers === chunks.length) {
        console.log(`\n\nSelesai! ${activeProxies.length} proxy aktif tersimpan di ${ACTIVE_FILE}`);
      }
    });
  });
} else {
  const { proxies, TEST_URL, TIMEOUT } = workerData;

  const testProxy = async (proxyUrl) => {
    try {
      const url = new URL(proxyUrl);
      const host = url.hostname;
      const port = url.port;
      
      if (!host || !port) return false;

      // Handle autentikasi
      const auth = url.username ? {
        username: url.username,
        password: url.password
      } : null;

      const agent = new https.Agent({
        proxy: {
          host,
          port: parseInt(port),
          protocol: url.protocol,
          ...(auth && { auth: `${auth.username}:${auth.password}` })
        },
        timeout: TIMEOUT,
        rejectUnauthorized: false
      });

      // Gunakan User-Agent acak
      const headers = {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${Math.floor(Math.random() * 20) + 100}.0.0.0 Safari/537.36`
      };

      const response = await axios.get(TEST_URL, {
        httpsAgent: agent,
        timeout: TIMEOUT,
        headers,
        validateStatus: () => true // Terima semua status code
      });

      // Cek respon valid (2xx/3xx atau mengandung IP)
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      return false;
    }
  };

  (async () => {
    for (const proxy of proxies) {
      const isActive = await testProxy(proxy);
      if (isActive) {
        parentPort.postMessage({ type: 'active', proxy });
      }
      parentPort.postMessage({ type: 'progress', count: 1 });
    }
    parentPort.close();
  })();
}
