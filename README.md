# Stupid-ChatGPT
The name isn’t related to the project by the way I just think ChatGPT is being stupid rn

---

# Pokémon Black / White browser stem extractor

A static, client-side GitHub Pages tool for extracting music stems from a user-supplied Pokémon Black or Pokémon White Nintendo DS ROM.

## What it does

- Reads the ROM entirely in the browser; the ROM is never uploaded.
- Finds the root `wb_sound_data.sdat` sound archive.
- Lists BGM sequences (and optionally short `SEQ_ME_*` jingles).
- Groups known seasonal and Black/White variants under usage-based names.
- Uses `nitro-fs`'s SSEQ renderer and `activeTracks` mask to render individual sequence tracks as separate WAV stems.
- Omits silent sequence tracks.
- Generates one ZIP for all selected songs, with `info.txt` files containing the original internal sequence name/ID.
- Lets you choose a loop count: intro once, followed by exactly that many complete loop passes. Non-looping tracks render once.

## GitHub Pages

The repository includes `.github/workflows/pages.yml`, using the official GitHub Pages actions. If Pages has never been enabled for the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions** once.

## Dependencies

Loaded as ES modules at runtime:

- [`nitro-fs`](https://github.com/DanielPXL/nitro-fs) (LGPL-3.0-or-later)
- [`JSZip`](https://stuk.github.io/jszip/) (MIT)

No ROMs or game audio are included in this repository.
