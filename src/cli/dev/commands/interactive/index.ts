import inquirer from "inquirer"

import { STT_ENGINE_ENUM, STT_ENGINE_ENUM_VALUES } from "@/db"

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
	statusCommand,
	configShowCommand,
	configHealthCommand,
} from "../"

const REMOTE_STT_ENGINES: string[] = [
	STT_ENGINE_ENUM.NEMO_SPEECH,
	STT_ENGINE_ENUM.OPENAI_COMPATIBLE,
]

export const interactiveCommand = async () => {
	const { command } = await inquirer.prompt([
		{
			type: "list",
			name: "command",
			message: "🧪 Which module do you want to test?",
			choices: [
				{ name: "🧪 Check Environment", value: "environment" },
				{ name: "🛎️  Wake Word Detection", value: "wake-word" },
				{ name: "🎙️  Record Audio", value: "audio-rec" },
				{ name: "📝 Run STT", value: "stt" },
				{ name: "🧠 Run LLM", value: "llm" },
				{ name: "📚 Run LLM Batch", value: "llm-batch" },
				{ name: "🗣️  Run TTS", value: "tts" },
				{ name: "🔊 Play Audio", value: "play-audio" },
				{ name: "📊 Benchmark", value: "benchmark" },
				{ name: "📋 Status", value: "status" },
				{ name: "🩺 Config Health", value: "config-health" },
				{ name: "🧾 Config Show", value: "config-show" },
			],
		},
	])

	switch (command) {
		case "environment":
			await environmentCommand()
			break
		case "wake-word":
			await wakeWordCommand()
			break
		case "audio-rec":
			await audioRecordingCommand()
			break
		case "stt": {
			const { file, engine } = await inquirer.prompt([
				{
					type: "input",
					name: "file",
					message: "📝 Path to audio file:",
					default: "tmp/mic_test_output.wav",
				},
				{
					type: "list",
					name: "engine",
					message: "📝 STT engine:",
					choices: [...STT_ENGINE_ENUM_VALUES],
				},
			])
			let baseUrl: string | undefined
			if (REMOTE_STT_ENGINES.includes(engine)) {
				const answers = await inquirer.prompt([
					{
						type: "input",
						name: "baseUrl",
						message: "🌐 Server URL (include /v1):",
						default: "http://127.0.0.1:8600/v1",
					},
				])
				baseUrl = answers.baseUrl
			}
			await sttCommand(file, engine, undefined, baseUrl)
			break
		}
		case "llm": {
			const { prompt } = await inquirer.prompt([
				{
					type: "input",
					name: "prompt",
					message: "🧠 Enter prompt for LLM:",
					default: "Good morning, Domia. How are you feeling today?",
				},
			])
			await llmCommand(prompt)
			break
		}

		case "llm-batch": {
			const { input, output } = await inquirer.prompt([
				{
					type: "input",
					name: "input",
					message: "📥 Path to input .jsonl file:",
					default: "tmp/llm-batch/input.jsonl",
				},
				{
					type: "input",
					name: "output",
					message: "📤 Path to output .jsonl file:",
					default: "tmp/llm-batch/output.jsonl",
				},
			])
			await llmBatchCommand(input, output)
			break
		}

		case "tts": {
			const { text } = await inquirer.prompt([
				{
					type: "input",
					name: "text",
					message: "🗣️ Text to synthesize:",
					default: "Hey, I'm DOMIA. This is a test.",
				},
			])
			await ttsCommand(text)
			break
		}

		case "play-audio": {
			const { file } = await inquirer.prompt([
				{
					type: "input",
					name: "file",
					message: "🔊 Path to audio file:",
					default: "tmp/mic_test_output.wav",
				},
			])
			await playAudioCommand(file)
			break
		}

		case "benchmark": {
			const { file } = await inquirer.prompt([
				{
					type: "input",
					name: "file",
					message: "📝 Path to audio file for STT:",
					default: "tmp/mic_test_output.wav",
				},
			])
			await benchmarkCommand(file)
			break
		}

		case "status":
			await statusCommand()
			break
		case "config-health":
			await configHealthCommand()
			break
		case "config-show":
			await configShowCommand()
			break
	}
}
