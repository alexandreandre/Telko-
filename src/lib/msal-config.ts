import {
  Configuration,
  LogLevel,
  PublicClientApplication,
} from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: (import.meta.env.VITE_AZURE_CLIENT_ID as string) ?? "",
    authority: `https://login.microsoftonline.com/${
      (import.meta.env.VITE_AZURE_TENANT_ID as string) ?? "common"
    }`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error("[MSAL]", message);
        if (level === LogLevel.Warning) console.warn("[MSAL]", message);
      },
    },
  },
};

// Scopes demandés pour l'accès au backend + profil utilisateur
export const loginRequest = {
  scopes: ["openid", "profile", "email", "User.Read"],
};

export const msalInstance = new PublicClientApplication(msalConfig);
