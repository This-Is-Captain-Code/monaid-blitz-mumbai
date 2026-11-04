# Run the Monaid broker in the foreground with this folder's config.
# Firewall (once, admin): New-NetFirewallRule -DisplayName "Monaid MQTT" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow
Set-Location $PSScriptRoot
& "C:\Program Files\mosquitto\mosquitto.exe" -c mosquitto.conf -v
