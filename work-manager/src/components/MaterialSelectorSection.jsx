import React, { useEffect, useMemo } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import LayersRoundedIcon from "@mui/icons-material/LayersRounded";

import { resolveMaterialJobProfile } from "../constants/materialProfiles";
import { getMaterialDisplayName, normalizeMaterialType } from "../utils/materialCompat";
import {
  coerceSelectionForProfile,
  createEmptyMaterialExtra,
  getAvailablePrimaryTypes,
  getCompatibleLaminates,
  getMaterialById,
  getOptionalExtraMaterials,
  getPrimaryMaterials,
  normalizeMaterialSelection,
} from "../utils/materialSelection";

function labelForType(type) {
  switch (type) {
    case "sheet_media":
      return "Sheet Media";
    case "roll_media":
      return "Roll Media";
    case "roll_laminate":
      return "Roll Laminate";
    case "paper_stock":
      return "Paper Stock";
    case "card_stock":
      return "Card Stock";
    case "fixing":
      return "Fixings";
    case "item":
      return "Items";
    default:
      return type ? String(type).replace(/_/g, " ") : "";
  }
}

export default function MaterialSelectorSection({
  materials = [],
  jobProfile = "sheet_signage",
  value,
  onChange,
  title = "Materials",
  disabled = false,
  showExtras = true,
}) {
  const profile = useMemo(() => resolveMaterialJobProfile(jobProfile), [jobProfile]);
  const selection = useMemo(() => normalizeMaterialSelection(value), [value]);

  const availablePrimaryTypes = useMemo(
    () => getAvailablePrimaryTypes(materials, profile),
    [materials, profile]
  );

  const effectivePrimaryType =
    selection.primaryType ||
    (availablePrimaryTypes.includes(profile.defaultPrimaryType)
      ? profile.defaultPrimaryType
      : availablePrimaryTypes[0] || "");

  const primaryOptions = useMemo(
    () => getPrimaryMaterials(materials, effectivePrimaryType, profile),
    [materials, effectivePrimaryType, profile]
  );

  const selectedPrimaryMaterial = useMemo(
    () => getMaterialById(materials, selection.primaryMaterialId),
    [materials, selection.primaryMaterialId]
  );

  const laminateOptions = useMemo(
    () => getCompatibleLaminates(materials, selectedPrimaryMaterial, profile),
    [materials, selectedPrimaryMaterial, profile]
  );

  const extraOptions = useMemo(
    () => getOptionalExtraMaterials(materials, profile),
    [materials, profile]
  );

  useEffect(() => {
    if (!onChange) return;
    const coerced = coerceSelectionForProfile(selection, materials, profile);
    if (JSON.stringify(coerced) !== JSON.stringify(selection)) {
      onChange(coerced);
    }
  }, [selection, materials, profile, onChange]);

  const updateSelection = (patch) => {
    if (!onChange) return;
    onChange({ ...selection, ...patch });
  };

  const laminateAllowed =
    !!selectedPrimaryMaterial &&
    profile.laminateCompatiblePrimaryTypes.includes(normalizeMaterialType(selectedPrimaryMaterial));

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={1} alignItems="center">
              <LayersRoundedIcon fontSize="small" />
              <Typography sx={{ fontWeight: 900 }}>{title}</Typography>
            </Stack>
            <Typography variant="body2" sx={{ opacity: 0.75 }}>{profile.description}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {availablePrimaryTypes.map((type) => (
              <Chip key={type} label={labelForType(type)} size="small" variant="outlined" />
            ))}
          </Stack>
        </Stack>

        {!availablePrimaryTypes.length ? (
          <Alert severity="warning">No active materials are available for this workflow yet.</Alert>
        ) : (
          <>
            {availablePrimaryTypes.length > 1 ? (
              <FormControl fullWidth disabled={disabled}>
                <InputLabel>Primary Material Type</InputLabel>
                <Select
                  value={effectivePrimaryType}
                  label="Primary Material Type"
                  onChange={(e) =>
                    updateSelection({
                      primaryType: e.target.value,
                      primaryMaterialId: "",
                      laminateMaterialId: "",
                    })
                  }
                >
                  {availablePrimaryTypes.map((type) => (
                    <MenuItem key={type} value={type}>{labelForType(type)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}

            <FormControl fullWidth disabled={disabled}>
              <InputLabel>Primary Material</InputLabel>
              <Select
                value={selection.primaryMaterialId}
                label="Primary Material"
                onChange={(e) =>
                  updateSelection({
                    primaryType: effectivePrimaryType,
                    primaryMaterialId: e.target.value,
                    laminateMaterialId: "",
                  })
                }
              >
                {primaryOptions.map((material) => (
                  <MenuItem key={material.id} value={material.id}>{getMaterialDisplayName(material)}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {laminateAllowed ? (
              <FormControl fullWidth disabled={disabled}>
                <InputLabel>Laminate (optional)</InputLabel>
                <Select
                  value={selection.laminateMaterialId}
                  label="Laminate (optional)"
                  onChange={(e) => updateSelection({ laminateMaterialId: e.target.value })}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {laminateOptions.map((material) => (
                    <MenuItem key={material.id} value={material.id}>{getMaterialDisplayName(material)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}

            {showExtras ? (
              <Stack spacing={1.5}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }}>
                  <Box>
                    <Typography sx={{ fontWeight: 800 }}>Optional Extras</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>
                      Add fixings or item-based extras. Qty is treated as per finished item, so totals scale with the line quantity.
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    startIcon={<AddRoundedIcon />}
                    onClick={() => updateSelection({ extras: [...selection.extras, createEmptyMaterialExtra()] })}
                    disabled={disabled || !extraOptions.length}
                  >
                    Add Extra
                  </Button>
                </Stack>

                {selection.extras.map((extra, index) => (
                  <Paper key={`extra-${index}`} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                      <FormControl fullWidth disabled={disabled}>
                        <InputLabel>Extra Material</InputLabel>
                        <Select
                          value={extra.materialId}
                          label="Extra Material"
                          onChange={(e) => {
                            const nextExtras = selection.extras.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, materialId: e.target.value } : item
                            );
                            updateSelection({ extras: nextExtras });
                          }}
                        >
                          <MenuItem value=""><em>Select extra</em></MenuItem>
                          {extraOptions.map((material) => (
                            <MenuItem key={material.id} value={material.id}>{getMaterialDisplayName(material)}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <TextField
                        label="Qty per item"
                        type="number"
                        value={extra.quantity}
                        onChange={(e) => {
                          const nextExtras = selection.extras.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, quantity: e.target.value } : item
                          );
                          updateSelection({ extras: nextExtras });
                        }}
                        sx={{ width: { md: 120 } }}
                        disabled={disabled}
                      />

                      <TextField
                        label="Notes"
                        value={extra.notes}
                        onChange={(e) => {
                          const nextExtras = selection.extras.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, notes: e.target.value } : item
                          );
                          updateSelection({ extras: nextExtras });
                        }}
                        fullWidth
                        disabled={disabled}
                      />

                      <Box sx={{ display: "flex", alignItems: "center" }}>
                        <IconButton
                          onClick={() => updateSelection({ extras: selection.extras.filter((_, itemIndex) => itemIndex !== index) })}
                          disabled={disabled}
                        >
                          <DeleteRoundedIcon />
                        </IconButton>
                      </Box>
                    </Stack>
                  </Paper>
                ))}

                {!extraOptions.length ? (
                  <Alert severity="info">No optional extra materials are currently active for this workflow.</Alert>
                ) : null}
              </Stack>
            ) : null}
          </>
        )}
      </Stack>
    </Paper>
  );
}
