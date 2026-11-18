import React, { useEffect, useRef, useState } from "react";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import { api } from "../../services/api";
import styles from "./AssemblyMapModal.module.css";

// Set to true if your bulk-assign endpoint should also receive `legacy_cell_id`
// on each mapping. Left false so the existing payload shape is unchanged.
const SEND_LEGACY_ID_TO_API = false;

const SERIES_COUNT = 8;
const PARALLEL_COUNT = 11;
const TOTAL_SLOTS = SERIES_COUNT * PARALLEL_COUNT; // 88

export const AssemblyMapModal = () => {
  const isOpen = useTelemetryStore((state) => state.isAssemblyOpen);
  const closeModal = () => useTelemetryStore.getState().setAssemblyModalOpen(false);
  const setGradeInventoryOpen = useTelemetryStore((state) => state.setGradeInventoryOpen);
  const packId = useTelemetryStore((state) => state.packId);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);

  const [progress, setProgress] = useState({ assigned_slots: 0, total_slots: TOTAL_SLOTS, completion_percentage: 0 });
  const [mapData, setMapData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clearingAssignments, setClearingAssignments] = useState(false);

  // Single Slot Assignment State
  const [seriesInput, setSeriesInput] = useState(1);
  const [parallelInput, setParallelInput] = useState(1);
  const [batteryCodeInput, setBatteryCodeInput] = useState("");
  const [assignError, setAssignError] = useState(null);
  const [assignSuccess, setAssignSuccess] = useState(null);

  // Legacy Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Bulk Import State
  const [bulkJson, setBulkJson] = useState("");
  const [bulkStatus, setBulkStatus] = useState(null);
  const [bulkIsError, setBulkIsError] = useState(false);

  // battery_code -> legacy_cell_id pairs. Persisted per pack in localStorage so they
  // survive closing the modal / reloading (the assembly-map API only returns codes).
  const [legacyByCode, setLegacyByCode] = useState({});
  const legacyLoadedKeyRef = useRef(null);
  const legacyLookupCache = useRef(new Map()); // code -> Promise<legacy|null>
  const storageKey = `assemblyLegacyIds:${packId}`;

  // Afterlife Pack Builder State
  const [packBuilderLoading, setPackBuilderLoading] = useState(false);
  const [packBuilderSessions, setPackBuilderSessions] = useState([]);
  const [showPackPicker, setShowPackPicker] = useState(false);

  // Afterlife Pack Match State
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [showMatchSettings, setShowMatchSettings] = useState(false);
  const [matchSettings, setMatchSettings] = useState({
    chemistry: "LIION",
    form_factor: "18650",
    soh_tolerance_pct: 10,
    capacity_tolerance_pct: 12,
    dcir_tolerance_pct: 10,
    intra_parallel_capacity_tolerance_pct: 15,
    allowed_grades: "A,B,C",
  });

  const loadAssemblyData = async () => {
    try {
      setLoading(true);
      const [prog, mapList] = await Promise.all([
        api.getAssemblyProgress(packId),
        api.getAssemblyMap(packId),
      ]);
      setProgress(prog);
      setMapData(mapList);
      useTelemetryStore.getState().setAssemblyMap(mapList);
      setLoading(false);
      return { prog, mapList };
    } catch (err) {
      console.error("Error loading assembly map:", err);
      setLoading(false);
      return null;
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadAssemblyData();
    }
  }, [isOpen, packId]);

  // ── Legacy ID persistence ──────────────────────────────────────────
  // Load saved pairs when the pack changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setLegacyByCode(raw ? JSON.parse(raw) : {});
    } catch (err) {
      setLegacyByCode({});
    }
    legacyLoadedKeyRef.current = storageKey;
  }, [storageKey]);

  // Save pairs whenever they change (only after the initial load for this pack)
  useEffect(() => {
    if (legacyLoadedKeyRef.current !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(legacyByCode));
    } catch (err) {
      // Storage can be full or blocked: pairs still work for this session
    }
  }, [legacyByCode, storageKey]);

  const rememberLegacy = (items) => {
    setLegacyByCode((prev) => {
      const next = { ...prev };
      items.forEach((i) => {
        if (i.battery_code && i.legacy_cell_id) {
          next[i.battery_code] = String(i.legacy_cell_id);
        }
      });
      return next;
    });
  };

  // Best known legacy ID for a mapped slot (API value, then fresh lookups, then saved pairs)
  const getLegacy = (slot, extra = {}) =>
    slot.legacy_cell_id || extra[slot.battery_code] || legacyByCode[slot.battery_code] || null;

  // Look up one cell's legacy ID from the passport inventory (cached; failures are retried later)
  const lookupLegacy = (code) => {
    if (!legacyLookupCache.current.has(code)) {
      const p = (async () => {
        try {
          const data = await api.searchPassports(code);
          const hit = (data.passports || []).find(
            (x) => String(x.battery_code || "").toLowerCase() === code.toLowerCase()
          );
          return hit && hit.legacy_cell_id ? String(hit.legacy_cell_id) : null;
        } catch (err) {
          return undefined; // lookup failed: don't cache, allow a retry
        }
      })().then((r) => {
        if (r === undefined) {
          legacyLookupCache.current.delete(code);
          return null;
        }
        return r;
      });
      legacyLookupCache.current.set(code, p);
    }
    return legacyLookupCache.current.get(code);
  };

  // Resolve legacy IDs for a list of battery codes, a few at a time. Returns { code: legacy }.
  const resolveLegacyIds = async (codes) => {
    const unique = [...new Set(codes)];
    const resolved = {};
    const CHUNK = 6;
    for (let i = 0; i < unique.length; i += CHUNK) {
      await Promise.all(
        unique.slice(i, i + CHUNK).map(async (code) => {
          const legacy = await lookupLegacy(code);
          if (legacy) resolved[code] = legacy;
        })
      );
    }
    const found = Object.entries(resolved);
    if (found.length > 0) {
      rememberLegacy(found.map(([battery_code, legacy_cell_id]) => ({ battery_code, legacy_cell_id })));
    }
    return resolved;
  };

  // Whenever the matrix loads, quietly fill in legacy IDs for mapped cells that have none on record
  useEffect(() => {
    if (!isOpen) return;
    const missing = mapData
      .filter((s) => s.battery_code && !getLegacy(s))
      .map((s) => s.battery_code);
    if (missing.length > 0) {
      resolveLegacyIds(missing);
    }
  }, [mapData, isOpen]);

  // ── Current-map schema (pull / copy) ───────────────────────────────
  // Same shape the bulk importer accepts, so it can be edited and re-imported.
  const buildCurrentMapSchema = (extra = {}) =>
    mapData
      .filter((slot) => slot.battery_code)
      .map((slot) => {
        const legacy = getLegacy(slot, extra);
        return {
          position: slot.position || `S${slot.series}-P${slot.parallel}`,
          series: slot.series,
          parallel: slot.parallel,
          battery_code: slot.battery_code,
          ...(legacy ? { legacy_cell_id: String(legacy) } : {}),
          ...(typeof slot.passport_data?.manufacturer === "string" &&
            slot.passport_data.manufacturer.trim()
            ? { manufacturer: slot.passport_data.manufacturer.trim() }
            : {}),
          ...(slot.passport_data?.nominal_capacity_ah != null
            ? { nominal_capacity_ah: slot.passport_data.nominal_capacity_ah }
            : {}),
          ...(slot.passport_data?.measured_capacity_ah != null
            ? { measured_capacity_ah: slot.passport_data.measured_capacity_ah }
            : {}),
          ...(slot.passport_data?.dcir_mohm != null
            ? { dcir_mohm: slot.passport_data.dcir_mohm }
            : {}),
          ...(slot.passport_data?.soh_percent != null
            ? { soh_percent: slot.passport_data.soh_percent }
            : {}),
        };
      })
      .sort((a, b) => a.series - b.series || a.parallel - b.parallel);

  // Makes sure every mapped cell has had its legacy ID looked up before the schema is built
  const prepareCurrentMapSchema = async () => {
    const mapped = mapData.filter((s) => s.battery_code);
    if (mapped.length === 0) return null;
    const missing = mapped.filter((s) => !getLegacy(s)).map((s) => s.battery_code);
    const resolved = missing.length > 0 ? await resolveLegacyIds(missing) : {};
    return buildCurrentMapSchema(resolved);
  };

  const handlePullCurrentMap = async () => {
    setBulkIsError(false);
    setBulkStatus("⏳ Pulling the current matrix and resolving legacy IDs...");
    const schema = await prepareCurrentMapSchema();
    if (!schema) {
      setBulkIsError(true);
      setBulkStatus("❌ No cells are currently mapped in the matrix, so there is nothing to pull.");
      return;
    }
    const withLegacy = schema.filter((s) => s.legacy_cell_id).length;
    const without = schema.length - withLegacy;
    setBulkJson(JSON.stringify(schema, null, 2));
    try {
      const observerConfig = await api.configureObserverCellMetrics(packId, schema);
      setBulkIsError(false);
      setBulkStatus(
        `📥 Pulled ${schema.length} mapped cell(s) from the matrix (${withLegacy} with legacy IDs` +
        `${without > 0 ? `, ${without} with no legacy ID on record` : ""}) and updated observer metrics for ` +
        `${observerConfig.cells_with_passport_metrics} cell(s). Edit and re-import, or copy it.`
      );
    } catch (error) {
      setBulkIsError(true);
      setBulkStatus(
        `⚠️ Map JSON was pulled into the editor, but observer metrics could not be updated: ${error.message}`
      );
    }
  };

  const handleCopyCurrentMap = async () => {
    setBulkIsError(false);
    setBulkStatus("⏳ Preparing JSON and resolving legacy IDs...");
    const schema = await prepareCurrentMapSchema();
    if (!schema) {
      setBulkIsError(true);
      setBulkStatus("❌ No cells are currently mapped in the matrix, so there is nothing to copy.");
      return;
    }
    const json = JSON.stringify(schema, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setBulkIsError(false);
      setBulkStatus(
        `📋 Copied JSON for ${schema.length} mapped cell(s) (${schema.filter((s) => s.legacy_cell_id).length} with legacy IDs) to the clipboard.`
      );
    } catch (err) {
      // Clipboard can be blocked (permissions / non-secure context): fall back to the editor
      setBulkJson(json);
      setBulkIsError(true);
      setBulkStatus("❌ Clipboard access was blocked, so the JSON was placed in the editor below. Copy it from there.");
    }
  };

  const handleAssignSingle = async (e) => {
    e.preventDefault();
    setAssignError(null);
    setAssignSuccess(null);

    const code = batteryCodeInput.trim();
    if (!code) {
      setAssignError("Please enter a battery code or scan a code");
      return;
    }

    // Client-side duplicate detection: check if this code is already in the pack
    const targetPos = `S${seriesInput}-P${parallelInput}`;
    const existingEntry = Object.entries(assemblyMap).find(([pos, bc]) => bc === code);
    if (existingEntry && existingEntry[0] !== targetPos) {
      setAssignError(`Battery code '${code}' is already assigned to position ${existingEntry[0]}. Each cell can only occupy one slot.`);
      return;
    }

    try {
      // 🔗 AFTERLIFE API: assignCell triggers validation against Afterlife inventory
      const res = await api.assignCell(packId, parseInt(seriesInput, 10), parseInt(parallelInput, 10), code);
      // The assign response carries the passport: keep its legacy ID paired with the code
      const legacyFromPassport = res?.passport_data?.legacy_cell_id;
      if (legacyFromPassport) {
        rememberLegacy([{ battery_code: res.battery_code, legacy_cell_id: legacyFromPassport }]);
      }
      setAssignSuccess(`Assigned ${res.battery_code} to S${res.series}-P${res.parallel}`);
      setBatteryCodeInput("");
      await loadAssemblyData();
    } catch (err) {
      setAssignError(err.message || "Failed to assign cell");
    }
  };

  const handleSearchLegacy = async () => {
    const raw = searchQuery.trim();
    if (!raw) return;
    try {
      setSearchLoading(true);
      const cleanQ = raw.replace(/^cell\s*#?\s*/i, "").replace(/^#\s*/, "").trim().toLowerCase();
      // 🔗 AFTERLIFE API: Search by legacy cell ID or code
      const data = await api.searchPassports(cleanQ || raw);
      let results = data.passports || [];

      // Sort results so exact Legacy ID / Battery Code match is placed at the topmost
      results = [...results].sort((a, b) => {
        const aLeg = String(a.legacy_cell_id || "").toLowerCase().trim();
        const bLeg = String(b.legacy_cell_id || "").toLowerCase().trim();
        const aCode = String(a.battery_code || "").toLowerCase().trim();
        const bCode = String(b.battery_code || "").toLowerCase().trim();

        const aExact = aLeg === cleanQ || aCode === cleanQ || aCode === raw.toLowerCase();
        const bExact = bLeg === cleanQ || bCode === cleanQ || bCode === raw.toLowerCase();

        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aLeg.startsWith(cleanQ) || aCode.startsWith(cleanQ);
        const bStarts = bLeg.startsWith(cleanQ) || bCode.startsWith(cleanQ);

        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return 0;
      });

      setSearchResults(results);
      setSearchLoading(false);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchLoading(false);
    }
  };

  // Selecting a search result keeps its legacy ID paired with the battery code
  const handleSelectSearchResult = (passport) => {
    setBatteryCodeInput(passport.battery_code);
    if (passport.legacy_cell_id) {
      rememberLegacy([{ battery_code: passport.battery_code, legacy_cell_id: passport.legacy_cell_id }]);
    }
    setSearchResults([]);
  };

  // Helper parser for multiple input formats (JSON array, position JSON, wrapped object, CSV lines).
  // Every mapping may carry an optional legacy_cell_id paired with its battery_code.
  const parseBulkInput = (rawText) => {
    const text = rawText.trim();
    if (!text) {
      throw new Error("Please enter or paste mapping data before importing.");
    }

    let parsedList = [];

    // Try parsing as JSON first
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsedList = parsed;
        } else if (Array.isArray(parsed.mappings)) {
          parsedList = parsed.mappings;
        } else if (Array.isArray(parsed.slots)) {
          parsedList = parsed.slots;
        } else {
          throw new Error("JSON payload must be an array of objects or an object with a 'mappings' array.");
        }
      } catch (jsonErr) {
        throw new Error(`Invalid JSON syntax: ${jsonErr.message}`);
      }
    } else {
      // Fallback: Parse line-by-line CSV / text. Accepted line formats:
      //   S1-P1, BATTERY_CODE
      //   S1-P1, BATTERY_CODE, LEGACY_ID
      //   1, 1, BATTERY_CODE
      //   1, 1, BATTERY_CODE, LEGACY_ID
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      parsedList = lines.map((line, idx) => {
        const parts = line.split(/[,\t| ]+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2 && parts[0].toUpperCase().startsWith("S")) {
          return {
            position: parts[0],
            battery_code: parts[1],
            legacy_cell_id: parts[2] || null,
          };
        } else if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return {
            series: parseInt(parts[0], 10),
            parallel: parseInt(parts[1], 10),
            battery_code: parts[2],
            legacy_cell_id: parts[3] || null,
          };
        } else {
          throw new Error(
            `Cannot parse line ${idx + 1}: "${line}". Expected format: "S1-P1, BATTERY_CODE, LEGACY_ID" or "1, 1, BATTERY_CODE, LEGACY_ID" (legacy ID optional)`
          );
        }
      });
    }

    // Normalize and validate each item
    const formatted = parsedList.map((item, idx) => {
      let s = item.series;
      let p = item.parallel;

      if ((s === undefined || p === undefined || s === null || p === null) && item.position) {
        const match = String(item.position).match(/S(\d+)-P(\d+)/i);
        if (match) {
          s = parseInt(match[1], 10);
          p = parseInt(match[2], 10);
        }
      }

      const code = item.battery_code || item.batteryCode || item.code;

      if (s === undefined || s === null || p === undefined || p === null || !code) {
        throw new Error(
          `Item at index ${idx} is missing series, parallel, or battery_code: ${JSON.stringify(item)}`
        );
      }

      s = parseInt(s, 10);
      p = parseInt(p, 10);

      if (isNaN(s) || s < 1 || s > SERIES_COUNT) {
        throw new Error(`Item at index ${idx} has invalid series (${s}). Must be 1 to ${SERIES_COUNT}.`);
      }
      if (isNaN(p) || p < 1 || p > PARALLEL_COUNT) {
        throw new Error(`Item at index ${idx} has invalid parallel (${p}). Must be 1 to ${PARALLEL_COUNT}.`);
      }

      const cleanCode = String(code).trim();

      // Optional legacy cell ID paired with this battery code (several key spellings accepted).
      // If the pasted data omits it, fall back to the pair we already have on record.
      const rawLegacy =
        item.legacy_cell_id ?? item.legacyCellId ?? item.legacy_id ?? item.legacyId ?? item.legacy;
      const provided =
        rawLegacy !== undefined && rawLegacy !== null && String(rawLegacy).trim() !== ""
          ? String(rawLegacy).trim()
          : null;
      const legacy = provided || legacyByCode[cleanCode] || null;

      return {
        series: s,
        parallel: p,
        battery_code: cleanCode,
        legacy_cell_id: legacy,
      };
    });

    // Duplicate detection within the batch (battery codes)
    const seenCodes = {};
    for (let i = 0; i < formatted.length; i++) {
      const code = formatted[i].battery_code;
      const pos = `S${formatted[i].series}-P${formatted[i].parallel}`;
      if (seenCodes[code]) {
        throw new Error(
          `Duplicate battery code '${code}' found in bulk import: appears at both ${seenCodes[code]} and ${pos}. Each cell can only occupy one slot.`
        );
      }
      seenCodes[code] = pos;
    }

    // Duplicate detection within the batch (legacy IDs): one legacy ID = one physical cell
    const seenLegacy = {};
    for (let i = 0; i < formatted.length; i++) {
      const lid = formatted[i].legacy_cell_id;
      if (!lid) continue;
      const key = lid.toLowerCase();
      const pos = `S${formatted[i].series}-P${formatted[i].parallel}`;
      if (seenLegacy[key]) {
        throw new Error(
          `Duplicate legacy cell ID '${lid}' found in bulk import: appears at both ${seenLegacy[key]} and ${pos}. Each legacy ID belongs to a single cell.`
        );
      }
      seenLegacy[key] = pos;
    }

    // Duplicate detection within the batch (positions): one slot holds one cell
    const seenPositions = {};
    for (let i = 0; i < formatted.length; i++) {
      const pos = `S${formatted[i].series}-P${formatted[i].parallel}`;
      if (seenPositions[pos]) {
        throw new Error(
          `Position ${pos} appears twice in the import ('${seenPositions[pos]}' and '${formatted[i].battery_code}'). Each slot holds one cell, so the later one would overwrite the earlier.`
        );
      }
      seenPositions[pos] = formatted[i].battery_code;
    }

    // Cross-reference against cells already deployed in the pack
    const positionsInBatch = new Set(formatted.map((f) => `S${f.series}-P${f.parallel}`));
    for (let i = 0; i < formatted.length; i++) {
      const code = formatted[i].battery_code;
      const batchPos = `S${formatted[i].series}-P${formatted[i].parallel}`;
      const existingEntry = Object.entries(assemblyMap).find(
        ([pos, bc]) => bc === code && pos !== batchPos && !positionsInBatch.has(pos)
      );
      if (existingEntry) {
        throw new Error(
          `Battery code '${code}' (at ${batchPos}) is already deployed at position ${existingEntry[0]} in the pack. Remove it first or use a different cell.`
        );
      }
    }

    return formatted;
  };

  const handleBulkImport = async () => {
    setBulkStatus(null);
    setBulkIsError(false);
    try {
      const formattedMappings = parseBulkInput(bulkJson);

      if (formattedMappings.length === 0) {
        throw new Error("No valid slot mappings found to import.");
      }

      // Legacy IDs are kept for display/pairing; only sent to the API if enabled above
      const apiPayload = formattedMappings.map((m) =>
        SEND_LEGACY_ID_TO_API
          ? m
          : { series: m.series, parallel: m.parallel, battery_code: m.battery_code }
      );

      // 🔗 AFTERLIFE API: Bulk assign validates batch codes against Afterlife inventory
      const res = await api.bulkAssign(packId, apiPayload);
      // Persist the code <-> legacy ID pairs right away
      rememberLegacy(formattedMappings);

      // Reload and verify that every imported position actually persisted
      const posKey = (s, p) => `S${s}-P${p}`;
      let fresh = await loadAssemblyData();
      const failures = [];
      let repaired = 0;

      if (fresh && Array.isArray(fresh.mapList)) {
        const saved = new Set(
          fresh.mapList
            .filter((slot) => slot.battery_code)
            .map((slot) => posKey(slot.series, slot.parallel))
        );
        const missing = formattedMappings.filter(
          (m) => !saved.has(posKey(m.series, m.parallel))
        );

        // Retry anything the bulk call dropped through the single-slot endpoint.
        for (const m of missing) {
          try {
            await api.assignCell(packId, m.series, m.parallel, m.battery_code);
            repaired += 1;
          } catch (err) {
            failures.push(`${posKey(m.series, m.parallel)}: ${err.message || "assign failed"}`);
          }
        }

        if (missing.length > 0) {
          fresh = await loadAssemblyData();
        }
      }

      const finalProg = fresh?.prog;
      const total = finalProg?.total_slots ?? TOTAL_SLOTS;
      const assigned = finalProg?.assigned_slots ?? res?.assigned_slots ?? formattedMappings.length;
      const pct = finalProg?.completion_percentage ?? res?.completion_percentage;
      const pairedCount = formattedMappings.filter((m) => m.legacy_cell_id).length;

      if (failures.length > 0) {
        setBulkIsError(true);
        setBulkStatus(
          `⚠️ Imported ${formattedMappings.length - failures.length} of ${formattedMappings.length} mappings. ` +
          `These did not save: ${failures.join(" | ")}. ` +
          `Pack mapped: ${assigned} / ${total} slots (${pct}% complete).`
        );
        // Keep the JSON in the editor so the failed rows can be retried
        return;
      }

      setBulkIsError(false);
      setBulkStatus(
        `✅ Successfully assigned ${formattedMappings.length} mappings (${pairedCount} with legacy IDs)` +
        `${repaired > 0 ? `, ${repaired} re-assigned after the bulk call skipped them` : ""}! ` +
        `Pack mapped: ${assigned} / ${total} slots (${pct}% complete).`
      );
      setBulkJson("");
    } catch (err) {
      setBulkIsError(true);
      setBulkStatus(`❌ Import Error: ${err.message || "Failed to import bulk mappings"}`);
    }
  };

  const handleLoadSampleJSON = () => {
    const sample = [
      { series: 1, parallel: 1, battery_code: "AFI-LIIO-18650-H6B7X", legacy_cell_id: "318" },
      { series: 1, parallel: 2, battery_code: "AFI-LIIO-18650-H5SES", legacy_cell_id: "320" },
      { series: 1, parallel: 3, battery_code: "AFI-LIIO-18650-CZA34", legacy_cell_id: "81" },
      { series: 1, parallel: 4, battery_code: "AFI-LIIO-18650-VTALS", legacy_cell_id: "102" },
    ];
    setBulkJson(JSON.stringify(sample, null, 2));
    setBulkStatus(null);
    setBulkIsError(false);
  };

  const handleLoadSamplePosition = () => {
    const sample = [
      { position: "S1-P1", battery_code: "AFI-LIIO-18650-H6B7X", legacy_cell_id: "318" },
      { position: "S1-P2", battery_code: "AFI-LIIO-18650-H5SES", legacy_cell_id: "320" },
      { position: "S1-P3", battery_code: "AFI-LIIO-18650-CZA34", legacy_cell_id: "81" },
    ];
    setBulkJson(JSON.stringify(sample, null, 2));
    setBulkStatus(null);
    setBulkIsError(false);
  };

  const handleUnassign = async (s, p) => {
    try {
      await api.unassignCell(packId, s, p);
      await loadAssemblyData();
    } catch (err) {
      console.error("Unassign error:", err);
    }
  };

  const handleClearAssignments = async () => {
    const assignedCount = mapData.filter((slot) => slot.battery_code).length;
    if (!assignedCount || !window.confirm(`Remove all ${assignedCount} cell assignments from ${packId}?`)) {
      return;
    }

    setClearingAssignments(true);
    setBulkIsError(false);
    setBulkStatus(null);
    try {
      const result = await api.clearPackAssignments(packId);
      await loadAssemblyData();
      setBulkStatus(`Cleared ${result.assignments_removed} cell assignment(s) from the current map.`);
    } catch (err) {
      setBulkIsError(true);
      setBulkStatus(`Failed to clear assignments: ${err.message || "Unknown error"}`);
    } finally {
      setClearingAssignments(false);
    }
  };

  const fetchPackBuilderSessions = async () => {
    try {
      setPackBuilderLoading(true);
      const data = await api.getPackSessions();
      const sessions = data.sessions || [];
      setPackBuilderSessions(sessions);
      return sessions;
    } catch (err) {
      console.error("Failed to load Pack Builder sessions:", err);
      return [];
    } finally {
      setPackBuilderLoading(false);
    }
  };

  const handlePopulatePackBuilder = async (targetSessionId = null) => {
    setBulkStatus(null);
    setBulkIsError(false);
    setPackBuilderLoading(true);
    try {
      let sessions = packBuilderSessions;
      if (!sessions || sessions.length === 0) {
        const data = await api.getPackSessions();
        sessions = data.sessions || [];
        setPackBuilderSessions(sessions);
      }

      if (sessions.length === 0) {
        throw new Error("No pack sessions found in Afterlife Pack Builder. Build a pack in Afterlife first or use Live Match.");
      }

      // Default to the most recent session if not explicitly specified
      const selectedSession = targetSessionId
        ? sessions.find((s) => s.session_id === targetSessionId) || sessions[0]
        : sessions[0];

      if (!selectedSession) {
        throw new Error("Selected pack session could not be found.");
      }

      // Fetch specific session with full cell assignments in their respective positions
      const sessionDetail = await api.getPackSession(selectedSession.session_id);
      if (!sessionDetail || !sessionDetail.assignments || sessionDetail.assignments.length === 0) {
        throw new Error(`Pack Builder session #${selectedSession.session_id} contains no cell assignments.`);
      }

      const { session, assignments } = sessionDetail;

      // Map cells to their respective physical positions (S, P)
      const mappings = assignments.map((c) => {
        let s = c.series_position;
        let p = c.parallel_position;

        // If parallel position exceeds the 11 parallel matrix columns, wrap cleanly across rows
        if (p > PARALLEL_COUNT) {
          const totalIdx = (s - 1) * (session.p_config || 22) + (p - 1);
          s = Math.floor(totalIdx / PARALLEL_COUNT) + 1;
          p = (totalIdx % PARALLEL_COUNT) + 1;
        }

        return {
          position: `S${s}-P${p}`,
          series: s,
          parallel: p,
          battery_code: c.battery_code,
          ...(c.legacy_cell_id ? { legacy_cell_id: String(c.legacy_cell_id) } : {}),
        };
      });

      // Keep the legacy pairs from the session even before the import is applied
      rememberLegacy(mappings);

      const withLegacy = mappings.filter((m) => m.legacy_cell_id).length;

      setBulkJson(JSON.stringify(mappings, null, 2));
      setBulkIsError(false);
      setBulkStatus(
        `✅ Populated ${mappings.length} cell(s) (${withLegacy} with legacy IDs) from Afterlife Pack Builder (Pack #${session.session_id} — ${session.s_config}S${session.p_config}P, ${session.chemistry} ${session.form_factor}) in their respective physical positions. Review below and click "Import Bulk Mapping" to apply.`
      );
      setShowPackPicker(false);
    } catch (err) {
      setBulkIsError(true);
      setBulkStatus(`❌ Pack Builder Error: ${err.message || "Failed to load pack from Afterlife API"}`);
    } finally {
      setPackBuilderLoading(false);
    }
  };

  const handleMatchAndAutoFill = async () => {
    setBulkStatus(null);
    setBulkIsError(false);
    setAutoFillLoading(true);
    try {
      // 🔗 AFTERLIFE API: /pack/match — returns matched pack or partial pack
      const res = await api.matchPack({
        chemistry: matchSettings.chemistry,
        form_factor: matchSettings.form_factor,
        series: SERIES_COUNT,
        parallel: PARALLEL_COUNT,
        soh_tolerance_pct: Number(matchSettings.soh_tolerance_pct),
        capacity_tolerance_pct: Number(matchSettings.capacity_tolerance_pct),
        dcir_tolerance_pct: Number(matchSettings.dcir_tolerance_pct),
        intra_parallel_capacity_tolerance_pct: Number(matchSettings.intra_parallel_capacity_tolerance_pct),
        allowed_grades: matchSettings.allowed_grades
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean),
      });

      const packObj = res.pack || res.partial_pack;
      let mappings = [];

      if (packObj && Array.isArray(packObj.parallel_groups) && packObj.parallel_groups.length > 0) {
        // Map each parallel group (series) and cell (parallel) into their respective positions
        packObj.parallel_groups.forEach((group, sIdx) => {
          const s = sIdx + 1;
          (group.cells || []).forEach((cell, pIdx) => {
            const p = pIdx + 1;
            mappings.push({
              position: `S${s}-P${p}`,
              series: s,
              parallel: p,
              battery_code: cell.battery_code,
              ...(cell.legacy_cell_id ? { legacy_cell_id: String(cell.legacy_cell_id) } : {}),
            });
          });
        });
      } else if (Array.isArray(res) && res.length > 0) {
        // Fallback for flat array response
        const emptySlots = mapData
          .filter((slot) => !slot.battery_code)
          .sort((a, b) => a.series - b.series || a.parallel - b.parallel);
        mappings = emptySlots.slice(0, res.length).map((slot, i) => ({
          position: slot.position,
          series: slot.series,
          parallel: slot.parallel,
          battery_code: res[i].battery_code,
          ...(res[i].legacy_cell_id ? { legacy_cell_id: String(res[i].legacy_cell_id) } : {}),
        }));
      } else {
        throw new Error(res.message || "Afterlife returned no matched cells for the requested tolerances.");
      }

      if (mappings.length === 0) {
        throw new Error("No cells available in matched pack groups.");
      }

      // Keep the legacy pairs from the match even before the import is applied
      rememberLegacy(mappings);

      const withLegacy = mappings.filter((m) => m.legacy_cell_id).length;

      setBulkJson(JSON.stringify(mappings, null, 2));
      setBulkIsError(false);
      setBulkStatus(
        `⚡ Live Match: Populated ${mappings.length} cell(s) (${withLegacy} with legacy IDs) from Afterlife Pack Matcher into their respective positions (${res.matched ? "Full Pack" : "Partial Pack"}). Review below, then click "Import Bulk Mapping" to apply.`
      );
    } catch (err) {
      setBulkIsError(true);
      setBulkStatus(`❌ Match failed: ${err.message || "Could not fetch matched cells from Afterlife"}`);
    } finally {
      setAutoFillLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={closeModal}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>PACK ASSEMBLY MAP MANAGER</h2>
            <span className={styles.subtitle}>Pack ID: {packId}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              className={styles.searchBtn}
              style={{ fontSize: "12px", padding: "6px 12px", background: "rgba(59, 130, 246, 0.15)", borderColor: "rgba(59, 130, 246, 0.4)", color: "#93c5fd" }}
              onClick={() => { closeModal(); setGradeInventoryOpen(true); }}
              title="Open Afterlife Intelligence Cell Grades Explorer"
            >
              Browse Cell Grades
            </button>
            <button className={styles.closeBtn} onClick={closeModal}>✕</button>
          </div>
        </div>

        <div className={styles.body}>
          {/* Progress Bar Header */}
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>ASSEMBLY PROGRESS</span>
              <span className={styles.progressValue}>
                {progress.assigned_slots} / {progress.total_slots} Slots Mapped ({progress.completion_percentage}%)
              </span>
            </div>
            <div className={styles.progressBarTrack}>
              <div
                className={styles.progressBarFill}
                style={{ width: `${progress.completion_percentage}%` }}
              />
            </div>
          </div>

          <div className={styles.sectionsContainer}>
            {/* Left Column: Manual/Scan Assign & Legacy Search */}
            <div className={styles.column}>
              {/* Scan / Single Assign Card */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>SCAN-TO-ASSIGN CELL</h3>
                  <span className={styles.apiTag}>AFTERLIFE API VALIDATED</span>
                </div>

                <form onSubmit={handleAssignSingle} className={styles.form}>
                  <div className={styles.formRow}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Series (1-{SERIES_COUNT})</label>
                      <select
                        className={styles.select}
                        value={seriesInput}
                        onChange={(e) => setSeriesInput(e.target.value)}
                      >
                        {Array.from({ length: SERIES_COUNT }, (_, i) => i + 1).map((s) => (
                          <option key={s} value={s}>S{s}</option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Parallel (1-{PARALLEL_COUNT})</label>
                      <select
                        className={styles.select}
                        value={parallelInput}
                        onChange={(e) => setParallelInput(e.target.value)}
                      >
                        {Array.from({ length: PARALLEL_COUNT }, (_, i) => i + 1).map((p) => (
                          <option key={p} value={p}>P{p}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Battery Code (Scan or Type)</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="e.g. AFI-LIIO-18650-JN39Q"
                      value={batteryCodeInput}
                      onChange={(e) => setBatteryCodeInput(e.target.value)}
                    />
                  </div>

                  {assignError && <div className={styles.errorBox}>{assignError}</div>}
                  {assignSuccess && <div className={styles.successBox}>{assignSuccess}</div>}

                  <button type="submit" className={styles.submitBtn}>
                     Assign & Validate Passport
                  </button>
                </form>
              </div>

              {/* Legacy Search Card */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>LEGACY CELL ID LOOKUP</h3>
                  <span className={styles.apiTag}>AFTERLIFE API SEARCH</span>
                </div>

                <div className={styles.searchRow}>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Enter Legacy ID (e.g. 318, 320, 81)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearchLegacy()}
                  />
                  <button className={styles.searchBtn} onClick={handleSearchLegacy}>
                    Search
                  </button>
                </div>

                {searchLoading && <div className={styles.loader}>Searching Afterlife inventory...</div>}

                {searchResults.length > 0 && (
                  <div className={styles.resultsList}>
                    {searchResults.map((p) => (
                      <div
                        key={p.battery_code}
                        className={styles.resultItem}
                        onClick={() => handleSelectSearchResult(p)}
                      >
                        <div>
                          <div className={styles.resultCode}>{p.battery_code}</div>
                          <div className={styles.resultMeta}>
                            Legacy ID: {p.legacy_cell_id || "N/A"} | DCIR: {p.dcir_mohm || "--"} mΩ | OCV: {p.intake_ocv_v || "--"} V | Grade: {p.current_grade || "Ungraded"}
                          </div>
                        </div>
                        <span className={styles.selectTag}>Select</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Bulk Import & Slot Table */}
            <div className={styles.column}>
              {/* Bulk Import Card */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>BULK MAPPING IMPORT (JSON / CSV)</h3>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                    {/* Pack Builder Populate Button with Dropdown Selector */}
                    <div className={styles.packBuilderBtnGroup}>
                      <button
                        type="button"
                        className={styles.packBuilderBtn}
                        style={{ fontSize: "11px", padding: "4px 8px" }}
                        onClick={() => handlePopulatePackBuilder()}
                        disabled={packBuilderLoading}
                        title="1-Click: Populate cells from Afterlife Pack Builder in their respective positions into bulk import JSON"
                      >
                        {packBuilderLoading ? "Populating..." : "Populate Pack Builder"}
                      </button>
                      <button
                        type="button"
                        className={styles.packBuilderDropdownToggle}
                        style={{ fontSize: "11px", padding: "4px 8px" }}
                        onClick={async () => {
                          if (!showPackPicker && packBuilderSessions.length === 0) {
                            await fetchPackBuilderSessions();
                          }
                          setShowPackPicker((v) => !v);
                        }}
                        title="Choose a specific Pack Builder session from Afterlife API"
                      >
                        ▾
                      </button>
                    </div>

                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handleMatchAndAutoFill}
                      disabled={autoFillLoading}
                      title="Run Afterlife Live Pack Matcher and auto-fill slots in their respective positions"
                    >
                      {autoFillLoading ? "Matching..." : "Live Match"}
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                     style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handlePullCurrentMap}
                      title="Pull the JSON schema of every cell currently mapped in the matrix into the editor"
                    >
                       Pull Current Map
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={() => setShowMatchSettings((s) => !s)}
                    >
                       {showMatchSettings ? "Hide" : ""} Match Settings
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handleLoadSampleJSON}
                    >
                      Sample JSON
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handleLoadSamplePosition}
                    >
                      Position Format
                    </button>
                  </div>
                </div>

                {/* Afterlife Pack Builder Session Picker Dropdown / Panel */}
                {showPackPicker && (
                  <div className={styles.packPickerPanel}>
                    <div className={styles.packPickerHeader}>
                      <div>
                        <span className={styles.packPickerTitle}>AFTERLIFE PACK BUILDER SESSIONS</span>
                        <span className={styles.packPickerSubtitle}>
                          Select a pack to populate cell codes into bulk mapping import in their respective positions
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.packPickerCloseBtn}
                        onClick={() => setShowPackPicker(false)}
                      >
                        ✕
                      </button>
                    </div>

                    {packBuilderLoading && packBuilderSessions.length === 0 ? (
                      <div className={styles.loader}>Fetching sessions from Afterlife API...</div>
                    ) : packBuilderSessions.length === 0 ? (
                      <div style={{ padding: "12px", color: "var(--text-muted)", fontSize: "12px" }}>
                        No pack sessions found in Afterlife API.
                      </div>
                    ) : (
                      <div className={styles.sessionList}>
                        {packBuilderSessions.map((sess, idx) => (
                          <div key={sess.session_id} className={styles.sessionCard}>
                            <div className={styles.sessionCardTop}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span className={styles.sessionId}>Pack #{sess.session_id}</span>
                                <span className={styles.sessionConfig}>
                                  {sess.s_config}S × {sess.p_config}P ({sess.assigned_count || sess.total_cells_needed} cells)
                                </span>
                                {idx === 0 && <span className={styles.latestTag}>LATEST</span>}
                              </div>
                              <span className={styles.sessionStatusPill}>
                                {sess.status?.toUpperCase() || "SUGGESTED"}
                              </span>
                            </div>
                            <div className={styles.sessionMetaRow}>
                              <span>Chemistry: {sess.chemistry} {sess.form_factor}</span>
                              <span>{sess.confirmed_by ? `Confirmed by: ${sess.confirmed_by}` : `Created: ${new Date(sess.created_at).toLocaleDateString()}`}</span>
                            </div>
                            <button
                              type="button"
                              className={styles.populateSessionBtn}
                              onClick={() => handlePopulatePackBuilder(sess.session_id)}
                              disabled={packBuilderLoading}
                            >
                              Populate Pack #{sess.session_id} ({sess.s_config}S×{sess.p_config}P) into Bulk Import
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {showMatchSettings && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "8px",
                      marginBottom: "10px",
                      padding: "10px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: "6px",
                    }}
                  >
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Chemistry</label>
                      <input
                        className={styles.input}
                        value={matchSettings.chemistry}
                        onChange={(e) => setMatchSettings({ ...matchSettings, chemistry: e.target.value })}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Form Factor</label>
                      <input
                        className={styles.input}
                        value={matchSettings.form_factor}
                        onChange={(e) => setMatchSettings({ ...matchSettings, form_factor: e.target.value })}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>SOH Tolerance %</label>
                      <input
                        type="number"
                        className={styles.input}
                        value={matchSettings.soh_tolerance_pct}
                        onChange={(e) => setMatchSettings({ ...matchSettings, soh_tolerance_pct: e.target.value })}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Capacity Tolerance %</label>
                      <input
                        type="number"
                        className={styles.input}
                        value={matchSettings.capacity_tolerance_pct}
                        onChange={(e) => setMatchSettings({ ...matchSettings, capacity_tolerance_pct: e.target.value })}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>DCIR Tolerance %</label>
                      <input
                        type="number"
                        className={styles.input}
                        value={matchSettings.dcir_tolerance_pct}
                        onChange={(e) => setMatchSettings({ ...matchSettings, dcir_tolerance_pct: e.target.value })}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>Intra-Parallel Capacity Tolerance %</label>
                      <input
                        type="number"
                        className={styles.input}
                        value={matchSettings.intra_parallel_capacity_tolerance_pct}
                        onChange={(e) =>
                          setMatchSettings({ ...matchSettings, intra_parallel_capacity_tolerance_pct: e.target.value })
                        }
                      />
                    </div>
                    <div className={styles.inputGroup} style={{ gridColumn: "1 / -1" }}>
                      <label className={styles.label}>Allowed Grades (comma-separated)</label>
                      <input
                        className={styles.input}
                        value={matchSettings.allowed_grades}
                        onChange={(e) => setMatchSettings({ ...matchSettings, allowed_grades: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <textarea
                  className={styles.textarea}
                  rows={5}
                  placeholder={`Supports JSON array (legacy_cell_id is optional):\n[\n  { "series": 1, "parallel": 1, "battery_code": "AFI-LIIO-18650-H6B7X", "legacy_cell_id": "318" },\n  { "position": "S1-P2", "battery_code": "AFI-LIIO-18650-H5SES", "legacy_cell_id": "320" }\n]\n\nOr CSV lines (position, battery code, legacy ID):\nS1-P1, AFI-LIIO-18650-H6B7X, 318\nS1-P2, AFI-LIIO-18650-H5SES, 320\n\nOr numeric (series, parallel, battery code, legacy ID):\n1, 3, AFI-LIIO-18650-CZA34, 81`}
                  value={bulkJson}
                  onChange={(e) => setBulkJson(e.target.value)}
                />

                {bulkStatus && (
                  <div className={bulkIsError ? styles.errorBox : styles.infoBox} style={{ marginTop: "10px" }}>
                    {bulkStatus}
                  </div>
                )}

                <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                  <button
                    className={styles.submitBtn}
                    style={{ flex: 1 }}
                    onClick={handleBulkImport}
                  >
                    Import Bulk Mapping
                  </button>
                  {bulkJson && (
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "12px", padding: "8px 12px" }}
                      onClick={() => { setBulkJson(""); setBulkStatus(null); }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Mapped Slots Table */}
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>CURRENT ASSIGNMENTS ({mapData.filter(s => s.battery_code).length} / {progress.total_slots || TOTAL_SLOTS})</h3>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      className={styles.unassignBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handleClearAssignments}
                      disabled={clearingAssignments || !mapData.some((slot) => slot.battery_code)}
                      title="Remove every current cell assignment from this pack"
                    >
                      {clearingAssignments ? "Clearing..." : "Clear All"}
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handlePullCurrentMap}
                      title="Load the current matrix as JSON into the editor above"
                    >
                      Pull JSON
                    </button>
                    <button
                      type="button"
                      className={styles.searchBtn}
                      style={{ fontSize: "11px", padding: "4px 8px" }}
                      onClick={handleCopyCurrentMap}
                      title="Copy the current matrix JSON to the clipboard"
                    >
                      Copy JSON
                    </button>
                  </div>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>POSITION</th>
                        <th>BATTERY CODE</th>
                        <th>LEGACY ID</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapData
                        .filter((slot) => slot.battery_code)
                        .map((slot) => (
                          <tr key={slot.position}>
                            <td className={styles.posCell}>{slot.position}</td>
                            <td className={styles.codeCell}>{slot.battery_code}</td>
                            <td className={styles.codeCell}>
                              {getLegacy(slot) || "—"}
                            </td>
                            <td>
                              <button
                                className={styles.unassignBtn}
                                onClick={() => handleUnassign(slot.series, slot.parallel)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      {mapData.filter((s) => s.battery_code).length === 0 && (
                        <tr>
                          <td colSpan={4} className={styles.emptyTd}>
                            No slots mapped yet. Scan or import cell codes above.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssemblyMapModal;