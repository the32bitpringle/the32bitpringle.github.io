import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import multer from 'multer'
import { DOMParser } from '@xmldom/xmldom'
import { PDFParse } from 'pdf-parse'
import WordExtractor from 'word-extractor'

loadLocalEnv()
const app = express()
const isTestRuntime = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST || process.env.NODE_TEST_CONTEXT)
const port = Number(process.env.PORT ?? 8787)
const distDir = path.resolve(process.cwd(), 'dist')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
const wordExtractor = new WordExtractor()
const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? ''
const openRouterModel = process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it:free'
const allowedOrigins = (process.env.CORS_ORIGINS ?? [
  'https://celere-reader.web.app',
  'http://localhost:4173',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
].join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const shortsformDir = path.resolve(process.env.SHORTSFORM_DIR ?? path.resolve(process.cwd(), '.shortsform-cache'))
const edgeTtsBridge = path.resolve(process.cwd(), 'server', 'edge_tts_bridge.py')
const edgeTtsPython = findEdgeTtsPython()
const defaultEdgeTtsVoice = process.env.EDGE_TTS_DEFAULT_VOICE ?? 'en-US-AriaNeural'
const ffmpegCommand = process.env.FFMPEG_PATH ?? 'ffmpeg'
const ffprobeCommand = process.env.FFPROBE_PATH ?? 'ffprobe'
const ytDlpCommand = process.env.YT_DLP_PATH ?? 'yt-dlp'
const shortsformExportWidth = clampInteger(process.env.SHORTSFORM_EXPORT_WIDTH, 360, 1080, 720)
const shortsformExportHeight = clampInteger(process.env.SHORTSFORM_EXPORT_HEIGHT, 640, 1920, 1280)
const youtubeFormatSelector = 'bv[height<=360][vcodec^=avc1][ext=mp4]/bv[height<=360][ext=mp4]/bv[height<=360]/b[height<=360]'
const youtubePreviewSection = '*0-600'
const footageUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => {
      const directory = path.join(shortsformDir, 'uploads')
      fs.mkdirSync(directory, { recursive: true })
      callback(null, directory)
    },
    filename: (_request, file, callback) => {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const supported = /^video\//.test(file.mimetype) || /\.(mp4|webm|mov|mkv|m4v)$/i.test(file.originalname)
    callback(supported ? null : new Error('Choose a supported video file.'), supported)
  },
})

app.set('trust proxy', 1)
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
}))
app.use(express.json({ limit: '20mb' }))

const standardApiLimit = rateLimit({ max: 120, windowMs: 60_000 })
const aiApiLimit = rateLimit({ max: 20, windowMs: 60_000, message: 'Too many AI requests. Try again in a minute.' })
const ttsApiLimit = rateLimit({ max: 30, windowMs: 60_000, message: 'Too many narration requests. Try again in a minute.' })
const exportApiLimit = rateLimit({ max: 5, windowMs: 10 * 60_000, message: 'Too many export requests. Try again later.' })
const uploadApiLimit = rateLimit({ max: 12, windowMs: 10 * 60_000, message: 'Too many upload requests. Try again later.' })

if (!isTestRuntime) {
  process.on('unhandledRejection', (error) => {
    logServerEvent('railway.unhandled_rejection', error)
  })

  process.on('uncaughtException', (error) => {
    logServerEvent('railway.uncaught_exception', error)
    process.exitCode = 1
  })
}

app.post('/api/extract', standardApiLimit, upload.single('file'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a document before importing.' })
  try {
    response.json(await extractDocument(request.file.buffer, path.extname(request.file.originalname).toLowerCase(), request.file.originalname))
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : 'The document could not be parsed.' })
  }
})

app.post('/api/extract-url', standardApiLimit, async (request, response) => {
  try {
    const sourceUrl = String(request.body?.url ?? '').trim()
    const result = await fetchImportSource(sourceUrl)
    const finalUrl = new URL(result.url)
    const extension = extensionForRemoteDocument(finalUrl.pathname, result.contentType)
    const fileName = decodeURIComponent(path.posix.basename(finalUrl.pathname)) || finalUrl.hostname
    const extracted = await extractDocument(result.buffer, extension, fileName)
    if ((extension === '.html' || extension === '.htm') && extracted.title === readableTitle(fileName)) {
      extracted.title = extractHtmlTitle(result.buffer.toString('utf8')) || finalUrl.hostname
    }
    response.json({ ...extracted, sourceName: result.url })
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : 'The website could not be imported.' })
  }
})

app.post('/api/quiz', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI quizzes are not configured.' })
  try {
    response.json(await askGemma({
      system: 'Create one calm comprehension quiz. Return strict JSON: {"question":string,"options":[string,string,string],"answerIndex":0|1|2,"explanation":string}. Use only the supplied passage.',
      input: request.body,
      validate: (value) => typeof value?.question === 'string' && Array.isArray(value?.options) && value.options.length === 3,
    }))
  } catch (error) {
    logServerEvent('ai.quiz_failed', error)
    response.status(502).json({ error: error instanceof Error ? error.message : 'Quiz generation failed.' })
  }
})

