export interface ImportResult {
  format: string;
  created: Record<string, number>;
  updated: Record<string, number>;
  errors: string[];
}

// full-scan.py output
export interface FullScanData {
  hosts: {
    ip: string;
    hostname?: string;
    os?: string;
    os_version?: string;
    status?: string;
    smb_signing?: boolean;
    is_dc?: boolean;
    domain?: string;
    interfaces?: {
      name?: string;
      ip: string;
      cidr?: string;
    }[];
    routes?: {
      destination: string;
      gateway?: string;
      iface?: string;
      src_ip?: string;
      connected_ip?: string;
      metric?: number;
      is_default?: boolean;
      is_connected?: boolean;
      source?: string;
      raw?: string;
      notes?: string;
    }[];
    ports: {
      port: number;
      protocol?: string;
      state?: string;
      service?: string;
      version?: string;
      banner?: string;
    }[];
  }[];
}

// modbus_scanner.py output
export interface ModbusScannerData {
  devices: {
    host: string;
    port?: number;
    unit_id?: number;
    protocol?: string;
    description?: string;
    device_type?: string;
    vendor_name?: string;
    product_code?: string;
    revision?: string;
    product_name?: string;
    model_name?: string;
    registers: {
      register_type: string;
      address: number;
      raw_value: number;
      decoded_value?: string;
      hex_value?: string;
      is_non_zero?: boolean;
    }[];
  }[];
}

// modbus_rw.py output
export interface ModbusRwData {
  host?: string;
  port?: number;
  unit_id?: number;
  registers?: {
    register_type: string;
    address: number;
    raw_value: number;
    decoded_value?: string;
    hex_value?: string;
  }[];
  read_results?: {
    register_type: string;
    address: number;
    raw_value: number;
    decoded_value?: string;
    hex_value?: string;
  }[];
}

// protocol_detect.py output
export interface ProtocolDetectData {
  host: string;
  services?: {
    port?: number;
    open?: boolean;
    protocol?: string;
    description?: string;
    template?: string;
    banner_ascii?: string;
    banner_hex?: string;
    modbus_confirmed?: boolean;
  }[];
  next_steps?: string[];
}

// scripts/templates/*.py generic output
export interface ScadaTemplateData {
  host: string;
  port?: number;
  protocol?: string;
  error?: string;
  // OPC UA
  endpoints?: unknown[];
  nodes?: unknown[];
  node_count?: number;
  // Modbus template
  units?: Record<string, unknown>;
  // S7
  cpu_info?: unknown;
  cpu_state?: string;
  dbs?: Record<string, unknown>;
  // MQTT
  topics?: unknown[];
  messages_sample?: unknown[];
  // ENIP
  identity?: unknown;
  tags?: unknown[];
  values?: unknown[];
  // DNP3
  active_addresses?: unknown[];
  class0?: unknown;
  class123?: unknown;
  // IEC104
  data_points?: unknown[];
  response_count?: number;
  // BACnet
  who_is?: unknown[];
  objects?: unknown[];
}

// ad_enum.py output
export interface AdEnumData {
  domain_info?: {
    domain_name: string;
    dc_ip?: string;
    functional_level?: string;
    forest_level?: string;
    dc_level?: string;
    dns_hostname?: string;
    server_name?: string;
    password_policy?: Record<string, unknown>;
    smb_shares?: unknown[];
    dns_records?: unknown[];
    ous?: unknown[];
    attack_recommendations?: unknown[];
    errors?: unknown[];
  };
  domain?: string;
  users?: {
    username: string;
    description?: string;
    dn?: string;
    groups?: string[];
    spn?: string[];
    kerberoastable?: boolean;
    asrep_roastable?: boolean;
    admin_count?: boolean;
    last_logon?: string;
    pwd_last_set?: string;
    constrained_delegation_targets?: string[];
    email?: string;
  }[];
  groups?: {
    name: string;
    description?: string;
    dn?: string;
    members?: string[];
    member_count?: number;
    group_type?: string;
  }[];
  computers?: {
    name: string;
    dns_hostname?: string;
    os?: string;
    os_version?: string;
    os_service_pack?: string;
    dn?: string;
    is_dc?: boolean;
    unconstrained_delegation?: boolean;
    constrained_delegation?: string[];
    rbcd?: boolean;
  }[];
  trusts?: {
    name: string;
    direction?: string;
    trust_type?: string;
    flat_name?: string;
  }[];
  gpos?: {
    display_name: string;
    name?: string;
    path?: string;
  }[];
}
