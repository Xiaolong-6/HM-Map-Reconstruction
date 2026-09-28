const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function pages() {
  const response = await fetch(endpoint + "/json/list");
  if (!response.ok) throw new Error("CDP page list failed: " + response.status);
  return response.json();
}

let targets = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    targets = await pages();
    if (targets.length) break;
  } catch (_) {}
  await sleep(200);
}
const target = targets.find(item => item.type === "page");
if (!target || !target.webSocketDebuggerUrl) {
  throw new Error("No debuggable Chrome page became available.");
}

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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    exceptions.push(message.params.exceptionDetails);
  }
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await command("Runtime.enable");
await command("Page.enable");

const fileUrl = process.env.FILE_URL;
if (!fileUrl) throw new Error("FILE_URL is required.");
await command("Page.navigate", { url: fileUrl });

let state = null;
for (let attempt = 0; attempt < 150; attempt += 1) {
  const result = await command("Runtime.evaluate", {
    expression: "({readyState:document.readyState,appReady:document.documentElement.dataset.appReady||null,url:location.href,api:typeof window.MapReconstructionWeb,appState:typeof (window.MapReconstructionWeb&&window.MapReconstructionWeb.appState)})",
    returnByValue: true,
  });
  state = result.result && result.result.value;
  if (state && state.url === fileUrl && state.appReady === "true") break;
  await sleep(100);
}

socket.close();

if (!state || state.appReady !== "true") {
  const details = exceptions.map(item =>
    item.exception && item.exception.description
      ? item.exception.description
      : item.text
  );
  throw new Error(
    "Static file boot did not reach appReady. State=" +
    JSON.stringify(state) +
    (details.length ? " Exceptions=" + JSON.stringify(details) : "")
  );
}

console.log("file:// boot OK", JSON.stringify(state));
