# Serve this folder on http://localhost so AgentEd can run in a browser.
#
# The web build needs a **secure context** — https or localhost, never a
# bare host or IP (REQUIREMENTS §7) — and its bundle is loaded as ES
# modules, which a browser refuses to load over `file://`. So opening
# index.html from the folder does nothing: it has to be served.
#
# This uses `System.Net.HttpListener`, which is part of Windows and needs
# no install, no checkout and no npm. Measured on Windows 11: binding
# `http://localhost:<port>/` succeeds without administrator rights.
#
# Right-click this file and choose "Run with PowerShell". If that is
# blocked, open PowerShell in this folder and run:
#
#     powershell -ExecutionPolicy Bypass -File .\serve.ps1
#
# Press Ctrl+C to stop it.

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$root = [System.IO.Path]::GetFullPath($root)

if (-not (Test-Path (Join-Path $root 'index.html'))) {
    Write-Host "No index.html next to this script. Run it from the folder you unzipped." -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

# Content types the bundle actually needs. A wrong type on the JavaScript
# is not cosmetic: a browser refuses to execute a module served as
# anything other than a JavaScript type, and the page comes up blank.
$types = @{
    '.html'  = 'text/html; charset=utf-8'
    '.js'    = 'text/javascript; charset=utf-8'
    '.mjs'   = 'text/javascript; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.svg'   = 'image/svg+xml'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.gif'   = 'image/gif'
    '.ico'   = 'image/x-icon'
    '.webmanifest' = 'application/manifest+json'
    '.woff'  = 'font/woff'
    '.woff2' = 'font/woff2'
    '.ttf'   = 'font/ttf'
    '.wasm'  = 'application/wasm'
    '.map'   = 'application/json; charset=utf-8'
    '.txt'   = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$port = 0
foreach ($candidate in 8123..8133) {
    $listener.Prefixes.Clear()
    $listener.Prefixes.Add("http://localhost:$candidate/")
    try {
        $listener.Start()
        $port = $candidate
        break
    } catch {
        # Port taken, or refused. Try the next one.
    }
}

if ($port -eq 0) {
    Write-Host 'Could not open a port between 8123 and 8133.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$url = "http://localhost:$port/"
Write-Host ''
Write-Host "AgentEd is being served at $url" -ForegroundColor Green
Write-Host 'Open it in Chrome or Edge. Image support needs one of those (REQUIREMENTS section 7).'
Write-Host 'Press Ctrl+C to stop.'
Write-Host ''
try { Start-Process $url } catch { Write-Host "Open $url yourself." }

try {
    while ($listener.IsListening) {
        # Asynchronous, so Ctrl+C is noticed. A blocking GetContext() would
        # sit inside .NET and ignore it until the next request arrived.
        $task = $listener.BeginGetContext($null, $null)
        while (-not $task.AsyncWaitHandle.WaitOne(200)) { }
        $context = $listener.EndGetContext($task)

        $requested = [System.Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
        if ($requested -eq '/') { $requested = '/index.html' }
        $relative = $requested.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar

        $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
        # Nothing outside the folder this script sits in, whatever the
        # request asked for. It listens on localhost only, but a traversal
        # is not something to leave to the binding.
        $inside = $full.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)

        if ((-not $inside) -or (-not (Test-Path -LiteralPath $full -PathType Leaf))) {
            $context.Response.StatusCode = 404
            $context.Response.Close()
            continue
        }

        $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $type = $types[$extension]
        if (-not $type) { $type = 'application/octet-stream' }

        $bytes = [System.IO.File]::ReadAllBytes($full)
        $context.Response.ContentType = $type
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
}
