import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Building2, Briefcase, Mail, Save, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DEPARTMENTS = [
  "Service client",
  "Commercial",
  "Finance",
  "Technique",
  "Management",
];

interface Role {
  id: string;
  role_name: string;
}

export default function Profile() {
  const { user, profile, role, company, refreshProfile } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [formName, setFormName] = useState("");
  const [formRoleId, setFormRoleId] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.from("roles").select("id, role_name").order("role_name").then(({ data }) => {
      setRoles((data ?? []).filter((r) => r.role_name !== "Administrateur"));
    });
  }, []);

  useEffect(() => {
    if (profile) {
      setFormName(profile.name);
      setFormRoleId(profile.role_id ?? "");
      setFormDepartment(profile.department ?? "");
    }
  }, [profile]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        name: formName,
        role_id: formRoleId || null,
        department: formDepartment || null,
      })
      .eq("id", user.id);

    if (error) {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    } else {
      await refreshProfile();
      toast({ title: "Profil mis à jour avec succès" });
    }
    setSaving(false);
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Mon profil</h1>

        {/* Info card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" /> Informations actuelles
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Badge variant="outline" className="gap-1.5">
              <Mail className="h-3 w-3" /> {profile?.email}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Briefcase className="h-3 w-3" /> {role?.role_name ?? "Non assigné"}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Building2 className="h-3 w-3" /> {profile?.department ?? "Non assigné"}
            </Badge>
            {company && (
              <Badge variant="outline" className="gap-1.5">
                <Building2 className="h-3 w-3" /> {company.name}
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Edit card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Modifier mon profil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nom</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile?.email ?? ""} disabled className="opacity-60" />
            </div>
            <div className="space-y-2">
              <Label>Rôle métier</Label>
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
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Enregistrer
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
