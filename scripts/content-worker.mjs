import { parentPort } from "node:worker_threads";
import { renderDocument } from "./content-render.mjs";

/**
 * Worker thread for `scripts/generate-content.mjs`: renders the files it is
 * sent, one message per file, and reports either the document record or the
 * error text so the main thread can print every failure at once.
 */

if (!parentPort) {
  throw new Error("content-worker.mjs must run as a worker thread.");
}

parentPort.on("message", async (message) => {
  const { file } = message;
  try {
    const record = await renderDocument(file);
    parentPort.postMessage({ file, record });
  } catch (error) {
    parentPort.postMessage({
      file,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
