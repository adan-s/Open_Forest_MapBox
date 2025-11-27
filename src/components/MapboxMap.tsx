"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import MapboxGeocoder from "@mapbox/mapbox-gl-geocoder";
import * as turf from "@turf/turf";

import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import "@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css";

interface PolygonMeasurement {
  id: string;
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

export default function MapboxMap({
  accessToken,
  initialCenter = [-74.5, 40],
  initialZoom = 9,
}: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const draw = useRef<MapboxDraw | null>(null);

  const [polygons, setPolygons] = useState<PolygonMeasurement[]>([]);
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDirectSelectMode, setIsDirectSelectMode] = useState(false);

  const calculatePolygonMeasurements = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Polygon>): PolygonMeasurement => {
      const coordinates = feature.geometry.coordinates[0];
      const polygon = turf.polygon([coordinates]);

      // Calculate area in square meters
      const area = turf.area(polygon);

      // Calculate perimeter in meters
      const perimeter = turf.length(turf.lineString(coordinates), {
        units: "meters",
      });

      // Calculate bounding box for width and height
      const bbox = turf.bbox(polygon);
      const minLng = bbox[0];
      const minLat = bbox[1];
      const maxLng = bbox[2];
      const maxLat = bbox[3];

      // Width (east-west distance at the center latitude)
      const centerLat = (minLat + maxLat) / 2;
      const width = turf.distance(
        turf.point([minLng, centerLat]),
        turf.point([maxLng, centerLat]),
        { units: "meters" }
      );

      // Height (north-south distance at the center longitude)
      const centerLng = (minLng + maxLng) / 2;
      const height = turf.distance(
        turf.point([centerLng, minLat]),
        turf.point([centerLng, maxLat]),
        { units: "meters" }
      );

      return {
        id: feature.id as string,
        area,
        perimeter,
        width,
        height,
        vertices: coordinates.length - 1, // Subtract 1 because first and last are the same
        coordinates,
      };
    },
    []
  );

  const updatePolygonsList = useCallback(() => {
    if (!draw.current) return;

    const data = draw.current.getAll();
    const polygonFeatures = data.features.filter(
      (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
        f.geometry.type === "Polygon"
    );

    const measurements = polygonFeatures.map(calculatePolygonMeasurements);
    setPolygons(measurements);
  }, [calculatePolygonMeasurements]);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = accessToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: initialCenter,
      zoom: initialZoom,
    });

    // Initialize draw control with all editing modes
    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: "simple_select",
    });

    map.current.addControl(draw.current, "top-left");
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Add Geocoder (search) control
    const geocoder = new MapboxGeocoder({
      accessToken: accessToken,
      mapboxgl: mapboxgl,
      marker: true,
      placeholder: "Search address, place, or coordinates...",
      zoom: 17,
      // Include all location types for full address search
      // Note: "address" includes street-level results, "poi.landmark" for famous landmarks
      types: "country,region,postcode,district,place,locality,neighborhood,address,poi,poi.landmark",
    });
    map.current.addControl(geocoder, "top-left");

    // Event handlers
    map.current.on("draw.create", () => {
      updatePolygonsList();
      setIsDrawing(false);
    });

    map.current.on("draw.update", () => {
      updatePolygonsList();
    });

    map.current.on("draw.delete", () => {
      updatePolygonsList();
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
      if (e.mode !== "direct_select") {
        setSelectedVertexIndex(null);
      }
    });

    // Track selected vertex in direct_select mode
    map.current.on("click", () => {
      if (draw.current) {
        const selected = draw.current.getSelected();
        if (selected.features.length > 0) {
          const feature = selected.features[0];
          // Check if we're in direct_select mode and have selected coordinates
          const mode = draw.current.getMode();
          if (mode === "direct_select" && feature.properties?.coord_path) {
            const coordPath = feature.properties.coord_path;
            const vertexIndex = parseInt(coordPath.split(".").pop() || "0", 10);
            setSelectedVertexIndex(vertexIndex);
          }
        }
      }
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [accessToken, initialCenter, initialZoom, updatePolygonsList]);

  const startDrawing = () => {
    if (draw.current) {
      draw.current.changeMode("draw_polygon");
      setIsDrawing(true);
    }
  };

  const deleteSelectedPolygon = () => {
    if (draw.current && selectedPolygonId) {
      draw.current.delete(selectedPolygonId);
      updatePolygonsList();
      setSelectedPolygonId(null);
    }
  };

  const deleteAllPolygons = () => {
    if (draw.current) {
      draw.current.deleteAll();
      updatePolygonsList();
      setSelectedPolygonId(null);
    }
  };

  const selectPolygon = (id: string) => {
    if (draw.current && map.current) {
      draw.current.changeMode("direct_select", { featureId: id });
      setSelectedPolygonId(id);

      // Zoom to the selected polygon
      const feature = draw.current.get(id);
      if (feature && feature.geometry.type === "Polygon") {
        const bounds = turf.bbox(feature);
        map.current.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 50 }
        );
      }
    }
  };

  const editPolygon = (id: string) => {
    if (draw.current) {
      // Enter direct_select mode which allows vertex editing
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

    // A polygon needs at least 4 points (3 vertices + closing point)
    if (coordinates.length <= 4) {
      alert("Cannot delete vertex: A polygon must have at least 3 vertices");
      return;
    }

    // Remove the vertex at the specified index
    coordinates.splice(vertexIndex, 1);

    // If we removed the first vertex, update the closing point to match the new first vertex
    if (vertexIndex === 0) {
      coordinates[coordinates.length - 1] = [...coordinates[0]];
    }
    // If we removed the last point (before closing), that's fine as closing point remains

    // Update the feature
    const updatedFeature = {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: [coordinates],
      },
    };

    draw.current.add(updatedFeature as GeoJSON.Feature<GeoJSON.Geometry>);
    updatePolygonsList();
    setSelectedVertexIndex(null);

    // Re-enter direct_select mode
    draw.current.changeMode("direct_select", { featureId: polygonId });
  };

  const formatMeasurement = (value: number, unit: string): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(2)} km${unit === "m²" ? "²" : ""}`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(2)} ${unit === "m²" ? "km²" : "km"}`;
    }
    return `${value.toFixed(2)} ${unit}`;
  };

  const selectedPolygon = polygons.find((p) => p.id === selectedPolygonId);

  return (
    <div className="flex h-screen w-full">
      {/* Map Container */}
      <div ref={mapContainer} className="flex-1 h-full" />

      {/* Sidebar */}
      <div className="w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
        <div className="p-4">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            Polygon Tools
          </h2>

          {/* Drawing Controls */}
          <div className="space-y-2 mb-6">
            <button
              onClick={startDrawing}
              disabled={isDrawing}
              className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                isDrawing
                  ? "bg-green-500 text-white cursor-not-allowed"
                  : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
            >
              {isDrawing ? "Drawing..." : "Draw Polygon"}
            </button>

            <button
              onClick={deleteSelectedPolygon}
              disabled={!selectedPolygonId}
              className="w-full px-4 py-2 rounded-lg font-medium bg-red-500 hover:bg-red-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Delete Selected
            </button>

            <button
              onClick={deleteAllPolygons}
              disabled={polygons.length === 0}
              className="w-full px-4 py-2 rounded-lg font-medium bg-gray-500 hover:bg-gray-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Delete All
            </button>

            <button
              onClick={zoomToCurrentLocation}
              className="w-full px-4 py-2 rounded-lg font-medium bg-purple-500 hover:bg-purple-600 text-white transition-colors"
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
              <li>• Click &quot;Draw Polygon&quot; to start</li>
              <li>• Click on the map to add vertices</li>
              <li>• Double-click to finish drawing</li>
              <li>• Click a polygon to select it</li>
              <li>• Drag vertices to edit shape</li>
              <li>• Click on edge midpoints to add vertices</li>
              <li>• Select a vertex and press Delete to remove it</li>
            </ul>
          </div>

          {/* Selected Polygon Details */}
          {selectedPolygon && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/30 rounded-lg">
              <h3 className="font-semibold text-green-800 dark:text-green-200 mb-3">
                Selected Polygon
              </h3>
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
              <button
                onClick={() => editPolygon(selectedPolygon.id)}
                className={`w-full mt-3 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isDirectSelectMode
                    ? "bg-green-600 text-white"
                    : "bg-green-500 hover:bg-green-600 text-white"
                }`}
              >
                {isDirectSelectMode ? "Editing Vertices" : "Edit Vertices"}
              </button>

              {/* Vertex List for Deletion */}
              {isDirectSelectMode && (
                <div className="mt-4">
                  <h4 className="font-medium text-green-800 dark:text-green-200 mb-2 text-sm">
                    Vertices (click to delete)
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {selectedPolygon.coordinates.slice(0, -1).map((coord, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded text-xs"
                      >
                        <span className="text-gray-700 dark:text-gray-300">
                          V{index + 1}: [{coord[0].toFixed(4)}, {coord[1].toFixed(4)}]
                        </span>
                        <button
                          onClick={() => deleteVertex(selectedPolygon.id, index)}
                          disabled={selectedPolygon.vertices <= 3}
                          className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title={selectedPolygon.vertices <= 3 ? "Minimum 3 vertices required" : "Delete vertex"}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {selectedPolygon.vertices <= 3 && (
                    <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                      Minimum 3 vertices required
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Polygons List */}
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
              Polygons ({polygons.length})
            </h3>
            {polygons.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                No polygons drawn yet. Click &quot;Draw Polygon&quot; to start.
              </p>
            ) : (
              <div className="space-y-2">
                {polygons.map((polygon, index) => (
                  <div
                    key={polygon.id}
                    onClick={() => selectPolygon(polygon.id)}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedPolygonId === polygon.id
                        ? "bg-blue-100 dark:bg-blue-900/50 border-2 border-blue-500"
                        : "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium text-gray-900 dark:text-white">
                        Polygon {index + 1}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {polygon.vertices} vertices
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                      <div className="flex justify-between">
                        <span>W × H:</span>
                        <span>
                          {formatMeasurement(polygon.width, "m")} ×{" "}
                          {formatMeasurement(polygon.height, "m")}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Area:</span>
                        <span>{formatMeasurement(polygon.area, "m²")}</span>
                      </div>
                    </div>
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
