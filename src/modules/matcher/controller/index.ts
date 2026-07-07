import {
	type SkillToolType,
	MATCHER_ENGINE_ENUM,
	DEFAULT_MATCHER_ENGINE,
	DEFAULT_MATCHER_SEMANTIC_THRESHOLD,
	DEFAULT_MATCHER_RRF_K,
	DEFAULT_MATCHER_CASCADE_EXIT,
} from "@/db"
import type { DomiaType } from "@/modules/core"
import { languageSetsFor } from "@/utils"

import { lexicalMatcherEngine } from "../engines/lexical"
import { semanticRank } from "../engines/semantic"
import { rrfFuse } from "../utils/rrf"
import type {
	MatcherConfigType,
	MatcherRankOptionsType,
	ScoredToolType,
} from "../types"

const resolveMatcherConfig = (domia: DomiaType): MatcherConfigType => {
	const c = domia.llmModelConfig
	return {
		engine: c?.matcherEngine ?? DEFAULT_MATCHER_ENGINE,
		semanticThreshold:
			c?.matcherSemanticThreshold ?? DEFAULT_MATCHER_SEMANTIC_THRESHOLD,
		rrfK: c?.matcherRrfK ?? DEFAULT_MATCHER_RRF_K,
		cascadeExit: c?.matcherCascadeExit ?? DEFAULT_MATCHER_CASCADE_EXIT,
	}
}

const maxScoreOf = (ranked: ScoredToolType[]): number =>
	ranked.length ? ranked[0].score : 0

const hybridRank = async (
	domia: DomiaType,
	utterance: string,
	tools: SkillToolType[],
	opts: MatcherRankOptionsType,
	cfg: MatcherConfigType,
): Promise<ScoredToolType[]> => {
	const lexical = await lexicalMatcherEngine.rank(utterance, tools, opts)
	if (maxScoreOf(lexical) >= cfg.cascadeExit) return lexical
	const semantic = await semanticRank(
		domia,
		utterance,
		tools,
		cfg.semanticThreshold,
	)
	if (maxScoreOf(lexical) <= 0 && maxScoreOf(semantic) <= 0) return lexical
	return rrfFuse(tools, [lexical, semantic], cfg.rrfK)
}

export const rankTools = async (
	domia: DomiaType,
	utterance: string,
	tools: SkillToolType[],
	opts: MatcherRankOptionsType = {},
): Promise<ScoredToolType[]> => {
	const cfg = resolveMatcherConfig(domia)
	if (!opts.stopwords)
		opts = {
			...opts,
			stopwords: languageSetsFor(domia.characterProfile?.language).stopwords,
		}
	if (cfg.engine === MATCHER_ENGINE_ENUM.SEMANTIC)
		return semanticRank(domia, utterance, tools, cfg.semanticThreshold)
	if (cfg.engine === MATCHER_ENGINE_ENUM.HYBRID)
		return hybridRank(domia, utterance, tools, opts, cfg)
	return lexicalMatcherEngine.rank(utterance, tools, opts)
}
