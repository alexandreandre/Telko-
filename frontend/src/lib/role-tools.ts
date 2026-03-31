export interface Tool {
  name: string;
  description: string;
  path?: string;
}

export const toolsByRole: Record<string, Tool[]> = {
  Support: [
    { name: "Voir les tickets clients", description: "Consulter les tickets ouverts", path: "/tickets" },
    { name: "Rechercher dans la documentation", description: "Accéder à la base de connaissances", path: "/documentation" },
    { name: "Créer un ticket", description: "Ouvrir un nouveau ticket", path: "/tickets" },
  ],
  Commercial: [
    { name: "Accéder aux clients", description: "Liste des clients", path: "/clients" },
    { name: "Voir le CRM", description: "Tableau de bord CRM", path: "/clients" },
    { name: "Consulter les contrats", description: "Gestion des contrats", path: "/clients" },
  ],
  Finance: [
    { name: "Consulter les factures", description: "Liste des factures", path: "/factures" },
    { name: "Voir les paiements", description: "Suivi des paiements", path: "/factures" },
    { name: "Accéder aux rapports financiers", description: "Rapports et analyses", path: "/rapports" },
  ],
  Développeur: [
    { name: "Consulter les logs système", description: "Logs applicatifs", path: "/monitoring" },
    { name: "Voir l'état des serveurs", description: "Monitoring infrastructure", path: "/monitoring" },
    { name: "Accéder aux déploiements", description: "Historique des déploiements", path: "/monitoring" },
  ],
  Manager: [
    { name: "Consulter les performances", description: "KPIs et métriques", path: "/rapports" },
    { name: "Voir les rapports d'activité", description: "Rapports d'équipe", path: "/rapports" },
    { name: "Accéder aux statistiques globales", description: "Vue d'ensemble", path: "/rapports" },
  ],
  Administrateur: [
    { name: "Gestion des utilisateurs", description: "Créer et gérer les comptes", path: "/admin" },
    { name: "Configuration système", description: "Paramètres de la plateforme", path: "/admin" },
    { name: "Audit et logs", description: "Journal d'activité", path: "/monitoring" },
  ],
};
