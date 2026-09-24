import { NitroFS, Audio, BufferReader } from "https://esm.sh/nitro-fs@1.1.1?bundle";
import JSZip from "https://esm.sh/jszip@3.10.1?bundle";

const $ = (id) => document.getElementById(id);
const romInput = $("romInput");
const romStatus = $("romStatus");
const controls = $("controls");
const catalogSection = $("catalogSection");
const catalogEl = $("catalog");
const countBadge = $("countBadge");
const searchEl = $("search");
const includeJinglesEl = $("includeJingles");
const progressWrap = $("progressWrap");
const progressEl = $("progress");
const progressText = $("progressText");
const progressPct = $("progressPct");

let sdat = null;
let songs = [];
let filtered = [];
let nextBatchIndex = 0;
let busy = false;

import { friendlyMeta } from "./names.js";

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
}

function detectTracks(fileInfo) {
  const set = new Set([0]);
  for (const cmd of fileInfo.commands || []) {
    if (Number.isInteger(cmd?.track) && cmd.track >= 0 && cmd.track < 16) set.add(cmd.track);
  }
  return [...set].sort((a, b) => a - b);
}

function setStatus(text, cls = "") {
  romStatus.textContent = text;
  romStatus.className = `status ${cls}`.trim();
}

function setBusy(value) {
  busy = value;
  for (const btn of document.querySelectorAll("button")) btn.disabled = value;
  romInput.disabled = value;
}

function updateProgress(value, text) {
  progressWrap.classList.remove("hidden");
  progressEl.value = Math.max(0, Math.min(1, value));
  progressText.textContent = text;
  progressPct.textContent = `${Math.round(progressEl.value * 100)}%`;
}

function hideProgress() {
  progressWrap.classList.add("hidden");
}

function refreshCatalog() {
  const q = searchEl.value.trim().toLowerCase();
  const includeJingles = includeJinglesEl.checked;
  filtered = songs.filter((s) => {
    if (!includeJingles && !s.name.startsWith("SEQ_BGM_")) return false;
    const hay = `${s.meta.usage} ${s.meta.variant} ${s.name}`.toLowerCase();
    return !q || hay.includes(q);
  });

  catalogEl.innerHTML = "";
  for (const s of filtered) {
    const row = document.createElement("label");
    row.className = "song";
    row.innerHTML = `
      <input type="checkbox" data-seqid="${s.id}" ${s.selected ? "checked" : ""}>
      <div>
        <div class="song-name"></div>
        <div class="song-meta">sequence ${s.id} · bank ${s.bankId ?? "?"}</div>
      </div>
      <div class="variant"></div>`;
    row.querySelector(".song-name").textContent = s.meta.usage;
    const variant = row.querySelector(".variant");
    variant.textContent = s.meta.variant || "standard";
    row.querySelector("input").addEventListener("change", (e) => { s.selected = e.target.checked; });
    catalogEl.appendChild(row);
  }
  countBadge.textContent = `${filtered.length} shown · ${songs.filter(s => s.name.startsWith("SEQ_BGM_")).length} BGM total`;
}

