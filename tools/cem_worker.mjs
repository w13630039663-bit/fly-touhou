/**
 * tools/cem_worker.mjs - CEM 适应度评估 worker (worker_threads)
 *
 * workerData: { graphJson: string }
 * 消息: { id, weights: number[], seeds: number[] } → { id, score }
 */
import { parentPort, workerData } from 'node:worker_threads';
import { MaleCNSConnectome } from '../src/brain/connectome.js';
import { evaluateCandidate } from '../src/brain/eval_core.js';

const brain = new MaleCNSConnectome(JSON.parse(workerData.graphJson));

parentPort.on('message', (msg) => {
  if (msg.type === 'eval') {
    let score;
    try {
      score = evaluateCandidate(Float64Array.from(msg.weights), msg.seeds, brain, msg.maxFrames || 1200);
    } catch (err) {
      score = -1;
      parentPort.postMessage({ id: msg.id, error: String(err && err.message || err) });
      return;
    }
    parentPort.postMessage({ id: msg.id, score });
  } else if (msg.type === 'shutdown') {
    parentPort.close();
  }
});
