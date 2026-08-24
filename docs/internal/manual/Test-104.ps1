<#
.SYNOPSIS
    Checks the #104 manual fixtures before and after an unedited save in AgentEd.

.DESCRIPTION
    The three fixtures beside this script are bytes, not pixels: what a correct
    save does to each of them was measured through the real save assembly at the
    branch under test, and the sizes and SHA-256 digests below are those
    measurements. This script does the comparing, so the manual step is a run
    with a verdict rather than an eyeball over a text file.

    It reads. The only things it writes are a `.before` copy of each fixture and
    a small state file, both in the same folder, both only so that the After
    stage can say what moved.

    Run it in two stages, with AgentEd in between:

        powershell -ExecutionPolicy Bypass -File Test-104.ps1 -Stage Before
        ... open each file in AgentEd, change nothing, press Ctrl+S, close ...
        powershell -ExecutionPolicy Bypass -File Test-104.ps1 -Stage After

.PARAMETER Stage
    Before — check the downloaded fixtures are the right bytes, and record them.
    After  — check what the save wrote, and name what a wrong result means.

.PARAMETER Folder
    Where the fixtures are. Defaults to the current user's Downloads folder.

.NOTES
    Windows PowerShell 5.1 and PowerShell 7 both run this. No network, no
    modules, nothing installed.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Before', 'After')]
    [string] $Stage,

    [string] $Folder = (Join-Path $env:USERPROFILE 'Downloads')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ── What each fixture is, and what a save is allowed to do to it ─────────────
#
# `AfterSize` / `AfterHash` are the branch under test. `StaleSize` /
# `StaleHash` are what the build before the fix writes — carried so that a
# failure can say *the wrong build is installed* instead of only *this
# differs*, which is the most common way a manual check goes wrong here.

$FIXTURES = @(
    [pscustomobject]@{
        Name       = '104-blockquote.md'
        Size       = 445
        Hash       = 'A402CF4FDC75D9FE64195EF7710B3E7F3999CB985292AE81A3D18D7F92834A92'
        AfterSize  = 445
        AfterHash  = 'A402CF4FDC75D9FE64195EF7710B3E7F3999CB985292AE81A3D18D7F92834A92'
        StaleSize  = 417
        StaleHash  = '354F513AFB1A5B1C267B26B053F044B86533D378DBF30EF5DA605D3D780D411C'
        Expect     = 'must not change at all — 445 bytes, same digest'
        Note       = ''
        Stale      = 'both quoted boxes were dropped from the file'
    },
    [pscustomobject]@{
        Name       = '104-list-item.md'
        Size       = 405
        Hash       = 'BCF5823E12D3F4998AE2D6ED46E83F7EC69D7A31EB5D429D627DBEEDE243D160'
        AfterSize  = 397
        AfterHash  = '88C72999608F79D2765D299E0523A8F6F7062B1B2E3522B9AD6854B3A5D6C20E'
        StaleSize  = 397
        StaleHash  = '88C72999608F79D2765D299E0523A8F6F7062B1B2E3522B9AD6854B3A5D6C20E'
        Expect     = 'must become 397 bytes — both boxes kept, both bullets and their indentation gone'
        # This fixture writes the same bytes before and after the fix: it is
        # here to check the schema limit, not the repair. Said out loud on
        # every run, because a green line that proves nothing is worse than
        # no line at all.
        Stale      = ''
        Note       = 'this file writes the same bytes on the old build too — it checks the limit, not the fix'
    },
    [pscustomobject]@{
        Name       = '104-mixed.md'
        Size       = 749
        Hash       = '3DDA065746A9C0C4699B345B3C9E8F4BBE5FDE6E4BE76FC320203A6565BD72B4'
        AfterSize  = 745
        AfterHash  = '8E4FCC18D1F037DC215EBB3E57CBDB6A2D14CE5299EF8A06E7E570255777D262'
        StaleSize  = 732
        StaleHash  = '88378842A52E2121F65A781ED6AD5EEA8909AF65D7101BE028173B2F26F58D71'
        Expect     = 'must become 745 bytes — one bullet and its indentation, nothing else'
        Note       = ''
        Stale      = 'the quoted box was dropped from the file'
    }
)

$StateFile = Join-Path $Folder '104-check-state.json'

# ── Small helpers ────────────────────────────────────────────────────────────

function Write-Pass { param([string] $Text) Write-Host "  PASS  $Text" -ForegroundColor Green }
function Write-Fail { param([string] $Text) Write-Host "  FAIL  $Text" -ForegroundColor Red }
function Write-Note { param([string] $Text) Write-Host "        $Text" -ForegroundColor DarkGray }

