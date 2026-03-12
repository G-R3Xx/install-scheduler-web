import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/firebase";
import { normalizeSupplierRecord, sortSuppliers } from "../utils/suppliers";

export default function useSuppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshSuppliers = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const snapshot = await getDocs(collection(db, "suppliers"));
      const rows = snapshot.docs.map((snap) =>
        normalizeSupplierRecord(snap.id, snap.data())
      );

      setSuppliers(sortSuppliers(rows));
    } catch (err) {
      console.error("Failed to load suppliers:", err);
      setError(err?.message || "Failed to load suppliers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSuppliers();
  }, [refreshSuppliers]);

  return {
    suppliers,
    loading,
    error,
    refreshSuppliers,
  };
}
