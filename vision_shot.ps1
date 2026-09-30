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
function Click($x, $y) {
    [W.M]::SetCursorPos($x, $y)
    Start-Sleep -m 200
    [W.M]::mouse_event(2,0,0,0,0); Start-Sleep -m 80; [W.M]::mouse_event(4,0,0,0,0)
}
# 等待游戏窗口就绪后激活并截开始界面
Start-Sleep -s 6
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -m 500
(New-Object -ComObject WScript.Shell).AppActivate('山河永驻') | Out-Null
Start-Sleep -m 800
[System.Windows.Forms.SendKeys]::SendWait('{ESC}')
Start-Sleep -m 300
Shot "v_start.png"
# 回车进入游戏(新局按钮已有焦点)
Start-Sleep -m 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -s 3
Shot "v_game.png"
# 点击地图中部(河南省一带, 逻辑坐标约 1700/640 -> 窗口内 1133/427, 居中窗口偏移 (43,24))
Click 1176 451
Start-Sleep -m 600
Shot "v_pick1.png"
# 点击西北(甘肃走廊, 逻辑约 1150/430 -> 屏幕 810/311)
Click 810 311
Start-Sleep -m 600
Shot "v_pick2.png"
# 点击江南(逻辑约 1750/750 -> 屏幕 1210/524)
Click 1210 524
Start-Sleep -m 600
Shot "v_pick3.png"
Write-Output "shots done"
