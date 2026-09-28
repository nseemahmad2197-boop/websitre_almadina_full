import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AlmadinaApplication from "../app/almadina-app";

// Exercise the production app, including Strict Mode's effect setup/cleanup.
createRoot(document.getElementById("root")!).render(
  <StrictMode><AlmadinaApplication /></StrictMode>,
);
