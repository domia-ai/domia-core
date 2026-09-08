import type {
	AnaphoraRewriteType,
	LanguageCatalogExtensionType,
	LanguageCatalogType,
	ResolvedLanguageSetsType,
	SpokenTimeRendererType,
} from "./types"

const EN_HOUR_WORDS = [
	"twelve",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
]
const EN_UNIT_WORDS = [
	"",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
]
const EN_TENS_WORDS = ["", "", "twenty", "thirty", "forty", "fifty"]

const enMinuteWords = (m: number): string => {
	if (m < 20) return EN_UNIT_WORDS[m]
	const tens = EN_TENS_WORDS[Math.floor(m / 10)]
	const ones = m % 10
	return ones === 0 ? tens : `${tens}-${EN_UNIT_WORDS[ones]}`
}

const enSpokenTime: SpokenTimeRendererType = (d) => {
	const hour = EN_HOUR_WORDS[d.getHours() % 12]
	const minutes = d.getMinutes()
	const period =
		d.getHours() < 12
			? "in the morning"
			: d.getHours() < 18
				? "in the afternoon"
				: "in the evening"
	if (minutes === 0) return `${hour} o'clock ${period}`
	if (minutes < 10) return `${hour} oh ${enMinuteWords(minutes)} ${period}`
	return `${hour} ${enMinuteWords(minutes)} ${period}`
}

const ES_HOUR_WORDS = [
	"doce",
	"una",
	"dos",
	"tres",
	"cuatro",
	"cinco",
	"seis",
	"siete",
	"ocho",
	"nueve",
	"diez",
	"once",
]
const ES_UNIT_WORDS = [
	"",
	"uno",
	"dos",
	"tres",
	"cuatro",
	"cinco",
	"seis",
	"siete",
	"ocho",
	"nueve",
	"diez",
	"once",
	"doce",
	"trece",
	"catorce",
	"quince",
	"dieciséis",
	"diecisiete",
	"dieciocho",
	"diecinueve",
]
const ES_TWENTIES = [
	"veinte",
	"veintiuno",
	"veintidós",
	"veintitrés",
	"veinticuatro",
	"veinticinco",
	"veintiséis",
	"veintisiete",
	"veintiocho",
	"veintinueve",
]
const ES_TENS_WORDS = ["", "", "", "treinta", "cuarenta", "cincuenta"]

const esMinuteWords = (m: number): string => {
	if (m < 20) return ES_UNIT_WORDS[m]
	if (m < 30) return ES_TWENTIES[m - 20]
	const tens = ES_TENS_WORDS[Math.floor(m / 10)]
	const ones = m % 10
	return ones === 0 ? tens : `${tens} y ${ES_UNIT_WORDS[ones]}`
}

const esHourPhrase = (hour24: number): string => {
	const word = ES_HOUR_WORDS[hour24 % 12]
	return hour24 % 12 === 1 ? `la ${word}` : `las ${word}`
}

const esPeriod = (hour24: number): string =>
	hour24 < 12 ? "de la mañana" : hour24 < 20 ? "de la tarde" : "de la noche"

const esSpokenTime: SpokenTimeRendererType = (d) => {
	const hour = d.getHours()
	const minutes = d.getMinutes()
	if (minutes === 0) return `${esHourPhrase(hour)} en punto ${esPeriod(hour)}`
	if (minutes === 15) return `${esHourPhrase(hour)} y cuarto ${esPeriod(hour)}`
	if (minutes === 30) return `${esHourPhrase(hour)} y media ${esPeriod(hour)}`
	if (minutes === 45) {
		const next = (hour + 1) % 24
		return `${esHourPhrase(next)} menos cuarto ${esPeriod(next)}`
	}
	return `${esHourPhrase(hour)} y ${esMinuteWords(minutes)} ${esPeriod(hour)}`
}

