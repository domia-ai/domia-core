import type { FixJsonStateType } from "./types"

export const fixJson = (input: string): string => {
	const stack: FixJsonStateType[] = ["ROOT"]
	let lastValidIndex = -1
	let literalStart: number | null = null
	let unicodeEscapeDigits = 0

	const isHexDigit = (char: string) =>
		(char >= "0" && char <= "9") ||
		(char >= "A" && char <= "F") ||
		(char >= "a" && char <= "f")

	const processValueStart = (
		char: string,
		i: number,
		swapState: FixJsonStateType,
	) => {
		switch (char) {
			case '"': {
				lastValidIndex = i
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_STRING")
				break
			}
			case "f":
			case "t":
			case "n": {
				lastValidIndex = i
				literalStart = i
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_LITERAL")
				break
			}
			case "-": {
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_NUMBER")
				break
			}
			case "0":
			case "1":
			case "2":
			case "3":
			case "4":
			case "5":
			case "6":
			case "7":
			case "8":
			case "9": {
				lastValidIndex = i
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_NUMBER")
				break
			}
			case "{": {
				lastValidIndex = i
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_OBJECT_START")
				break
			}
			case "[": {
				lastValidIndex = i
				stack.pop()
				stack.push(swapState)
				stack.push("INSIDE_ARRAY_START")
				break
			}
		}
	}

	const processAfterObjectValue = (char: string, i: number) => {
		switch (char) {
			case ",": {
				stack.pop()
				stack.push("INSIDE_OBJECT_AFTER_COMMA")
				break
			}
			case "}": {
				lastValidIndex = i
				stack.pop()
				break
			}
		}
	}

	const processAfterArrayValue = (char: string, i: number) => {
		switch (char) {
			case ",": {
				stack.pop()
				stack.push("INSIDE_ARRAY_AFTER_COMMA")
				break
			}
			case "]": {
				lastValidIndex = i
				stack.pop()
				break
			}
		}
	}

	for (let i = 0; i < input.length; i++) {
		const char = input[i]
		const currentState = stack[stack.length - 1]

		switch (currentState) {
			case "ROOT":
				processValueStart(char, i, "FINISH")
				break

			case "INSIDE_OBJECT_START": {
				switch (char) {
					case '"': {
						stack.pop()
						stack.push("INSIDE_OBJECT_KEY")
						break
					}
					case "}": {
						lastValidIndex = i
						stack.pop()
						break
					}
				}
				break
			}

			case "INSIDE_OBJECT_AFTER_COMMA": {
				if (char === '"') {
					stack.pop()
					stack.push("INSIDE_OBJECT_KEY")
				}
				break
			}

			case "INSIDE_OBJECT_KEY": {
				if (char === '"') {
					stack.pop()
					stack.push("INSIDE_OBJECT_AFTER_KEY")
				}
				break
			}

			case "INSIDE_OBJECT_AFTER_KEY": {
				if (char === ":") {
					stack.pop()
					stack.push("INSIDE_OBJECT_BEFORE_VALUE")
				}
				break
			}

			case "INSIDE_OBJECT_BEFORE_VALUE": {
				processValueStart(char, i, "INSIDE_OBJECT_AFTER_VALUE")
				break
			}

			case "INSIDE_OBJECT_AFTER_VALUE": {
				processAfterObjectValue(char, i)
				break
			}

			case "INSIDE_STRING": {
				switch (char) {
					case '"': {
						stack.pop()
						lastValidIndex = i
						break
					}
					case "\\": {
						stack.push("INSIDE_STRING_ESCAPE")
						break
					}
					default: {
						lastValidIndex = i
					}
				}
				break
			}

			case "INSIDE_ARRAY_START": {
				switch (char) {
					case "]": {
						lastValidIndex = i
						stack.pop()
						break
					}
					default: {
						lastValidIndex = i
						processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE")
						break
					}
				}
				break
			}

			case "INSIDE_ARRAY_AFTER_VALUE": {
				switch (char) {
					case ",": {
						stack.pop()
						stack.push("INSIDE_ARRAY_AFTER_COMMA")
						break
					}
					case "]": {
						lastValidIndex = i
						stack.pop()
						break
					}
					default: {
						lastValidIndex = i
						break
					}
				}
				break
			}

			case "INSIDE_ARRAY_AFTER_COMMA": {
				processValueStart(char, i, "INSIDE_ARRAY_AFTER_VALUE")
				break
			}

			case "INSIDE_STRING_ESCAPE": {
				stack.pop()
				if (char === "u") {
					unicodeEscapeDigits = 0
					stack.push("INSIDE_STRING_UNICODE_ESCAPE")
				} else {
					lastValidIndex = i
				}
				break
			}

			case "INSIDE_STRING_UNICODE_ESCAPE": {
				if (isHexDigit(char)) {
					unicodeEscapeDigits++
					if (unicodeEscapeDigits === 4) {
						stack.pop()
						lastValidIndex = i
					}
				}
				break
			}

			case "INSIDE_NUMBER": {
				switch (char) {
					case "0":
					case "1":
					case "2":
					case "3":
					case "4":
					case "5":
					case "6":
					case "7":
					case "8":
					case "9": {
						lastValidIndex = i
						break
					}
					case "e":
					case "E":
					case "-":
					case ".": {
						break
					}
					case ",": {
						stack.pop()
						if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
							processAfterArrayValue(char, i)
						}
						if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
							processAfterObjectValue(char, i)
						}
						break
					}
					case "}": {
						stack.pop()
						if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
							processAfterObjectValue(char, i)
						}
						break
					}
					case "]": {
						stack.pop()
						if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
							processAfterArrayValue(char, i)
						}
						break
					}
					default: {
						stack.pop()
						break
					}
				}
				break
			}

			case "INSIDE_LITERAL": {
				const partialLiteral = input.substring(literalStart ?? 0, i + 1)
				if (
					!"false".startsWith(partialLiteral) &&
					!"true".startsWith(partialLiteral) &&
					!"null".startsWith(partialLiteral)
				) {
					stack.pop()
					if (stack[stack.length - 1] === "INSIDE_OBJECT_AFTER_VALUE") {
						processAfterObjectValue(char, i)
					} else if (stack[stack.length - 1] === "INSIDE_ARRAY_AFTER_VALUE") {
						processAfterArrayValue(char, i)
					}
				} else {
					lastValidIndex = i
				}
				break
			}
		}
	}

	let result = input.slice(0, lastValidIndex + 1)

	for (let i = stack.length - 1; i >= 0; i--) {
		const state = stack[i]
		switch (state) {
			case "INSIDE_STRING": {
				result += '"'
				break
			}
			case "INSIDE_OBJECT_KEY":
			case "INSIDE_OBJECT_AFTER_KEY":
			case "INSIDE_OBJECT_AFTER_COMMA":
			case "INSIDE_OBJECT_START":
			case "INSIDE_OBJECT_BEFORE_VALUE":
			case "INSIDE_OBJECT_AFTER_VALUE": {
				result += "}"
				break
			}
			case "INSIDE_ARRAY_START":
			case "INSIDE_ARRAY_AFTER_COMMA":
			case "INSIDE_ARRAY_AFTER_VALUE": {
				result += "]"
				break
			}
			case "INSIDE_LITERAL": {
				const partialLiteral = input.substring(literalStart ?? 0, input.length)
				if ("true".startsWith(partialLiteral)) {
					result += "true".slice(partialLiteral.length)
				} else if ("false".startsWith(partialLiteral)) {
					result += "false".slice(partialLiteral.length)
				} else if ("null".startsWith(partialLiteral)) {
					result += "null".slice(partialLiteral.length)
				}
			}
		}
	}

	return result
}
