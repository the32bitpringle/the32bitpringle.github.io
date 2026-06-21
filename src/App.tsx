import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ClipboardPaste,
  CircleHelp,
  CirclePause,
  CirclePlay,
  Clock3,
  FileUp,
  Flag,
  Focus,
  Gauge,
  Globe2,
  Library,
  ListRestart,
  MessageSquareText,
  Search,
  Settings,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import {
  type ChangeEvent,
  type CSSProperties,
  type RefObject,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { featureRegistry } from './config/features'
import { apiUrl } from './lib/api'
import {
  analyzeNarrationCast,
  analyzeSymbolGrouping,
  answerSemanticQuestion,
  classifyComplexity,
  createQuiz,
  summarizeContext,
} from './lib/ai'
import { AmbientAudio } from './lib/audio'
import { importDocument, importText, importWebsite } from './lib/documents'
import {
  buildFallbackNarrationCast,
  resolveNarrationVoice,
  sanitizeNarrationCast,
} from './lib/narration'
import { PlaybackScheduler } from './lib/scheduler'
import { exactSearch, ensureSemanticIndex, semanticSearch } from './lib/search'
import {
  alignTtsTimings,
  base64ToAudioBlob,
  getShortsformAudioPlaybackRate,
  getTtsTimingIndex,
  type AlignedTtsWordTiming,
  type TtsWordTiming,
} from './lib/shortsform'
import { isGazePresent } from './lib/gaze'
import { DEFAULT_READER_COLORS, modePresets, sensoryPresets } from './lib/settings'
import {
  deleteDocumentData,
  getDocument,
  getQueue,
  getSession,
  loadSettings,
  putDocument,
  putSession,
  saveQueueItem,
  saveSettings,
} from './lib/storage'
import {
  buildChunks,
  buildShortsformChunks,
  findChunkForWord,
  findMeaningfulRewind,
  getChunkDelay,
  getFocusPointIndex,
  getReadingDelays,
  applyDifficultWords,
  regroupDocument,
  tokensToText,
} from './lib/tokenize'
import type {
  AiQuiz,
  AiSearchAnswer,
  AppPage,
  NarrationCast,
  ParsedDocument,
  QueueItem,
  Reaction,
  ReaderSettings,
  ReaderHotkeyAction,
  ReadingChunk,
  SemanticSearchResult,
  SessionMetrics,
  ShortsformCaptionAlign,
  ShortsformCaptionPosition,
  ShortsformSubtitleCase,
  ShortsformSubtitleStyle,
  Token,
} from './types'

const EMPTY_METRICS: SessionMetrics = {
  focusedSeconds: 0,
  breaks: 0,
  recoveries: 0,
  lostFocus: 0,
  understood: 0,
  misunderstood: 0,
}

const STREAK_KEY = 'celere:v2:streak'
const FOCUS_UI_IDLE_MS = 3000
const WORD_FOCUS_WINDOW_SIZE = 960
const WORD_FOCUS_WINDOW_STEP = 160
const TEXT_VIEW_WINDOW_SIZE = 900
const TEXT_VIEW_CONTEXT_WORDS = 80

interface StreakState {
  count: number
  lastDay: string
}

interface ShortsformVoice {
  display_name: string
  gender?: string
  locale?: string
  name: string
}

interface ShortsformFootage {
  assetId: string
  kind?: 'local' | 'youtube'
  previewUrl: string
  title: string
}

interface ShortsformTtsAudio {
  blob: Blob
  timings: AlignedTtsWordTiming[]
}

const SHORTSFORM_SUBTITLE_STYLES: ShortsformSubtitleStyle[] = [
  'emphasis',
  'window',
  'plain',
  'karaoke',
  'outline',
  'block',
  'shadow',
]

const FONTS = [
  "'Times New Roman', serif",
  "'Atkinson Hyperlegible', sans-serif",
  "Georgia, serif",
  "'JetBrains Mono', monospace",
  "'Courier New', monospace",
  "Verdana, sans-serif",
]

type Overlay =
  | 'none'
  | 'countdown'
  | 'break'
  | 'microbreak'
  | 'drift'
  | 'hold'
  | 'sense'
  | 'complete'
  | 'sprint'
  | 'restart'

interface AppProps {
  authControls?: ReactNode
}

function App({ authControls }: AppProps = {}) {
  const [page, setPage] = useState<AppPage>('reader')
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings)
  const [document, setDocument] = useState<ParsedDocument | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [chunkIndex, setChunkIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [overlaySeconds, setOverlaySeconds] = useState(0)
  const [overlayText, setOverlayText] = useState('')
  const [error, setError] = useState('')
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [metrics, setMetrics] = useState<SessionMetrics>(EMPTY_METRICS)
  const [adaptiveOffset, setAdaptiveOffset] = useState(0)
  const [stableChunks, setStableChunks] = useState(0)
  const [sprintSeconds, setSprintSeconds] = useState(0)
  const [titleVisible, setTitleVisible] = useState(true)
  const [focusUiVisible, setFocusUiVisible] = useState(true)
  const [textOpen, setTextOpen] = useState(false)
  const [exactQuery, setExactQuery] = useState('')
  const [exactCursor, setExactCursor] = useState(0)
  const [notesOpen, setNotesOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [narrationMode, setNarrationMode] = useState(false)
  const [readerNarrationStatus, setReaderNarrationStatus] = useState('Off')
  const [narrationCast, setNarrationCast] = useState<NarrationCast | null>(null)
  const [calibrationOpen, setCalibrationOpen] = useState(!loadSettings().calibrationComplete)
  const [semanticOpen, setSemanticOpen] = useState(false)
  const [semanticQuery, setSemanticQuery] = useState('')
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([])
  const [semanticAnswer, setSemanticAnswer] = useState<AiSearchAnswer | null>(null)
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null)
  const [semanticStatus, setSemanticStatus] = useState('')
  const [quiz, setQuiz] = useState<AiQuiz | null>(null)
  const [quizChoice, setQuizChoice] = useState<number | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState({ voice: 'Off', eye: 'Off' })
  const [lastVoiceCommand, setLastVoiceCommand] = useState('')
  const [backgroundObjectUrl, setBackgroundObjectUrl] = useState('')
  const [quietUntil, setQuietUntil] = useState(-1)
  const [streak, setStreak] = useState<StreakState>(loadStreak)
  const [focusNudge, setFocusNudge] = useState('')
  const [shortsformVoices, setShortsformVoices] = useState<ShortsformVoice[]>([])
  const [shortsformTtsStatus, setShortsformTtsStatus] = useState('Loading Edge TTS voices…')
  const [shortsformWordIndex, setShortsformWordIndex] = useState(0)
  const [shortsformActiveWordIndex, setShortsformActiveWordIndex] = useState<number | null>(null)
  const [shortsformAudioTimingActive, setShortsformAudioTimingActive] = useState(false)
  const [sessionWordsRead, setSessionWordsRead] = useState(0)
  const [sessionReadingMs, setSessionReadingMs] = useState(0)

  const scheduler = useRef(new PlaybackScheduler())
  const playbackDeadlineRef = useRef<number | null>(null)
  const audio = useRef(new AmbientAudio())
  const indexAbort = useRef<AbortController | null>(null)
  const mediaRef = useRef<HTMLVideoElement>(null)
  const youtubeRef = useRef<HTMLIFrameElement>(null)
  const cameraRef = useRef<HTMLVideoElement>(null)
  const eyeStreamRef = useRef<MediaStream | null>(null)
  const eyeTimerRef = useRef<number | null>(null)
  const restoreSettingsRef = useRef(settings)
  const titleTimerRef = useRef<number | null>(null)
  const rewindBurstRef = useRef(0)
  const speedBurstRef = useRef(0)
  const chunksSinceBreakRef = useRef(0)
  const readerWordIndexRef = useRef(0)
  const shortsformAudioRef = useRef<HTMLAudioElement | null>(null)
  const shortsformAudioUrlRef = useRef('')
  const shortsformAudioWatchdogRef = useRef<number | null>(null)
  const shortsformTimingFrameRef = useRef<number | null>(null)
  const shortsformTimedWordRef = useRef<number | null>(null)
  const readerNarrationAudioRef = useRef<HTMLAudioElement | null>(null)
  const readerNarrationAudioUrlRef = useRef('')
  const wordFocusHighlightRef = useRef<(wordIndex: number) => void>(() => {})
  const narrationCastDocumentRef = useRef('')
  const shortsformTtsCacheRef = useRef(new Map<string, Promise<ShortsformTtsAudio>>())
  const shortsformRawAudioDurationRef = useRef(0)
  const shortsformTargetDurationRef = useRef(0)
  const shortsformTtsRateRef = useRef(settings.shortsformTtsRate)

  const readerChunks = useMemo(
    () => document ? buildChunks(document, settings.chunkSize, settings.mode) : [],
    [document, settings.chunkSize, settings.mode],
  )
  const focusChunks = useMemo(
    () => document ? buildChunks(document, 1, 'study') : [],
    [document],
  )
  const shortsformChunks = useMemo(
    () => document ? buildShortsformChunks(document) : [],
    [document],
  )
  const readerUsesSentenceChunks = narrationMode && page === 'reader'
  const chunks = page === 'shortsform' || readerUsesSentenceChunks
    ? shortsformChunks
    : page === 'focus'
      ? focusChunks
      : readerChunks
  const safeChunkIndex = Math.min(chunkIndex, Math.max(chunks.length - 1, 0))
  const currentChunk = chunks[safeChunkIndex] ?? null
  readerWordIndexRef.current = currentChunk?.startWordIndex ?? 0
  const readerNarrationChunk = narrationMode && (page === 'reader' || page === 'focus') && currentChunk
    ? shortsformChunks[findChunkForWord(shortsformChunks, currentChunk.startWordIndex)] ?? null
    : null
  const progress = chunks.length > 1 ? safeChunkIndex / (chunks.length - 1) : 0
  const ramp = settings.focusRamp ? Math.min(1.12, 0.74 + stableChunks * 0.025) : 1
  const effectiveWpm = page === 'shortsform'
    ? settings.shortsformWpm
    : Math.max(50, Math.round((settings.wpm + adaptiveOffset) * ramp))
  const pauseDurations = useMemo(() => ({
    commaMs: settings.pauseCommaMs,
    periodMs: settings.pausePeriodMs,
    longWordMs: settings.pauseLongWordMs,
  }), [settings.pauseCommaMs, settings.pausePeriodMs, settings.pauseLongWordMs])
  const readingDelays = useMemo(
    () => getReadingDelays(chunks, effectiveWpm, settings.clarityPauses, pauseDurations),
    [chunks, effectiveWpm, pauseDurations, settings.clarityPauses],
  )
  const narrationDelays = useMemo(
    () => getReadingDelays(shortsformChunks, effectiveWpm, settings.clarityPauses, pauseDurations),
    [effectiveWpm, pauseDurations, settings.clarityPauses, shortsformChunks],
  )
  const currentVisualDelay = readingDelays[safeChunkIndex] ?? 0
  shortsformTargetDurationRef.current = currentVisualDelay
  shortsformTtsRateRef.current = settings.shortsformTtsRate
  const measuredWpm = sessionReadingMs > 4_000
    ? Math.round(sessionWordsRead / sessionReadingMs * 60_000)
    : 0
  const minutesLeft = document
    ? Math.max(1, Math.ceil((document.tokens.length - (currentChunk?.startWordIndex ?? 0)) / effectiveWpm))
    : 0
  const currentSection = document?.sections[currentChunk?.sectionIndex ?? 0]
  const exactMatches = useMemo(
    () => document ? exactSearch(document, exactQuery) : [],
    [document, exactQuery],
  )
  const contextLadder = useMemo(() => ({
    previous: chunks[safeChunkIndex - 1]?.text ?? 'Start of document',
    current: currentChunk?.text ?? '',
    next: chunks[safeChunkIndex + 1]?.text ?? 'End of document',
  }), [chunks, currentChunk, safeChunkIndex])
  const currentTone = getTone(currentChunk?.text ?? '')
  const attention = !playing
    ? 'Ready'
    : metrics.lostFocus > metrics.recoveries
      ? 'Recovering'
      : adaptiveOffset > 12
        ? 'Flowing'
        : 'Settling'

  const updateSetting = useCallback(<K extends keyof ReaderSettings>(
    key: K,
    value: ReaderSettings[K],
  ) => {
    if (key === 'wpm') {
      speedBurstRef.current += 1
      if (speedBurstRef.current >= 3 && settings.driftRecovery && playing) {
        setPlaying(false)
        setOverlay('drift')
        setOverlayText('Several pace changes suggest the current rhythm is not working. Resume from the last clear sentence.')
        speedBurstRef.current = 0
      }
    }
    setSettings((current) => ({ ...current, [key]: value }))
  }, [playing, settings.driftRecovery])

  const navigateToPage = useCallback((nextPage: AppPage) => {
    const wordIndex = currentChunk?.startWordIndex ?? 0
    const targetChunks = nextPage === 'shortsform'
      ? shortsformChunks
      : nextPage === 'focus'
        ? focusChunks
        : readerChunks
    setChunkIndex(findChunkForWord(targetChunks, wordIndex))
    setOverlay('none')
    setPage(nextPage)
  }, [currentChunk?.startWordIndex, focusChunks, readerChunks, shortsformChunks])

  const registerWordFocusHighlighter = useCallback((highlight: (wordIndex: number) => void) => {
    wordFocusHighlightRef.current = highlight
  }, [])

  const jumpToFocusWord = useCallback((wordIndex: number) => {
    setChunkIndex(findChunkForWord(focusChunks, wordIndex))
  }, [focusChunks])

  const persistPosition = useCallback(async (nextChunkIndex = safeChunkIndex) => {
    if (!document) return
    const wordIndex = chunks[nextChunkIndex]?.startWordIndex ?? 0
    await Promise.all([
      putSession({
        documentId: document.id,
        currentWordIndex: wordIndex,
        currentChunkIndex: nextChunkIndex,
        mode: settings.mode,
        metrics,
        reactions,
        bookmarks: [],
        updatedAt: Date.now(),
      }),
      saveQueueItem({
        documentId: document.id,
        title: document.title,
        format: document.format,
        currentWordIndex: wordIndex,
        mode: settings.mode,
        savedAt: Date.now(),
      }),
    ])
    setQueue(await getQueue())
  }, [chunks, document, metrics, reactions, safeChunkIndex, settings.mode])
  const persistPositionRef = useRef(persistPosition)
  persistPositionRef.current = persistPosition

  const pauseForContext = useCallback((kind: 'break' | 'hold' | 'drift') => {
    if (!currentChunk) return
    setPlaying(false)
    scheduler.current.cancel()
    audio.current.stop()
    const start = Math.max(0, currentChunk.startWordIndex - 90)
    const end = Math.min(document?.tokens.length ?? 0, currentChunk.endWordIndex + 45)
    const localContext = document ? tokensToText(document.tokens.slice(start, end)) : currentChunk.text
    const fallback = kind === 'break'
      ? `Recent: ${tokensToText(document?.tokens.slice(Math.max(0, currentChunk.startWordIndex - 45), currentChunk.endWordIndex + 1) ?? [])} Next: ${tokensToText(document?.tokens.slice(currentChunk.endWordIndex + 1, currentChunk.endWordIndex + 30) ?? [])}`
      : `Who / what / where: ${localContext}`
    setOverlayText(fallback)
    setOverlay(kind)
    if (kind === 'break') setMetrics((value) => ({ ...value, breaks: value.breaks + 1 }))
    if (settings.aiContext && kind !== 'drift') {
      void summarizeContext(localContext, kind === 'hold' ? 'who-what-where' : 'break')
        .then((result) => setOverlayText(result.summary))
        .catch(() => undefined)
    }
  }, [currentChunk, document, settings.aiContext])

  const smartRewind = useCallback(() => {
    if (!currentChunk || chunks.length === 0) return
    rewindBurstRef.current += 1
    const target = findMeaningfulRewind(chunks, safeChunkIndex)
    setPlaying(false)
    setChunkIndex(target)
    setAdaptiveOffset((value) => Math.max(
      value - 18,
      settings.profile.preferredWpmMin - settings.wpm,
    ))
    setStableChunks(0)
    setOverlayText(chunks.slice(target, Math.min(target + 3, chunks.length)).map((chunk) => chunk.text).join(' '))
    if (rewindBurstRef.current >= 3 && settings.driftRecovery) {
      setOverlay('drift')
      rewindBurstRef.current = 0
      setMetrics((value) => ({ ...value, recoveries: value.recoveries + 1 }))
    }
    void persistPosition(target)
  }, [chunks, currentChunk, persistPosition, safeChunkIndex, settings.driftRecovery, settings.profile.preferredWpmMin, settings.wpm])

  const startPlayback = useCallback(() => {
    if (!document || chunks.length === 0) return
    if (settings.audioMode === 'soft-drums') {
      void audio.current.start('soft-drums', settings.audioVolume, effectiveWpm)
    }
    if (page === 'reader' && safeChunkIndex === 0 && metrics.focusedSeconds === 0) {
      setOverlaySeconds(5)
      setOverlay('countdown')
      return
    }
    setOverlay('none')
    setPlaying(true)
  }, [
    chunks.length,
    document,
    effectiveWpm,
    metrics.focusedSeconds,
    page,
    safeChunkIndex,
    settings.audioMode,
    settings.audioVolume,
  ])

  const togglePlayback = useCallback(() => {
    if (playing) {
      setPlaying(false)
      scheduler.current.cancel()
      audio.current.stop()
    } else {
      startPlayback()
    }
  }, [playing, startPlayback])

  const toggleNarration = useCallback(() => {
    const wordIndex = currentChunk?.startWordIndex ?? 0
    if (narrationMode) {
      setNarrationMode(false)
      setReaderNarrationStatus('Off')
      const targetChunks = page === 'focus' ? focusChunks : readerChunks
      setChunkIndex(findChunkForWord(targetChunks, wordIndex))
      return
    }
    if (!document || shortsformChunks.length === 0) return
    if (page === 'reader') setChunkIndex(findChunkForWord(shortsformChunks, wordIndex))
    setNarrationMode(true)
    setReaderNarrationStatus('Preparing narration…')
    setOverlay('none')
    if (settings.audioMode === 'soft-drums') {
      void audio.current.start('soft-drums', settings.audioVolume, effectiveWpm)
    }
    setPlaying(true)
  }, [
    currentChunk?.startWordIndex,
    document,
    effectiveWpm,
    focusChunks,
    narrationMode,
    page,
    readerChunks,
    settings.audioMode,
    settings.audioVolume,
    shortsformChunks,
  ])

  const handleComprehension = useCallback((understood: boolean) => {
    setOverlay('none')
    setQuiz(null)
    setQuizChoice(null)
    setMetrics((value) => ({
      ...value,
      understood: value.understood + (understood ? 1 : 0),
      misunderstood: value.misunderstood + (understood ? 0 : 1),
    }))
    if (understood) {
      if (settings.adaptivePacing) setAdaptiveOffset((value) => Math.min(value + 8, settings.profile.preferredWpmMax - settings.wpm))
      setPlaying(true)
    } else {
      setAdaptiveOffset((value) => Math.max(value - 25, settings.profile.preferredWpmMin - settings.wpm))
      setReactions((value) => currentChunk ? [...value, makeReaction(document!, currentChunk, safeChunkIndex, 'confused')] : value)
      pauseForContext('drift')
    }
  }, [currentChunk, document, pauseForContext, safeChunkIndex, settings.adaptivePacing, settings.profile.preferredWpmMax, settings.profile.preferredWpmMin, settings.wpm])

  const addReaction = useCallback((kind: 'important' | 'confused' | 'understood') => {
    if (!currentChunk || !document) return
    setReactions((value) => [...value, makeReaction(document, currentChunk, safeChunkIndex, kind)])
  }, [currentChunk, document, safeChunkIndex])

  useEffect(() => saveSettings(settings), [settings])

  useEffect(() => {
    const speech = new Audio()
    speech.preload = 'auto'
    shortsformAudioRef.current = speech
    const readerSpeech = new Audio()
    readerSpeech.preload = 'auto'
    readerNarrationAudioRef.current = readerSpeech
    return () => {
      speech.pause()
      readerSpeech.pause()
      if (shortsformAudioUrlRef.current) URL.revokeObjectURL(shortsformAudioUrlRef.current)
      if (readerNarrationAudioUrlRef.current) URL.revokeObjectURL(readerNarrationAudioUrlRef.current)
      shortsformAudioRef.current = null
      readerNarrationAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    let active = true
    void fetch(apiUrl('/api/tts/voices'))
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error ?? 'Edge TTS voices are unavailable.')
        return body as ShortsformVoice[]
      })
      .then((voices) => {
        if (!active) return
        setShortsformVoices(voices)
        setShortsformTtsStatus(voices.length ? 'Edge TTS ready.' : 'No Edge TTS voices found.')
        setSettings((current) => voices.length && !voices.some((voice) => voice.name === current.shortsformTtsVoice)
          ? { ...current, shortsformTtsVoice: voices.find((voice) => voice.name === 'en-US-AriaNeural')?.name ?? voices[0].name }
          : current)
      })
      .catch((reason) => {
        if (active) setShortsformTtsStatus(reason instanceof Error ? reason.message : 'Edge TTS is unavailable.')
      })
    return () => { active = false }
  }, [])

  const fallbackNarrationCast = useMemo(
    () => document && shortsformVoices.length
      ? buildFallbackNarrationCast(document.text, shortsformVoices, settings.shortsformTtsVoice)
      : null,
    [document, settings.shortsformTtsVoice, shortsformVoices],
  )

  useEffect(() => {
    if (!fallbackNarrationCast) {
      setNarrationCast(null)
      narrationCastDocumentRef.current = ''
      return
    }
    setNarrationCast(fallbackNarrationCast)
    if (!narrationMode || !document || narrationCastDocumentRef.current === document.id) return
    narrationCastDocumentRef.current = document.id
    const controller = new AbortController()
    setReaderNarrationStatus('Casting story voices…')
    void analyzeNarrationCast(
      document.text.slice(0, 14_000),
      document.title,
      shortsformVoices,
      controller.signal,
    ).then((cast) => {
      setNarrationCast(sanitizeNarrationCast(cast, shortsformVoices, fallbackNarrationCast))
      setReaderNarrationStatus('Character voices ready')
    }).catch(() => {
      setReaderNarrationStatus('Using locally assigned character voices')
    })
    return () => controller.abort()
  }, [document, fallbackNarrationCast, narrationMode, shortsformVoices])

  const getShortsformTtsAudio = useCallback((
    chunk: ReadingChunk,
    rate = '+0%',
    voice = settings.shortsformTtsVoice,
  ) => {
    const key = [
      chunk.id,
      voice,
      settings.shortsformTtsPitch,
      rate,
    ].join('|')
    const cached = shortsformTtsCacheRef.current.get(key)
    if (cached) return cached

    const request = fetch(apiUrl('/api/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: chunk.text,
        voice,
        rate,
        pitch: toEdgeTtsPitch(settings.shortsformTtsPitch),
      }),
    }).then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error ?? 'Edge TTS synthesis failed.')
      }
      if (typeof body?.audioBase64 !== 'string' || !Array.isArray(body?.timings)) {
        throw new Error('Edge TTS returned an invalid timing response.')
      }
      return {
        blob: base64ToAudioBlob(body.audioBase64),
        timings: alignTtsTimings(
          body.timings as TtsWordTiming[],
          chunk.tokens.map((token) => token.text),
        ),
      }
    }).catch((reason) => {
      shortsformTtsCacheRef.current.delete(key)
      throw reason
    })

    shortsformTtsCacheRef.current.set(key, request)
    if (shortsformTtsCacheRef.current.size > 12) {
      const oldestKey = shortsformTtsCacheRef.current.keys().next().value
      if (oldestKey) shortsformTtsCacheRef.current.delete(oldestKey)
    }
    return request
  }, [
    settings.shortsformTtsPitch,
    settings.shortsformTtsVoice,
  ])

  useEffect(() => {
    if (page !== 'shortsform' || !settings.shortsformTts || !currentChunk) return
    const upcoming = chunks.slice(safeChunkIndex + 1, safeChunkIndex + 4)
    void getShortsformTtsAudio(currentChunk).catch(() => undefined)
    upcoming.forEach((chunk) => void getShortsformTtsAudio(chunk).catch(() => undefined))
  }, [
    chunks,
    currentChunk,
    getShortsformTtsAudio,
    page,
    safeChunkIndex,
    settings.shortsformTts,
  ])

  useEffect(() => {
    const speech = shortsformAudioRef.current
    const stopSpeech = () => {
      if (shortsformAudioWatchdogRef.current !== null) {
        clearTimeout(shortsformAudioWatchdogRef.current)
        shortsformAudioWatchdogRef.current = null
      }
      if (shortsformTimingFrameRef.current !== null) {
        cancelAnimationFrame(shortsformTimingFrameRef.current)
        shortsformTimingFrameRef.current = null
      }
      shortsformTimedWordRef.current = null
      setShortsformAudioTimingActive(false)
      if (speech) {
        speech.pause()
        speech.currentTime = 0
        speech.onloadedmetadata = null
        speech.onplay = null
        speech.onended = null
        speech.onerror = null
        speech.removeAttribute('src')
        speech.load()
      }
      if (shortsformAudioUrlRef.current) {
        URL.revokeObjectURL(shortsformAudioUrlRef.current)
        shortsformAudioUrlRef.current = ''
      }
    }

    if (page !== 'shortsform' || !playing || !currentChunk) {
      setShortsformWordIndex(currentChunk?.startWordIndex ?? 0)
      setShortsformActiveWordIndex(null)
      stopSpeech()
      return
    }

    setShortsformWordIndex(currentChunk.startWordIndex)
    setShortsformActiveWordIndex(null)
    if (!settings.shortsformTts || !speech) {
      stopSpeech()
      return
    }

    setShortsformTtsStatus('Preparing narration…')
    let active = true
    const advanceChunk = () => {
      if (!active) return
      if (shortsformAudioWatchdogRef.current !== null) {
        clearTimeout(shortsformAudioWatchdogRef.current)
        shortsformAudioWatchdogRef.current = null
      }
      if (shortsformTimingFrameRef.current !== null) {
        cancelAnimationFrame(shortsformTimingFrameRef.current)
        shortsformTimingFrameRef.current = null
      }
      setShortsformAudioTimingActive(false)
      setShortsformTtsStatus('Preparing the next narration phrase…')
      const next = safeChunkIndex + 1
      if (next >= chunks.length) {
        setPlaying(false)
        setOverlay('complete')
        return
      }
      playbackDeadlineRef.current = null
      scheduler.current.cancel()
      setChunkIndex((value) => value === safeChunkIndex ? next : value)
    }
    void getShortsformTtsAudio(currentChunk)
      .then(async ({ blob, timings }) => {
        if (!active) return
        const objectUrl = URL.createObjectURL(blob)
        shortsformAudioUrlRef.current = objectUrl
        speech.onloadedmetadata = () => {
          const rawDurationMs = Number.isFinite(speech.duration) ? speech.duration * 1000 : 0
          shortsformRawAudioDurationRef.current = rawDurationMs
          const playbackRate = getShortsformAudioPlaybackRate(
            rawDurationMs,
            shortsformTargetDurationRef.current,
            shortsformTtsRateRef.current,
          )
          speech.playbackRate = playbackRate
        }
        speech.onplay = () => {
          setShortsformTtsStatus(`Narrating with ${settings.shortsformTtsVoice}.`)
          scheduler.current.cancel()
          playbackDeadlineRef.current = null
          shortsformAudioWatchdogRef.current = window.setTimeout(
            advanceChunk,
            Math.max(currentVisualDelay * 1.5, currentVisualDelay + 3000),
          )
          if (!timings.length) return
          setShortsformAudioTimingActive(true)
          const updateTimedWord = () => {
            if (!active || speech.paused || speech.ended) return
            const timingIndex = getTtsTimingIndex(timings, speech.currentTime * 1000)
            const timing = timings[timingIndex]
            if (timing) {
              const wordIndex = currentChunk.startWordIndex + timing.tokenOffset
              if (shortsformTimedWordRef.current !== wordIndex) {
                shortsformTimedWordRef.current = wordIndex
                setShortsformWordIndex(wordIndex)
                setShortsformActiveWordIndex(wordIndex)
              }
            }
            shortsformTimingFrameRef.current = requestAnimationFrame(updateTimedWord)
          }
          shortsformTimingFrameRef.current = requestAnimationFrame(updateTimedWord)
        }
        speech.onended = advanceChunk
        speech.onerror = () => {
          setShortsformAudioTimingActive(false)
          setShortsformTtsStatus('Edge TTS audio could not be played. Visual timing is continuing.')
        }
        speech.src = objectUrl
        speech.load()
        await speech.play()
      })
      .catch((reason) => {
        if (active) {
          setShortsformTtsStatus(reason instanceof Error ? reason.message : 'Edge TTS synthesis failed.')
        }
      })

    return () => {
      active = false
      stopSpeech()
    }
  }, [
    currentChunk,
    chunks.length,
    currentVisualDelay,
    getShortsformTtsAudio,
    page,
    playing,
    safeChunkIndex,
    settings.shortsformTts,
    settings.shortsformTtsVoice,
  ])

  useEffect(() => {
    if (
      page !== 'shortsform' ||
      !playing ||
      !currentChunk ||
      (settings.shortsformTts && shortsformAudioTimingActive)
    ) return
    setShortsformWordIndex(currentChunk.startWordIndex)
    setShortsformActiveWordIndex(currentChunk.startWordIndex)
    const timer = window.setInterval(() => {
      setShortsformWordIndex((value) => {
        const next = Math.min(value + 1, currentChunk.endWordIndex)
        setShortsformActiveWordIndex(next)
        return next
      })
    }, currentVisualDelay / Math.max(currentChunk.tokens.length, 1))
    return () => {
      clearInterval(timer)
    }
  }, [
    currentChunk,
    currentVisualDelay,
    page,
    playing,
    settings.shortsformTts,
    shortsformAudioTimingActive,
  ])

  useEffect(() => {
    const speech = shortsformAudioRef.current
    const rawDurationMs = shortsformRawAudioDurationRef.current
    if (!speech || rawDurationMs <= 0 || page !== 'shortsform') return
    const playbackRate = getShortsformAudioPlaybackRate(
      rawDurationMs,
      currentVisualDelay,
      settings.shortsformTtsRate,
    )
    speech.playbackRate = playbackRate
  }, [currentVisualDelay, page, settings.shortsformTtsRate])

  useEffect(() => {
    if (!settings.dopamineFeedback) {
      setFocusNudge('')
      return
    }
    const completedBlocks = Math.floor(metrics.focusedSeconds / 120)
    if (completedBlocks <= 0) return
    setFocusNudge(`You stayed with the text for ${completedBlocks * 2} focused minutes.`)
    const today = new Date().toISOString().slice(0, 10)
    if (streak.lastDay === today) return
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const next = { count: streak.lastDay === yesterday ? streak.count + 1 : 1, lastDay: today }
    localStorage.setItem(STREAK_KEY, JSON.stringify(next))
    setStreak(next)
  }, [metrics.focusedSeconds, settings.dopamineFeedback, streak])

  useEffect(() => {
    const restoreSettings = restoreSettingsRef.current
    void getQueue().then(async (items) => {
      setQueue(items)
      if (items[0]) {
        const savedDocument = await getDocument(items[0].documentId)
        if (savedDocument) {
          setDocument(savedDocument)
          const savedSession = await getSession(savedDocument.id)
          if (savedSession) {
            const restoredChunks = buildChunks(savedDocument, restoreSettings.chunkSize, restoreSettings.mode)
            setChunkIndex(findChunkForWord(restoredChunks, savedSession.currentWordIndex))
            setMetrics(savedSession.metrics)
            setReactions(savedSession.reactions)
            if (restoreSettings.restartPrimer && savedSession.currentWordIndex > 0) {
              setOverlayText(`${savedDocument.title} · ${Math.max(1, Math.ceil((savedDocument.tokens.length - savedSession.currentWordIndex) / restoreSettings.wpm))} minutes left.`)
              setOverlay('restart')
            }
          }
        }
      }
    })
  }, [])

  useEffect(() => {
    playbackDeadlineRef.current = null
    scheduler.current.cancel()
  }, [readingDelays])

  useEffect(() => {
    if (!playing || !currentChunk || overlay !== 'none' || narrationMode) {
      playbackDeadlineRef.current = null
      return
    }
    const activeScheduler = scheduler.current
    const activeAudio = audio.current
    if (settings.audioMode !== 'soft-drums') {
      void activeAudio.start(settings.audioMode, settings.audioVolume, effectiveWpm / settings.chunkSize)
    }
    const delay = readingDelays[safeChunkIndex] ?? 0
    const now = performance.now()
    const deadline = playbackDeadlineRef.current ?? now + delay
    playbackDeadlineRef.current = deadline
    activeScheduler.schedule(Math.max(0, deadline - now), () => {
      const next = safeChunkIndex + 1
      if (next >= chunks.length) {
        playbackDeadlineRef.current = null
        setPlaying(false)
        activeAudio.stop()
        setOverlay('complete')
        return
      }
      playbackDeadlineRef.current = deadline + (readingDelays[next] ?? 0)
      const nextFocused = metrics.focusedSeconds + delay / 1000
      const fatigue = getFatigueScore(currentChunk, chunksSinceBreakRef.current, nextFocused, metrics)
      setChunkIndex(next)
      setStableChunks((value) => value + 1)
      setSessionWordsRead((value) => value + currentChunk.tokens.length)
      setSessionReadingMs((value) => value + delay)
      setMetrics((value) => ({ ...value, focusedSeconds: nextFocused }))
      chunksSinceBreakRef.current += 1
      if (settings.adaptivePacing && (stableChunks + 1) % 10 === 0) {
        setAdaptiveOffset((value) => Math.min(value + 10, settings.profile.preferredWpmMax - settings.wpm))
      }
      if (
        page !== 'shortsform' &&
        settings.quickSenseChecks &&
        next > quietUntil &&
        ((settings.mode === 'study' && (stableChunks + 1) % 10 === 0) || fatigue >= 12)
      ) {
        setPlaying(false)
        const context = getNearbyContext(document!, chunks[next])
        setOverlayText(context)
        setOverlay('sense')
        if (settings.aiMicroQuizzes) {
          void createQuiz(context, settings.mode, document!.title)
            .then(setQuiz)
            .catch(() => setQuiz(null))
        }
      } else if (
        page !== 'shortsform' &&
        settings.microBreaks &&
        next > quietUntil &&
        (chunksSinceBreakRef.current >= settings.microBreakInterval || fatigue >= 14)
      ) {
        chunksSinceBreakRef.current = 0
        setPlaying(false)
        setOverlaySeconds(Math.min(20, settings.microBreakDuration + Math.floor(fatigue / 7)))
        setOverlay('microbreak')
        setMetrics((value) => ({ ...value, breaks: value.breaks + 1 }))
      }
      void persistPosition(next)
    })
    return () => {
      activeScheduler.cancel()
      activeAudio.stop()
    }
  }, [
    chunks,
    currentChunk,
    document,
    effectiveWpm,
    metrics,
    narrationMode,
    overlay,
    persistPosition,
    playing,
    page,
    quietUntil,
    readingDelays,
    safeChunkIndex,
    settings,
    stableChunks,
  ])

  useEffect(() => {
    if ((overlay !== 'countdown' && overlay !== 'microbreak') || overlaySeconds <= 0) return
    const timer = window.setTimeout(() => {
      setOverlaySeconds((value) => {
        if (value <= 1) {
          setOverlay('none')
          setPlaying(true)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearTimeout(timer)
  }, [overlay, overlaySeconds])

  useEffect(() => {
    if (!playing || sprintSeconds <= 0) return
    const timer = window.setTimeout(() => setSprintSeconds((value) => {
      if (value <= 1) {
        setPlaying(false)
        setOverlay('sprint')
        return 0
      }
      return value - 1
    }), 1000)
    return () => clearTimeout(timer)
  }, [playing, sprintSeconds])

  useEffect(() => {
    if (!playing || !settings.autoHideTitle) {
      setTitleVisible(true)
      return
    }
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    titleTimerRef.current = window.setTimeout(() => setTitleVisible(false), settings.autoHideTitleDelay * 1000)
    const reveal = () => {
      setTitleVisible(true)
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      titleTimerRef.current = window.setTimeout(() => setTitleVisible(false), settings.autoHideTitleDelay * 1000)
    }
    window.addEventListener('mousemove', reveal)
    window.addEventListener('pointerdown', reveal)
    window.addEventListener('touchstart', reveal)
    return () => {
      window.removeEventListener('mousemove', reveal)
      window.removeEventListener('pointerdown', reveal)
      window.removeEventListener('touchstart', reveal)
    }
  }, [playing, settings.autoHideTitle, settings.autoHideTitleDelay])

  useEffect(() => {
    const canHide = Boolean(document)
      && (page === 'reader' || page === 'focus')
      && settings.autoHideFocusUi
      && overlay === 'none'
      && !settingsOpen
      && !semanticOpen
      && !textOpen
      && !notesOpen
      && !shortcutsOpen
      && !calibrationOpen
    if (!canHide) {
      setFocusUiVisible(true)
      return
    }

    let timer = window.setTimeout(
      () => setFocusUiVisible(false),
      FOCUS_UI_IDLE_MS,
    )
    const reveal = () => {
      setFocusUiVisible(true)
      clearTimeout(timer)
      timer = window.setTimeout(
        () => setFocusUiVisible(false),
        FOCUS_UI_IDLE_MS,
      )
    }
    window.addEventListener('pointermove', reveal)
    window.addEventListener('pointerdown', reveal)
    window.addEventListener('mousemove', reveal)
    window.addEventListener('wheel', reveal, { passive: true })
    window.addEventListener('touchstart', reveal, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', reveal)
      window.removeEventListener('pointerdown', reveal)
      window.removeEventListener('mousemove', reveal)
      window.removeEventListener('wheel', reveal)
      window.removeEventListener('touchstart', reveal)
    }
  }, [
    calibrationOpen,
    document,
    notesOpen,
    overlay,
    page,
    semanticOpen,
    settings.autoHideFocusUi,
    settingsOpen,
    shortcutsOpen,
    textOpen,
  ])

  useEffect(() => {
    const drift = () => {
      if (playing && settings.driftRecovery) {
        setMetrics((value) => ({ ...value, lostFocus: value.lostFocus + 1, recoveries: value.recoveries + 1 }))
        pauseForContext('drift')
      }
    }
    const visibility = () => { if (document && globalThis.document.visibilityState === 'hidden') drift() }
    globalThis.document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', drift)
    return () => {
      globalThis.document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', drift)
    }
  }, [document, pauseForContext, playing, settings.driftRecovery])

  useEffect(() => {
    if (!settings.voiceCommands) {
      setRuntimeStatus((value) => ({ ...value, voice: 'Off' }))
      return
    }
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!Recognition) {
      setRuntimeStatus((value) => ({ ...value, voice: 'Unsupported in this browser' }))
      return
    }
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onstart = () => setRuntimeStatus((value) => ({ ...value, voice: 'Listening' }))
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.toLowerCase() ?? ''
      setLastVoiceCommand(transcript)
      if (/\b(play|resume|start)\b/.test(transcript)) startPlayback()
      else if (/\b(pause|stop)\b/.test(transcript)) setPlaying(false)
      else if (/\bbreak\b/.test(transcript)) pauseForContext('break')
      else if (/\b(rewind|back)\b/.test(transcript)) smartRewind()
      else if (/\bnext\b/.test(transcript)) setChunkIndex((value) => Math.min(value + 1, chunks.length - 1))
      else if (/\bsettings\b/.test(transcript)) setSettingsOpen((value) => !value)
      else if (/\bguide\b/.test(transcript)) setPage('guide')
    }
    recognition.onerror = () => setRuntimeStatus((value) => ({ ...value, voice: 'Permission denied or unavailable' }))
    try { recognition.start() } catch { setRuntimeStatus((value) => ({ ...value, voice: 'Could not start' })) }
    return () => recognition.stop()
  }, [chunks.length, pauseForContext, settings.voiceCommands, smartRewind, startPlayback])

  useEffect(() => {
    if (!settings.eyeTracking) {
      eyeStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (eyeTimerRef.current) clearInterval(eyeTimerRef.current)
      setRuntimeStatus((value) => ({ ...value, eye: 'Off' }))
      return
    }
    let awaySince: number | null = null
    void navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' } }).then((stream) => {
      eyeStreamRef.current = stream
      if (cameraRef.current) {
        cameraRef.current.srcObject = stream
        void cameraRef.current.play()
      }
      setRuntimeStatus((value) => ({ ...value, eye: 'Loading local face model' }))
      eyeTimerRef.current = window.setInterval(async () => {
        if (!playing || !cameraRef.current) { awaySince = null; return }
        let visible = false
        try {
          visible = cameraRef.current.readyState >= 2
            && await isGazePresent(cameraRef.current, performance.now())
          setRuntimeStatus((value) => ({ ...value, eye: 'Active; iris landmarks stay local' }))
        } catch {
          setRuntimeStatus((value) => ({ ...value, eye: 'Local face model unavailable' }))
        }
        if (visible) awaySince = null
        else if (!awaySince) awaySince = Date.now()
        else if (Date.now() - awaySince > 6000) pauseForContext('drift')
      }, 1500)
    }).catch(() => setRuntimeStatus((value) => ({ ...value, eye: 'Camera permission required' })))
    return () => {
      eyeStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (eyeTimerRef.current) clearInterval(eyeTimerRef.current)
    }
  }, [pauseForContext, playing, settings.eyeTracking])

  useEffect(() => {
    const speech = readerNarrationAudioRef.current
    let fallbackUtterance: SpeechSynthesisUtterance | null = null
    const stopSpeech = () => {
      if (speech) {
        speech.pause()
        speech.currentTime = 0
        speech.onloadedmetadata = null
        speech.onplay = null
        speech.ontimeupdate = null
        speech.onended = null
        speech.onerror = null
        speech.removeAttribute('src')
        speech.load()
      }
      if (readerNarrationAudioUrlRef.current) {
        URL.revokeObjectURL(readerNarrationAudioUrlRef.current)
        readerNarrationAudioUrlRef.current = ''
      }
      if (fallbackUtterance) {
        window.speechSynthesis?.cancel()
        fallbackUtterance = null
      }
    }

    if (!narrationMode || !playing || (page !== 'reader' && page !== 'focus') || !readerNarrationChunk || !speech) {
      stopSpeech()
      return
    }

    const synthesisRate = toEdgeTtsRate(effectiveWpm)
    const cast = narrationCast ?? {
      narratorVoice: settings.shortsformTtsVoice,
      characters: [],
    }
    const assignment = resolveNarrationVoice(readerNarrationChunk.text, cast)
    const voice = assignment.voiceName
    let active = true
    let fallbackStarted = false

    const narrationChunkIndex = findChunkForWord(shortsformChunks, readerNarrationChunk.startWordIndex)
    const targetDuration = narrationDelays[narrationChunkIndex]
      ?? getChunkDelay(readerNarrationChunk, effectiveWpm, settings.clarityPauses, pauseDurations)
    const nextChunk = shortsformChunks[narrationChunkIndex + 1]
    if (nextChunk) {
      const nextVoice = resolveNarrationVoice(nextChunk.text, cast).voiceName
      void getShortsformTtsAudio(nextChunk, synthesisRate, nextVoice).catch(() => undefined)
    }

    const showNarratedWord = (wordIndex: number) => {
      if (page !== 'focus') return
      readerWordIndexRef.current = wordIndex
      wordFocusHighlightRef.current(wordIndex)
    }

    const finishPassage = () => {
      if (!active) return
      setSessionWordsRead((value) => value + readerNarrationChunk.tokens.length)
      setSessionReadingMs((value) => value + targetDuration)
      setMetrics((value) => ({
        ...value,
        focusedSeconds: value.focusedSeconds + targetDuration / 1000,
      }))
      setStableChunks((value) => value + 1)
      if (!nextChunk) {
        setReaderNarrationStatus('Narration complete')
        setPlaying(false)
        setOverlay('complete')
        return
      }
      setReaderNarrationStatus('Preparing the next phrase…')
      setChunkIndex(page === 'focus'
        ? findChunkForWord(focusChunks, nextChunk.startWordIndex)
        : narrationChunkIndex + 1)
      void persistPositionRef.current(page === 'focus'
        ? findChunkForWord(focusChunks, nextChunk.startWordIndex)
        : narrationChunkIndex + 1)
    }

    const startBrowserNarration = () => {
      if (!active || fallbackStarted || !('speechSynthesis' in window)) return false
      fallbackStarted = true
      const utterance = new SpeechSynthesisUtterance(readerNarrationChunk.text)
      fallbackUtterance = utterance
      utterance.rate = Math.min(2, Math.max(0.5, effectiveWpm / 240 * settings.shortsformTtsRate))
      utterance.pitch = settings.shortsformTtsPitch
      utterance.lang = voice.slice(0, 5)
      utterance.onstart = () => setReaderNarrationStatus(`Narrating ${assignment.character} with browser voice`)
      utterance.onboundary = (event) => {
        if (event.name && event.name !== 'word') return
        let cursor = 0
        const tokenOffset = readerNarrationChunk.tokens.findIndex((token) => {
          const tokenStart = readerNarrationChunk.text.indexOf(token.text, cursor)
          cursor = tokenStart < 0 ? cursor : tokenStart + token.text.length
          return tokenStart >= 0 && event.charIndex < cursor
        })
        if (tokenOffset >= 0) {
          showNarratedWord(readerNarrationChunk.startWordIndex + tokenOffset)
        }
      }
      utterance.onend = finishPassage
      utterance.onerror = () => {
        setReaderNarrationStatus('Narration could not start')
        setError('Narration could not start. Check browser audio permissions.')
        setPlaying(false)
      }
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
      return true
    }

    setReaderNarrationStatus(`Preparing ${assignment.character}…`)
    void getShortsformTtsAudio(readerNarrationChunk, synthesisRate, voice)
      .then(async ({ blob, timings }) => {
        if (!active) return
        const objectUrl = URL.createObjectURL(blob)
        readerNarrationAudioUrlRef.current = objectUrl
        speech.onloadedmetadata = () => {
          const rawDurationMs = Number.isFinite(speech.duration) ? speech.duration * 1000 : 0
          speech.playbackRate = getShortsformAudioPlaybackRate(
            rawDurationMs,
            targetDuration,
            settings.shortsformTtsRate,
          )
        }
        speech.onplay = () => setReaderNarrationStatus(`Narrating ${assignment.character} with ${voice}`)
        speech.ontimeupdate = () => {
          const timingIndex = getTtsTimingIndex(timings, speech.currentTime * 1000)
          const timing = timings[timingIndex]
          if (timing) showNarratedWord(readerNarrationChunk.startWordIndex + timing.tokenOffset)
        }
        speech.onended = finishPassage
        speech.onerror = () => {
          stopSpeech()
          if (!startBrowserNarration()) {
            setReaderNarrationStatus('Narration audio could not be played')
            setError('Narration audio could not be played.')
            setPlaying(false)
          }
        }
        speech.src = objectUrl
        speech.load()
        await speech.play()
      })
      .catch((reason) => {
        if (!active) return
        if (!startBrowserNarration()) {
          const message = reason instanceof Error ? reason.message : 'Narration failed.'
          setReaderNarrationStatus(message)
          setError(message)
          setPlaying(false)
        }
      })

    return () => {
      active = false
      stopSpeech()
    }
  }, [
    effectiveWpm,
    getShortsformTtsAudio,
    narrationCast,
    narrationMode,
    narrationDelays,
    page,
    playing,
    readerNarrationChunk,
    focusChunks,
    shortsformChunks,
    settings.clarityPauses,
    settings.audioMode,
    settings.audioVolume,
    pauseDurations,
    settings.shortsformTtsPitch,
    settings.shortsformTtsRate,
    settings.shortsformTtsVoice,
  ])

  useEffect(() => {
    if (!playing || !narrationMode || (page !== 'reader' && page !== 'focus')) return
    const ambientAudio = audio.current
    void ambientAudio.start(settings.audioMode, settings.audioVolume, effectiveWpm)
    return () => ambientAudio.stop()
  }, [
    effectiveWpm,
    narrationMode,
    page,
    playing,
    settings.audioMode,
    settings.audioVolume,
  ])

  useEffect(() => {
    if (
      !playing
      || narrationMode
      || settings.audioMode !== 'soft-drums'
      || !currentChunk
      || (page !== 'reader' && page !== 'focus')
    ) return
    let pulses = 0
    const pulse = () => {
      if (pulses >= currentChunk.tokens.length) return
      pulses += 1
      void audio.current.pulseWord(settings.audioVolume)
    }
    pulse()
    const timer = window.setInterval(pulse, 60_000 / Math.max(effectiveWpm, 50))
    return () => clearInterval(timer)
  }, [
    currentChunk,
    effectiveWpm,
    narrationMode,
    page,
    playing,
    settings.audioMode,
    settings.audioVolume,
  ])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSemanticOpen(true)
      } else if (matchesHotkey(event, settings.hotkeys.playPause)) {
        event.preventDefault()
        togglePlayback()
      } else if (matchesHotkey(event, settings.hotkeys.focusMode)) {
        event.preventDefault()
        setFocusMode((value) => !value)
      } else if (matchesHotkey(event, settings.hotkeys.narration)) {
        event.preventDefault()
        toggleNarration()
      } else if (event.code === 'KeyB') { event.preventDefault(); pauseForContext('break') }
      else if (event.code === 'KeyR') { event.preventDefault(); restart() }
      else if (event.code === 'KeyO') { event.preventDefault(); setImportOpen(true) }
      else if (matchesHotkey(event, settings.hotkeys.settings)) { event.preventDefault(); setSettingsOpen((value) => !value) }
      else if (matchesHotkey(event, settings.hotkeys.textView)) { event.preventDefault(); setTextOpen((value) => !value) }
      else if (event.code === 'KeyN') { event.preventDefault(); setNotesOpen((value) => !value) }
      else if (event.code === 'Slash' && event.shiftKey) { event.preventDefault(); setShortcutsOpen((value) => !value) }
      else if (event.code === 'KeyG') { event.preventDefault(); setPage('guide') }
      else if (event.code === 'KeyP') { event.preventDefault(); setSprintSeconds((settings.sprintMinutes || 5) * 60) }
      else if (matchesHotkey(event, settings.hotkeys.previous)) { event.preventDefault(); smartRewind() }
      else if (matchesHotkey(event, settings.hotkeys.next)) { event.preventDefault(); setChunkIndex((value) => Math.min(value + 1, chunks.length - 1)) }
      else if (event.code === 'KeyM') { event.preventDefault(); handleComprehension(true) }
      else if (event.code === 'KeyL') { event.preventDefault(); losingFocus() }
      else if (event.code === 'KeyK') { event.preventDefault(); lockedIn() }
      else if (event.code === 'Digit1' || event.code === 'KeyI') { event.preventDefault(); addReaction('important') }
      else if (event.code === 'Digit2') { event.preventDefault(); addReaction('confused') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function restart() {
    setPlaying(false)
    setSessionWordsRead(0)
    setSessionReadingMs(0)
    setChunkIndex(0)
    setMetrics(EMPTY_METRICS)
    setAdaptiveOffset(0)
    setStableChunks(0)
    setOverlay('none')
  }

  function losingFocus() {
    setMetrics((value) => ({ ...value, lostFocus: value.lostFocus + 1 }))
    pauseForContext('drift')
  }

  function lockedIn() {
    setQuietUntil(safeChunkIndex + 24)
    setAdaptiveOffset((value) => Math.min(value + 20, settings.profile.preferredWpmMax - settings.wpm))
    setOverlay('none')
    setPlaying(true)
  }

  function applyMode(mode: ReaderSettings['mode']) {
    const currentWord = currentChunk?.startWordIndex ?? 0
    const nextSettings = { ...settings, ...modePresets[mode], mode }
    setSettings(nextSettings)
    if (document) setChunkIndex(findChunkForWord(buildChunks(document, nextSettings.chunkSize, mode), currentWord))
  }

  async function completeImport(importer: () => Promise<ParsedDocument>) {
    setImporting(true)
    setError('')
    try {
      let parsed = await importer()
      if (settings.aiSymbolGrouping) {
        try {
          const hints = await analyzeSymbolGrouping(parsed.text.slice(0, 5000), parsed.title)
          parsed = await regroupDocument(parsed, hints)
        } catch {
          // Deterministic punctuation grouping remains active.
        }
      }
      if (settings.clarityPauses && settings.aiContext) {
        try {
          const result = await classifyComplexity(parsed.text.slice(0, 7000))
          parsed = applyDifficultWords(parsed, result.difficultWords)
        } catch {
          // Length, numeric, acronym, and symbol heuristics remain active.
        }
      }
      await putDocument(parsed)
      setDocument(parsed)
      setChunkIndex(0)
      setMetrics(EMPTY_METRICS)
      setSessionWordsRead(0)
      setSessionReadingMs(0)
      setReactions([])
      setOverlay('none')
      await saveQueueItem({
        documentId: parsed.id,
        title: parsed.title,
        format: parsed.format,
        currentWordIndex: 0,
        mode: settings.mode,
        savedAt: Date.now(),
      })
      setQueue(await getQueue())
      setImportOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Document import failed.')
    } finally {
      setImporting(false)
    }
  }

  function handleBackgroundUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl)
    const url = URL.createObjectURL(file)
    setBackgroundObjectUrl(url)
    setSettings((value) => ({
      ...value,
      backgroundMediaUrl: url,
      backgroundMediaType: file.type.startsWith('video/') ? 'video' : 'image',
    }))
  }

  function applyBackgroundUrl(url: string) {
    const youtube = toYoutubeEmbed(url)
    setSettings((value) => ({
      ...value,
      backgroundMediaUrl: youtube ?? url,
      backgroundMediaType: youtube ? 'youtube' : /\.(mp4|webm|ogg|mov|m4v)(?:$|\?)/i.test(url) ? 'video' : url ? 'image' : 'none',
    }))
  }

  async function runSemanticSearch() {
    if (!document || !semanticQuery.trim()) return
    setSemanticStatus('Preparing local document index…')
    setSemanticAnswer(null)
    indexAbort.current?.abort()
    indexAbort.current = new AbortController()
    try {
      const index = await ensureSemanticIndex(
        document,
        (done, total) => setIndexProgress({ done, total }),
        indexAbort.current.signal,
      )
      setSemanticStatus('Searching locally…')
      const results = await semanticSearch(semanticQuery, index)
      setSemanticResults(results)
      setSemanticStatus(results.length ? `${results.length} source-grounded results` : 'No supported passage found')
      if (settings.semanticAiRerank && results.length) {
        try {
          const answer = await answerSemanticQuestion(semanticQuery, results)
          const order = answer.rankedResultNumbers ?? []
          const reranked = order
            .map((resultNumber) => results[resultNumber - 1])
            .filter((result): result is SemanticSearchResult => Boolean(result))
          setSemanticResults(reranked.length === results.length ? reranked : results)
          setSemanticAnswer(answer)
        } catch {
          setSemanticStatus(`${results.length} local results; AI answer unavailable`)
        }
      }
    } catch (reason) {
      setSemanticStatus(reason instanceof Error ? reason.message : 'Semantic search failed.')
    } finally {
      setIndexProgress(null)
    }
  }

  function jumpToWord(wordIndex: number, openText = false) {
    setChunkIndex(findChunkForWord(chunks, wordIndex))
    setSemanticOpen(false)
    setTextOpen(openText)
    setPage('reader')
  }

  async function removeCurrentDocument() {
    if (!document) return
    await deleteDocumentData(document.id, document.hash)
    setDocument(null)
    setChunkIndex(0)
    setQueue(await getQueue())
    setOverlay('none')
  }

  const themeStyle = getThemeStyle(settings)
  const readerStyle = {
    ...themeStyle,
    '--reader-font': settings.fontFamily,
    '--reader-size': `${settings.fontSize}px`,
    '--reader-weight': settings.fontWeight,
    '--word-focus-scale': settings.wordFocusTextScale / 100,
    '--word-focus-line-height': settings.wordFocusLineSpacing / 100,
    '--focus-strength': settings.focusWindowStrength / 100,
  } as CSSProperties

  return (
    <div
      className={[
        'app-shell',
        `theme-${settings.theme}`,
        `contrast-${settings.contrast}`,
        settings.motionSmoothing ? 'motion-smooth' : '',
        settings.eyeAnchor ? `eye-anchor eye-anchor-${settings.eyeAnchorStyle}` : '',
        settings.focusWindow ? `focus-window focus-${settings.focusWindowWidth}` : '',
        focusMode ? 'manual-focus-mode' : '',
        narrationMode ? 'narration-mode' : '',
        document && !focusUiVisible && !focusMode ? 'focus-ui-hidden' : '',
      ].filter(Boolean).join(' ')}
      style={readerStyle}
    >
      <header className="topbar">
        <button className="wordmark" onClick={() => navigateToPage('reader')} type="button">Celere</button>
        <nav aria-label="Pages">
          <button className={page === 'reader' ? 'active' : ''} onClick={() => navigateToPage('reader')} type="button">Reader</button>
          <button className={page === 'focus' ? 'active' : ''} onClick={() => navigateToPage('focus')} type="button">Word Focus</button>
          <button className={page === 'shortsform' ? 'active' : ''} onClick={() => navigateToPage('shortsform')} type="button">Shortsform</button>
          <button className={page === 'guide' ? 'active' : ''} onClick={() => navigateToPage('guide')} type="button">Guide</button>
        </nav>
        <div className="topbar-meta">
          {authControls ? <div className="topbar-auth">{authControls}</div> : null}
          <button aria-label="Import (O)" className="topbar-import" onClick={() => setImportOpen(true)} title="Import (O)" type="button">
            <FileUp size={16} />
          </button>
          <button aria-label="Semantic search" className="topbar-search" onClick={() => setSemanticOpen(true)} title="Semantic search (Ctrl/Cmd+K)" type="button"><Search size={17} /></button>
        </div>
      </header>

      {page === 'reader' ? (
        <main className="reader-page">
          <Background settings={settings} mediaRef={mediaRef} youtubeRef={youtubeRef} />
          <div className="media-scrim" style={{ opacity: settings.backgroundDim / 100 }} />
          <section className={`reader-stage tone-${currentTone.key}`}>
            {document && settings.eyeAnchor ? (
              <div className="eye-anchor-overlay" aria-hidden="true">
                <span className="anchor-line anchor-horizontal" />
                {settings.eyeAnchorStyle === 'grid' ? (
                  <>
                    <span className="anchor-line anchor-vertical" />
                    <span className="anchor-line anchor-third anchor-third-left" />
                    <span className="anchor-line anchor-third anchor-third-right" />
                    <span className="anchor-line anchor-third anchor-third-top" />
                    <span className="anchor-line anchor-third anchor-third-bottom" />
                  </>
                ) : null}
              </div>
            ) : null}
            <div className={`reader-header ${titleVisible ? '' : 'hidden'}`}>
              <div>
                <strong>{document?.title ?? 'Celere'}</strong>
                <span>{document ? `${minutesLeft} min left · ${currentSection?.title ?? 'Section 1'}` : 'Upload a document to begin'}</span>
              </div>
              <div className="reader-status">
                <span>{attention}</span>
                {settings.toneIndicators ? <span>{currentTone.label}</span> : null}
                {narrationMode ? <span>{readerNarrationStatus}</span> : null}
                {sprintSeconds > 0 ? <span>{formatTime(sprintSeconds)}</span> : null}
                <span>{effectiveWpm} WPM</span>
                {measuredWpm > 0 ? <span>{measuredWpm} actual</span> : null}
                {settings.dopamineFeedback ? <span>{streak.count} day streak</span> : null}
              </div>
            </div>

            {settings.dopamineFeedback && focusNudge ? (
              <div className="focus-nudge" role="status">{focusNudge}</div>
            ) : null}

            {settings.contextLadder && currentChunk ? (
              <div className="context-ladder" aria-label="Reading context">
                <span>Just read <strong>{contextLadder.previous}</strong></span>
                <span>Now <strong>{contextLadder.current}</strong></span>
                <span>Next <strong>{contextLadder.next}</strong></span>
              </div>
            ) : null}

            {!document ? (
              <div className="empty-state">
                <h1>Read one clear phrase at a time.</h1>
                <p>Import a document, choose an intent, and adjust every attention aid independently.</p>
                <ModeSelector mode={settings.mode} onChange={applyMode} />
                <button className="primary-button" onClick={() => setImportOpen(true)} type="button">
                  <FileUp size={17} />
                  {importing ? 'Importing…' : 'Add reading'}
                </button>
                {error ? <p className="error"><AlertCircle size={16} />{error}</p> : null}
                {settings.resurfaceQueue && queue.length > 0 ? (
                  <div className="resurface">
                    <span>Continue a saved document</span>
                    {queue.slice(0, 3).map((item) => (
                      <button key={item.documentId} onClick={() => void restoreQueueItem(item)} type="button">{item.title}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="word-display"
                onPointerDown={(event) => {
                  const target = event.currentTarget
                  target.dataset.holdTimer = String(window.setTimeout(() => pauseForContext('hold'), 500))
                }}
                onPointerUp={(event) => clearTimeout(Number(event.currentTarget.dataset.holdTimer))}
                onPointerLeave={(event) => clearTimeout(Number(event.currentTarget.dataset.holdTimer))}
              >
                <ChunkView
                  chunk={currentChunk}
                  narrationActive={narrationMode}
                  showFocusPoint={settings.showFocusPoint && !narrationMode}
                  showRoles={settings.showRoleHighlights}
                />
              </div>
            )}

            <ReaderOverlay
              overlay={overlay}
              seconds={overlaySeconds}
              text={overlayText}
              quiz={quiz}
              quizEnabled={settings.aiMicroQuizzes}
              quizChoice={quizChoice}
              onQuizChoice={(index) => {
                setQuizChoice(index)
                window.setTimeout(() => handleComprehension(index === quiz?.answerIndex), 700)
              }}
              onResume={() => { setOverlay('none'); setPlaying(true) }}
              onRewind={smartRewind}
              onLockedIn={lockedIn}
              onUnderstood={() => handleComprehension(true)}
              onLost={() => handleComprehension(false)}
              onDisableChecks={() => { updateSetting('quickSenseChecks', false); setOverlay('none'); setPlaying(true) }}
              onQuiz={() => {
                if (!overlayText || !document) return
                void createQuiz(overlayText, settings.mode, document.title)
                  .then(setQuiz)
                  .catch(() => setQuiz(null))
              }}
              onRestart={restart}
              onReview={() => { setOverlay('none'); setNotesOpen(true) }}
              onSprint={() => { setOverlay('none'); setSprintSeconds(300); setPlaying(true) }}
              onContinueSprint={() => {
                const seconds = (settings.sprintMinutes || 5) * 60
                setSprintSeconds(seconds)
                setOverlay('none')
                setPlaying(true)
              }}
              onTakeBreak={() => pauseForContext('break')}
            />
          </section>

          <Progress
            progress={progress}
            document={document}
            showMilestones={settings.showMilestones}
            onJump={(wordIndex) => jumpToWord(wordIndex)}
          />

          <Dock
            playing={playing}
            settingsOpen={settingsOpen}
            focusMode={focusMode}
            narrationMode={narrationMode}
            onRestart={restart}
            onRewind={smartRewind}
            onToggle={togglePlayback}
            onNext={() => setChunkIndex((value) => Math.min(value + 1, chunks.length - 1))}
            onBreak={() => pauseForContext('break')}
            onSprint={() => setSprintSeconds((settings.sprintMinutes || 5) * 60)}
            onText={() => setTextOpen(true)}
            onNotes={() => setNotesOpen(true)}
            onUnderstood={() => handleComprehension(true)}
            onLosingFocus={losingFocus}
            onLockedIn={lockedIn}
            onImportant={() => addReaction('important')}
            onConfused={() => addReaction('confused')}
            onSettings={() => setSettingsOpen((value) => !value)}
            onFocusMode={() => setFocusMode((value) => !value)}
            onNarration={toggleNarration}
          />

          {settingsOpen ? (
            <SettingsPanel
              settings={settings}
              voices={shortsformVoices}
              narrationStatus={readerNarrationStatus}
              narrationCast={narrationCast}
              runtimeStatus={runtimeStatus}
              lastVoiceCommand={lastVoiceCommand}
              onChange={updateSetting}
              onMode={applyMode}
              onPreset={(preset) => setSettings((value) => ({ ...value, ...sensoryPresets[preset], sensoryPreset: preset }))}
              onUploadBackground={handleBackgroundUpload}
              onBackgroundUrl={applyBackgroundUrl}
              onRemoveBackground={() => setSettings((value) => ({ ...value, backgroundMediaType: 'none', backgroundMediaUrl: '' }))}
              onRecalibrate={() => setCalibrationOpen(true)}
              onRemoveDocument={() => void removeCurrentDocument()}
            />
          ) : null}
        </main>
      ) : page === 'focus' ? (
        <main className={`reader-page word-focus-page${playing ? ' playing' : ''}`}>
          <Background settings={settings} mediaRef={mediaRef} youtubeRef={youtubeRef} />
          <div className="media-scrim" style={{ opacity: settings.backgroundDim / 100 }} />
          <WordFocusDocument
            activeWordStart={currentChunk?.startWordIndex ?? 0}
            document={document}
            importing={importing}
            onHighlightReady={registerWordFocusHighlighter}
            onOpenImport={() => setImportOpen(true)}
            onJump={jumpToFocusWord}
            settings={settings}
          />

          <ReaderOverlay
            overlay={overlay}
            seconds={overlaySeconds}
            text={overlayText}
            quiz={quiz}
            quizEnabled={settings.aiMicroQuizzes}
            quizChoice={quizChoice}
            onQuizChoice={(index) => {
              setQuizChoice(index)
              window.setTimeout(() => handleComprehension(index === quiz?.answerIndex), 700)
            }}
            onResume={() => { setOverlay('none'); setPlaying(true) }}
            onRewind={smartRewind}
            onLockedIn={lockedIn}
            onUnderstood={() => handleComprehension(true)}
            onLost={() => handleComprehension(false)}
            onDisableChecks={() => { updateSetting('quickSenseChecks', false); setOverlay('none'); setPlaying(true) }}
            onQuiz={() => {
              if (!overlayText || !document) return
              void createQuiz(overlayText, settings.mode, document.title)
                .then(setQuiz)
                .catch(() => setQuiz(null))
            }}
            onRestart={restart}
            onReview={() => { setOverlay('none'); setNotesOpen(true) }}
            onSprint={() => { setOverlay('none'); setSprintSeconds(300); setPlaying(true) }}
            onContinueSprint={() => {
              const seconds = (settings.sprintMinutes || 5) * 60
              setSprintSeconds(seconds)
              setOverlay('none')
              setPlaying(true)
            }}
            onTakeBreak={() => pauseForContext('break')}
          />

          <Progress
            progress={progress}
            document={document}
            showMilestones={settings.showMilestones}
            onJump={jumpToFocusWord}
          />

          <Dock
            label="Word Focus controls"
            playing={playing}
            settingsOpen={settingsOpen}
            focusMode={focusMode}
            narrationMode={narrationMode}
            onRestart={restart}
            onRewind={smartRewind}
            onToggle={togglePlayback}
            onNext={() => setChunkIndex((value) => Math.min(value + 1, chunks.length - 1))}
            onBreak={() => pauseForContext('break')}
            onSprint={() => setSprintSeconds((settings.sprintMinutes || 5) * 60)}
            onText={() => setTextOpen(true)}
            onNotes={() => setNotesOpen(true)}
            onUnderstood={() => handleComprehension(true)}
            onLosingFocus={losingFocus}
            onLockedIn={lockedIn}
            onImportant={() => addReaction('important')}
            onConfused={() => addReaction('confused')}
            onSettings={() => setSettingsOpen((value) => !value)}
            onFocusMode={() => setFocusMode((value) => !value)}
            onNarration={toggleNarration}
          />

          {settingsOpen ? (
            <SettingsPanel
              settings={settings}
              voices={shortsformVoices}
              narrationStatus={readerNarrationStatus}
              narrationCast={narrationCast}
              runtimeStatus={runtimeStatus}
              lastVoiceCommand={lastVoiceCommand}
              onChange={updateSetting}
              onMode={applyMode}
              onPreset={(preset) => setSettings((value) => ({ ...value, ...sensoryPresets[preset], sensoryPreset: preset }))}
              onUploadBackground={handleBackgroundUpload}
              onBackgroundUrl={applyBackgroundUrl}
              onRemoveBackground={() => setSettings((value) => ({ ...value, backgroundMediaType: 'none', backgroundMediaUrl: '' }))}
              onRecalibrate={() => setCalibrationOpen(true)}
              onRemoveDocument={() => void removeCurrentDocument()}
            />
          ) : null}
        </main>
      ) : page === 'shortsform' ? (
        <ShortsformPage
          currentChunk={currentChunk}
          document={document}
          error={error}
          importing={importing}
          onBreak={() => pauseForContext('break')}
          onChange={updateSetting}
          onOpenImport={() => setImportOpen(true)}
          onPlayPause={togglePlayback}
          onReader={() => navigateToPage('reader')}
          onToggleSettings={() => setSettingsOpen((value) => !value)}
          playing={playing}
          progress={progress}
          settings={settings}
          settingsOpen={settingsOpen}
          ttsStatus={shortsformTtsStatus}
          voices={shortsformVoices}
          activeWordIndex={shortsformActiveWordIndex}
          wordIndex={shortsformWordIndex}
        />
      ) : (
        <GuidePage queryStatus={semanticStatus} runtimeStatus={runtimeStatus} settings={settings} />
      )}

      <ImportDialog
        error={error}
        importing={importing}
        onClose={() => setImportOpen(false)}
        onFile={(file) => completeImport(() => importDocument(file))}
        onText={(text, title, format) => completeImport(() => importText(text, title, format))}
        onWebsite={(url) => completeImport(() => importWebsite(url))}
        open={importOpen}
      />

      <SemanticSearchModal
        open={semanticOpen}
        query={semanticQuery}
        results={semanticResults}
        answer={semanticAnswer}
        status={semanticStatus}
        progress={indexProgress}
        onQuery={setSemanticQuery}
        onSearch={() => void runSemanticSearch()}
        onCancel={() => indexAbort.current?.abort()}
        onClose={() => setSemanticOpen(false)}
        onJump={(wordIndex, textView) => jumpToWord(wordIndex, textView)}
      />

      <TextViewer
        open={textOpen}
        document={document}
        currentWord={currentChunk?.startWordIndex ?? 0}
        query={exactQuery}
        matches={exactMatches}
        cursor={exactCursor}
        reactions={reactions}
        onQuery={(value) => { setExactQuery(value); setExactCursor(0) }}
        onCursor={setExactCursor}
        onJump={jumpToWord}
        onClose={() => setTextOpen(false)}
      />

      <Modal open={notesOpen} title="Session notes" onClose={() => setNotesOpen(false)}>
        <div className="metric-line">
          <span>{Math.max(0, Math.round(metrics.focusedSeconds / 60))} min focused</span>
          <span>{metrics.breaks} breaks</span>
          <span>{metrics.recoveries} recoveries</span>
          <span>{metrics.understood} understood</span>
        </div>
        <div className="notes-list">
          {reactions.length ? reactions.map((reaction) => (
            <button key={reaction.id} onClick={() => jumpToWord(chunks[reaction.chunkIndex]?.startWordIndex ?? 0, true)} type="button">
              <strong>{reaction.kind}</strong>
              <span>{reaction.preview}</span>
            </button>
          )) : <p>No notes yet. Use `1` for important and `2` for confused.</p>}
        </div>
      </Modal>

      <Modal open={shortcutsOpen} title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)}>
        <div className="shortcut-grid">
          {getShortcutRows(settings).map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}
        </div>
      </Modal>

      <Calibration
        open={calibrationOpen}
        settings={settings}
        onApply={(wpm, chunkSize, breakSeconds) => {
          setSettings((value) => ({
            ...value,
            calibrationComplete: true,
            wpm,
            chunkSize,
            microBreakDuration: breakSeconds,
            profile: {
              comfortableWpm: wpm,
              preferredChunkSize: chunkSize,
              breakToleranceSeconds: breakSeconds,
              preferredWpmMin: Math.max(120, wpm - 50),
              preferredWpmMax: wpm + 60,
            },
          }))
          setCalibrationOpen(false)
        }}
        onSkip={() => {
          updateSetting('calibrationComplete', true)
          setCalibrationOpen(false)
        }}
      />

      <div className="camera-probe" hidden={!settings.eyeTracking || !settingsOpen}>
        <video ref={cameraRef} muted playsInline />
        <span>{runtimeStatus.eye}</span>
      </div>
    </div>
  )

  async function restoreQueueItem(item: QueueItem) {
    const saved = await getDocument(item.documentId)
    if (!saved) return
    setDocument(saved)
    const restoredChunks = buildChunks(saved, settings.chunkSize, settings.mode)
    setChunkIndex(findChunkForWord(restoredChunks, item.currentWordIndex))
    setOverlayText(`${saved.title} · resume from the saved position or return to the beginning.`)
    setOverlay('restart')
  }
}

type ImportSource = 'file' | 'website' | 'paste' | 'kindle' | 'libby'

function ImportDialog(props: {
  error: string
  importing: boolean
  onClose: () => void
  onFile: (file: File) => Promise<void>
  onText: (text: string, title: string, format: 'text' | 'markdown') => Promise<void>
  onWebsite: (url: string) => Promise<void>
  open: boolean
}) {
  const [source, setSource] = useState<ImportSource>('file')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [textFormat, setTextFormat] = useState<'text' | 'markdown'>('text')

  useEffect(() => {
    if (!props.open) return
    setSource('file')
    setUrl('')
    setTitle('')
    setText('')
    setTextFormat('text')
  }, [props.open])

  if (!props.open) return null

  const sourceLabels: Array<[ImportSource, string, ReactNode]> = [
    ['file', 'File', <FileUp />],
    ['website', 'Website URL', <Globe2 />],
    ['paste', 'Paste text', <ClipboardPaste />],
    ['kindle', 'Kindle Cloud Reader', <BookOpen />],
    ['libby', 'Libby', <Library />],
  ]
  const guidedSource = source === 'kindle' || source === 'libby'
  const pasteTitle = source === 'kindle'
    ? 'Kindle excerpt'
    : source === 'libby'
      ? 'Libby excerpt'
      : 'Pasted text'

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await props.onFile(file)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !props.importing) props.onClose()
    }}>
      <section aria-label="Import reading" aria-modal="true" className="modal import-dialog" role="dialog">
        <header>
          <div>
            <h2>Import reading</h2>
            <p>Choose a file, public webpage, or text source.</p>
          </div>
          <button aria-label="Close import" disabled={props.importing} onClick={props.onClose} type="button"><X /></button>
        </header>

        <div className="import-layout">
          <nav aria-label="Import sources" className="import-sources">
            {sourceLabels.map(([value, label, icon]) => (
              <button
                className={source === value ? 'active' : ''}
                key={value}
                onClick={() => setSource(value)}
                type="button"
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="import-panel">
            {source === 'file' ? (
              <>
                <h3>Upload a document</h3>
                <p>Files are processed locally by Celere and saved in this browser.</p>
                <div className="import-file-grid">
                  <label>
                    <strong>PDF</strong>
                    <span>Text-based PDF documents</span>
                    <input accept=".pdf,application/pdf" disabled={props.importing} hidden onChange={chooseFile} type="file" />
                  </label>
                  <label>
                    <strong>EPUB</strong>
                    <span>DRM-free ebooks and exports</span>
                    <input accept=".epub,application/epub+zip" disabled={props.importing} hidden onChange={chooseFile} type="file" />
                  </label>
                  <label>
                    <strong>Markdown or text</strong>
                    <span>MD, Markdown, and TXT</span>
                    <input accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={props.importing} hidden onChange={chooseFile} type="file" />
                  </label>
                  <label>
                    <strong>Word or HTML</strong>
                    <span>DOC, DOCX, HTML, and HTM</span>
                    <input accept=".doc,.docx,.html,.htm" disabled={props.importing} hidden onChange={chooseFile} type="file" />
                  </label>
                </div>
              </>
            ) : source === 'website' ? (
              <>
                <h3>Import a public webpage</h3>
                <p>Celere extracts readable text from public articles and supported document links.</p>
                <label className="import-field">
                  <span>Website URL</span>
                  <input
                    aria-label="Website URL"
                    autoFocus
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/article"
                    type="url"
                    value={url}
                  />
                </label>
                <button disabled={props.importing || !url.trim()} onClick={() => void props.onWebsite(url.trim())} type="button">
                  {props.importing ? 'Importing…' : 'Import website'}
                </button>
              </>
            ) : (
              <>
                <h3>{guidedSource ? `Import from ${source === 'kindle' ? 'Kindle Cloud Reader' : 'Libby'}` : 'Paste text or Markdown'}</h3>
                {source === 'kindle' ? (
                  <p>Copy text you are permitted to use from Kindle Cloud Reader and paste it below. Celere cannot bypass Kindle DRM or sign in to your Amazon account.</p>
                ) : source === 'libby' ? (
                  <p>Paste an excerpt or notes from Libby, or upload a DRM-free PDF or EPUB you are permitted to use. Celere cannot access your library account or protected loans directly.</p>
                ) : (
                  <p>Paste plain text or Markdown. Markdown headings become navigable document sections.</p>
                )}
                <label className="import-field">
                  <span>Title</span>
                  <input aria-label="Title" onChange={(event) => setTitle(event.target.value)} placeholder={pasteTitle} value={title} />
                </label>
                <label className="import-field">
                  <span>Format</span>
                  <select aria-label="Format" onChange={(event) => setTextFormat(event.target.value as 'text' | 'markdown')} value={textFormat}>
                    <option value="text">Plain text</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </label>
                <label className="import-field">
                  <span>Text</span>
                  <textarea
                    aria-label="Text"
                    autoFocus
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Paste readable text here"
                    rows={10}
                    value={text}
                  />
                </label>
                <div className="import-actions">
                  {guidedSource ? (
                    <label className="secondary-button">
                      Upload PDF or EPUB
                      <input accept=".pdf,.epub,application/pdf,application/epub+zip" disabled={props.importing} hidden onChange={chooseFile} type="file" />
                    </label>
                  ) : null}
                  <button
                    disabled={props.importing || !text.trim()}
                    onClick={() => void props.onText(text, title || pasteTitle, textFormat)}
                    type="button"
                  >
                    {props.importing ? 'Importing…' : 'Import text'}
                  </button>
                </div>
              </>
            )}
            {props.error ? <p className="error"><AlertCircle size={16} />{props.error}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}

function ShortsformPage(props: {
  activeWordIndex: number | null
  currentChunk: ReadingChunk | null
  document: ParsedDocument | null
  error: string
  importing: boolean
  onBreak: () => void
  onChange: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void
  onOpenImport: () => void
  onPlayPause: () => void
  onReader: () => void
  onToggleSettings: () => void
  playing: boolean
  progress: number
  settings: ReaderSettings
  settingsOpen: boolean
  ttsStatus: string
  voices: ShortsformVoice[]
  wordIndex: number
}) {
  const [bookRights, setBookRights] = useState(false)
  const [footageRights, setFootageRights] = useState(false)
  const [footageUrl, setFootageUrl] = useState('')
  const [footage, setFootage] = useState<ShortsformFootage | null>(null)
  const [status, setStatus] = useState('Add authorized footage in Settings.')
  const [preparingFootage, setPreparingFootage] = useState(false)
  const footageAbortRef = useRef<AbortController | null>(null)

  useEffect(() => setBookRights(false), [props.document?.id])
  useEffect(() => () => footageAbortRef.current?.abort(), [])

  function previewYoutubeFootage() {
    if (!footageRights || !footageUrl.trim()) return
    const previewUrl = toYoutubeEmbed(footageUrl.trim())
    if (!previewUrl) {
      setStatus('Enter a valid YouTube or youtu.be URL.')
      return
    }
    setFootage({
      assetId: '',
      kind: 'youtube',
      previewUrl,
      title: 'YouTube preview',
    })
    setStatus('YouTube preview ready. Cache a compact copy only if you need local reuse or export.')
  }

  async function cacheYoutubeFootage() {
    if (!footageRights || !footageUrl.trim()) return
    const controller = new AbortController()
    footageAbortRef.current?.abort()
    footageAbortRef.current = controller
    setPreparingFootage(true)
    setStatus('Caching a compact 360p, 10-minute background clip without audio…')
    try {
      const response = await fetch(apiUrl('/api/shortsform/footage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ rightsConfirmed: footageRights, url: footageUrl.trim() }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Footage preparation failed.')
      setFootage({ ...body, kind: 'local' })
      setStatus(body.cached ? `Using cached footage: ${body.title}` : `Compact footage ready: ${body.title}`)
    } catch (reason) {
      setStatus(controller.signal.aborted
        ? 'Footage caching cancelled.'
        : reason instanceof Error ? reason.message : 'Footage preparation failed.')
    } finally {
      if (footageAbortRef.current === controller) footageAbortRef.current = null
      setPreparingFootage(false)
    }
  }

  async function uploadFootage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!footageRights) {
      setStatus('Confirm the footage reuse rights before uploading.')
      return
    }
    setPreparingFootage(true)
    setStatus('Uploading authorized footage…')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('rightsConfirmed', 'true')
      const response = await fetch(apiUrl('/api/shortsform/footage/upload'), {
        method: 'POST',
        body: form,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Footage upload failed.')
      setFootage({ ...body, kind: 'local' })
      setStatus(`Footage ready: ${body.title}`)
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : 'Footage upload failed.')
    } finally {
      setPreparingFootage(false)
    }
  }

  const captionWindow = props.document && props.currentChunk
    ? getShortsformCaptionWindow(
        props.document.tokens,
        props.wordIndex,
        props.settings.shortsformCaptionMaxWords,
      )
    : null
  const captionLines = captionWindow
    ? buildShortsformCaptionLines(captionWindow.tokens, {
        maxWords: props.settings.shortsformCaptionMaxWords,
      })
    : []
  const canPlay = Boolean(props.document && bookRights)

  return (
    <main
      className="shortsform-mode"
      style={{
        '--shortsform-dim': props.settings.shortsformBackdropDim / 100,
        '--shortsform-blur': `${props.settings.shortsformFootageBlur}px`,
      } as CSSProperties}
    >
      <div className="shortsform-backdrop">
        {footage?.kind === 'youtube' ? (
          <iframe
            allow="autoplay; encrypted-media"
            className="shortsform-media shortsform-youtube"
            src={footage.previewUrl}
            title="YouTube gameplay preview"
          />
        ) : footage ? (
          <video autoPlay className="shortsform-media" loop muted playsInline src={footage.previewUrl} />
        ) : (
          <div className="shortsform-media-empty">
            <Video />
            <span>Prepare authorized gameplay footage in Settings</span>
          </div>
        )}
      </div>

      <div className="shortsform-ui">
        <div className="shortsform-toolbar">
          <div className="shortsform-toolbar-copy">
            <span>Shortsform mode</span>
            <span>{props.document?.title ?? 'Load a document first'}</span>
            <span>{props.ttsStatus}</span>
          </div>
          <div className="shortsform-toolbar-actions">
            <button className="shortsform-button" onClick={props.onOpenImport} type="button">
              {props.importing ? 'Importing…' : 'Upload file'}
            </button>
            <button className="shortsform-button" onClick={props.onToggleSettings} type="button">
              {props.settingsOpen ? 'Close settings' : 'Settings'}
            </button>
            <button className="shortsform-button" onClick={props.onReader} type="button">Reader</button>
          </div>
        </div>

        <div className={props.settingsOpen ? 'shortsform-layout settings-open' : 'shortsform-layout'}>
          {props.settingsOpen ? (
            <aside className="shortsform-settings">
              <h2><Video size={15} />Source rights</h2>
              <Toggle
                checked={bookRights}
                label="I own this text or have permission to narrate it."
                onChange={setBookRights}
              />
              <label>
                <span>YouTube gameplay URL</span>
                <input
                  onChange={(event) => {
                    setFootageUrl(event.target.value)
                    setFootage(null)
                  }}
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={footageUrl}
                />
              </label>
              <Toggle
                checked={footageRights}
                label="I own this footage or have permission to download and reuse it."
                onChange={setFootageRights}
              />
              <button
                disabled={!footageRights || !footageUrl.trim()}
                onClick={previewYoutubeFootage}
                type="button"
              >
                Use YouTube preview
              </button>
              <button
                disabled={!footageRights || !footageUrl.trim() || preparingFootage}
                onClick={() => void cacheYoutubeFootage()}
                type="button"
              >
                {preparingFootage ? 'Caching compact copy…' : 'Cache compact copy'}
              </button>
              {preparingFootage ? (
                <button onClick={() => footageAbortRef.current?.abort()} type="button">Cancel caching</button>
              ) : null}
              <label className={`shortsform-button shortsform-upload${!footageRights || preparingFootage ? ' disabled' : ''}`}>
                Upload video
                <input
                  accept="video/mp4,video/webm,video/quicktime,video/x-matroska,.m4v"
                  disabled={!footageRights || preparingFootage}
                  hidden
                  onChange={(event) => void uploadFootage(event)}
                  type="file"
                />
              </label>

              <h2><Gauge size={15} />Captions</h2>
              <WpmRuler ariaLabel="Speed" label="Shortsform speed" value={props.settings.shortsformWpm} onChange={(value) => props.onChange('shortsformWpm', value)} />
              <div className="shortsform-control-grid">
                <Range icon={<Focus size={14} />} label={`Subtitle scale · ${props.settings.shortsformSubtitleScale}%`} min={75} max={160} step={5} value={props.settings.shortsformSubtitleScale} onChange={(value) => props.onChange('shortsformSubtitleScale', value)} />
                <Range icon={<BookOpen size={14} />} label={`Line length · ${props.settings.shortsformCaptionMaxWords} words`} min={2} max={8} value={props.settings.shortsformCaptionMaxWords} onChange={(value) => props.onChange('shortsformCaptionMaxWords', value)} />
              </div>
              <Select label="Caption theme" value={props.settings.shortsformSubtitleStyle} options={SHORTSFORM_SUBTITLE_STYLES} onChange={(value) => props.onChange('shortsformSubtitleStyle', value as ShortsformSubtitleStyle)} />
              <Select label="Subtitle case" value={props.settings.shortsformSubtitleCase} options={['uppercase', 'natural']} onChange={(value) => props.onChange('shortsformSubtitleCase', value as ShortsformSubtitleCase)} />
              <Select label="Caption alignment" value={props.settings.shortsformCaptionAlign} options={['center', 'left']} onChange={(value) => props.onChange('shortsformCaptionAlign', value as ShortsformCaptionAlign)} />
              <Select label="Caption position" value={props.settings.shortsformCaptionPosition} options={['top', 'center', 'bottom']} onChange={(value) => props.onChange('shortsformCaptionPosition', value as ShortsformCaptionPosition)} />
              <div className="shortsform-control-grid">
                <Range icon={<Video size={14} />} label={`Backdrop dim · ${props.settings.shortsformBackdropDim}%`} min={20} max={92} step={2} value={props.settings.shortsformBackdropDim} onChange={(value) => props.onChange('shortsformBackdropDim', value)} />
                <Range icon={<Video size={14} />} label={`Footage blur · ${props.settings.shortsformFootageBlur}px`} min={0} max={18} value={props.settings.shortsformFootageBlur} onChange={(value) => props.onChange('shortsformFootageBlur', value)} />
              </div>

              <h2><MessageSquareText size={15} />Narration</h2>
              <Toggle checked={props.settings.shortsformTts} label="Edge TTS narration" onChange={(value) => props.onChange('shortsformTts', value)} />
              <div className="shortsform-control-grid">
                <Range icon={<Gauge size={14} />} label={`TTS rate · ${props.settings.shortsformTtsRate.toFixed(1)}×`} min={0.7} max={1.8} step={0.1} value={props.settings.shortsformTtsRate} onChange={(value) => props.onChange('shortsformTtsRate', value)} />
                <Range icon={<MessageSquareText size={14} />} label={`TTS pitch · ${props.settings.shortsformTtsPitch.toFixed(1)}×`} min={0.6} max={1.6} step={0.1} value={props.settings.shortsformTtsPitch} onChange={(value) => props.onChange('shortsformTtsPitch', value)} />
              </div>
              <label>
                <span>Voice</span>
                <select aria-label="Shortsform voice" value={props.settings.shortsformTtsVoice} onChange={(event) => props.onChange('shortsformTtsVoice', event.target.value)}>
                  {props.voices.map((voice) => <option key={voice.name} value={voice.name}>{voice.display_name}{voice.locale ? ` (${voice.locale})` : ''}</option>)}
                </select>
              </label>
              <p className="shortsform-status">{status}</p>
            </aside>
          ) : null}

          <div className="shortsform-stage">
            {props.document && props.currentChunk ? (
              <div
                className={[
                  'shortsform-captions',
                  `subtitle-style-${props.settings.shortsformSubtitleStyle}`,
                  `subtitle-case-${props.settings.shortsformSubtitleCase}`,
                  `subtitle-align-${props.settings.shortsformCaptionAlign}`,
                  `subtitle-position-${props.settings.shortsformCaptionPosition}`,
                ].join(' ')}
                style={{ '--subtitle-scale': props.settings.shortsformSubtitleScale / 100 } as CSSProperties}
              >
                <div className="shortsform-caption-meta">
                  <span>{props.playing ? 'Live captions' : 'Paused'}</span>
                  <span>
                    {props.settings.shortsformWpm} WPM · {props.settings.shortsformTts
                      ? `${props.settings.shortsformTtsRate.toFixed(1)}× narration`
                      : 'Visual timing'}
                  </span>
                  <span>{Math.round(props.progress * 100)}%</span>
                </div>
                <div aria-live="polite" className="shortsform-caption-lines">
                  {captionLines.map((line, lineIndex) => (
                    <p className="shortsform-caption-line" key={`line-${lineIndex}`}>
                      {line.map((captionToken, tokenIndex) => (
                        <span
                          className={[
                            'word',
                            tokenIndex === 0 ? 'first-word-in-line' : '',
                            tokenIndex === line.length - 1 ? 'last-word-in-line' : '',
                            captionToken.source.wordIndex < props.wordIndex
                              ? 'word-already-narrated'
                              : captionToken.source.wordIndex === props.activeWordIndex
                                ? 'word-being-narrated'
                                : 'word-not-narrated-yet',
                          ].filter(Boolean).join(' ')}
                          key={captionToken.id}
                        >
                          {props.settings.shortsformSubtitleCase === 'uppercase' ? captionToken.text.toUpperCase() : captionToken.text}
                        </span>
                      ))}
                    </p>
                  ))}
                </div>
              </div>
            ) : (
              <div className="shortsform-empty">Upload a book to start Shortsform mode.</div>
            )}
          </div>
        </div>

        {props.error ? <div className="shortsform-error">{props.error}</div> : null}

        <div className="shortsform-footer">
          <button
            disabled={!canPlay}
            onClick={() => {
              if (!bookRights) setStatus('Confirm the book narration rights before playing.')
              else props.onPlayPause()
            }}
            type="button"
          >
            {props.playing ? 'Pause' : 'Play'}
          </button>
          <button disabled={!props.document} onClick={props.onBreak} type="button">Break</button>
          <div className="shortsform-progress"><div style={{ width: `${props.progress * 100}%` }} /></div>
        </div>
      </div>
    </main>
  )
}

function WordFocusDocument(props: {
  activeWordStart: number
  document: ParsedDocument | null
  importing: boolean
  onHighlightReady: (highlight: (wordIndex: number) => void) => void
  onOpenImport: () => void
  onJump: (wordIndex: number) => void
  settings: ReaderSettings
}) {
  const activeWordStart = props.activeWordStart
  const documentId = props.document?.id
  const onHighlightReady = props.onHighlightReady
  const showRoleHighlights = props.settings.showRoleHighlights
  const windowAnchor = Math.floor(props.activeWordStart / WORD_FOCUS_WINDOW_STEP) * WORD_FOCUS_WINDOW_STEP
  const windowStart = Math.max(0, windowAnchor - WORD_FOCUS_WINDOW_SIZE / 3)
  const windowEnd = Math.min(
    (props.document?.tokens.length ?? 1) - 1,
    windowStart + WORD_FOCUS_WINDOW_SIZE - 1,
  )
  const tokenRefs = useRef(new Map<number, HTMLSpanElement>())
  const previousWordRef = useRef<number | null>(null)
  const lastScrollWordRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const registerToken = useCallback((wordIndex: number, node: HTMLSpanElement | null) => {
    if (node) tokenRefs.current.set(wordIndex, node)
    else tokenRefs.current.delete(wordIndex)
  }, [])

  const highlightWord = useCallback((wordIndex: number) => {
    const previousWord = previousWordRef.current
    const previousToken = previousWord === null ? null : tokenRefs.current.get(previousWord)
    const activeToken = tokenRefs.current.get(wordIndex)
    previousToken?.classList.remove('active')
    previousToken?.removeAttribute('aria-current')
    previousToken?.closest('p')?.classList.remove('active-paragraph')
    activeToken?.classList.add('active')
    activeToken?.setAttribute('aria-current', 'true')
    activeToken?.closest('p')?.classList.add('active-paragraph')
    previousWordRef.current = wordIndex

    const scroller = activeToken?.closest<HTMLElement>('.word-focus-scroll')
    if (!activeToken || !scroller) return
    const lastScrollWord = lastScrollWordRef.current
    if (lastScrollWord !== null && Math.abs(wordIndex - lastScrollWord) < 12) return
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      lastScrollWordRef.current = wordIndex
      const tokenRect = activeToken.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const upperBound = scrollerRect.top + scrollerRect.height * 0.2
      const lowerBound = scrollerRect.top + scrollerRect.height * 0.8
      if (tokenRect.top >= upperBound && tokenRect.bottom <= lowerBound) return
      scroller.scrollTop += tokenRect.top
        - scrollerRect.top
        - scrollerRect.height / 2
        + tokenRect.height / 2
    })
  }, [])

  useLayoutEffect(() => {
    onHighlightReady(highlightWord)
    return () => {
      onHighlightReady(() => {})
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    }
  }, [highlightWord, onHighlightReady])

  useLayoutEffect(() => {
    highlightWord(activeWordStart)
  }, [activeWordStart, documentId, highlightWord, showRoleHighlights])

  if (!props.document) {
    return (
      <section className="word-focus-empty">
          <p>Word Focus highlights one active word while narration reads natural phrases.</p>
          <button onClick={props.onOpenImport} type="button">
            <FileUp size={18} />
            {props.importing ? 'Importing…' : 'Upload document'}
          </button>
      </section>
    )
  }

  return (
    <div className="word-focus-scroll">
      <WordFocusContent
        document={props.document}
        onJump={props.onJump}
        registerToken={registerToken}
        showRoleHighlights={props.settings.showRoleHighlights}
        windowEnd={windowEnd}
        windowStart={windowStart}
      />
    </div>
  )
}

