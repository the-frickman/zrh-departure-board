import { announcement, changedCalls, flightKey, openingCall, PublicAddress } from "./announcements.js";

const display = document.querySelector("#board");
const $ = id => document.getElementById(id);
const status = document.querySelector("#freshness");
const report = text => { document.querySelector("#message").textContent = text; };
const pa = new PublicAddress(report);
const localClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", timeStyle: "medium" });
const localStamp = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" });
const maxAge = 25 * 60 * 1000;
let rows = [], names = {}, digest, checked = 0, imageUrl, refreshing = false;
const fresh = time => time > 0 && Date.now() - time < maxAge;

function tick() { document.querySelector("#clock").textContent = localClock.format(new Date()); }
tick();
setInterval(tick, 1000);

let starting = false;
let messageBeforePause = "";

function controls() {
  $("play").disabled = starting || (pa.enabled && !pa.paused);
  $("play").textContent = pa.paused ? "▶ Resume" : "▶ Play";
  $("pause").disabled = starting || !pa.enabled || pa.paused;
  $("stop").disabled = starting || !pa.enabled;
  $("queue").disabled = starting || !($("draft-de").value.trim() || $("draft-en").value.trim());
}

async function start(special) {
  if (starting) return;
  starting = true;
  controls();
  try {
    const first = !pa.enabled;
    await pa.enable();
    if (special) {
      if (pa.busy) report("Special announcement queued.");
      pa.say([special]);
    } else if (first) {
      report("Sound enabled. Waiting for a recent departure update.");
      if (fresh(checked)) pa.say([openingCall(rows, names)]);
    } else if (!pa.busy) report("Listening for gate calls.");
    else if ($("message").textContent === "Playback paused.") report(messageBeforePause || "Playback resumed.");
  } catch (error) { report(error.message); }
  finally { starting = false; controls(); }
}

$("play").addEventListener("click", () => start(null));
$("chime").addEventListener("change", () => { pa.chimeFile = $("chime").value; });
$("pause").addEventListener("click", async () => {
  messageBeforePause = $("message").textContent;
  const paused = pa.pause();
  report("Playback paused.");
  controls();
  try { await paused; } catch { pa.mute(); report("Playback stopped. This device could not pause audio."); controls(); }
});
$("stop").addEventListener("click", () => {
  pa.mute(); report("Playback stopped."); controls();
});

function selectedRow() { return rows.find(r => flightKey(r) === $("flight").value); }
function syncFlights(previous) {
  const selected = $("flight").value;
  const oldGate = previous.find(r => flightKey(r) === selected)?.[8];
  const active = rows.filter(r => r[0]);
  $("flight").replaceChildren(...active.map(r => new Option(r[0].replace(/\s+/g, " ") + " · " + r[1], flightKey(r))));
  if (active.some(r => flightKey(r) === selected)) $("flight").value = selected;
  if (selected !== $("flight").value || $("gate").value === oldGate) {
    $("gate").value = selectedRow()?.[8] || "";
  }
}
$("flight").addEventListener("change", () => { $("gate").value = selectedRow()?.[8] || ""; });
$("composer").addEventListener("submit", event => {
  event.preventDefault();
  const row = selectedRow();
  if (!row) { report("Select a flight or enter your own announcement below."); return; }
  const draft = [...row];
  draft[8] = $("gate").value.trim().toUpperCase();
  const kind = $("kind").value;
  if (!["SCHEDULED", "DELAYED"].includes(kind) && !/^[A-Z0-9]{1,5}$/.test(draft[8])) {
    $("gate").setCustomValidity("Enter a gate code for this call.");
    $("gate").reportValidity();
    $("gate").setCustomValidity("");
    return;
  }
  const [de, en] = announcement(draft, names, kind);
  $("draft-de").value = de.text;
  $("draft-en").value = en.text;
  controls();
});
for (const id of ["draft-de", "draft-en"]) $(id).addEventListener("input", controls);
$("queue").addEventListener("click", () => {
  const lines = [{lang:"de-CH", text:$("draft-de").value.trim()}, {lang:"en-GB", text:$("draft-en").value.trim()}];
  start(lines.filter(line => line.text));
});

async function readBoard(hash) {
  const response = await fetch(`./assets/splitflap-board.svg?v=${hash}`, { cache: "no-cache" });
  if (!response.ok) throw new Error("Board unavailable");
  const bytes = await response.arrayBuffer();
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
  if (hash !== actual) throw new Error("New deployment in progress");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
  const data = JSON.parse(doc.querySelector("metadata#snapshot").textContent);
  if (!Array.isArray(data.rows) || data.rows.length !== 5 ||
      !data.rows.every(row => Array.isArray(row) && row.length === 10 && row.every(cell => typeof cell === "string"))) {
    throw new Error("Invalid flight list");
  }
  if (JSON.stringify(rows) !== JSON.stringify(data.rows)) {
    const img = new Image();
    img.alt = "Zürich departures. " + data.rows.filter(r => r[0]).map(r => r.filter(Boolean).join(", ")).join(". ");
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
    img.src = url;
    try { await img.decode(); } catch (error) { URL.revokeObjectURL(url); throw error; }
    display.replaceChildren(img);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = url;
  }
  return data.rows;
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch("./snapshot.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Update unavailable");
    const snapshot = await response.json();
    const time = Date.parse(snapshot.fetched);
    if (!Number.isFinite(time) || !/^[0-9a-f]{64}$/.test(snapshot.sha256)) throw new Error("Invalid snapshot");
    if (time < checked) return;
    const previous = rows;
    const current = digest === snapshot.sha256 ? rows : await readBoard(snapshot.sha256);
    names = snapshot.announcements ?? {};
    if (pa.enabled && !pa.paused && fresh(time) && !document.hidden) {
      if (!fresh(checked)) pa.say([openingCall(current, names)]);
      else pa.say(changedCalls(previous, current, names));
    }
    digest = snapshot.sha256;
    const listChanged = JSON.stringify(rows) !== JSON.stringify(current);
    rows = current;
    if (listChanged) syncFlights(previous);
    checked = time;
    status.textContent = (fresh(time) ? "Airport checked " : "Last available update · ") + localStamp.format(time) + " Zürich";
  } catch {
    if (!display.firstElementChild) {
      const fallback = new Image();
      fallback.src = "./assets/splitflap-board.svg";
      fallback.alt = "Last published Zürich departure board";
      display.append(fallback);
    }
    status.textContent = checked ? "Update unavailable · last checked " + localStamp.format(checked) : "Update unavailable · showing the last published board";
  } finally {
    refreshing = false;
    display.setAttribute("aria-busy", "false");
  }
}

refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
