# Parse only. Never evaluate or invoke text received on stdin.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [Console]::In.ReadToEnd()
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
$commands = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst]}, $true))
$allowed = '^(Get-(Location|ChildItem|Content|Item|ItemProperty|PSDrive|PSProvider|Command|FileHash|Date|Process|Service|Acl|WinEvent|CimInstance)|Test-Path|Resolve-Path|Split-Path|Join-Path|Select-String|Select-Object|Measure-Object|Sort-Object|Group-Object|Where-Object|ForEach-Object|Format-(Table|List|Wide)|Out-String|ConvertTo-Json|Write-Output)$'
$safe = $errors.Count -eq 0 -and $commands.Count -gt 0
$forbidden = @('AssignmentStatementAst','InvokeMemberExpressionAst','TypeExpressionAst','FunctionDefinitionAst','TypeDefinitionAst','RedirectionAst','FileRedirectionAst','MergingRedirectionAst','UsingStatementAst','UnaryExpressionAst','ScriptBlockExpressionAst')
$bad = $ast.FindAll({param($n)
    $kind = $n.GetType().Name
    # Script blocks may contain data-only Where/ForEach expressions; recursively inspect their nodes.
    ($kind -in $forbidden -and $kind -ne 'ScriptBlockExpressionAst') -or
    ($n -is [Management.Automation.Language.CommandAst] -and $n.InvocationOperator.ToString() -ne 'Unknown')
}, $true)
if ($bad.Count) { $safe = $false }
$rows = @()
foreach ($c in $commands) {
    $name = $c.GetCommandName()
    $args = @(); $literal = @(); $values = @()
    foreach ($e in @($c.CommandElements | Select-Object -Skip 1)) {
        $args += $e.Extent.Text
        if ($e -is [Management.Automation.Language.StringConstantExpressionAst]) { $literal += $e.Value; $values += $e.Value }
        elseif ($e -is [Management.Automation.Language.ExpandableStringExpressionAst] -and $e.NestedExpressions.Count -eq 0) { $literal += $e.Value; $values += $e.Value }
        else { $values += $null }
    }
    if (-not $name -or $name -notmatch $allowed) { $safe = $false }
    if ($name -match '^(Get-Content|Select-String)$' -and $c.FindAll({param($n)
        $n -is [Management.Automation.Language.VariableExpressionAst]
    }, $true).Count) { $safe = $false }
    $rows += @{name=$name; args=$args; values=$values; literal=$literal; text=$c.Extent.Text}
}
$redirects = @($ast.FindAll({param($n) $n -is [Management.Automation.Language.FileRedirectionAst]}, $true) | ForEach-Object {
    $value = $null
    if ($_.Location -is [Management.Automation.Language.StringConstantExpressionAst]) { $value = $_.Location.Value }
    elseif ($_.Location -is [Management.Automation.Language.ExpandableStringExpressionAst] -and $_.Location.NestedExpressions.Count -eq 0) { $value = $_.Location.Value }
    @{value=$value; text=$_.Extent.Text}
})
@{valid=($errors.Count -eq 0); readOnly=[bool]$safe; commands=$rows; redirects=$redirects} | ConvertTo-Json -Depth 8 -Compress
