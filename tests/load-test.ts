import * as net from 'node:net';

const TCP_PORT = 5000;
const HOST = 'localhost';
const CONCURRENT_DEVICES = 100;
const DURATION_SECONDS = 30;
const PING_INTERVAL_MS = 1000;

const IMEIs = Array.from({ length: CONCURRENT_DEVICES }, (_, i) => 
  (354678901234561 + i).toString().padStart(15, '0')
);

// Note: Ensure these IMEIs are seeded or handle unregistered responses
async function simulateDevice(imei: string) {
  return new Promise<void>((resolve) => {
    const client = new net.Socket();

    client.connect(TCP_PORT, HOST, () => {
      console.log(`[${imei}] Connected`);
      
      let count = 0;
      const interval = setInterval(() => {
        const lat = (18.5204 + Math.random() * 0.1).toFixed(4);
        const lng = (73.8567 + Math.random() * 0.1).toFixed(4);
        const speed = (Math.random() * 100).toFixed(1);
        const ignition = Math.random() > 0.5 ? '1' : '0';
        
        const packet = `PING,${imei},${lat},${lng},${speed},${ignition}\n`;
        client.write(packet);
        
        count++;
        if (count >= DURATION_SECONDS) {
          clearInterval(interval);
          client.end();
          resolve();
        }
      }, PING_INTERVAL_MS);
    });

    client.on('error', (err) => {
      console.error(`[${imei}] Socket Error:`, err.message);
      resolve();
    });

    client.on('close', () => {
      // console.log(`[${imei}] Closed`);
    });
  });
}

async function runTest() {
  console.log(`Starting load test: ${CONCURRENT_DEVICES} devices for ${DURATION_SECONDS}s`);
  const starts = Date.now();
  
  await Promise.all(IMEIs.map(imei => simulateDevice(imei)));
  
  const took = (Date.now() - starts) / 1000;
  console.log(`Load test finished in ${took}s`);
}

runTest().catch(console.error);
