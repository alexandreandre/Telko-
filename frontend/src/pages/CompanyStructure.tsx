import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import AppLayout from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const DEPARTMENTS = [
  "Service client",
  "Commercial",
  "Finance",
  "Technique",
  "Management",
];

interface Profile {
  id: string;
  name: string;
  email: string;
  department: string | null;
}

export default function CompanyStructure() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, name, email, department")
      .then(({ data }) => setProfiles(data ?? []));
  }, []);

  const getByDepartment = (dept: string) =>
    profiles.filter((p) => p.department === dept);

  const unassigned = profiles.filter(
    (p) => !p.department || !DEPARTMENTS.includes(p.department)
  );

  return (
    <AppLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">
          Structure de l'entreprise
        </h1>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {DEPARTMENTS.map((dept) => {
            const members = getByDepartment(dept);
            return (
              <Card key={dept}>
                <CardHeader>
                  <CardTitle className="text-base">{dept}</CardTitle>
                </CardHeader>
                <CardContent>
                  {members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun membre</p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((m) => (
                        <li key={m.id} className="text-sm">
                          {m.name}{" "}
                          <span className="text-muted-foreground">({m.email})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {unassigned.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Non assigné</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {unassigned.map((m) => (
                    <li key={m.id} className="text-sm">
                      {m.name}{" "}
                      <span className="text-muted-foreground">({m.email})</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
