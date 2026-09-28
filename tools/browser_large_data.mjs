import { writeFile } from "node:fs/promises";

const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const fileUrl = process.env.FILE_URL;
const fixture = process.env.LARGE_FIXTURE || "/tmp/hm-map-browser-large.csv";
if (!fileUrl) throw new Error("FILE_URL is required.");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function pageTargets() {
  const response = await fetch(endpoint + "/json/list");
  if (!response.ok) throw new Error("CDP page list failed: " + response.status);
  return response.json();
}
let targets = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { targets = await pageTargets(); if (targets.length) break; } catch (_) {}
  await sleep(100);
}
const target = targets.find(item => item.type === "page");
if (!target?.webSocketDebuggerUrl) throw new Error("No Chrome page target.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let nextId = 1;
const pending = new Map();
const exceptions = [];
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const current = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) current.reject(new Error(JSON.stringify(message.error)));
    else current.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails);
  }
});
function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
async function waitFor(expression, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(expression)) return;
    await sleep(80);
  }
  throw new Error("Timed out waiting for " + label + ". Exceptions=" + JSON.stringify(exceptions.map(item => item.exception?.description || item.text)));
}

const sampleCount = 120000;
const csvLines = [
  "# HappyMeasure measurement export",
  "# schema,single-v2",
  '# metadata,"{""mode"":""time"",""acceptance"":""large-browser""}"',
  "# section,data",
  "Elapsed_s,Voltage_V,Current_A",
];
for (let index = 0; index < sampleCount; index += 1) {
  const time = index * 0.0025;
  const current = -2.5e-4 + 2e-5 * Math.sin(index * 0.01);
  csvLines.push(time.toFixed(6) + ",0," + current.toPrecision(12));
}
await writeFile(fixture, csvLines.join("\n") + "\n", "utf8");

await command("Runtime.enable");
await command("Page.enable");
await command("DOM.enable");
await command("Performance.enable");
await command("Page.navigate", { url: fileUrl });
await waitFor('document.documentElement && document.documentElement.dataset.appReady==="true"', "application boot");

const documentNode = await command("DOM.getDocument", { depth: -1, pierce: true });
const inputNode = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#csv-file" });
if (!inputNode.nodeId) throw new Error("Could not find #csv-file.");
const started = performance.now();
await command("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [fixture] });
await evaluate('document.getElementById("csv-file").dispatchEvent(new Event("change",{bubbles:true}))');
await waitFor('window.MapReconstructionWeb.appState.source?.sampleCount===120000 && window.MapReconstructionWeb.appState.signal==="Current_A"', "120k HappyMeasure import", 30000);
await evaluate('document.getElementById("continue-preparation-button").click()');
await waitFor('document.querySelector(".stage-button.active")?.dataset.stage==="2" && document.getElementById("prep-x-min").value!==""', "120k preparation plot", 30000);
const elapsedMs = performance.now() - started;
const metrics = await command("Performance.getMetrics");
const metricMap = Object.fromEntries(metrics.metrics.map(item => [item.name, item.value]));
const heapBytes = Number(metricMap.JSHeapUsedSize || 0);
const sourceState = await evaluate('(() => ({samples:window.MapReconstructionWeb.appState.source.sampleCount,signal:window.MapReconstructionWeb.appState.signal,xMin:Number(document.getElementById("prep-x-min").value),xMax:Number(document.getElementById("prep-x-max").value),status:document.getElementById("status").textContent}))()');
if (!(elapsedMs < 20000)) throw new Error("120k browser import/plot took " + elapsedMs.toFixed(0) + " ms; limit is 20000 ms.");
if (heapBytes && heapBytes > 512 * 1024 * 1024) throw new Error("120k browser heap is " + heapBytes + " bytes; limit is 512 MiB.");
if (!(sourceState.xMax > sourceState.xMin)) throw new Error("120k plot axis did not initialize.");
socket.close();
console.log(JSON.stringify({sampleCount,elapsedMs:Math.round(elapsedMs),heapBytes,heapMiB:heapBytes?Number((heapBytes/1024/1024).toFixed(1)):null,sourceState},null,2));