app.post('/api/context', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI context summaries are not configured.' })
  try {
    response.json(await askGemma({
      system: request.body?.kind === 'who-what-where'
        ? 'Summarize this passage as Who, What, and Where in at most 60 words. Return strict JSON: {"summary":string}. Do not infer unsupported facts.'
        : 'Summarize what was just read in at most 55 words. Return strict JSON: {"summary":string}. Do not infer unsupported facts.',
      input: { context: String(request.body?.context ?? '').slice(0, 6000) },
      validate: (value) => typeof value?.summary === 'string',
    }))
  } catch (error) {
    logServerEvent('ai.context_failed', error, { kind: String(request.body?.kind ?? '') })
    response.status(502).json({ error: error instanceof Error ? error.message : 'Summary generation failed.' })
  }
})

app.post('/api/grouping', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI symbol grouping is not configured.' })
  try {
    response.json(await askGemma({
      system: 'Analyze punctuation and symbol attachment for multilingual RSVP tokenization. Return strict JSON: {"prefixes":string[],"suffixes":string[],"joiners":string[],"standalone":string[],"notes":string[],"languageCode":string}. Include only punctuation and symbols present in the sample. Prefixes attach to the following word, suffixes attach to the preceding word, joiners bind the words on both sides, and standalone symbols remain separate. Do not group semantic phrases or ordinary words.',
      input: { title: request.body?.title, sample: String(request.body?.sample ?? '').slice(0, 5000) },
      validate: (value) => ['prefixes', 'suffixes', 'joiners', 'standalone', 'notes'].every((key) => Array.isArray(value?.[key]))
        && typeof value?.languageCode === 'string',
    }))
  } catch (error) {
    logServerEvent('ai.grouping_failed', error)
    response.status(502).json({ error: error instanceof Error ? error.message : 'Symbol grouping failed.' })
  }
})

app.post('/api/complexity', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI complexity analysis is not configured.' })
  try {
    response.json(await askGemma({
      system: 'Identify at most 30 rare, technical, ambiguous, or cognitively heavy words in this passage that merit a short RSVP pause. Return strict JSON: {"difficultWords":string[]}. Return words only, grounded in the sample.',
      input: { sample: String(request.body?.sample ?? '').slice(0, 7000) },
      validate: (value) => Array.isArray(value?.difficultWords),
    }))
  } catch (error) {
    logServerEvent('ai.complexity_failed', error)
    response.status(502).json({ error: error instanceof Error ? error.message : 'Complexity analysis failed.' })
  }
})

app.post('/api/narration-cast', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI narration casting is not configured.' })
  const voices = Array.isArray(request.body?.voices)
    ? request.body.voices.slice(0, 40).map((voice) => ({
        gender: String(voice?.gender ?? ''),
        locale: String(voice?.locale ?? ''),
        name: String(voice?.name ?? ''),
      })).filter((voice) => voice.name)
    : []
  if (!voices.length) return response.status(400).json({ error: 'No narration voices are available.' })
  try {
    const cast = await askGemma({
      system: 'Detect recurring story characters and cast fitting voices from the supplied voice list. Return strict JSON: {"narratorVoice":string,"characters":[{"name":string,"aliases":string[],"voiceName":string}]}. Use only exact supplied voice names. Include at most 12 characters. Infer age, tone, and gender only when supported by the text; otherwise choose a neutral fitting voice. Do not invent characters.',
      input: {
        title: String(request.body?.title ?? '').slice(0, 200),
        sample: String(request.body?.sample ?? '').slice(0, 14_000),
        voices,
      },
      validate: (value) => typeof value?.narratorVoice === 'string' && Array.isArray(value?.characters),
    })
    const voiceNames = new Set(voices.map((voice) => voice.name))
    response.json({
      narratorVoice: voiceNames.has(cast.narratorVoice) ? cast.narratorVoice : voices[0].name,
      characters: cast.characters.slice(0, 12).filter((character) =>
        typeof character?.name === 'string' && voiceNames.has(character?.voiceName),
      ),
    })
  } catch (error) {
    logServerEvent('ai.narration_cast_failed', error)
    response.status(502).json({ error: error instanceof Error ? error.message : 'Narration casting failed.' })
  }
})

app.post('/api/search-answer', aiApiLimit, async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI search answers are not configured.' })
  try {
    response.json(await askGemma({
      system: 'Rerank and answer the query using only the numbered passages. Return strict JSON: {"answer":string,"citedResultNumbers":number[],"rankedResultNumbers":number[],"confidence":"high"|"medium"|"low"}. rankedResultNumbers must contain each supplied result number once, best evidence first. Cite result numbers in the answer like [1]. If evidence is absent, say so and return low confidence. Never invent a location.',
      input: request.body,
      validate: (value) => typeof value?.answer === 'string'
        && Array.isArray(value?.citedResultNumbers)
        && Array.isArray(value?.rankedResultNumbers),
    }))
  } catch (error) {
    logServerEvent('ai.search_answer_failed', error)
    response.status(502).json({ error: error instanceof Error ? error.message : 'Search answer failed.' })
  }
})