romInput.addEventListener("change", async () => {
  const file = romInput.files?.[0];
  if (!file) return;
  setBusy(true);
  hideProgress();
  setStatus(`Reading ${file.name} locally…`);
  try {
    const rom = await file.arrayBuffer();
    const fs = NitroFS.fromRom(rom);
    let sdatBuffer;
    for (const path of ["wb_sound_data.sdat", "/wb_sound_data.sdat", "data/sound/wb_sound_data.sdat"]) {
      try { sdatBuffer = fs.readFile(path); if (sdatBuffer) break; } catch (_) {}
    }
    if (!sdatBuffer) throw new Error("Could not find wb_sound_data.sdat in this ROM. Make sure this is Pokémon Black or White.");

    sdat = new Audio.SDAT(BufferReader.new(sdatBuffer));
    songs = [];
    for (const seq of sdat.fs.sequences || []) {
      if (!seq?.name || (!seq.name.startsWith("SEQ_BGM_") && !seq.name.startsWith("SEQ_ME_"))) continue;
      const meta = friendlyMeta(seq.name);
      songs.push({ id: seq.id, name: seq.name, bankId: seq.fileInfo?.bankId, meta, selected: false });
    }
    songs.sort((a, b) => a.id - b.id);
    nextBatchIndex = 0;
    setStatus(`Loaded ${songs.filter(s => s.name.startsWith("SEQ_BGM_")).length} background-music sequences from ${file.name}.`, "ok");
    controls.classList.remove("hidden");
    catalogSection.classList.remove("hidden");
    refreshCatalog();
  } catch (err) {
    console.error(err);
    sdat = null;
    songs = [];
    controls.classList.add("hidden");
    catalogSection.classList.add("hidden");
    setStatus(err?.message || String(err), "error");
  } finally {
    setBusy(false);
  }
});

searchEl.addEventListener("input", refreshCatalog);
includeJinglesEl.addEventListener("change", refreshCatalog);

$("selectVisible").addEventListener("click", () => {
  for (const s of filtered) s.selected = true;
  refreshCatalog();
});
$("clearSelection").addEventListener("click", () => {
  for (const s of songs) s.selected = false;
  refreshCatalog();
});

function encodeWav(left, right, sampleRate) {
  const frames = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 4);
  const view = new DataView(buffer);
  const write = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  write(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, frames * 4, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true); o += 2;
    view.setInt16(o, r < 0 ? r * 0x8000 : r * 0x7fff, true); o += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function findPrimaryLoopJump(fileInfo) {
  // Pokémon B/W's indefinitely looping BGM is normally implemented with a
  // backwards SSEQ Jump (0x94). The broadest backwards jump is a strong
  // signal for the full-song loop rather than a tiny repeating figure.
  let best = null;
  const commands = fileInfo.commands || [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd?.type !== 0x94 || !Number.isInteger(cmd.offset) || cmd.offset >= i) continue;
    const span = i - cmd.offset;
    if (!best || span > best.span) best = { from: i, to: cmd.offset, span };
  }
  return best;
}

function flattenChunks(chunks, frames) {
  const out = new Float32Array(frames);
  let at = 0;
  for (const chunk of chunks) {
    if (at >= frames) break;
    const take = Math.min(chunk.length, frames - at);
    out.set(chunk.subarray(0, take), at);
    at += take;
  }
  return out;
}

