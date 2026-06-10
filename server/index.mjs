import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
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
const port = Number(process.env.PORT ?? 8787)
const distDir = path.resolve(process.cwd(), 'dist')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })
const wordExtractor = new WordExtractor()
const openRouterApiKey = process.env.OPENROUTER_API_KEY ?? ''
const openRouterModel = process.env.OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it:free'
const shortsformDir = path.resolve(process.cwd(), '.shortsform-cache')
const edgeTtsBridge = path.resolve(process.cwd(), 'server', 'edge_tts_bridge.py')
const edgeTtsPython = findEdgeTtsPython()
const defaultEdgeTtsVoice = process.env.EDGE_TTS_DEFAULT_VOICE ?? 'en-US-AriaNeural'
const ffmpegCommand = process.env.FFMPEG_PATH ?? 'ffmpeg'
const ffprobeCommand = process.env.FFPROBE_PATH ?? 'ffprobe'
const ytDlpCommand = process.env.YT_DLP_PATH ?? 'yt-dlp'
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

app.use(cors())
app.use(express.json({ limit: '20mb' }))

app.post('/api/extract', upload.single('file'), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a document before importing.' })
  try {
    response.json(await extractDocument(request.file.buffer, path.extname(request.file.originalname).toLowerCase(), request.file.originalname))
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : 'The document could not be parsed.' })
  }
})

app.post('/api/quiz', async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI quizzes are not configured.' })
  try {
    response.json(await askGemma({
      system: 'Create one calm comprehension quiz. Return strict JSON: {"question":string,"options":[string,string,string],"answerIndex":0|1|2,"explanation":string}. Use only the supplied passage.',
      input: request.body,
      validate: (value) => typeof value?.question === 'string' && Array.isArray(value?.options) && value.options.length === 3,
    }))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Quiz generation failed.' })
  }
})

app.post('/api/context', async (request, response) => {
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
    response.status(502).json({ error: error instanceof Error ? error.message : 'Summary generation failed.' })
  }
})

app.post('/api/grouping', async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI symbol grouping is not configured.' })
  try {
    response.json(await askGemma({
      system: 'Analyze punctuation and symbol attachment for multilingual RSVP tokenization. Return strict JSON: {"prefixes":string[],"suffixes":string[],"joiners":string[],"standalone":string[],"notes":string[],"languageCode":string}. Include only punctuation and symbols present in the sample. Prefixes attach to the following word, suffixes attach to the preceding word, joiners bind the words on both sides, and standalone symbols remain separate. Do not group semantic phrases or ordinary words.',
      input: { title: request.body?.title, sample: String(request.body?.sample ?? '').slice(0, 5000) },
      validate: (value) => ['prefixes', 'suffixes', 'joiners', 'standalone', 'notes'].every((key) => Array.isArray(value?.[key]))
        && typeof value?.languageCode === 'string',
    }))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Symbol grouping failed.' })
  }
})

app.post('/api/complexity', async (request, response) => {
  if (!openRouterApiKey) return response.status(503).json({ error: 'AI complexity analysis is not configured.' })
  try {
    response.json(await askGemma({
      system: 'Identify at most 30 rare, technical, ambiguous, or cognitively heavy words in this passage that merit a short RSVP pause. Return strict JSON: {"difficultWords":string[]}. Return words only, grounded in the sample.',
      input: { sample: String(request.body?.sample ?? '').slice(0, 7000) },
      validate: (value) => Array.isArray(value?.difficultWords),
    }))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Complexity analysis failed.' })
  }
})

app.post('/api/search-answer', async (request, response) => {
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
    response.status(502).json({ error: error instanceof Error ? error.message : 'Search answer failed.' })
  }
})

app.get('/api/tts/voices', async (_request, response) => {
  if (!edgeTtsAvailable()) return response.status(503).json({ error: 'Edge TTS is not installed on this server.' })
  try {
    const output = await runProcess(edgeTtsPython, [edgeTtsBridge, 'voices'])
    response.json(JSON.parse(output.stdout))
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Voice listing failed.' })
  }
})

app.post('/api/tts', async (request, response) => {
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
      '--text-file', textPath,
      '--voice', voice,
      '--rate', rate,
      '--pitch', pitch,
      '--output-file', audioPath,
      '--timings-file', timingsPath,
    ], { timeoutMs: 60_000 })
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.json({
      audioBase64: fs.readFileSync(audioPath).toString('base64'),
      timings: JSON.parse(fs.readFileSync(timingsPath, 'utf8')),
    })
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'TTS synthesis failed.' })
  } finally {
    fs.rmSync(requestDir, { recursive: true, force: true })
  }
})

app.get('/api/shortsform/runtime', (_request, response) => {
  response.json({
    tools: {
      edgeTts: edgeTtsAvailable(),
      ffmpeg: commandAvailable(ffmpegCommand),
      ffprobe: commandAvailable(ffprobeCommand),
      ytDlp: commandAvailable(ytDlpCommand),
    },
  })
})