app.get('/api/tts/voices', standardApiLimit, async (_request, response) => {
  if (!edgeTtsAvailable()) return response.status(503).json({ error: 'Edge TTS is not installed on this server.' })
  try {
    const output = await runProcess(edgeTtsPython, [edgeTtsBridge, 'voices'])
    response.json(JSON.parse(output.stdout))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Voice listing failed.' })
  }
})

app.post('/api/tts', ttsApiLimit, async (request, response) => {
  if (!edgeTtsAvailable()) return response.status(503).json({ error: 'Edge TTS is not installed on this server.' })
  const text = String(request.body?.text ?? '').trim()
  if (!text) return response.status(400).json({ error: 'TTS text is required.' })
  if (text.length > 20_000) return response.status(413).json({ error: 'TTS text is too long for one playback chunk.' })
  const voice = sanitizeVoice(request.body?.voice) || defaultEdgeTtsVoice
  const rate = sanitizeEdgeOffset(request.body?.rate, '%')
  const pitch = sanitizeEdgeOffset(request.body?.pitch, 'Hz')
  const requestDir = path.join(shortsformDir, 'tts', randomUUID())
  const textPath = path.join(requestDir, 'speech.txt')
  const audioPath = path.join(requestDir, 'speech.mp3')
  const timingsPath = path.join(requestDir, 'timings.json')
  fs.mkdirSync(requestDir, { recursive: true })
  try {
    fs.writeFileSync(textPath, text)
    await runProcess(edgeTtsPython, [
      edgeTtsBridge, 'speak',
      `--text-file=${textPath}`,
      `--voice=${voice}`,
      `--rate=${rate}`,
      `--pitch=${pitch}`,
      `--output-file=${audioPath}`,
      `--timings-file=${timingsPath}`,
    ], { timeoutMs: 60_000 })
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.json({
      audioBase64: fs.readFileSync(audioPath).toString('base64'),
      timings: JSON.parse(fs.readFileSync(timingsPath, 'utf8')),
    })
  } catch (error) {
    logServerEvent('shortsform.tts_failed', error, {
      textLength: text.length,
      voice,
    })
    response.status(502).json({ error: error instanceof Error ? error.message : 'TTS synthesis failed.' })
  } finally {
    fs.rmSync(requestDir, { recursive: true, force: true })
  }
})

app.get('/api/shortsform/runtime', (_request, response) => {
  response.json({
    tools: runtimeTools(),
  })
})

app.post('/api/shortsform/footage', uploadApiLimit, async (request, response) => {
  if (request.body?.rightsConfirmed !== true) {
    return response.status(403).json({ error: 'Confirm that you have permission to download and reuse this footage.' })
  }
  const sourceUrl = normalizeYoutubeUrl(request.body?.url)
  if (!sourceUrl) {
    return response.status(400).json({ error: 'Enter a valid YouTube or youtu.be URL.' })
  }
  if (!commandAvailable(ytDlpCommand)) {
    return response.status(503).json({ error: 'yt-dlp is not installed on this server.' })
  }

  const cached = findCachedFootage(sourceUrl)
  if (cached) {
    return response.json({
      assetId: cached.assetId,
      cached: true,
      previewUrl: `/api/shortsform/footage/${cached.assetId}`,
      title: cached.title,
    })
  }

  const assetId = randomUUID()
  const assetDir = path.join(shortsformDir, 'footage', assetId)
  const controller = new AbortController()
  const cancelOnDisconnect = () => {
    if (!response.writableEnded) controller.abort()
  }
  response.on('close', cancelOnDisconnect)
  fs.mkdirSync(assetDir, { recursive: true })
  try {
    await runProcess(ytDlpCommand, [
      '--no-playlist',
      '--js-runtimes', 'node',
      '--retries', '3',
      '--fragment-retries', '3',
      '--socket-timeout', '20',
      '--concurrent-fragments', '8',
      '--restrict-filenames',
      '--no-part',
      '--no-mtime',
      '--write-info-json',
      '--download-sections', youtubePreviewSection,
      '--max-filesize', '350M',
      '-f', youtubeFormatSelector,
      '-o', path.join(assetDir, 'source.%(ext)s'),
      sourceUrl,
    ], { timeoutMs: 10 * 60_000, signal: controller.signal })
    const sourcePath = findMediaFile(assetDir)
    if (!sourcePath) throw new Error('yt-dlp completed without producing a supported video file.')
    const title = readDownloadedVideoTitle(assetDir) || 'Authorized footage'
    fs.writeFileSync(path.join(assetDir, 'meta.json'), JSON.stringify({ sourceUrl, title }, null, 2))
    response.json({
      assetId,
      previewUrl: `/api/shortsform/footage/${assetId}`,
      title,
    })
  } catch (error) {
    logServerEvent('shortsform.footage_download_failed', error)
    fs.rmSync(assetDir, { recursive: true, force: true })
    if (!response.destroyed) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Footage download failed.' })
    }
  } finally {
    response.off('close', cancelOnDisconnect)
  }
})

