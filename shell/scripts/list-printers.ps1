<#
Lists installed Windows printers by name, one per line, for the USB printer
picker in Admin > Settings. Uses WMI/CIM (Win32_Printer) rather than the
Get-Printer cmdlet since the latter needs the PrintManagement module, which
isn't guaranteed present on every Windows edition — Win32_Printer is core
WMI and always available.
#>
$ErrorActionPreference = 'Stop'
Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name
