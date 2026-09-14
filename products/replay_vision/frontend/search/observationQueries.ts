import { combineUrl } from 'kea-router'

import { urls } from 'scenes/urls'

import type { ReplayObservationApi } from '../generated/api.schemas'
import { ReplayScannerTab } from '../replay_scanners/replayScannerSceneLogic'
import { parseCitedSegments } from '../utils/citations'
import { readModelOutput } from '../utils/observation'

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
    const text = (summary || reasoning).replace(/\s+/g, ' ').trim()
    if (!text) {
        return null
    }
    if (text.length <= SIMILAR_QUERY_MAX_CHARS) {
        return text
    }
    const cut = text.slice(0, SIMILAR_QUERY_MAX_CHARS)
    const lastSpace = cut.lastIndexOf(' ')
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()
}

export function crossScannerSearchUrl(q: string): string {
    return combineUrl(urls.replayVision(), { tab: ReplayScannerTab.Search, ...(q.trim() ? { q: q.trim() } : {}) }).url
}

export function similarSearchUrl(observation: ReplayObservationApi): string | null {
    const q = similarSearchQuery(observation)
    return q ? crossScannerSearchUrl(q) : null
}
