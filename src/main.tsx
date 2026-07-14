import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";

import { appRouter } from "./app/router";
import { AppStoreProvider } from "./store/app-store-context";
import { getAppStore } from "./store/use-app-store";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppStoreProvider store={getAppStore()}>
      <RouterProvider router={appRouter} />
    </AppStoreProvider>
  </StrictMode>,
);
