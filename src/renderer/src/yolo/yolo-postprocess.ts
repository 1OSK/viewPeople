/// <reference lib="webworker" />

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/** Ultralytics ONNX обычно отдаёт вероятности в [0,1]; иначе — логиты (нужен sigmoid). */
function toConfidence(raw: number): number {
  if (raw >= 0 && raw <= 1) {
    return raw
  }
  return sigmoid(raw)
}

function iou_xyxy(a: readonly number[], b: readonly number[]): number {
  const x1 = Math.max(a[0]!, b[0]!)
  const y1 = Math.max(a[1]!, b[1]!)
  const x2 = Math.min(a[2]!, b[2]!)
  const y2 = Math.min(a[3]!, b[3]!)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a[2]! - a[0]!) * Math.max(0, a[3]! - a[1]!)
  const areaB = Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!)
  const union = areaA + areaB - inter
  return union <= 0 ? 0 : inter / union
}

function nms_xyxy(boxes: number[][], scores: number[], iouThresh: number): number[] {
  const order = Array.from(scores.keys()).sort((a, b) => scores[b]! - scores[a]!)
  const keep: number[] = []
  while (order.length > 0) {
    const idx = order.shift()!
    keep.push(idx)
    for (let i = order.length - 1; i >= 0; i--) {
      const j = order[i]!
      if (iou_xyxy(boxes[idx]!, boxes[j]!) > iouThresh) {
        order.splice(i, 1)
      }
    }
  }
  return keep
}

/** COCO: person = 0 в порядке классов Ultralytics YOLOv8. */
const PERSON_CLASS = 0

const MODEL_SIZE = 640
/** Отбрасываем крошечные боксы (шум якорей). */
const MIN_BOX_AREA = 8 * 8

/**
 * Сырой выход YOLOv8 ONNX: [1,84,N] (как в Ultralytics) или [1,N,84].
 * Каналы: cx, cy, w, h (в системе координат letterbox 640×640), затем 80 scores.
 * В официальном примере ONNXRuntime scores сравниваются с порогом без sigmoid — в графе уже вероятности.
 */
export function countPersonsFromYoloOutput(
  data: Float32Array,
  dims: readonly number[],
  confThresh: number,
  iouThresh: number
): number {
  if (dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`YOLO: неожиданная размерность ${dims.join('x')}`)
  }
  const a = dims[1]!
  const b = dims[2]!
  let C: number
  let N: number
  let chw: boolean
  if (a === 84 && b !== 84) {
    C = 84
    N = b
    chw = true
  } else if (b === 84 && a !== 84) {
    C = 84
    N = a
    chw = false
  } else {
    throw new Error(`YOLO: не удалось распознать [1,84,N] / [1,N,84] из ${a}×${b}`)
  }

  const get = (c: number, p: number): number => {
    if (chw) {
      return data[c * N + p]!
    }
    return data[p * C + c]!
  }

  const boxes: number[][] = []
  const scores: number[] = []

  for (let p = 0; p < N; p++) {
    let bestK = 0
    let bestRaw = -Infinity
    for (let k = 0; k < 80; k++) {
      const v = get(4 + k, p)
      if (v > bestRaw) {
        bestRaw = v
        bestK = k
      }
    }
    const bestScore = toConfidence(bestRaw)
    if (bestK !== PERSON_CLASS) {
      continue
    }
    if (bestScore < confThresh) {
      continue
    }

    const cx = get(0, p)
    const cy = get(1, p)
    const bw = get(2, p)
    const bh = get(3, p)
    const x1 = cx - bw / 2
    const y1 = cy - bh / 2
    const x2 = cx + bw / 2
    const y2 = cy + bh / 2
    if (x2 <= x1 || y2 <= y1) {
      continue
    }
    const area = (x2 - x1) * (y2 - y1)
    if (area < MIN_BOX_AREA) {
      continue
    }
    if (x2 < 0 || y2 < 0 || x1 > MODEL_SIZE || y1 > MODEL_SIZE) {
      continue
    }
    boxes.push([x1, y1, x2, y2])
    scores.push(bestScore)
  }

  return nms_xyxy(boxes, scores, iouThresh).length
}
