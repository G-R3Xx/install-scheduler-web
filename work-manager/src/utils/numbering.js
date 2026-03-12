// work-manager/src/utils/numbering.js
// Simple doc number generator. (Good enough for now; later we can move to a Firestore counter.)
export function makeDocNumber(prefix = "DOC") {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const t = String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${y}${m}${day}-${t}-${rand}`;
}
