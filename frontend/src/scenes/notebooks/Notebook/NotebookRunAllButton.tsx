import { useActions, useValues } from 'kea'

import { IconPlay, IconStopFilled } from '@posthog/icons'
import { LemonButton, LemonButtonProps } from '@posthog/lemon-ui'

import { featureFlagLogic } from 'lib/logic/featureFlagLogic'

import { hasRunnableV2Nodes } from '../Nodes/notebookNodeContent'
import { isKernelUiEnabled } from '../utils'
import { isMarkdownNotebookContent } from './markdownNotebookV2'
import { notebookLogic } from './notebookLogic'
import { notebookRunLogic } from './notebookRunLogic'

/**
 * Runs every SQL and Python cell of the open notebook, in document order. While a run is
 * active the same button stops it, so the toolbar keeps one slot for the whole action.
 */
export const NotebookRunAllButton = (
    props: Pick<LemonButtonProps, 'children' | 'size' | 'type'>
): JSX.Element | null => {
    const { featureFlags } = useValues(featureFlagLogic)
    const { content, shortId, isShared, canEditNotebook } = useValues(notebookLogic)
    const { isRunning, isStarting, isInterrupting, progressLabel } = useValues(notebookRunLogic({ shortId }))
    const { startRun, interruptRun } = useActions(notebookRunLogic({ shortId }))

    // The run endpoint requires editor access on the notebook, so the control goes only to a reader
    // it will answer for. That excludes a public share and a viewer-level reader, who both get a
    // 403 from the click. It also excludes a history preview, because the run plans from the saved
    // document and would run a version the reader is not looking at.
    const canRun = !isShared && canEditNotebook

    // Only a markdown notebook with something to run gets the button at all.
    if (
        !canRun ||
        !isKernelUiEnabled(featureFlags) ||
        !isMarkdownNotebookContent(content) ||
        !hasRunnableV2Nodes(content)
    ) {
        return null
    }

    if (isRunning) {
        return (
            <LemonButton
                {...props}
                onClick={() => interruptRun()}
                icon={<IconStopFilled />}
                loading={isInterrupting}
                disabledReason={isInterrupting ? 'Stopping the run' : undefined}
                tooltip={progressLabel ?? 'Stop the run'}
                data-attr="notebook-run-all-stop"
            >
                Stop
            </LemonButton>
        )
    }

    return (
        <LemonButton
            {...props}
            onClick={() => startRun()}
            icon={<IconPlay />}
            loading={isStarting}
            disabledReason={isStarting ? 'Starting the run' : undefined}
            tooltip="Run every SQL and Python cell in order, stopping at the first one that fails"
            data-attr="notebook-run-all"
        >
            Run all
        </LemonButton>
    )
}
