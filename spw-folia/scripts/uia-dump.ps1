param([int]$TargetPid = 19076)
# Enumerate UIA accessibility tree of the SPW main window (Compose Desktop accessibility bridge).
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetPid)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
Write-Output "top-level UIA elements for pid ${TargetPid}: $($wins.Count)"
foreach ($w in $wins) {
    $r = $w.Current.BoundingRectangle
    Write-Output ("WINDOW name='{0}' class='{1}' type={2} rect={3},{4} {5}x{6}" -f `
        $w.Current.Name, $w.Current.ClassName, $w.Current.ControlType.ProgrammaticName, `
        [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
}

if ($wins.Count -eq 0) { exit 0 }
$win = $wins[0]
# count descendants
$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
Write-Output "descendants: $($all.Count)"
$i = 0
foreach ($e in $all) {
    if ($i -ge 400) { Write-Output "...truncated"; break }
    $r = $e.Current.BoundingRectangle
    $name = $e.Current.Name
    $aid = $e.Current.AutomationId
    $ct = $e.Current.ControlType.ProgrammaticName
    if ($name -ne '' -or $aid -ne '') {
        Write-Output ("[{0}] name='{1}' aid='{2}' type={3} rect={4},{5} {6}x{7}" -f $i, $name, $aid, $ct, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
    }
    $i++
}
