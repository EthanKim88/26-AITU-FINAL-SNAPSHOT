import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ScadaDeviceDetail } from "@/components/scada/scada-device-detail";
import { sanitizeScadaText } from "@/lib/scada-sanitize";

export default async function ScadaDeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;

  const device = await prisma.scadaDevice.findUnique({
    where: { id: deviceId },
    include: {
      registers: { orderBy: [{ registerType: "asc" }, { address: "asc" }] },
    },
  });

  if (!device) notFound();

  const sanitized = {
    ...device,
    description: sanitizeScadaText(device.description),
    registers: device.registers.map((r) => ({
      ...r,
      decodedValue: sanitizeScadaText(r.decodedValue),
      hexValue: sanitizeScadaText(r.hexValue),
    })),
  };

  return <ScadaDeviceDetail device={JSON.parse(JSON.stringify(sanitized))} />;
}
