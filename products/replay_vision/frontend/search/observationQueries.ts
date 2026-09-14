import { combineUrl } from 'kea-router'

import { urls } from 'scenes/urls'

import type { ReplayObservationApi } from '../generated/api.schemas'
import { ReplayScannerTab } from '../replay_scanners/replayScannerSceneLogic'
import { parseCitedSegments } from '../utils/citations'
import { readModelOutput, readTitle } from '../utils/observation'

// Long enough to carry the gist of a summary, short enough to read back in the search box.
const SIMILAR_QUERY_MAX_CHARS = 300

export function firstCitedTimestampMs(observation: ReplayObservationApi): number | null {
    const result = readModelOutput(observation)
    if (!result) {
        return null
    }
    for (const [textKey, segmentsKey] of [
        ['summary', 'summary_segments'],
        ['reasoning', 'reasoning_segments'],
    ] as const) {
        const text = result[textKey]
        if (typeof text !== 'string') {
            continue
        }
        const chip = parseCitedSegments(text, result[segmentsKey]).find((segment) => segment.kind === 'chip')
        if (chip && chip.kind === 'chip' && chip.timestamp_ms >= 0) {
            return chip.timestamp_ms
        }
    }
    return null
}

export function watchMomentUrl(observation: ReplayObservationApi): string {
    const timestampMs = firstCitedTimestampMs(observation)
    return urls.replaySingle(
        observation.session_id,
        timestampMs ? { secondsOffsetFromStart: Math.floor(timestampMs / 1000) } : undefined
    )
}

function uncitedText(text: string, segments: unknown): string {
    return parseCitedSegments(text, segments)
        .map((segment) => (segment.kind === 'text' ? segment.value : ' '))
        .join('')
}

export function similarSearchQuery(observation: ReplayObservationApi): string | null {
    const result = readModelOutput(observation)
    if (!result) {
        return null
    }
    // Timestamps are noise to an embedding, so only the prose between citations is kept.
    const summary = typeof result.summary === 'string' ? uncitedText(result.summary, result.summary_segments) : ''
    const reasoning =
        typeof result.reasoning === 'string' ? uncitedText(result.reasoning, result.reasoning_segments) : ''
    // The summarizer indexes its title with the summary, so the query carries the same framing.
    const text = [readTitle(observation) ?? '', summary || reasoning].join(' ').replace(/\s+/g, ' ').trim()
    if (!text) {
        return null
    }
    if (text.length <= SIMILAR_QUERY_MAX_CHARS) {
        return text
    }
    const cut = text.slice(0, SIMILAR_QUERY_MAX_CHARS)
    const lastSpace = cut.lastIndexOf(' ')
    // Spaceless prose cuts mid-string, where a split surrogate pair would make encodeURIComponent throw.
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.replace(/[\uD800-\uDBFF]$/, '')).trim()
}

export function crossScannerSearchUrl(q: string): string {
    return combineUrl(urls.replayVision(), { tab: ReplayScannerTab.Search, ...(q.trim() ? { q: q.trim() } : {}) }).url
}

const SIMILAR_SEARCH_INTENT_KEY = 'replay-vision.similar-search-intent'

export interface SimilarSearchIntent {
    query: string
    /** Dropped from the results: the source text is its own nearest neighbour and would anchor the top tier. */
    sourceObservationId: string
}

/** The "Find similar" link target, or null when the observation has no prose to search with. The query travels
 * through markSimilarSearchIntent rather than the URL: it is model output about a recording and can carry
 * customer names or emails, which must stay out of autocapture's $current_url, our own replay of our app, and
 * browser history. Same channel as replay_scanners/goalDraftIntent.ts. */
export function similarSearchUrl(observation: ReplayObservationApi): string | null {
    return similarSearchQuery(observation) ? crossScannerSearchUrl('') : null
}

/** Call from the link's onClick, so the hub picks the intent up when it lands. */
export function markSimilarSearchIntent(observation: ReplayObservationApi): void {
    const query = similarSearchQuery(observation)
    if (!query) {
        return
    }
    try {
        sessionStorage.setItem(
            SIMILAR_SEARCH_INTENT_KEY,
            JSON.stringify({ query, sourceObservationId: observation.id } satisfies SimilarSearchIntent)
        )
    } catch {
        // Storage can be unavailable (private mode); the hub then opens on its empty state.
    }
}

/** Reads and clears the hand-off, so it can never fire on a later, unrelated visit to the search tab. */
export function consumeSimilarSearchIntent(): SimilarSearchIntent | null {
    try {
        const raw = sessionStorage.getItem(SIMILAR_SEARCH_INTENT_KEY)
        sessionStorage.removeItem(SIMILAR_SEARCH_INTENT_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return typeof parsed?.query === 'string' && typeof parsed?.sourceObservationId === 'string' ? parsed : null
    } catch {
        return null
    }
}
