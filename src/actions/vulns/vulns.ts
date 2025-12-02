import * as R from 'remeda'
import chalk from 'chalk'

import { BaseRepoNode, ghGqlQuery, OrgTeamRepoResult } from '../../common/octokit.ts'
import { getTeam } from '../../common/config.ts'
import { log } from '../../common/log.ts'

const allVulnerabilitiesForTeamQuery = /* GraphQL */ `
    query OurRepos($team: String!) {
        organization(login: "navikt") {
            team(slug: $team) {
                repositories(orderBy: { field: PUSHED_AT, direction: DESC }) {
                    nodes {
                        name
                        isArchived
                        pushedAt
                        url
                        vulnerabilityAlerts(states: OPEN, first: 10) {
                            nodes {
                                state
                                createdAt
                                number
                                securityVulnerability {
                                    vulnerableVersionRange
                                    severity
                                    package {
                                        ecosystem
                                        name
                                    }
                                    firstPatchedVersion {
                                        identifier
                                    }
                                    advisory {
                                        description
                                        id
                                        permalink
                                        identifiers {
                                            type
                                            value
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
`

export interface RepoNodeVulns {
    vulnerabilityAlerts: {
        nodes: {
            state: string
            createdAt: string
            number: number
            securityVulnerability: {
                vulnerableVersionRange: string
                severity: string
                package: {
                    ecosystem: string
                    name: string
                }
                firstPatchedVersion: {
                    identifier: string | null
                } | null
                advisory: {
                    description: string
                    id: string
                    permalink: string
                    identifiers: {
                        type: string
                        value: string
                    }[]
                }
            } | null
        }[]
    }
}

export async function getAllVulns(levels: string[]): Promise<void> {
    const team = await getTeam()
    const result = await ghGqlQuery<OrgTeamRepoResult<RepoNodeVulns>>(allVulnerabilitiesForTeamQuery, { team: team })
    const vulnsByLevel = await getVulnerabilities(result.organization.team.repositories.nodes, levels)

    for (const [level, repos] of Object.entries(vulnsByLevel)) {
        log(chalk.blue(`\n=== ${level} VULNERABILITIES ===`))
        for (const [repoName, vulns] of Object.entries(repos)) {
            log(chalk.yellow(`\nRepository: ${repoName}`))
            for (const vulnInfo of vulns) {
                const vuln = vulnInfo.vulnerability
                const sv = vuln.securityVulnerability

                const pkg = sv?.package.name ?? 'unknown package'
                const range = sv?.vulnerableVersionRange ?? 'unknown range'
                const firstPatched = sv?.firstPatchedVersion?.identifier ?? 'N/A'

                const alertUrl = `${vulnInfo.url}/security/advisories/${vuln.number}`
                const cveId = sv?.advisory?.identifiers?.find((id: { type: string }) => id.type === 'CVE')?.value
                const cveUrl = cveId ? `https://nvd.nist.gov/vuln/detail/${cveId}` : undefined

                log(chalk.bold(`${pkg}`))
                log(`  ${chalk.yellow('Vulnerability #')}${chalk.yellow(vuln.number)}`)
                log(`  ${chalk.red('Affected range:')} ${range}`)
                log(`  ${chalk.green('First patched version:')} ${firstPatched}`)

                if (cveUrl) {
                    log(`  ${chalk.cyan('CVE:')} ${cveUrl}`)
                } else if (cveId) {
                    log(`  ${chalk.cyan('CVE:')} ${cveId}`)
                }

                log(`  ${chalk.cyan('Repo security alert:')} ${alertUrl}`)
            }
        }
    }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function getVulnerabilities(nodes: BaseRepoNode<RepoNodeVulns>[], levels: string[]) {
    return R.pipe(
        nodes,
        R.filter((it) => !it.isArchived),
        R.filter((it) => it.vulnerabilityAlerts.nodes.length > 0),
        R.flatMap((repo) =>
            repo.vulnerabilityAlerts.nodes.map((alert) => ({
                name: repo.name,
                url: repo.url,
                vulnerability: alert,
            })),
        ),
        R.filter((it) => levels.includes(it.vulnerability.securityVulnerability?.severity ?? '')),
        R.groupBy((it) => it.vulnerability.securityVulnerability?.severity),
        R.mapValues((it) => R.groupBy(it, (it) => it.name)),
    )
}
