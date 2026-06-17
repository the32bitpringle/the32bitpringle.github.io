export type ReadingMode = 'skim' | 'deep-focus' | 'study'
export type ReaderTheme = 'light' | 'paper' | 'sepia' | 'dark' | 'calm' | 'eink' | 'high-contrast'
export type ContrastMode = 'soft' | 'balanced' | 'high'
export type AudioMode = 'off' | 'brown-noise' | 'binaural-beats' | 'metronome' | 'soft-drums'
export type SensoryPreset = 'neutral' | 'calm' | 'crisp' | 'low-stim'
export type FocusWindowWidth = 'narrow' | 'balanced' | 'wide'
export type EyeAnchorStyle = 'line' | 'grid'
export type AppPage = 'reader' | 'focus' | 'shortsform' | 'guide'
export type ShortsformSubtitleStyle = 'emphasis' | 'window' | 'plain' | 'karaoke' | 'outline' | 'block' | 'shadow'
export type ShortsformSubtitleCase = 'uppercase' | 'natural'
export type ShortsformCaptionAlign = 'center' | 'left'
export type ShortsformCaptionPosition = 'top' | 'center' | 'bottom'
export type ReactionKind = 'important' | 'confused' | 'understood'
export type WordRole = 'normal' | 'subject' | 'verb' | 'key'
export type ReaderHotkeyAction = 'playPause' | 'previous' | 'next' | 'focusMode' | 'narration' | 'settings' | 'textView'
export type ReaderHotkeys = Record<ReaderHotkeyAction, string>

export interface SymbolGroupingHints {
  prefixes: string[]
  suffixes: string[]
  joiners: string[]
  standalone: string[]
  notes: string[]
  languageCode?: string
}

export interface NarrationCharacterVoice {
  aliases: string[]
  name: string
  voiceName: string
}

export interface NarrationCast {
  characters: NarrationCharacterVoice[]
  narratorVoice: string
}

export interface SourcePosition {
  sectionIndex: number
  paragraphIndex: number
  sentenceIndex: number
  tokenIndex: number
  wordIndex: number
  charStart: number
  charEnd: number
}

export interface Token {
  id: string
  text: string
  normalized: string
  role: WordRole
  difficult: boolean
  source: SourcePosition
}

export interface Sentence {
  id: string
  text: string
  tokenStart: number
  tokenEnd: number
}

export interface Paragraph {
  id: string
  text: string
  index: number
  tokenStart: number
  tokenEnd: number
  sentences: Sentence[]
}

export interface DocumentSection {
  id: string
  title: string
  index: number
  tokenStart: number
  tokenEnd: number
  paragraphs: Paragraph[]
}

export interface ParsedDocument {
  id: string
  hash: string
  title: string
  sourceName: string
  format: string
  importedAt: number
  language: string
  text: string
  tokens: Token[]
  sections: DocumentSection[]
  groupingHints?: SymbolGroupingHints
}

export interface ReadingChunk {
  id: string
  text: string
  tokens: Token[]
  startWordIndex: number
  endWordIndex: number
  sectionIndex: number
  paragraphIndex: number
  sentenceStart: boolean
  sentenceEnd: boolean
  complexity: number
}

export interface SemanticPassage {
  id: string
  documentId: string
  sectionTitle: string
  sectionIndex: number
  paragraphStart: number
  paragraphEnd: number
  wordStart: number
  wordEnd: number
  text: string
}

export interface PassageEmbedding {
  passageId: string
  documentHash: string
  vector: number[]
}

export interface SemanticSearchResult {
  passage: SemanticPassage
  score: number
  semanticScore: number
  lexicalScore: number
  confidence: 'high' | 'medium' | 'low'
}

export interface Reaction {
  id: string
  documentId: string
  kind: ReactionKind
  chunkIndex: number
  wordStart: number
  wordEnd: number
  preview: string
  createdAt: number
}

