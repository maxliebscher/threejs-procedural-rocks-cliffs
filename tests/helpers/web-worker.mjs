// Run the actual browser Worker entry in Node without changing production code.
import { parentPort, workerData } from 'node:worker_threads';
globalThis.self = {
  postMessage: (message, transfer) => parentPort.postMessage(message, transfer)
};
await import(workerData?.entry || '../../src/landscaping-worker.js');
parentPort.on('message', data => self.onmessage({ data }));
