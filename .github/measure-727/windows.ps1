# Throwaway, measure/727 only. A hosted Windows runner. $args[0] names the build: today or after.
$ErrorActionPreference = 'Continue'
$build = $args[0]
$exe = Join-Path $PWD 'src-tauri\target\release\agented.exe'
$out = Join-Path $PWD 'out'
New-Item -ItemType Directory -Force $out | Out-Null
Remove-Item -Recurse -Force "$HOME\fx727" -ErrorAction SilentlyContinue
python -I .github\measure-727\make-fixtures.py "$HOME\fx727" | Set-Content "$out\labels.txt"
$fx = "$HOME\fx727\docs\index.md"
$log = Join-Path $env:TEMP 'measure-727.log'
function Note($s) { $s | Tee-Object -FilePath "$out\notes-$build.txt" -Append }
function Procs { (Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join '|' }

Note "== build $build"
$before = Procs
foreach ($label in Get-Content "$out\labels.txt") {
  Remove-Item $log -ErrorAction SilentlyContinue
  $env:AGENTED_MEASURE_727_CLICK = $label
  $p = Start-Process $exe -ArgumentList "`"$fx`"" -PassThru
  Remove-Item env:AGENTED_MEASURE_727_CLICK
  Start-Sleep 15
  $now = Procs
  Note "-- ${label}: windows $(if ($now -eq $before -or $now -eq "$before|agented" -or $now -eq "agented|$before") { 'unchanged' } else { "now $now" })"
  if (Test-Path $log) { Get-Content $log | ForEach-Object { $_ -replace '^measure-727: ', '' } | Tee-Object -FilePath "$out\notes-$build.txt" -Append }
  Get-Process agented -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
}
exit 0
