export function getCellDisplayStatus(cell, position, anomalyFlags) {
  if (!cell) return null;

  const breaches = anomalyFlags?.[position] || [];
  if (breaches.some((message) => message.startsWith("CRITICAL:"))) return "red";
  if (breaches.length > 0) return "yellow";

  return "green";
}
