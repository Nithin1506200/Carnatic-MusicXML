import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./globals.css";
import MusicLibrary from "./music-library";

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found");

createRoot(root).render(
  <StrictMode>
    <MusicLibrary />
  </StrictMode>,
);