function Get-Digest {
    param([string] $Path)
    return (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

<#
    How the file's lines end, read off the bytes rather than off the text, and
    whether the last one is terminated. Both are part of R-C2: a file opened
    with LF endings must be written back with LF endings, and a file that ended
    with a newline must still end with one.
#>
function Get-LineConventions {
    param([string] $Path)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $cr = 0
    $lf = 0
    foreach ($b in $bytes) {
        if ($b -eq 13) { $cr++ }
        elseif ($b -eq 10) { $lf++ }
    }
    $ending = 'LF'
    if ($cr -gt 0 -and $cr -eq $lf) { $ending = 'CRLF' }
    elseif ($cr -gt 0) { $ending = "MIXED ($cr CR, $lf LF)" }
    $final = ($bytes.Length -gt 0 -and $bytes[$bytes.Length - 1] -eq 10)
    return [pscustomobject]@{ Ending = $ending; FinalNewline = $final }
}

<#
    The lines that differ between two files, as a short listing. Only reached
    when a fixture is neither right nor recognisably stale — the case where
    what matters is seeing the difference, not classifying it.
#>
function Show-Difference {
    param([string] $Expected, [string] $Actual)
    $a = [System.IO.File]::ReadAllText($Expected) -split "`n"
    $b = [System.IO.File]::ReadAllText($Actual) -split "`n"
    $diff = Compare-Object -ReferenceObject $a -DifferenceObject $b
    if (-not $diff) {
        Write-Note 'the lines are the same; the difference is in whitespace or line endings'
        return
    }
    Write-Note 'lines that differ (< was in the file before, > is in it now):'
    foreach ($d in $diff | Select-Object -First 20) {
        $mark = '<'
        if ($d.SideIndicator -eq '=>') { $mark = '>' }
        Write-Note ("    {0} {1}" -f $mark, $d.InputObject)
    }
    if ($diff.Count -gt 20) { Write-Note ("    ... and {0} more" -f ($diff.Count - 20)) }
}

# ── Before ───────────────────────────────────────────────────────────────────

function Invoke-Before {
    Write-Host ''
    Write-Host "Stage: Before — checking the downloaded fixtures in $Folder" -ForegroundColor Cyan
    Write-Host ''

    $state = @{}
    $bad = 0

    foreach ($f in $FIXTURES) {
        $path = Join-Path $Folder $f.Name
        Write-Host $f.Name

        if (-not (Test-Path -LiteralPath $path)) {
            Write-Fail 'not found in this folder'
            Write-Note 'download it from the branch page with the "Download raw file" button'
            $bad++
            continue
        }

        $size = (Get-Item -LiteralPath $path).Length
        $hash = Get-Digest -Path $path

        if ($size -ne $f.Size -or $hash -ne $f.Hash) {
            Write-Fail ("wrong bytes — {0} bytes, expected {1}" -f $size, $f.Size)
            if ($size -gt ($f.Size * 3)) {
                Write-Note 'far too large: this looks like a saved web page, not the raw file.'
                Write-Note 'use the "Download raw file" button, not "Save page as".'
            }
            else {
                Write-Note "expected digest $($f.Hash)"
                Write-Note "actual   digest $hash"
            }
            $bad++
            continue
        }

        $conv = Get-LineConventions -Path $path
        Write-Pass ("$size bytes, digest matches, line endings " + $conv.Ending)
        if (-not $conv.FinalNewline) { Write-Note 'no newline at the end of the file — unexpected, report it' }

        Copy-Item -LiteralPath $path -Destination "$path.before" -Force
        # Ticks rather than a formatted date, and that is not a style choice.
        # `ConvertFrom-Json` parses an ISO-8601 string straight back into a
        # `DateTime`, so a stored string compared against a string is never
        # equal on the way back — which would have made the "never saved" case
        # below silently unreachable. A number cannot be reinterpreted.
        $state[$f.Name] = @{
            Size      = $size
            Hash      = $hash
            Ticks     = (Get-Item -LiteralPath $path).LastWriteTimeUtc.Ticks
            Ending    = $conv.Ending
        }
    }

    Write-Host ''
    if ($bad -gt 0) {
        Write-Host "$bad of $($FIXTURES.Count) fixtures are not the right bytes. Fix that before opening anything." -ForegroundColor Red
        Write-Host ''
        return 1
    }

    # Depth stated rather than left to the default, which is 2 and would only
    # just cover this shape — a silent truncation here would come back as a
    # confusing After stage rather than as an error.
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $StateFile -Encoding UTF8
    Write-Host 'All three fixtures are the right bytes, and a copy of each was kept as *.before.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Now, in AgentEd, for each of the three files in turn:' -ForegroundColor Cyan
    Write-Host '  1. File > Open, and pick the file from this folder.'
    Write-Host '  2. Check About reports the commit the pull request names.'
    Write-Host '  3. Type nothing. Click nothing in the document.'
    Write-Host '  4. Press Ctrl+S.'
    Write-Host '  5. Close the document (File > Close).'
    Write-Host ''
    Write-Host 'Then run this script again with -Stage After.' -ForegroundColor Cyan
    Write-Host ''
    return 0
}

# ── After ────────────────────────────────────────────────────────────────────

function Invoke-After {
    Write-Host ''
    Write-Host "Stage: After — checking what the save wrote, in $Folder" -ForegroundColor Cyan
    Write-Host ''

    if (-not (Test-Path -LiteralPath $StateFile)) {
        Write-Host 'No state file. Run -Stage Before first, before opening anything in AgentEd.' -ForegroundColor Red
        Write-Host ''
        return 1
    }
    $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json

    $failed = 0
    $unsaved = 0

    foreach ($f in $FIXTURES) {
        $path = Join-Path $Folder $f.Name
        Write-Host $f.Name
        Write-Note $f.Expect
        if ($f.Note) { Write-Note $f.Note }

        if (-not (Test-Path -LiteralPath $path)) {
            Write-Fail 'not found — was it moved, or saved somewhere else?'
            $failed++
            continue
        }

        $recorded = $state.PSObject.Properties[$f.Name]
        if (-not $recorded) {
            Write-Fail 'not recorded by the Before stage — run -Stage Before again from clean copies'
            $failed++
            continue
        }

        $size = (Get-Item -LiteralPath $path).Length
        $hash = Get-Digest -Path $path
        $touched = ((Get-Item -LiteralPath $path).LastWriteTimeUtc.Ticks -ne [int64] $recorded.Value.Ticks)

        # A save that never happened is its own result, and for the blockquote
        # fixture — whose correct answer is "nothing changed" — it is the only
        # thing that tells the two apart. Reported, never counted as a pass.
        if (-not $touched) {
            Write-Fail 'the file was never written — AgentEd did not save it'
            Write-Note 'open it, press Ctrl+S, and make sure the modified marker clears'
            $unsaved++
            continue
        }

        if ($size -eq $f.AfterSize -and $hash -eq $f.AfterHash) {
            $conv = Get-LineConventions -Path $path
            Write-Pass ("$size bytes, exactly what this build should write")
            if ($conv.Ending -ne $recorded.Value.Ending) {
                Write-Fail ("line endings changed: " + $recorded.Value.Ending + " -> " + $conv.Ending)
                $failed++
            }
            elseif (-not $conv.FinalNewline) {
                Write-Fail 'the final newline is gone'
                $failed++
            }
            continue
        }

        if ($f.StaleHash -ne $f.AfterHash -and $size -eq $f.StaleSize -and $hash -eq $f.StaleHash) {
            Write-Fail ("$size bytes — this is the build from before the fix")
            Write-Note $f.Stale
            Write-Note 'check About against the commit the pull request names; the installer is probably stale'
            $failed++
            continue
        }

        if ($size -eq $f.AfterSize) {
            Write-Fail ("$size bytes — the right size, but not the right content")
        }
        else {
            Write-Fail ("$size bytes, expected $($f.AfterSize) — neither the fixed nor the old result")
        }
        Write-Note "expected digest $($f.AfterHash)"
        Write-Note "actual   digest $hash"
        if (Test-Path -LiteralPath "$path.before") { Show-Difference -Expected "$path.before" -Actual $path }
        $failed++
    }

    Write-Host ''
    if ($unsaved -gt 0) {
        Write-Host "$unsaved file(s) were never written. Save them and run -Stage After again." -ForegroundColor Yellow
    }
    if ($failed -eq 0 -and $unsaved -eq 0) {
        Write-Host 'All three behaved exactly as this build should. #104 checks out.' -ForegroundColor Green
        Write-Host ''
        Write-Host 'One thing this script cannot see: whether the boxes were on screen while' -ForegroundColor Cyan
        Write-Host 'the file was open. Say so separately — the bytes are only half of it.'
    }
    elseif ($failed -gt 0) {
        Write-Host "$failed file(s) did not behave as expected. The lines above say how." -ForegroundColor Red
    }
    Write-Host ''
    if ($failed -gt 0 -or $unsaved -gt 0) { return 1 }
    return 0
}

# ── Run ──────────────────────────────────────────────────────────────────────

if (-not (Test-Path -LiteralPath $Folder)) {
    Write-Host "No such folder: $Folder" -ForegroundColor Red
    exit 1
}

if ($Stage -eq 'Before') { exit (Invoke-Before) }
exit (Invoke-After)
