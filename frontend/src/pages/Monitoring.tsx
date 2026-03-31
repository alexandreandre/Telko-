import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Server, Cpu, HardDrive, Wifi } from "lucide-react";

const servers = [
  { nom: "prod-api-01", statut: "En ligne", cpu: 42, ram: 68, disk: 55, uptime: "45j 12h" },
  { nom: "prod-api-02", statut: "En ligne", cpu: 38, ram: 72, disk: 51, uptime: "45j 12h" },
  { nom: "prod-db-01", statut: "En ligne", cpu: 65, ram: 85, disk: 72, uptime: "30j 8h" },
  { nom: "staging-01", statut: "En ligne", cpu: 12, ram: 34, disk: 28, uptime: "12j 3h" },
  { nom: "worker-01", statut: "Dégradé", cpu: 89, ram: 92, disk: 60, uptime: "5j 1h" },
  { nom: "cdn-edge-eu", statut: "En ligne", cpu: 15, ram: 22, disk: 40, uptime: "90j 0h" },
];

const logs = [
  { time: "14:32:05", level: "ERROR", service: "prod-api-01", message: "Connection timeout to database pool" },
  { time: "14:31:42", level: "WARN", service: "worker-01", message: "Memory usage exceeded 90% threshold" },
  { time: "14:30:18", level: "INFO", service: "prod-api-02", message: "Deployment v2.4.1 completed successfully" },
  { time: "14:28:55", level: "WARN", service: "prod-db-01", message: "Slow query detected: 2.3s on users_search" },
  { time: "14:25:10", level: "INFO", service: "cdn-edge-eu", message: "Cache purge completed for /api/v2/*" },
];

const levelColors: Record<string, string> = {
  ERROR: "bg-destructive/10 text-destructive border-destructive/20",
  WARN: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  INFO: "bg-muted text-muted-foreground border-border",
};

const statutColors: Record<string, string> = {
  "En ligne": "bg-green-500/10 text-green-700 border-green-500/20",
  Dégradé: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  "Hors ligne": "bg-destructive/10 text-destructive border-destructive/20",
};

const MetricBar = ({ value, label }: { value: number; label: string }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={value > 80 ? "text-destructive font-medium" : "text-foreground"}>{value}%</span>
    </div>
    <Progress value={value} className="h-1.5" />
  </div>
);

export default function Monitoring() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Monitoring</h1>
          <p className="text-sm text-muted-foreground">État des serveurs et logs système</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { icon: Server, label: "Serveurs", value: "6", sub: "5 en ligne" },
            { icon: Cpu, label: "CPU moyen", value: "43%", sub: "Normal" },
            { icon: HardDrive, label: "Stockage", value: "51%", sub: "2.4 TB libre" },
            { icon: Wifi, label: "Latence API", value: "45ms", sub: "P95: 120ms" },
          ].map((m) => (
            <Card key={m.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <m.icon className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{m.value}</p>
                  <p className="text-xs text-muted-foreground">{m.label} · {m.sub}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Server className="h-4 w-4" /> Serveurs</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {servers.map((s) => (
                <div key={s.nom} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium text-foreground">{s.nom}</span>
                    <Badge variant="outline" className={statutColors[s.statut]}>{s.statut}</Badge>
                  </div>
                  <MetricBar value={s.cpu} label="CPU" />
                  <MetricBar value={s.ram} label="RAM" />
                  <MetricBar value={s.disk} label="Disque" />
                  <p className="text-xs text-muted-foreground">Uptime: {s.uptime}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Logs récents</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Heure</TableHead>
                    <TableHead>Niveau</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{l.time}</TableCell>
                      <TableCell><Badge variant="outline" className={levelColors[l.level]}>{l.level}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{l.service}</TableCell>
                      <TableCell className="text-xs max-w-[300px] truncate">{l.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
