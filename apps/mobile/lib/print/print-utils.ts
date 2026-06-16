/**
 * Print Utilities — expo-print + expo-sharing wrappers
 *
 * Provides print and share capabilities for receipts, invoices, tickets.
 * Supports AirPrint (iOS) and Android print dialog.
 */

import { SafePrint as Print } from "@/lib/safe-native-modules";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

export interface PrintResult {
  success: boolean;
  error?: string;
}

/**
 * Print HTML content via system print dialog (AirPrint / Android).
 *
 * iOS 26+: Passing raw HTML to printAsync crashes the native TurboModule.
 * Workaround: render to a temp PDF first, then print the file URI.
 */
export async function printHtml(html: string): Promise<PrintResult> {
  try {
    if (!html) {
      return { success: false, error: "No content to print" };
    }

    if (Platform.OS === "ios") {
      // Safe path: HTML → temp PDF → print URI (avoids native SIGSEGV)
      const { uri } = await Print.printToFileAsync({ html });
      await Print.printAsync({ uri });
      // Clean up temp file
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } else {
      await Print.printAsync({ html });
    }

    return { success: true };
  } catch (err: any) {
    // User cancellation is not an error
    if (err.message?.includes("cancel") || err.message?.includes("dismiss")) {
      return { success: true };
    }
    console.error("[Print] printHtml error:", err);
    return { success: false, error: err.message || "Print failed" };
  }
}

/**
 * Print a PDF from a remote URL.
 * Downloads the PDF first, then sends to system printer.
 */
export async function printPdfUrl(url: string): Promise<PrintResult> {
  try {
    // Download PDF to temp file
    const tempPath = `${FileSystem.cacheDirectory}dvnt-print-${Date.now()}.pdf`;
    const download = await FileSystem.downloadAsync(url, tempPath);

    if (download.status !== 200) {
      return { success: false, error: "Failed to download PDF" };
    }

    await Print.printAsync({ uri: download.uri });

    // Clean up temp file
    FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});

    return { success: true };
  } catch (err: any) {
    console.error("[Print] printPdfUrl error:", err);
    return { success: false, error: err.message || "Print failed" };
  }
}

/**
 * Generate a PDF from HTML and return the local file URI.
 * Useful for saving / sharing generated receipts.
 */
export async function htmlToPdf(
  html: string,
  width?: number,
  height?: number,
): Promise<{ uri?: string; error?: string }> {
  try {
    const result = await Print.printToFileAsync({
      html,
      width: width || 612, // Letter width in points
      height: height || 792, // Letter height in points
    });
    return { uri: result.uri };
  } catch (err: any) {
    console.error("[Print] htmlToPdf error:", err);
    return { error: err.message || "PDF generation failed" };
  }
}

/**
 * Share a file via system share sheet.
 */
export async function shareFile(
  uri: string,
  mimeType: string = "application/pdf",
): Promise<PrintResult> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { success: false, error: "Sharing not available on this device" };
    }

    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: "Share Document",
      UTI: mimeType === "application/pdf" ? "com.adobe.pdf" : undefined,
    });

    return { success: true };
  } catch (err: any) {
    // User cancellation is not an error
    if (err.message?.includes("cancel") || err.message?.includes("dismiss")) {
      return { success: true };
    }
    console.error("[Print] shareFile error:", err);
    return { success: false, error: err.message || "Share failed" };
  }
}

/**
 * Share a PDF generated from HTML.
 */
export async function shareHtmlAsPdf(html: string): Promise<PrintResult> {
  const { uri, error } = await htmlToPdf(html);
  if (!uri || error) {
    return { success: false, error: error || "PDF generation failed" };
  }
  return shareFile(uri);
}

/**
 * Download a remote PDF and share it.
 */
export async function sharePdfUrl(url: string): Promise<PrintResult> {
  try {
    const tempPath = `${FileSystem.cacheDirectory}dvnt-share-${Date.now()}.pdf`;
    const download = await FileSystem.downloadAsync(url, tempPath);

    if (download.status !== 200) {
      return { success: false, error: "Failed to download PDF" };
    }

    return shareFile(download.uri);
  } catch (err: any) {
    console.error("[Print] sharePdfUrl error:", err);
    return { success: false, error: err.message || "Share failed" };
  }
}
