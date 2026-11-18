import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { useTelemetryStore } from "../../stores/useTelemetryStore";
import styles from "./Pack3DView.module.css";
import { getCellDisplayStatus } from "./cellDisplayStatus";

function getCellColor(cell, position, anomalyFlags, isHeatmap) {
  if (isHeatmap) {
    const temp = cell?.temperature_c;
    if (temp == null) return new THREE.Color("#334155");
    if (temp <= 24) {
      // Cool: Pure Cyan (#00FFFF)
      return new THREE.Color("#00FFFF");
    } else if (temp <= 34) {
      // Nominal Normal: Pure Green (#008000)
      return new THREE.Color("#008000");
    } else if (temp <= 45) {
      // Elevated Warm: Pure Yellow (#FFFF00)
      return new THREE.Color("#FFFF00");
    } else if (temp <= 52) {
      // High Warning: Pure Orange (#FFA500)
      return new THREE.Color("#FFA500");
    } else {
      // Critical Hazard: Pure Red (#FF0000)
      return new THREE.Color("#FF0000");
    }
  }

  // Default: Health traffic light (pure hex codes)
  const status = getCellDisplayStatus(cell, position, anomalyFlags);
  if (!status) return new THREE.Color("#334155");
  if (status === "red") return new THREE.Color("#FF0000");
  if (status === "yellow") return new THREE.Color("#FFFF00");
  return new THREE.Color("#008000");
}