async function renderStem(song, track, loopCount, sampleRate, progressCallback) {
  const fileInfo = Audio.SequenceRenderer.makeInfoSSEQ(sdat, song.id);
  const loopJump = findPrimaryLoopJump(fileInfo);
  const chunksL = [];
  const chunksR = [];
  let frames = 0;
  let peak = 0;
  let loopHits = 0;
  let stopFrame = null;
  let endedNaturally = false;
  const bufferLength = 2048;
  const safetySeconds = 300;
  const safetyFrames = safetySeconds * sampleRate;
  const patchedTracks = new WeakSet();

  const sink = (chunk) => {
    const l = chunk[0].slice();
    const r = chunk[1].slice();
    chunksL.push(l);
    chunksR.push(r);
    frames += l.length;
  };

  const renderer = new Audio.SequenceRenderer({
    file: fileInfo,
    sampleRate,
    bufferLength,
    activeTracks: (1 << track),
    seed: 1,
    sink
  });

  const patchJumpHandlers = () => {
    for (const seqTrack of renderer.tracks || []) {
      if (!seqTrack || patchedTracks.has(seqTrack) || !seqTrack.handlers) continue;
      const originalJump = seqTrack.handlers[0x94];
      if (typeof originalJump !== "function") continue;
      seqTrack.handlers[0x94] = function (cmd) {
        const from = this.pointer;
        if (loopJump && from === loopJump.from && cmd?.offset === loopJump.to) {
          loopHits++;
          if (loopHits >= loopCount && stopFrame === null) {
            // synth.time is the exact rendered time at this sequence boundary.
            stopFrame = Math.max(1, Math.round(this.synth.time * sampleRate));
          }
        }
        return originalJump.call(this, cmd);
      };
      patchedTracks.add(seqTrack);
    }
  };

  let ticks = 0;
  let finishedTick = null;
  while (true) {
    patchJumpHandlers();
    renderer.tick();
    patchJumpHandlers();
    ticks++;

    const renderedFrames = Math.round(renderer.synth.time * sampleRate);
    const allTracksDone = (renderer.tracks || []).every((t) => !t);
    if (allTracksDone && finishedTick === null) finishedTick = ticks;

    // If there is no song loop, let the sequence finish naturally and give
    // release envelopes a short tail. This keeps jingles and one-shot music intact.
    if (!loopJump && allTracksDone) {
      const notesStillPlaying = (renderer.synth.channels || []).some((ch) =>
        (ch.playing || []).some(Boolean)
      );
      if (!notesStillPlaying || (finishedTick !== null && ticks - finishedTick > 600)) {
        endedNaturally = true;
        stopFrame = Math.max(1, renderedFrames);
      }
    }

    if (stopFrame !== null && renderedFrames >= stopFrame) break;
    if (renderedFrames >= safetyFrames) {
      // Safety fallback for unusual/malformed looping sequences. We keep what
      // was rendered instead of hanging Safari forever.
      stopFrame = safetyFrames;
      break;
    }

    if ((ticks & 255) === 0) {
      const p = loopJump
        ? Math.min(0.99, loopHits / Math.max(1, loopCount))
        : Math.min(0.95, renderedFrames / safetyFrames);
      progressCallback?.(p, loopHits, Boolean(loopJump));
      await new Promise(requestAnimationFrame);
    }
  }

  // The synth sends fixed-size chunks. Copy its current partial chunk too,
  // then trim precisely to the loop boundary / natural ending.
  if (renderer.synth?.pos > 0) {
    chunksL.push(renderer.synth.buffer[0].slice(0, renderer.synth.pos));
    chunksR.push(renderer.synth.buffer[1].slice(0, renderer.synth.pos));
    frames += renderer.synth.pos;
  }

  const finalFrames = Math.min(stopFrame ?? frames, frames);
  if (finalFrames <= 0) return null;
  const left = flattenChunks(chunksL, finalFrames);
  const right = flattenChunks(chunksR, finalFrames);
  for (let i = 0; i < finalFrames; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak < 0.00005) return null;

  return {
    blob: encodeWav(left, right, sampleRate),
    peak,
    frames: finalFrames,
    loopDetected: Boolean(loopJump),
    loopHits,
    endedNaturally,
    safetyFallback: finalFrames >= safetyFrames
  };
}

