import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { detectFormat } from "@/lib/import/detect";
import { importFullScan } from "@/lib/import/importers/full-scan";
import { importModbusScanner } from "@/lib/import/importers/modbus-scanner";
import { importModbusRw } from "@/lib/import/importers/modbus-rw";
import { importAdEnum } from "@/lib/import/importers/ad-enum";
import { importProtocolDetect } from "@/lib/import/importers/protocol-detect";
import { importScadaTemplate } from "@/lib/import/importers/scada-template";

export async function POST(request: Request) {
  try {
    const data = await parseBody<unknown>(request);
    const format = detectFormat(data);

    if (format === "unknown") {
      return apiError(
        "Could not detect JSON format. Supported: full-scan, modbus-scanner, modbus-rw, ad-enum, protocol-detect, scada-template",
        400
      );
    }

    let result;
    switch (format) {
      case "full-scan":
        result = await importFullScan(data as Parameters<typeof importFullScan>[0]);
        break;
      case "modbus-scanner":
        result = await importModbusScanner(data as Parameters<typeof importModbusScanner>[0]);
        break;
      case "modbus-rw":
        result = await importModbusRw(data as Parameters<typeof importModbusRw>[0]);
        break;
      case "ad-enum":
        result = await importAdEnum(data as Parameters<typeof importAdEnum>[0]);
        break;
      case "protocol-detect":
        result = await importProtocolDetect(data as Parameters<typeof importProtocolDetect>[0]);
        break;
      case "scada-template":
        result = await importScadaTemplate(data as Parameters<typeof importScadaTemplate>[0]);
        break;
    }

    const scadaFormats = new Set(["modbus-scanner", "modbus-rw", "protocol-detect", "scada-template"]);

    // Log import event
    await prisma.event.create({
      data: {
        type: "scan",
        category: scadaFormats.has(format) ? "scada" : format === "ad-enum" ? "ad" : "general",
        source: "import",
        message: `Imported ${format} data: ${JSON.stringify(result.created)}`,
        data: JSON.stringify(result),
      },
    });

    return apiSuccess(result);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
