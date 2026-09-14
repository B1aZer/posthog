import { render } from '@testing-library/react'
import { BindLogic } from 'kea'
import { expectLogic } from 'kea-test-utils'

import api from 'lib/api'
import { FEATURE_FLAGS } from 'lib/constants'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'

import { initKeaTests } from '~/test/init'
import { AccessControlLevel } from '~/types'

import { type NotebookType } from '../types'
import { buildMarkdownNotebookContent, serializeMarkdownNotebookComponent } from './markdownNotebookV2'
import { type NotebookLogicProps, notebookLogic } from './notebookLogic'
import { NotebookRunAllButton } from './NotebookRunAllButton'

describe('NotebookRunAllButton', () => {
    const SHORT_ID = 'test-run-all'

    const LOGIC_PROPS: NotebookLogicProps = { shortId: SHORT_ID, mode: 'notebook' }

    const CONTENT = buildMarkdownNotebookContent(
        serializeMarkdownNotebookComponent('SQLV2', {
            nodeId: 'sql-cell-1',
            returnVariable: 'sql_df',
            code: 'select id from events',
        })
    )

    const notebookWith = (userAccessLevel: AccessControlLevel): NotebookType =>
        ({
            id: 'notebook-id',
            short_id: SHORT_ID,
            title: 'Run all',
            content: CONTENT,
            text_content: 'select id from events',
            version: 1,
            deleted: false,
            is_template: false,
            user_access_level: userAccessLevel,
            created_at: '2025-01-01T00:00:00Z',
            created_by: null,
            last_modified_at: '2025-01-01T00:00:00Z',
            last_modified_by: null,
        }) as unknown as NotebookType

    let logic: ReturnType<typeof notebookLogic.build>

    const mountNotebook = async (userAccessLevel: AccessControlLevel): Promise<void> => {
        jest.spyOn(api.notebooks, 'get').mockResolvedValue(notebookWith(userAccessLevel))
        logic = notebookLogic(LOGIC_PROPS)
        logic.mount()
        logic.actions.loadNotebook()
        await expectLogic(logic).toDispatchActions(['loadNotebookSuccess']).toFinishAllListeners()
    }

    const renderButton = (): HTMLElement | null => {
        const { container } = render(
            <BindLogic logic={notebookLogic} props={LOGIC_PROPS}>
                <NotebookRunAllButton />
            </BindLogic>
        )
        return container.querySelector('[data-attr="notebook-run-all"]')
    }

    beforeEach(() => {
        localStorage.clear()
        initKeaTests()
        featureFlagLogic.actions.setFeatureFlags([FEATURE_FLAGS.REVAMPED_PY_NOTEBOOKS], {
            [FEATURE_FLAGS.REVAMPED_PY_NOTEBOOKS]: true,
        })
        jest.spyOn(api.notebooks, 'collabStream').mockResolvedValue(undefined as any)
    })

    afterEach(() => {
        logic?.unmount()
        jest.restoreAllMocks()
    })

    // The run endpoint answers a viewer with a 403, and it plans from the saved document, so a
    // preview would run a version the reader is not looking at.
    it.each([
        ['an editor', AccessControlLevel.Editor, false, true],
        ['a viewer', AccessControlLevel.Viewer, false, false],
        ['an editor previewing an older version', AccessControlLevel.Editor, true, false],
    ] as const)(
        'offers Run all to %s',
        async (_label, userAccessLevel, isPreviewing, expectsControl): Promise<void> => {
            await mountNotebook(userAccessLevel)
            if (isPreviewing) {
                logic.actions.setPreviewContent(CONTENT)
            }

            expect(renderButton() !== null).toBe(expectsControl)
        }
    )

    it('hides Run all on a scratchpad, whose document the server never holds', async () => {
        const scratchpadProps: NotebookLogicProps = { shortId: 'scratchpad', mode: 'notebook' }
        logic = notebookLogic(scratchpadProps)
        logic.mount()
        logic.actions.loadNotebook()
        await expectLogic(logic).toDispatchActions(['loadNotebookSuccess']).toFinishAllListeners()
        // The cells are real, so only the local-only gate can hide the control here.
        logic.actions.setLocalContent(CONTENT)
        await expectLogic(logic).toFinishAllListeners()

        const { container } = render(
            <BindLogic logic={notebookLogic} props={scratchpadProps}>
                <NotebookRunAllButton />
            </BindLogic>
        )

        expect(container.querySelector('[data-attr="notebook-run-all"]')).toBeNull()
    })
})
