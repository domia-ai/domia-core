import inquirer from "inquirer"

import {
	environmentCommand,
	wakeWordCommand,
	audioRecordingCommand,
	sttCommand,
	llmCommand,
	ttsCommand,
	playAudioCommand,
	benchmarkCommand,
} from "../"

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
				{ name: "🗣️  Run TTS", value: "tts" },
				{ name: "🔊 Play Audio", value: "play-audio" },
				{ name: "📊 Benchmark", value: "benchmark" },
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
			const { file } = await inquirer.prompt([
				{
					type: "input",
					name: "file",
					message: "📝 Path to audio file:",
					default: "tmp/mic_test_output.wav",
				},
			])
			await sttCommand(file)
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
	}
}