app.post('/api/shortsform/footage/upload', uploadApiLimit, footageUpload.single('file'), (request, response) => {
  if (request.body?.rightsConfirmed !== 'true') {
    if (request.file?.path) fs.rmSync(request.file.path, { force: true })
    return response.status(403).json({ error: 'Confirm that you have permission to reuse this footage.' })
  }
  if (!request.file) return response.status(400).json({ error: 'Choose a video file to upload.' })

  const assetId = randomUUID()
  const assetDir = path.join(shortsformDir, 'footage', assetId)
  const extension = path.extname(request.file.originalname).toLowerCase() || '.mp4'
  const sourcePath = path.join(assetDir, `source${extension}`)
  try {
    fs.mkdirSync(assetDir, { recursive: true })
    fs.renameSync(request.file.path, sourcePath)
    const title = readableTitle(request.file.originalname) || 'Uploaded footage'
    fs.writeFileSync(path.join(assetDir, 'meta.json'), JSON.stringify({ title }, null, 2))
    response.json({
      assetId,
      previewUrl: `/api/shortsform/footage/${assetId}`,
      title,
    })
  } catch (error) {
    fs.rmSync(request.file.path, { force: true })
    fs.rmSync(assetDir, { recursive: true, force: true })
    response.status(500).json({ error: error instanceof Error ? error.message : 'Footage upload failed.' })
  }
})

app.get('/api/shortsform/footage/:assetId', (request, response) => {
  const sourcePath = getFootagePath(request.params.assetId)
  if (!sourcePath) return response.status(404).json({ error: 'Prepared footage was not found.' })
  streamMediaFile(request, response, sourcePath)
})

