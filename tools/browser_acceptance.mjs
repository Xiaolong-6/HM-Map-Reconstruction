import { mkdir, writeFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.CDP_ENDPOINT || "http://127.0.0.1:9222";
const fileUrl = process.env.FILE_URL;
const screenshotDir = process.env.SCREENSHOT_DIR || "dist/ui-review";
const fixturePath = path.resolve(process.env.FIXTURE_PATH || "/tmp/HM_20260911_122734_Ge45o_3_very_long_measurement_filename_for_layout_acceptance.csv");
const downloadDir = path.resolve(process.env.DOWNLOAD_DIR || "/tmp/hm-map-browser-downloads");
if (!fileUrl) throw new Error("FILE_URL is required.");

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function pageTargets() {
  const response = await fetch(endpoint + "/json/list");
  if (!response.ok) throw new Error("CDP page list failed: " + response.status);
  return response.json();
}

let targets = [];
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    targets = await pageTargets();
    if (targets.length) break;
  } catch (_) {}
  await sleep(150);
}
const target = targets.find(item => item.type === "page");
if (!target || !target.webSocketDebuggerUrl) throw new Error("No Chrome page target.");

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
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitFor(expression, label, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(80);
  }
  throw new Error("Timed out waiting for " + label + ". Exceptions=" + JSON.stringify(
    exceptions.map(item => item.exception?.description || item.text)
  ));
}

async function click(id) {
  const ok = await evaluate(`(() => {
    const node=document.getElementById(${JSON.stringify(id)});
    if(!node) return false;
    node.click();
    return true;
  })()`);
  if (!ok) throw new Error("Missing clickable #" + id);
  await sleep(120);
}

async function setValue(id, value, eventType = "input") {
  const ok = await evaluate(`(() => {
    const node=document.getElementById(${JSON.stringify(id)});
    if(!node) return false;
    node.value=${JSON.stringify(String(value))};
    node.dispatchEvent(new Event(${JSON.stringify(eventType)},{bubbles:true}));
    return true;
  })()`);
  if (!ok) throw new Error("Missing input #" + id);
  await sleep(80);
}

async function screenshot(name) {
  await mkdir(screenshotDir, { recursive: true });
  const result = await command("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(path.join(screenshotDir, name + ".png"), Buffer.from(result.data, "base64"));
}

async function waitForDownloadedProject(timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const names = await readdir(downloadDir).catch(() => []);
    const candidate = names.find(name => name.endsWith(".hmmap") && !name.endsWith(".crdownload"));
    if (candidate) {
      const fullPath = path.join(downloadDir, candidate);
      const info = await stat(fullPath);
      if (info.size > 100) return fullPath;
    }
    await sleep(100);
  }
  throw new Error("Timed out waiting for downloaded .hmmap.");
}

async function layoutContract(stageNumber) {
  const result = await evaluate(`(() => {
    const stage=document.querySelector(".stage.active");
    const control=stage?.querySelector(".control-panel");
    const workspace=stage?.querySelector(".workspace");
    const rect=stage?.getBoundingClientRect();
    return {
      stage:Number(document.querySelector(".stage-button.active")?.dataset.stage),
      bodyOverflow:getComputedStyle(document.body).overflowY,
      scrollHeight:document.scrollingElement.scrollHeight,
      scrollWidth:document.scrollingElement.scrollWidth,
      innerHeight,innerWidth,
      controlOverflow:control?getComputedStyle(control).overflowY:null,
      workspaceOverflow:workspace?getComputedStyle(workspace).overflowY:null,
      workspaceClientHeight:workspace?.clientHeight||0,
      workspaceScrollHeight:workspace?.scrollHeight||0,
      top:rect?.top,bottom:rect?.bottom,
    };
  })()`);
  const workspaceOverflowOkay = stageNumber === 3
    ? result.workspaceOverflow === "hidden"
    : result.workspaceOverflow === "auto";
  const stage3Fits = stageNumber !== 3 ||
    result.workspaceScrollHeight <= result.workspaceClientHeight + 1;
  if (
    result.stage !== stageNumber ||
    result.bodyOverflow !== "hidden" ||
    result.controlOverflow !== "auto" ||
    !workspaceOverflowOkay ||
    !stage3Fits ||
    result.scrollHeight > result.innerHeight + 1 ||
    result.scrollWidth > result.innerWidth + 1 ||
    result.top < -1 || result.bottom > result.innerHeight + 1
  ) {
    throw new Error("Stage " + stageNumber + " layout contract failed: " + JSON.stringify(result));
  }
}

