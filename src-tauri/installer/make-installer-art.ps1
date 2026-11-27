$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$iconPath = Join-Path $root "assets\Icon.png"
if (-not (Test-Path $iconPath)) { throw "Icon not found: $iconPath" }

$icon = [System.Drawing.Image]::FromFile($iconPath)
$black = [System.Drawing.Color]::FromArgb(255, 0, 0, 0)
$white = [System.Drawing.Color]::FromArgb(255, 245, 245, 245)
$gray = [System.Drawing.Color]::FromArgb(255, 168, 168, 170)
$dim = [System.Drawing.Color]::FromArgb(255, 112, 112, 116)

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new(
    $width,
    $height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear($black)
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function Save-Canvas($canvas, [string]$path) {
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $canvas.Graphics.Dispose()
  $canvas.Bitmap.Dispose()
}

$semibold = [System.Drawing.FontFamily]::new("Segoe UI Semibold")
$regular = [System.Drawing.FontFamily]::new("Segoe UI")
$centered = [System.Drawing.StringFormat]::new()
$centered.Alignment = [System.Drawing.StringAlignment]::Center
$centered.LineAlignment = [System.Drawing.StringAlignment]::Near

# NSIS header: 150 x 57.
$header = New-Canvas 150 57
$header.Graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(8, 9, 39, 39))
$headerFont = [System.Drawing.Font]::new(
  $semibold,
  18,
  [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel
)
$headerSub = [System.Drawing.Font]::new(
  $regular,
  8,
  [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel
)
$header.Graphics.DrawString(
  "Reflux",
  $headerFont,
  [System.Drawing.SolidBrush]::new($white),
  53,
  12
)
$header.Graphics.DrawString(
  "Audio editor",
  $headerSub,
  [System.Drawing.SolidBrush]::new($gray),
  54,
  34
)
Save-Canvas $header (Join-Path $PSScriptRoot "header.bmp")

# NSIS welcome/finish sidebar: 164 x 314.
$sidebar = New-Canvas 164 314
$sidebar.Graphics.DrawImage($icon, [System.Drawing.Rectangle]::new(40, 52, 84, 84))
$sidebarFont = [System.Drawing.Font]::new(
  $semibold,
  25,
  [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel
)
$sidebarSub = [System.Drawing.Font]::new(
  $regular,
  11,
  [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel
)
$sidebarFoot = [System.Drawing.Font]::new(
  $regular,
  8,
  [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel
)
$sidebar.Graphics.DrawString(
  "Reflux",
  $sidebarFont,
  [System.Drawing.SolidBrush]::new($white),
  [System.Drawing.RectangleF]::new(0, 154, 164, 40),
  $centered
)
$sidebar.Graphics.DrawString(
  "Simple audio editing",
  $sidebarSub,
  [System.Drawing.SolidBrush]::new($gray),
  [System.Drawing.RectangleF]::new(0, 190, 164, 24),
  $centered
)
$sidebar.Graphics.DrawString(
  "Everything stays on your computer",
  $sidebarFoot,
  [System.Drawing.SolidBrush]::new($dim),
  [System.Drawing.RectangleF]::new(0, 274, 164, 20),
  $centered
)
Save-Canvas $sidebar (Join-Path $PSScriptRoot "sidebar.bmp")

$icon.Dispose()
$semibold.Dispose()
$regular.Dispose()
$centered.Dispose()
Write-Host "Installer artwork written to $PSScriptRoot"