const EN: LanguageCatalogType = {
	displayName: "English",
	locale: "en-US",
	latinScript: true,
	spokenTime: enSpokenTime,
	articles: ["the", "my", "our"],
	stopwords: [
		"the",
		"a",
		"an",
		"please",
		"can",
		"could",
		"would",
		"you",
		"my",
		"me",
		"i",
		"to",
		"of",
		"is",
		"it",
		"do",
		"and",
		"for",
		"now",
		"all",
		"that",
		"this",
		"so",
		"but",
		"if",
		"or",
		"not",
		"yes",
		"thanks",
		"thank",
		"ok",
		"okay",
		"just",
		"some",
		"what",
		"how",
		"when",
		"where",
		"why",
		"who",
		"your",
		"we",
		"they",
		"as",
		"by",
		"from",
		"about",
		"right",
		"here",
		"there",
		"with",
		"was",
		"are",
		"be",
		"in",
		"on",
	],
	numberWords: {
		one: 1,
		two: 2,
		three: 3,
		four: 4,
		five: 5,
		six: 6,
		seven: 7,
		eight: 8,
		nine: 9,
		ten: 10,
		eleven: 11,
		twelve: 12,
		thirteen: 13,
		fourteen: 14,
		fifteen: 15,
		sixteen: 16,
		seventeen: 17,
		eighteen: 18,
		nineteen: 19,
		twenty: 20,
		thirty: 30,
		forty: 40,
		fifty: 50,
		sixty: 60,
		seventy: 70,
		eighty: 80,
		ninety: 90,
		hundred: 100,
	},
	numberJoiners: ["and"],
	percentWords: ["percent"],
	questionStarters: [
		"is",
		"are",
		"was",
		"were",
		"do",
		"does",
		"did",
		"can",
		"could",
		"will",
		"would",
		"what",
		"which",
		"who",
		"when",
		"where",
		"why",
		"how",
	],
	requestModals: ["can", "could", "would", "will", "please"],
	conjunctions: ["and", "plus", "also"],
	timerKeywords: ["timer", "alarm"],
	memoryCommandKeywords: ["remember", "memorize", "forget", "don't forget"],
	unitWords: { hour: "hour", minute: "minute", second: "second", plural: "s" },
	affirmations: [
		"yes",
		"yeah",
		"yep",
		"yup",
		"sure",
		"ok",
		"okay",
		"do it",
		"go ahead",
		"confirm",
		"confirmed",
		"please do",
		"affirmative",
		"absolutely",
	],
	negations: [
		"no",
		"nope",
		"nah",
		"don't",
		"do not",
		"stop",
		"cancel",
		"never mind",
		"nevermind",
		"forget it",
		"negative",
	],
	interruptPhrases: [
		"stop",
		"stop it",
		"stop talking",
		"enough",
		"that's enough",
		"be quiet",
		"quiet",
		"shut up",
		"hold on",
		"never mind",
		"nevermind",
		"cancel",
		"hush",
	],
	fastPathBlockers: [
		"don't",
		"do not",
		"didn't",
		"never",
		"won't",
		"wouldn't",
		"did",
		"why",
		"when",
		"who",
		"would",
		"could",
		"can",
		"should",
		"what",
		"how",
		"if",
		"imagine",
		"suppose",
		"said",
		"told",
		"asked",
		"yesterday",
		"tomorrow",
		"later",
		"earlier",
		"already",
	],
	routingBlockers: [
		"don't",
		"do not",
		"didn't",
		"never",
		"won't",
		"said",
		"told",
		"asked",
		"yesterday",
		"earlier",
		"already",
		"imagine",
		"suppose",
		"if",
	],
	phrases: {
		done: "Done.",
		gotIt: "Got it.",
		onIt: "On it.",
		thatIsDone: "That's done.",
		cantDoThat: "I couldn't do that.",
		cantAdjust: "I couldn't adjust that.",
		timerSet: "Timer set for {label}.",
		confirmAction: "Do you want me to go ahead with that?",
		cancelledAction: "Okay, I won't do that.",
		confirmReask: "Sorry, please answer yes or no.",
		confirmExpired:
			"That confirmation expired — tell me again if you still want it.",
		clarifyWhatToDo: "What would you like me to do with {entity}?",
		fallbackLlm: "Sorry, I couldn't think of a reply. Please try again.",
		fallbackStt: "I didn't catch that. Could you say it again?",
		fallbackNetwork: "I had a network problem. One moment, please.",
		fallbackCapacity: "I'm helping another room right now. Give me a moment.",
		fallbackGeneric: "Sorry, something went wrong. Please try again.",
		proactiveReminder: "Reminder: {text}",
		proactiveIdleNudge: "Still there? Let me know if you need anything.",
		proactiveTimeReached: "It's {time}.",
	},
}

