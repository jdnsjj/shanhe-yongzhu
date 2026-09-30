Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);' -Name M -Namespace W
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
function Shot($name) {
    $path = Join-Path $PSScriptRoot $name
    $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, $b.Size)
    $bmp.Save($path)
    $g.Dispose(); $bmp.Dispose()
}
[W.M]::SetCursorPos(1050, 550)
Start-Sleep -m 250
[W.M]::mouse_event(2,0,0,0,0); Start-Sleep -m 80; [W.M]::mouse_event(4,0,0,0,0)
Start-Sleep -m 400
Shot "shot_default.png"
Write-Output "done"
