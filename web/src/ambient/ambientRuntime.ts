/**
 * Jembatan antar lapisan ambient. AmbientLayer (lalu lintas, bus, lampu) mengisi data ini
 * tiap tick; PedestrianLayer dan audio ambient membacanya. Modul terpisah supaya tidak ada
 * import silang antar lapisan, dan supaya isinya bisa diuji tanpa three.js.
 *
 * Array-nya dipakai ulang (tidak dialokasikan tiap frame): penulis memanggil `resetAgents`
 * lalu push, pembaca hanya membaca.
 */

export interface AmbientAgent {
  x: number;
  z: number;
  /** m/s; 0 untuk agen yang berhenti. */
  speed: number;
}

export const ambientRuntime: {
  /** Kendaraan yang sedang di jalan; dipakai pejalan kaki untuk menilai zebra aman. */
  vehicles: AmbientAgent[];
  /** Pejalan kaki aktif; dipakai audio ambient untuk menempatkan cue kerumunan. */
  peds: AmbientAgent[];
  /**
   * Lampu penyeberangan: benar kalau kendaraan yang melintasi zebra di titik (x, z)
   * sedang ditahan lampu merah, jadi pejalan boleh menyeberang. `axis` adalah sumbu jalan
   * yang diseberangi (0 = jalan membentang timur-barat, 1 = utara-selatan).
   *
   * Null selama AmbientLayer belum siap atau persimpangan terdekat tidak berlampu;
   * saat null, pejalan menilai zebra dari kendaraan saja.
   */
  pedGreen: ((x: number, z: number, axis: number) => boolean) | null;
} = { vehicles: [], peds: [], pedGreen: null };

/** Kosongkan satu daftar agen tanpa mengalokasikan array baru. */
export const resetAgents = (list: AmbientAgent[]): void => {
  list.length = 0;
};
