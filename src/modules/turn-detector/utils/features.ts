const N_FFT = 400
const HOP = 160
const N_MELS = 80
const SR = 16000
const MEL_FLOOR = 1e-10
const VAR_EPS = 1e-7
const BINS = N_FFT / 2 + 1

const hertzToMel = (f: number): number => {
	const minLogHz = 1000
	const minLogMel = 15
	const logstep = 27 / Math.log(6.4)
	return f >= minLogHz
		? minLogMel + Math.log(f / minLogHz) * logstep
		: (3 * f) / 200
}
const melToHertz = (m: number): number => {
	const minLogHz = 1000
	const minLogMel = 15
	const logstep = Math.log(6.4) / 27
	return m >= minLogMel
		? minLogHz * Math.exp(logstep * (m - minLogMel))
		: (200 * m) / 3
}

const buildMelFilters = (): Float32Array => {
	const melMin = hertzToMel(0)
	const melMax = hertzToMel(SR / 2)
	const melFreqs = Array.from(
		{ length: N_MELS + 2 },
		(_, i) => melMin + ((melMax - melMin) * i) / (N_MELS + 1),
	)
	const filterFreqs = melFreqs.map(melToHertz)
	const fftFreqs = Array.from(
		{ length: BINS },
		(_, i) => ((SR / 2) * i) / (BINS - 1),
	)
	const diff = filterFreqs.slice(1).map((v, i) => v - filterFreqs[i])
	const filters = new Float32Array(BINS * N_MELS)
	for (let b = 0; b < BINS; b++) {
		for (let m = 0; m < N_MELS; m++) {
			const down = -(filterFreqs[m] - fftFreqs[b]) / diff[m]
			const up = (filterFreqs[m + 2] - fftFreqs[b]) / diff[m + 1]
			filters[b * N_MELS + m] = Math.max(0, Math.min(down, up))
		}
	}
	for (let m = 0; m < N_MELS; m++) {
		const enorm = 2 / (filterFreqs[m + 2] - filterFreqs[m])
		for (let b = 0; b < BINS; b++) filters[b * N_MELS + m] *= enorm
	}
	return filters
}

const buildTwiddles = (): { cos: Float32Array; sin: Float32Array } => {
	const cos = new Float32Array(BINS * N_FFT)
	const sin = new Float32Array(BINS * N_FFT)
	for (let k = 0; k < BINS; k++) {
		for (let n = 0; n < N_FFT; n++) {
			const a = (-2 * Math.PI * k * n) / N_FFT
			cos[k * N_FFT + n] = Math.cos(a)
			sin[k * N_FFT + n] = Math.sin(a)
		}
	}
	return { cos, sin }
}

const HANN = Float32Array.from(
	{ length: N_FFT },
	(_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT),
)
const MEL = buildMelFilters()
const TW = buildTwiddles()

export const computeWhisperLogMel = (
	audio: Float32Array,
): { data: Float32Array; frames: number } => {
	const N = SR * 8
	const x = new Float32Array(N)
	x.set(audio.subarray(0, Math.min(audio.length, N)))
	let mean = 0
	for (let i = 0; i < N; i++) mean += x[i]
	mean /= N
	let varr = 0
	for (let i = 0; i < N; i++) varr += (x[i] - mean) * (x[i] - mean)
	varr /= N
	const std = Math.sqrt(varr + VAR_EPS)
	for (let i = 0; i < N; i++) x[i] = (x[i] - mean) / std

	const pad = N_FFT / 2
	const padded = new Float32Array(N + 2 * pad)
	for (let i = 0; i < pad; i++) padded[pad - 1 - i] = x[i + 1]
	padded.set(x, pad)
	for (let i = 0; i < pad; i++) padded[pad + N + i] = x[N - 2 - i]

	const numFrames = Math.floor((padded.length - N_FFT) / HOP) + 1
	const win = new Float32Array(N_FFT)
	const power = new Float32Array(BINS)
	const outFrames = numFrames - 1
	const logMel = new Float32Array(N_MELS * outFrames)
	let globalMax = -Infinity

	for (let f = 0; f < numFrames; f++) {
		const start = f * HOP
		for (let n = 0; n < N_FFT; n++) win[n] = padded[start + n] * HANN[n]
		for (let k = 0; k < BINS; k++) {
			let re = 0
			let im = 0
			const base = k * N_FFT
			for (let n = 0; n < N_FFT; n++) {
				const s = win[n]
				re += s * TW.cos[base + n]
				im += s * TW.sin[base + n]
			}
			power[k] = re * re + im * im
		}
		if (f >= outFrames) continue
		for (let m = 0; m < N_MELS; m++) {
			let acc = 0
			for (let b = 0; b < BINS; b++) acc += MEL[b * N_MELS + m] * power[b]
			const v = Math.log10(Math.max(MEL_FLOOR, acc))
			logMel[m * outFrames + f] = v
			if (v > globalMax) globalMax = v
		}
	}

	const floor = globalMax - 8
	for (let i = 0; i < logMel.length; i++)
		logMel[i] = (Math.max(logMel[i], floor) + 4) / 4
	return { data: logMel, frames: outFrames }
}

export const TURN_DETECTOR_MELS = N_MELS
