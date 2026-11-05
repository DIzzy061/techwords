$ErrorActionPreference = 'Stop'
$trainerRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$trainerPort = 8787
$trainerServer = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $trainerPort)
$trainerFiles = @{
    '/TechnoWords.html' = 'text/html; charset=utf-8'
    '/ai-runtime.js' = 'application/javascript'
    '/ai-worker.js' = 'application/javascript'
    '/ai-panel.js' = 'application/javascript'
    '/WEBLLM-LICENSE.txt' = 'text/plain; charset=utf-8'
}
try {
    $trainerServer.Start()
    Write-Host 'TechnoWords: http://localhost:8787/ (keep this window open; Ctrl+C to stop)'
    if (-not $env:TRAINER_NO_OPEN) { Start-Process 'http://localhost:8787/' }
    while ($true) {
        $trainerClient = $trainerServer.AcceptTcpClient()
        try {
            $trainerClient.ReceiveTimeout = 3000
            $trainerStream = $trainerClient.GetStream()
            $trainerReader = [IO.StreamReader]::new($trainerStream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $trainerRequest = $trainerReader.ReadLine()
            if (-not $trainerRequest) { continue }
            $trainerMatch = [regex]::Match($trainerRequest, '^(GET|HEAD) (/[^ ]*) HTTP/1\.[01]$')
            $trainerPath = if ($trainerMatch.Success) { ($trainerMatch.Groups[2].Value -split '\?')[0] } else { '' }
            if ($trainerPath -eq '/') { $trainerPath = '/TechnoWords.html' }
            if ($trainerFiles.ContainsKey($trainerPath)) {
                $trainerBody = [IO.File]::ReadAllBytes((Join-Path $trainerRoot $trainerPath.Substring(1)))
                $trainerStatus = '200 OK'; $trainerType = $trainerFiles[$trainerPath]
            } else {
                $trainerBody = [Text.Encoding]::UTF8.GetBytes('Not found'); $trainerStatus = '404 Not Found'; $trainerType = 'text/plain'
            }
            $trainerHeaders = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $trainerStatus`r`nContent-Type: $trainerType`r`nContent-Length: $($trainerBody.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n")
            $trainerStream.Write($trainerHeaders, 0, $trainerHeaders.Length)
            if ($trainerMatch.Groups[1].Value -ne 'HEAD') { $trainerStream.Write($trainerBody, 0, $trainerBody.Length) }
        } catch { Write-Warning $_.Exception.Message }
        finally { $trainerClient.Dispose() }
    }
} catch { Write-Error 'Cannot start TechnoWords. Port 8787 may be in use. Close the previous launcher and retry.'; exit 1 }
finally { $trainerServer.Stop() }
