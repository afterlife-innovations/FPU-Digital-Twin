export function getCellDisplayStatus(cell, position, anomalyFlags) {
  if (cell?.voltage_v == null) return null;

  if (cell.health_status === "red") return "red";
  if (cell.health_status === "yellow" || anomalyFlags[position]?.length > 0) return "yellow";

  return "green";
}