app.post('/api/shortsform/export', exportApiLimit, async (request, response) => {
  if (request.body?.bookRightsConfirmed !== true || request.body?.footageRightsConfirmed !== true) {
    return response.status(403).json({ error: 'Confirm rights for both the book and footage before exporting.' })
  }
  if (!edgeTtsAvailable() || !commandAvailable(ffmpegCommand) || !commandAvailable(ffprobeCommand)) {
    return response.status(503).json({ error: 'Shortsform export requires Edge TTS, ffmpeg, and ffprobe.' })
  }

  const footagePath = getFootagePath(String(request.body?.footageAssetId ?? ''))
  if (!footagePath) return response.status(400).json({ error: 'Prepare authorized footage before exporting.' })
  const sections = normalizeExportSections(request.body?.sections)
  if (!sections.length) return response.status(400).json({ error: 'The imported book has no readable chapters.' })
  const totalCharacters = sections.reduce((sum, section) => sum + section.text.length, 0)
  if (totalCharacters > 5_000_000) return response.status(413).json({ error: 'This export exceeds the five-million-character local job limit.' })

  const jobId = randomUUID()
  const jobDir = path.join(shortsformDir, 'jobs', jobId)
  fs.mkdirSync(jobDir, { recursive: true })
  try {
    const voice = sanitizeVoice(request.body?.voice) || defaultEdgeTtsVoice
    const rate = Math.max(0.7, Math.min(Number(request.body?.rate) || 1, 1.4))
    const edgeRate = `${Math.round((rate - 1) * 100) >= 0 ? '+' : ''}${Math.round((rate - 1) * 100)}%`
    const segmentPaths = []
    let durationSeconds = 0

    for (const [index, section] of sections.entries()) {
      const base = `chapter-${String(index + 1).padStart(4, '0')}`
      const textPath = path.join(jobDir, `${base}.txt`)
      const audioPath = path.join(jobDir, `${base}.mp3`)
      const subtitlePath = path.join(jobDir, `${base}.srt`)
      const segmentPath = path.join(jobDir, `${base}.mp4`)
      fs.writeFileSync(textPath, section.text)
      await runProcess(edgeTtsPython, [
        edgeTtsBridge, 'speak',
        `--text-file=${textPath}`,
        `--voice=${voice}`,
        `--rate=${edgeRate}`,
        '--pitch=+0Hz',
        `--output-file=${audioPath}`,
      ], { timeoutMs: 30 * 60_000 })
      const chapterDuration = await probeDuration(audioPath)
      durationSeconds += chapterDuration
      fs.writeFileSync(subtitlePath, buildSrt(section.text, chapterDuration))
      const subtitleFilter = `subtitles=${escapeFilterPath(subtitlePath)}:force_style='FontName=DejaVu Sans,FontSize=10,Bold=1,Alignment=2,MarginV=78,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.4,Shadow=0.5'`
      await runProcess(ffmpegCommand, [
        '-y', '-hide_banner', '-nostats',
        '-stream_loop', '-1',
        '-i', footagePath,
        '-i', audioPath,
        '-filter_complex', `[0:v]scale=${shortsformExportWidth}:${shortsformExportHeight}:force_original_aspect_ratio=increase,crop=${shortsformExportWidth}:${shortsformExportHeight},setsar=1,eq=brightness=-0.12[bg];[bg]${subtitleFilter}[video]`,
        '-map', '[video]',
        '-map', '1:a:0',
        '-t', chapterDuration.toFixed(3),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-movflags', '+faststart',
        segmentPath,
      ], { timeoutMs: 60 * 60_000 })
      segmentPaths.push(segmentPath)
    }

    const concatPath = path.join(jobDir, 'chapters.txt')
    fs.writeFileSync(concatPath, segmentPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join('\n'))
    const outputPath = path.join(jobDir, `${safeFileName(request.body?.title) || 'shortsform-book'}.mp4`)
    await runProcess(ffmpegCommand, ['-y', '-hide_banner', '-nostats', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', outputPath], { timeoutMs: 60 * 60_000 })
    fs.writeFileSync(path.join(jobDir, 'result.json'), JSON.stringify({ outputPath }))
    response.json({
      chapterCount: sections.length,
      downloadUrl: `/api/shortsform/jobs/${jobId}/output`,
      durationSeconds,
    })
  } catch (error) {
    logServerEvent('shortsform.export_failed', error, {
      chapterCount: Array.isArray(request.body?.sections) ? request.body.sections.length : 0,
      footageAssetId: String(request.body?.footageAssetId ?? '').slice(0, 64),
      totalCharacters,
    })
    response.status(502).json({ error: error instanceof Error ? error.message : 'Shortsform export failed.' })
  }
})

app.get('/api/shortsform/jobs/:jobId/output', (request, response) => {
  if (!isAssetId(request.params.jobId)) return response.status(404).end()
  const resultPath = path.join(shortsformDir, 'jobs', request.params.jobId, 'result.json')
  if (!fs.existsSync(resultPath)) return response.status(404).json({ error: 'Export was not found.' })
  const { outputPath } = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  if (!outputPath || !fs.existsSync(outputPath)) return response.status(404).json({ error: 'Export file was not found.' })
  streamMediaFile(request, response, outputPath, path.basename(outputPath))
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use('/celere-2', express.static(distDir))
  app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(path.join(distDir, 'index.html')))
}

app.use((error, request, response, _next) => {
  logServerEvent('railway.http_error', error, {
    method: request.method,
    path: request.path,
  })
  if (response.headersSent) return
  response.status(500).json({ error: 'Internal server error.' })
})

if (!isTestRuntime) {
  cleanupStaleFootageParts()
  app.listen(port, () => {
    logServerInfo('railway.startup', {
      allowedOrigins,
      openRouterConfigured: Boolean(openRouterApiKey),
      openRouterModel,
      port,
      shortsformDir,
      tools: runtimeTools(),
    })
    console.log(`Celere server listening on http://localhost:${port}`)
  })
}

export async function extractDocument(buffer, extension, fileName) {
  const title = readableTitle(fileName)
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      const text = normalizeText(result.text)
      if (text.length < 20) throw new Error('No readable text was found. This may be a scanned PDF.')
      return { format: 'pdf', title, sections: splitSections(text) }
    } finally {
      await parser.destroy()
    }
  }
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer })
    const text = normalizeText(result.value)
    return { format: 'docx', title, sections: splitSections(text) }
  }
  if (extension === '.doc') {
    let text
    try {
      const document = await wordExtractor.extract(buffer)
      text = normalizeText(document.getBody())
    } catch (error) {
      const source = buffer.toString('latin1')
      if (!source.startsWith('{\\rtf')) throw error
      text = normalizeText(source
        .replace(/\\'[0-9a-f]{2}/gi, ' ')
        .replace(/\\[a-z]+-?\d* ?/gi, ' ')
        .replace(/[{}]/g, ' '))
    }
    return { format: 'doc', title, sections: splitSections(text) }
  }
  if (extension === '.txt' || extension === '.md' || extension === '.markdown') {
    const text = normalizeText(buffer.toString('utf8'))
    return {
      format: extension === '.txt' ? 'txt' : 'markdown',
      title,
      sections: splitSections(extension === '.txt' ? text : markdownToText(text)),
    }
  }
  if (extension === '.html' || extension === '.htm') {
    const source = buffer.toString('utf8').replace(/^\s*<!doctype[^>]*>\s*/i, '')
    const normalizedSource = /<(?:!doctype|html)\b/i.test(source)
      ? source
      : `<html><body>${source}</body></html>`
    const doc = new DOMParser().parseFromString(normalizedSource, 'text/html')
    Array.from(doc.getElementsByTagName('script')).forEach((node) => node.parentNode?.removeChild(node))
    Array.from(doc.getElementsByTagName('style')).forEach((node) => node.parentNode?.removeChild(node))
    const text = normalizeText(doc.documentElement?.textContent ?? '')
    return { format: 'html', title, sections: splitSections(text) }
  }
  if (extension === '.epub') return extractEpub(buffer, title)
  throw new Error('Unsupported file type. Use PDF, EPUB, Markdown, DOC, DOCX, TXT, or HTML.')
}