await command("Runtime.enable");
await command("Page.enable");
await command("DOM.enable");
await command("Input.setIgnoreInputEvents", { ignore: false });
await rm(downloadDir, { recursive: true, force: true });
await mkdir(downloadDir, { recursive: true });
try {
  await command("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
    eventsEnabled: true,
  });
} catch (_) {
  await command("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir,
  });
}
await command("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});
await command("Page.navigate", { url: fileUrl });
await waitFor(
  'document.documentElement.dataset.appReady==="true"',
  "application boot"
);

const pickerButtonContract = await evaluate(`(() => {
  const input=document.getElementById("csv-file");
  const button=document.getElementById("open-data-button");
  let calls=0;
  const original=input.click;
  input.click=()=>{calls+=1;};
  button.click();
  input.click=original;
  return calls;
})()`);
if (pickerButtonContract !== 1) {
  throw new Error("Open data button did not trigger the file input exactly once.");
}

// Build a generic table with dense time sampling and repeatable signal content.
const lines = ["time,current,aux"];
for (let index = 0; index <= 2400; index += 1) {
  const t = index * 0.05;
  const pixel = Math.floor((t % 10) / 1);
  const row = Math.floor(t / 10);
  const current = 1e-6 * (1 + row * 0.1 + pixel * 0.03) + 1e-8 * Math.sin(index * 0.2);
  lines.push(t.toFixed(4) + "," + current.toPrecision(12) + "," + (index % 17));
}
await writeFile(fixturePath, lines.join("\n") + "\n", "utf8");

// Set the real file input through CDP.
const documentNode = await command("DOM.getDocument", { depth: -1, pierce: true });
const inputNode = await command("DOM.querySelector", {
  nodeId: documentNode.root.nodeId,
  selector: "#csv-file",
});
if (!inputNode.nodeId) throw new Error("Could not find #csv-file.");
await command("DOM.setFileInputFiles", {
  nodeId: inputNode.nodeId,
  files: [fixturePath],
});
await evaluate('document.getElementById("csv-file").dispatchEvent(new Event("change",{bubbles:true}))');
await waitFor(
  'document.getElementById("generic-import-controls").hidden===false && !document.getElementById("import-data-button").disabled',
  "generic import mapping"
);

// Map time + current and commit.
await evaluate(`(() => {
  const time=document.getElementById("import-time-column");
  const signals=document.getElementById("import-signal-columns");
  for(const option of time.options) if(option.textContent.startsWith("time")) time.value=option.value;
  for(const option of signals.options) option.selected=option.textContent.startsWith("current");
  return true;
})()`);
await click("import-data-button");
await waitFor(
  'window.MapReconstructionWeb.appState.source?.sampleCount===2401',
  "generic source commit"
);
const sourceSummaryLayout = await evaluate(`(() => {
  const summary=document.getElementById("source-summary");
  const rect=summary.getBoundingClientRect();
  const file=summary.querySelector(".summary-file");
  const rows=[...summary.querySelectorAll("dd")].map(node=>({
    text:node.textContent,
    right:node.getBoundingClientRect().right,
    width:node.getBoundingClientRect().width
  }));
  return {
    summaryRight:rect.right,
    scrollWidth:summary.scrollWidth,
    clientWidth:summary.clientWidth,
    fileText:file?.textContent||"",
    fileTitle:file?.getAttribute("title")||"",
    rows
  };
})()`);
if (
  sourceSummaryLayout.scrollWidth > sourceSummaryLayout.clientWidth + 1 ||
  sourceSummaryLayout.rows.some(row => row.right > sourceSummaryLayout.summaryRight + 1) ||
  !sourceSummaryLayout.fileText.includes("very_long_measurement_filename") ||
  sourceSummaryLayout.fileTitle !== sourceSummaryLayout.fileText
) {
  throw new Error("Source summary overflow/truncation contract failed: " + JSON.stringify(sourceSummaryLayout));
}
await layoutContract(1);
const stageSidebarWidths = [];
stageSidebarWidths.push(await evaluate('document.querySelector("#stage-1 .control-panel").getBoundingClientRect().width'));
await screenshot("01-import-data");

// Step 2: Preparation plot.
await click("continue-preparation-button");
await waitFor(
  'document.querySelector(".stage-button.active")?.dataset.stage==="2"',
  "Signal Preparation stage"
);
await waitFor(
  'document.getElementById("trace-canvas").width>1 && document.getElementById("prep-x-min").value!==""',
  "preparation trace render"
);
const beforeZoom = await evaluate('Number(document.getElementById("prep-x-max").value)-Number(document.getElementById("prep-x-min").value)');
await evaluate(`(() => {
  const canvas=document.getElementById("trace-canvas");
  const r=canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent("wheel",{
    deltaY:-320,clientX:r.left+r.width*0.55,clientY:r.top+r.height*0.5,
    bubbles:true,cancelable:true
  }));
  return true;
})()`);
await sleep(180);
const afterZoom = await evaluate('Number(document.getElementById("prep-x-max").value)-Number(document.getElementById("prep-x-min").value)');
if (!(afterZoom < beforeZoom)) throw new Error("Preparation wheel zoom did not change X range.");
await click("prep-autoscale");

// Draw one real dark region using mouse input.
await click("add-dark-region");
const traceRect = await evaluate(`(() => {
  const r=document.getElementById("trace-canvas").getBoundingClientRect();
  return {left:r.left,top:r.top,width:r.width,height:r.height};
})()`);
const y = traceRect.top + traceRect.height * 0.45;
const x1 = traceRect.left + 105;
const x2 = traceRect.left + 245;
await command("Input.dispatchMouseEvent",{type:"mousePressed",x:x1,y,button:"left",clickCount:1});
await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:x2,y,button:"left",buttons:1});
await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:x2,y,button:"left",clickCount:1});
await waitFor(
  'document.getElementById("manual-regions").value.includes(",")',
  "dark-region drag"
);
const prepHiddenContract = await evaluate(`(() => ({
  gateHidden: getComputedStyle(document.getElementById("gate-fields")).display === "none"
}))()`);
if (!prepHiddenContract.gateHidden) throw new Error("Inactive gate controls must stay hidden.");
await layoutContract(2);
stageSidebarWidths.push(await evaluate('document.querySelector("#stage-2 .control-panel").getBoundingClientRect().width'));
await screenshot("02-signal-preparation");

