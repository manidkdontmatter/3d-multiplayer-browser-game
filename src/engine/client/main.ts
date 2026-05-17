/**
 * Purpose: This file starts this runtime entrypoint and wires the initial systems together.
 * Scope: It belongs to the engine client runtime layer.
 * Human Summary: Runs on the client and focuses on input, rendering, UI, and smoothing server updates.
 */
import "./style.css";
import { bootstrapClient } from "./bootstrap";

void bootstrapClient();
