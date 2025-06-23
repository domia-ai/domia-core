import "dotenv/config"
import { Command } from "commander"

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
	.action((options) => sttCommand(options.file))

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
	.action((options) => ttsCommand(options.text))

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
		"📊 Run full performance benchmark from audio input (STT → LLM → TTS)",
	)
	.option(
		"-f, --file <path>",
		"Path to audio file for STT",
		"tmp/mic_test_output.wav",
	)
	.action((options) => benchmarkCommand(options.file))

program
	.command("interactive")
	.description("🧭 Run interactive developer menu to test modules manually")
	.action(interactiveCommand)

program.parse()