// Step 3: geometry-driven registration recommendation on a trace with 10 s row / 1 s point periods.
await click("continue-reconstruction-button");
await setValue("map-rows",12);
await setValue("map-cols",10);
await click("recommend-registration-button");
await waitFor(
  'document.getElementById("registration-recommendation").textContent.includes("Y period")',
  "registration recommendation"
);
const recommended = await evaluate(`(() => {
  const rowsApart=Number(document.getElementById("rows-apart").value);
  const pointsApart=Number(document.getElementById("points-apart").value);
  return {
    rowPeriod:(Number(document.getElementById("row-b").value)-Number(document.getElementById("row-a").value))/rowsApart,
    pointPeriod:(Number(document.getElementById("point-b").value)-Number(document.getElementById("point-a").value))/pointsApart,
    xPhase:Number(document.getElementById("x-phase").value),
    text:document.getElementById("registration-recommendation").textContent
  };
})()`);
if (!(recommended.rowPeriod > 8.5 && recommended.rowPeriod < 11.5)) {
  throw new Error("Recommended Y period missed browser fixture: " + JSON.stringify(recommended));
}
if (!(recommended.pointPeriod > 0.75 && recommended.pointPeriod < 1.25)) {
  throw new Error("Recommended X period missed browser fixture: " + JSON.stringify(recommended));
}
if (!(recommended.xPhase >= 0 && recommended.xPhase < 1)) {
  throw new Error("Recommended X phase is invalid: " + JSON.stringify(recommended));
}

// Continue with the small 5×5 reconstruction used by the interaction acceptance.
await setValue("map-rows",5);
await setValue("map-cols",5);
await setValue("row-a",10);
await setValue("row-b",60);
await setValue("rows-apart",5);
await setValue("row-offset",0);
await setValue("point-a",1);
await setValue("point-b",5);
await setValue("points-apart",4);
await setValue("y-phase",0);
await setValue("x-period-offset",0);
await setValue("x-phase",0.5);
await setValue("window-fraction",0.65);
const precisionContract = await evaluate(`(() => ({
  yPhaseStep: document.getElementById("y-phase").step,
  xPhaseStep: document.getElementById("x-phase").step,
  windowFractionStep: document.getElementById("window-fraction").step
}))()`);
if (
  precisionContract.yPhaseStep !== "0.001" ||
  precisionContract.xPhaseStep !== "0.001" ||
  precisionContract.windowFractionStep !== "0.001"
) throw new Error("Fine registration step contract failed: " + JSON.stringify(precisionContract));
const reconstructButtonPresent = await evaluate('Boolean(document.getElementById("reconstruct-button"))');
if (reconstructButtonPresent) throw new Error("Manual Reconstruct button must not exist.");
await waitFor(
  'window.MapReconstructionWeb.appState.reconstruction?.values?.length===25',
  "automatic phase-window reconstruction"
);
const finitePixels = await evaluate(
  'Array.from(window.MapReconstructionWeb.appState.reconstruction.values).filter(Number.isFinite).length'
);
if (finitePixels < 20) throw new Error("Too few finite reconstructed pixels: " + finitePixels);

