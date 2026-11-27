# Thêm / đổi / xóa tài khoản đăng nhập web trong BTL_USERS của file .env (mỗi thành viên một tài khoản).
# Chạy từ thư mục gốc dự án:
#   powershell -ExecutionPolicy Bypass -File docker\add-user.ps1 -Name vu -Role admin
#   powershell -ExecutionPolicy Bypass -File docker\add-user.ps1 -Name thai -Role operator
#   powershell -ExecutionPolicy Bypass -File docker\add-user.ps1 -Name khach -Role viewer
#   powershell -ExecutionPolicy Bypass -File docker\add-user.ps1 -Name khach -Remove
# Không truyền -Password thì sinh mật khẩu ngẫu nhiên và in ra MỘT lần. Sau đó: docker compose up -d backend
param(
    [Parameter(Mandatory = $true)][string]$Name,
    [ValidateSet('viewer', 'operator', 'admin')][string]$Role = 'viewer',
    [string]$Password = '',
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Get-Location) '.env'
if (-not (Test-Path $envFile)) { throw 'Chưa có .env - chạy docker\make-env.ps1 trước.' }
if ($Name -notmatch '^[A-Za-z0-9_.-]{1,32}$') { throw 'Tên chỉ gồm chữ không dấu, số, _ . - (tối đa 32 ký tự).' }

if (-not $Remove) {
    if ($Password -eq '') {
        $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        $bytes = New-Object byte[] 16
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $Password = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
    }
    if ($Password.Length -lt 8 -or [Text.Encoding]::UTF8.GetByteCount($Password) -gt 72) { throw 'Mật khẩu phải dài 8-72 byte.' }
    if ($Password -match '[:,\s]') { throw 'Mật khẩu không được chứa dấu : , hoặc khoảng trắng.' }
}

$lines = [IO.File]::ReadAllLines($envFile)
$idx = -1
for ($i = 0; $i -lt $lines.Length; $i++) { if ($lines[$i] -match '^\s*BTL_USERS\s*=') { $idx = $i } }
$entries = @()
if ($idx -ge 0) {
    $entries = ($lines[$idx] -replace '^\s*BTL_USERS\s*=', '').Split(',') | Where-Object { $_.Trim() -ne '' }
}
$kept = @($entries | Where-Object { $_.Split(':')[0].Trim() -ne $Name })
$existed = $kept.Count -ne $entries.Count
if ($Remove) {
    if (-not $existed) { throw "Không có tài khoản '$Name'." }
    $new = $kept
} else {
    $new = $kept + "${Name}:${Password}:${Role}"
}
$line = 'BTL_USERS=' + ($new -join ',')
if ($idx -ge 0) { $lines[$idx] = $line } else { $lines += $line }
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))

if ($Remove) { Write-Host "Đã xóa tài khoản '$Name'." }
else {
    $verb = if ($existed) { 'Đã cập nhật' } else { 'Đã thêm' }
    Write-Host "$verb tài khoản: $Name  (vai trò: $Role)"
    Write-Host "Mật khẩu: $Password   <- gửi riêng cho người dùng, không đăng lên nhóm chat"
}
Write-Host 'Áp dụng: docker compose up -d backend'
