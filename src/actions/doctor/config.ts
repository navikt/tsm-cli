/**
 * Tools are expected _not_ to be installed with brew. Does not check if the tool is installed, only fails if found with brew.
 */
export const Config = ['java', 'npm', 'yarn', 'node']

/**
 * Baseline CLIs that are expected to be on PATH
 */
export const REQUIRED_CLIS = ['gh', 'kubectl', 'nais', 'gcloud', 'mise'] as const

/**
 * CLIs and additional actions that are expected to have dedicated checks
 */
export const REQUIRED_ACTIONS = [...REQUIRED_CLIS, 'PAT token (npm)'] as const
