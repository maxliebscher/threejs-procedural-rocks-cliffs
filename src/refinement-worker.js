// At most one job. A cancel message cannot interrupt synchronous extraction:
// terminate the worker instead, then lazily start a fresh one after debounce.
export class RefinementWorker {
  constructor(createWorker = () => new Worker(new URL('./landscaping-worker.js', import.meta.url), {type: 'module'})) {
    this.createWorker = createWorker;
    this.job = null;
  }

  cancel() {
    const job = this.job;
    if (!job) return;
    this.job = null;
    job.worker.terminate();
    job.resolve(null);
  }

  build(input) {
    this.cancel();
    return new Promise((resolve, reject) => {
      let worker;
      try { worker = this.createWorker(); }
      catch (error) { reject(error); return; }
      const job = {worker, resolve};
      this.job = job;
      const finish = (error, result) => {
        if (this.job !== job) return;
        this.job = null;
        worker.terminate();
        if (error) reject(error); else resolve(result);
      };
      worker.onmessage = ({data}) => finish(data.error ? new Error(data.error) : null, data.result);
      worker.onerror = event => {
        event.preventDefault?.();
        finish(new Error(event.message || 'Geometry worker failed'));
      };
      worker.onmessageerror = () => finish(new Error('Geometry worker result could not be decoded'));
      try { worker.postMessage(input); } catch (error) { finish(error); }
    });
  }
}
