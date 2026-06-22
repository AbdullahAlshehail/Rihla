// Booking.com adapter — STUB for Phase 2.
// Will enable hotel search/pricing. For MVP we only store user-entered hotel info.

export type HotelOption = {
  source: "booking";
  external_id: string;
  name: string;
  lat: number;
  lng: number;
  price_per_night_sar?: number;
  rating?: number;
  url: string;
};

export async function searchHotels(_args: {
  city: string;
  checkIn: string;
  checkOut: string;
  travelers: number;
}): Promise<HotelOption[]> {
  // TODO: implement once Booking partner access is granted.
  return [];
}
