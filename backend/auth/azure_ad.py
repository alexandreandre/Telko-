"""
Authentification via Azure Active Directory (OIDC / OAuth2).
Valide les JWT Bearer tokens émis par Azure AD en vérifiant la signature,
l'audience et le tenant. Expose une dépendance FastAPI get_current_user
injectable dans les routes protégées.
"""
