"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import * as turf from "@turf/turf";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";

// Types for our hierarchical structure
type PolygonType = "area" | "mz" | "sp";

interface PolygonData {
  id: string;
  type: PolygonType;
  name: string;
  parentId: string | null; // Areas have no parent, MZs have area parent, SPs have MZ parent
  area: number;
  perimeter: number;
  width: number;
  height: number;
  vertices: number;
  coordinates: number[][];
}

interface MapboxMapProps {
  accessToken: string;
  initialCenter?: [number, number];
  initialZoom?: number;
}

// Colors for different polygon types
const POLYGON_COLORS = {
  area: { fill: "#3b82f6", stroke: "#1d4ed8" }, // Blue
  mz: { fill: "#22c55e", stroke: "#16a34a" }, // Green
  sp: { fill: "#f59e0b", stroke: "#d97706" }, // Orange/Amber
};

export default function MapboxMap({
  accessToken,
  initialCenter = [-74.5, 40],
  initialZoom = 9,
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);

  // Refs to track current drawing context (used in event handlers)
  const drawingTypeRef = useRef<PolygonType>("area");
  const selectedParentIdRef = useRef<string | null>(null);

  const [polygons, setPolygons] = useState<PolygonData[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDirectSelectMode, setIsDirectSelectMode] = useState(false);
  const [drawingType, setDrawingType] = useState<PolygonType>("area");
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Get polygons by type
  const areas = polygons.filter((p) => p.type === "area");
  const monitoringZones = polygons.filter((p) => p.type === "mz");
  const samplePlots = polygons.filter((p) => p.type === "sp");

  // Get MZs for a specific area
  const getMZsForArea = (areaId: string) =>
    monitoringZones.filter((mz) => mz.parentId === areaId);

  // Get SPs for a specific MZ
  const getSPsForMZ = (mzId: string) =>
    samplePlots.filter((sp) => sp.parentId === mzId);

  const calculatePolygonMeasurements = useCallback(
    (
      feature: GeoJSON.Feature<GeoJSON.Polygon>,
      type: PolygonType,
      parentId: string | null,
      existingName?: string
    ): PolygonData => {
      const coordinates = feature.geometry.coordinates[0];
      const polygon = turf.polygon([coordinates]);

      const area = turf.area(polygon);
      const perimeter = turf.length(turf.lineString(coordinates), {
        units: "meters",
      });

      const bbox = turf.bbox(polygon);
      const minLng = bbox[0];
      const minLat = bbox[1];
      const maxLng = bbox[2];
      const maxLat = bbox[3];

      const centerLat = (minLat + maxLat) / 2;
      const width = turf.distance(
        turf.point([minLng, centerLat]),
        turf.point([maxLng, centerLat]),
        { units: "meters" }
      );

      const centerLng = (minLng + maxLng) / 2;
      const height = turf.distance(
        turf.point([centerLng, minLat]),
        turf.point([centerLng, maxLat]),
        { units: "meters" }
      );

      // Generate name based on type and count
      const typeLabels = { area: "Area", mz: "Monitoring Zone", sp: "Sample Plot" };
      const existingOfType = polygons.filter((p) => p.type === type);
      const name = existingName || `${typeLabels[type]} ${existingOfType.length + 1}`;

      return {
        id: feature.id as string,
        type,
        name,
        parentId,
        area,
        perimeter,
        width,
        height,
        vertices: coordinates.length - 1,
        coordinates,
      };
    },
    [polygons]
  );

  // Check if polygon overlaps with others of the same type
  const checkOverlap = useCallback(
    (
      newCoords: number[][],
      type: PolygonType,
      excludeId?: string
    ): boolean => {
      const newPolygon = turf.polygon([newCoords]);
      const sameTypePolygons = polygons.filter(
        (p) => p.type === type && p.id !== excludeId
      );

      for (const existing of sameTypePolygons) {
        const existingPolygon = turf.polygon([existing.coordinates]);
        const intersection = turf.intersect(
          turf.featureCollection([newPolygon, existingPolygon])
        );
        if (intersection) {
          return true; // Overlap detected
        }
      }
      return false;
    },
    [polygons]
  );

  // Check if polygon is within parent boundary
  const checkWithinParent = useCallback(
    (newCoords: number[][], parentId: string): boolean => {
      const parent = polygons.find((p) => p.id === parentId);
      if (!parent) return false;

      const newPolygon = turf.polygon([newCoords]);
      const parentPolygon = turf.polygon([parent.coordinates]);

      return turf.booleanContains(parentPolygon, newPolygon);
    },
    [polygons]
  );

  // Validate new polygon
  const validatePolygon = useCallback(
    (
      coords: number[][],
      type: PolygonType,
      parentId: string | null,
      excludeId?: string
    ): { valid: boolean; error: string | null } => {
      // Check overlap with same type
      if (checkOverlap(coords, type, excludeId)) {
        const typeLabels = { area: "Areas", mz: "Monitoring Zones", sp: "Sample Plots" };
        return {
          valid: false,
          error: `${typeLabels[type]} cannot overlap with each other`,
        };
      }

      // Check containment for MZ and SP
      if (type === "mz" && parentId) {
        if (!checkWithinParent(coords, parentId)) {
          return {
            valid: false,
            error: "Monitoring Zone must be completely within the selected Area",
          };
        }
      }

      if (type === "sp" && parentId) {
        if (!checkWithinParent(coords, parentId)) {
          return {
            valid: false,
            error: "Sample Plot must be completely within the selected Monitoring Zone",
          };
        }
      }

      return { valid: true, error: null };
    },
    [checkOverlap, checkWithinParent]
  );

  // Helper to calculate measurements only - defined before updatePolygonsList
  const calculateMeasurementsOnly = useCallback((coordinates: number[][]) => {
    const polygon = turf.polygon([coordinates]);
    const area = turf.area(polygon);
    const perimeter = turf.length(turf.lineString(coordinates), {
      units: "meters",
    });

    const bbox = turf.bbox(polygon);
    const minLng = bbox[0];
    const minLat = bbox[1];
    const maxLng = bbox[2];
    const maxLat = bbox[3];

    const centerLat = (minLat + maxLat) / 2;
    const width = turf.distance(
      turf.point([minLng, centerLat]),
      turf.point([maxLng, centerLat]),
      { units: "meters" }
    );

    const centerLng = (minLng + maxLng) / 2;
    const height = turf.distance(
      turf.point([centerLng, minLat]),
      turf.point([centerLng, maxLat]),
      { units: "meters" }
    );

    return { area, perimeter, width, height, vertices: coordinates.length - 1 };
  }, []);

  const updatePolygonsList = useCallback(() => {
    if (!draw.current) return;

    const data = draw.current.getAll();
    const polygonFeatures = data.features.filter(
      (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
        f.geometry.type === "Polygon"
    );

    // Update existing polygons with new coordinates
    setPolygons((prev) => {
      const updated = prev.map((p) => {
        const feature = polygonFeatures.find((f) => f.id === p.id);
        if (feature) {
          return {
            ...p,
            coordinates: feature.geometry.coordinates[0],
            ...calculateMeasurementsOnly(feature.geometry.coordinates[0]),
          };
        }
        return p;
      });
      return updated;
    });
  }, [calculateMeasurementsOnly]);

  // Apply custom styles to polygons based on type
  const applyPolygonStyles = useCallback(() => {
    if (!map.current || !draw.current) return;

    // This would require custom draw styles - for now we handle it via the draw config
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = accessToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: initialCenter,
      zoom: initialZoom,
    });

    // Custom styles for draw
    const drawStyles = [
      // Polygon fill - active
      {
        id: "gl-draw-polygon-fill-active",
        type: "fill",
        filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
        paint: {
          "fill-color": "#fbb03b",
          "fill-outline-color": "#fbb03b",
          "fill-opacity": 0.3,
        },
      },
      // Polygon fill - inactive
      {
        id: "gl-draw-polygon-fill-inactive",
        type: "fill",
        filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
        paint: {
          "fill-color": "#3bb2d0",
          "fill-outline-color": "#3bb2d0",
          "fill-opacity": 0.2,
        },
      },
      // Polygon stroke - active
      {
        id: "gl-draw-polygon-stroke-active",
        type: "line",
        filter: ["all", ["==", "active", "true"], ["==", "$type", "Polygon"]],
        paint: {
          "line-color": "#fbb03b",
          "line-width": 3,
        },
      },
      // Polygon stroke - inactive
      {
        id: "gl-draw-polygon-stroke-inactive",
        type: "line",
        filter: ["all", ["==", "active", "false"], ["==", "$type", "Polygon"]],
        paint: {
          "line-color": "#3bb2d0",
          "line-width": 2,
        },
      },
      // Vertex points
      {
        id: "gl-draw-point",
        type: "circle",
        filter: ["all", ["==", "$type", "Point"]],
        paint: {
          "circle-radius": 6,
          "circle-color": "#fff",
          "circle-stroke-color": "#fbb03b",
          "circle-stroke-width": 2,
        },
      },
    ];

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: false,
        trash: true,
      },
      defaultMode: "simple_select",
      styles: drawStyles,
    });

    map.current.addControl(draw.current, "top-left");
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    const geocoder = new MapboxGeocoder({
      accessToken: accessToken,
      mapboxgl: mapboxgl,
      marker: true,
      placeholder: "Search address, place, or coordinates...",
      zoom: 17,
      types: "country,region,postcode,district,place,locality,neighborhood,address,poi,poi.landmark",
    });
    map.current.addControl(geocoder, "top-left");

    // Event handlers - draw.create is handled in a separate useEffect to access current refs

    map.current.on("draw.update", () => {
      updatePolygonsList();
    });

    map.current.on("draw.delete", (e: { features: GeoJSON.Feature[] }) => {
      const deletedIds = e.features.map((f) => f.id as string);

      setPolygons((prev) => {
        // Also delete children
        const toDelete = new Set(deletedIds);

        // Find all children recursively
        const findChildren = (parentIds: string[]) => {
          const children = prev.filter((p) => parentIds.includes(p.parentId || ""));
          if (children.length > 0) {
            children.forEach((c) => toDelete.add(c.id));
            findChildren(children.map((c) => c.id));
          }
        };

        findChildren(deletedIds);

        // Delete children from draw
        if (draw.current) {
          toDelete.forEach((id) => {
            if (!deletedIds.includes(id)) {
              draw.current?.delete(id);
            }
          });
        }

        return prev.filter((p) => !toDelete.has(p.id));
      });

      setSelectedPolygonId(null);
    });

    map.current.on("draw.selectionchange", (e: { features: GeoJSON.Feature[] }) => {
      if (e.features.length > 0) {
        setSelectedPolygonId(e.features[0].id as string);
      } else {
        setSelectedPolygonId(null);
      }
    });

    map.current.on("draw.modechange", (e: { mode: string }) => {
      setIsDrawing(e.mode === "draw_polygon");
      setIsDirectSelectMode(e.mode === "direct_select");
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [accessToken, initialCenter, initialZoom]);

  // Keep refs in sync with state
  useEffect(() => {
    drawingTypeRef.current = drawingType;
  }, [drawingType]);

  useEffect(() => {
    selectedParentIdRef.current = selectedParentId;
  }, [selectedParentId]);

  // Set up draw.create handler once and use refs for current values
  useEffect(() => {
    if (!map.current) return;

    const handleCreate = (e: { features: GeoJSON.Feature[] }) => {
      const feature = e.features[0] as GeoJSON.Feature<GeoJSON.Polygon>;
      if (!feature) return;

      const coords = feature.geometry.coordinates[0];
      const currentType = drawingTypeRef.current;
      const currentParentId = selectedParentIdRef.current;

      // Check for duplicates - if this polygon ID already exists, skip
      setPolygons((prev) => {
        if (prev.some((p) => p.id === feature.id)) {
          return prev; // Already added, skip
        }

        const validation = validatePolygon(coords, currentType, currentParentId);

        if (!validation.valid) {
          if (draw.current) {
            draw.current.delete(feature.id as string);
          }
          setValidationError(validation.error);
          setTimeout(() => setValidationError(null), 5000);
          return prev;
        }

        const newPolygon = calculatePolygonMeasurements(
          feature,
          currentType,
          currentParentId
        );

        return [...prev, newPolygon];
      });

      setIsDrawing(false);
    };

    map.current.on("draw.create", handleCreate);

    return () => {
      map.current?.off("draw.create", handleCreate);
    };
  }, [validatePolygon, calculatePolygonMeasurements]);

  const startDrawing = (type: PolygonType, parentId: string | null = null) => {
    if (!draw.current) return;

    // Validate parent selection
    if (type === "mz" && !parentId) {
      setValidationError("Please select an Area first to draw a Monitoring Zone");
      setTimeout(() => setValidationError(null), 3000);
      return;
    }

    if (type === "sp" && !parentId) {
      setValidationError("Please select a Monitoring Zone first to draw a Sample Plot");
      setTimeout(() => setValidationError(null), 3000);
      return;
    }

    setDrawingType(type);
    setSelectedParentId(parentId);
    draw.current.changeMode("draw_polygon");
    setIsDrawing(true);
  };

  const deletePolygon = (id: string) => {
    if (!draw.current) return;

    // Find all children to delete
    const toDelete = new Set([id]);
    const findChildren = (parentIds: string[]) => {
      const children = polygons.filter((p) => parentIds.includes(p.parentId || ""));
      if (children.length > 0) {
        children.forEach((c) => toDelete.add(c.id));
        findChildren(children.map((c) => c.id));
      }
    };
    findChildren([id]);

    // Delete from draw
    toDelete.forEach((deleteId) => {
      draw.current?.delete(deleteId);
    });

    setPolygons((prev) => prev.filter((p) => !toDelete.has(p.id)));
    setSelectedPolygonId(null);
  };

  const selectPolygon = (id: string) => {
    if (draw.current && map.current) {
      draw.current.changeMode("simple_select", { featureIds: [id] });
      setSelectedPolygonId(id);

      const polygon = polygons.find((p) => p.id === id);
      if (polygon) {
        const bounds = turf.bbox(turf.polygon([polygon.coordinates]));
        map.current.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 100 }
        );
      }
    }
  };

  const editPolygon = (id: string) => {
    if (draw.current) {
      draw.current.changeMode("direct_select", { featureId: id });
      setSelectedPolygonId(id);
    }
  };

  const zoomToCurrentLocation = () => {
    if (!map.current) return;

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords;
          map.current?.flyTo({
            center: [longitude, latitude],
            zoom: 15,
            essential: true,
          });
        },
        (error) => {
          alert(`Unable to get location: ${error.message}`);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    } else {
      alert("Geolocation is not supported by your browser");
    }
  };

  const deleteVertex = (polygonId: string, vertexIndex: number) => {
    if (!draw.current) return;

    const feature = draw.current.get(polygonId);
    if (!feature || feature.geometry.type !== "Polygon") return;

    const coordinates = [...feature.geometry.coordinates[0]];

    if (coordinates.length <= 4) {
      alert("Cannot delete vertex: A polygon must have at least 3 vertices");
      return;
    }

    coordinates.splice(vertexIndex, 1);

    if (vertexIndex === 0) {
      coordinates[coordinates.length - 1] = [...coordinates[0]];
    }

    const polygon = polygons.find((p) => p.id === polygonId);
    if (polygon) {
      const validation = validatePolygon(
        coordinates,
        polygon.type,
        polygon.parentId,
        polygonId
      );

      if (!validation.valid) {
        setValidationError(validation.error);
        setTimeout(() => setValidationError(null), 3000);
        return;
      }
    }

    const updatedFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: [coordinates],
      },
    };

    draw.current.add(updatedFeature as GeoJSON.Feature<GeoJSON.Geometry>);
    updatePolygonsList();

    draw.current.changeMode("direct_select", { featureId: polygonId });
  };

  const formatMeasurement = (value: number, unit: string): string => {
    if (unit === "m²") {
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(2)} km²`;
      } else if (value >= 10000) {
        return `${(value / 10000).toFixed(2)} ha`;
      }
      return `${value.toFixed(2)} m²`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)} km`;
    }
    return `${value.toFixed(2)} m`;
  };

  const selectedPolygon = polygons.find((p) => p.id === selectedPolygonId);

  const getTypeLabel = (type: PolygonType) => {
    const labels = { area: "Area", mz: "Monitoring Zone", sp: "Sample Plot" };
    return labels[type];
  };

  const getTypeColor = (type: PolygonType) => {
    const colors = {
      area: "bg-blue-500",
      mz: "bg-green-500",
      sp: "bg-amber-500",
    };
    return colors[type];
  };

  return (
    <div className="flex h-screen w-full">
      {/* Map Container */}
      <div ref={mapContainer} className="flex-1 h-full" />

      {/* Sidebar */}
      <div className="w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-4">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            Forest Mapping Tools
          </h2>

          {/* Validation Error */}
          {validationError && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-400 dark:border-red-600 rounded-lg">
              <p className="text-red-700 dark:text-red-300 text-sm font-medium">
                {validationError}
              </p>
            </div>
          )}

          {/* Drawing Controls */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getTypeColor("area")}`}></div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Areas ({areas.length})
              </span>
            </div>
            <button
              onClick={() => startDrawing("area")}
              disabled={isDrawing}
              className="w-full px-4 py-2 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isDrawing && drawingType === "area" ? "Drawing Area..." : "Draw New Area"}
            </button>

            <div className="flex items-center gap-2 mt-4">
              <div className={`w-3 h-3 rounded-full ${getTypeColor("mz")}`}></div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Monitoring Zones ({monitoringZones.length})
              </span>
            </div>
            <select
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              onChange={(e) => {
                if (e.target.value) {
                  startDrawing("mz", e.target.value);
                }
              }}
              value=""
              disabled={isDrawing || areas.length === 0}
            >
              <option value="">
                {areas.length === 0
                  ? "Draw an Area first"
                  : "Select Area to add MZ..."}
              </option>
              {areas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2 mt-4">
              <div className={`w-3 h-3 rounded-full ${getTypeColor("sp")}`}></div>
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Sample Plots ({samplePlots.length})
              </span>
            </div>
            <select
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
              onChange={(e) => {
                if (e.target.value) {
                  startDrawing("sp", e.target.value);
                }
              }}
              value=""
              disabled={isDrawing || monitoringZones.length === 0}
            >
              <option value="">
                {monitoringZones.length === 0
                  ? "Draw a Monitoring Zone first"
                  : "Select MZ to add Sample Plot..."}
              </option>
              {monitoringZones.map((mz) => (
                <option key={mz.id} value={mz.id}>
                  {mz.name}
                </option>
              ))}
            </select>

            <button
              onClick={zoomToCurrentLocation}
              className="w-full px-4 py-2 rounded-lg font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors mt-4"
            >
              📍 My Location
            </button>
          </div>

          {/* Instructions */}
          <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
            <h3 className="font-semibold text-blue-800 dark:text-blue-200 mb-2">
              Instructions
            </h3>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• First draw <strong>Areas</strong> (blue)</li>
              <li>• Then add <strong>Monitoring Zones</strong> inside Areas (green)</li>
              <li>• Finally add <strong>Sample Plots</strong> inside MZs (orange)</li>
              <li>• Polygons of the same type cannot overlap</li>
              <li>• Double-click to finish drawing</li>
              <li>• Click a polygon to select it</li>
            </ul>
          </div>

          {/* Selected Polygon Details */}
          {selectedPolygon && (
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-3 h-3 rounded-full ${getTypeColor(selectedPolygon.type)}`}></div>
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {selectedPolygon.name}
                </h3>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Type: {getTypeLabel(selectedPolygon.type)}
                {selectedPolygon.parentId && (
                  <> • Parent: {polygons.find((p) => p.id === selectedPolygon.parentId)?.name}</>
                )}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Width:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatMeasurement(selectedPolygon.width, "m")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Height:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatMeasurement(selectedPolygon.height, "m")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Area:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatMeasurement(selectedPolygon.area, "m²")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Perimeter:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatMeasurement(selectedPolygon.perimeter, "m")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Vertices:</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {selectedPolygon.vertices}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => editPolygon(selectedPolygon.id)}
                  className="flex-1 px-3 py-2 rounded-lg font-medium bg-green-500 hover:bg-green-600 text-white text-sm transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => deletePolygon(selectedPolygon.id)}
                  className="flex-1 px-3 py-2 rounded-lg font-medium bg-red-500 hover:bg-red-600 text-white text-sm transition-colors"
                >
                  Delete
                </button>
              </div>

              {/* Vertex editing */}
              {isDirectSelectMode && (
                <div className="mt-4">
                  <h4 className="font-medium text-gray-800 dark:text-gray-200 mb-2 text-sm">
                    Vertices
                  </h4>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {selectedPolygon.coordinates.slice(0, -1).map((coord, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded text-xs"
                      >
                        <span className="text-gray-700 dark:text-gray-300">
                          V{index + 1}
                        </span>
                        <button
                          onClick={() => deleteVertex(selectedPolygon.id, index)}
                          disabled={selectedPolygon.vertices <= 3}
                          className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Hierarchical Polygon List */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              All Polygons
            </h3>

            {areas.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No areas drawn yet. Click &quot;Draw New Area&quot; to start.
              </p>
            ) : (
              <div className="space-y-2">
                {areas.map((area) => (
                  <div key={area.id} className="space-y-1">
                    {/* Area */}
                    <div
                      onClick={() => selectPolygon(area.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors border-l-4 border-blue-500 ${
                        selectedPolygonId === area.id
                          ? "bg-blue-100 dark:bg-blue-900/50"
                          : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium text-gray-900 dark:text-white text-sm">
                          {area.name}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatMeasurement(area.area, "m²")}
                        </span>
                      </div>
                    </div>

                    {/* MZs for this area */}
                    {getMZsForArea(area.id).map((mz) => (
                      <div key={mz.id} className="ml-4 space-y-1">
                        <div
                          onClick={() => selectPolygon(mz.id)}
                          className={`p-2 rounded-lg cursor-pointer transition-colors border-l-4 border-green-500 ${
                            selectedPolygonId === mz.id
                              ? "bg-green-100 dark:bg-green-900/50"
                              : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                          }`}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-gray-900 dark:text-white text-sm">
                              {mz.name}
                            </span>
                            <span className="text-xs text-gray-500">
                              {formatMeasurement(mz.area, "m²")}
                            </span>
                          </div>
                        </div>

                        {/* SPs for this MZ */}
                        {getSPsForMZ(mz.id).map((sp) => (
                          <div
                            key={sp.id}
                            onClick={() => selectPolygon(sp.id)}
                            className={`ml-4 p-2 rounded-lg cursor-pointer transition-colors border-l-4 border-amber-500 ${
                              selectedPolygonId === sp.id
                                ? "bg-amber-100 dark:bg-amber-900/50"
                                : "bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700"
                            }`}
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-medium text-gray-900 dark:text-white text-sm">
                                {sp.name}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatMeasurement(sp.area, "m²")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