async function addSongToZip(zip, song, loopCount, sampleRate, songIndex, songCount) {
  const fileInfo = Audio.SequenceRenderer.makeInfoSSEQ(sdat, song.id);
  const tracks = detectTracks(fileInfo);
  const loopJump = findPrimaryLoopJump(fileInfo);
  const baseFolder = zip.folder(sanitize(song.meta.usage));
  const folder = song.meta.variant ? baseFolder.folder(sanitize(song.meta.variant)) : baseFolder;
  const keptTracks = [];
  let renderSummary = null;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const base = (songIndex + (i / Math.max(1, tracks.length))) / songCount;
    updateProgress(base, `${song.meta.usage}${song.meta.variant ? ` – ${song.meta.variant}` : ""}: track ${track}`);
    const stem = await renderStem(song, track, loopCount, sampleRate, (p, hits, hasLoop) => {
      const loopText = hasLoop ? ` · loop ${Math.min(hits + 1, loopCount)}/${loopCount}` : " · one-shot";
      updateProgress((songIndex + (i + p) / Math.max(1, tracks.length)) / songCount, `${song.meta.usage}: rendering track ${track}${loopText}`);
    });
    if (stem) {
      renderSummary ||= stem;
      keptTracks.push(track);
      folder.file(`stem ${String(track).padStart(2, "0")}.wav`, stem.blob);
    }
  }

  const info = [
    `Used for: ${song.meta.usage}`,
    `Variation: ${song.meta.variant || "standard"}`,
    `Internal sequence: ${song.name}`,
    `Sequence ID: ${song.id}`,
    `Bank ID: ${song.bankId ?? "unknown"}`,
    `Rendered SSEQ tracks: ${keptTracks.join(", ") || "none"}`,
    loopJump ? `Loops rendered: ${loopCount}` : "Loops rendered: not applicable (non-looping sequence)",
    `Loop detection: ${loopJump ? `backward SSEQ jump ${loopJump.from} → ${loopJump.to}` : "no repeating jump detected"}`,
    `Sample rate: ${sampleRate} Hz`,
    renderSummary?.safetyFallback ? "Warning: the safety render limit was reached for this sequence." : "",
    "",
    "Notes:",
    "- Folder names are based on where/how the music is used rather than the internal sequence name.",
    "- A looping song keeps its intro once, followed by the requested number of complete loop passes.",
    "- Non-looping music and jingles render once to their natural end.",
    "- Each WAV is one active SSEQ sequencer track; silent tracks are omitted.",
    "- Rendering is performed locally from the ROM you selected."
  ].filter(Boolean).join("\n");
  folder.file("info.txt", info);
}

async function downloadZip(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportSongs(list, label = "selected") {
  if (!sdat || busy || list.length === 0) return;
  const loopCount = Number($("loopCount").value);
  const sampleRate = Number($("sampleRate").value);
  setBusy(true);
  updateProgress(0, "Preparing…");
  try {
    const zip = new JSZip();
    for (let i = 0; i < list.length; i++) await addSongToZip(zip, list[i], loopCount, sampleRate, i, list.length);
    updateProgress(.98, "Building ZIP…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 3 } }, (m) => {
      updateProgress(.98 + (m.percent / 100) * .02, `Building ZIP… ${Math.round(m.percent)}%`);
    });
    const filename = `pokemon-bw-stems-${sanitize(label).toLowerCase().replaceAll(" ", "-")}.zip`;
    await downloadZip(blob, filename);
    updateProgress(1, "Done — ZIP download started.");
  } catch (err) {
    console.error(err);
    alert(`Export failed: ${err?.message || err}`);
  } finally {
    setBusy(false);
    setTimeout(hideProgress, 2500);
  }
}

$("exportSelected").addEventListener("click", async () => {
  const selected = songs.filter(s => s.selected);
  if (!selected.length) { alert("Select at least one song first."); return; }
  const max = Number($("batchSize").value);
  if (selected.length > max) {
    alert(`To avoid Safari running out of memory, this export will use the first ${max} selected song(s). Export again for the rest.`);
  }
  await exportSongs(selected.slice(0, max), `selected-${Date.now()}`);
  for (const s of selected.slice(0, max)) s.selected = false;
  refreshCatalog();
});

$("exportNext").addEventListener("click", async () => {
  const pool = songs.filter(s => s.name.startsWith("SEQ_BGM_"));
  const size = Number($("batchSize").value);
  if (nextBatchIndex >= pool.length) nextBatchIndex = 0;
  const batch = pool.slice(nextBatchIndex, nextBatchIndex + size);
  const start = nextBatchIndex + 1;
  nextBatchIndex += batch.length;
  await exportSongs(batch, `bgm-${String(start).padStart(3, "0")}-to-${String(start + batch.length - 1).padStart(3, "0")}`);
});
