export function getCellDisplayStatus(cell, position, anomalyFlags) {
  if (cell?.voltage_v == null) return null;

  if (anomalyFlags[position]?.length > 0) {
    return cell.health_status === "red" ? "red" : "yellow";
  }

  return "green";
}
