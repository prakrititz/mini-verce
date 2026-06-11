import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Orbit from "./frontend.jsx";
import DocsLayout from "./docs/layout.jsx";
import Quickstart from "./docs/quickstart.jsx";
import Commands from "./docs/commands.jsx";
import Github from "./docs/github.jsx";
import Docker from "./docs/docker.jsx";
import Networking from "./docs/networking.jsx";
import EnvVars from "./docs/envvars.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Orbit />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<Quickstart />} />
          <Route path="quickstart" element={<Quickstart />} />
          <Route path="commands" element={<Commands />} />
          <Route path="github" element={<Github />} />
          <Route path="docker" element={<Docker />} />
          <Route path="networking" element={<Networking />} />
          <Route path="envvars" element={<EnvVars />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
