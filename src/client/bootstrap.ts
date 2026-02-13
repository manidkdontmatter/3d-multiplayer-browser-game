import { GameClientApp } from "./runtime/GameClientApp";

export async function bootstrapClient(): Promise<void> {
  const canvas = document.getElementById("game-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("Missing #game-canvas");
  }

  const status = document.getElementById("status");
  const app = await GameClientApp.create(canvas, status);
  app.start();
}
