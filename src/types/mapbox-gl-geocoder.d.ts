declare module "@mapbox/mapbox-gl-geocoder" {
  import { IControl, Map } from "mapbox-gl";

  interface GeocoderOptions {
    accessToken: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapboxgl?: any;
    marker?: boolean;
    placeholder?: string;
    zoom?: number;
    flyTo?: boolean | object;
    proximity?: { longitude: number; latitude: number };
    trackProximity?: boolean;
    collapsed?: boolean;
    clearAndBlurOnEsc?: boolean;
    clearOnBlur?: boolean;
    bbox?: [number, number, number, number];
    countries?: string;
    types?: string;
    minLength?: number;
    limit?: number;
    language?: string;
    filter?: (feature: object) => boolean;
    localGeocoder?: (query: string) => object[];
    reverseGeocode?: boolean;
    enableEventLogging?: boolean;
  }

  export default class MapboxGeocoder implements IControl {
    constructor(options: GeocoderOptions);
    onAdd(map: Map): HTMLElement;
    onRemove(): void;
    query(query: string): this;
    setInput(value: string): this;
    setProximity(proximity: { longitude: number; latitude: number }): this;
    getProximity(): { longitude: number; latitude: number };
    setRenderFunction(fn: (feature: object) => string): this;
    setLanguage(language: string): this;
    getLanguage(): string;
    setZoom(zoom: number): this;
    getZoom(): number;
    setFlyTo(flyTo: boolean | object): this;
    getFlyTo(): boolean | object;
    setPlaceholder(placeholder: string): this;
    getPlaceholder(): string;
    setBbox(bbox: [number, number, number, number]): this;
    getBbox(): [number, number, number, number];
    setCountries(countries: string): this;
    getCountries(): string;
    setTypes(types: string): this;
    getTypes(): string;
    setMinLength(minLength: number): this;
    getMinLength(): number;
    setLimit(limit: number): this;
    getLimit(): number;
    setFilter(filter: (feature: object) => boolean): this;
    setOrigin(origin: string): this;
    getOrigin(): string;
    on(event: string, callback: (result: object) => void): this;
    off(event: string, callback: (result: object) => void): this;
    clear(): void;
  }
}
