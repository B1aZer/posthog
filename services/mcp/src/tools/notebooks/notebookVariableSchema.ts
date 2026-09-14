import { z } from 'zod'

import { type CellTagBlock, DATAFRAME_NAME_REGEX } from './cellTags'

/** Mirrors MAX_VARIABLES_PER_NOTEBOOK in sql_v2_serializers.py, so the schema stops at the server's limit. */
export const MAX_NOTEBOOK_VARIABLES = 10

/** One notebook variable, as both notebooks-set-variables and notebooks-run accept it. */
export const NotebookVariableSchema = z
    .object({
        name: z
            .string()
            .regex(DATAFRAME_NAME_REGEX)
            .describe(
                "Identifier cells read: `{name}` in a SQL cell, a plain global in a Python cell. Letters, numbers, and underscores; must not start with a number, repeat another variable, or reuse a cell's dataframe_name."
            ),
        type: z
            .enum(['string', 'number', 'boolean', 'date'])
            .describe(
                "How the value binds: 'string', 'number', 'boolean', or 'date'. A 'date' is an absolute ISO 8601 date or datetime ('2025-01-31', '2025-01-31T09:00:00Z'); relative expressions like '-7d' are rejected, so compute the date first."
            ),
        value: z
            .union([z.string(), z.number(), z.boolean(), z.null()])
            .optional()
            .describe('The current value. Omit or pass null for a declared-but-unset variable.'),
    })
    .strict()

export type NotebookVariableInput = z.infer<typeof NotebookVariableSchema>

/**
 * A Python cell reads variables and cell dataframes out of one kernel namespace, so a shared
 * name means one silently clobbers the other. The server stores such a declaration; the editor
 * refuses it, and so does every tool that writes one.
 */
export function assertNoDataframeNameCollision(variables: NotebookVariableInput[], cells: CellTagBlock[]): void {
    const dataframeNames = new Set(cells.map((cell) => cell.returnVariable).filter(Boolean))
    const conflicts = variables.map((variable) => variable.name).filter((name) => dataframeNames.has(name))
    if (conflicts.length) {
        throw new Error(
            `${conflicts.join(', ')} ${conflicts.length === 1 ? 'is' : 'are'} already a cell's dataframe_name. Pick another variable name or rename the cell.`
        )
    }
}
