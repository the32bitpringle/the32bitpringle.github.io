import type { FaceLandmarker } from '@mediapipe/tasks-vision'

let landmarkerPromise: Promise<FaceLandmarker> | null = null

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      )
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55,
      })
    })()
  }
  return landmarkerPromise
}

function ratio(value: number, low: number, high: number) {
  return (value - Math.min(low, high)) / Math.max(Math.abs(high - low), 0.0001)
}

export async function isGazePresent(video: HTMLVideoElement, timestamp: number) {
  const landmarker = await getLandmarker()
  const result = landmarker.detectForVideo(video, timestamp)
  const points = result.faceLandmarks[0]
  if (!points || points.length < 478) return false

  const leftIris = points[468]
  const rightIris = points[473]
  const leftHorizontal = ratio(leftIris.x, points[33].x, points[133].x)
  const rightHorizontal = ratio(rightIris.x, points[362].x, points[263].x)
  const leftVertical = ratio(leftIris.y, points[159].y, points[145].y)
  const rightVertical = ratio(rightIris.y, points[386].y, points[374].y)

  return [leftHorizontal, rightHorizontal].every((value) => value > 0.12 && value < 0.88)
    && [leftVertical, rightVertical].every((value) => value > -0.35 && value < 1.35)
}

