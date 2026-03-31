import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { pages, canAccess } from "@/lib/permissions";

interface Props {
  children: React.ReactNode;
  requireAdmin?: boolean;
  path?: string;
}

export default function ProtectedRoute({ children, requireAdmin, path }: Props) {
  const { user, isAdmin, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Chargement...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/dashboard" replace />;

  // Check role-based page access
  if (path) {
    const page = pages.find((p) => p.path === path);
    if (page && !canAccess(page, role?.role_name, isAdmin)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
