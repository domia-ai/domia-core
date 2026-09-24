import type { BuiltinToolType } from "../../../types"
import { alarmTool } from "./alarm"
import { alarmCancelTool } from "./alarm_cancel"
import { cancelTool } from "./cancel"
import { dateTool } from "./date"
import { forgetTool } from "./forget"
import { rememberTool } from "./remember"
import { reminderTool } from "./reminder"
import { repeatTool } from "./repeat"
import { timeTool } from "./time"
import { timerTool } from "./timer"
import { timerCancelTool } from "./timer_cancel"
import { timerStatusTool } from "./timer_status"
import { volumeTool } from "./volume"

export const DOMIA_TOOLS: BuiltinToolType[] = [
	timeTool,
	dateTool,
	timerTool,
	timerCancelTool,
	timerStatusTool,
	reminderTool,
	repeatTool,
	cancelTool,
	alarmTool,
	alarmCancelTool,
	volumeTool,
	rememberTool,
	forgetTool,
]
