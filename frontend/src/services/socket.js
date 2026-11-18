import { io } from "socket.io-client";
import { API_BASE } from "./apiBase";

const SOCKET_URL =
  API_BASE ||
  (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8000");

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  path: "/socket.io",
  transports: import.meta.env.PROD ? ["websocket"] : ["polling", "websocket"],
});
