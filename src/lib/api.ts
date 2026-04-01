/**
 * Client REST centralisé vers le backend Python (http://localhost:8000/api).
 * Toutes les pages importent depuis ce fichier — plus aucun import supabase
 * dans la couche data.
 *
 * Auth : chaque requête joint automatiquement le Bearer token MSAL.
 * SSE  : streamChat() retourne la Response brute pour lecture ReadableStream.
 */

import { msalInstance, loginRequest } from "./msal-config";

export const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://localhost:8000/api";

// ---------------------------------------------------------------------------
// Types partagés (miroir du schéma Python)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  name: string;
  email: string;
  department: string | null;
  company_id: string | null;
  role_id: string | null;
  created_at: string;
}

export interface Role {
  id: string;
  role_name: string;
  description: string | null;
}

export interface Company {
  id: string;
  name: string;
}

export interface MeResponse extends Profile {
  role: Role | null;
  company: Company | null;
  is_admin: boolean;
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  source_type: string;
  file_path: string | null;
  created_at: string;
  user_id: string;
}

export interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Token MSAL (acquiert silencieusement, popup en fallback)
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const accounts = msalInstance.getAllAccounts();
  if (!accounts.length) return null;
  try {
    const result = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    try {
      const result = await msalInstance.acquireTokenPopup(loginRequest);
      return result.accessToken;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch de base avec auth header
// ---------------------------------------------------------------------------

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const isFormData = init.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!resp.ok) {
    const err = await resp
      .json()
      .catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(
      (err as { detail?: string; error?: string }).detail ??
        (err as { detail?: string; error?: string }).error ??
        `API error ${resp.status}`
    );
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Auth / profil courant
// ---------------------------------------------------------------------------

export async function getMe(): Promise<MeResponse> {
  const resp = await apiFetch("/me");
  return resp.json();
}

export async function updateMe(
  data: Partial<Pick<Profile, "name" | "role_id" | "department">>
): Promise<Profile> {
  const resp = await apiFetch("/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return resp.json();
}

// ---------------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------------

export async function getRoles(): Promise<Role[]> {
  const resp = await apiFetch("/roles");
  return resp.json();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function getDocuments(): Promise<KnowledgeDoc[]> {
  const resp = await apiFetch("/documents");
  return resp.json();
}

export async function getDocumentCount(): Promise<number> {
  const resp = await apiFetch("/documents/count");
  const data: { count: number } = await resp.json();
  return data.count;
}

export async function searchDocuments(
  q: string,
  limit = 8
): Promise<Pick<KnowledgeDoc, "id" | "title" | "content" | "file_path">[]> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const resp = await apiFetch(`/documents/search?${params}`);
  return resp.json();
}

/** Crée un document + génère les embeddings (body JSON). */
export async function createDocument(data: {
  title: string;
  content: string;
  source_type: string;
  file_path?: string;
}): Promise<KnowledgeDoc> {
  const resp = await apiFetch("/documents", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return resp.json();
}

/** Upload d'un fichier PDF : multipart avec extraction + embed côté backend. */
export async function uploadDocumentFile(
  file: File,
  title?: string
): Promise<KnowledgeDoc> {
  const form = new FormData();
  form.append("file", file);
  if (title) form.append("title", title);
  const resp = await apiFetch("/documents/upload", {
    method: "POST",
    body: form,
  });
  return resp.json();
}

/** Attache / remplace le fichier PDF d'un document existant. */
export async function uploadDocumentPdf(
  docId: string,
  pdfBlob: Blob,
  filename: string
): Promise<void> {
  const form = new FormData();
  form.append("file", pdfBlob, filename);
  await apiFetch(`/documents/${docId}/file`, { method: "POST", body: form });
}

/** Télécharge le fichier attaché à un document. */
export async function downloadDocumentFile(docId: string): Promise<Blob> {
  const resp = await apiFetch(`/documents/${docId}/file`);
  return resp.blob();
}

export async function deleteDocument(docId: string): Promise<void> {
  await apiFetch(`/documents/${docId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function getConversations(): Promise<Conversation[]> {
  const resp = await apiFetch("/conversations");
  return resp.json();
}

export async function createConversation(title: string): Promise<Conversation> {
  const resp = await apiFetch("/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  return resp.json();
}

export async function touchConversation(convId: string): Promise<void> {
  await apiFetch(`/conversations/${convId}`, {
    method: "PATCH",
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
}

export async function deleteConversation(convId: string): Promise<void> {
  await apiFetch(`/conversations/${convId}`, { method: "DELETE" });
}

export async function getMessages(convId: string): Promise<ChatMessage[]> {
  const resp = await apiFetch(`/conversations/${convId}/messages`);
  return resp.json();
}

export async function saveMessage(
  convId: string,
  msg: ChatMessage
): Promise<void> {
  await apiFetch(`/conversations/${convId}/messages`, {
    method: "POST",
    body: JSON.stringify(msg),
  });
}

// ---------------------------------------------------------------------------
// Chat streaming (SSE via ReadableStream)
// Retourne la Response brute — le composant lit resp.body lui-même.
// Le backend émet :
//   data: <token_texte>\n\n   ou   data: [DONE]\n\n
// Compatible aussi avec le format OpenAI : data: {"choices":[{"delta":{"content":"..."}}]}
// ---------------------------------------------------------------------------

export async function streamChat(payload: {
  messages: ChatMessage[];
  role_name?: string | null;
  department?: string | null;
  conversation_id?: string | null;
}): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Admin — profils
// ---------------------------------------------------------------------------

export async function getProfiles(): Promise<Profile[]> {
  const resp = await apiFetch("/profiles");
  return resp.json();
}

export async function updateProfile(
  id: string,
  data: Partial<Pick<Profile, "name" | "department" | "role_id" | "company_id">>
): Promise<Profile> {
  const resp = await apiFetch(`/profiles/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return resp.json();
}

export async function deleteProfile(id: string): Promise<void> {
  await apiFetch(`/profiles/${id}`, { method: "DELETE" });
}

export async function createAdminUser(data: {
  email: string;
  password: string;
  name: string;
  role_id: string | null;
  department: string | null;
  company_id: string | null;
  system_role: string;
}): Promise<{ user_id: string }> {
  const resp = await apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return resp.json();
}
