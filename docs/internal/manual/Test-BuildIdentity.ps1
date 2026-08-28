<#
.SYNOPSIS
    Checks that the artifacts in this folder are the build the pull request
    names, before any of them is installed or opened.

.DESCRIPTION
    The working rule is that a manual pass runs on the artifact of the pull
    request under review, never on main and never on Nightly, and that About
    inside the application reports the same seven characters as the artifact it
    came from. If the two disagree, the build under test is not the build under
    review and every result below it is worthless.

    About is the check that matters, because it is the running application
    speaking. This script is the half that can be checked before the
    application is started: the artifact names carry the commit, and for the
    web build the commit is baked into the bundle, so it can be read out of the
    file rather than trusted from the file name. A renamed download therefore
    cannot pass.

    It reads. It writes nothing except a temporary folder it removes again.
    There is no network access.

        powershell -ExecutionPolicy Bypass -File Test-BuildIdentity.ps1 -Commit 0000000

.PARAMETER Commit
    The seven characters the pull request names.

.PARAMETER Folder
    Where the downloads are. Defaults to the current user's Downloads folder.

.NOTES
    Windows PowerShell 5.1 and PowerShell 7 both run this.
#>

# ASCII ONLY. Windows PowerShell 5.1 reads a `.ps1` with no byte-order mark as
# ANSI; an em dash then decodes to a character its tokenizer treats as a string
# delimiter, and the file fails to parse with an error pointing nowhere near
# the cause. Measured once already, on Test-104.ps1. Do not put a dash, an
# arrow or a quotation mark back into this file.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{7}$')]
    [string] $Commit,

    [string] $Folder = (Join-Path $env:USERPROFILE 'Downloads')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-Pass { param([string] $Text) Write-Host "  PASS  $Text" -ForegroundColor Green }
function Write-Fail { param([string] $Text) Write-Host "  FAIL  $Text" -ForegroundColor Red }
function Write-Note { param([string] $Text) Write-Host "        $Text" -ForegroundColor DarkGray }

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "No such folder: $Folder" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "Checking the artifacts in $Folder against $Commit" -ForegroundColor Cyan
Write-Host ''

$failed = 0

# -- The names ----------------------------------------------------------------
#
# Both artifacts are downloaded from the run as a zip named after the artifact.
# The name is the cheapest of the three places the commit appears, and the
# easiest to get wrong by downloading from the wrong run.

$expected = @(
    "AgentEd-windows-$Commit",
    "AgentEd-web-$Commit"
)

foreach ($name in $expected) {
    $zip = Join-Path $Folder "$name.zip"
    $dir = Join-Path $Folder $name
    if (Test-Path -LiteralPath $zip) {
        Write-Pass "$name.zip is here"
    }
    elseif (Test-Path -LiteralPath $dir) {
        Write-Pass "$name is here, already extracted"
    }
    else {
        Write-Fail "$name is not in this folder"
        Write-Note 'download it from this pull request run, not from main and not from Nightly'
        # Name what is here instead, because the usual mistake is a download
        # from the right repository and the wrong run, which looks identical
        # in the browser and differs only in these seven characters.
        $others = Get-ChildItem -LiteralPath $Folder -Filter 'AgentEd-*' -ErrorAction SilentlyContinue
        if ($others) {
            Write-Note 'what is here instead:'
            foreach ($o in $others) { Write-Note "    $($o.Name)" }
        }
        $failed++
    }
}

# -- The web bundle, read rather than trusted ---------------------------------
#
# `vite.config.ts` bakes the commit into the bundle as `__BUILD_COMMIT__`, and
# About reads it from there. So the built JavaScript carries the same string
# About will show, and a zip renamed by hand fails here even though it passed
# the name check above.

$webZip = Join-Path $Folder "AgentEd-web-$Commit.zip"
$webDir = Join-Path $Folder "AgentEd-web-$Commit"
$temp = $null

try {
    $source = $null
    if (Test-Path -LiteralPath $webDir) {
        $source = $webDir
    }
    elseif (Test-Path -LiteralPath $webZip) {
        $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("agented-" + [System.Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp | Out-Null
        Expand-Archive -LiteralPath $webZip -DestinationPath $temp -Force
        $source = $temp
    }

    if ($source) {
        $assets = Get-ChildItem -LiteralPath $source -Recurse -Include '*.js', '*.html' -ErrorAction SilentlyContinue
        if (-not $assets) {
            Write-Fail 'the web artifact holds no .js or .html at all -- that is not a web build'
            $failed++
        }
        else {
            $hit = $assets | Select-String -SimpleMatch -Pattern $Commit -List | Select-Object -First 1
            if ($hit) {
                Write-Pass "the web bundle itself carries $Commit (in $($hit.Filename))"
                Write-Note "About must show the same seven characters: $Commit"
            }
            else {
                Write-Fail "the web bundle does not contain $Commit anywhere"
                Write-Note 'the zip is named for one build and holds another, or it was renamed by hand'
                $failed++
            }
        }
    }
}
finally {
    if ($temp -and (Test-Path -LiteralPath $temp)) {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# -- What is left for a person ------------------------------------------------

Write-Host ''
if ($failed -eq 0) {
    Write-Host 'The artifacts here are the build the pull request names.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'One thing this script cannot check: the Windows installer.' -ForegroundColor Cyan
    Write-Host 'Its commit is only readable from the running application, so install it'
    Write-Host "and confirm About reports $Commit. About is under the hamburger menu."
    Write-Host ''
    exit 0
}

Write-Host "$failed check(s) failed. Do not run the manual pass on this folder." -ForegroundColor Red
Write-Host ''
exit 1
