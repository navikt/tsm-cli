# teamsykmelding-cli

En liten verktøykasse for #team-sykmelding

## Kom i gang

### Oppsett

- Du må ha [Node.js](https://nodejs.org/en/) installert, husk å bruk verktøy som nvm, mise eller
  asdf for å håndtere versjoner.
- Du må ha [bun.sh](https://bun.sh) installert, dette kan installeres med curl
  (`curl -fsSL https://bun.sh/install | bash`)

#### Node med mise

Om du installerte node med mise må du køyre desse kommandoane i kommandolinja for å aktivere det.

```
echo 'eval "$(mise activate zsh --shims)"' >> ~/.zprofile # this sets up non-interactive sessions
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc    # this sets up interactive sessionseval "$(mise activate zsh)"
```

### Konfigurasjon

Du må ha en `.npmrc` fil på root i home-mappen din med følgende innhold:

```
@navikt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NPM_AUTH_TOKEN}
```

### Tilgang

Du må ha en PAT (Personal Access Token) for å kunne laste ned pakker fra Github Package Registry.
Denne kan du lage [her](https://github.com/settings/tokens). Du må gi den `read:packages` scope,
bruk PAT typen "classic"

Legg til denne i din `~/.bashrc` eller `~/.zshrc` fil:

```bash
export NPM_AUTH_TOKEN=<din token>
export ORG_GRADLE_PROJECT_githubPassword=<din token>
export ORG_GRADLE_PROJECT_githubUser=x-access-token
```

### Installer CLI

```bash
npm i -g @navikt/teamsykmelding-cli
```

Nå er du klar til å bruke `tsm`!

### Autocompletion

`tsm` kan generere et completion-script for shellet ditt, slik at du får forslag på kommandoer,
subkommandoer og flagg når du trykker `<TAB>`. Scriptet genereres for shellet i `$SHELL`.

#### Zsh

Legg scriptet som en autoload-funksjon i en mappe som ligger i `$fpath` – filen _må_ hete `_tsm`:

```bash
mkdir -p ~/.zsh/completions
tsm completion > ~/.zsh/completions/_tsm
```

Har du ikke den mappa i `$fpath` fra før, legg dette i `~/.zshrc` _før_ `compinit` kjøres:

```bash
fpath=(~/.zsh/completions $fpath)
```

Bruker du oh-my-zsh kan du droppe `fpath`-linja og heller skrive rett til
`~/.oh-my-zsh/completions/_tsm`, og med Homebrew til
`$(brew --prefix)/share/zsh/site-functions/_tsm`. Begge ligger allerede i `$fpath`.

#### Bash

Med `bash-completion` installert lastes completions automatisk fra navnet på kommandoen:

```bash
mkdir -p ~/.local/share/bash-completion/completions
tsm completion > ~/.local/share/bash-completion/completions/tsm
```

Start et nytt shell, så virker det:

```bash
tsm gr<TAB>                   # -> tsm gradle
tsm gradle <TAB>              # -> tsm-input
tsm gradle tsm-input --<TAB>  # -> --update
```

### Automatisk generert dokumentasjon

<!-- COMPUTER SAYS DON'T TOUCH THIS START -->

* `doctor` - check that all tooling and such looks OK
* `auth` - login to gcloud
* `commits` - get the last commits for every repo in the team
* `prs` - get all open pull requests
* `repos` - get all repos
* `vulns` - get all vulnerabilities for the team (Github)
* `builds` - checks all repos for failing builds (on main)
* `git` - keep our repos in sync, ex: tsm git sync
* `work` - see what has happened the last week (or more)
* `team` - get all team members
* `sync-file` - sync a file across specified repos
* `sync-cmd` - execute a command across multiple repos and stage and commit the changes
* `sync-replace` - search and replace or delete text blocks across all repos
* `primary-branch` - get misc repo metadata
* `mob` - make a mob commit
* `config` - set config for tsm
* `upgrade` - update the cli
* `changelog` - get the latest changes in tsm cli
* `analytics` - get your own usage stats for tsm cli
* `open` - open command that opens a project in IntelliJ IDEA
* `web` - open web page
* `gh` - open github repo in browser
* `search` - search github repos for a given regex
* `kafka` - kafka cli for kafka stuff
* `ktor` - find repos with no.nav.tsm:ktor in settings.gradle.kts
* `gradle` - gradle stuff
* `docker` - docker stuff
* `completion` - print the shell completion script, see the README for how to enable it

<!-- COMPUTER SAYS DON'T TOUCH THIS END -->

Du kan også bruke `tsmx` for å interaktivt bytte mellom team, dersom du har satt opp flere team med
`tsm config --team=<team>`.

### Eksempler på bruk:

#### Sjekk at du har satt opp alle verktøy riktig

```bash
tsm doctor
```

#### Alle åpne pull requester i våre repos, inkludert drafts

```bash
tsm prs --drafts
```

#### Se alle statuser på bygg i alle repos

```bash
tsm builds
```

#### Hent alle nyeste commits i alle repos

```bash
tsm commits
```

#### Hent de 10 reposene som er lengst siden oppdatert

```bash
tsm commits --order=asc --limit=10
```

#### Finn alle repos som bruker yarn

```bash
tsm repos --query='cat .yarnrc.yml'
```

### Utvikling

Dette kommandolinje-verktøyet er skrevet i TypeScript og bruker bun.sh. For å kjøre det må du først
bygge det:

```bash
bun install
```

Deretter kan du kjøre det med:

```bash
bun run src/index.ts
```
