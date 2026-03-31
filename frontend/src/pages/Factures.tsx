import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, FileText } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const statutColors: Record<string, string> = {
  Payée: "bg-green-500/10 text-green-700 border-green-500/20",
  "En attente": "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  "En retard": "bg-destructive/10 text-destructive border-destructive/20",
  Annulée: "bg-muted text-muted-foreground border-border",
};

const factures = [
  { id: "FAC-2026-001", client: "Acme Corp", montant: "12 500,00 €", date: "2026-03-01", echeance: "2026-03-31", statut: "En attente" },
  { id: "FAC-2026-002", client: "MegaStore", montant: "28 000,00 €", date: "2026-02-15", echeance: "2026-03-15", statut: "Payée" },
  { id: "FAC-2026-003", client: "TechnoPlus", montant: "7 800,00 €", date: "2026-02-01", echeance: "2026-03-01", statut: "En retard" },
  { id: "FAC-2026-004", client: "DataFlow", montant: "4 200,00 €", date: "2026-01-15", echeance: "2026-02-15", statut: "Payée" },
  { id: "FAC-2026-005", client: "StartupXYZ", montant: "1 500,00 €", date: "2026-03-10", echeance: "2026-04-10", statut: "En attente" },
  { id: "FAC-2026-006", client: "GreenTech", montant: "3 100,00 €", date: "2026-01-01", echeance: "2026-02-01", statut: "Annulée" },
];

export default function Factures() {
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filtered = factures.filter(
    (f) => f.client.toLowerCase().includes(search.toLowerCase()) || f.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Factures</h1>
            <p className="text-sm text-muted-foreground">Suivi de la facturation et des paiements</p>
          </div>
          <Button variant="outline" onClick={() => toast({ title: "Bientôt disponible", description: "L'export sera connecté au système comptable." })}>
            <Download className="mr-2 h-4 w-4" /> Exporter
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total facturé", value: "57 100 €" },
            { label: "Payé", value: "32 200 €" },
            { label: "En attente", value: "14 000 €" },
            { label: "En retard", value: "7 800 €" },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Rechercher une facture..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Facture</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>Date émission</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((f) => (
                  <TableRow key={f.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">{f.id}</TableCell>
                    <TableCell className="font-medium">{f.client}</TableCell>
                    <TableCell className="font-mono">{f.montant}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.date}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.echeance}</TableCell>
                    <TableCell><Badge variant="outline" className={statutColors[f.statut]}>{f.statut}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
