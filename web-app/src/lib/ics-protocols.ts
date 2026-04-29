export type ProtocolGrade = "A+" | "A" | "A-" | "B-" | "C" | "D";
export type ProtocolCoverage = "well-covered" | "partial" | "not-covered";

export interface IcsProtocolMeta {
  key: string;
  name: string;
  port: number;
  grade: ProtocolGrade;
  category: ProtocolCoverage;
  library: {
    name: string;
    installed: boolean;
    recommended?: string;
  };
  template?: string;
  nmap?: string;
}

export const ICS_PROTOCOLS: IcsProtocolMeta[] = [
  {
    key: "modbus",
    name: "Modbus TCP",
    port: 502,
    grade: "A+",
    category: "well-covered",
    library: { name: "pymodbus", installed: true },
    template: "modbus_tcp.py",
    nmap: "modbus-discover.nse",
  },
  {
    key: "opcua",
    name: "OPC UA",
    port: 4840,
    grade: "A",
    category: "well-covered",
    library: { name: "asyncua", installed: true },
    template: "opcua_client.py",
  },
  {
    key: "s7comm",
    name: "S7comm",
    port: 102,
    grade: "A-",
    category: "well-covered",
    library: { name: "python-snap7", installed: true },
    template: "s7comm_client.py",
    nmap: "s7-info.nse",
  },
  {
    key: "mqtt",
    name: "MQTT",
    port: 1883,
    grade: "A-",
    category: "well-covered",
    library: { name: "paho-mqtt", installed: true },
    template: "mqtt_client.py",
  },
  {
    key: "enip",
    name: "EtherNet/IP",
    port: 44818,
    grade: "A-",
    category: "well-covered",
    library: { name: "pycomm3/cpppo", installed: true },
    template: "enip_client.py",
    nmap: "enip-info.nse",
  },
  {
    key: "bacnet",
    name: "BACnet/IP",
    port: 47808,
    grade: "B-",
    category: "partial",
    library: { name: "scapy (raw)", installed: true, recommended: "bacpypes3" },
    template: "bacnet_scan.py",
    nmap: "bacnet-info.nse",
  },
  {
    key: "dnp3",
    name: "DNP3",
    port: 20000,
    grade: "B-",
    category: "partial",
    library: { name: "scapy (raw)", installed: true },
    template: "dnp3_client.py",
  },
  {
    key: "iec104",
    name: "IEC 60870-5-104",
    port: 2404,
    grade: "B-",
    category: "partial",
    library: { name: "scapy (raw)", installed: true },
    template: "iec104_client.py",
  },
];

