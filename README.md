# Celere 2.0

Ground-up React, TypeScript, and Vite replacement for the Celere RSVP reader. The temporary ` celere (original)` directory is reference material only and is not part of this application.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`. The local parser and protected AI proxy run on port `8787`.

Set `OPENROUTER_API_KEY` in `.env.local` to enable optional Gemma features. The key is never exposed to the client. Semantic retrieval, exact search, RSVP reading, local summaries, and all core controls work without OpenRouter.

## Privacy

- Documents, reading progress, notes, settings, and normalized 384-dimensional vectors are stored in IndexedDB.
- Local semantic indexing uses `onnx-community/all-MiniLM-L6-v2-ONNX`, preferring WebGPU and falling back to WASM.
- Optional AI requests send only a short current passage or retrieved passages, never the complete document.
- Eye-away detection uses a local MediaPipe face/iris model. Frames and landmarks are not stored or transmitted.
- Voice commands and eye-away detection are off by default and require explicit browser permission.

Reader settings include image, direct-video, and YouTube background controls. Uploaded files stay local; remote media providers receive normal browser requests. Direct video and YouTube backgrounds support pause, loop, playback rate, opacity, scrim, blur, and removal.

## Shortsform

Shortsform mirrors the original Celere Brainrot mode as an interactive reading surface. It uses the shared document position, full-bleed gameplay, sentence-window captions, per-word narrated state, and chunk-level Edge TTS synchronized to playback.

- Book narration is blocked until the user confirms they own the text or have narration and distribution rights.
- YouTube footage is downloaded with `yt-dlp` only after a separate reuse-rights confirmation.
- Edge TTS receives only the active reading chunk, and playback waits for the adjusted narration duration before advancing.
- Caption size, line length, case, alignment, theme, voice, rate, pitch, and WPM are configurable.
- Cached footage and temporary narration files are stored in `.shortsform-cache/`.

The current development workspace can reuse the Edge TTS virtual environment in the reference project. For a standalone checkout, set `EDGE_TTS_PYTHON` to a Python executable with `edge-tts` installed.

The transformer runtime and MediaPipe detector are lazy-loaded only when semantic search or eye-away detection is enabled. The local ONNX WASM fallback remains in the production build so semantic retrieval continues to work without OpenRouter and after the model/runtime has been cached.

## Verify

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

See [docs/PARITY_MATRIX.md](docs/PARITY_MATRIX.md) for the tracked coverage audit. Brainrot Mode and all text-to-speech functionality are intentionally excluded.
