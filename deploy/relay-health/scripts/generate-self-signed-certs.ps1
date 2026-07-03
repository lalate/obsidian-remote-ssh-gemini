param(
    [string[]]$IpSans = @('127.0.0.1'),
    [string[]]$DnsSans = @('localhost'),
    [string]$CommonName = 'relay-health',
    [string]$CaCommonName = 'relay-local-ca',
    [int]$ServerDays = 825,
    [int]$CaDays = 3650
)

$ErrorActionPreference = 'Stop'

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Name"
    }
}

function Convert-ToWslPath {
    param([string]$WindowsPath)
    $resolved = (Resolve-Path $WindowsPath).Path
    $wslPath = (& wsl wslpath -a "$resolved").Trim()
    if ([string]::IsNullOrWhiteSpace($wslPath)) {
        throw "Failed to convert path to WSL path: $resolved"
    }
    return $wslPath
}

Require-Command -Name wsl

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$certDir = Join-Path $scriptDir '..\certs'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null

$altLines = New-Object System.Collections.Generic.List[string]
$dnsIndex = 1
foreach ($dns in $DnsSans) {
    if (-not [string]::IsNullOrWhiteSpace($dns)) {
        $altLines.Add("DNS.$dnsIndex = $dns")
        $dnsIndex++
    }
}
$ipIndex = 1
foreach ($ip in $IpSans) {
    if (-not [string]::IsNullOrWhiteSpace($ip)) {
        $altLines.Add("IP.$ipIndex = $ip")
        $ipIndex++
    }
}
if ($altLines.Count -eq 0) {
    throw 'At least one SAN entry is required. Provide -IpSans or -DnsSans.'
}

$caConfig = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ca

[dn]
CN = $CaCommonName

[v3_ca]
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
"@

$serverConfig = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
CN = $CommonName

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
$($altLines -join "`n")
"@

$caConfigPath = Join-Path $certDir 'ca.cnf'
$serverConfigPath = Join-Path $certDir 'server.cnf'

Set-Content -Path $caConfigPath -Value $caConfig -Encoding ascii
Set-Content -Path $serverConfigPath -Value $serverConfig -Encoding ascii

$certDirWsl = Convert-ToWslPath -WindowsPath $certDir

$opensslCmd = @"
set -euo pipefail
cd "$certDirWsl"

openssl req -x509 -new -nodes -keyout ca.key -out ca.crt -days $CaDays -config ca.cnf
openssl req -new -nodes -keyout relay.key -out relay.csr -config server.cnf
openssl x509 -req -in relay.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out relay.crt -days $ServerDays -sha256 -extfile server.cnf -extensions v3_req

cp relay.crt cert.pem
cp relay.key key.pem
cp ca.crt relay-ios.cer

openssl x509 -in relay.crt -noout -subject -issuer
openssl x509 -in relay.crt -noout -text | sed -n '/Subject Alternative Name/,+2p'
"@

wsl bash -lc $opensslCmd

Write-Host ''
Write-Host 'Generated files:'
Get-ChildItem $certDir | Select-Object Name, Length | Format-Table -AutoSize

Write-Host ''
Write-Host 'Done. If your relay endpoint is already running, restart the TLS terminator/container to pick up cert.pem and key.pem.'
