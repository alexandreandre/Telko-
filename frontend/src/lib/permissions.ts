import { LucideIcon, MessageSquare, Scale, Shield, TicketCheck, Users, Receipt, Activity, BarChart3, Database, UserCog } from "lucide-react";

export interface PagePermission {
  path: string;
  title: string;
  icon: LucideIcon;
  /** Rôles métier autorisés. Si vide/absent = tous les rôles. */
  allowedRoles?: string[];
  /** Nécessite le rôle système admin */
  requireAdmin?: boolean;
}

export const pages: PagePermission[] = [
  {
    path: "/assistant",
    title: "Assistant",
    icon: MessageSquare,
  },
  {
    path: "/llm-comparator",
    title: "Comparateur LLM",
    icon: Scale,
  },
  {
    path: "/tickets",
    title: "Tickets",
    icon: TicketCheck,
    allowedRoles: ["Support", "Administrateur"],
  },
  {
    path: "/clients",
    title: "CRM — Clients",
    icon: Users,
    allowedRoles: ["Commercial", "Administrateur"],
  },
  {
    path: "/factures",
    title: "Factures",
    icon: Receipt,
    allowedRoles: ["Finance", "Administrateur"],
  },
  {
    path: "/monitoring",
    title: "Monitoring",
    icon: Activity,
    allowedRoles: ["Développeur", "Administrateur"],
  },
  {
    path: "/rapports",
    title: "Rapports",
    icon: BarChart3,
    allowedRoles: ["Manager", "Finance", "Administrateur"],
  },
  {
    path: "/knowledge-base",
    title: "Base documentaire",
    icon: Database,
  },
  {
    path: "/profil",
    title: "Mon profil",
    icon: UserCog,
  },
  {
    path: "/admin",
    title: "Administration",
    icon: Shield,
    requireAdmin: true,
  },
];

export function canAccess(
  page: PagePermission,
  roleName: string | null | undefined,
  isAdmin: boolean
): boolean {
  if (page.requireAdmin && !isAdmin) return false;
  if (page.allowedRoles && page.allowedRoles.length > 0) {
    if (isAdmin) return true;
    if (!roleName) return false;
    return page.allowedRoles.includes(roleName);
  }
  return true;
}