async function extractEpub(buffer, fallbackTitle) {
  const archive = await JSZip.loadAsync(buffer)
  const container = new DOMParser().parseFromString(await zipText(archive, 'META-INF/container.xml'), 'text/xml')
  const packagePath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!packagePath) throw new Error('The EPUB package file could not be located.')
  const packageDoc = new DOMParser().parseFromString(await zipText(archive, packagePath), 'text/xml')
  const base = path.posix.dirname(packagePath)
  const manifest = new Map()
  Array.from(packageDoc.getElementsByTagName('item')).forEach((item) => manifest.set(item.getAttribute('id'), {
    href: item.getAttribute('href'), mediaType: item.getAttribute('media-type') ?? '',
  }))
  const sections = []
  for (const [index, itemRef] of Array.from(packageDoc.getElementsByTagName('itemref')).entries()) {
    const item = manifest.get(itemRef.getAttribute('idref'))
    if (!item?.href || !/html|xhtml/i.test(item.mediaType)) continue
    const sectionDoc = new DOMParser().parseFromString(await zipText(archive, path.posix.join(base, item.href)), 'text/html')
    const text = normalizeText(sectionDoc.documentElement?.textContent ?? '')
    if (text) sections.push({ title: `Section ${index + 1}`, text })
  }
  const title = packageDoc.getElementsByTagName('dc:title')[0]?.textContent?.trim() || fallbackTitle
  return { format: 'epub', title, sections }
}

async function askGemma({ system, input, validate }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const result = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: openRouterModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
      }),
      signal: controller.signal,
    })
    if (!result.ok) {
      logServerEvent('openrouter.request_failed', new Error(`OpenRouter request failed (${result.status}).`), {
        model: openRouterModel,
        status: result.status,
      })
      throw new Error(`OpenRouter request failed (${result.status}).`)
    }
    const payload = await result.json()
    const content = payload?.choices?.[0]?.message?.content
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (error) {
      logServerEvent('openrouter.invalid_json', error, { model: openRouterModel })
      throw error
    }
    if (!validate(parsed)) {
      const error = new Error('The AI response did not match the required schema.')
      logServerEvent('openrouter.schema_mismatch', error, { model: openRouterModel })
      throw error
    }
    return parsed
  } finally {
    clearTimeout(timeout)
  }
}

function logServerEvent(event, error, details = {}) {
  console.log(JSON.stringify({
    level: 'error',
    event,
    message: error instanceof Error ? error.message : String(error),
    details,
    timestamp: new Date().toISOString(),
  }))
}

function logServerInfo(event, details = {}) {
  console.log(JSON.stringify({
    level: 'info',
    event,
    details,
    timestamp: new Date().toISOString(),
  }))
}

function runtimeTools() {
  return {
    edgeTts: edgeTtsAvailable(),
    ffmpeg: commandAvailable(ffmpegCommand),
    ffprobe: commandAvailable(ffprobeCommand),
    ytDlp: commandAvailable(ytDlpCommand),
  }
}

function splitSections(text) {
  const blocks = text.split(/\n(?=(?:chapter|section|part)\s+[\w\d]+)/i).map((value) => value.trim()).filter(Boolean)
  return blocks.map((value, index) => {
    const firstLine = value.split('\n')[0].trim()
    const title = /^(chapter|section|part)\b/i.test(firstLine) ? firstLine.slice(0, 120) : `Section ${index + 1}`
    return { title, text: value }
  })
}