export const Pack3DView = () => {
  const mountRef = useRef(null);

  // Mutable refs for reactive state — the animation loop reads these
  // without triggering a scene teardown/rebuild
  const cellsRef = useRef({});
  const assemblyMapRef = useRef({});
  const legacyMapRef = useRef({});
  const anomalyFlagsRef = useRef({});
  const heatmapOverlayRef = useRef(false);
  const selectedPositionRef = useRef(null);

  // Store references from the Zustand store
  const cells = useTelemetryStore((state) => state.cells);
  const assemblyMap = useTelemetryStore((state) => state.assemblyMap);
  const legacyMap = useTelemetryStore((state) => state.legacyMap);
  const anomalyFlags = useTelemetryStore((state) => state.anomalyFlags);
  const heatmapOverlay = useTelemetryStore((state) => state.heatmapOverlay);
  const selectedPosition = useTelemetryStore((state) => state.selectedPosition);
  const setSelectedPosition = useTelemetryStore((state) => state.setSelectedPosition);
  const setHoveredCell = useTelemetryStore((state) => state.setHoveredCell);
  const clearHoveredCell = useTelemetryStore((state) => state.clearHoveredCell);

  // Stable refs for store actions (these never change)
  const setSelectedPositionRef = useRef(setSelectedPosition);
  const setHoveredCellRef = useRef(setHoveredCell);
  const clearHoveredCellRef = useRef(clearHoveredCell);

  // Keep action refs up to date
  useEffect(() => {
    setSelectedPositionRef.current = setSelectedPosition;
    setHoveredCellRef.current = setHoveredCell;
    clearHoveredCellRef.current = clearHoveredCell;
  }, [setSelectedPosition, setHoveredCell, clearHoveredCell]);

  // ─── Effect 2: State Sync (runs on every telemetry/state change) ───
  // Updates mutable refs so the animation loop picks up new data
  // WITHOUT destroying and recreating the Three.js scene.
  useEffect(() => {
    cellsRef.current = cells;
  }, [cells]);

  useEffect(() => {
    assemblyMapRef.current = assemblyMap;
  }, [assemblyMap]);

  useEffect(() => {
    legacyMapRef.current = legacyMap;
  }, [legacyMap]);

  useEffect(() => {
    anomalyFlagsRef.current = anomalyFlags;
  }, [anomalyFlags]);

  useEffect(() => {
    heatmapOverlayRef.current = heatmapOverlay;
  }, [heatmapOverlay]);

  useEffect(() => {
    selectedPositionRef.current = selectedPosition;
  }, [selectedPosition]);

  const seriesCount = 8;
  const parallelCount = 11;

  // ─── Effect 1: Scene Setup (mount-only) ───
  // Creates the entire Three.js scene once. The animation loop reads
  // from mutable refs, so it always uses current state.
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const getWidth = () => container.clientWidth || container.parentElement?.clientWidth || 1100;
    const getHeight = () => container.clientHeight || 540;

    let width = getWidth();
    let height = getHeight();

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 22, 20);
    camera.lookAt(0, 0, 0);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;

    // Clear any leftover canvas before appending
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(20, 40, 20);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight2.position.set(-20, -10, -20);
    scene.add(dirLight2);

    // Grid Floor / Base plate (sized proportionally for 8S11P matrix)
    const gridHelper = new THREE.GridHelper(24, 12, 0x3b82f6, 0x1f2937);
    gridHelper.position.y = -0.05;
    scene.add(gridHelper);

    // Group for all 88 cell meshes (8 series x 11 parallel)
    const packGroup = new THREE.Group();
    scene.add(packGroup);

    // Cell Geometries
    const cellRadius = 0.65;
    const cellHeight = 2.4;
    const cylinderGeo = new THREE.CylinderGeometry(cellRadius, cellRadius, cellHeight, 24);
    const topCapGeo = new THREE.CylinderGeometry(cellRadius * 0.4, cellRadius * 0.4, 0.15, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 0.8, roughness: 0.2 });

    // Store cell meshes mapped by position string
    const meshMap = new Map();
    const cellObjects = [];

    const spacingX = 1.6;
    const spacingZ = 1.8;
    const offsetX = -((parallelCount - 1) * spacingX) / 2;
    const offsetZ = -((seriesCount - 1) * spacingZ) / 2;

    for (let s = 1; s <= seriesCount; s++) {
      for (let p = 1; p <= parallelCount; p++) {
        const pos = `S${s}-P${p}`;
        const posX = offsetX + (p - 1) * spacingX;
        const posZ = offsetZ + (s - 1) * spacingZ;

        // Individual cell group
        const cellGroup = new THREE.Group();
        cellGroup.position.set(posX, cellHeight / 2, posZ);

        const cellMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color("#334155"),
          roughness: 0.35,
          metalness: 0.1,
        });

        const bodyMesh = new THREE.Mesh(cylinderGeo, cellMat);
        bodyMesh.castShadow = true;
        bodyMesh.receiveShadow = true;
        cellGroup.add(bodyMesh);

        // Positive Terminal Cap
        const capMesh = new THREE.Mesh(topCapGeo, capMat);
        capMesh.position.y = cellHeight / 2 + 0.08;
        cellGroup.add(capMesh);

        cellGroup.userData = { position: pos, series: s, parallel: p };
        bodyMesh.userData = cellGroup.userData;

        packGroup.add(cellGroup);
        meshMap.set(pos, { cellGroup, bodyMesh, cellMat });
        cellObjects.push(bodyMesh);
      }
    }

    // Glowing selection ring
    const ringGeo = new THREE.TorusGeometry(cellRadius * 1.3, 0.08, 16, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.rotation.x = Math.PI / 2;
    selectionRing.visible = false;
    scene.add(selectionRing);

    // ─── Orbit & Drag Controls ───
    // Spherical state lives here (persists across re-renders)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    const spherical = { radius: 26, theta: Math.PI / 3.8, phi: Math.PI / 3.5 };

    const updateCameraPosition = () => {
      spherical.theta = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, spherical.theta));
      spherical.radius = Math.max(8, Math.min(80, spherical.radius));

      camera.position.x = spherical.radius * Math.sin(spherical.theta) * Math.sin(spherical.phi);
      camera.position.y = spherical.radius * Math.cos(spherical.theta);
      camera.position.z = spherical.radius * Math.sin(spherical.theta) * Math.cos(spherical.phi);
      camera.lookAt(0, 0, 0);
    };
    updateCameraPosition();

    // Mouse Event Handlers
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseDown = (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        spherical.phi -= deltaX * 0.008;
        spherical.theta -= deltaY * 0.008;
        updateCameraPosition();

        previousMousePosition = { x: e.clientX, y: e.clientY };
        return;
      }

      // Raycast for hover
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cellObjects);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const { position, series, parallel } = hit.userData;
        const currentCells = cellsRef.current;
        const currentMap = assemblyMapRef.current;
        const cellData = currentCells[position] || {
          position,
          series,
          parallel,
        };
        const assignedCode = currentMap[position];
        container.style.cursor = "pointer";

        const legId = (legacyMapRef.current && (legacyMapRef.current[position] || legacyMapRef.current[assignedCode])) || null;
        setHoveredCellRef.current(position, { ...cellData, battery_code: assignedCode, legacy_cell_id: legId }, {
          x: e.clientX,
          y: e.clientY - 15,
        });
      } else {
        container.style.cursor = "grab";
        clearHoveredCellRef.current();
      }
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      spherical.radius += e.deltaY * 0.03;
      updateCameraPosition();
    };

    const onClick = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cellObjects);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        setSelectedPositionRef.current(hit.userData.position);
      }
    };

    const dom = renderer.domElement;
    dom.addEventListener("mousedown", onMouseDown);
    dom.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("click", onClick);

    // ─── Animation Loop ───
    // Reads from mutable refs on every frame — never stale
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Smooth subtle idle rotation
      if (!isDragging) {
        spherical.phi += 0.0008;
        updateCameraPosition();
      }

      // Update dynamic mesh colors based on latest state from refs
      const currentCells = cellsRef.current;
      const currentMap = assemblyMapRef.current;
      const currentAnomalyFlags = anomalyFlagsRef.current;
      const currentHeatmap = heatmapOverlayRef.current;
      const currentSelected = selectedPositionRef.current;

      meshMap.forEach(({ cellMat, cellGroup }, pos) => {
        const cellData = currentCells[pos] || {};
        const code = currentMap[pos];
        const targetColor = getCellColor(
          cellData,
          pos,
          currentAnomalyFlags,
          currentHeatmap,
        );
        cellMat.color.lerp(targetColor, 0.1);

        cellMat.transparent = false;
        cellMat.opacity = 1.0;
      });

      // Update selection ring position
      if (currentSelected && meshMap.has(currentSelected)) {
        const selGroup = meshMap.get(currentSelected).cellGroup;
        selectionRing.position.set(selGroup.position.x, 0.1, selGroup.position.z);
        selectionRing.visible = true;
      } else {
        selectionRing.visible = false;
      }

      renderer.render(scene, camera);
    };
    animate();

    // ─── Resize Handling ───
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || container.parentElement?.clientWidth || 1100;
      const h = container.clientHeight || 540;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    };
    window.addEventListener("resize", handleResize);

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    // ─── Cleanup (only runs on unmount) ───
    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      dom.removeEventListener("mousedown", onMouseDown);
      dom.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("click", onClick);
      window.removeEventListener("resize", handleResize);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []); // Mount-only — no dependencies


  return (
    <div className={styles.container3D}>
      <div className={styles.canvasContainer} ref={mountRef} />
      <div className={styles.instructionsOverlay}>
        <span> Drag to orbit 3D view | Scroll to zoom | Click cell for diagnostics</span>
      </div>
    </div>
  );
};

export default Pack3DView;