app.post('/api/shortsform/footage', async (request, response) => {
  if (request.body?.rightsConfirmed !== true) {
    return response.status(403).json({ error: 'Confirm that you have permission to download and reuse this footage.' })
  }
  const sourceUrl = String(request.body?.url ?? '').trim()
  if (!isYoutubeUrl(sourceUrl)) {
    return response.status(400).json({ error: 'Enter a valid YouTube or youtu.be URL.' })
  }
  if (!commandAvailable(ytDlpCommand)) {
    return response.status(503).json({ error: 'yt-dlp is not installed on this server.' })
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
      '--remote-components', 'ejs:github',
      '--retries', '3',
      '--fragment-retries', '3',
      '--socket-timeout', '20',
      '--concurrent-fragments', '4',
      '--restrict-filenames',
      '--write-info-json',
      '--merge-output-format', 'mp4',
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720][ext=mp4]/best[height<=720]',
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
    fs.rmSync(assetDir, { recursive: true, force: true })
    if (!response.destroyed) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Footage download failed.' })
    }
  } finally {
    response.off('close', cancelOnDisconnect)
  }
})

app.post('/api/shortsform/footage/upload', footageUpload.single('file'), (request, response) => {
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

app.post('/api/shortsform/export', async (request, response) => {
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
        '--text-file', textPath,
        '--voice', voice,
        '--rate', edgeRate,
        '--pitch', '+0Hz',
        '--output-file', audioPath,
      ], { timeoutMs: 30 * 60_000 })
      const chapterDuration = await probeDuration(audioPath)
      durationSeconds += chapterDuration
      fs.writeFileSync(subtitlePath, buildSrt(section.text, chapterDuration))
      const subtitleFilter = `subtitles=${escapeFilterPath(subtitlePath)}:force_style='FontName=DejaVu Sans,FontSize=10,Bold=1,Alignment=2,MarginV=78,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.4,Shadow=0.5'`
      await runProcess(ffmpegCommand, [
        '-y',
        '-stream_loop', '-1',
        '-i', footagePath,
        '-i', audioPath,
        '-filter_complex', `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,eq=brightness=-0.12[bg];[bg]${subtitleFilter}[video]`,
        '-map', '[video]',
        '-map', '1:a:0',
        '-t', chapterDuration.toFixed(3),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
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
    await runProcess(ffmpegCommand, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', outputPath], { timeoutMs: 60 * 60_000 })
    fs.writeFileSync(path.join(jobDir, 'result.json'), JSON.stringify({ outputPath }))
    response.json({
      chapterCount: sections.length,
      downloadUrl: `/api/shortsform/jobs/${jobId}/output`,
      durationSeconds,
    })
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Shortsform export failed.' })
  }
})

app.get('/api/shortsform/jobs/:jobId/output', (request, response) => {
  if (!isAssetId(request.params.jobId)) return response.status(404).end()
  const resultPath = path.join(shortsformDir, 'jobs', request.params.jobId, 'result.json')
  if (!fs.existsSync(resultPath)) return response.status(404).json({ error: 'Export was not found.' })
  const { outputPath } = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
  if (!outputPath || !fs.existsSync(outputPath)) return response.status(404).json({ error: 'Export file was not found.' })
  response.download(outputPath)
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (_request, response) => response.sendFile(path.join(distDir, 'index.html')))
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`Celere server listening on http://localhost:${port}`))
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
  if (extension === '.txt') {
    const text = normalizeText(buffer.toString('utf8'))
    return { format: 'txt', title, sections: splitSections(text) }
  }
  if (extension === '.html' || extension === '.htm') {
    const source = buffer.toString('utf8')
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
  throw new Error('Unsupported file type. Use PDF, EPUB, DOC, DOCX, TXT, or HTML.')
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
    if (!result.ok) throw new Error(`OpenRouter request failed (${result.status}).`)
    const payload = await result.json()
    const content = payload?.choices?.[0]?.message?.content
    const parsed = JSON.parse(content)
    if (!validate(parsed)) throw new Error('The AI response did not match the required schema.')
    return parsed
  } finally {
    clearTimeout(timeout)
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

function readableTitle(fileName) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
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
  ].filter(Boolean)
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? ''
}

function edgeTtsAvailable() {
  return Boolean(edgeTtsPython && fs.existsSync(edgeTtsBridge))
}

function commandAvailable(command) {
  if (!command) return false
  const versionFlag = /ffmpeg|ffprobe/i.test(path.basename(command)) ? '-version' : '--version'
  return spawnSync(command, [versionFlag], { stdio: 'ignore' }).status === 0
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
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return url.protocol === 'https:' && ['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)
  } catch {
    return false
  }
}

function isAssetId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function findMediaFile(directory) {
  if (!fs.existsSync(directory)) return null
  const name = fs.readdirSync(directory).find((entry) => /\.(mp4|webm|mov|mkv)$/i.test(entry))
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

function getFootagePath(assetId) {
  if (!isAssetId(assetId)) return null
  return findMediaFile(path.join(shortsformDir, 'footage', assetId))
}

function streamMediaFile(request, response, filePath) {
  const size = fs.statSync(filePath).size
  const range = request.headers.range
  response.type(path.extname(filePath))
  response.setHeader('Accept-Ranges', 'bytes')
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

export { buildSrt, isYoutubeUrl, normalizeExportSections }
