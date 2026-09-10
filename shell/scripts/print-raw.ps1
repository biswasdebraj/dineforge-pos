<#
Sends raw ESC/POS bytes to a Windows-installed printer via the Win32 print
spooler (winspool.drv), bypassing the Windows print driver / GDI entirely.
This is how USB thermal printers are driven: they're installed as ordinary
Windows printers (any USB thermal printer ships a driver for this), and the
spooler accepts a RAW datatype job that gets passed straight through to the
device with no reformatting.

No native Node module or compiler toolchain is needed for this — it's why
USB support uses this instead of a node-gyp-built printer binding.
#>
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static void SendBytesToPrinter(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "DineForge POS Ticket";
        di.pDataType = "RAW";

        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Could not open printer '" + printerName + "' (code " + Marshal.GetLastWin32Error() + "). Check the name in Admin > Settings > Printer.");

        try
        {
            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed (code " + Marshal.GetLastWin32Error() + ").");
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed (code " + Marshal.GetLastWin32Error() + ").");
                try
                {
                    IntPtr pUnmanagedBytes = Marshal.AllocHGlobal(bytes.Length);
                    try
                    {
                        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                        int written;
                        bool ok = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                        if (!ok || written != bytes.Length)
                            throw new Exception("WritePrinter failed or wrote incomplete data (code " + Marshal.GetLastWin32Error() + ").");
                    }
                    finally { Marshal.FreeHGlobal(pUnmanagedBytes); }
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
"@

try {
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    [RawPrinterHelper]::SendBytesToPrinter($PrinterName, $bytes)
    Write-Output 'OK'
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
