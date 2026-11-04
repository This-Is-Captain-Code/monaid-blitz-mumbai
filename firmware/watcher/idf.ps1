# Run idf.py with the machine's ESP-IDF 5.5 env. Usage: ./idf.ps1 build | flash | monitor ...
Remove-Item Env:MSYSTEM -ErrorAction SilentlyContinue
$env:IDF_PATH = 'C:\esp\esp-idf'

$exports = & python.exe C:\esp\esp-idf\tools\idf_tools.py export --format key-value 2>$null
foreach ($line in ($exports -split "`n")) {
    $line = $line.Trim()
    if ($line -match '^([^=]+)=(.+)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim()
        if ($key -eq 'PATH') { $env:PATH = $val + ';' + $env:PATH }
        else { [System.Environment]::SetEnvironmentVariable($key, $val, 'Process') }
    }
}

Set-Location $PSScriptRoot
& idf.py @args
exit $LASTEXITCODE