const ES: LanguageCatalogType = {
	displayName: "Spanish",
	locale: "es",
	latinScript: true,
	spokenTime: esSpokenTime,
	articles: ["la", "el", "las", "los", "mi", "mis", "una", "un"],
	stopwords: [
		"el",
		"la",
		"los",
		"las",
		"un",
		"una",
		"unos",
		"unas",
		"de",
		"del",
		"al",
		"a",
		"en",
		"y",
		"o",
		"que",
		"por",
		"para",
		"con",
		"sin",
		"me",
		"te",
		"se",
		"lo",
		"le",
		"mi",
		"tu",
		"su",
		"es",
		"esta",
		"este",
		"eso",
		"esa",
		"ese",
		"si",
		"no",
		"ya",
		"ahora",
		"favor",
		"puedes",
		"puede",
		"quiero",
		"gracias",
		"como",
		"cuando",
		"donde",
		"cual",
		"quien",
		"aqui",
		"alli",
		"muy",
		"mas",
	],
	numberWords: {
		un: 1,
		una: 1,
		uno: 1,
		dos: 2,
		tres: 3,
		cuatro: 4,
		cinco: 5,
		seis: 6,
		siete: 7,
		ocho: 8,
		nueve: 9,
		diez: 10,
		once: 11,
		doce: 12,
		trece: 13,
		catorce: 14,
		quince: 15,
		dieciseis: 16,
		diecisiete: 17,
		dieciocho: 18,
		diecinueve: 19,
		veinte: 20,
		veinticinco: 25,
		treinta: 30,
		cuarenta: 40,
		cincuenta: 50,
		sesenta: 60,
		setenta: 70,
		ochenta: 80,
		noventa: 90,
		cien: 100,
	},
	numberJoiners: ["y"],
	percentWords: ["por", "ciento", "porciento"],
	questionStarters: [
		"está",
		"esta",
		"están",
		"estan",
		"es",
		"son",
		"hay",
		"qué",
		"que",
		"cuál",
		"cual",
		"cuáles",
		"cuales",
		"quién",
		"quien",
		"cuándo",
		"cuando",
		"dónde",
		"donde",
		"cómo",
		"como",
		"puedes",
		"podrías",
		"podrias",
	],
	requestModals: ["puedes", "podrías", "podría", "puede", "por favor"],
	conjunctions: ["y", "e", "también", "tambien"],
	timerKeywords: ["temporizador", "alarma", "cronometro"],
	memoryCommandKeywords: [
		"recuerda",
		"recuérdalo",
		"recuerdalo",
		"acuérdate",
		"acuerdate",
		"memoriza",
		"olvida",
		"olvídate",
		"olvidate",
		"no olvides",
	],
	unitWords: { hour: "hora", minute: "minuto", second: "segundo", plural: "s" },
	affirmations: [
		"si",
		"sí",
		"ok",
		"okay",
		"claro",
		"vale",
		"dale",
		"hazlo",
		"adelante",
		"confirmo",
		"confirmado",
		"por favor",
		"correcto",
		"exacto",
	],
	negations: [
		"no",
		"nel",
		"cancela",
		"cancelar",
		"detente",
		"olvidalo",
		"olvídalo",
		"déjalo",
		"dejalo",
		"mejor no",
		"negativo",
	],
	interruptPhrases: [
		"para",
		"para ya",
		"detente",
		"basta",
		"ya basta",
		"suficiente",
		"cállate",
		"callate",
		"silencio",
		"espera",
		"cancela",
		"olvídalo",
		"olvidalo",
		"déjalo",
		"dejalo",
	],
	fastPathBlockers: [
		"no",
		"nunca",
		"jamás",
		"jamas",
		"por qué",
		"por que",
		"cuándo",
		"cuando",
		"quién",
		"quien",
		"podrías",
		"podrias",
		"puedes",
		"debería",
		"deberia",
		"qué",
		"cómo",
		"como",
		"si",
		"imagina",
		"supón",
		"supon",
		"dijo",
		"contó",
		"conto",
		"preguntó",
		"pregunto",
		"ayer",
		"mañana",
		"manana",
		"luego",
		"antes",
		"ya",
	],
	routingBlockers: [
		"no",
		"nunca",
		"jamás",
		"jamas",
		"dije",
		"dijo",
		"dijeron",
		"pidió",
		"pidio",
		"ayer",
		"antes",
		"imagina",
		"supón",
		"supon",
		"si",
	],
	phrases: {
		done: "Listo.",
		gotIt: "Hecho.",
		onIt: "Voy.",
		thatIsDone: "Ya está.",
		cantDoThat: "No pude hacerlo.",
		cantAdjust: "No pude ajustarlo.",
		timerSet: "Temporizador de {label}.",
		confirmAction: "¿Quieres que lo haga?",
		cancelledAction: "De acuerdo, no lo haré.",
		confirmReask: "Perdón, responde sí o no por favor.",
		confirmExpired:
			"Esa confirmación expiró — dímelo de nuevo si aún lo quieres.",
		clarifyWhatToDo: "¿Qué quieres que haga con {entity}?",
		fallbackLlm: "Perdón, no se me ocurrió una respuesta. Inténtalo de nuevo.",
		fallbackStt: "No te escuché bien. ¿Lo repites?",
		fallbackNetwork: "Tuve un problema de red. Un momento, por favor.",
		fallbackCapacity: "Estoy atendiendo otra habitación. Dame un momento.",
		fallbackGeneric: "Perdón, algo salió mal. Inténtalo de nuevo.",
		proactiveReminder: "Recordatorio: {text}",
		proactiveIdleNudge: "¿Sigues ahí? Dime si necesitas algo.",
		proactiveTimeReached: "Son las {time}.",
	},
}

