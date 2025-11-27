import MapboxMap from "@/components/MapboxMap";

export default function Home() {
  // Replace with your Mapbox access token
  // You can get one at https://account.mapbox.com/access-tokens/
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "YOUR_MAPBOX_ACCESS_TOKEN";

  return (
    <main className="h-screen w-screen overflow-hidden">
      <MapboxMap
        accessToken={mapboxToken}
        initialCenter={[-74.5, 40]}
        initialZoom={9}
      />
    </main>
  );
}
