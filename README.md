# Stupid-ChatGPT
The name isn’t related to the project by the way I just think ChatGPT is being stupid rn

---

# Pokémon Black / White browser stem extractor

A static GitHub Pages tool that processes a user-selected Pokémon Black or White Nintendo DS ROM entirely in the browser.

## What it does

- Reads the ROM locally; the ROM is never uploaded.
- Locates `wb_sound_data.sdat` directly from the NDS filesystem without cloning the whole ROM filesystem into memory.
- Catalogs Black/White BGM by what the sequence is used for.
- Groups seasonal, Black/White, and floor/location variations.
- Renders individual SSEQ tracks as separate stereo 16-bit WAV stems.
- Omits silent tracks.
- Lets you choose a loop count: intro once, then exactly N complete loop passes.
- Renders non-looping sequences to their natural end.
- Exports usage-named folders with `info.txt` files containing internal sequence IDs/names.
- Uses a direct store-only ZIP writer to reduce packing time and memory pressure on iPad browsers.
- Can optionally include short fanfares/jingles.

## GitHub Pages

The Pages workflow deploys from `main` using GitHub Actions. The site is static and runs the extractor entirely in the browser.

## Dependencies

Loaded in the browser as ES modules:

- [`nitro-fs`](https://github.com/DanielPXL/nitro-fs) (LGPL-3.0-or-later)

No ROM or game-audio data is stored in this repository.