export interface Bookmark {
  id: string
  documentId: string
  label: string
  wordIndex: number
  createdAt: number
}

export interface SessionMetrics {
  focusedSeconds: number
  breaks: number
  recoveries: number
  lostFocus: number
  understood: number
  misunderstood: number
}

export interface QueueItem {
  documentId: string
  title: string
  format: string
  currentWordIndex: number
  mode: ReadingMode
  savedAt: number
}

export interface ReadingProfile {
  comfortableWpm: number
  preferredChunkSize: number
  breakToleranceSeconds: number
  preferredWpmMin: number
  preferredWpmMax: number
}

export interface ReadingSession {
  documentId: string
  currentWordIndex: number
  currentChunkIndex: number
  mode: ReadingMode
  metrics: SessionMetrics
  reactions: Reaction[]
  bookmarks: Bookmark[]
  updatedAt: number
}

export interface ReaderSettings {
  version: 2
  wpm: number
  chunkSize: number
  fontSize: number
  fontWeight: number
  fontFamily: string
  wordFocusTextScale: number
  wordFocusLineSpacing: number
  mode: ReadingMode
  theme: ReaderTheme
  contrast: ContrastMode
  textColor: string
  backgroundColor: string
  showFocusPoint: boolean
  showRoleHighlights: boolean
  eyeAnchor: boolean
  eyeAnchorStyle: EyeAnchorStyle
  focusWindow: boolean
  focusWindowWidth: FocusWindowWidth
  focusWindowStrength: number
  adaptivePacing: boolean
  focusRamp: boolean
  microBreaks: boolean
  microBreakInterval: number
  microBreakDuration: number
  driftRecovery: boolean
  motionSmoothing: boolean
  autoHideTitle: boolean
  autoHideFocusUi: boolean
  autoHideTitleDelay: number
  contextLadder: boolean
  clarityPauses: boolean
  pauseCommaMs: number
  pausePeriodMs: number
  pauseLongWordMs: number
  dopamineFeedback: boolean
  quickSenseChecks: boolean
  aiMicroQuizzes: boolean
  aiSymbolGrouping: boolean
  aiContext: boolean
  semanticAiRerank: boolean
  restartPrimer: boolean
  voiceCommands: boolean
  eyeTracking: boolean
  resurfaceQueue: boolean
  showMilestones: boolean
  toneIndicators: boolean
  audioMode: AudioMode
  audioVolume: number
  sensoryPreset: SensoryPreset
  sprintMinutes: 0 | 5 | 10 | 15 | 25
  backgroundMediaUrl: string
  backgroundMediaType: 'none' | 'image' | 'video' | 'youtube'
  backgroundOpacity: number
  backgroundBlur: number
  backgroundDim: number
  backgroundPlaybackRate: number
  backgroundPaused: boolean
  backgroundLoop: boolean
  shortsformWpm: number
  shortsformCaptionMaxWords: number
  shortsformSubtitleScale: number
  shortsformSubtitleStyle: ShortsformSubtitleStyle
  shortsformSubtitleCase: ShortsformSubtitleCase
  shortsformCaptionAlign: ShortsformCaptionAlign
  shortsformCaptionPosition: ShortsformCaptionPosition
  shortsformBackdropDim: number
  shortsformFootageBlur: number
  shortsformTts: boolean
  shortsformTtsRate: number
  shortsformTtsPitch: number
  shortsformTtsVoice: string
  hotkeys: ReaderHotkeys
  calibrationComplete: boolean
  profile: ReadingProfile
}

export interface VersionedPersistedState {
  version: 2
  settings: ReaderSettings
  migratedAt?: number
}

export interface AiQuiz {
  question: string
  options: [string, string, string]
  answerIndex: 0 | 1 | 2
  explanation: string
}

export interface AiSearchAnswer {
  answer: string
  citedResultNumbers: number[]
  rankedResultNumbers?: number[]
  confidence: 'high' | 'medium' | 'low'
}
