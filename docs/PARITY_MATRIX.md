# Celere Replacement Parity Matrix

The auditable source of truth is `src/config/features.ts`, which drives the searchable in-app Guide. The old Brainrot page remains excluded; its replacement is the rights-gated Shortsform export workflow.

| Area | Original / requested behavior | Replacement status |
| --- | --- | --- |
| Documents | PDF, EPUB, DOC, DOCX, TXT, HTML | Implemented |
| Playback | RSVP, play/pause, restart, next, smart rewind | Implemented |
| Languages | Automatic multilingual segmentation and punctuation attachment with AI phrase hints | Implemented |
| Modes | Skim, Deep Focus, Study | Implemented |
| Appearance | Fonts, size, weight, light/paper/dark/e-ink/high-contrast themes, contrast, colors, optional line/grid eye anchor, centered text-only focus auto-hide | Implemented |
| Media | Background controls in Reader settings; upload/image/direct video/YouTube; opacity, blur, dim, speed, pause, loop, removal | Implemented |
| Shortsform | Original Brainrot behavior: full-bleed gameplay, shared reading progress, live sentence-window captions, active-word highlighting, chunk-synced Edge TTS, caption controls, and rights gates | Implemented |
| Attention | Calibration, adaptive pace, focus ramp/window, drift recovery, clarity pauses | Implemented |
| Breaks | Manual, automatic, fatigue-aware, summaries | Implemented |
| Context | Context ladder, working-memory hold, restart primer | Implemented |
| Feedback | Sense checks, quizzes, reactions, notes, two-minute nudges, actual WPM, persisted streaks | Implemented |
| Progress | Linear progress, section milestones, time remaining | Implemented |
| Queue | Six recent documents, restoration, resurfacing prompt | Implemented |
| Search | Exact search and local semantic search with source citations | Implemented |
| Sensors | Voice commands and local eye-away detection, default off | Implemented |
| Audio | Brown noise, binaural beats, metronome, volume | Implemented |
| Help | Searchable registry-driven guide | Implemented |
| Privacy | Local camera landmarks, microphone status, storage disclosure, deletion controls | Implemented |
| AI | Protected Gemma proxy, strict schemas, timeouts, minimal context, deterministic local fallbacks | Implemented |
| Brainrot | Replaced by the behaviorally equivalent Shortsform live mode | Replaced |
| TTS | Chunk-level Edge TTS synchronized with Shortsform playback | Implemented |

## Verification

The registry test requires every entry to document its disable path. Unit tests cover real PDF/DOC/DOCX/EPUB/TXT/HTML parsing, corrupt inputs, tokenization, CJK focus handling, source mapping, scheduler timing, cancellation, large-book semantic passage construction, hybrid ranking, result diversification, settings migrations, and registry integrity. Playwright covers keyboard access, Guide navigation, semantic-search activation, background discovery, YouTube controls, dark/focus modes, mobile layout, reduced motion, and camera/microphone privacy defaults. Build, lint, and production dependency checks run independently.

## Original Source Audit

The temporary original source was compared field-by-field against the replacement settings and controls. All reader settings are represented: audio mode, adaptive pacing, AI symbol grouping, AI quizzes, title auto-hide, clarity pauses, context ladder, contrast, calm feedback, eye-away detection, drift recovery, typography, focus window/ramp, optional line/grid eye anchoring, micro-breaks, reading modes, motion smoothing, calibration ranges, sense checks, restart primer, queue resurfacing, sensory presets, milestones, focus point, sprint length, colors, themes including high contrast, voice commands, and WPM. The replacement adds independently controlled background media, semantic search, local embeddings, role highlights, AI context, complete UI auto-hide, privacy/deletion controls, and the Shortsform export workflow.
