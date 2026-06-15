Add-Type -AssemblyName System.Drawing

$maxWidth = 1400
$maxHeight = 1000
$results = @()

Get-ChildItem "$PSScriptRoot\..\images" -Filter *.png | ForEach-Object {
    $file = $_.FullName
    $before = $_.Length
    $img = [System.Drawing.Image]::FromFile($file)

    try {
        $ratio = [Math]::Min($maxWidth / $img.Width, $maxHeight / $img.Height)
        if ($ratio -gt 1) {
            $ratio = 1
        }

        $newWidth = [Math]::Max(1, [int][Math]::Round($img.Width * $ratio))
        $newHeight = [Math]::Max(1, [int][Math]::Round($img.Height * $ratio))
        $bitmap = New-Object System.Drawing.Bitmap($newWidth, $newHeight)

        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($img, 0, 0, $newWidth, $newHeight)
            } finally {
                $graphics.Dispose()
            }

            $temp = Join-Path $env:TEMP "$($_.BaseName)-mamameals-compressed.png"
            $bitmap.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
            $after = (Get-Item $temp).Length

            if ($after -lt $before) {
                Move-Item -LiteralPath $temp -Destination $file -Force -ErrorAction SilentlyContinue
                $results += [pscustomobject]@{
                    Name = $_.Name
                    BeforeKB = [Math]::Round($before / 1KB, 1)
                    AfterKB = [Math]::Round($after / 1KB, 1)
                    SavedKB = [Math]::Round(($before - $after) / 1KB, 1)
                    Size = "${newWidth}x${newHeight}"
                }
            } else {
                Remove-Item -LiteralPath $temp -Force
                $results += [pscustomobject]@{
                    Name = $_.Name
                    BeforeKB = [Math]::Round($before / 1KB, 1)
                    AfterKB = [Math]::Round($before / 1KB, 1)
                    SavedKB = 0
                    Size = "kept original"
                }
            }
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $img.Dispose()
    }
}

$results | Format-Table -AutoSize