function normalizeText(text) {
  return text.replace(/\r/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function markdownToText(markdown) {
  return normalizeText(markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```\w*\s*|\s*```$/g, ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/[*_~`]+/g, ''))
}

function readableTitle(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
}

async function fetchImportSource(value, redirectCount = 0) {
  if (redirectCount > 4) throw new Error('The website redirected too many times.')
  const url = await validateImportUrl(value)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const result = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf,application/epub+zip',
        'User-Agent': 'CelereReader/2.0',
      },
    })
    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.get('location')
      if (!location) throw new Error('The website returned an invalid redirect.')
      return fetchImportSource(new URL(location, url).toString(), redirectCount + 1)
    }
    if (!result.ok) throw new Error(`The website returned HTTP ${result.status}.`)
    const length = Number(result.headers.get('content-length') ?? 0)
    if (length > 50 * 1024 * 1024) throw new Error('The remote document exceeds the 50 MB import limit.')
    const reader = result.body?.getReader()
    const chunks = []
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 50 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('The remote document exceeds the 50 MB import limit.')
      }
      chunks.push(Buffer.from(value))
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: result.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '',
      url: result.url || url.toString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function validateImportUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Enter a valid public website URL.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter a public HTTP or HTTPS website URL.')
  }
  const addresses = await dns.lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Local and private network addresses cannot be imported.')
  }
  return url
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number)
    return parts[0] === 10
      || parts[0] === 127
      || parts[0] === 0
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || parts[0] >= 224
  }
  const normalized = address.toLowerCase().split('%')[0]
  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe8')
    || normalized.startsWith('fe9')
    || normalized.startsWith('fea')
    || normalized.startsWith('feb')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
}

function extensionForRemoteDocument(pathname, contentType) {
  const extension = path.posix.extname(pathname).toLowerCase()
  if (['.pdf', '.epub', '.md', '.markdown', '.txt', '.html', '.htm'].includes(extension)) return extension
  if (contentType === 'application/pdf') return '.pdf'
  if (contentType === 'application/epub+zip') return '.epub'
  if (contentType === 'text/markdown') return '.md'
  if (contentType === 'text/plain') return '.txt'
  if (['text/html', 'application/xhtml+xml'].includes(contentType)) return '.html'
  throw new Error('This URL does not point to a supported webpage or document.')
}

function extractHtmlTitle(source) {
  const document = new DOMParser().parseFromString(source, 'text/html')
  return normalizeText(document.getElementsByTagName('title')[0]?.textContent ?? '').slice(0, 200)
}

async function zipText(archive, filePath) {
  const file = archive.file(filePath)
  if (!file) throw new Error(`Missing EPUB part: ${filePath}`)
  return file.async('string')
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=\s]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

function findEdgeTtsPython() {
  const candidates = [
    process.env.EDGE_TTS_PYTHON,
    path.resolve(process.cwd(), '.venv-edge-tts', 'bin', 'python'),
    path.resolve(process.cwd(), ' celere (original)', '.venv-edge-tts', 'bin', 'python'),
    '/usr/bin/python3',
    '/usr/local/bin/python3',
  ].filter(Boolean)
  const python = candidates.find((candidate) =>
    fs.existsSync(candidate) && spawnSync(candidate, ['-c', 'import edge_tts'], { stdio: 'ignore' }).status === 0,
  )
  if (python) return python
  return spawnSync('python3', ['-c', 'import edge_tts'], { stdio: 'ignore' }).status === 0 ? 'python3' : ''
}

function edgeTtsAvailable() {
  return Boolean(edgeTtsPython && fs.existsSync(edgeTtsBridge))
}

function commandAvailable(command) {
  if (!command) return false
  const versionFlag = /ffmpeg|ffprobe/i.test(path.basename(command)) ? '-version' : '--version'
  return spawnSync(command, [versionFlag], { stdio: 'ignore' }).status === 0
}

function rateLimit({ max, message = 'Too many requests. Try again later.', windowMs }) {
  const buckets = new Map()
  return (request, response, next) => {
    const now = Date.now()
    const forwardedFor = String(request.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    const ip = forwardedFor || request.ip || request.socket.remoteAddress || 'unknown'
    const key = `${request.method}:${request.path}:${ip}`
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }
    bucket.count += 1
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      response.setHeader('Retry-After', String(retryAfterSeconds))
      response.status(429).json({ error: message })
      return
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey)
      }
    }
    next()
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    let bytes = 0
    let settled = false
    const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL')
          finish(new Error(`${path.basename(command)} timed out.`))
        }, options.timeoutMs)
      : null
    const abort = () => {
      child.kill('SIGKILL')
      finish(new Error(`${path.basename(command)} was cancelled.`))
    }
    options.signal?.addEventListener('abort', abort, { once: true })

    const finish = (error, result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result)
    }
    const collect = (target) => (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        child.kill('SIGKILL')
        finish(new Error(`${path.basename(command)} produced too much diagnostic output.`))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8')
      const stderrText = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        const detail = stderrText.trim().split('\n').slice(-4).join(' ')
        finish(new Error(`${path.basename(command)} failed${detail ? `: ${detail}` : ` with exit code ${code}`}.`))
        return
      }
      finish(null, { stdout: stdoutText, stderr: stderrText })
    })
  })
}

function isYoutubeUrl(value) {
  return Boolean(normalizeYoutubeUrl(value))
}

function normalizeYoutubeUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (url.protocol !== 'https:' || !['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return ''
    const segments = url.pathname.split('/').filter(Boolean)
    const videoId = host === 'youtu.be'
      ? segments[0]
      : url.searchParams.get('v')
        ?? (['shorts', 'embed'].includes(segments[0]) ? segments[1] : '')
    return /^[\w-]{6,20}$/.test(videoId ?? '')
      ? `https://www.youtube.com/watch?v=${videoId}`
      : ''
  } catch {
    return ''
  }
}

function isAssetId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function findMediaFile(directory) {
  if (!fs.existsSync(directory)) return null
  const name = fs.readdirSync(directory).find((entry) => /\.(mp4|webm|mov|mkv|m4v)$/i.test(entry))
  return name ? path.join(directory, name) : null
}

function readDownloadedVideoTitle(directory) {
  const infoFile = fs.readdirSync(directory).find((entry) => entry.endsWith('.info.json'))
  if (!infoFile) return ''
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, infoFile), 'utf8'))
    return String(metadata.title ?? '').trim()
  } catch {
    return ''
  }
}

