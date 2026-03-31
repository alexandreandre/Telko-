import AppLayout from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, BookOpen, FileText, Clock } from "lucide-react";
import { useState } from "react";

const categories = ["Tous", "Procédures", "Guides", "Politique", "Technique"];

const articles = [
  { titre: "Procédure d'onboarding des nouveaux employés", categorie: "Procédures", maj: "2026-03-10", auteur: "RH", resume: "Guide complet pour l'intégration des nouveaux collaborateurs : accès, formation, équipement." },
  { titre: "Guide d'utilisation du CRM", categorie: "Guides", maj: "2026-03-08", auteur: "Commercial", resume: "Comment utiliser le CRM pour gérer les contacts, opportunités et pipeline commercial." },
  { titre: "Politique de sécurité informatique", categorie: "Politique", maj: "2026-02-28", auteur: "IT", resume: "Règles de sécurité : mots de passe, VPN, accès aux données, signalement d'incidents." },
  { titre: "Architecture technique — Vue d'ensemble", categorie: "Technique", maj: "2026-03-05", auteur: "Développement", resume: "Documentation de l'architecture microservices, APIs et bases de données." },
  { titre: "Procédure de gestion des incidents", categorie: "Procédures", maj: "2026-03-01", auteur: "Support", resume: "Workflow de traitement des incidents : classification, escalade, résolution." },
  { titre: "Guide des avantages sociaux", categorie: "Guides", maj: "2026-02-15", auteur: "RH", resume: "Mutuelle, tickets restaurant, télétravail, congés spéciaux et autres avantages." },
  { titre: "Politique RGPD et données personnelles", categorie: "Politique", maj: "2026-01-20", auteur: "Juridique", resume: "Obligations RGPD, traitement des données clients, droits des utilisateurs." },
  { titre: "Guide de déploiement CI/CD", categorie: "Technique", maj: "2026-03-12", auteur: "DevOps", resume: "Pipeline de déploiement, tests automatisés, rollback et monitoring." },
];

export default function Documentation() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("Tous");

  const filtered = articles.filter((a) => {
    const matchSearch = a.titre.toLowerCase().includes(search.toLowerCase()) || a.resume.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "Tous" || a.categorie === activeCategory;
    return matchSearch && matchCat;
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Base de connaissances</h1>
          <p className="text-sm text-muted-foreground">Documentation interne et procédures de l'entreprise</p>
        </div>

        <div className="flex gap-4 items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Rechercher dans la documentation..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2">
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant={activeCategory === cat ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Badge>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {filtered.map((a) => (
            <Card key={a.titre} className="hover:bg-muted/30 cursor-pointer transition-colors">
              <CardContent className="p-5 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <h3 className="text-sm font-medium text-foreground">{a.titre}</h3>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">{a.categorie}</Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{a.resume}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{a.auteur}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Mis à jour le {a.maj}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
