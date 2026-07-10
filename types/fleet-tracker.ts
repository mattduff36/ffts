export interface TrackerLocationData {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
  name: string;
  vrn: string;
  vehicleId: string;
  /** Present when the tracker VRN matches a van in the fleet database */
  nickname?: string | null;
}
