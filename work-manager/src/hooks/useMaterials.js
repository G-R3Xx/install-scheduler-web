import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { normalizeMaterialRecord, sortMaterials } from "../utils/materials";

export default function useMaterials() {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMaterials = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const snapshot = await getDocs(collection(db, "materials"));
      const rows = snapshot.docs.map((snap) =>
        normalizeMaterialRecord(snap.id, snap.data())
      );

      setMaterials(sortMaterials(rows));
    } catch (err) {
      console.error("Failed to load materials:", err);
      setError(err?.message || "Failed to load materials.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMaterials();
  }, [refreshMaterials]);

  return {
    materials,
    loading,
    error,
    refreshMaterials,
  };
}