"use client";

import { useState, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileJson, CheckCircle2 } from "lucide-react";
import { detectFormat, type ImportFormat } from "@/lib/import/detect";
import { apiPost } from "@/lib/fetcher";
import type { ImportResult } from "@/lib/import/types";

const formatLabels: Record<ImportFormat, string> = {
  "full-scan": "Network Scan (full_scan.py)",
  "modbus-scanner": "Modbus Scanner (modbus_scanner.py)",
  "modbus-rw": "Modbus R/W (modbus_rw.py)",
  "ad-enum": "AD Enumeration (ad_enum.py)",
  "protocol-detect": "SCADA Protocol Detect (protocol_detect.py)",
  "scada-template": "SCADA Template Output (scripts/templates/*.py)",
  "unknown": "Unknown Format",
};

export function ImportClient() {
  const [jsonData, setJsonData] = useState<unknown>(null);
  const [format, setFormat] = useState<ImportFormat | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    setError("");
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        setJsonData(data);
        setFileName(file.name);
        setFormat(detectFormat(data));
      } catch {
        setError("Invalid JSON file");
        setJsonData(null);
        setFormat(null);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!jsonData || !format || format === "unknown") return;
    setImporting(true);
    setError("");
    try {
      const res = await apiPost<ImportResult>("/api/import", jsonData);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        className="border-2 border-dashed cursor-pointer hover:border-primary transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Upload className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drop JSON file here or click to browse</p>
          <p className="text-xs text-muted-foreground">
            Supports: full_scan.py, modbus_scanner.py, modbus_rw.py, ad_enum.py, protocol_detect.py, templates/*.py
          </p>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </CardContent>
      </Card>

      {format && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileJson className="h-4 w-4" />
              {fileName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Detected:</span>
              <Badge variant={format === "unknown" ? "destructive" : "default"}>{formatLabels[format]}</Badge>
            </div>
            {format !== "unknown" && (
              <Button onClick={handleImport} disabled={importing} className="w-full">
                {importing ? "Importing..." : "Import"}
              </Button>
            )}
            {format === "unknown" && (
              <p className="text-sm text-destructive">Could not detect format. Check that the JSON structure matches a supported format.</p>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertDescription>
            <p className="font-medium">Import complete ({result.format})</p>
            {Object.entries(result.created).map(([k, v]) => (
              <p key={k} className="text-sm">Created {v} {k}</p>
            ))}
            {Object.entries(result.updated).map(([k, v]) => (
              <p key={k} className="text-sm">Updated {v} {k}</p>
            ))}
            {result.errors.length > 0 && (
              <div className="mt-2">
                <p className="text-sm text-destructive">{result.errors.length} errors:</p>
                {result.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-destructive">{e}</p>)}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