// Editing a numeric registration field must automatically update the model.
const beforeRowA = await evaluate('window.MapReconstructionWeb.appState.reconstructionParams.row_a_s');
await setValue("row-a", 11);
await waitFor(
  'window.MapReconstructionWeb.appState.reconstructionParams?.row_a_s===11',
  "automatic reconstruction after numeric edit"
);
const afterRowA = await evaluate('window.MapReconstructionWeb.appState.reconstructionParams.row_a_s');
if (afterRowA === beforeRowA) throw new Error("Registration edit did not update reconstruction automatically.");

// Drag YA marker and ensure numeric value changes + reconstruction returns.
const markerBefore = await evaluate('Number(document.getElementById("row-a").value)');
const regGeometry = await evaluate(`(() => {
  const c=document.getElementById("registration-trace-canvas");
  const r=c.getBoundingClientRect();
  const xmin=Number(document.getElementById("registration-x-min").value);
  const xmax=Number(document.getElementById("registration-x-max").value);
  const marker=Number(document.getElementById("row-a").value);
  const left=r.left+68, right=r.right-24;
  const x=left+(marker-xmin)/(xmax-xmin)*(right-left);
  return {x,y:r.top+80};
})()`);
await command("Input.dispatchMouseEvent",{type:"mousePressed",x:regGeometry.x,y:regGeometry.y,button:"left",clickCount:1});
await command("Input.dispatchMouseEvent",{type:"mouseMoved",x:regGeometry.x+30,y:regGeometry.y,button:"left",buttons:1});
await command("Input.dispatchMouseEvent",{type:"mouseReleased",x:regGeometry.x+30,y:regGeometry.y,button:"left",clickCount:1});
await sleep(250);
const markerAfter = await evaluate('Number(document.getElementById("row-a").value)');
if (!(markerAfter > markerBefore)) throw new Error("YA marker drag did not update row-a.");
await waitFor(
  'window.MapReconstructionWeb.appState.reconstruction?.values?.length===25',
  "reconstruction after marker drag"
);
const reconstructionUiContract = await evaluate(`(() => ({
  durationHidden: getComputedStyle(document.getElementById("window-duration").closest(".field")).display === "none",
  summaryText: document.getElementById("reconstruction-summary").textContent
}))()`);
if (!reconstructionUiContract.durationHidden) throw new Error("Fixed-duration control must be hidden in fraction mode.");
if (reconstructionUiContract.summaryText.includes("No reconstruction")) throw new Error("Reconstruction summary is stale.");
// Wheel zoom must alter the rendered map and Reset map view must restore it.
const mapBeforeZoom = await evaluate('document.getElementById("map-canvas").toDataURL("image/png")');
await evaluate(`(() => {
  const canvas=document.getElementById("map-canvas");
  const r=canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent("wheel",{
    deltaY:-360,
    clientX:r.left+r.width*0.5,
    clientY:r.top+r.height*0.5,
    bubbles:true,
    cancelable:true
  }));
  return true;
})()`);
await sleep(160);
const mapAfterZoom = await evaluate('document.getElementById("map-canvas").toDataURL("image/png")');
if (mapAfterZoom === mapBeforeZoom) throw new Error("Map wheel zoom did not change rendered viewport.");
await click("reset-reconstruction-maps");
await layoutContract(3);
stageSidebarWidths.push(await evaluate('document.querySelector("#stage-3 .control-panel").getBoundingClientRect().width'));
const recommendationHelperContract = await evaluate(`(() => ({
  hidden: document.getElementById("registration-recommendation").hidden,
  buttonTitle: document.getElementById("recommend-registration-button").title
}))()`);
if (!recommendationHelperContract.buttonTitle.includes("Uses the prepared trace")) {
  throw new Error("Recommendation help must live in the hover title.");
}
const reconstructionControlFit = await evaluate(`(() => {
  const panel=document.querySelector("#stage-3 .control-panel");
  panel.scrollTop=0;
  const rect=panel.getBoundingClientRect();
  const last=document.getElementById("phase-aggregation").getBoundingClientRect();
  return {panelBottom:rect.bottom,lastBottom:last.bottom,scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight};
})()`);
if (reconstructionControlFit.lastBottom > reconstructionControlFit.panelBottom + 1) {
  throw new Error("Stage 3 registration controls should fit the initial sidebar viewport: " + JSON.stringify(reconstructionControlFit));
}
const reconstructionViewportFit = await evaluate(`(() => {
  const workspace=document.querySelector("#stage-3 .workspace").getBoundingClientRect();
  const trace=document.querySelector("#stage-3 .registration-trace-card").getBoundingClientRect();
  const maps=document.querySelector("#stage-3 .map-grid").getBoundingClientRect();
  return {
    workspaceBottom:workspace.bottom,
    traceHeight:trace.height,
    mapsBottom:maps.bottom,
    mapsHeight:maps.height,
  };
})()`);
if (
  reconstructionViewportFit.mapsBottom > reconstructionViewportFit.workspaceBottom + 1 ||
  reconstructionViewportFit.traceHeight < 190 ||
  reconstructionViewportFit.mapsHeight < 220
) {
  throw new Error("Reconstruction three-view fit failed: " + JSON.stringify(reconstructionViewportFit));
}
const mapLayout = await evaluate(`(() => {
  const map=document.getElementById("map-canvas").getBoundingClientRect();
  const count=document.getElementById("count-canvas").getBoundingClientRect();
  return {
    mapWidth:map.width,
    mapHeight:map.height,
    countWidth:count.width,
    countHeight:count.height,
    heightDelta:Math.abs(map.height-count.height)
  };
})()`);
if (
  mapLayout.mapWidth < 250 ||
  mapLayout.countWidth < 250 ||
  mapLayout.mapHeight < 220 ||
  mapLayout.countHeight < 220 ||
  mapLayout.heightDelta > 2
) {
  throw new Error("Reconstruction map layout is not compact/aligned: " + JSON.stringify(mapLayout));
}
await screenshot("03-reconstruction");

