Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$assetDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'
$pngPath = Join-Path $assetDirectory 'rcrd-app-icon.png'
$icoPath = Join-Path $assetDirectory 'rcrd-app-icon.ico'
$recordColor = [System.Drawing.ColorTranslator]::FromHtml('#0b1510')
$grooveColor = [System.Drawing.ColorTranslator]::FromHtml('#314535')
$labelColor = [System.Drawing.ColorTranslator]::FromHtml('#10261a')
$letterColor = [System.Drawing.ColorTranslator]::FromHtml('#d9ff48')

function New-RcrdIconBitmap {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $recordBrush = [System.Drawing.SolidBrush]::new($recordColor)
  $labelBrush = [System.Drawing.SolidBrush]::new($labelColor)
  $letterBrush = [System.Drawing.SolidBrush]::new($letterColor)
  $groovePen = [System.Drawing.Pen]::new($grooveColor, 1.5)
  $letterPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $family = [System.Drawing.FontFamily]::new('Georgia')
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.ScaleTransform($Size / 256.0, $Size / 256.0)

    $graphics.FillEllipse($recordBrush, 8, 8, 240, 240)
    foreach ($radius in @(111, 104, 97, 90, 83, 76, 69)) {
      $graphics.DrawEllipse($groovePen, 128 - $radius, 128 - $radius, 2 * $radius, 2 * $radius)
    }
    $graphics.FillEllipse($labelBrush, 69, 69, 118, 118)

    $letterPath.AddString('R', $family, [int][System.Drawing.FontStyle]::Bold, 190,
      [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericDefault)
    $bounds = $letterPath.GetBounds()
    $scale = 154.0 / $bounds.Height
    $transform = [System.Drawing.Drawing2D.Matrix]::new(
      [float]$scale, 0, 0, [float]$scale,
      [float](128 - $scale * ($bounds.X + $bounds.Width / 2)),
      [float](128 - $scale * ($bounds.Y + $bounds.Height / 2)))
    try {
      $letterPath.Transform($transform)
      $graphics.FillPath($letterBrush, $letterPath)
    } finally { $transform.Dispose() }
    return $bitmap
  } catch {
    $bitmap.Dispose()
    throw
  } finally {
    $family.Dispose()
    $letterPath.Dispose()
    $groovePen.Dispose()
    $letterBrush.Dispose()
    $labelBrush.Dispose()
    $recordBrush.Dispose()
    $graphics.Dispose()
  }
}

$pngBitmap = New-RcrdIconBitmap -Size 512
try { $pngBitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png) }
finally { $pngBitmap.Dispose() }

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = foreach ($size in $sizes) {
  $bitmap = New-RcrdIconBitmap -Size $size
  $stream = [System.IO.MemoryStream]::new()
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    ,$stream.ToArray()
  } finally {
    $stream.Dispose()
    $bitmap.Dispose()
  }
}

$file = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($file)
try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($index = 0; $index -lt $sizes.Count; $index++) {
    $dimension = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$index].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$index].Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image) }
} finally { $writer.Dispose() }

Write-Host 'Built the RCRD PNG and ICO icons.'
