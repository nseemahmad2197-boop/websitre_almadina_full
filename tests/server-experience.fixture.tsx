import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AlmadinaApplication from "../app/almadina-app";
createRoot(document.getElementById("root")!).render(<StrictMode><AlmadinaApplication /></StrictMode>);
