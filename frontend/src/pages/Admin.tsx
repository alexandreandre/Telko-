import { useEffect, useState } from "react";
import { getApiBaseUrl } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Profile {
  id: string;
  name: string;
  email: string;
  department: string | null;
  company_id: string | null;
  role_id: string | null;
  created_at: string;
}

interface Role {
  id: string;
  role_name: string;
  description: string | null;
}

const DEPARTMENTS = [
  "Service client",
  "Commercial",
  "Finance",
  "Technique",
  "Management",
];

export default function Admin() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const { company } = useAuth();

  // Edit form state
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [formRoleId, setFormRoleId] = useState("");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newSystemRole, setNewSystemRole] = useState("user");

  const fetchData = async () => {
    const [{ data: profilesData }, { data: rolesData }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("roles").select("*"),
    ]);
    setProfiles(profilesData ?? []);
    setRoles(rolesData ?? []);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getRoleName = (roleId: string | null) => {
    if (!roleId) return "—";
    return roles.find((r) => r.id === roleId)?.role_name ?? "—";
  };

  const openEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormEmail(profile.email);
    setFormDepartment(profile.department ?? "");
    setFormRoleId(profile.role_id ?? "");
    setDialogOpen(true);
  };

  const openCreate = () => {
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewDepartment("");
    setNewRoleId("");
    setNewSystemRole("user");
    setCreateDialogOpen(true);
  };

  const handleCreate = async () => {
    if (!newEmail || !newPassword) {
      toast({ title: "Erreur", description: "Email et mot de passe requis", variant: "destructive" });
      return;
    }
    setCreating(true);

    let apiBase: string;
    try {
      apiBase = getApiBaseUrl();
    } catch {
      toast({ title: "Erreur", description: "VITE_API_URL non configuré.", variant: "destructive" });
      setCreating(false);
      return;
    }
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      toast({ title: "Erreur", description: "Session requise.", variant: "destructive" });
      setCreating(false);
      return;
    }

    const resp = await fetch(`${apiBase}/create-admin-user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: newEmail,
        password: newPassword,
        name: newName || newEmail.split("@")[0],
        role_id: newRoleId || null,
        department: newDepartment || null,
        company_id: company?.id || null,
        system_role: newSystemRole,
      }),
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || (data as { error?: string }).error) {
      toast({
        title: "Erreur",
        description: (data as { error?: string }).error || resp.statusText,
        variant: "destructive",
      });
    } else {
      toast({ title: "Utilisateur créé avec succès" });
      setCreateDialogOpen(false);
      fetchData();
    }
    setCreating(false);
  };

  const handleSave = async () => {
    if (!editingProfile) return;

    const { error } = await supabase
      .from("profiles")
      .update({
        name: formName,
        department: formDepartment || null,
        role_id: formRoleId || null,
        company_id: company?.id || null,
      })
      .eq("id", editingProfile.id);

    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Utilisateur mis à jour" });
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer cet utilisateur ?")) return;

    const { error } = await supabase.from("profiles").delete().eq("id", id);
    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Utilisateur supprimé" });
      fetchData();
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Administration</h1>

        {/* Users */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Utilisateurs</CardTitle>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Créer un utilisateur
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Département</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.email}</TableCell>
                    <TableCell>{getRoleName(p.role_id)}</TableCell>
                    <TableCell>{p.department ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      Aucun utilisateur
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Roles */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rôles métier</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom du rôle</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roles.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.role_name}</TableCell>
                    <TableCell>{r.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create User Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un utilisateur</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom complet" />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@exemple.com" />
              </div>
              <div className="space-y-2">
                <Label>Mot de passe *</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 6 caractères" />
              </div>
              <div className="space-y-2">
                <Label>Rôle métier</Label>
                <Select value={newRoleId} onValueChange={setNewRoleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un rôle" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.role_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Département</Label>
                <Select value={newDepartment} onValueChange={setNewDepartment}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un département" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rôle système</Label>
                <Select value={newSystemRole} onValueChange={setNewSystemRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Utilisateur</SelectItem>
                    <SelectItem value="moderator">Modérateur</SelectItem>
                    <SelectItem value="admin">Administrateur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} className="w-full" disabled={creating}>
                {creating ? "Création..." : "Créer l'utilisateur"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifier l'utilisateur</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={formEmail} disabled />
              </div>
              <div className="space-y-2">
                <Label>Rôle</Label>
                <Select value={formRoleId} onValueChange={setFormRoleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un rôle" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.role_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Département</Label>
                <Select value={formDepartment} onValueChange={setFormDepartment}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un département" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSave} className="w-full">
                Enregistrer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
