import type { InjectionPatternType } from "./types"

export const EN_INJECTION_PATTERNS: InjectionPatternType[] = [
	{
		re: /ignore\s+(all\s+|any\s+)?(previous|prior|above)/i,
		reason: "override-instruction",
	},
	{
		re: /disregard\s+(all\s+|the\s+|your\s+)?(previous|prior|above|instructions|rules)/i,
		reason: "override-instruction",
	},
	{
		re: /forget\s+(everything|all|your\s+instructions|what\s+you)/i,
		reason: "override-instruction",
	},
	{
		re: /new\s+(instructions?|system\s+prompt|rules)\s*[:：]/i,
		reason: "instruction-injection",
	},
	{ re: /system\s*prompt\b/i, reason: "prompt-reference" },
	{ re: /you\s+are\s+now\s+(a|an|in)\b/i, reason: "role-reassignment" },
	{ re: /developer\s+mode|jailbreak|DAN\s+mode/i, reason: "jailbreak" },
	{
		re: /\b(pretend|act\s+as|roleplay)\b.{0,40}\b(no\s+restrictions?|unrestricted|no\s+rules)\b/i,
		reason: "role-reassignment",
	},
	{
		re: /<\s*\/?\s*(system|assistant|user|instructions?)\s*>/i,
		reason: "fake-role-tag",
	},
	{
		re: /\[\s*(system|assistant|instructions?)\s*\]/i,
		reason: "fake-role-tag",
	},
	{ re: /###\s*(system|instruction|assistant)/i, reason: "fake-role-header" },
	{
		re: /\b(now|then|next)\b[^.?!]{0,30}\b(ignore|bypass|breach|exploit|hack|break\s+into|evade|inject)\b/i,
		reason: "task-pivot",
	},
	{
		re: /\band\s+then\b[^.?!]{0,40}\b(describe|provide|insert|explain|show)\b[^.?!]{0,30}\b(how\s+to|steps?|instructions?)\b/i,
		reason: "task-pivot",
	},
	{
		re: /\bact\s+as\s+(if\s+)?(you'?re\s+)?(a|an)\s+(system\s+admin|hacker|attacker)/i,
		reason: "role-reassignment",
	},
	{ re: /\bas\s+a\s+hacker\b/i, reason: "role-reassignment" },
	{ re: /\brepeat\s+after\s+me\b/i, reason: "echo-injection" },
	{
		re: /\bos\.(rmdir|remove|system)|import\s+os\b/i,
		reason: "code-injection",
	},
]

export const ES_INJECTION_PATTERNS: InjectionPatternType[] = [
	{
		re: /ignora\s+(todas?\s+|cualquier\s+)?(las?\s+|los?\s+)?(instrucciones|reglas|indicaciones)\s+(anteriores|previas)/i,
		reason: "override-instruction",
	},
	{
		re: /ignora\s+(lo\s+anterior|todo\s+lo\s+anterior)/i,
		reason: "override-instruction",
	},
	{
		re: /olvida\s+(todo|tus\s+instrucciones|lo\s+anterior|las\s+reglas)/i,
		reason: "override-instruction",
	},
	{
		re: /haz\s+caso\s+omiso/i,
		reason: "override-instruction",
	},
	{
		re: /nuevas?\s+(instrucciones|reglas)\s*[:：]/i,
		reason: "instruction-injection",
	},
	{
		re: /a\s+partir\s+de\s+ahora\s+(eres|eras|serás|seras|actúas|actuas)/i,
		reason: "role-reassignment",
	},
	{ re: /eres\s+ahora\s+(un|una)\b/i, reason: "role-reassignment" },
	{
		re: /act[úu]a\s+como\s+(si\s+)?(fueras\s+)?(un|una)?/i,
		reason: "role-reassignment",
	},
	{ re: /modo\s+desarrollador/i, reason: "jailbreak" },
	{ re: /sin\s+restricciones/i, reason: "jailbreak" },
	{
		re: /desbloquea\s+(la\s+)?puerta.{0,40}(ignora|olvida|sin\s+preguntar)/i,
		reason: "task-pivot",
	},
]

export const INJECTION_PATTERNS_BY_LANGUAGE: Record<
	string,
	InjectionPatternType[]
> = {
	en: EN_INJECTION_PATTERNS,
	es: ES_INJECTION_PATTERNS,
}

export const allInjectionPatterns = (): InjectionPatternType[] =>
	Object.values(INJECTION_PATTERNS_BY_LANGUAGE).flat()