const CATALOGS = new Map<string, LanguageCatalogType>([
	["en", EN],
	["es", ES],
])

const supportedLanguages = new Set(CATALOGS.keys())

export const SUPPORTED_LANGUAGES: ReadonlySet<string> = supportedLanguages

const resolvedCache = new Map<string, ResolvedLanguageSetsType>()

const extensions = new Map<
	string,
	Record<string, LanguageCatalogExtensionType>
>()

export const registerCatalogExtension = (
	kind: string,
	byLanguage: Record<string, LanguageCatalogExtensionType>,
): void => {
	extensions.set(kind, byLanguage)
	resolvedCache.clear()
}

const extensionsFor = (code: string): LanguageCatalogExtensionType[] =>
	[...extensions.values()].flatMap((byLanguage) => {
		const base = byLanguage.en
		const localized = code === "en" ? undefined : byLanguage[code]
		return [base, localized].filter(
			(ext): ext is LanguageCatalogExtensionType => ext !== undefined,
		)
	})

const extensionFor = (
	byLanguage: Record<string, LanguageCatalogExtensionType>,
	code: string,
): LanguageCatalogExtensionType | undefined => byLanguage[code]

const extensionRewrites = (code: string): AnaphoraRewriteType[] =>
	[...extensions.values()].flatMap(
		(byLanguage) =>
			extensionFor(byLanguage, code)?.anaphoraRewrites ??
			extensionFor(byLanguage, "en")?.anaphoraRewrites ??
			[],
	)

const languageCodeOf = (language: string): string =>
	language.trim().toLowerCase().split(/[-_]/)[0]

export const registerLanguageCatalog = (
	language: string,
	catalog: LanguageCatalogType,
): void => {
	const code = languageCodeOf(language)
	CATALOGS.set(code, catalog)
	supportedLanguages.add(code)
	resolvedCache.delete(code)
}

const normalizeLanguage = (language?: string | null): string => {
	const code = languageCodeOf(language ?? "en")
	return CATALOGS.has(code) ? code : "en"
}

const escapeRegex = (s: string): string =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const mergedWithEn = (own: string[], en: string[]): string[] => [
	...new Set([...en, ...own]),
]

const wordBoundaryRe = (words: string[]): RegExp =>
	new RegExp(`\\b(${words.map(escapeRegex).join("|")})\\b`, "i")

const articlePrefixReOf = (articles: string[]): RegExp =>
	new RegExp(
		`^(?:${[...articles]
			.sort((a, b) => b.length - a.length)
			.map(escapeRegex)
			.join("|")}) `,
	)

export const languageSetsFor = (
	language?: string | null,
): ResolvedLanguageSetsType => {
	const code = normalizeLanguage(language)
	const cached = resolvedCache.get(code)
	if (cached) return cached
	const catalog = CATALOGS.get(code) ?? EN
	const contributed = extensionsFor(code)
	const resolved: ResolvedLanguageSetsType = {
		displayName: catalog.displayName,
		locale: catalog.locale,
		latinScript: catalog.latinScript,
		spokenTime: catalog.spokenTime,
		articlePrefixRe: articlePrefixReOf(catalog.articles),
		stopwords: new Set(catalog.stopwords),
		genericWords: new Set(contributed.flatMap((ext) => ext.genericWords ?? [])),
		numberWords: { ...EN.numberWords, ...catalog.numberWords },
		numberJoiners: mergedWithEn(catalog.numberJoiners, EN.numberJoiners),
		percentWords: mergedWithEn(catalog.percentWords, EN.percentWords),
		timerKeywordsRe: wordBoundaryRe(
			mergedWithEn(catalog.timerKeywords, EN.timerKeywords),
		),
		memoryCommandRe: wordBoundaryRe(
			mergedWithEn(catalog.memoryCommandKeywords, EN.memoryCommandKeywords),
		),
		questionStarters: new Set(catalog.questionStarters),
		requestModals: new Set(catalog.requestModals),
		conjunctions: [...catalog.conjunctions],
		unitWords: catalog.unitWords,
		affirmations: new Set(catalog.affirmations),
		negations: new Set(catalog.negations),
		fastPathBlockers: catalog.fastPathBlockers,
		routingBlockers: catalog.routingBlockers,
		interruptPhrases: mergedWithEn(
			catalog.interruptPhrases,
			EN.interruptPhrases,
		),
		anaphoraRewrites: extensionRewrites(code).map((r) => ({
			re: new RegExp(r.pattern, "i"),
			template: r.template,
		})),
		phrases: {
			...EN.phrases,
			...catalog.phrases,
			...contributed.reduce<Record<string, string>>(
				(acc, ext) => ({ ...acc, ...(ext.phrases ?? {}) }),
				{},
			),
		},
	}
	resolvedCache.set(code, resolved)
	return resolved
}
