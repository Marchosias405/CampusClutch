#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$package = 'com.marchosias405.campusclutch'
$apk = Join-Path (Split-Path $PSScriptRoot -Parent) 'CampusClutch-Preview.apk'
$cache = Join-Path $env:LOCALAPPDATA 'CampusClutch\Preview'
$defaultAvd = 'CampusClutch_Test_API35'
$image = 'system-images;android-35;google_apis;x86_64'

function Install-ToolArchive($url, $sha256, $destination) {
    $parent = Split-Path $destination -Parent
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    # Expand beside the destination so an interrupted download can be retried.
    $stage = Join-Path $parent ([guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    try {
        $archive = Join-Path $stage 'download.zip'
        Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
        if ((Get-FileHash -LiteralPath $archive).Hash -ne $sha256) { throw "Checksum failed for $url. Run the launcher again." }
        $unpacked = Join-Path $stage 'unpacked'
        [IO.Directory]::CreateDirectory($unpacked) | Out-Null
        # Windows tar supports the long library paths in Google's SDK archive.
        & "$env:SystemRoot\System32\tar.exe" -xf $archive -C $unpacked
        if ($LASTEXITCODE -ne 0) { throw "Could not unpack $url. Check available disk space and retry." }
        $roots = @(Get-ChildItem -LiteralPath $unpacked -Directory)
        if ($roots.Count -ne 1) { throw "Unexpected archive layout for $url." }
        [IO.Directory]::Move($roots[0].FullName, $destination)
    } finally {
        $resolved = (Resolve-Path -LiteralPath $stage).ProviderPath
        if ((Split-Path $resolved -Parent) -eq [IO.Path]::GetFullPath($parent) -and (Split-Path $resolved -Leaf) -match '^[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

function Get-SdkTools {
    $runtime = Join-Path $cache 'java-21.0.13'
    $javaRoots = @($env:JAVA_HOME, (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'), $runtime)
    $java = $javaRoots | Where-Object {
        $_ -and (Test-Path -LiteralPath "$_\bin\java.exe") -and (Test-Path -LiteralPath "$_\release") -and
            (Select-String -LiteralPath "$_\release" -Pattern '^JAVA_VERSION="(\d+)' | ForEach-Object { [int]$_.Matches[0].Groups[1].Value -ge 21 })
    } | Select-Object -First 1
    if (-not $java) {
        Write-Host 'Downloading the Java runtime for Android setup...'
        Install-ToolArchive 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jre_x64_windows_hotspot_21.0.13_9.zip' '2332c0b4cff6bed722da3567c91d5e47568bcba863fa4945d0a8d6fc76158628' $runtime
        $java = $runtime
    }
    $env:JAVA_HOME = $java
    $tools = Join-Path $sdk 'cmdline-tools\latest'
    if (-not (Test-Path -LiteralPath "$tools\bin\sdkmanager.bat")) {
        $tools = Join-Path $sdk 'cmdline-tools\23.0'
        if (-not (Test-Path -LiteralPath "$tools\bin\sdkmanager.bat")) {
            Write-Host 'Downloading Android SDK tools...'
            Install-ToolArchive 'https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip' 'e5885e2e59038c0778a85fc19f01de7ce7c567c105553f7617b936b1e0e87b2b' $tools
        }
    }
    return "$tools\bin"
}

function Get-DeviceNames {
    if (Test-Path -LiteralPath $emulator) {
        & $emulator -list-avds | Where-Object { $_ -match '^[\w.-]+$' }
        if ($LASTEXITCODE -ne 0) { throw 'Android could not list its virtual phones.' }
    }
}

function Install-SdkPackages($tools, [string[]]$packages) {
    if (Test-Path -LiteralPath "$tools\android.exe") {
        # The native CLI uses slash-separated package paths.
        $paths = @($packages | ForEach-Object { $_.Replace(';', '/') })
        & "$tools\android.exe" "--sdk=$sdk" sdk install @paths
    } else {
        & "$tools\sdkmanager.bat" "--sdk_root=$sdk" @packages
    }
    if ($LASTEXITCODE -ne 0) { throw 'Android package download failed. Check the error above and rerun.' }
}

function Find-RunningDevice($name) {
    foreach ($device in (& $adb devices)) {
        if ($device -match '^(emulator-\d+)\s+device\s*$') {
            $id = $Matches[1]
            if ((& $adb -s $id emu avd name) -contains $name) { return $id }
        }
    }
}

function Open-Preview($target) {
    Write-Host 'Installing CampusClutch...'
    & $adb -s $target install -r $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK installation failed. See the Android error above.' }
    & $adb -s $target shell input keyevent KEYCODE_WAKEUP
    & $adb -s $target shell wm dismiss-keyguard
    & $adb -s $target shell am start -W -n "$package/.MainActivity"
    if ($LASTEXITCODE -ne 0) { throw 'Android could not open CampusClutch.' }
    Write-Host 'CampusClutch is ready to test.'
}

try {
    if (-not (Test-Path -LiteralPath $apk)) { throw 'CampusClutch-Preview.apk is missing. Run git pull in the cloned folder.' }
    $roots = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk'), (Join-Path $cache 'sdk'))
    $sdk = $roots | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -First 1
    if (-not $sdk) { $sdk = Join-Path $cache 'sdk' }
    $env:ANDROID_HOME = $env:ANDROID_SDK_ROOT = $sdk
    $adb = Join-Path $sdk 'platform-tools\adb.exe'
    $emulator = Join-Path $sdk 'emulator\emulator.exe'
    if (-not (Test-Path -LiteralPath $emulator)) {
        # A tester may already have an emulator running with only adb on PATH.
        $available = if (Test-Path -LiteralPath $adb) { $adb } else { (Get-Command adb.exe -ErrorAction SilentlyContinue).Source }
        if ($available) {
            $active = @(& $available devices | ForEach-Object { if ($_ -match '^(emulator-\d+)\s+device\s*$') { $Matches[1] } })
            if ($active.Count -eq 1 -and ((& $available -s $active[0] shell getprop sys.boot_completed) -join '').Trim() -eq '1') {
                $adb = $available
                Open-Preview $active[0]
                return
            }
        }
    }
    $names = @(Get-DeviceNames)
    if (-not $names.Count -or -not (Test-Path -LiteralPath $adb)) {
        if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
            throw 'Automatic emulator setup needs an Intel or AMD 64-bit Windows PC.'
        }
        $archImage = Join-Path $sdk 'system-images\android-35\google_apis\x86_64\system.img'
        $missing = @()
        if (-not (Test-Path -LiteralPath $adb)) { $missing += 'platform-tools' }
        if (-not (Test-Path -LiteralPath $emulator)) { $missing += 'emulator' }
        if (-not $names.Count -and -not (Test-Path -LiteralPath $archImage)) { $missing += $image }
        if ($missing.Count) {
            $terms = 'https://developer.android.com/studio#terms-and-conditions'
            Write-Host "Android setup will download the missing packages. Review Google's SDK terms at $terms"
            if ((Read-Host 'Type yes to accept the SDK terms and continue') -ne 'yes') { throw 'Setup cancelled.' }
        }
        $tools = Get-SdkTools
        if ($missing.Count) {
            Install-SdkPackages $tools $missing
            if (-not (Test-Path -LiteralPath $adb) -or -not (Test-Path -LiteralPath $emulator) -or
                (-not $names.Count -and -not (Test-Path -LiteralPath $archImage))) {
                throw 'Android packages are incomplete. Rerun the launcher and review the license prompts.'
            }
        }
        if (-not $names.Count) {
            Write-Host 'Creating your CampusClutch virtual phone...'
            'no' | & "$tools\avdmanager.bat" create avd --name $defaultAvd --package $image --device pixel_6
            if ($LASTEXITCODE -ne 0) { throw 'Android could not create the virtual phone.' }
            $names = @(Get-DeviceNames)
            if ($names -notcontains $defaultAvd) { throw 'Android could not find the new virtual phone.' }
        }
    }
    $name = $names[0]
    if ($names -contains $defaultAvd) { $name = $defaultAvd }
    elseif ($names.Count -gt 1) {
        $running = @($names | Where-Object { Find-RunningDevice $_ })
        if ($running.Count -eq 1) { $name = $running[0] }
        else {
            for ($i = 0; $i -lt $names.Count; $i++) { Write-Host "$($i+1). $($names[$i])" }
            $choice = Read-Host 'Choose a virtual phone by number'
            if ($choice -notmatch '^\d+$' -or [int]$choice -lt 1 -or [int]$choice -gt $names.Count) { throw 'Invalid virtual phone number.' }
            $name = $names[[int]$choice-1]
        }
    }
    $serial = Find-RunningDevice $name
    if (-not $serial) {
        Write-Host "Starting $name. The first boot can take a few minutes..."
        $process = Start-Process -FilePath $emulator -ArgumentList @('-avd', $name, '-no-boot-anim') -PassThru
    }
    $deadline = (Get-Date).AddMinutes(6)
    do {
        if (-not $serial) { $serial = Find-RunningDevice $name }
        if ($serial -and ((& $adb -s $serial shell getprop sys.boot_completed) -join '').Trim() -eq '1') { break }
        if (($process -and $process.HasExited -and $process.ExitCode -ne 0) -or (Get-Date) -ge $deadline) {
            throw 'Android did not finish starting. Check hardware virtualization and Windows Hypervisor Platform, then rerun.'
        }
        Start-Sleep -Seconds 2
    } while ($true)
    Open-Preview $serial
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
