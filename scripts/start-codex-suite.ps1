[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CodexArguments
)

$mobileRepository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repositoryParent = Split-Path $mobileRepository -Parent
$additionalRepositories = @(
    (Join-Path $repositoryParent 'whatz-it-landing-page'),
    (Join-Path $repositoryParent 'whatz-it-deck-platform')
)

foreach ($repository in $additionalRepositories) {
    if (-not (Test-Path -LiteralPath (Join-Path $repository '.git'))) {
        throw "Required sibling Git repository not found: $repository"
    }
}

$codexCommand = Get-Command codex.cmd -CommandType Application -ErrorAction SilentlyContinue
if (-not $codexCommand) {
    $codexCommand = Get-Command codex -CommandType Application, ExternalScript -ErrorAction Stop |
        Select-Object -First 1
}

$codexOptions = @('-C', $mobileRepository)
foreach ($repository in $additionalRepositories) {
    $codexOptions += @('--add-dir', $repository)
}

& $codexCommand.Source @codexOptions @CodexArguments