const WordFocusContent = memo(function WordFocusContent(props: {
  document: ParsedDocument
  onJump: (wordIndex: number) => void
  registerToken: (wordIndex: number, node: HTMLSpanElement | null) => void
  showRoleHighlights: boolean
  windowEnd: number
  windowStart: number
}) {
  return (
    <article className="word-focus-document" aria-label={props.document.title}>
      {props.document.sections.filter((section) => (
        section.tokenEnd >= props.windowStart && section.tokenStart <= props.windowEnd
      )).map((section) => (
        <section key={section.id}>
          {section.title && !/^Section \d+$/i.test(section.title) && section.tokenStart >= props.windowStart
            ? <h2>{section.title}</h2>
            : null}
          {section.paragraphs.filter((paragraph) => (
            paragraph.tokenEnd >= props.windowStart && paragraph.tokenStart <= props.windowEnd
          )).map((paragraph) => (
            <p key={paragraph.id}>
              {props.document.tokens.slice(
                Math.max(paragraph.tokenStart, props.windowStart),
                Math.min(paragraph.tokenEnd, props.windowEnd) + 1,
              ).map((token) => (
                <span key={token.id}>
                  <span
                    className={[
                      'word-focus-token',
                      props.showRoleHighlights ? `role-${token.role}` : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => props.onJump(token.source.wordIndex)}
                    ref={(node) => props.registerToken(token.source.wordIndex, node)}
                  >
                    {token.text}
                  </span>
                  {shouldSpace(token, props.document.tokens[token.source.wordIndex + 1]) ? ' ' : ''}
                </span>
              ))}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
})

function ChunkView({ chunk, narrationActive, showFocusPoint, showRoles }: {
  chunk: ReadingChunk | null
  narrationActive: boolean
  showFocusPoint: boolean
  showRoles: boolean
}) {
  if (!chunk) return null
  return (
    <div className={`display-line${narrationActive ? ' narration-active' : ''}`}>
      {chunk.tokens.map((token, index) => (
        <span className={[
          showRoles ? `role-${token.role}` : '',
        ].filter(Boolean).join(' ')} key={token.id}>
          <FocusableToken token={token} enabled={showFocusPoint} />
          {shouldSpace(token, chunk.tokens[index + 1]) ? ' ' : ''}
        </span>
      ))}
    </div>
  )
}

function FocusableToken({ token, enabled }: { token: Token; enabled: boolean }) {
  const focus = enabled ? getFocusPointIndex(token.text) : -1
  if (focus < 0) return <>{token.text}</>
  return <>{token.text.slice(0, focus)}<span className="focus-letter">{token.text[focus]}</span>{token.text.slice(focus + 1)}</>
}

function ModeSelector({ mode, onChange }: { mode: ReaderSettings['mode']; onChange: (mode: ReaderSettings['mode']) => void }) {
  return (
    <div className="mode-selector" aria-label="Reading intent">
      {[
        ['skim', 'Skim for gist'],
        ['deep-focus', 'Deep focus'],
        ['study', 'Study / retain'],
      ].map(([value, label]) => (
        <button className={mode === value ? 'active' : ''} key={value} onClick={() => onChange(value as ReaderSettings['mode'])} type="button">{label}</button>
      ))}
    </div>
  )
}

function Background({ settings, mediaRef, youtubeRef }: {
  settings: ReaderSettings
  mediaRef: RefObject<HTMLVideoElement | null>
  youtubeRef: RefObject<HTMLIFrameElement | null>
}) {
  const style = {
    opacity: settings.backgroundOpacity / 100,
    filter: `blur(${settings.backgroundBlur}px)`,
  }
  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.playbackRate = settings.backgroundPlaybackRate
      if (settings.backgroundPaused) mediaRef.current.pause()
      else void mediaRef.current.play().catch(() => undefined)
    }
    if (youtubeRef.current?.contentWindow) {
      const command = (func: string, args: unknown[] = []) => youtubeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com',
      )
      command(settings.backgroundPaused ? 'pauseVideo' : 'playVideo')
      command('setPlaybackRate', [settings.backgroundPlaybackRate])
      command('setLoop', [settings.backgroundLoop])
    }
  }, [mediaRef, settings.backgroundLoop, settings.backgroundPaused, settings.backgroundPlaybackRate, youtubeRef])
  if (!settings.backgroundMediaUrl || settings.backgroundMediaType === 'none') return null
  if (settings.backgroundMediaType === 'image') return <div className="background-media" style={{ ...style, backgroundImage: `url("${settings.backgroundMediaUrl}")` }} />
  if (settings.backgroundMediaType === 'video') return <video className="background-media" loop={settings.backgroundLoop} muted playsInline ref={mediaRef} src={settings.backgroundMediaUrl} style={style} />
  return <iframe allow="autoplay; encrypted-media" className="background-media youtube" ref={youtubeRef} src={settings.backgroundMediaUrl} style={style} title="Background video" />
}

function Progress({ progress, document, showMilestones, onJump }: {
  progress: number
  document: ParsedDocument | null
  showMilestones: boolean
  onJump: (wordIndex: number) => void
}) {
  return (
    <div className="progress-track" aria-label={`${Math.round(progress * 100)}% complete`}>
      <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      {showMilestones && document ? document.sections.map((section) => (
        <button
          aria-label={`Jump to ${section.title}`}
          className="progress-milestone"
          key={section.id}
          onClick={() => onJump(section.tokenStart)}
          style={{ left: `${section.tokenStart / Math.max(document.tokens.length - 1, 1) * 100}%` }}
          title={section.title}
          type="button"
        />
      )) : null}
    </div>
  )
}

function Dock(props: {
  label?: string
  playing: boolean
  settingsOpen: boolean
  focusMode: boolean
  narrationMode: boolean
  onRestart: () => void
  onRewind: () => void
  onToggle: () => void
  onNext: () => void
  onBreak: () => void
  onSprint: () => void
  onText: () => void
  onNotes: () => void
  onUnderstood: () => void
  onLosingFocus: () => void
  onLockedIn: () => void
  onImportant: () => void
  onConfused: () => void
  onSettings: () => void
  onFocusMode: () => void
  onNarration: () => void
}) {
  const groups: Array<Array<{
    action: () => void
    icon: ReactNode
    label: string
    level?: 'primary' | 'standard' | 'quiet'
    shortcut: string
  }>> = [
    [
      { action: props.onRestart, icon: <ListRestart />, label: 'Restart', shortcut: 'R' },
      { action: props.onRewind, icon: <ArrowLeft />, label: 'Rewind', shortcut: 'ArrowLeft' },
      { action: props.onToggle, icon: props.playing ? <CirclePause /> : <CirclePlay />, label: props.playing ? 'Pause' : 'Play', level: 'primary', shortcut: 'Space' },
      { action: props.onNext, icon: <ArrowRight />, label: 'Next', shortcut: 'ArrowRight' },
    ],
    [
      { action: props.onBreak, icon: <Clock3 />, label: 'Break', shortcut: 'B' },
      { action: props.onSprint, icon: <Gauge />, label: 'Sprint', shortcut: 'P' },
      { action: props.onText, icon: <BookOpen />, label: 'Text', shortcut: 'V' },
      { action: props.onFocusMode, icon: <Focus />, label: props.focusMode ? 'Exit focus' : 'Focus mode', shortcut: 'F' },
      { action: props.onNarration, icon: <MessageSquareText />, label: props.narrationMode ? 'Stop narration' : 'Narration', shortcut: 'H' },
      { action: props.onNotes, icon: <MessageSquareText />, label: 'Notes', shortcut: 'N' },
    ],
    [
      { action: props.onUnderstood, icon: <Focus />, label: 'Clear', level: 'quiet', shortcut: 'M' },
      { action: props.onLosingFocus, icon: <AlertCircle />, label: 'Losing focus', level: 'quiet', shortcut: 'L' },
      { action: props.onLockedIn, icon: <Sparkles />, label: 'Locked in', level: 'quiet', shortcut: 'K' },
      { action: props.onImportant, icon: <Flag />, label: 'Mark', level: 'quiet', shortcut: '1 / I' },
      { action: props.onConfused, icon: <CircleHelp />, label: 'Confused', level: 'quiet', shortcut: '2' },
      { action: props.onSettings, icon: props.settingsOpen ? <X /> : <Settings />, label: props.settingsOpen ? 'Close settings' : 'Settings', shortcut: 'S' },
    ],
  ]
  return (
    <div className="dock" role="toolbar" aria-label={props.label ?? 'Reader controls'}>
      {groups.map((actions, index) => (
        <div className="dock-group" key={index}>
          {actions.map(({ action, icon, label, level, shortcut }) => (
            <button
              aria-label={`${label} (${shortcut})`}
              className={`dock-action ${level ?? 'standard'}`}
              key={label}
              onClick={action}
              title={`${label} (${shortcut})`}
              type="button"
            >
              {icon}
              <span className="dock-tooltip">{label}</span>
              <kbd>{shortcut}</kbd>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

const THEME_CHOICES: Array<{
  value: ReaderSettings['theme']
  label: string
  sample: string
  palette: [string, string, string]
}> = [
  { value: 'light', label: 'Light', sample: 'White page, high clarity', palette: ['#ffffff', '#091717', '#168da0'] },
  { value: 'paper', label: 'Paper', sample: 'Soft page, custom colors', palette: ['#fbfaf4', '#091717', '#1fb8cd'] },
  { value: 'sepia', label: 'Sepia', sample: 'Warm long-form reading', palette: ['#e8e0c0', '#4b3426', '#b43b2d'] },
  { value: 'dark', label: 'Dark', sample: 'Dim room reading', palette: ['#091717', '#fbfaf4', '#1fb8cd'] },
  { value: 'calm', label: 'Calm', sample: 'Muted SwiftRead palette', palette: ['#101a17', '#dbe7e1', '#7c8f86'] },
  { value: 'eink', label: 'E-ink', sample: 'Low-stimulation grey', palette: ['#e9e7df', '#181a19', '#2e565e'] },
  { value: 'high-contrast', label: 'Contrast', sample: 'Maximum separation', palette: ['#000000', '#ffffff', '#00e5ff'] },
]

const INTENT_CHOICES: Array<{ value: ReaderSettings['mode']; label: string; detail: string }> = [
  { value: 'skim', label: 'Skim', detail: 'Faster pace, larger chunks' },
  { value: 'deep-focus', label: 'Deep focus', detail: 'Balanced pace and reset cadence' },
  { value: 'study', label: 'Study', detail: 'Slower pace, tighter retention' },
]

const SENSORY_CHOICES: Array<{ value: ReaderSettings['sensoryPreset']; label: string; detail: string }> = [
  { value: 'neutral', label: 'Neutral', detail: 'Minimal assistance' },
  { value: 'calm', label: 'Calm', detail: 'Wide focus window and softer contrast' },
  { value: 'crisp', label: 'Crisp', detail: 'Sharper contrast and narrower window' },
  { value: 'low-stim', label: 'Low stim', detail: 'E-ink palette with reduced signals' },
]

function SettingsPanel(props: {
  settings: ReaderSettings
  voices: ShortsformVoice[]
  narrationStatus: string
  narrationCast: NarrationCast | null
  runtimeStatus: { voice: string; eye: string }
  lastVoiceCommand: string
  onChange: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void
  onMode: (mode: ReaderSettings['mode']) => void
  onPreset: (preset: ReaderSettings['sensoryPreset']) => void
  onUploadBackground: (event: ChangeEvent<HTMLInputElement>) => void
  onBackgroundUrl: (url: string) => void
  onRemoveBackground: () => void
  onRecalibrate: () => void
  onRemoveDocument: () => void
}) {
  const [backgroundUrl, setBackgroundUrl] = useState(props.settings.backgroundMediaUrl)
  const s = props.settings
  const toggles: Array<[keyof ReaderSettings, string]> = [
    ['showFocusPoint', 'Show focus point'],
    ['showRoleHighlights', 'Subject / verb / key highlights'],
    ['eyeAnchor', 'Eye anchor'],
    ['focusWindow', 'Focus window'],
    ['adaptivePacing', 'Adaptive pacing'],
    ['focusRamp', 'Focus mode ramp'],
    ['microBreaks', 'Auto micro-breaks'],
    ['driftRecovery', 'Drift recovery'],
    ['motionSmoothing', 'Motion smoothing'],
    ['autoHideTitle', 'Auto-hide title'],
    ['autoHideFocusUi', 'Auto-hide controls'],
    ['contextLadder', 'Context ladder'],
    ['clarityPauses', 'Buffer heavy words'],
    ['dopamineFeedback', 'Calm streaks and nudges'],
    ['quickSenseChecks', 'Quick sense checks'],
    ['aiMicroQuizzes', 'AI micro-quizzes'],
    ['aiSymbolGrouping', 'AI punctuation grouping'],
    ['aiContext', 'AI summaries and Who / What / Where'],
    ['semanticAiRerank', 'AI semantic-search answer'],
    ['restartPrimer', 'Restart primer'],
    ['resurfaceQueue', 'Queue resurfacing'],
    ['showMilestones', 'Section milestones'],
    ['toneIndicators', 'Tone indicators'],
    ['voiceCommands', 'Voice commands'],
    ['eyeTracking', 'Experimental eye-away detection'],
  ]
  return (
    <aside className="settings-panel" aria-label="Reader settings">
      <div className="settings-toolbar">
        <strong>Reader settings</strong>
        <button onClick={props.onRecalibrate} type="button">Recalibrate</button>
        <button onClick={props.onRemoveDocument} type="button">Remove document</button>
      </div>
      <section className="settings-section settings-section-primary">
        <h2><Gauge size={15} />Reading</h2>
        <WpmRuler value={s.wpm} onChange={(value) => props.onChange('wpm', value)} />
        <Range icon={<BookOpen size={14} />} label={`Words per chunk · ${s.chunkSize}`} min={1} max={5} value={s.chunkSize} onChange={(value) => props.onChange('chunkSize', value)} />
        <Range icon={<Focus size={14} />} label={`Font size · ${s.fontSize}px`} min={24} max={120} step={2} value={s.fontSize} onChange={(value) => props.onChange('fontSize', value)} />
        <Range icon={<Focus size={14} />} label={`Font weight · ${s.fontWeight}`} min={400} max={700} step={100} value={s.fontWeight} onChange={(value) => props.onChange('fontWeight', value)} />
        <div className="settings-two">
          <Range icon={<Focus size={14} />} label={`Word Focus text · ${s.wordFocusTextScale}%`} min={32} max={72} step={1} value={s.wordFocusTextScale} onChange={(value) => props.onChange('wordFocusTextScale', value)} />
          <Range icon={<BookOpen size={14} />} label={`Word Focus lines · ${s.wordFocusLineSpacing}%`} min={120} max={190} step={5} value={s.wordFocusLineSpacing} onChange={(value) => props.onChange('wordFocusLineSpacing', value)} />
        </div>
        <div className="settings-two">
          <Select label="Font family" value={s.fontFamily} options={FONTS} onChange={(value) => props.onChange('fontFamily', value)} />
          <Select label="Sprint length" value={String(s.sprintMinutes)} options={['0', '5', '10', '15', '25']} onChange={(value) => props.onChange('sprintMinutes', Number(value) as ReaderSettings['sprintMinutes'])} />
        </div>
        <OptionCards
          label="Reading mode"
          options={INTENT_CHOICES}
          value={s.mode}
          onChange={(value) => props.onMode(value as ReaderSettings['mode'])}
        />
      </section>
      <section className="settings-section">
        <h2><Focus size={15} />Attention</h2>
        <Range icon={<Clock3 size={14} />} label={`Micro-break interval · ${s.microBreakInterval} chunks`} min={8} max={80} step={2} value={s.microBreakInterval} onChange={(value) => props.onChange('microBreakInterval', value)} />
        <Range icon={<Clock3 size={14} />} label={`Micro-break length · ${s.microBreakDuration}s`} min={5} max={20} value={s.microBreakDuration} onChange={(value) => props.onChange('microBreakDuration', value)} />
        <Range icon={<Focus size={14} />} label={`Focus window strength · ${s.focusWindowStrength}%`} min={15} max={80} value={s.focusWindowStrength} onChange={(value) => props.onChange('focusWindowStrength', value)} />
        <div className="settings-two">
          <Range icon={<CirclePause size={14} />} label={`Comma pause · ${s.pauseCommaMs}ms`} min={0} max={600} step={20} value={s.pauseCommaMs} onChange={(value) => props.onChange('pauseCommaMs', value)} />
          <Range icon={<CirclePause size={14} />} label={`Period pause · ${s.pausePeriodMs}ms`} min={0} max={1000} step={20} value={s.pausePeriodMs} onChange={(value) => props.onChange('pausePeriodMs', value)} />
        </div>
        <Range icon={<MessageSquareText size={14} />} label={`Long-word pause · ${s.pauseLongWordMs}ms`} min={0} max={700} step={20} value={s.pauseLongWordMs} onChange={(value) => props.onChange('pauseLongWordMs', value)} />
        <Segmented
          label="Focus window width"
          options={['narrow', 'balanced', 'wide']}
          value={s.focusWindowWidth}
          onChange={(value) => props.onChange('focusWindowWidth', value as ReaderSettings['focusWindowWidth'])}
        />
      </section>
      <section className="settings-section settings-section-wide">
        <h2><Settings size={15} />Appearance</h2>
        <ThemePicker value={s.theme} onChange={(value) => props.onChange('theme', value)} />
        <div className="settings-two">
          <Segmented label="Contrast" value={s.contrast} options={['soft', 'balanced', 'high']} onChange={(value) => props.onChange('contrast', value as ReaderSettings['contrast'])} />
          <Segmented label="Eye anchor" value={s.eyeAnchorStyle} options={['line', 'grid']} onChange={(value) => props.onChange('eyeAnchorStyle', value as ReaderSettings['eyeAnchorStyle'])} />
        </div>
        <OptionCards
          label="Sensory preset"
          options={SENSORY_CHOICES}
          value={s.sensoryPreset}
          onChange={(value) => props.onPreset(value as ReaderSettings['sensoryPreset'])}
        />
        <div className="settings-two custom-colors">
          <Color label="Background" value={s.backgroundColor} onChange={(value) => {
            props.onChange('theme', 'paper')
            props.onChange('backgroundColor', value)
          }} />
          <Color label="Text" value={s.textColor} onChange={(value) => {
            props.onChange('theme', 'paper')
            props.onChange('textColor', value)
          }} />
        </div>
        <div className="inline-actions appearance-actions">
          <button
            className="reset-colors"
            onClick={() => {
              props.onChange('theme', 'paper')
              props.onChange('backgroundColor', DEFAULT_READER_COLORS.backgroundColor)
              props.onChange('textColor', DEFAULT_READER_COLORS.textColor)
            }}
            type="button"
          >
            Reset colors
          </button>
          <Range label={`Title auto-hide delay · ${s.autoHideTitleDelay}s`} min={1} max={10} value={s.autoHideTitleDelay} onChange={(value) => props.onChange('autoHideTitleDelay', value)} />
        </div>
      </section>
      <section className="settings-section">
        <h2><Video size={15} />Background media</h2>
        <label>Image, video, or YouTube URL<input value={backgroundUrl} onChange={(event) => setBackgroundUrl(event.target.value)} /></label>
        <div className="inline-actions">
          <button onClick={() => props.onBackgroundUrl(backgroundUrl)} type="button">Apply URL</button>
          <label className="button-label">Upload<input accept="image/*,video/*" hidden onChange={props.onUploadBackground} type="file" /></label>
          <button onClick={props.onRemoveBackground} type="button">Remove</button>
        </div>
        <Range icon={<Video size={14} />} label={`Opacity · ${s.backgroundOpacity}%`} min={10} max={100} value={s.backgroundOpacity} onChange={(value) => props.onChange('backgroundOpacity', value)} />
        <Range icon={<Video size={14} />} label={`Dim · ${s.backgroundDim}%`} min={0} max={90} value={s.backgroundDim} onChange={(value) => props.onChange('backgroundDim', value)} />
        <Range icon={<Video size={14} />} label={`Blur · ${s.backgroundBlur}px`} min={0} max={24} value={s.backgroundBlur} onChange={(value) => props.onChange('backgroundBlur', value)} />
        <Range icon={<Gauge size={14} />} label={`Playback rate · ${s.backgroundPlaybackRate.toFixed(1)}×`} min={0.5} max={2} step={0.1} value={s.backgroundPlaybackRate} onChange={(value) => props.onChange('backgroundPlaybackRate', value)} />
        <Toggle label="Pause background video" checked={s.backgroundPaused} onChange={(value) => props.onChange('backgroundPaused', value)} />
        <Toggle label="Loop background video" checked={s.backgroundLoop} onChange={(value) => props.onChange('backgroundLoop', value)} />
      </section>
      <section className="settings-section">
        <h2><MessageSquareText size={15} />Audio</h2>
        <p className="settings-status" role="status">Narration: {props.narrationStatus}</p>
        <p className="settings-status">
          Character voices: {props.narrationCast?.characters.length
            ? props.narrationCast.characters.map((character) => character.name).join(', ')
            : 'Narrator only'}
        </p>
        <Select label="Narration voice" value={s.shortsformTtsVoice} options={props.voices.map((voice) => voice.name)} onChange={(value) => props.onChange('shortsformTtsVoice', value)} />
        <Range icon={<Gauge size={14} />} label={`Narration pace · ${s.shortsformTtsRate.toFixed(1)}×`} min={0.5} max={2} step={0.1} value={s.shortsformTtsRate} onChange={(value) => props.onChange('shortsformTtsRate', value)} />
        <Range icon={<MessageSquareText size={14} />} label={`Narration pitch · ${s.shortsformTtsPitch.toFixed(1)}×`} min={0.5} max={1.5} step={0.1} value={s.shortsformTtsPitch} onChange={(value) => props.onChange('shortsformTtsPitch', value)} />
        <Select label="Ambient audio" value={s.audioMode} options={['off', 'soft-drums', 'brown-noise', 'binaural-beats', 'metronome']} onChange={(value) => props.onChange('audioMode', value as ReaderSettings['audioMode'])} />
        <Range icon={<CirclePlay size={14} />} label={`Volume · ${s.audioVolume}%`} min={0} max={100} value={s.audioVolume} onChange={(value) => props.onChange('audioVolume', value)} />
      </section>
      <section className="settings-section">
        <h2><Settings size={15} />Hotkeys</h2>
        <div className="hotkey-editor">
          {([
            ['playPause', 'Play / pause'],
            ['previous', 'Previous'],
            ['next', 'Next'],
            ['focusMode', 'Focus mode'],
            ['narration', 'Narration / highlight'],
            ['settings', 'Settings'],
            ['textView', 'Text view'],
          ] as Array<[ReaderHotkeyAction, string]>).map(([action, label]) => (
            <HotkeyInput
              action={action}
              key={action}
              label={label}
              value={s.hotkeys[action]}
              onChange={(value) => props.onChange('hotkeys', { ...s.hotkeys, [action]: value })}
            />
          ))}
        </div>
      </section>
      <section className="settings-section toggle-section settings-section-wide">
        <h2><Sparkles size={15} />Features</h2>
        {toggles.map(([key, label]) => (
          <Toggle key={key} label={label} checked={Boolean(s[key])} onChange={(value) => props.onChange(key, value as never)} />
        ))}
      </section>
      <section className="settings-section runtime">
        <h2><AlertCircle size={15} />Runtime status</h2>
        <p>Voice: {props.runtimeStatus.voice}</p>
        <p>Eye tracking: {props.runtimeStatus.eye}</p>
        {props.lastVoiceCommand ? <p>Last command: {props.lastVoiceCommand}</p> : null}
        <p>Camera frames remain local. Semantic vectors remain in IndexedDB. AI receives only selected nearby passages.</p>
      </section>
    </aside>
  )
}

function ThemePicker({ value, onChange }: {
  value: ReaderSettings['theme']
  onChange: (value: ReaderSettings['theme']) => void
}) {
  return (
    <div className="theme-picker" aria-label="Theme">
      {THEME_CHOICES.map((theme) => (
        <button
          aria-pressed={value === theme.value}
          className={value === theme.value ? 'active' : ''}
          key={theme.value}
          onClick={() => onChange(theme.value)}
          type="button"
        >
          <span className="theme-preview" aria-hidden="true" style={{ background: theme.palette[0], color: theme.palette[1], borderColor: theme.palette[2] }}>
            <span />
            <span />
          </span>
          <strong>{theme.label}</strong>
          <span>{theme.sample}</span>
          <i aria-hidden="true">
            {theme.palette.map((color) => <b key={color} style={{ background: color }} />)}
          </i>
        </button>
      ))}
    </div>
  )
}

function WpmRuler({ ariaLabel = 'Words per minute', label = 'Words per minute', value, onChange }: {
  ariaLabel?: string
  label?: string
  value: number
  onChange: (value: number) => void
}) {
  const min = 50
  const max = 1000
  const average = 225
  const percent = (value - min) / (max - min) * 100
  const multiplier = value / average
  const ticks = Array.from({ length: 25 }, (_, index) => index)
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)))
  return (
    <div className="wpm-ruler-card">
      <div className="wpm-ruler-head">
        <span><Gauge size={16} />{label}</span>
        <strong>{value} WPM</strong>
        <em>{multiplier.toFixed(2)}x faster than avg</em>
      </div>
      <div className="wpm-ruler-track">
        <input
          aria-label={ariaLabel}
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={10}
          style={{ '--range-progress': `${percent}%` } as CSSProperties}
          type="range"
          value={value}
        />
        <div className="wpm-ruler-ticks" aria-hidden="true">
          {ticks.map((tick) => <span key={tick} className={tick % 4 === 0 ? 'major' : ''} />)}
        </div>
        <i style={{ left: `${percent}%` }} aria-hidden="true" />
      </div>
      <div className="wpm-ruler-foot">
        <span>Avg reader {average} WPM</span>
        <div>
          <button onClick={() => update(value - 10)} type="button">-10</button>
          <button onClick={() => update(value + 10)} type="button">+10</button>
        </div>
      </div>
    </div>
  )
}

function OptionCards<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Array<{ value: T; label: string; detail: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="option-card-group" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            aria-pressed={value === option.value}
            className={value === option.value ? 'active' : ''}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: T[]
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented-control" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            aria-pressed={value === option}
            className={value === option ? 'active' : ''}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {option.replaceAll('-', ' ')}
          </button>
        ))}
      </div>
    </div>
  )
}

function SemanticSearchModal(props: {
  open: boolean
  query: string
  results: SemanticSearchResult[]
  answer: AiSearchAnswer | null
  status: string
  progress: { done: number; total: number } | null
  onQuery: (value: string) => void
  onSearch: () => void
  onCancel: () => void
  onClose: () => void
  onJump: (wordIndex: number, textView: boolean) => void
}) {
  if (!props.open) return null
  return (
    <div className="modal-backdrop">
      <section className="modal semantic-modal" role="dialog" aria-modal="true" aria-label="Semantic document search">
        <header><h2>Ask this document</h2><button aria-label="Close" onClick={props.onClose} type="button"><X /></button></header>
        <div className="semantic-input">
          <Search />
          <input
            autoFocus
            onKeyDown={(event) => { if (event.key === 'Enter') props.onSearch() }}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder="What part of the book does Alex reveal his secret?"
            value={props.query}
          />
          <button onClick={props.onSearch} type="button">Search</button>
        </div>
        {props.progress ? (
          <div className="index-progress">
            <span>Indexing locally: {props.progress.done} / {props.progress.total}</span>
            <progress max={props.progress.total} value={props.progress.done} />
            <button onClick={props.onCancel} type="button">Cancel</button>
          </div>
        ) : <p className="status-copy">{props.status || 'Search uses local embeddings. Optional AI sees only retrieved passages.'}</p>}
        {props.answer ? <div className="semantic-answer"><strong>Grounded answer</strong><p>{props.answer.answer}</p></div> : null}
        <div className="search-results">
          {props.results.map((result, index) => (
            <article key={result.passage.id}>
              <header>
                <strong>{index + 1}. {result.passage.sectionTitle}</strong>
                <span>{result.confidence} confidence</span>
              </header>
              <p>{result.passage.text}</p>
              <footer>
                <span>Paragraphs {result.passage.paragraphStart + 1}–{result.passage.paragraphEnd + 1} · words {result.passage.wordStart + 1}–{result.passage.wordEnd + 1}</span>
                <div>
                  <button onClick={() => props.onJump(result.passage.wordStart, false)} type="button">Jump to passage</button>
                  <button onClick={() => props.onJump(result.passage.wordStart, false)} type="button">Read from here</button>
                  <button onClick={() => props.onJump(result.passage.wordStart, true)} type="button">Open in text view</button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function TextViewer(props: {
  open: boolean
  document: ParsedDocument | null
  currentWord: number
  query: string
  matches: Array<{ start: number; end: number }>
  cursor: number
  reactions: Reaction[]
  onQuery: (value: string) => void
  onCursor: (value: number) => void
  onJump: (wordIndex: number) => void
  onClose: () => void
}) {
  if (!props.open || !props.document) return null
  const activeMatch = props.matches[Math.min(props.cursor, Math.max(props.matches.length - 1, 0))]
  const reactionRanges = props.reactions.map((reaction) => ({
    reaction,
    range: getReactionRange(reaction, props.document!),
  }))
  const anchoredRanges = [
    { start: props.currentWord, end: props.currentWord },
    activeMatch ? { start: activeMatch.start, end: activeMatch.end } : null,
    ...reactionRanges.map(({ range }) => range),
  ].filter((range): range is { start: number; end: number } => Boolean(range))
  const windowStart = Math.max(
    0,
    Math.min(...anchoredRanges.map((range) => Math.max(0, range.start - TEXT_VIEW_CONTEXT_WORDS))),
  )
  const windowEnd = Math.min(
    props.document.tokens.length - 1,
    Math.max(
      windowStart + TEXT_VIEW_WINDOW_SIZE - 1,
      ...anchoredRanges.map((range) => Math.min(props.document!.tokens.length - 1, range.end + TEXT_VIEW_CONTEXT_WORDS)),
    ),
  )
  const visibleTokens = props.document.tokens.slice(windowStart, windowEnd + 1)
  const visibleReactions = reactionRanges.filter(({ range }) => (
    range.end >= windowStart && range.start <= windowEnd
  ))
  return (
    <div className="text-viewer" onKeyDown={(event) => { if (event.key === 'Escape') props.onClose() }}>
      <header>
        <input autoFocus onChange={(event) => props.onQuery(event.target.value)} placeholder="Exact word or phrase…" value={props.query} />
        <button onClick={() => props.onCursor(Math.max(0, props.cursor - 1))} type="button">Previous</button>
        <button onClick={() => props.onCursor(Math.min(props.matches.length - 1, props.cursor + 1))} type="button">Next</button>
        <span>{props.matches.length ? `${props.cursor + 1} of ${props.matches.length}` : props.query ? 'No matches' : ''}</span>
        <button onClick={props.onClose} type="button">Close</button>
      </header>
      {props.document.tokens.length > visibleTokens.length ? (
        <div className="text-viewer-window" role="status">
          Showing words {windowStart + 1}-{windowEnd + 1} of {props.document.tokens.length}. Use search or click a note to jump elsewhere.
        </div>
      ) : null}
      <article>
        {visibleReactions.map(({ reaction, range }) => (
          <button
            className={`reaction-jump reaction-${reaction.kind}`}
            key={reaction.id}
            onClick={() => props.onJump(range.start)}
            type="button"
          >
            {reactionLabel(reaction.kind)}: {reaction.preview}
          </button>
        ))}
        {visibleTokens.map((token, offset) => {
          const index = windowStart + offset
          const highlighted = props.matches.some((match) => index >= match.start && index <= match.end)
          const active = activeMatch && index >= activeMatch.start && index <= activeMatch.end
          const reactionItem = visibleReactions.find((item) => index >= item.range.start && index <= item.range.end)
          const reaction = reactionItem?.reaction
          return (
            <span key={token.id}>
              <button
                aria-label={reaction ? `${reactionLabel(reaction.kind)} word: ${token.text}` : token.text}
                className={[
                  'text-token',
                  highlighted ? 'highlighted' : '',
                  active ? 'active-hit' : '',
                  index === props.currentWord ? 'current' : '',
                  reaction ? `reaction reaction-${reaction.kind}` : '',
                ].filter(Boolean).join(' ')}
                onClick={() => props.onJump(index)}
                type="button"
              >
                {reaction && reactionItem && index === reactionItem.range.start ? (
                  <span className="reaction-label">{reactionLabel(reaction.kind)}</span>
                ) : null}
                {token.text}
              </button>
              {shouldSpace(token, props.document!.tokens[index + 1]) ? ' ' : ''}
            </span>
          )
        })}
      </article>
    </div>
  )
}

function getShortcutRows(settings: ReaderSettings) {
  return [
    ['O', 'Import'],
    [settings.hotkeys.playPause, 'Play / pause'],
    ['B', 'Break with summary'],
    ['R', 'Restart'],
    [settings.hotkeys.focusMode, 'Focus mode'],
    [settings.hotkeys.narration, 'Narration / highlight'],
    [settings.hotkeys.settings, 'Settings'],
    [settings.hotkeys.textView, 'Text view'],
    ['N', 'Notes'],
    ['?', 'Shortcuts'],
    ['G', 'Guide'],
    ['P', 'Sprint'],
    [settings.hotkeys.previous, 'Smart rewind'],
    [settings.hotkeys.next, 'Next chunk'],
    ['M', 'Makes sense'],
    ['L', 'Losing focus'],
    ['K', 'Locked in'],
    ['1 / I', 'Mark important'],
    ['2', 'Mark confused'],
    ['Ctrl/Cmd+K', 'Semantic search'],
  ]
}

function GuidePage({ queryStatus, runtimeStatus, settings }: {
  queryStatus: string
  runtimeStatus: { voice: string; eye: string }
  settings: ReaderSettings
}) {
  const [query, setQuery] = useState('')
  const filtered = featureRegistry.filter((feature) =>
    `${feature.name} ${feature.category} ${feature.purpose}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <main className="guide-page">
      <header>
        <h1>Guide</h1>
        <p>Every shipped feature, its default, dependencies, processed data, and off switch.</p>
        <input onChange={(event) => setQuery(event.target.value)} placeholder="Search features…" value={query} />
      </header>
      <div className="guide-table">
        {filtered.map((feature) => (
          <article key={feature.id}>
            <header><h2>{feature.name}</h2><span>{feature.status}</span></header>
            <p>{feature.purpose}</p>
            <dl>
              <div><dt>Location</dt><dd>{feature.location}</dd></div>
              <div><dt>Activation</dt><dd>{feature.activation}</dd></div>
              <div><dt>Shortcut</dt><dd>{feature.shortcut || 'None'}</dd></div>
              <div><dt>Default</dt><dd>{feature.defaultState}</dd></div>
              <div><dt>Dependencies</dt><dd>{feature.dependencies}</dd></div>
              <div><dt>Privacy</dt><dd>{feature.privacy}</dd></div>
              <div><dt>Processed data</dt><dd>{feature.processedData}</dd></div>
              <div><dt>Disable</dt><dd>{feature.disable}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <section className="guide-runtime">
        <h2>Current runtime</h2>
        <p>Semantic search: {queryStatus || 'Ready to index locally'}</p>
        <p>Voice commands: {runtimeStatus.voice}</p>
        <p>Eye tracking: {runtimeStatus.eye}</p>
        <p>Delete a document from Reader settings to remove its text, progress, and local semantic index.</p>
      </section>
      <section className="guide-shortcuts">
        <h2>Keyboard shortcuts</h2>
        <div className="shortcut-grid">
          {getShortcutRows(settings).map(([key, label]) => <div key={key}><kbd>{key}</kbd><span>{label}</span></div>)}
        </div>
      </section>
    </main>
  )
}

function ReaderOverlay(props: {
  overlay: Overlay
  seconds: number
  text: string
  quiz: AiQuiz | null
  quizEnabled: boolean
  quizChoice: number | null
  onResume: () => void
  onRewind: () => void
  onLockedIn: () => void
  onUnderstood: () => void
  onLost: () => void
  onDisableChecks: () => void
  onQuiz: () => void
  onQuizChoice: (index: number) => void
  onRestart: () => void
  onReview: () => void
  onSprint: () => void
  onContinueSprint: () => void
  onTakeBreak: () => void
}) {
  if (props.overlay === 'none') return null
  const title = {
    countdown: 'Landing strip', break: 'Break', microbreak: 'Micro-break',
    drift: 'Restore context', hold: 'Who / What / Where', sense: 'Quick sense check',
    complete: 'Session complete', sprint: 'Sprint finished', restart: 'Continue reading',
  }[props.overlay]
  return (
    <div className="reader-overlay">
      <h2>{title}</h2>
      {props.overlay === 'countdown' ? <p>Begin in {props.seconds}s.</p> : null}
      {props.overlay === 'microbreak' ? <p>{props.seconds}s. Let the last phrase settle.</p> : null}
      {props.text ? <p>{props.text}</p> : null}
      {(props.overlay === 'break' || props.overlay === 'hold') ? <div><button onClick={props.onResume}>Resume here</button><button onClick={props.onRewind}>Back up</button></div> : null}
      {props.overlay === 'drift' ? <div><button onClick={props.onLockedIn}>Resume here</button><button onClick={props.onRewind}>Back up</button></div> : null}
      {props.overlay === 'sense' ? (
        <>
          <div><button onClick={props.onUnderstood}>Makes sense</button><button onClick={props.onLost}>Lost it</button><button onClick={props.onDisableChecks}>Disable checks</button>{props.quizEnabled ? <button onClick={props.onQuiz}>Make a quiz</button> : null}</div>
          {props.quiz ? <div className="quiz"><strong>{props.quiz.question}</strong>{props.quiz.options.map((option, index) => <button className={props.quizChoice === index ? 'selected' : ''} disabled={props.quizChoice !== null} key={option} onClick={() => props.onQuizChoice(index)}>{option}</button>)}</div> : null}
        </>
      ) : null}
      {props.overlay === 'complete' ? <div><button onClick={props.onRestart}>Read again</button><button onClick={props.onSprint}>Five-minute sprint</button><button onClick={props.onReview}>Review notes</button></div> : null}
      {props.overlay === 'sprint' ? <div><button onClick={props.onContinueSprint}>Continue</button><button onClick={props.onTakeBreak}>Take break</button><button onClick={props.onResume}>Done for now</button></div> : null}
      {props.overlay === 'restart' ? <div><button onClick={props.onResume}>Resume where I left off</button><button onClick={props.onSprint}>Five-minute restart</button><button onClick={props.onRestart}>Back to start</button></div> : null}
    </div>
  )
}

function Calibration(props: {
  open: boolean
  settings: ReaderSettings
  onApply: (wpm: number, chunk: number, breakSeconds: number) => void
  onSkip: () => void
}) {
  const [wpm, setWpm] = useState(props.settings.wpm)
  const [chunk, setChunk] = useState(props.settings.chunkSize)
  const [breakSeconds, setBreakSeconds] = useState(props.settings.microBreakDuration)
  if (!props.open) return null
  return (
    <div className="modal-backdrop">
      <section className="modal calibration" role="dialog" aria-modal="true">
        <header><h2>Calibration</h2></header>
        <p>Find a comfortable baseline for pace, chunking, and reset length.</p>
        <div className="calibration-sample" style={{ fontFamily: props.settings.fontFamily }}>Attention settles when the pace fits the reader.</div>
        <Range label={`Comfortable WPM · ${wpm}`} min={120} max={600} step={10} value={wpm} onChange={setWpm} />
        <Range label={`Preferred chunk size · ${chunk}`} min={1} max={5} value={chunk} onChange={setChunk} />
        <Range label={`Break tolerance · ${breakSeconds}s`} min={5} max={20} value={breakSeconds} onChange={setBreakSeconds} />
        <footer><button onClick={() => props.onApply(wpm, chunk, breakSeconds)}>Apply profile</button><button onClick={props.onSkip}>Skip</button></footer>
      </section>
    </div>
  )
}

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true">
        <header><h2>{title}</h2><button aria-label="Close" onClick={onClose}><X /></button></header>
        {children}
      </section>
    </div>
  )
}

function Range({ ariaLabel, icon, label, min, max, step = 1, value, onChange }: { ariaLabel?: string; icon?: ReactNode; label: string; min: number; max: number; step?: number; value: number; onChange: (value: number) => void }) {
  const percent = (value - min) / (max - min) * 100
  const [name, metric = String(value)] = label.split(' · ')
  return (
    <label className="range-setting">
      <span className="range-label-row">
        {icon ? <i aria-hidden="true">{icon}</i> : null}
        <span>{name}</span>
        <strong>{metric}</strong>
      </span>
      <input
        aria-label={ariaLabel ?? label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{ '--range-progress': `${percent}%` } as CSSProperties}
        type="range"
        value={value}
      />
      <small><span>{min}</span><span>{max}</span></small>
    </label>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label><span>{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option} value={option}>{option.replaceAll('-', ' ')}</option>)}</select></label>
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-setting"><span>{label}</span><input aria-label={`${label} picker`} type="color" value={value} onChange={(event) => onChange(event.target.value)} /><input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} /></label>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle"><input checked={checked} type="checkbox" onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>
}

function HotkeyInput({ label, value, onChange }: {
  action: ReaderHotkeyAction
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const capture = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (event.key === 'Tab') return
    onChange(formatHotkey(event.nativeEvent))
  }
  return <label>{label}<input aria-label={`${label} hotkey`} onKeyDown={capture} readOnly value={value} /></label>
}

function formatHotkey(event: globalThis.KeyboardEvent) {
  const parts = [
    event.ctrlKey ? 'Ctrl' : '',
    event.metaKey ? 'Meta' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
  ].filter(Boolean)
  const key = event.code === 'Space'
    ? 'Space'
    : event.key.length === 1
      ? event.key.toUpperCase()
      : event.key
  return [...parts, key].join('+')
}

function matchesHotkey(event: globalThis.KeyboardEvent, binding: string) {
  return formatHotkey(event) === binding
}

function getThemeStyle(settings: ReaderSettings): Record<string, string> {
  if (settings.theme === 'high-contrast') return { '--bg': '#000000', '--surface': '#000000', '--text': '#ffffff', '--muted': '#ffffff', '--line': '#ffffff', '--accent': '#00e5ff', '--accent-soft': '#101010', '--focus-red': '#ff5a4f', '--anchor-line': 'rgba(255, 255, 255, 0.42)', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
  if (settings.theme === 'dark') return { '--bg': '#091717', '--surface': '#13343b', '--text': '#fbfaf4', '--muted': '#b7c3c1', '--line': '#36555b', '--accent': '#1fb8cd', '--accent-soft': '#204b52', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
  if (settings.theme === 'calm') return { '--bg': '#101a17', '--surface': '#17241f', '--text': '#dbe7e1', '--muted': '#8fa49a', '--line': '#2b3b35', '--accent': '#7c8f86', '--accent-soft': '#23322d', '--focus-red': '#d4876f', '--anchor-line': 'rgba(219, 231, 225, 0.16)', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
  if (settings.theme === 'eink') return { '--bg': '#e9e7df', '--surface': '#f4f2ea', '--text': '#181a19', '--muted': '#606562', '--line': '#b7bbb6', '--accent': '#2e565e', '--accent-soft': '#d9e6e4', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
  if (settings.theme === 'sepia') return { '--bg': '#e8e0c0', '--surface': '#ede4cf', '--text': '#4b3426', '--muted': '#725b47', '--line': '#c8b98d', '--accent': '#6f543c', '--accent-soft': '#d8c99e', '--focus-red': '#b43b2d', '--focus-document-font': 'Georgia, serif' }
  if (settings.theme === 'light') return { '--bg': '#ffffff', '--surface': '#ffffff', '--text': '#091717', '--muted': '#526462', '--line': '#d8dedb', '--accent': '#168da0', '--accent-soft': '#e6f8fa', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
  return { '--bg': settings.backgroundColor, '--surface': '#fffef9', '--text': settings.textColor, '--muted': '#526462', '--line': '#cad2ce', '--accent': '#1fb8cd', '--accent-soft': '#def7f9', '--focus-document-font': "'Atkinson Hyperlegible', sans-serif" }
}

function getTone(text: string) {
  const value = text.toLowerCase()
  if (/(danger|warning|risk|failure|secret|threat)/.test(value)) return { key: 'alert', label: 'Alert' }
  if (/(study|method|system|analysis|research|process)/.test(value)) return { key: 'technical', label: 'Technical' }
  if (/(calm|gentle|quiet|warm|steady)/.test(value)) return { key: 'calm', label: 'Calm' }
  return { key: 'neutral', label: 'Neutral' }
}

function getFatigueScore(chunk: ReadingChunk, chunksSinceBreak: number, focusSeconds: number, metrics: SessionMetrics) {
  return chunk.complexity * 2 + Math.floor(chunksSinceBreak / 8) + Math.floor(focusSeconds / 180) + metrics.lostFocus * 2 + metrics.recoveries
}

function getNearbyContext(document: ParsedDocument, chunk: ReadingChunk) {
  return tokensToText(document.tokens.slice(Math.max(0, chunk.startWordIndex - 70), Math.min(document.tokens.length, chunk.endWordIndex + 40)))
}

function makeReaction(document: ParsedDocument, chunk: ReadingChunk, chunkIndex: number, kind: Reaction['kind']): Reaction {
  return {
    id: crypto.randomUUID(),
    documentId: document.id,
    kind,
    chunkIndex,
    wordStart: chunk.startWordIndex,
    wordEnd: chunk.endWordIndex,
    preview: chunk.text,
    createdAt: Date.now(),
  }
}

function getReactionRange(reaction: Reaction, document: ParsedDocument) {
  const legacyReaction = reaction as Reaction & { wordStart?: number; wordEnd?: number }
  if (typeof legacyReaction.wordStart === 'number' && typeof legacyReaction.wordEnd === 'number') {
    return {
      start: Math.max(0, Math.min(legacyReaction.wordStart, document.tokens.length - 1)),
      end: Math.max(0, Math.min(legacyReaction.wordEnd, document.tokens.length - 1)),
    }
  }
  const firstMatch = document.tokens.findIndex((token) => reaction.preview.includes(token.text))
  const start = Math.max(0, firstMatch)
  return { start, end: start }
}

function reactionLabel(kind: Reaction['kind']) {
  if (kind === 'important') return 'Marked'
  if (kind === 'confused') return 'Confused'
  return 'Understood'
}

function loadStreak(): StreakState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STREAK_KEY) ?? '') as StreakState
    return Number.isFinite(parsed.count) && typeof parsed.lastDay === 'string'
      ? parsed
      : { count: 0, lastDay: '' }
  } catch {
    return { count: 0, lastDay: '' }
  }
}

function shouldSpace(current: Token, next?: Token) {
  if (!next) return false
  if (/^[,.;:!?%)\]}'"»”’]/u.test(next.text)) return false
  if (/[([{'"«“‘¿¡]$/u.test(current.text)) return false
  return true
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function toEdgeTtsPitch(pitch: number) {
  const offset = Math.round((pitch - 1) * 100)
  return `${offset >= 0 ? '+' : ''}${offset}Hz`
}

function toEdgeTtsRate(wpm: number) {
  const offset = Math.min(100, Math.max(-50, Math.round((wpm / 400 - 1) * 100)))
  return `${offset >= 0 ? '+' : ''}${offset}%`
}

function getShortsformCaptionWindow(tokens: Token[], activeWordIndex: number, maxWordsPerLine: number) {
  if (!tokens.length) return { tokens: [] as Token[] }
  const safeWordIndex = Math.max(0, Math.min(activeWordIndex, tokens.length - 1))
  const maxWindowWords = Math.max(maxWordsPerLine * 2, maxWordsPerLine + 2)
  let sentenceStart = safeWordIndex
  while (sentenceStart > 0 && !/[.!?。！？]["')\]]*$/u.test(tokens[sentenceStart - 1]?.text ?? '')) {
    sentenceStart -= 1
  }
  const start = sentenceStart + Math.floor((safeWordIndex - sentenceStart) / maxWindowWords) * maxWindowWords
  const visible: Token[] = []
  for (let index = start; index < tokens.length && visible.length < maxWindowWords; index += 1) {
    const token = tokens[index]
    visible.push(token)
    if (visible.length >= maxWordsPerLine && /[.!?。！？]["')\]]*$/u.test(token.text)) break
  }
  return { tokens: visible }
}

function buildShortsformCaptionLines(
  tokens: Token[],
  options: { maxWords: number },
) {
  const lines: Token[][] = []
  let line: Token[] = []
  tokens.forEach((token, index) => {
    line.push(token)
    const punctuationBreak = /[.!?;:]+["')\]]*$/u.test(token.text)
      || (/,["')\]]*$/u.test(token.text) && line.length >= Math.max(2, options.maxWords - 1))
    if (line.length >= options.maxWords || punctuationBreak || index === tokens.length - 1) {
      lines.push(line)
      line = []
    }
  })
  return lines
}

function toYoutubeEmbed(value: string) {
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    const id = url.hostname.includes('youtu.be')
      ? segments[0]
      : url.searchParams.get('v')
        ?? (segments[0] === 'shorts' || segments[0] === 'embed' ? segments[1] : null)
    if (!id) return null
    const embed = new URL(`https://www.youtube.com/embed/${id}`)
    embed.searchParams.set('autoplay', '1')
    embed.searchParams.set('mute', '1')
    embed.searchParams.set('controls', '0')
    embed.searchParams.set('loop', '1')
    embed.searchParams.set('playlist', id)
    embed.searchParams.set('playsinline', '1')
    embed.searchParams.set('rel', '0')
    embed.searchParams.set('enablejsapi', '1')
    embed.searchParams.set('origin', window.location.origin)
    return embed.toString()
  } catch {
    return null
  }
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface SpeechRecognitionConstructor {
  new (): {
    continuous: boolean
    interimResults: boolean
    lang: string
    onstart: null | (() => void)
    onresult: null | ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    onerror: null | (() => void)
    start: () => void
    stop: () => void
  }
}

export default App
