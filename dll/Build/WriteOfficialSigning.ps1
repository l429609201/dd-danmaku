param(
    [Parameter(Mandatory = $true)]
    [string] $OutputPath
)
$ErrorActionPreference = 'Stop'

# 本地文件仅作进程环境变量的后备；不执行文件内容，不展开变量，不输出密钥。
$keys = @('DD_SIGN_SECRET', 'DD_BRAND_MARK', 'DD_OBF_KEY', 'DD_RELAY_PREFIX', 'DD_UPSTREAM_UA')
$localValues = [System.Collections.Generic.Dictionary[string, string]]::new([System.StringComparer]::Ordinal)
$localPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'
if (Test-Path -LiteralPath $localPath -PathType Leaf) {
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $localPath -Encoding UTF8) {
        $lineNumber++
        $text = $line.Trim()
        if ($text.Length -eq 0 -or $text.StartsWith('#')) { continue }
        $separator = $text.IndexOf('=')
        if ($separator -le 0) { throw "本地签名配置第 $lineNumber 行格式无效" }
        $key = $text.Substring(0, $separator).Trim()
        if ($keys -cnotcontains $key -or $localValues.ContainsKey($key)) {
            throw "本地签名配置第 $lineNumber 行键名未知或重复"
        }
        $value = $text.Substring($separator + 1).Trim()
        if ($value.StartsWith('"') -or $value.StartsWith("'")) {
            if ($value.Length -lt 2 -or $value[$value.Length - 1] -ne $value[0]) {
                throw "本地签名配置第 $lineNumber 行引号未闭合"
            }
            $value = $value.Substring(1, $value.Length - 2)
        }
        $localValues.Add($key, $value)
    }
}
$values = @{}
foreach ($key in $keys) {
    $value = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ($null -eq $value -and $localValues.ContainsKey($key)) { $value = $localValues[$key] }
    $values[$key] = [string]$value
}
# 这些值最终嵌入 DLL，可被下载者提取，不能作为不可公开的认证秘密。
$settings = [ordered]@{
    Secret = $values['DD_SIGN_SECRET']
    BrandMark = $values['DD_BRAND_MARK']
    ObfuscationKey = $values['DD_OBF_KEY']
    RelayPrefix = $values['DD_RELAY_PREFIX']
    UserAgent = $values['DD_UPSTREAM_UA']
}
$fullPath = [System.IO.Path]::GetFullPath($OutputPath)
$directory = [System.IO.Path]::GetDirectoryName($fullPath)
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
# 每次覆盖，包括环境变量被清空时，防止后续无密钥构建误用上次值。
$settings | ConvertTo-Json -Compress | Set-Content -LiteralPath $fullPath -Encoding UTF8
