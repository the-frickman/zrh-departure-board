const calls = new Map([
  ["GO TO GATE", "please proceed to"], ["GATE OPEN", "please proceed to"],
  ["BOARDING", "boarding is now in progress at"], ["FINAL CALL", "this is the final call at"],
  ["LAST CALL", "this is the final call at"],
]);

function flightName(row) {
  const [carrier, number] = row[0].split(/\s+/);
  return `Flight ${carrier.split("").join(" ")} ${number.split("").join(" ")} to ${row[1]}`;
}

function gateCall(row) {
  if (!row[8] || !calls.has(row[9])) return "";
  return `${flightName(row)}, ${calls.get(row[9])} gate ${row[8].split("").join(" ")}.`;
}

export function openingCall(rows) {
  for (const row of rows) {
    const call = gateCall(row);
    if (call) return call;
  }
  const next = rows.find(row => row[0]);
  return next ? `${flightName(next)} is scheduled to depart at ${next[3]} local time.` : "";
}

export function changedCalls(previous, current) {
  const key = row => [row[0], row[1], row[3]].join("|");
  const old = new Map(previous.map(row => [key(row), row]));
  const messages = [];
  for (const row of current.filter(row => row[0])) {
    const before = old.get(key(row));
    if (before && before[8] === row[8] && before[9] === row[9]) continue;
    const call = gateCall(row);
    if (call) messages.push(call);
    else if (before?.[8] && row[8] && before[8] !== row[8] && row[9] !== "CLOSED") {
      messages.push(`Gate change for ${flightName(row)}. The new gate is ${row[8].split("").join(" ")}.`);
    }
  }
  return messages;
}

// Each note has a short attack and a longer, quieter overtone like a struck bell.
function chime(context, output) {
  const lastNotes = [];
  for (const [index, pitch] of [659.25, 523.25, 392].entries()) {
    for (const [ratio, level] of [[1, .16], [2.01, .035]]) {
      const start = context.currentTime + .02 + index * .32;
      const bell = context.createOscillator();
      const envelope = context.createGain();
      bell.frequency.value = pitch * ratio;
      envelope.gain.setValueAtTime(.0001, start);
      envelope.gain.exponentialRampToValueAtTime(level, start + .015);
      envelope.gain.exponentialRampToValueAtTime(.0001, start + .8);
      bell.connect(envelope).connect(output);
      lastNotes.push(new Promise(resolve => { bell.onended = resolve; }));
      bell.start(start);
      bell.stop(start + .82);
    }
  }
  return Promise.all(lastNotes);
}

export class PublicAddress {
  constructor(report) {
    this.report = report;
    this.generation = 0;
    this.enabled = false;
    this.pending = [];
  }

  async enable() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error("This browser does not support the airport chime.");
    this.context ??= new Audio();
    await this.context.resume();
    this.output = this.context.createGain();
    this.output.connect(this.context.destination);
    this.enabled = true;
  }

  mute() {
    this.enabled = false;
    this.generation++;
    this.pending = [];
    this.output?.disconnect();
    window.speechSynthesis?.cancel();
    this.finishSpeech?.();
    this.busy = false;
  }

  say(messages) {
    if (!this.enabled) return;
    this.pending.push(...messages.filter(Boolean));
    if (!this.busy) void this.play(this.generation);
  }

  async play(generation) {
    this.busy = true;
    while (this.pending.length && this.enabled && generation === this.generation) {
      const message = this.pending.shift();
      this.report(message);
      await chime(this.context, this.output);
      if (!this.enabled || generation !== this.generation) return;
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        this.report(message + " · Speech unavailable on this device.");
        continue;
      }
      await new Promise(resolve => {
        const voice = new SpeechSynthesisUtterance(message);
        voice.lang = "en-GB";
        voice.rate = .95;
        const timer = setTimeout(() => { window.speechSynthesis.cancel(); finish(); }, 30000);
        const finish = () => { clearTimeout(timer); this.finishSpeech = null; resolve(); };
        this.finishSpeech = finish;
        voice.onend = finish;
        voice.onerror = () => {
          if (this.enabled && generation === this.generation) this.report(message + " · Speech unavailable on this device.");
          finish();
        };
        window.speechSynthesis.speak(voice);
      });
    }
    if (generation === this.generation) this.busy = false;
  }
}
