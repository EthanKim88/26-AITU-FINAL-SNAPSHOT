export type ImportFormat =
  | "full-scan"
  | "modbus-scanner"
  | "modbus-rw"
  | "ad-enum"
  | "protocol-detect"
  | "scada-template"
  | "unknown";

export function detectFormat(data: unknown): ImportFormat {
  if (!data || typeof data !== "object") return "unknown";
  const obj = data as Record<string, unknown>;

  // full-scan: has "hosts" array with entries containing "ports"
  if (Array.isArray(obj.hosts) && obj.hosts.length > 0 && Array.isArray((obj.hosts[0] as Record<string, unknown>)?.ports)) {
    return "full-scan";
  }

  // full-scan (dict format): has "hosts" object keyed by IP with entries containing "ports"
  if (obj.hosts && typeof obj.hosts === "object" && !Array.isArray(obj.hosts)) {
    const firstKey = Object.keys(obj.hosts as Record<string, unknown>)[0];
    if (firstKey && Array.isArray(((obj.hosts as Record<string, unknown>)[firstKey] as Record<string, unknown>)?.ports)) {
      return "full-scan";
    }
  }

  // full-scan (host discovery): has "hosts" array but entries have no ports or empty ports
  if (Array.isArray(obj.hosts) && obj.hosts.length > 0 && typeof (obj.hosts[0] as Record<string, unknown>)?.ip === "string") {
    return "full-scan";
  }

  // modbus-scanner: has "devices" array with entries containing "registers"
  if (Array.isArray(obj.devices) && obj.devices.length > 0 && Array.isArray((obj.devices[0] as Record<string, unknown>)?.registers)) {
    return "modbus-scanner";
  }

  // protocol-detect: has "host" + "services" array
  if (typeof obj.host === "string" && Array.isArray(obj.services)) {
    return "protocol-detect";
  }

  // generic SCADA template outputs
  if (
    typeof obj.host === "string" &&
    (
      Array.isArray(obj.nodes) ||
      Array.isArray(obj.endpoints) ||
      obj.units ||
      obj.cpu_info ||
      obj.dbs ||
      Array.isArray(obj.topics) ||
      obj.identity ||
      Array.isArray(obj.tags) ||
      Array.isArray(obj.active_addresses) ||
      obj.class0 ||
      obj.class123 ||
      Array.isArray(obj.data_points) ||
      Array.isArray(obj.who_is) ||
      Array.isArray(obj.objects)
    )
  ) {
    return "scada-template";
  }

  // ad-enum: has "domain_info" or top-level domain + users/groups/computers
  if (obj.domain_info || (obj.domain && (obj.users || obj.groups || obj.computers))) {
    return "ad-enum";
  }

  // modbus-rw: has "registers" or "read_results" or "write_results"
  if (obj.registers || obj.read_results || obj.write_results) {
    return "modbus-rw";
  }

  return "unknown";
}
