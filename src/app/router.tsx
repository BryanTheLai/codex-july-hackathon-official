import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router";

import { AppShell } from "./app-shell";
import { RouteLoading } from "./route-loading";

const ChatRoute = lazy(() => import("../routes/chat/chat-route"));
const DreamRoute = lazy(() => import("../routes/dream/dream-route"));
const EvalRoute = lazy(() => import("../routes/eval/eval-route"));

function lazyRoute(Component: ComponentType) {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Component />
    </Suspense>
  );
}

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: lazyRoute(ChatRoute) },
      { path: "dream", element: lazyRoute(DreamRoute) },
      { path: "eval", element: lazyRoute(EvalRoute) },
      { path: "*", element: <Navigate replace to="/" /> },
    ],
  },
]);
