# Test available Gemini models
Write-Host "Checking available Gemini models..." -ForegroundColor Cyan

$geminiKey = $env:GEMINI_API_KEY
if (-not $geminiKey) {
    Write-Host "Set GEMINI_API_KEY in your environment before running this script." -ForegroundColor Yellow
    exit 1
}
$listModelsUrl = "https://generativelanguage.googleapis.com/v1/models?key=$geminiKey"

try {
    $modelsResponse = Invoke-WebRequest -Uri $listModelsUrl -Method GET -UseBasicParsing
    $models = $modelsResponse.Content | ConvertFrom-Json
    
    Write-Host "✅ Available Gemini Models:" -ForegroundColor Green
    $models.models | Select-Object -ExpandProperty name | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Failed to list models" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Checking v1beta API..." -ForegroundColor Cyan

$geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$geminiKey"

$geminiPayload = @{
    contents = @(
        @{
            parts = @(
                @{ text = "Say hello" }
            )
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $geminiResponse = Invoke-WebRequest -Uri $geminiUrl -Method POST -ContentType "application/json" -Body $geminiPayload -UseBasicParsing
    Write-Host "✅ Gemini v1beta API: SUCCESS (Status $($geminiResponse.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "❌ Gemini v1beta API: FAILED" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    $errorStream = $_.Exception.Response.GetResponseStream()
    $errorReader = New-Object System.IO.StreamReader($errorStream)
    $errorBody = $errorReader.ReadToEnd()
    Write-Host "Error Body: $errorBody" -ForegroundColor Red
}
