import { Audio, BufferReader } from "https://esm.sh/nitro-fs@1.1.1?bundle";
import { SONG_USAGE } from "./catalog.js";

const $ = (id) => document.getElementById(id);

const state = {
  sdat: null,
  sequences: [],
  selected: new Set(),
  fileName: "",
  busy: false
};

const VARIANT_RE = /\s*\((Spring|Summer|Autumn|Winter|Autumn\/Winter\/Spring|Pokémon Black|Pokémon White)\)\s*$/i;

function safeName(text) {
  return String(text || "Unknown")
    .replace(/[\\/:*?"<>|]/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "") || "Unknown";
}

function classifySequence(seq) {
  const internal = seq.name || `SEQ_${seq.id}`;
  const use = SONG_USAGE[internal] || humanizeInternal(internal);
  const match = use.match(VARIANT_RE);

  let baseUse = use;
  let variant = "";
  if (match) {
    baseUse = use.slice(0, match.index).trim();
    const raw = match[1].toLowerCase();
    if (raw === "pokémon black") variant = "Black version";
    else if (raw === "pokémon white") variant = "White version";
    else if (raw === "autumn/winter/spring") variant = "Autumn - Winter - Spring";
    else variant = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  }

  const isJingle = internal.startsWith("SEQ_ME_");
  return {
    ...seq,
    internal,
    use,
    baseUse,
    variant,
    isJingle
  };
}

function humanizeInternal(name) {
  return name
    .replace(/^SEQ_(?:BGM|ME)_/, "")
    .replace(/_/g, " ")
    .replace(/\bVS\b/g, "Battle")
    .replace(/\bBGM\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readU16(view, off) {
  return view.getUint16(off, true);
}
function readU32(view, off) {
  return view.getUint32(off, true);
}

function findNitroFile(rom, wantedName) {
  const view = new DataView(rom);
  const fntOffset = readU32(view, 0x40);
  const fntSize = readU32(view, 0x44);
  const fatOffset = readU32(view, 0x48);
  const fatSize = readU32(view, 0x4c);

  if (!fntOffset || !fntSize || !fatOffset || !fatSize) {
    throw new Error("This does not look like a valid Nintendo DS ROM.");
  }

  const rootParent = readU16(view, fntOffset + 6);
  const dirCount = rootParent;
  const seen = new Set();

  function walk(dirId, path) {
    if (seen.has(dirId)) return null;
    seen.add(dirId);

    const tableIndex = dirId - 0xf000;
    if (tableIndex < 0 || tableIndex >= dirCount) return null;
    const dirRec = fntOffset + tableIndex * 8;
    const subOffset = readU32(view, dirRec);
    let fileId = readU16(view, dirRec + 4);
    let pos = fntOffset + subOffset;
    const end = fntOffset + fntSize;

    while (pos < end) {
      const typeLen = view.getUint8(pos++);
      if (typeLen === 0) break;
      const isDir = !!(typeLen & 0x80);
      const len = typeLen & 0x7f;
      if (!len || pos + len > end) break;

      const bytes = new Uint8Array(rom, pos, len);
      const name = new TextDecoder("ascii").decode(bytes);
      pos += len;

      if (isDir) {
        if (pos + 2 > end) break;
        const childId = readU16(view, pos);
        pos += 2;
        const result = walk(childId, path ? `${path}/${name}` : name);
        if (result) return result;
      } else {
        if (name.toLowerCase() === wantedName.toLowerCase()) {
          const fatEntry = fatOffset + fileId * 8;
          if (fatEntry + 8 > fatOffset + fatSize) {
            throw new Error("The ROM file table is malformed.");
          }
          const start = readU32(view, fatEntry);
          const finish = readU32(view, fatEntry + 4);
          return {
            path: path ? `${path}/${name}` : name,
            fileId,
            buffer: rom.slice(start, finish)
          };
        }
        fileId++;
      }
    }
    return null;
  }

  const found = walk(0xf000, "");
  if (!found) throw new Error(`${wantedName} was not found in this ROM.`);
  return found;
}

function listMusic(sdat) {
  // Keep the sequence order exactly as it appears in the game's SDAT.
  // Seasonal/version variants are already adjacent there, so do not alphabetize.
  return sdat.fs.sequences
    .filter((s) => s.name && (s.name.startsWith("SEQ_BGM_") || s.name.startsWith("SEQ_ME_")))
    .map(classifySequence);
}

function visibleSequences() {
  const q = $("search").value.trim().toLowerCase();
  const includeJingles = $("includeJingles").checked;
  return state.sequences.filter((s) => {
    if (!includeJingles && s.isJingle) return false;
    if (!q) return true;
    return [s.use, s.baseUse, s.variant, s.internal].some((v) =>
      String(v).toLowerCase().includes(q)
    );
  });
}

function renderCatalog() {
  const items = visibleSequences();
  $("countBadge").textContent = `${items.length} shown · ${state.selected.size} selected`;
  $("catalog").replaceChildren();

  for (const s of items) {
    const row = document.createElement("label");
    row.className = "song";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.selected.has(s.id);
    box.addEventListener("change", () => {
      if (box.checked) state.selected.add(s.id);
      else state.selected.delete(s.id);
      $("countBadge").textContent = `${items.length} shown · ${state.selected.size} selected`;
    });

    const text = document.createElement("div");
    const name = document.createElement("div");
    name.className = "song-name";
    name.textContent = s.baseUse;
    const meta = document.createElement("div");
    meta.className = "song-meta";
    meta.textContent = s.isJingle ? "Short fanfare / jingle" : "Background music";
    text.append(name, meta);

    row.append(box, text);
    if (s.variant) {
      const badge = document.createElement("div");
      badge.className = "variant";
      badge.textContent = s.variant;
      row.append(badge);
    }

    $("catalog").append(row);
  }
}

function setStatus(text, kind = "") {
  const el = $("romStatus");
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function setProgress(frac, text) {
  $("progressWrap").classList.remove("hidden");
  const clamped = Math.max(0, Math.min(1, frac || 0));
  $("progress").value = clamped;
  $("progressPct").textContent = `${Math.round(clamped * 100)}%`;
  $("progressText").textContent = text;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["exportSelected", "selectVisible", "clearSelection", "romInput"]) {
    $(id).disabled = busy;
  }
}

function allTracksFinished(renderer) {
  return renderer.tracks.length > 0 && renderer.tracks.every((t) => !t);
}

function appendChunk(target, source) {
  target.push(Float32Array.from(source));
}

function mergeFloatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function trimToFrames(left, right, frames) {
  if (frames >= left.length) return [left, right];
  return [left.slice(0, frames), right.slice(0, frames)];
}

function interleaveToWav(left, right, sampleRate) {
  const frames = Math.min(left.length, right.length);
  const channels = 2;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeAscii = (off, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(off + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let p = 44;
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(p, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(p + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    p += 4;
  }
  return out;
}


const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION = 20;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function makeZipEntry(name, data) {
  const nameBytes = new TextEncoder().encode(name);
  const bytes = data instanceof Uint8Array
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new TextEncoder().encode(String(data));

  return {
    name,
    nameBytes,
    bytes,
    size: bytes.byteLength,
    crc: crc32(bytes)
  };
}

async function buildStoreZip(entries, onProgress) {
  const now = zipDosDateTime();
  const parts = [];
  const centralParts = [];
  let offset = 0;
  let totalDataBytes = 0;

  for (const entry of entries) totalDataBytes += entry.size;
  if (totalDataBytes > 0xffffffff - (entries.length * 256)) {
    throw new Error("This ZIP would exceed the classic ZIP size limit. Export fewer songs at once.");
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    const local = new ArrayBuffer(30);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, ZIP_VERSION, true);
    lv.setUint16(6, ZIP_UTF8_FLAG, true);
    lv.setUint16(8, ZIP_STORE_METHOD, true);
    lv.setUint16(10, now.time, true);
    lv.setUint16(12, now.day, true);
    lv.setUint32(14, entry.crc, true);
    lv.setUint32(18, entry.size, true);
    lv.setUint32(22, entry.size, true);
    lv.setUint16(26, entry.nameBytes.length, true);
    lv.setUint16(28, 0, true);

    parts.push(local, entry.nameBytes, entry.bytes);

    const central = new ArrayBuffer(46);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, ZIP_VERSION, true);
    cv.setUint16(6, ZIP_VERSION, true);
    cv.setUint16(8, ZIP_UTF8_FLAG, true);
    cv.setUint16(10, ZIP_STORE_METHOD, true);
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.day, true);
    cv.setUint32(16, entry.crc, true);
    cv.setUint32(20, entry.size, true);
    cv.setUint32(24, entry.size, true);
    cv.setUint16(28, entry.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralParts.push(central, entry.nameBytes);

    offset += 30 + entry.nameBytes.length + entry.size;

    if (onProgress) onProgress((i + 1) / entries.length, entry.name);
    if ((i & 3) === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.byteLength;
  }

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...parts, ...centralParts, eocd], { type: "application/zip" });
}

function audioPeak(left, right) {
  let peak = 0;
  const step = Math.max(1, Math.floor(left.length / 250000));
  for (let i = 0; i < left.length; i += step) {
    const a = Math.abs(left[i]);
    const b = Math.abs(right[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  return peak;
}

function sequenceFolder(s) {
  const base = safeName(s.baseUse);
  return s.variant ? `${base}/${safeName(s.variant)}` : base;
}

function infoText(s, sampleRate, loops, renderedTracks, loopDetected) {
  return [
    `Used for: ${s.use}`,
    `Internal sequence: ${s.internal}`,
    `Sequence ID: ${s.id}`,
    `Bank ID: ${s.fileInfo?.bankId ?? "unknown"}`,
    `Sample rate: ${sampleRate} Hz`,
    `Requested loops: ${loops}`,
    `Loop boundary detected: ${loopDetected ? "yes" : "no (sequence ended naturally or safety cap was used)"}`,
    `Rendered stem tracks: ${renderedTracks.length ? renderedTracks.map((n) => n + 1).join(", ") : "none"}`,
    "",
    "Folder names describe in-game use. Internal names are kept only in this info file."
  ].join("\n");
}

async function renderStem(seq, trackNo, sampleRate, requestedLoops) {
  const file = Audio.SequenceRenderer.makeInfoSSEQ(state.sdat, seq.id);
  const leftChunks = [];
  const rightChunks = [];
  const bufferLength = 4096;

  const renderer = new Audio.SequenceRenderer({
    file,
    sampleRate,
    bufferLength,
    activeTracks: 1 << trackNo,
    seed: 0x5eed,
    sink: (buf) => {
      appendChunk(leftChunks, buf[0]);
      appendChunk(rightChunks, buf[1]);
    }
  });

  let loopsSeen = 0;
  let loopDetected = false;

  // Hook the conductor track's Jump command so loop counting is based on the
  // sequence's actual backwards control-flow jump, not elapsed seconds.
  const conductor = renderer.tracks[0];
  if (conductor?.handlers?.[0x94]) {
    const originalJump = conductor.handlers[0x94];
    conductor.handlers[0x94] = function (cmd) {
      if (cmd.offset < this.pointer) {
        loopsSeen++;
        loopDetected = true;
      }
      return originalJump.call(this, cmd);
    };
  }

  const maxSeconds = 20 * 60;
  const maxTicks = Math.ceil(maxSeconds * 1000 / Audio.SequenceRenderer.TICK_INTERVAL_MS);
  let ticks = 0;

  while (ticks++ < maxTicks) {
    renderer.tick();

    if (loopDetected && loopsSeen >= requestedLoops) break;
    if (allTracksFinished(renderer)) break;

    if ((ticks & 0x1fff) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  // Preserve the renderer's final not-yet-full sink buffer too, otherwise
  // every stem can lose up to one 4096-frame chunk at its exact end point.
  if (renderer.synth?.pos > 0) {
    leftChunks.push(renderer.synth.buffer[0].slice(0, renderer.synth.pos));
    rightChunks.push(renderer.synth.buffer[1].slice(0, renderer.synth.pos));
  }

  const left = mergeFloatChunks(leftChunks);
  const right = mergeFloatChunks(rightChunks);
  return { left, right, loopDetected };
}

async function exportSongs(songs) {
  if (!songs.length) {
    alert("Select at least one song first.");
    return;
  }
  if (!state.sdat || state.busy) return;

  setBusy(true);
  const sampleRate = Number($("sampleRate").value);
  const loops = Number($("loopCount").value);
  const zipEntries = [];

  try {
    let completedUnits = 0;
    const totalUnits = songs.length * 16;

    for (let songIndex = 0; songIndex < songs.length; songIndex++) {
      const s = songs[songIndex];
      const folderPath = sequenceFolder(s);
      const renderedTracks = [];
      let anyLoopDetected = false;

      for (let track = 0; track < 16; track++) {
        setProgress(
          completedUnits / totalUnits,
          `${s.baseUse}${s.variant ? " — " + s.variant : ""}: track ${track + 1}/16`
        );

        const rendered = await renderStem(s, track, sampleRate, loops);
        anyLoopDetected ||= rendered.loopDetected;

        if (audioPeak(rendered.left, rendered.right) > 0.00002) {
          const wav = interleaveToWav(rendered.left, rendered.right, sampleRate);
          zipEntries.push(makeZipEntry(
            `${folderPath}/Track ${String(track + 1).padStart(2, "0")}.wav`,
            wav
          ));
          renderedTracks.push(track);
        }

        completedUnits++;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      zipEntries.push(makeZipEntry(
        `${folderPath}/info.txt`,
        infoText(s, sampleRate, loops, renderedTracks, anyLoopDetected)
      ));
    }

    setProgress(0.985, "Building fast ZIP…");
    const blob = await buildStoreZip(zipEntries, (fraction, name) => {
      const pct = 0.985 + fraction * 0.015;
      setProgress(pct, `Building fast ZIP… ${name}`);
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Pokemon Black White Music Stems - ${loops} loop${loops === 1 ? "" : "s"}.zip`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);

    setProgress(1, `Finished ${songs.length} song${songs.length === 1 ? "" : "s"}.`);
  } catch (err) {
    console.error(err);
    setProgress(0, "Export failed.");
    alert(`Export failed: ${err?.message || err}`);
  } finally {
    setBusy(false);
  }
}

$("romInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  state.sdat = null;
  state.sequences = [];
  state.selected.clear();
  $("controls").classList.add("hidden");
  $("catalogSection").classList.add("hidden");
  $("progressWrap").classList.add("hidden");
  setStatus("Reading ROM locally…");

  try {
    const rom = await file.arrayBuffer();
    const found = findNitroFile(rom, "wb_sound_data.sdat");
    const sdat = new Audio.SDAT(BufferReader.new(found.buffer));
    const sequences = listMusic(sdat);

    if (!sequences.length) throw new Error("The SDAT parsed, but no Black/White music sequences were found.");

    state.sdat = sdat;
    state.sequences = sequences;
    state.fileName = file.name;

    $("controls").classList.remove("hidden");
    $("catalogSection").classList.remove("hidden");
    $("catalogTitle").textContent = "Black / White music";
    setStatus(
      `Loaded ${file.name}. Found ${found.path} and ${sequences.filter((s) => !s.isJingle).length} BGM sequences.`,
      "ok"
    );
    renderCatalog();
  } catch (err) {
    console.error(err);
    setStatus(err?.message || String(err), "error");
  }
});

$("search").addEventListener("input", renderCatalog);
$("includeJingles").addEventListener("change", renderCatalog);

$("selectVisible").addEventListener("click", () => {
  for (const s of visibleSequences()) state.selected.add(s.id);
  renderCatalog();
});

$("clearSelection").addEventListener("click", () => {
  state.selected.clear();
  renderCatalog();
});

$("exportSelected").addEventListener("click", async () => {
  const songs = state.sequences.filter((s) => state.selected.has(s.id));
  await exportSongs(songs);
});