// Browser project round-trip: real download -> file input -> reopen -> recompute.
const expectedProjectState = await evaluate(`(() => ({
  rowA: window.MapReconstructionWeb.appState.reconstructionParams.row_a_s,
  sampleCount: window.MapReconstructionWeb.appState.source.sampleCount,
  signal: window.MapReconstructionWeb.appState.signal,
  values: Array.from(window.MapReconstructionWeb.appState.reconstruction.values)
}))()`);
await click("save-project-button");
const downloadedProject = await waitForDownloadedProject();

await setValue("row-a", expectedProjectState.rowA + 7);
await waitFor(
  `window.MapReconstructionWeb.appState.reconstructionParams?.row_a_s===${expectedProjectState.rowA + 7}`,
  "temporary registration change before project reopen"
);

const projectDocument = await command("DOM.getDocument", { depth: -1, pierce: true });
const projectInput = await command("DOM.querySelector", {
  nodeId: projectDocument.root.nodeId,
  selector: "#project-file",
});
if (!projectInput.nodeId) throw new Error("Could not find #project-file.");
await command("DOM.setFileInputFiles", {
  nodeId: projectInput.nodeId,
  files: [downloadedProject],
});
await evaluate('document.getElementById("project-file").dispatchEvent(new Event("change",{bubbles:true}))');
await waitFor(
  `window.MapReconstructionWeb.appState.reconstructionParams?.row_a_s===${expectedProjectState.rowA} &&
   window.MapReconstructionWeb.appState.source?.sampleCount===${expectedProjectState.sampleCount} &&
   window.MapReconstructionWeb.appState.reconstruction?.values?.length===${expectedProjectState.values.length}`,
  "downloaded project reopen"
);
const reopenedProjectState = await evaluate(`(() => ({
  rowA: window.MapReconstructionWeb.appState.reconstructionParams.row_a_s,
  sampleCount: window.MapReconstructionWeb.appState.source.sampleCount,
  signal: window.MapReconstructionWeb.appState.signal,
  values: Array.from(window.MapReconstructionWeb.appState.reconstruction.values),
  status: document.getElementById("import-status").textContent
}))()`);
if (reopenedProjectState.signal !== expectedProjectState.signal) {
  throw new Error("Project reopen changed source signal.");
}
let maxRoundTripDelta = 0;
for (let index = 0; index < expectedProjectState.values.length; index += 1) {
  const before = expectedProjectState.values[index];
  const after = reopenedProjectState.values[index];
  if (Number.isNaN(before) && Number.isNaN(after)) continue;
  maxRoundTripDelta = Math.max(maxRoundTripDelta, Math.abs(before - after));
}
if (!(maxRoundTripDelta <= 1e-15)) {
  throw new Error("Project reopen changed reconstructed values; max delta=" + maxRoundTripDelta);
}
if (!/SHA-256 verified/i.test(reopenedProjectState.status)) {
  throw new Error("Project reopen did not report SHA-256 verification: " + reopenedProjectState.status);
}

