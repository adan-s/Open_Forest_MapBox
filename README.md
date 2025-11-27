# Open Forest MapBox

A Next.js application with Mapbox integration for drawing and measuring polygons on interactive maps.

## Features

- Draw polygons on the map
- Get width, height, area, and perimeter measurements
- Add new vertices to existing polygons
- Delete individual vertices
- Edit polygon shapes by dragging vertices
- Delete polygons
- Zoom to your current GPS location

## Getting Started

### 1. Get a Mapbox Access Token

1. Go to [Mapbox](https://account.mapbox.com/access-tokens/)
2. Create a free account
3. Copy your default public token or create a new one

### 2. Setup Environment

```bash
# Copy the example env file
cp .env.local.example .env.local

# Edit .env.local and add your token
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_token_here
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the map.

---

## How It Works

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Your App                                │
│  ┌──────────────────────┐  ┌─────────────────────────────┐  │
│  │                      │  │        Sidebar              │  │
│  │      MAP             │  │  - Draw Polygon button      │  │
│  │   (mapbox-gl)        │  │  - Delete buttons           │  │
│  │                      │  │  - My Location button       │  │
│  │   + Drawing Tool     │  │  - Polygon measurements     │  │
│  │   (mapbox-gl-draw)   │  │  - Vertex list              │  │
│  │                      │  │                             │  │
│  └──────────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### The 3 Main Libraries

| Library | What it does |
|---------|--------------|
| `mapbox-gl` | Shows the interactive map |
| `@mapbox/mapbox-gl-draw` | Lets you draw shapes on the map |
| `@turf/turf` | Calculates measurements (area, distance, etc.) |

---

## Code Explanation

### 1. Creating the Map

```tsx
map.current = new mapboxgl.Map({
  container: mapContainer.current,  // Where to put the map (a div)
  style: "mapbox://styles/mapbox/streets-v12",  // How it looks
  center: [-74.5, 40],  // Starting location [longitude, latitude]
  zoom: 9,  // How zoomed in (higher = closer)
});
```

### 2. Adding Drawing Tools

```tsx
draw.current = new MapboxDraw({
  controls: {
    polygon: true,  // Show polygon drawing button
    trash: true,    // Show delete button
  },
});
map.current.addControl(draw.current);  // Add it to the map
```

### 3. Listening for Events

```tsx
// When user finishes drawing a polygon
map.current.on("draw.create", () => {
  updatePolygonsList();  // Update our list of polygons
});

// When user edits a polygon (moves vertices)
map.current.on("draw.update", () => {
  updatePolygonsList();  // Recalculate measurements
});

// When user deletes a polygon
map.current.on("draw.delete", () => {
  updatePolygonsList();
});
```

---

## How Polygon Drawing Works

```
Step 1: Click "Draw Polygon" button
        ↓
Step 2: Click on map to place vertices (corners)
        ↓
        Click → adds point 1
        Click → adds point 2
        Click → adds point 3
        ...
        ↓
Step 3: Double-click to finish
        ↓
Step 4: Polygon is created! Measurements calculated.
```

---

## How Measurements Work (Turf.js)

```tsx
// Get the polygon's corner points
const coordinates = polygon.geometry.coordinates[0];

// Calculate area (in square meters)
const area = turf.area(polygon);

// Calculate perimeter (total edge length)
const perimeter = turf.length(turf.lineString(coordinates));

// Get bounding box (rectangle around the polygon)
const bbox = turf.bbox(polygon);
//  bbox = [minLng, minLat, maxLng, maxLat]
```

### Bounding Box Visualization

```
         maxLat ─────────────────┐
                │   POLYGON     │
                │     HERE      │
         minLat └───────────────┘
               minLng        maxLng

Width  = distance from minLng to maxLng (left to right)
Height = distance from minLat to maxLat (bottom to top)
```

---

## The Three Modes

| Mode | What you can do |
|------|-----------------|
| `simple_select` | Click polygons to select them |
| `direct_select` | Edit vertices (drag, add, delete) |
| `draw_polygon` | Draw a new polygon |

---

## How Vertex Deletion Works

```tsx
const deleteVertex = (polygonId, vertexIndex) => {
  // 1. Get the polygon
  const feature = draw.current.get(polygonId);

  // 2. Get its coordinates (list of points)
  const coordinates = [...feature.geometry.coordinates[0]];
  // Example: [[lng1,lat1], [lng2,lat2], [lng3,lat3], [lng1,lat1]]
  //          (first and last point are same to "close" the polygon)

  // 3. Remove the vertex at index
  coordinates.splice(vertexIndex, 1);

  // 4. Update the polygon with new coordinates
  draw.current.add(updatedFeature);
};
```

---

## How "My Location" Works

```tsx
// Ask browser for user's location
navigator.geolocation.getCurrentPosition((position) => {
  // position.coords has latitude and longitude

  // Fly the map to that location
  map.current.flyTo({
    center: [longitude, latitude],
    zoom: 15,  // Zoom in close
  });
});
```

---

## Polygon Coordinates Structure

```
     [lng, lat]          [lng, lat]
         •─────────────────•
        /                   \
       /     POLYGON         \
      /                       \
     •─────────────────────────•
  [lng, lat]              [lng, lat]

Stored as: [[lng1,lat1], [lng2,lat2], [lng3,lat3], [lng4,lat4], [lng1,lat1]]
                ↑                                                    ↑
           first point                    =                    last point
                        (closes the polygon)
```

---

## Button Reference

| Button | Action |
|--------|--------|
| **Draw Polygon** | Starts drawing mode - click to add points |
| **Delete Selected** | Removes the currently selected polygon |
| **Delete All** | Removes all polygons from the map |
| **My Location** | Zooms map to your GPS location |
| **Edit Vertices** | Enters edit mode for selected polygon |
| **✕ (on vertex)** | Deletes that specific vertex |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx        # Main page with MapboxMap component
│   ├── layout.tsx      # Root layout
│   └── globals.css     # Global styles + Mapbox overrides
└── components/
    └── MapboxMap.tsx   # Main map component with all functionality
```

---

## Technologies Used

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling
- **Mapbox GL JS** - Interactive maps
- **Mapbox GL Draw** - Drawing tools
- **Turf.js** - Geospatial calculations

---

## Learn More

- [Mapbox GL JS Documentation](https://docs.mapbox.com/mapbox-gl-js/guides/)
- [Mapbox GL Draw Documentation](https://github.com/mapbox/mapbox-gl-draw)
- [Turf.js Documentation](https://turfjs.org/)
- [Next.js Documentation](https://nextjs.org/docs)
