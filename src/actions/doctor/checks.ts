import { $ } from 'bun'

export async function checkGithubCli(): Promise<string | null> {
    const res = await $`gh auth status`.quiet()

    if (
        res.exitCode === 0 &&
        // gh on OSX puts output in stdout,gh on linux puts it in stderr
        (res.stdout.includes('Logged in to github.com') || res.stderr.includes('Logged in to github.com'))
    ) {
        return null
    } else {
        return "You need to be logged in to github.com using gh cli. Run 'gh auth login' and follow the instructions."
    }
}

export async function checkKubectl(): Promise<string | null> {
    const res = await $`kubectl version --client --output=json`.quiet()
    if (res.exitCode === 0) {
        return null
    } else {
        return "kubectl is not configured correctly. Please run 'kubectl version --client --output=json' to see what is wrong."
    }
}

export async function checkPatTokenNpm(): Promise<string | null> {
    const res = await $`[ -n "$NPM_AUTH_TOKEN" ] && echo 0 || echo 1`.quiet()
    if (res.exitCode === 0) {
        return null
    } else {
        return 'Unable to find $NPM_AUTH_TOKEN. Have you set up your Github Personal Access Token?'
    }
}

export async function checkPatTokenMvn(): Promise<string | null> {
    if (Bun.env.ORG_GRADLE_PROJECT_githubUser && Bun.env.ORG_GRADLE_PROJECT_githubPassword) {
        return null
    }

    const file = Bun.file(`${Bun.env.HOME}/.gradle/gradle.properties`)
    const exists = await file.exists()
    if (!exists) {
        return 'Unable to find ~/.gradle/gradle.properties. Have you set up your Github Personal Access Token?'
    }

    const content = await file.text()
    if (!content.includes('githubUser=x-access-token')) {
        return 'Unable to find githubUser=x-access-token in ~/.gradle/gradle.properties. Have you set up your Github Personal Access Token?'
    }

    if (!content.includes('githubPassword')) {
        return 'Unable to find githubPassword in ~/.gradle/gradle.properties. Have you set up your Github Personal Access Token?'
    }

    return null
}

export async function defaultExistsCheck(what: string, command: $.ShellPromise): Promise<string | null> {
    const res = await command.quiet()

    if (res.exitCode === 0) {
        return null
    } else {
        return `${what} is not configured correctly. Please run '${command}' to see what is wrong.`
    }
}
