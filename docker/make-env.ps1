# Sinh file .env với mật khẩu/khóa ngẫu nhiên (chỉ thêm khóa còn thiếu, KHÔNG ghi đè giá trị đã có).
# Chạy từ thư mục gốc dự án:   powershell -ExecutionPolicy Bypass -File docker\make-env.ps1
$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Get-Location) '.env'

function New-Secret([int]$length) {
    $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

$existing = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $existing[$Matches[1]] = $Matches[2] }
    }
}

$adminPw = if ($existing.ContainsKey('ADMIN_PASSWORD')) { $existing['ADMIN_PASSWORD'] } else { New-Secret 20 }
$uiPw    = if ($existing.ContainsKey('UI_PASSWORD'))    { $existing['UI_PASSWORD'] }    else { New-Secret 20 }

$wanted = [ordered]@{
    MQTT_BACKEND_PASSWORD = New-Secret 24
    MQTT_DEVICE_PASSWORD  = New-Secret 24
    MQTT_SIM_PASSWORD     = New-Secret 24
    BTL_JWT_SECRET        = New-Secret 48
    ADMIN_PASSWORD        = $adminPw
    UI_USERNAME           = 'ui'
    UI_PASSWORD           = $uiPw
    BTL_USERS             = "admin:${adminPw}:admin,ui:${uiPw}:operator"
}

$added = @()
foreach ($k in $wanted.Keys) {
    if (-not $existing.ContainsKey($k)) {
        Add-Content -Path $envFile -Value "$k=$($wanted[$k])" -Encoding ascii
        $added += $k
    }
}
if ($added.Count -eq 0) { Write-Host '.env đã đủ khóa, không thay đổi.' }
else {
    Write-Host ('Đã thêm vào .env: ' + ($added -join ', '))
    Write-Host 'Tài khoản quản trị web/API: admin  (mật khẩu: ADMIN_PASSWORD trong .env). KHÔNG commit file .env.'
}