function findCachedFootage(sourceUrl, footageDirectory = path.join(shortsformDir, 'footage')) {
  if (!fs.existsSync(footageDirectory)) return null
  for (const assetId of fs.readdirSync(footageDirectory)) {
    if (!isAssetId(assetId)) continue
    const assetDir = path.join(footageDirectory, assetId)
    const metaPath = path.join(assetDir, 'meta.json')
    const sourcePath = findMediaFile(assetDir)
    if (!sourcePath || !fs.existsSync(metaPath)) continue
    try {
      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      if (metadata.sourceUrl === sourceUrl) {
        return {
          assetId,
          title: String(metadata.title || 'Authorized footage'),
        }
      }
    } catch {
      // Ignore incomplete or corrupt cache entries.
    }
  }
  return null
}

function cleanupStaleFootageParts(
  footageDirectory = path.join(shortsformDir, 'footage'),
  now = Date.now(),
) {
  if (!fs.existsSync(footageDirectory)) return 0
  let removed = 0
  for (const assetId of fs.readdirSync(footageDirectory)) {
    const assetDir = path.join(footageDirectory, assetId)
    if (!fs.statSync(assetDir).isDirectory()) continue
    for (const name of fs.readdirSync(assetDir)) {
      if (!name.endsWith('.part')) continue
      const filePath = path.join(assetDir, name)
      if (now - fs.statSync(filePath).mtimeMs < 60 * 60_000) continue
      fs.rmSync(filePath, { force: true })
      removed += 1
    }
    if (fs.readdirSync(assetDir).length === 0) fs.rmSync(assetDir, { recursive: true, force: true })
  }
  return removed
}

function getFootagePath(assetId) {
  if (!isAssetId(assetId)) return null
  return findMediaFile(path.join(shortsformDir, 'footage', assetId))
}

function streamMediaFile(request, response, filePath, downloadName = '') {
  const size = fs.statSync(filePath).size
  const range = request.headers.range
  response.type(path.extname(filePath))
  response.setHeader('Accept-Ranges', 'bytes')
  if (downloadName) response.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`)
  if (!range) {
    response.setHeader('Content-Length', size)
    fs.createReadStream(filePath).pipe(response)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    response.status(416).setHeader('Content-Range', `bytes */${size}`)
    response.end()
    return
  }
  const start = match[1] ? Number(match[1]) : 0
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  const end = Math.min(requestedEnd, size - 1)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
    response.status(416).setHeader('Content-Range', `bytes */${size}`)
    response.end()
    return
  }

  response.status(206)
  response.setHeader('Content-Length', end - start + 1)
  response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  fs.createReadStream(filePath, { start, end }).pipe(response)
}

function normalizeExportSections(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 500).map((section, index) => ({
    title: String(section?.title || `Chapter ${index + 1}`).trim().slice(0, 160),
    text: String(section?.text ?? '').trim(),
  })).filter((section) => section.text)
}

function sanitizeVoice(value) {
  const voice = String(value ?? '').trim()
  return /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice) ? voice : ''
}

function sanitizeEdgeOffset(value, unit) {
  const input = String(value ?? '').trim()
  const pattern = unit === '%' ? /^[+-]\d{1,3}%$/ : /^[+-]\d{1,3}Hz$/
  return pattern.test(input) ? input : `+0${unit}`
}

function safeFileName(value) {
  return String(value ?? '').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 100)
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

async function probeDuration(filePath) {
  const result = await runProcess(ffprobeCommand, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    filePath,
  ])
  const duration = Number(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine narration duration.')
  return duration
}

function buildSrt(text, durationSeconds) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const groupSize = 8
  const groups = []
  for (let index = 0; index < words.length; index += groupSize) groups.push(words.slice(index, index + groupSize).join(' '))
  const secondsPerGroup = durationSeconds / Math.max(groups.length, 1)
  return groups.map((caption, index) => {
    const start = index * secondsPerGroup
    const end = Math.min(durationSeconds, (index + 1) * secondsPerGroup)
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${caption}\n`
  }).join('\n')
}

function srtTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000)
  const secs = Math.floor(milliseconds % 60_000 / 1000)
  const ms = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function escapeFilterPath(filePath) {
  return filePath.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
}

export {
  buildSrt,
  cleanupStaleFootageParts,
  findCachedFootage,
  findMediaFile,
  isYoutubeUrl,
  normalizeYoutubeUrl,
  normalizeExportSections,
  youtubeFormatSelector,
  youtubePreviewSection,
}
