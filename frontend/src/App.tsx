import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Login from "./pages/Login";

import Assistant from "./pages/Assistant";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";

import Tickets from "./pages/Tickets";
import Clients from "./pages/Clients";
import Factures from "./pages/Factures";
import Monitoring from "./pages/Monitoring";
import Rapports from "./pages/Rapports";

import KnowledgeBase from "./pages/KnowledgeBase";
import LLMComparator from "./pages/LLMComparator";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            
            <Route path="/assistant" element={<ProtectedRoute path="/assistant"><Assistant /></ProtectedRoute>} />
            <Route path="/profil" element={<ProtectedRoute path="/profil"><Profile /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin path="/admin"><Admin /></ProtectedRoute>} />
            
            <Route path="/tickets" element={<ProtectedRoute path="/tickets"><Tickets /></ProtectedRoute>} />
            <Route path="/clients" element={<ProtectedRoute path="/clients"><Clients /></ProtectedRoute>} />
            <Route path="/factures" element={<ProtectedRoute path="/factures"><Factures /></ProtectedRoute>} />
            <Route path="/monitoring" element={<ProtectedRoute path="/monitoring"><Monitoring /></ProtectedRoute>} />
            <Route path="/rapports" element={<ProtectedRoute path="/rapports"><Rapports /></ProtectedRoute>} />
            
            <Route path="/knowledge-base" element={<ProtectedRoute path="/knowledge-base"><KnowledgeBase /></ProtectedRoute>} />
            <Route path="/llm-comparator" element={<ProtectedRoute path="/llm-comparator"><LLMComparator /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/assistant" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
