import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Building, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const clients = [
  { id: "CLI-001", nom: "Acme Corp", contact: "Jean Dupont", email: "j.dupont@acme.com", contrat: "Enterprise", ca: "45 000 €", statut: "Actif", tendance: "up" },
  { id: "CLI-002", nom: "TechnoPlus", contact: "Sophie Martin", email: "s.martin@technoplus.fr", contrat: "Pro", ca: "22 500 €", statut: "Actif", tendance: "up" },
  { id: "CLI-003", nom: "StartupXYZ", contact: "Paul Leroy", email: "p.leroy@startupxyz.io", contrat: "Starter", ca: "5 200 €", statut: "Actif", tendance: "stable" },
  { id: "CLI-004", nom: "MegaStore", contact: "Claire Petit", email: "c.petit@megastore.com", contrat: "Enterprise", ca: "78 000 €", statut: "Actif", tendance: "up" },
  { id: "CLI-005", nom: "DataFlow", contact: "Marc Girard", email: "m.girard@dataflow.eu", contrat: "Pro", ca: "15 800 €", statut: "En pause", tendance: "down" },
  { id: "CLI-006", nom: "GreenTech", contact: "Lucie Moreau", email: "l.moreau@greentech.fr", contrat: "Starter", ca: "3 100 €", statut: "Churned", tendance: "down" },
];

const statutColors: Record<string, string> = {
  Actif: "bg-green-500/10 text-green-700 border-green-500/20",
  "En pause": "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  Churned: "bg-destructive/10 text-destructive border-destructive/20",
};

const TendanceIcon = ({ t }: { t: string }) => {
  if (t === "up") return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (t === "down") return <TrendingDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

export default function Clients() {
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filtered = clients.filter(
    (c) => c.nom.toLowerCase().includes(search.toLowerCase()) || c.contact.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">CRM — Clients</h1>
            <p className="text-sm text-muted-foreground">Vue d'ensemble des comptes clients</p>
          </div>
          <Button onClick={() => toast({ title: "Bientôt disponible", description: "L'ajout de clients sera connecté au CRM." })}>
            <Plus className="mr-2 h-4 w-4" /> Nouveau client
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[{ label: "Clients actifs", value: "4" }, { label: "CA total", value: "169 600 €" }, { label: "Contrats Enterprise", value: "2" }].map((kpi) => (
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
          <Input placeholder="Rechercher un client..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entreprise</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Contrat</TableHead>
                  <TableHead>CA annuel</TableHead>
                  <TableHead>Tendance</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer">
                    <TableCell className="font-medium">{c.nom}</TableCell>
                    <TableCell>
                      <div>{c.contact}</div>
                      <div className="text-xs text-muted-foreground">{c.email}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{c.contrat}</Badge></TableCell>
                    <TableCell className="font-mono">{c.ca}</TableCell>
                    <TableCell><TendanceIcon t={c.tendance} /></TableCell>
                    <TableCell><Badge variant="outline" className={statutColors[c.statut]}>{c.statut}</Badge></TableCell>
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
