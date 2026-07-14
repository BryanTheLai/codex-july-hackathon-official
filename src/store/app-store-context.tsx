import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";

import { getAppStore, type AppStore, type AppStoreState } from "./use-app-store";

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({
  store,
  children,
}: {
  store: AppStore;
  children: ReactNode;
}) {
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>;
}

function useAppStoreApiInternal(): AppStore {
  const store = useContext(AppStoreContext) ?? getAppStore();
  return store;
}

export function useAppStoreApi(): AppStore {
  return useAppStoreApiInternal();
}

export function useAppStore<T>(selector: (state: AppStoreState) => T): T {
  return useStore(useAppStoreApiInternal(), selector);
}
