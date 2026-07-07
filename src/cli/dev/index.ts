import { Command } from "commander"
import { devCliLogger } from "@/utils"

import {
	environmentCommand,
	wakeWordCommand,
	audioRecordingCommand,
	sttCommand,
	llmCommand,
	llmBatchCommand,
	ttsCommand,
	playAudioCommand,
	benchmarkCommand,
	interactiveCommand,
	statusCommand,
	simulateVoiceCommand,
	prepareCorpus,
	runCorpus,
	compareCorpus,
	DEFAULT_CORPUS_PATH,
	mindShowCommand,
	mindExportCommand,
	mindImportCommand,
	mindTemplatesCommand,
	mindUseCommand,
	configShowCommand,
	configHealthCommand,
	configExportCommand,
	configImportCommand,
} from "./commands"

const program = new Command()

program
	.name("domia-dev")
	.description("🛠️ Developer CLI for testing Domia modules locally")
	.version("0.1.0")

program
	.command("environment")
	.description("🧪 Check environment variables and required paths for Domia")
	.action(environmentCommand)

program
	.command("status")
	.description("📋 Show current Domia engine configuration and status")
	.action(statusCommand)

program
	.command("wake-word")
	.description("🛎️  Test wake word detection using the configured engine")
	.action(wakeWordCommand)

program
	.command("audio-rec")
	.description("🎙️  Record a short audio clip from the default microphone")
	.action(audioRecordingCommand)

program
	.command("stt")
	.description("📝 Run Speech-to-Text (STT) on a test audio file")
	.option(
		"-f, --file <path>",
		"Path to audio file for STT",
		"tmp/mic_test_output.wav",
	)
	.option(
		"-e, --engine <engine>",
		"STT engine to use (WHISPER | MOONSHINE). Defaults to mock factory value.",
	)
	.option("-m, --model <model>", "Model name (engine-specific)")
	.action((options) => sttCommand(options.file, options.engine, options.model))

program
	.command("llm")
	.description("🧠 Send a test prompt to the LLM and display the response")
	.option(
		"-p, --prompt <text>",
		"Prompt text to send to the LLM",
		"Good morning, Domia. How are you feeling today?",
	)
	.action((options) => llmCommand(options.prompt))

program
	.command("llm-batch")
	.description(
		"🧠 Run a batch of prompts through the LLM and save responses with timing",
	)
	.option(
		"-i, --input <path>",
		"Path to the input .jsonl file containing the list of user transcripts",
		"tmp/llm-batch/input.jsonl",
	)
	.option(
		"-o, --output <path>",
		"Path to save the output .jsonl file with responses and timing",
		"tmp/llm-batch/output.jsonl",
	)
	.action((options) => llmBatchCommand(options.input, options.output))

program
	.command("tts")
	.description("🗣️  Convert a test phrase to audio using the TTS engine")
	.option(
		"-t, --text <text>",
		"Text to convert to speech",
		"Hey, I'm Domia. This is a test.",
	)
	.option(
		"-e, --engine <engine>",
		"TTS engine to use (KOKORO). Defaults to mock factory value.",
	)
	.option("-v, --voice <voice>", "Voice name (engine-specific)")
	.action((options) => ttsCommand(options.text, options.engine, options.voice))

program
	.command("play-audio")
	.description("🔊 Play a local audio file to test audio output")
	.option(
		"-f, --file <path>",
		"Path to audio file to play",
		"tmp/mic_test_output.wav",
	)
	.action((options) => playAudioCommand(options.file))

program
	.command("benchmark")
	.description(
		"📊 Run engine-direct performance benchmark (STT → LLM → TTS, bypasses bus)",
	)
	.option(
		"-f, --file <path>",
		"Path to a single audio file for STT (ignored if --corpus is set)",
		"tmp/mic_test_output.wav",
	)
	.option(
		"-c, --corpus <path>",
		"Path to a corpus JSON to run engine-direct timings over each entry",
	)
	.action((options) => benchmarkCommand(options.file, options.corpus))

program
	.command("interactive")
	.description("🧭 Run interactive developer menu to test modules manually")
	.action(interactiveCommand)

program
	.command("simulate-voice")
	.description(
		"🎙️ Simulate the full voice flow (AUDIO_READY → STT → LLM → TTS → playback) via the bus",
	)
	.option(
		"-f, --file <path>",
		"Path to audio file to inject as AUDIO_READY",
		"tmp/mic_test_output.wav",
	)
	.action((options) => simulateVoiceCommand(options.file))

const testCorpus = program
	.command("test-corpus")
	.description("🧪 Voice corpus regression harness for full e2e pipeline")

testCorpus
	.command("prepare")
	.description(
		"Synthesize and resample audio for each corpus entry (idempotent)",
	)
	.option("-c, --corpus <path>", "Path to corpus JSON", DEFAULT_CORPUS_PATH)
	.action((options) => prepareCorpus(options.corpus))

testCorpus
	.command("run")
	.description("Run the full corpus through the bus and capture timings")
	.option("-c, --corpus <path>", "Path to corpus JSON", DEFAULT_CORPUS_PATH)
	.option("-o, --out <path>", "Path to write JSON results")
	.action((options) => runCorpus(options.corpus, options.out))

testCorpus
	.command("compare")
	.description("Compare two run JSONs and print regression deltas")
	.requiredOption("-b, --baseline <path>", "Baseline JSON")
	.requiredOption("-c, --candidate <path>", "Candidate JSON")
	.action((options) => compareCorpus(options.baseline, options.candidate))

const mind = program
	.command("mind")
	.description("🧠 Inspect, move and template the domia's mind")

mind
	.command("show")
	.description("Print the current mind (character + mood + modules) as JSON")
	.action(mindShowCommand)

mind
	.command("templates")
	.description("List the built-in personality templates")
	.action(mindTemplatesCommand)

mind
	.command("use <templateId>")
	.description("Start the mind from a built-in template")
	.action(mindUseCommand)

mind
	.command("export")
	.description("Export the current mind bundle to a JSON file")
	.option("-o, --out <path>", "Output path", "tmp/mind.json")
	.action((options) => mindExportCommand(options.out))

mind
	.command("import <file>")
	.description("Import a mind bundle from a JSON file into the live mind")
	.action((file) => mindImportCommand(file))

const config = program
	.command("config")
	.description("⚙️  Inspect and apply the domia's full DB configuration")

config
	.command("show")
	.description("Print the full live config (all sections) as JSON")
	.action(configShowCommand)

config
	.command("health")
	.description("Report installed-vs-configured models for troubleshooting")
	.action(configHealthCommand)

config
	.command("export")
	.description("Export the current full config to a JSON file")
	.option("-o, --out <path>", "Output path", "tmp/config.json")
	.action((options) => configExportCommand(options.out))

config
	.command("import <file>")
	.description("Import a config bundle (partial or full) from a JSON file")
	.action((file) => configImportCommand(file))

program
	.parseAsync()
	.then(() => process.exit(0))
	.catch((err) => {
		devCliLogger.error("dev cli command failed", { err })
		process.exit(1)
	})
