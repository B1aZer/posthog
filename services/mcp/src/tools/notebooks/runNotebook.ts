import { z } from 'zod'

import type { Schemas } from '@/api/generated'
import { getPostHogClient } from '@/lib/posthog'
import type { Context, ToolBase } from '@/tools/types'

import { wrapRunResultAsInformational } from './cellRuns'
import { parseCellTags } from './cellTags'
import { fetchMarkdownNotebook, notebookPathFor } from './markdownDoc'
import { awaitNotebookRun, type NotebookRunOutcome } from './notebookRuns'
import { NOTEBOOK_SHORT_ID_DESCRIPTION, notebookIdAliases } from './notebookId'
import {
    assertNoDataframeNameCollision,
    MAX_NOTEBOOK_VARIABLES,
    NotebookVariableSchema,
} from './notebookVariableSchema'

const RunNotebookInputSchema = z
    .object({
        notebook_id: z.string().describe(NOTEBOOK_SHORT_ID_DESCRIPTION),
        variables: z
            .array(NotebookVariableSchema)
            .max(MAX_NOTEBOOK_VARIABLES)
            .optional()
            .describe(
                `Set the notebook's variables before the run, in one call. This replaces the whole list, so include every variable you want to keep, and the notebook stores what you pass. Omit it to run with the variables already saved. At most ${MAX_NOTEBOOK_VARIABLES}.`
            ),
        wait: z
            .boolean()
            .optional()
            .default(true)
            .describe(
                'Wait for the run and write each result into the document as it lands. Set false to start the run and return immediately, then follow with notebooks-run-status.'
            ),
    })
    .strict()

export const NotebooksRunSchema = z.preprocess(notebookIdAliases('notebook_id'), RunNotebookInputSchema)

export const runNotebookHandler: ToolBase<typeof NotebooksRunSchema, NotebookRunOutcome>['handler'] = async (
    context: Context,
    params: z.infer<typeof NotebooksRunSchema>
) => {
    const projectId = await context.stateManager.getProjectId()
    const notebookPath = notebookPathFor(projectId, params.notebook_id)

    if (params.variables?.length) {
        // The run saves these variables and then binds them, so the collision has to be caught
        // before the start: every cell reports done and the numbers are quietly wrong.
        const { markdown } = await fetchMarkdownNotebook(context, params.notebook_id)
        assertNoDataframeNameCollision(params.variables, parseCellTags(markdown))
    }

    const started = await context.api.request<Schemas.NotebookRunStartResponse>({
        method: 'POST',
        path: `${notebookPath}runs/`,
        body: params.variables ? { variables: params.variables } : {},
    })
    const disclosure = {
        starts_sandbox: started.starts_sandbox,
        sandbox_hourly_price: started.sandbox_hourly_price ?? null,
    }

    if (params.wait === false) {
        return wrapRunResultAsInformational({
            run_id: started.run_id,
            status: 'running',
            cell_count: started.cell_count,
            completed_count: 0,
            cells: [],
            ...disclosure,
            hint: 'The notebook is running. Call notebooks-run-status with this run_id to read the results and write them into the document.',
        })
    }

    try {
        const outcome = await awaitNotebookRun(context, params.notebook_id, notebookPath, started.run_id)
        return wrapRunResultAsInformational({ ...outcome, ...disclosure })
    } catch (error) {
        // The run has started and holds the notebook, so a second start answers 409 and no
        // endpoint lists the run in flight. Throwing here would take the only handle for it
        // with it, leaving the agent to wait out the run timeout.
        captureWaitFailure(error)
        return wrapRunResultAsInformational({
            run_id: started.run_id,
            status: 'running',
            cell_count: started.cell_count,
            completed_count: 0,
            cells: [],
            ...disclosure,
            wait_error: error instanceof Error ? error.message : String(error),
            hint: 'Waiting on the run failed, but the run is still going. Call notebooks-run-status with this run_id to keep waiting and to write the results into the document.',
        })
    }
}

/** The soft return bypasses `handleToolError`, the path that normally reports a failure. */
function captureWaitFailure(error: unknown): void {
    try {
        getPostHogClient().captureException(error, undefined, { tag: 'mcp', tool: 'notebooks-run' })
    } catch {
        // Observability must never break the request.
    }
}

const tool = (): ToolBase<typeof NotebooksRunSchema, NotebookRunOutcome> => ({
    name: 'notebooks-run',
    schema: NotebooksRunSchema,
    handler: runNotebookHandler,
})

export default tool