// Step 4: analysis is generated from the reconstructed map.
await evaluate("document.querySelector('.stage-button[data-stage=\"4\"]').click()");
await waitFor(
  'document.querySelector(".stage-button.active")?.dataset.stage==="4" && window.MapReconstructionWeb.appState.processed?.values?.length===25',
  "Map Analysis stage"
);
const analysisHiddenContract = await evaluate(`(() => ({
  baselineValueHidden: getComputedStyle(document.getElementById("map-baseline-value-field")).display === "none",
  baselinePercentileHidden: getComputedStyle(document.getElementById("map-baseline-percentile-field")).display === "none",
  customHidden: getComputedStyle(document.getElementById("custom-expression-field")).display === "none",
  referenceHidden: getComputedStyle(document.getElementById("normalization-reference-field")).display === "none",
  colorPercentileHidden: getComputedStyle(document.getElementById("color-percentiles")).display === "none",
  colorManualHidden: getComputedStyle(document.getElementById("color-manual")).display === "none"
}))()`);
if (Object.values(analysisHiddenContract).some(value => !value)) {
  throw new Error("Inactive Map Analysis controls must stay hidden: " + JSON.stringify(analysisHiddenContract));
}
await layoutContract(4);
stageSidebarWidths.push(await evaluate('document.querySelector("#stage-4 .control-panel").getBoundingClientRect().width'));
if (
  Math.max(...stageSidebarWidths) - Math.min(...stageSidebarWidths) > 1 ||
  stageSidebarWidths[0] < 329
) {
  throw new Error("Workflow sidebars must use one wider desktop width: " + JSON.stringify(stageSidebarWidths));
}
const analysisControlFit = await evaluate(`(() => {
  const panel=document.querySelector("#stage-4 .control-panel");
  panel.scrollTop=0;
  const panelRect=panel.getBoundingClientRect();
  const distribution=document.querySelector("#stage-4 .distribution-section").getBoundingClientRect();
  const summary=document.getElementById("analysis-summary").getBoundingClientRect();
  const exportSummary=document.querySelector("#stage-4 .compact-details > summary").getBoundingClientRect();
  return {
    panelBottom:panelRect.bottom,
    distributionBottom:distribution.bottom,
    summaryBottom:summary.bottom,
    exportBottom:exportSummary.bottom,
  };
})()`);
if (
  analysisControlFit.distributionBottom > analysisControlFit.panelBottom + 1 ||
  analysisControlFit.summaryBottom > analysisControlFit.panelBottom + 1 ||
  analysisControlFit.exportBottom > analysisControlFit.panelBottom + 1
) {
  throw new Error("Stage 4 controls do not fit the initial panel viewport: " + JSON.stringify(analysisControlFit));
}
const analysisPlotLayout = await evaluate(`(() => {
  const map=document.getElementById("processed-map-canvas").getBoundingClientRect();
  const histogram=document.getElementById("histogram-canvas").getBoundingClientRect();
  return {
    mapDelta:Math.abs(map.width-map.height),
    histogramDelta:Math.abs(histogram.width-histogram.height),
    heightDelta:Math.abs(map.height-histogram.height)
  };
})()`);
if (
  analysisPlotLayout.mapDelta > 2 ||
  analysisPlotLayout.histogramDelta > 2 ||
  analysisPlotLayout.heightDelta > 2
) throw new Error("Map Analysis plots must share square-card geometry: " + JSON.stringify(analysisPlotLayout));
await screenshot("04-map-analysis");

socket.close();
console.log(JSON.stringify({
  sampleCount: 2401,
  finitePixels,
  darkRegions: await Promise.resolve(true),
  markerBefore,
  markerAfter,
  projectRoundTripMaxDelta: maxRoundTripDelta,
  screenshots: ["01-import-data","02-signal-preparation","03-reconstruction","04-map-analysis"],
}, null, 2));
