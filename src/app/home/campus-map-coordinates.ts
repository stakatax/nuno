// Provisional alignment of the supplied drawing with GPS coordinates.
// Leaflet image positions use [Y, X], measured from the bottom-left.
export function gpsToMap(latitude: number, longitude: number): [number, number] {
  const a = 1.1002748636589028e-5;
  const b = -1.9887106961213874e-8;
  const c = -8.282354098657935e-8;
  const d = -1.0253096584662141e-5;
  const lon = longitude - 120.93511530575795;
  const lat = latitude - 15.451949635605418;
  const determinant = a * d - b * c;
  const pdfX = (d * lon - b * lat) / determinant;
  const pdfY = (a * lat - c * lon) / determinant;
  return [1360 - (pdfY - 135) * 2, (pdfX - 190) * 2];
}

export function gpsAccuracyOutline(
  latitude: number,
  longitude: number,
  accuracy: number
): [number, number][] {
  const points: [number, number][] = [];
  const metersPerLongitudeDegree = 111320 * Math.cos(latitude * Math.PI / 180);

  for (let step = 0; step < 32; step++) {
    const angle = step * Math.PI * 2 / 32;
    points.push(gpsToMap(
      latitude + Math.sin(angle) * accuracy / 111320,
      longitude + Math.cos(angle) * accuracy / metersPerLongitudeDegree
    ));
  }

  return points;
}
