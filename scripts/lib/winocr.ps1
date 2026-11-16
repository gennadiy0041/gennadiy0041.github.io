# Windows built-in OCR (Windows.Media.Ocr) -> JSON with line/word boxes in pixels.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File winocr.ps1 -Path <image> -Out <json> [-Lang ru]
# Used by scripts/sync.mjs to locate IIN / document numbers / phones etc. for redaction.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Lang = 'ru'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$full = (Resolve-Path -LiteralPath $Path).ProviderPath
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language $Lang))
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$lines = New-Object System.Collections.ArrayList
foreach ($line in $result.Lines) {
  $words = New-Object System.Collections.ArrayList
  $x0 = [double]::MaxValue; $y0 = [double]::MaxValue; $x1 = 0.0; $y1 = 0.0
  foreach ($w in $line.Words) {
    $r = $w.BoundingRect
    [void]$words.Add([ordered]@{ text = $w.Text; x = [math]::Round($r.X, 1); y = [math]::Round($r.Y, 1); w = [math]::Round($r.Width, 1); h = [math]::Round($r.Height, 1) })
    $x0 = [math]::Min($x0, $r.X); $y0 = [math]::Min($y0, $r.Y)
    $x1 = [math]::Max($x1, $r.X + $r.Width); $y1 = [math]::Max($y1, $r.Y + $r.Height)
  }
  [void]$lines.Add([ordered]@{ text = $line.Text; x = [math]::Round($x0, 1); y = [math]::Round($y0, 1); w = [math]::Round($x1 - $x0, 1); h = [math]::Round($y1 - $y0, 1); words = $words })
}
$json = [ordered]@{ width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lang = $engine.RecognizerLanguage.LanguageTag; lines = $lines } | ConvertTo-Json -Depth 8 -Compress
[System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false))
