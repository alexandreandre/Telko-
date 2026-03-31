import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, TicketCheck } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const statusColors: Record<string, string> = {
  Ouvert: "bg-destructive/10 text-destructive border-destructive/20",
  "En cours": "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  Résolu: "bg-green-500/10 text-green-700 border-green-500/20",
  Fermé: "bg-muted text-muted-foreground border-border",
};

const priorityColors: Record<string, string> = {
  Haute: "bg-destructive/10 text-destructive border-destructive/20",
  Moyenne: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  Basse: "bg-muted text-muted-foreground border-border",
};

const tickets = [
  { id: "TKT-001", sujet: "Impossible de se connecter au VPN", client: "Acme Corp", statut: "Ouvert", priorite: "Haute", assigne: "Marie D.", date: "2026-03-14" },
  { id: "TKT-002", sujet: "Erreur 500 sur le portail client", client: "TechnoPlus", statut: "En cours", priorite: "Haute", assigne: "Pierre L.", date: "2026-03-13" },
  { id: "TKT-003", sujet: "Demande de réinitialisation mot de passe", client: "StartupXYZ", statut: "Résolu", priorite: "Basse", assigne: "Julie R.", date: "2026-03-12" },
  { id: "TKT-004", sujet: "Lenteur application mobile", client: "MegaStore", statut: "En cours", priorite: "Moyenne", assigne: "Marie D.", date: "2026-03-12" },
  { id: "TKT-005", sujet: "Facture incorrecte Q1", client: "Acme Corp", statut: "Ouvert", priorite: "Moyenne", assigne: "Non assigné", date: "2026-03-11" },
  { id: "TKT-006", sujet: "Migration données terminée", client: "DataFlow", statut: "Fermé", priorite: "Basse", assigne: "Pierre L.", date: "2026-03-10" },
];

export default function Tickets() {
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filtered = tickets.filter(
    (t) =>
      t.sujet.toLowerCase().includes(search.toLowerCase()) ||
      t.client.toLowerCase().includes(search.toLowerCase()) ||
      t.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Tickets Support</h1>
            <p className="text-sm text-muted-foreground">Gestion des demandes et incidents clients</p>
          </div>
          <Button onClick={() => toast({ title: "Bientôt disponible", description: "La création de tickets sera connectée au système de ticketing." })}>
            <Plus className="mr-2 h-4 w-4" /> Nouveau ticket
          </Button>
        </div>

        <div className="flex gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher un ticket..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2">
            {["Tous", "Ouvert", "En cours", "Résolu"].map((s) => (
              <Badge key={s} variant="outline" className="cursor-pointer hover:bg-muted">{s}</Badge>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Sujet</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Priorité</TableHead>
                  <TableHead>Assigné</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">{t.id}</TableCell>
                    <TableCell className="font-medium">{t.sujet}</TableCell>
                    <TableCell>{t.client}</TableCell>
                    <TableCell><Badge variant="outline" className={statusColors[t.statut]}>{t.statut}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className={priorityColors[t.priorite]}>{t.priorite}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{t.assigne}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{t.date}</TableCell>
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
