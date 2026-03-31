import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, Users, DollarSign, Target, BarChart3 } from "lucide-react";

const kpis = [
  { label: "Chiffre d'affaires", value: "245 800 €", change: "+12%", up: true, icon: DollarSign },
  { label: "Nouveaux clients", value: "28", change: "+8%", up: true, icon: Users },
  { label: "Taux de rétention", value: "94%", change: "+2%", up: true, icon: Target },
  { label: "Tickets résolus", value: "156", change: "-5%", up: false, icon: BarChart3 },
];

const departments = [
  { nom: "Commercial", objectif: 85, reel: 92, budget: "120 000 €", depense: "98 500 €" },
  { nom: "Support", objectif: 90, reel: 88, budget: "45 000 €", depense: "42 100 €" },
  { nom: "Développement", objectif: 80, reel: 78, budget: "200 000 €", depense: "185 000 €" },
  { nom: "Marketing", objectif: 75, reel: 81, budget: "80 000 €", depense: "72 300 €" },
  { nom: "Finance", objectif: 95, reel: 97, budget: "35 000 €", depense: "31 200 €" },
];

const recentReports = [
  { titre: "Rapport mensuel — Février 2026", type: "Mensuel", date: "2026-03-05", auteur: "Direction" },
  { titre: "Analyse churn Q1 2026", type: "Analyse", date: "2026-03-02", auteur: "Commercial" },
  { titre: "Performance support — Semaine 10", type: "Hebdo", date: "2026-03-08", auteur: "Support" },
  { titre: "Budget prévisionnel Q2", type: "Budget", date: "2026-03-01", auteur: "Finance" },
];

export default function Rapports() {
  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Rapports & KPIs</h1>
          <p className="text-sm text-muted-foreground">Vue d'ensemble des performances — Mars 2026</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <k.icon className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{k.value}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted-foreground">{k.label}</p>
                    <span className={`text-xs font-medium flex items-center gap-0.5 ${k.up ? "text-green-600" : "text-destructive"}`}>
                      {k.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {k.change}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="text-sm">Performance par département</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {departments.map((d) => (
                <div key={d.nom} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-foreground">{d.nom}</span>
                    <span className={d.reel >= d.objectif ? "text-green-600" : "text-destructive"}>
                      {d.reel}% / {d.objectif}%
                    </span>
                  </div>
                  <Progress value={d.reel} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Budget: {d.budget}</span>
                    <span>Dépensé: {d.depense}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Rapports récents</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {recentReports.map((r) => (
                <div key={r.titre} className="border border-border rounded-md p-3 hover:bg-muted/50 cursor-pointer">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.titre}</p>
                      <p className="text-xs text-muted-foreground">{r.auteur} · {r.date}</p>
                    </div>
                    <Badge variant="outline">{r.type}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
